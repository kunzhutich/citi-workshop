"""Who may give a ticket to whom.

The matrix, in one place, is:

| Caller | May assign |
| --- | --- |
| Employee | nobody |
| JUNIOR engineer | nobody — work comes to them from a lead or an admin |
| SENIOR engineer | themselves, to an unassigned OPEN ticket |
| LEAD engineer | anyone, to any ticket that is not CLOSED |
| Facility admin | anyone, to any ticket that is not CLOSED |

Two design decisions worth stating.

**Capacity and availability warn, they do not refuse.** Assigning a ticket to
someone who is at their limit or marked OFF_DUTY succeeds and returns
`warnings`. A lead looking at their team knows things the system does not, and
a rule that blocks them would be worked around by raising `max_active_tickets`
— which would then be wrong permanently instead of noisy once.

**Unassigning is an assignment to nobody.** It goes through the same
permission check and writes an UNASSIGNED event, so there is no second path
that could drift from the first.
"""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import AuthorizationError, ValidationError
from app.models.engineer_profile import EngineerProfile
from app.models.enums import AvailabilityStatus, EngineerLevel, EventType, IncidentStatus, UserRole
from app.models.incident import Incident
from app.models.user import User
from app.repositories import engineers as engineer_repository
from app.repositories import incidents as repository

#: Availability states that mean "not taking work right now". Assigning to
#: someone in one of these warns rather than fails.
UNAVAILABLE_STATES: frozenset[AvailabilityStatus] = frozenset(
    {AvailabilityStatus.BUSY, AvailabilityStatus.OFF_DUTY, AvailabilityStatus.ON_LEAVE}
)


def can_assign(incident: Incident, user: User) -> bool:
    """Return whether this user may change this ticket's assignee at all.

    "At all" is the point: a SENIOR engineer passes this on an unassigned OPEN
    ticket because they may pick it up, even though they may not hand it to
    anyone else. `assign` enforces the narrower rule; this drives the presence
    of the button.
    """
    if incident.status == IncidentStatus.CLOSED:
        return False

    if user.role == UserRole.FACILITY_ADMIN:
        return True

    if user.role != UserRole.ENGINEER:
        return False

    profile = user.engineer_profile
    if profile is None:
        return False
    if profile.level == EngineerLevel.LEAD:
        return True
    if profile.level == EngineerLevel.SENIOR:
        return _is_free_to_pick_up(incident)
    return False


def assign(
    session: Session,
    *,
    incident: Incident,
    actor: User,
    assignee_id: uuid.UUID | None,
    now: datetime | None = None,
) -> list[str]:
    """Set or clear an incident's assignee, returning advisory warnings.

    Raises `AuthorizationError` when the caller may not make this particular
    assignment, and `ValidationError` when the target is not an assignable
    engineer. The caller commits.
    """
    _require_permission(incident, actor, assignee_id)

    if assignee_id is None:
        return _unassign(session, incident=incident, actor=actor)

    if incident.assignee_id == assignee_id:
        # Not an error, but nothing happened either: writing an ASSIGNED event
        # for a no-op would put a misleading entry on the timeline.
        return []

    assignee, profile = _require_assignable_engineer(session, assignee_id)
    previous_assignee_id = incident.assignee_id

    incident.assignee_id = assignee.id
    # Set once and never overwritten: `assigned_at` answers "how long did this
    # ticket wait for an owner?", which a reassignment does not change.
    if incident.assigned_at is None:
        incident.assigned_at = now or utc_now()

    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=actor.id,
        event_type=EventType.ASSIGNED,
        from_value=str(previous_assignee_id) if previous_assignee_id else None,
        to_value=str(assignee.id),
    )
    session.flush()

    return _capacity_warnings(session, assignee=assignee, profile=profile)


def _unassign(session: Session, *, incident: Incident, actor: User) -> list[str]:
    """Clear an incident's assignee and record it."""
    if incident.assignee_id is None:
        return []

    previous_assignee_id = incident.assignee_id
    incident.assignee_id = None
    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=actor.id,
        event_type=EventType.UNASSIGNED,
        from_value=str(previous_assignee_id),
    )
    session.flush()
    return []


def _require_permission(incident: Incident, actor: User, assignee_id: uuid.UUID | None) -> None:
    """Raise unless this caller may make this specific assignment."""
    if incident.status == IncidentStatus.CLOSED:
        raise AuthorizationError(
            "A closed ticket cannot be assigned. Reopen it first.",
            code="INCIDENT_CLOSED",
        )

    if actor.role == UserRole.FACILITY_ADMIN:
        return

    if actor.role != UserRole.ENGINEER:
        raise AuthorizationError(
            "Only engineers and facility admins can assign tickets.",
            code="ASSIGN_NOT_PERMITTED",
        )

    profile = actor.engineer_profile
    level = profile.level if profile is not None else None

    if level == EngineerLevel.LEAD:
        return

    if level == EngineerLevel.SENIOR:
        _require_self_pick_up(incident, actor, assignee_id)
        return

    raise AuthorizationError(
        "Junior engineers are assigned work by their lead or a facility admin.",
        code="ASSIGN_NOT_PERMITTED",
    )


def _require_self_pick_up(incident: Incident, actor: User, assignee_id: uuid.UUID | None) -> None:
    """Raise unless a senior engineer is picking up a free ticket for themselves."""
    if assignee_id != actor.id:
        raise AuthorizationError(
            "Senior engineers can pick up tickets for themselves, but only a lead "
            "or a facility admin can assign them to someone else.",
            code="ASSIGN_OTHERS_NOT_PERMITTED",
        )
    if not _is_free_to_pick_up(incident):
        raise AuthorizationError(
            "Only unassigned tickets that are still open can be picked up.",
            code="INCIDENT_NOT_AVAILABLE",
        )


def _is_free_to_pick_up(incident: Incident) -> bool:
    """Return whether a ticket is unassigned and still OPEN."""
    return incident.status == IncidentStatus.OPEN and incident.assignee_id is None


def _require_assignable_engineer(
    session: Session,
    assignee_id: uuid.UUID,
) -> tuple[User, EngineerProfile]:
    """Return the target engineer and profile, or raise.

    422 rather than 404: the id came from a request body as a *value*, and the
    thing that does not exist is the choice the caller made, not the resource
    they addressed.
    """
    row = engineer_repository.get_engineer(session, assignee_id)
    if row is None:
        raise ValidationError(
            "Tickets can only be assigned to an engineer.",
            code="ASSIGNEE_NOT_ENGINEER",
            field="assignee_id",
        )

    user, profile, _ = row
    if not user.is_active:
        raise ValidationError(
            "That engineer's account is deactivated.",
            code="ASSIGNEE_INACTIVE",
            field="assignee_id",
        )
    return user, profile


def _capacity_warnings(
    session: Session,
    *,
    assignee: User,
    profile: EngineerProfile,
) -> list[str]:
    """Return advisory messages about the engineer who was just given the work."""
    warnings: list[str] = []

    if profile.availability in UNAVAILABLE_STATES:
        state = profile.availability.value.replace("_", " ").lower()
        warnings.append(f"{assignee.full_name} is marked {state}.")

    active = engineer_repository.count_active_tickets(session, assignee.id)
    if active >= profile.max_active_tickets:
        warnings.append(
            f"{assignee.full_name} now has {active} active ticket(s), at or over their "
            f"limit of {profile.max_active_tickets}."
        )

    return warnings
