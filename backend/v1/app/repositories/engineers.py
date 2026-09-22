"""Queries over engineer accounts and their profiles.

An engineer is two rows — a `User` and its `EngineerProfile` — plus a number
that lives in neither: how much work they currently hold. All three are
selected together here, with the count as a correlated subquery, so a page of
twenty engineers is one statement rather than twenty-one.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models.engineer_profile import EngineerProfile
from app.models.enums import ACTIVE_INCIDENT_STATUSES, AvailabilityStatus, EngineerLevel, UserRole
from app.models.incident import Incident
from app.models.user import User

#: What a query over engineers returns: the account, its profile, and the
#: number of tickets currently assigned to it.
EngineerRow = tuple[User, EngineerProfile, int]


def _active_ticket_count_column() -> Select[tuple[int]]:
    """Build the correlated subquery counting an engineer's live tickets.

    Correlated on `User.id`, so it is evaluated per row of the outer query
    rather than as a separate round trip per engineer.
    """
    return (
        select(func.count(Incident.id))
        .where(
            Incident.assignee_id == User.id,
            Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
        )
        .correlate(User)
        .scalar_subquery()
    )


def list_engineers(
    session: Session,
    *,
    include_inactive: bool,
    availability: AvailabilityStatus | None,
    level: EngineerLevel | None,
    group_id: uuid.UUID | None,
    building_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[Sequence[EngineerRow], int]:
    """Return one page of engineers with their workload, and the total count."""
    statement = (
        select(User, EngineerProfile, _active_ticket_count_column())
        .join(EngineerProfile, EngineerProfile.user_id == User.id)
        .where(User.role == UserRole.ENGINEER)
    )

    if not include_inactive:
        statement = statement.where(User.is_active)
    if availability is not None:
        statement = statement.where(EngineerProfile.availability == availability)
    if level is not None:
        statement = statement.where(EngineerProfile.level == level)
    if group_id is not None:
        # PostgreSQL's array containment: the engineer's specialty list must
        # include this group. A group covers all of its subcategories.
        statement = statement.where(EngineerProfile.specialty_group_ids.contains([group_id]))
    if building_id is not None:
        statement = statement.where(EngineerProfile.home_building_id == building_id)

    total = session.scalars(select(func.count()).select_from(statement.subquery())).one()
    rows = session.execute(statement.order_by(User.full_name).limit(limit).offset(offset)).all()
    return [(user, profile, count) for user, profile, count in rows], total


def get_engineer(session: Session, user_id: uuid.UUID) -> EngineerRow | None:
    """Return one engineer with their workload, or None.

    Returns None for a user who has no profile, or whose role is not ENGINEER —
    an account demoted to EMPLOYEE keeps its profile row so a later promotion
    restores the level and specialties, but it is not an engineer today.
    """
    statement = (
        select(User, EngineerProfile, _active_ticket_count_column())
        .join(EngineerProfile, EngineerProfile.user_id == User.id)
        .where(User.id == user_id, User.role == UserRole.ENGINEER)
    )
    row = session.execute(statement).one_or_none()
    if row is None:
        return None
    user, profile, count = row
    return user, profile, count


def count_active_tickets(session: Session, user_id: uuid.UUID) -> int:
    """Return how many live tickets are assigned to this user."""
    statement = select(func.count(Incident.id)).where(
        Incident.assignee_id == user_id,
        Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
    )
    return session.scalars(statement).one()


def add_profile(session: Session, profile: EngineerProfile) -> EngineerProfile:
    """Insert an engineer profile."""
    session.add(profile)
    session.flush()
    return profile


def get_profile(session: Session, user_id: uuid.UUID) -> EngineerProfile | None:
    """Return a user's engineer profile, whatever their current role."""
    return session.get(EngineerProfile, user_id)
