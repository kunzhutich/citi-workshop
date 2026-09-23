"""FastAPI dependencies for authentication and role checks.

There are deliberately **two** authenticated-user dependencies:

``get_authenticated_user``
    Valid token, active account. Nothing more. Used by ``/auth/*`` only.

``get_current_user``
    The above **plus** the password-change gate. The default for every other
    route in the application.

Splitting them is how the ``must_change_password`` rule is enforced in exactly
one place without a middleware that has to pattern-match URLs. A route either
opts into the gate by depending on ``get_current_user`` — which is what
``require_roles`` does — or is an auth route that cannot require it, because
changing your password is the one thing you must be able to do while gated.

Engineer level is deliberately re-read from the database rather than taken
from the token, so an admin's change to a role or level applies on the very
next request instead of whenever the current access token happens to expire.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import AuthenticationError, AuthorizationError
from app.models.enums import EngineerLevel, UserRole
from app.models.user import User
from app.observability import bind_user_id
from app.repositories import users as user_repository
from app.security.tokens import InvalidTokenError, decode_access_token

#: Returned when an account still has `must_change_password` set. The frontend
#: branches on this code to force the change-password screen.
PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED"  # nosec B105 - an error code, not a credential

#: Name of the cookie carrying the refresh token.
REFRESH_COOKIE_NAME = "acme_refresh_token"

#: Cookie path. Narrow on purpose: the browser sends the refresh token only to
#: the endpoints that need it, so an XSS-adjacent request to /api/v1/incidents
#: never carries it.
REFRESH_COOKIE_PATH = "/api/v1/auth"


def get_bearer_token(request: Request) -> str:
    """Pull the bearer token out of the Authorization header."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationError("Sign in to continue.", code="MISSING_TOKEN")
    return token.strip()


def get_authenticated_user(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the caller from their access token. No password-change gate.

    Only ``/auth/*`` should depend on this directly.
    """
    token = get_bearer_token(request)

    try:
        claims = decode_access_token(token)
    except InvalidTokenError as exc:
        raise AuthenticationError(
            "Your session has expired. Please sign in again.", code="INVALID_TOKEN"
        ) from exc

    user = user_repository.get_by_id(session, claims.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Your account is no longer active.", code="INACTIVE_ACCOUNT")

    # The first moment the answer is both known and verified, so it is where
    # the request log learns whose request this is. It records; it decides
    # nothing, and a failure above this line simply logs no user id.
    bind_user_id(request.scope, user.id)
    return user


def get_current_user(
    user: Annotated[User, Depends(get_authenticated_user)],
) -> User:
    """Resolve the caller and refuse if they still owe us a password change.

    This is the dependency every non-auth route should use.
    """
    if user.must_change_password:
        raise AuthorizationError(
            "You must change your password before continuing.",
            code=PASSWORD_CHANGE_REQUIRED,
        )
    return user


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Build a dependency that admits only the given roles.

    Usage::

        @router.get("/users", dependencies=[Depends(require_roles(UserRole.FACILITY_ADMIN))])

    or, when the route also needs the user::

        def list_users(admin: Annotated[User, Depends(require_roles(UserRole.FACILITY_ADMIN))]):

    Role failures are 403, never 404: hiding a resource's existence is not a
    goal here, and a distinct status makes the tests unambiguous.
    """
    allowed = frozenset(roles)

    def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed:
            raise AuthorizationError(
                "You do not have permission to do that.",
                code="ROLE_NOT_PERMITTED",
            )
        return user

    return dependency


def require_engineer_levels(*levels: EngineerLevel) -> Callable[[User], User]:
    """Build a dependency admitting engineers of the given levels, plus admins.

    Facility admins pass every engineer-level check: they can do anything an
    engineer can. Used from M4 onwards for pick-up and assignment.
    """
    allowed = frozenset(levels)

    def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role == UserRole.FACILITY_ADMIN:
            return user
        profile = user.engineer_profile
        if user.role != UserRole.ENGINEER or profile is None or profile.level not in allowed:
            raise AuthorizationError(
                "You do not have permission to do that.",
                code="LEVEL_NOT_PERMITTED",
            )
        return user

    return dependency


def get_include_inactive(
    user: Annotated[User, Depends(get_current_user)],
    include_inactive: Annotated[
        bool,
        Query(description="Include deactivated records. Facility admins only."),
    ] = False,
) -> bool:
    """Resolve the `include_inactive` query flag, refusing it to non-admins.

    Deactivated buildings, floors, seats and categories exist only for the
    admin screens that reactivate them; everyone else sees the live facility.
    Refusing the flag rather than quietly ignoring it means a caller is never
    told "here is everything" and handed something else.
    """
    if include_inactive and user.role != UserRole.FACILITY_ADMIN:
        raise AuthorizationError(
            "Only facility admins may list deactivated records.",
            code="INCLUDE_INACTIVE_NOT_PERMITTED",
        )
    return include_inactive


def get_refresh_token_from_cookie(request: Request) -> str | None:
    """Return the raw refresh token from the request cookie, if present."""
    return request.cookies.get(REFRESH_COOKIE_NAME)


#: Convenience aliases so routes read as `user: CurrentUser` rather than
#: repeating the full Annotated form.
CurrentUser = Annotated[User, Depends(get_current_user)]
AuthenticatedUser = Annotated[User, Depends(get_authenticated_user)]
DbSession = Annotated[Session, Depends(get_db)]

IncludeInactive = Annotated[bool, Depends(get_include_inactive)]

#: Role sets, for the routes that need the *user* — `admin: AdminUser`.
AdminUser = Annotated[User, Depends(require_roles(UserRole.FACILITY_ADMIN))]
StaffUser = Annotated[User, Depends(require_roles(UserRole.ENGINEER, UserRole.FACILITY_ADMIN))]

#: The same role sets for routes that need the *permission* but not the user,
#: used as `@router.post(..., dependencies=[ADMIN_ONLY])`. Without this a route
#: has to accept an argument it never reads.
SIGNED_IN = Depends(get_current_user)
ADMIN_ONLY = Depends(require_roles(UserRole.FACILITY_ADMIN))
STAFF_ONLY = Depends(require_roles(UserRole.ENGINEER, UserRole.FACILITY_ADMIN))
