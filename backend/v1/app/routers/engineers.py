"""Engineer endpoints.

Engineers and admins can read the roster — the Team page and the assign dialog
both need it. Only admins create, edit or deactivate; the one exception is
`PATCH /engineers/me`, where an engineer sets their own availability and phone.

`/engineers/me` is declared **before** `/engineers/{user_id}`. FastAPI matches
routes in declaration order, so the other way round `me` would be parsed as a
user id and fail as a malformed UUID.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.models.enums import AvailabilityStatus, EngineerLevel, UserRole
from app.models.user import User
from app.repositories.engineers import EngineerRow
from app.schemas.common import DeleteResult, Page, Paging, build_page
from app.schemas.engineer import (
    EngineerCreate,
    EngineerCreated,
    EngineerRead,
    EngineerSelfUpdate,
    EngineerUpdate,
)
from app.security.dependencies import (
    ADMIN_ONLY,
    STAFF_ONLY,
    DbSession,
    IncludeInactive,
    require_roles,
)
from app.services import engineers as service

router = APIRouter(prefix="/engineers", tags=["engineers"])

AvailabilityFilter = Annotated[
    AvailabilityStatus | None,
    Query(description="Only engineers currently in this availability state."),
]
LevelFilter = Annotated[EngineerLevel | None, Query(description="Only engineers at this level.")]
GroupFilter = Annotated[
    uuid.UUID | None,
    Query(description="Only engineers whose specialties include this category group."),
]
BuildingFilter = Annotated[
    uuid.UUID | None,
    Query(description="Only engineers whose home building is this one."),
]

#: The caller, required to be an engineer. Admins edit an engineer through
#: `PATCH /engineers/{user_id}`; they have no profile of their own to change.
EngineerSelf = Annotated[User, Depends(require_roles(UserRole.ENGINEER))]


@router.get(
    "",
    response_model=Page[EngineerRead],
    dependencies=[STAFF_ONLY],
    summary="List engineers with their workload",
)
def list_engineers(
    session: DbSession,
    paging: Paging,
    include_inactive: IncludeInactive,
    availability: AvailabilityFilter = None,
    level: LevelFilter = None,
    group_id: GroupFilter = None,
    building_id: BuildingFilter = None,
) -> Page[EngineerRead]:
    """Return one page of engineers, ordered by name.

    Every row carries `active_ticket_count`, computed in SQL, which is what the
    Team page's capacity bar and the assign dialog's ordering are built from.
    """
    rows, total = service.list_engineers(
        session,
        include_inactive=include_inactive,
        availability=availability,
        level=level,
        group_id=group_id,
        building_id=building_id,
        paging=paging,
    )
    return build_page([_to_read(row) for row in rows], total=total, params=paging)


@router.post(
    "",
    response_model=EngineerCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Create an engineer account",
)
def create_engineer(payload: EngineerCreate, session: DbSession) -> EngineerCreated:
    """Create the account and its profile, and return a temporary password.

    The password appears in this response and nowhere else — it is stored only
    as a bcrypt hash — and the account must change it at first sign-in.
    """
    row, temporary_password = service.create_engineer(session, payload)
    session.commit()
    return EngineerCreated(engineer=_to_read(row), temporary_password=temporary_password)


@router.patch(
    "/me",
    response_model=EngineerRead,
    summary="Update your own availability and phone",
)
def update_own_profile(
    payload: EngineerSelfUpdate,
    session: DbSession,
    engineer: EngineerSelf,
) -> EngineerRead:
    """Set the caller's availability or phone number. Nothing else is theirs to change."""
    row = service.update_own_profile(session, engineer, payload)
    session.commit()
    return _to_read(row)


@router.get(
    "/{user_id}",
    response_model=EngineerRead,
    dependencies=[STAFF_ONLY],
    summary="Get one engineer",
)
def get_engineer(user_id: uuid.UUID, session: DbSession) -> EngineerRead:
    """Return one engineer with their current workload."""
    return _to_read(service.get_engineer(session, user_id))


@router.patch(
    "/{user_id}",
    response_model=EngineerRead,
    dependencies=[ADMIN_ONLY],
    summary="Update an engineer",
)
def update_engineer(
    user_id: uuid.UUID,
    payload: EngineerUpdate,
    session: DbSession,
) -> EngineerRead:
    """Change level, specialties, home building, capacity, name or availability."""
    row = service.update_engineer(session, user_id, payload)
    session.commit()
    return _to_read(row)


@router.delete(
    "/{user_id}",
    response_model=DeleteResult,
    dependencies=[ADMIN_ONLY],
    summary="Deactivate an engineer",
)
def deactivate_engineer(user_id: uuid.UUID, session: DbSession) -> DeleteResult:
    """Deactivate the account and revoke its sessions.

    Never a hard delete: the engineer is the assignee on tickets that have to
    keep making sense.
    """
    result = service.deactivate_engineer(session, user_id)
    session.commit()
    return result


def _to_read(row: EngineerRow) -> EngineerRead:
    """Flatten a (user, profile, count) row into the response model."""
    user, profile, active_ticket_count = row
    return EngineerRead(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        level=profile.level,
        specialty_group_ids=list(profile.specialty_group_ids),
        home_building_id=profile.home_building_id,
        phone=profile.phone,
        availability=profile.availability,
        max_active_tickets=profile.max_active_tickets,
        active_ticket_count=active_ticket_count,
    )
