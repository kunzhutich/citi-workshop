"""Authentication endpoints.

These are the only routes that use ``get_authenticated_user`` rather than
``get_current_user``: a user with ``must_change_password`` set has to be able
to reach ``/auth/me`` and ``/auth/change-password``, which is exactly what the
gate would otherwise block.

The refresh token is set as an ``HttpOnly`` cookie rather than returned in the
body, so no JavaScript on the page can read it. ``SameSite=Strict`` works here
because the browser is always same-origin with the API — CloudFront fronts both
in the cloud, and the Vite dev proxy does the same locally.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.config import get_settings
from app.errors import AuthenticationError
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    MessageResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
)
from app.schemas.user import CurrentUserRead, UserRead
from app.security.dependencies import (
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_PATH,
    AuthenticatedUser,
    DbSession,
    get_refresh_token_from_cookie,
)
from app.security.tokens import REFRESH_TOKEN_TTL
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

RefreshCookie = Annotated[str | None, Depends(get_refresh_token_from_cookie)]


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Self-register an employee account",
)
def register(payload: RegisterRequest, session: DbSession) -> RegisterResponse:
    """Create an EMPLOYEE account for an @acme.inc address.

    Engineers and admins are never created here — an admin creates engineers,
    and the first admin comes from the `seed_admin` ops action.
    """
    user = auth_service.register_employee(
        session,
        email=payload.email,
        full_name=payload.full_name,
        password=payload.password,
    )
    session.commit()
    return RegisterResponse(user=UserRead.model_validate(user))


@router.post("/login", response_model=TokenResponse, summary="Sign in")
def login(payload: LoginRequest, response: Response, session: DbSession) -> TokenResponse:
    """Exchange credentials for an access token and a refresh cookie."""
    user = auth_service.authenticate(session, email=payload.email, password=payload.password)
    access_token, raw_refresh, _ = auth_service.issue_session(session, user)
    session.commit()

    _set_refresh_cookie(response, raw_refresh)
    return TokenResponse(access_token=access_token, user=UserRead.model_validate(user))


@router.post("/refresh", response_model=TokenResponse, summary="Rotate the session")
def refresh(response: Response, session: DbSession, refresh_token: RefreshCookie) -> TokenResponse:
    """Issue a new access token and a new refresh cookie, revoking the old one."""
    if not refresh_token:
        raise AuthenticationError(
            "Your session has expired. Please sign in again.",
            code="MISSING_REFRESH_TOKEN",
        )

    user, access_token, raw_refresh, _ = auth_service.rotate_session(session, refresh_token)
    session.commit()

    _set_refresh_cookie(response, raw_refresh)
    return TokenResponse(access_token=access_token, user=UserRead.model_validate(user))


@router.post("/logout", response_model=MessageResponse, summary="Sign out")
def logout(response: Response, session: DbSession, refresh_token: RefreshCookie) -> MessageResponse:
    """Revoke the current refresh token and clear the cookie.

    Always succeeds, even with no cookie or an unknown one: signing out of a
    session you no longer have is not an error.
    """
    auth_service.revoke_session(session, refresh_token)
    session.commit()

    _clear_refresh_cookie(response)
    return MessageResponse(detail="Signed out.")


@router.post(
    "/change-password",
    response_model=MessageResponse,
    summary="Change your own password",
)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    session: DbSession,
    user: AuthenticatedUser,
) -> MessageResponse:
    """Replace the caller's password and clear any forced-change flag.

    Reachable while `must_change_password` is set — that is the point of it.
    Every other session is revoked, so the cookie is cleared here too and the
    caller signs in again.
    """
    auth_service.change_password(
        session,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    session.commit()

    _clear_refresh_cookie(response)
    return MessageResponse(detail="Password changed. Please sign in again.")


@router.get("/me", response_model=MeResponse, summary="Who am I")
def read_me(user: AuthenticatedUser) -> MeResponse:
    """Return the caller's own record, including their engineer profile if any."""
    return MeResponse(user=CurrentUserRead.model_validate(user))


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    """Attach the refresh cookie with the flags appropriate to this environment."""
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=int(REFRESH_TOKEN_TTL.total_seconds()),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        # False locally so plain-HTTP development works, True behind CloudFront.
        secure=get_settings().cookie_secure,
        samesite="strict",
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh cookie. Path must match the one it was set with."""
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="strict",
    )
