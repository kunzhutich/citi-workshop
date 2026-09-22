"""Rules for creating and maintaining engineer accounts.

An engineer is created by an admin, never by self-registration, because the
level and specialties decide what work they can be given. The rules here:

* **The account and the profile are created together**, in one transaction. An
  ENGINEER user without a profile would pass `require_roles(ENGINEER)` and then
  fail every level check, which is a confusing way to be half-created.
* **The password is generated, not chosen.** It is returned exactly once, and
  the account carries `must_change_password`, so the value that travelled
  through an admin's screen cannot stay in use.
* **Specialties and home building are validated**, so a profile cannot point at
  a category that is not a group or a building that does not exist.
* **Deleting an engineer deactivates them.** Their name is on past tickets;
  removing the row would take the assignee off every one of them.
"""

import logging
import secrets
import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.building import Building
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.enums import AvailabilityStatus, EngineerLevel, UserRole
from app.models.user import User
from app.repositories import engineers as repository
from app.repositories import users as user_repository
from app.schemas.common import DeleteResult, PageParams
from app.schemas.engineer import EngineerCreate, EngineerSelfUpdate, EngineerUpdate
from app.security.passwords import hash_password
from app.services.auth_service import normalise_email

logger = logging.getLogger(__name__)

#: Length in bytes of a generated temporary password, before URL-safe encoding.
#: 16 bytes is about 22 characters, comfortably past the 12-character minimum
#: the password policy sets.
TEMPORARY_PASSWORD_BYTES = 16


def list_engineers(
    session: Session,
    *,
    include_inactive: bool,
    availability: AvailabilityStatus | None,
    level: EngineerLevel | None,
    group_id: uuid.UUID | None,
    building_id: uuid.UUID | None,
    paging: PageParams,
) -> tuple[Sequence[repository.EngineerRow], int]:
    """Return one page of engineers with their current workload."""
    return repository.list_engineers(
        session,
        include_inactive=include_inactive,
        availability=availability,
        level=level,
        group_id=group_id,
        building_id=building_id,
        limit=paging.page_size,
        offset=paging.offset,
    )


def get_engineer(session: Session, user_id: uuid.UUID) -> repository.EngineerRow:
    """Return one engineer with their workload, or raise `NotFoundError`."""
    row = repository.get_engineer(session, user_id)
    if row is None:
        raise NotFoundError("That engineer does not exist.", code="ENGINEER_NOT_FOUND")
    return row


def create_engineer(
    session: Session, payload: EngineerCreate
) -> tuple[repository.EngineerRow, str]:
    """Create an engineer account and profile, returning the temporary password.

    Returns ``((user, profile, active_ticket_count), temporary_password)``. The
    count is always zero for a new account; it is included so the caller can
    render the same shape as every other engineer response.
    """
    email = normalise_email(payload.email)
    if user_repository.email_exists(session, email):
        raise ConflictError(
            "An account with that email already exists.",
            code="EMAIL_TAKEN",
            field="email",
        )

    _require_group_ids(session, payload.specialty_group_ids)
    _require_building(session, payload.home_building_id)

    temporary_password = secrets.token_urlsafe(TEMPORARY_PASSWORD_BYTES)
    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(temporary_password),
        role=UserRole.ENGINEER,
        is_active=True,
        # The password has been seen by whoever created the account, so it is
        # a credential to replace, not one to keep.
        must_change_password=True,
    )
    session.add(user)
    session.flush()

    profile = repository.add_profile(
        session,
        EngineerProfile(
            user_id=user.id,
            level=payload.level,
            specialty_group_ids=list(payload.specialty_group_ids),
            home_building_id=payload.home_building_id,
            phone=payload.phone,
            availability=AvailabilityStatus.AVAILABLE,
            max_active_tickets=payload.max_active_tickets,
        ),
    )
    logger.info("Created engineer %s at level %s", user.id, profile.level)
    return (user, profile, 0), temporary_password


def update_engineer(
    session: Session,
    user_id: uuid.UUID,
    payload: EngineerUpdate,
) -> repository.EngineerRow:
    """Apply an admin's partial update to an engineer."""
    user, profile, _ = get_engineer(session, user_id)
    changes = payload.model_dump(exclude_unset=True)

    if "specialty_group_ids" in changes and changes["specialty_group_ids"] is not None:
        _require_group_ids(session, changes["specialty_group_ids"])
    if "home_building_id" in changes and changes["home_building_id"] is not None:
        _require_building(session, changes["home_building_id"])

    if "full_name" in changes:
        user.full_name = changes.pop("full_name")

    for field, value in changes.items():
        setattr(profile, field, value)

    session.flush()
    return user, profile, repository.count_active_tickets(session, user.id)


def update_own_profile(
    session: Session,
    user: User,
    payload: EngineerSelfUpdate,
) -> repository.EngineerRow:
    """Apply an engineer's update to their own availability and phone."""
    profile = repository.get_profile(session, user.id)
    if profile is None:
        raise NotFoundError("You do not have an engineer profile.", code="ENGINEER_NOT_FOUND")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)

    session.flush()
    return user, profile, repository.count_active_tickets(session, user.id)


def deactivate_engineer(session: Session, user_id: uuid.UUID) -> DeleteResult:
    """Deactivate an engineer account and end their sessions.

    Never a hard delete: the account is the assignee on past tickets, and an
    audit trail that loses its actors is not one. Revoking the refresh tokens
    closes the window in which an already-signed-in session could keep working
    until its access token expired.
    """
    user, _, _ = get_engineer(session, user_id)

    user.is_active = False
    revoked = user_repository.revoke_all_refresh_tokens(session, user.id)
    session.flush()
    logger.info("Deactivated engineer %s and revoked %d session(s)", user.id, revoked)

    return DeleteResult(
        id=user.id,
        deleted=False,
        deactivated=True,
        detail="Engineer deactivated. Their name stays on the tickets they worked on.",
    )


def _require_group_ids(session: Session, group_ids: list[uuid.UUID]) -> None:
    """Raise `ValidationError` unless every id names a top-level category group.

    Subcategories are rejected on purpose: a specialty covers a whole group, so
    accepting one of its children would promise filtering the assignment rules
    do not perform.
    """
    if not group_ids:
        return

    unique_ids = set(group_ids)
    statement = select(Category.id).where(
        Category.id.in_(unique_ids),
        Category.parent_id.is_(None),
    )
    found = set(session.scalars(statement).all())

    missing = unique_ids - found
    if missing:
        raise ValidationError(
            "Every specialty must be a top-level category group.",
            code="INVALID_SPECIALTY_GROUP",
            field="specialty_group_ids",
        )


def _require_building(session: Session, building_id: uuid.UUID | None) -> None:
    """Raise `ValidationError` when a home building is given but unknown."""
    if building_id is None:
        return
    if session.get(Building, building_id) is None:
        raise ValidationError(
            "That building does not exist.",
            code="BUILDING_NOT_FOUND",
            field="home_building_id",
        )
