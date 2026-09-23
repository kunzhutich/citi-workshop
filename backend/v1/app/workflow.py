"""The incident workflow, written as data.

This module is the single source of truth for what may happen to an incident
and who may make it happen. Three things read it and nothing restates it:

* `services/incident_service.perform_transition` executes a move;
* `GET /api/v1/incidents/{id}/allowed-transitions` tells the frontend which
  buttons to draw and which dialog fields to collect;
* `tests/unit/test_workflow.py` parametrises over `TRANSITIONS` itself, so a
  row added here without a test is not possible.

Because the frontend renders actions *exclusively* from the allowed-transitions
response, adding a transition is a one-row change followed by a test. Nothing
in `routers/`, nothing in the React code.

## How a move is chosen

An incident's status fixes `from_status`, and the caller asks for a
`to_status`. That pair is not always enough: OPEN → CLOSED means "cancel my own
ticket" to the person who reported it and "close this as a duplicate" to an
admin, with different labels, different required input and different recorded
reasons. So several rows may share a (from, to) pair, separated by
`allowed_actors`.

A single user can hold more than one actor role at once — an admin who reported
the ticket is both REPORTER and FACILITY_ADMIN — so `ACTOR_PRECEDENCE` decides
which row wins. It is ordered widest-powers-first: an admin must never end up
with *fewer* options because they also happen to be the reporter.

## Guards

Two rules are conditions on the incident rather than input from the caller:
a ticket cannot be started before it has an assignee, and a closed ticket can
only be reopened for seven days. Those are `guard` functions on the row. They
take `now` as an argument rather than reading the clock, which is what makes
the reopen window testable without waiting a week.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.models.enums import (
    CloseReason,
    EngineerLevel,
    EventType,
    IncidentStatus,
    UserRole,
)
from app.models.incident import Incident
from app.models.user import User


class Actor(StrEnum):
    """The capacity in which a user is acting on one particular incident.

    Not a role: REPORTER and ASSIGNEE are relationships to *this* incident, and
    the same person is a different actor on a different ticket.
    """

    REPORTER = "REPORTER"
    ASSIGNEE = "ASSIGNEE"
    FACILITY_ADMIN = "FACILITY_ADMIN"


#: Which row wins when a caller matches several for the same (from, to) pair.
#: Widest powers first, so being the reporter never costs an admin an option.
#: The consequence worth knowing: an admin who closes a ticket they reported
#: themselves records ADMIN_CLOSED rather than CONFIRMED_FIXED.
ACTOR_PRECEDENCE: tuple[Actor, ...] = (Actor.FACILITY_ADMIN, Actor.ASSIGNEE, Actor.REPORTER)

#: How long after closing a ticket may still be reopened. After this, CLOSED is
#: terminal and the only way forward is a new ticket.
REOPEN_WINDOW = timedelta(days=7)

#: A precondition on the incident itself. Returns None when the move is allowed,
#: or the message to show the caller when it is not.
TransitionGuard = Callable[[Incident, datetime], str | None]


def _requires_an_assignee(incident: Incident, now: datetime) -> str | None:
    """Refuse to start work on a ticket nobody owns."""
    del now
    if incident.assignee_id is None:
        return "Assign this ticket to an engineer before starting work on it."
    return None


def _within_the_reopen_window(incident: Incident, now: datetime) -> str | None:
    """Refuse to reopen a ticket that has been closed for too long."""
    if incident.closed_at is None:
        return None
    if now - incident.closed_at > REOPEN_WINDOW:
        return (
            f"This ticket was closed more than {REOPEN_WINDOW.days} days ago and can no "
            "longer be reopened. Please report a new one."
        )
    return None


@dataclass(frozen=True)
class Transition:
    """One legal move, and everything that follows from making it.

    `required_fields` names fields of the transition request body, so the
    frontend can build the dialog from this list alone and the service can
    validate against it without knowing which transition it is handling.
    """

    from_status: IncidentStatus
    to_status: IncidentStatus
    allowed_actors: frozenset[Actor]
    required_fields: tuple[str, ...]
    action_label: str
    guard: TransitionGuard | None = None
    #: Close reasons this move may record. Exactly one member means the service
    #: writes it automatically; several means the caller picks, and
    #: `close_reason` is then in `required_fields`.
    close_reasons: frozenset[CloseReason] = frozenset()
    is_reopen: bool = False

    @property
    def event_type(self) -> EventType:
        """Return the audit event this move writes."""
        return EventType.REOPENED if self.is_reopen else EventType.STATUS_CHANGED

    @property
    def caller_picks_close_reason(self) -> bool:
        """Return whether the caller has to choose from `close_reasons`."""
        return "close_reason" in self.required_fields

    @property
    def fixed_close_reason(self) -> CloseReason | None:
        """Return the close reason this move records on its own, if any."""
        if self.caller_picks_close_reason or len(self.close_reasons) != 1:
            return None
        return next(iter(self.close_reasons))


#: Every legal move in the workflow. Read the build plan's §6 table alongside
#: this: the two are the same thing, one in prose and one executable.
TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        from_status=IncidentStatus.OPEN,
        to_status=IncidentStatus.IN_PROGRESS,
        allowed_actors=frozenset({Actor.ASSIGNEE, Actor.FACILITY_ADMIN}),
        required_fields=(),
        action_label="Start work",
        guard=_requires_an_assignee,
    ),
    Transition(
        from_status=IncidentStatus.OPEN,
        to_status=IncidentStatus.CLOSED,
        allowed_actors=frozenset({Actor.REPORTER}),
        required_fields=(),
        action_label="Cancel ticket",
        close_reasons=frozenset({CloseReason.CANCELLED_BY_REPORTER}),
    ),
    Transition(
        from_status=IncidentStatus.OPEN,
        to_status=IncidentStatus.CLOSED,
        allowed_actors=frozenset({Actor.FACILITY_ADMIN}),
        required_fields=("close_reason",),
        action_label="Close ticket",
        close_reasons=frozenset(
            {CloseReason.DUPLICATE, CloseReason.INVALID, CloseReason.ADMIN_CLOSED}
        ),
    ),
    Transition(
        from_status=IncidentStatus.IN_PROGRESS,
        to_status=IncidentStatus.BLOCKED,
        allowed_actors=frozenset({Actor.ASSIGNEE, Actor.FACILITY_ADMIN}),
        required_fields=("blocked_reason_type", "blocked_reason"),
        action_label="Mark blocked",
    ),
    Transition(
        from_status=IncidentStatus.BLOCKED,
        to_status=IncidentStatus.IN_PROGRESS,
        allowed_actors=frozenset({Actor.ASSIGNEE, Actor.FACILITY_ADMIN}),
        required_fields=(),
        action_label="Resume work",
    ),
    Transition(
        from_status=IncidentStatus.IN_PROGRESS,
        to_status=IncidentStatus.RESOLVED,
        allowed_actors=frozenset({Actor.ASSIGNEE, Actor.FACILITY_ADMIN}),
        required_fields=("resolution_summary",),
        action_label="Resolve",
    ),
    Transition(
        from_status=IncidentStatus.RESOLVED,
        to_status=IncidentStatus.CLOSED,
        allowed_actors=frozenset({Actor.REPORTER}),
        required_fields=(),
        action_label="Confirm fixed",
        close_reasons=frozenset({CloseReason.CONFIRMED_FIXED}),
    ),
    # The build plan's single "close_reason = CLOSED_BY_ENGINEER or
    # ADMIN_CLOSED" row is two rows here, one per actor. Splitting it keeps the
    # recorded reason a property of the table rather than a conditional in the
    # service, and ACTOR_PRECEDENCE makes the choice between them deterministic.
    Transition(
        from_status=IncidentStatus.RESOLVED,
        to_status=IncidentStatus.CLOSED,
        allowed_actors=frozenset({Actor.ASSIGNEE}),
        required_fields=(),
        action_label="Close ticket",
        close_reasons=frozenset({CloseReason.CLOSED_BY_ENGINEER}),
    ),
    Transition(
        from_status=IncidentStatus.RESOLVED,
        to_status=IncidentStatus.CLOSED,
        allowed_actors=frozenset({Actor.FACILITY_ADMIN}),
        required_fields=(),
        action_label="Close ticket",
        close_reasons=frozenset({CloseReason.ADMIN_CLOSED}),
    ),
    Transition(
        from_status=IncidentStatus.RESOLVED,
        to_status=IncidentStatus.IN_PROGRESS,
        allowed_actors=frozenset({Actor.REPORTER, Actor.FACILITY_ADMIN}),
        required_fields=("reason",),
        action_label="Still broken",
        is_reopen=True,
    ),
    Transition(
        from_status=IncidentStatus.CLOSED,
        to_status=IncidentStatus.IN_PROGRESS,
        allowed_actors=frozenset({Actor.REPORTER, Actor.FACILITY_ADMIN}),
        required_fields=("reason",),
        action_label="Reopen",
        guard=_within_the_reopen_window,
        is_reopen=True,
    ),
)


def resolve_actors(incident: Incident, user: User) -> frozenset[Actor]:
    """Return every capacity in which `user` is acting on `incident`.

    A LEAD engineer counts as ASSIGNEE on any ticket, assigned to them or not:
    leads cover for their team, and a ticket whose assignee is on leave would
    otherwise be stuck until an admin intervened.
    """
    actors: set[Actor] = set()

    if incident.reporter_id == user.id:
        actors.add(Actor.REPORTER)

    if incident.assignee_id == user.id:
        actors.add(Actor.ASSIGNEE)
    elif user.role == UserRole.ENGINEER:
        profile = user.engineer_profile
        if profile is not None and profile.level == EngineerLevel.LEAD:
            actors.add(Actor.ASSIGNEE)

    if user.role == UserRole.FACILITY_ADMIN:
        actors.add(Actor.FACILITY_ADMIN)

    return frozenset(actors)


def select_transition(
    from_status: IncidentStatus,
    to_status: IncidentStatus,
    actors: frozenset[Actor],
) -> Transition | None:
    """Return the row this caller would use for this move, ignoring guards.

    None means the move does not exist for them at all — either no row joins
    the two statuses, or every row that does is for someone else.
    """
    candidates = [
        transition
        for transition in TRANSITIONS
        if transition.from_status == from_status
        and transition.to_status == to_status
        and transition.allowed_actors & actors
    ]
    if not candidates:
        return None
    return _highest_precedence(candidates, actors)


def check_guard(transition: Transition, incident: Incident, now: datetime) -> str | None:
    """Return why this move is blocked right now, or None when it is allowed."""
    if transition.guard is None:
        return None
    return transition.guard(incident, now)


def available_transitions(
    incident: Incident,
    actors: frozenset[Actor],
    now: datetime,
) -> list[Transition]:
    """Return the moves this caller can make on this incident at this moment.

    One entry per reachable status: where several rows share a (from, to) pair,
    `ACTOR_PRECEDENCE` picks the same one `select_transition` would, so the
    button the frontend draws is exactly the move the endpoint will execute.
    Guarded moves that are currently blocked are left out rather than offered
    and then refused.
    """
    available: list[Transition] = []

    for to_status in _reachable_statuses(incident.status):
        transition = select_transition(incident.status, to_status, actors)
        if transition is None:
            continue
        if check_guard(transition, incident, now) is not None:
            continue
        available.append(transition)

    return available


def _reachable_statuses(from_status: IncidentStatus) -> list[IncidentStatus]:
    """Return every status reachable from this one, in table order."""
    reachable: list[IncidentStatus] = []
    for transition in TRANSITIONS:
        if transition.from_status == from_status and transition.to_status not in reachable:
            reachable.append(transition.to_status)
    return reachable


def _highest_precedence(candidates: list[Transition], actors: frozenset[Actor]) -> Transition:
    """Return the candidate matching the caller's most powerful actor role."""
    for actor in ACTOR_PRECEDENCE:
        if actor not in actors:
            continue
        for transition in candidates:
            if actor in transition.allowed_actors:
                return transition

    # Unreachable: every candidate was selected because it matched an actor,
    # and ACTOR_PRECEDENCE lists all three. Raising beats returning something
    # arbitrary if that ever stops being true.
    raise AssertionError("No candidate transition matched the caller's actor roles.")
