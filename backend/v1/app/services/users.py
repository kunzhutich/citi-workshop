"""Rules for administering other people's accounts.

Three rules live here:

* **An admin cannot change their own role or deactivate themselves.** This is
  what makes the last facility admin unremovable without a special case for it:
  removing an admin requires being a *different* admin, so there is always at
  least one left. The alternative — counting the remaining admins on every
  write — is a rule that can be got around by two admins acting at once.
* **Promoting to ENGINEER creates a profile.** An ENGINEER user without one
  passes the role check and then fails every level check. A demoted engineer
  keeps their profile row, so promoting them again restores the level and
  specialties they had rather than silently resetting them to JUNIOR.
* **Deactivating revokes sessions.** Otherwise an access token issued a minute
  earlier keeps working until it expires.

Editing a user's email or password is deliberately absent: the email is the
sign-in identity and the key the audit trail reads by, and a password is only
ever set by its owner through `POST /auth/change-password`.
"""

import logging
import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.errors import NotFoundError, ValidationError
from app.models.engineer_profile import EngineerProfile
from app.models.enums import EngineerLevel, UserRole
from app.models.user import User
from app.repositories import engineers as engineer_repository
from app.repositories import users as repository
from app.schemas.common import PageParams
from app.schemas.user import UserUpdate

logger = logging.getLogger(__name__)


def list_users(
    session: Session,
    *,
    role: UserRole | None,
    query: str | None,
    include_inactive: bool,
    paging: PageParams,
) -> tuple[Sequence[User], int]:
    """Return one page of users matching the filters."""
    return repository.search(
        session,
        role=role,
        query=query,
        include_inactive=include_inactive,
        limit=paging.page_size,
        offset=paging.offset,
    )


def get_user(session: Session, user_id: uuid.UUID) -> User:
    """Return one user, or raise `NotFoundError`."""
    user = repository.get_by_id(session, user_id)
    if user is None:
        raise NotFoundError("That user does not exist.", code="USER_NOT_FOUND")
    return user


def update_user(
    session: Session,
    *,
    actor: User,
    user_id: uuid.UUID,
    payload: UserUpdate,
) -> User:
    """Apply an admin's partial update to an account."""
    user = get_user(session, user_id)
    changes = payload.model_dump(exclude_unset=True)

    if "role" in changes and changes["role"] != user.role:
        _reject_self_change(actor, user, field="role", detail="You cannot change your own role.")
        _apply_role_change(session, user, new_role=changes.pop("role"))

    if "is_active" in changes and changes["is_active"] is False:
        _reject_self_change(
            actor,
            user,
            field="is_active",
            detail="You cannot deactivate your own account.",
        )

    for field, value in changes.items():
        setattr(user, field, value)

    if changes.get("is_active") is False:
        revoked = repository.revoke_all_refresh_tokens(session, user.id)
        logger.info("Deactivated user %s and revoked %d session(s)", user.id, revoked)

    session.flush()
    return user


def _apply_role_change(session: Session, user: User, *, new_role: UserRole) -> None:
    """Set a new role, making sure an ENGINEER always has a profile.

    The profile is created only when one is missing, so a demotion followed by
    a promotion restores the engineer exactly as they were.
    """
    user.role = new_role

    if new_role != UserRole.ENGINEER:
        return

    if engineer_repository.get_profile(session, user.id) is None:
        engineer_repository.add_profile(
            session,
            EngineerProfile(user_id=user.id, level=EngineerLevel.JUNIOR),
        )
        logger.info("Created a default JUNIOR profile for promoted user %s", user.id)


def _reject_self_change(actor: User, target: User, *, field: str, detail: str) -> None:
    """Raise `ValidationError` when an admin is editing themselves this way."""
    if actor.id == target.id:
        raise ValidationError(detail, code="CANNOT_EDIT_SELF", field=field)
