"""Everything an incident is allowed to do, and who is allowed to do it.

This module owns four groups of rules.

**Creation.** The report questionnaire (build plan §7) asks for a subcategory
and then asks for a location whose precision depends on that subcategory's
group. Both are checked here, as 422s with a `field`, so the form can attach
each message to the input that caused it. The frontend enforces the same rules
for a good experience; this enforces them for correctness.

**Editing.** Permissions are per *field group*, not per request: a reporter may
re-prioritise their own OPEN ticket long after they have stopped being allowed
to rewrite its description.

**Transitions.** Nothing about the state machine is decided here — that is
`app/workflow.py`. What happens here is the part a table cannot express:
checking the required fields the row names, writing the timestamps, and
appending the audit event.

**Escalation.** A reporter's way of saying "this matters more than its priority
suggests", and an admin's way of answering.

Every function that reads the clock takes `now` instead, defaulting to
`app.clock.utc_now()`. That is what makes the 7-day reopen window testable.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import workflow
from app.clock import utc_now
from app.errors import AuthorizationError, ConflictError, NotFoundError, ValidationError
from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    CloseReason,
    EventType,
    IncidentStatus,
    LocationDetail,
    UserRole,
)
from app.models.event import IncidentEvent
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.seat import Seat
from app.models.user import User
from app.repositories import incidents as repository
from app.schemas.common import PageParams
from app.schemas.incident import (
    ClearEscalationRequest,
    EscalateRequest,
    IncidentCreate,
    IncidentFilters,
    IncidentQuery,
    IncidentUpdate,
    MineFilter,
    TransitionRequest,
)
from app.services import notes as note_service
from app.services.visibility import apply_incident_visibility
from app.workflow import Transition

#: Fields of `IncidentUpdate` that describe what the problem is and where it
#: is. They share one permission; `priority` has its own.
CONTENT_FIELDS: frozenset[str] = frozenset(
    {"title", "description", "category_id", "building_id", "floor_id", "seat_id"}
)

#: The subset of those that has to be re-checked against the questionnaire
#: rules. Narrower than `CONTENT_FIELDS` on purpose: re-validating on a
#: title-only edit would mean a ticket whose category group was later given a
#: stricter `location_detail` could no longer have its typos fixed, because
#: every edit would fail on a location that was legal when it was reported.
CLASSIFICATION_FIELDS: frozenset[str] = frozenset(
    {"category_id", "building_id", "floor_id", "seat_id"}
)

#: The statuses in which escalating still means something. A resolved or closed
#: ticket does not need to be flagged as urgent; it needs to be reopened.
ESCALATABLE_STATUSES: tuple[IncidentStatus, ...] = (
    IncidentStatus.OPEN,
    IncidentStatus.IN_PROGRESS,
    IncidentStatus.BLOCKED,
)

#: Which location fields a category group requires. The questionnaire reads the
#: same value off the group to decide which inputs to show.
REQUIRED_LOCATION_FIELDS: dict[LocationDetail, tuple[str, ...]] = {
    LocationDetail.BUILDING: (),
    LocationDetail.FLOOR: ("floor_id",),
    LocationDetail.SEAT: ("floor_id", "seat_id"),
}


# --- Reading -----------------------------------------------------------------


def get_incident(session: Session, incident_id: uuid.UUID) -> Incident:
    """Return one incident with everything the detail page needs, or raise 404."""
    incident = repository.get(session, incident_id)
    if incident is None:
        raise NotFoundError("That ticket does not exist.", code="INCIDENT_NOT_FOUND")
    return incident


def list_incidents(
    session: Session,
    *,
    user: User,
    query: IncidentQuery,
    paging: PageParams,
) -> tuple[Sequence[Incident], int]:
    """Return one page of incidents this user may see, matching their filters."""
    filters = resolve_filters(query, user)
    visible = apply_incident_visibility(select(Incident), user)
    return repository.list_incidents(
        session,
        visible=visible,
        filters=filters,
        limit=paging.page_size,
        offset=paging.offset,
    )


def resolve_filters(query: IncidentQuery, user: User) -> IncidentFilters:
    """Turn the caller-relative shortcuts in a query into concrete filters.

    `mine` and `specialty` mean different rows for different people, so they
    are resolved once, here, rather than in the repository — which then never
    needs to know who is asking.
    """
    reporter_id = query.reporter_id
    assignee_id = query.assignee_id

    if query.mine == MineFilter.REPORTED:
        reporter_id = user.id
    elif query.mine == MineFilter.ASSIGNED:
        assignee_id = user.id

    return IncidentFilters(
        q=query.q,
        statuses=query.statuses,
        priorities=query.priorities,
        group_id=query.group_id,
        category_id=query.category_id,
        building_id=query.building_id,
        floor_id=query.floor_id,
        seat_id=query.seat_id,
        assignee_id=assignee_id,
        reporter_id=reporter_id,
        is_escalated=query.is_escalated,
        created_from=query.created_from,
        created_to=query.created_to,
        specialty_group_ids=_resolve_specialties(query, user),
        sort=query.sort,
    )


def _resolve_specialties(query: IncidentQuery, user: User) -> list[uuid.UUID] | None:
    """Return the caller's specialty groups when `specialty=true` was asked for.

    An engineer with no specialties set gets an empty list, which matches no
    incidents at all. That is the honest answer to "tickets in my specialties"
    and it is visible immediately, unlike silently returning everything.
    """
    if not query.specialty:
        return None

    profile = user.engineer_profile
    if user.role != UserRole.ENGINEER or profile is None:
        raise ValidationError(
            "'specialty' filters by the caller's own specialty groups, which only "
            "engineers have.",
            code="SPECIALTY_NOT_APPLICABLE",
            field="specialty",
        )
    return list(profile.specialty_group_ids)


def load_activity(
    session: Session,
    *,
    incident: Incident,
    user: User,
) -> list[IncidentEvent | IncidentNote]:
    """Return the incident's events and readable notes as one timeline.

    Merged in Python rather than with a SQL `UNION`: the two tables have
    almost no columns in common, so a union would mean padding both sides with
    nulls to make the shapes match, and the result is a page of a single
    ticket's history — tens of rows, not thousands.
    """
    events = repository.list_events(session, incident.id)
    notes = note_service.list_notes(session, incident=incident, user=user)

    timeline: list[IncidentEvent | IncidentNote] = [*events, *notes]
    timeline.sort(key=lambda entry: entry.created_at)
    return timeline


# --- Permissions -------------------------------------------------------------


def can_edit_content(incident: Incident, user: User) -> bool:
    """Return whether this user may change what the ticket says and where it is.

    A reporter's window closes as soon as someone picks the ticket up: an
    engineer who has started work on "monitor flickering" should not find it
    has become "chair broken" on a different floor.
    """
    if user.role == UserRole.FACILITY_ADMIN:
        return True
    if incident.reporter_id != user.id:
        return False
    return incident.status == IncidentStatus.OPEN and incident.assignee_id is None


def can_change_priority(incident: Incident, user: User) -> bool:
    """Return whether this user may change the ticket's priority.

    Wider than `can_edit_content` for a reporter — it survives assignment —
    because "this got worse" is worth hearing after work has started, and
    changing it costs an engineer nothing.
    """
    if user.role == UserRole.FACILITY_ADMIN:
        return True
    if incident.reporter_id != user.id:
        return False
    return incident.status == IncidentStatus.OPEN


def may_escalate(incident: Incident, user: User) -> bool:
    """Return whether this user could escalate this ticket if it were not already."""
    if incident.status not in ESCALATABLE_STATUSES:
        return False
    return user.role == UserRole.FACILITY_ADMIN or incident.reporter_id == user.id


def can_escalate(incident: Incident, user: User) -> bool:
    """Return whether this user may raise an escalation right now."""
    return not incident.is_escalated and may_escalate(incident, user)


def can_clear_escalation(incident: Incident, user: User) -> bool:
    """Return whether this user may clear the current escalation."""
    return incident.is_escalated and user.role == UserRole.FACILITY_ADMIN


# --- Creation ----------------------------------------------------------------


def create_incident(session: Session, *, reporter: User, payload: IncidentCreate) -> Incident:
    """Create an incident from a completed report form. The caller commits."""
    category = _require_reportable_subcategory(session, payload.category_id)
    building, floor, seat = _require_valid_location(
        session,
        category=category,
        building_id=payload.building_id,
        floor_id=payload.floor_id,
        seat_id=payload.seat_id,
    )

    incident = repository.add(
        session,
        Incident(
            title=payload.title,
            description=payload.description,
            category_id=category.id,
            building_id=building.id,
            floor_id=floor.id if floor is not None else None,
            seat_id=seat.id if seat is not None else None,
            priority=payload.priority,
            reporter_id=reporter.id,
        ),
    )

    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=reporter.id,
        event_type=EventType.CREATED,
        to_value=IncidentStatus.OPEN.value,
    )

    _remember_location(reporter, building=building, floor=floor, seat=seat)
    return repository.reload(session, incident)


def _remember_location(
    reporter: User,
    *,
    building: Building,
    floor: Floor | None,
    seat: Seat | None,
) -> None:
    """Record where this user last reported from, to pre-fill the next form.

    Stored as three plain columns rather than derived from their last incident
    so that the pre-fill survives the ticket being closed, reassigned or —
    once per-building admins exist — moved out of their view.
    """
    reporter.last_building_id = building.id
    reporter.last_floor_id = floor.id if floor is not None else None
    reporter.last_seat_id = seat.id if seat is not None else None


# --- Editing -----------------------------------------------------------------


def update_incident(
    session: Session,
    *,
    incident: Incident,
    user: User,
    payload: IncidentUpdate,
) -> Incident:
    """Apply a partial edit, checking each field group. The caller commits."""
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return incident

    if CONTENT_FIELDS & changes.keys() and not can_edit_content(incident, user):
        raise AuthorizationError(
            "This ticket can only be edited by its reporter while it is still open "
            "and unassigned, or by a facility admin.",
            code="EDIT_NOT_PERMITTED",
        )

    if "priority" in changes and not can_change_priority(incident, user):
        raise AuthorizationError(
            "Only the reporter of an open ticket or a facility admin can change its priority.",
            code="PRIORITY_CHANGE_NOT_PERMITTED",
        )

    if CLASSIFICATION_FIELDS & changes.keys():
        _revalidate_classification(session, incident=incident, changes=changes)

    previous_priority = incident.priority
    for field, value in changes.items():
        setattr(incident, field, value)

    if "priority" in changes and incident.priority != previous_priority:
        repository.add_event(
            session,
            incident_id=incident.id,
            actor_id=user.id,
            event_type=EventType.PRIORITY_CHANGED,
            from_value=previous_priority.value,
            to_value=incident.priority.value,
        )

    return repository.reload(session, incident)


def _revalidate_classification(
    session: Session,
    *,
    incident: Incident,
    changes: dict[str, object],
) -> None:
    """Re-check the category and location as a whole after a partial edit.

    The merged result is what matters: moving a ticket to a SEAT-level group
    without also giving it a seat has to fail, even though neither change is
    wrong on its own.
    """
    category_id = changes.get("category_id", incident.category_id)
    category = _require_reportable_subcategory(session, _as_uuid(category_id))

    _require_valid_location(
        session,
        category=category,
        building_id=_as_uuid(changes.get("building_id", incident.building_id)),
        floor_id=_as_optional_uuid(changes.get("floor_id", incident.floor_id)),
        seat_id=_as_optional_uuid(changes.get("seat_id", incident.seat_id)),
    )


def _as_uuid(value: object) -> uuid.UUID:
    """Narrow a merged change value that must be a UUID."""
    if not isinstance(value, uuid.UUID):  # pragma: no cover - schema guarantees the type
        raise ValidationError("Expected an id.", code="INVALID_ID")
    return value


def _as_optional_uuid(value: object) -> uuid.UUID | None:
    """Narrow a merged change value that may be a UUID or absent."""
    if value is None:
        return None
    return _as_uuid(value)


# --- Classification and location rules ---------------------------------------


def _require_reportable_subcategory(session: Session, category_id: uuid.UUID) -> Category:
    """Return the subcategory a ticket may be filed under, or raise 422.

    Groups are rejected because they are the *question* in the questionnaire's
    first step, not an answer: "Hardware" is not a problem, "Monitor" is. That
    also keeps every report drillable in the category report.
    """
    category = session.get(Category, category_id)
    if category is None:
        raise ValidationError(
            "That category does not exist.",
            code="CATEGORY_NOT_FOUND",
            field="category_id",
        )
    if category.is_group:
        raise ValidationError(
            "Choose a specific subcategory, not a category group.",
            code="CATEGORY_NOT_SUBCATEGORY",
            field="category_id",
        )
    if not category.is_active:
        raise ValidationError(
            "That category is no longer in use.",
            code="CATEGORY_INACTIVE",
            field="category_id",
        )
    return category


def _require_valid_location(
    session: Session,
    *,
    category: Category,
    building_id: uuid.UUID,
    floor_id: uuid.UUID | None,
    seat_id: uuid.UUID | None,
) -> tuple[Building, Floor | None, Seat | None]:
    """Return the location a ticket points at, or raise 422.

    Two separate checks. *Precision*: the category group's `location_detail`
    says how far down the tree the reporter has to go. *Consistency*: a floor
    has to be in the building and a seat has to be on the floor, or the
    location path rendered on every screen would be a lie.
    """
    building = session.get(Building, building_id)
    if building is None:
        raise ValidationError(
            "That building does not exist.", code="BUILDING_NOT_FOUND", field="building_id"
        )
    if not building.is_active:
        raise ValidationError(
            "That building is no longer in use.", code="BUILDING_INACTIVE", field="building_id"
        )

    _require_location_precision(category, floor_id=floor_id, seat_id=seat_id)

    floor = _require_floor_in_building(session, floor_id=floor_id, building=building)
    seat = _require_seat_on_floor(session, seat_id=seat_id, floor=floor)
    return building, floor, seat


def _require_location_precision(
    category: Category,
    *,
    floor_id: uuid.UUID | None,
    seat_id: uuid.UUID | None,
) -> None:
    """Raise unless the report is as precise as its category group demands."""
    supplied = {"floor_id": floor_id, "seat_id": seat_id}

    for field in REQUIRED_LOCATION_FIELDS[category.location_detail]:
        if supplied[field] is None:
            raise ValidationError(
                _missing_location_message(category.location_detail, field),
                code="LOCATION_TOO_VAGUE",
                field=field,
            )

    # A seat without a floor cannot be checked for consistency, and would
    # render as a path with a hole in it.
    if seat_id is not None and floor_id is None:
        raise ValidationError(
            "Choose the floor this seat or room is on.",
            code="FLOOR_REQUIRED_WITH_SEAT",
            field="floor_id",
        )


def _missing_location_message(detail: LocationDetail, field: str) -> str:
    """Return the message for a location that is not precise enough."""
    if field == "seat_id":
        return "This kind of issue needs the exact desk or room."
    if detail == LocationDetail.SEAT:
        return "This kind of issue needs the floor as well as the desk or room."
    return "This kind of issue needs the floor it happened on."


def _require_floor_in_building(
    session: Session,
    *,
    floor_id: uuid.UUID | None,
    building: Building,
) -> Floor | None:
    """Return the floor, checking it exists, is in use, and is in this building."""
    if floor_id is None:
        return None

    floor = session.get(Floor, floor_id)
    if floor is None:
        raise ValidationError(
            "That floor does not exist.", code="FLOOR_NOT_FOUND", field="floor_id"
        )
    if not floor.is_active:
        raise ValidationError(
            "That floor is no longer in use.", code="FLOOR_INACTIVE", field="floor_id"
        )
    if floor.building_id != building.id:
        raise ValidationError(
            f"That floor is not in {building.name}.",
            code="FLOOR_NOT_IN_BUILDING",
            field="floor_id",
        )
    return floor


def _require_seat_on_floor(
    session: Session,
    *,
    seat_id: uuid.UUID | None,
    floor: Floor | None,
) -> Seat | None:
    """Return the seat, checking it exists, is in use, and is on this floor."""
    if seat_id is None:
        return None
    if floor is None:  # pragma: no cover - _require_location_precision rejects this first
        raise ValidationError(
            "Choose the floor this seat or room is on.",
            code="FLOOR_REQUIRED_WITH_SEAT",
            field="floor_id",
        )

    seat = session.get(Seat, seat_id)
    if seat is None:
        raise ValidationError("That seat does not exist.", code="SEAT_NOT_FOUND", field="seat_id")
    if not seat.is_active:
        raise ValidationError(
            "That seat is no longer in use.", code="SEAT_INACTIVE", field="seat_id"
        )
    if seat.floor_id != floor.id:
        raise ValidationError(
            f"That desk or room is not on {floor.name}.",
            code="SEAT_NOT_ON_FLOOR",
            field="seat_id",
        )
    return seat


# --- Transitions -------------------------------------------------------------


def allowed_transitions(
    incident: Incident,
    user: User,
    *,
    now: datetime | None = None,
) -> list[Transition]:
    """Return the workflow moves this user can make on this incident right now."""
    actors = workflow.resolve_actors(incident, user)
    return workflow.available_transitions(incident, actors, now or utc_now())


def perform_transition(
    session: Session,
    *,
    incident: Incident,
    user: User,
    payload: TransitionRequest,
    now: datetime | None = None,
) -> Incident:
    """Move an incident to another status. The caller commits.

    Nothing here decides *whether* the move is legal — `app/workflow.py` does,
    and this raises 409 carrying the moves that are legal so a client never has
    to guess.
    """
    moment = now or utc_now()
    actors = workflow.resolve_actors(incident, user)

    transition = workflow.select_transition(incident.status, payload.to_status, actors)
    if transition is None:
        raise ConflictError(
            f"A ticket that is {incident.status.value} cannot be moved to "
            f"{payload.to_status.value} by you.",
            code="TRANSITION_NOT_ALLOWED",
            extra={"allowed_transitions": _describe(incident, actors, moment)},
        )

    blocked = workflow.check_guard(transition, incident, moment)
    if blocked is not None:
        raise ConflictError(
            blocked,
            code="TRANSITION_BLOCKED",
            extra={"allowed_transitions": _describe(incident, actors, moment)},
        )

    _require_transition_fields(transition, payload)
    close_reason = _resolve_close_reason(transition, payload)
    duplicate_of = _resolve_duplicate_target(session, incident, payload, close_reason)

    previous_status = incident.status
    _apply_transition_effects(
        incident,
        transition=transition,
        payload=payload,
        close_reason=close_reason,
        duplicate_of=duplicate_of,
        now=moment,
    )

    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=user.id,
        event_type=transition.event_type,
        from_value=previous_status.value,
        to_value=transition.to_status.value,
        reason=payload.reason,
    )

    if duplicate_of is not None:
        repository.add_event(
            session,
            incident_id=incident.id,
            actor_id=user.id,
            event_type=EventType.MARKED_DUPLICATE,
            to_value=str(duplicate_of.id),
            reason=f"Duplicate of {duplicate_of.reference}.",
        )

    return repository.reload(session, incident)


def _describe(
    incident: Incident,
    actors: frozenset[workflow.Actor],
    now: datetime,
) -> list[dict[str, object]]:
    """Render the moves still available, for the body of a 409."""
    return [
        {
            "to_status": transition.to_status.value,
            "action_label": transition.action_label,
            "required_fields": list(transition.required_fields),
        }
        for transition in workflow.available_transitions(incident, actors, now)
    ]


def _require_transition_fields(transition: Transition, payload: TransitionRequest) -> None:
    """Raise 422 unless every field this transition names was supplied."""
    for field in transition.required_fields:
        if getattr(payload, field, None) is None:
            raise ValidationError(
                f"'{field}' is required to {transition.action_label.lower()}.",
                code="TRANSITION_FIELD_REQUIRED",
                field=field,
            )


def _resolve_close_reason(
    transition: Transition,
    payload: TransitionRequest,
) -> CloseReason | None:
    """Return the close reason this move records, validating a caller's choice."""
    if transition.to_status != IncidentStatus.CLOSED:
        return None

    if not transition.caller_picks_close_reason:
        return transition.fixed_close_reason

    if payload.close_reason not in transition.close_reasons:
        allowed = ", ".join(sorted(reason.value for reason in transition.close_reasons))
        raise ValidationError(
            f"'close_reason' must be one of: {allowed}.",
            code="INVALID_CLOSE_REASON",
            field="close_reason",
        )
    return payload.close_reason


def _resolve_duplicate_target(
    session: Session,
    incident: Incident,
    payload: TransitionRequest,
    close_reason: CloseReason | None,
) -> Incident | None:
    """Return the ticket this one duplicates, when closing as DUPLICATE."""
    if close_reason != CloseReason.DUPLICATE:
        return None

    if payload.duplicate_of_id is None:
        raise ValidationError(
            "Say which ticket this one duplicates.",
            code="DUPLICATE_TARGET_REQUIRED",
            field="duplicate_of_id",
        )
    if payload.duplicate_of_id == incident.id:
        raise ValidationError(
            "A ticket cannot be a duplicate of itself.",
            code="DUPLICATE_OF_SELF",
            field="duplicate_of_id",
        )

    original = repository.get_bare(session, payload.duplicate_of_id)
    if original is None:
        raise ValidationError(
            "That ticket does not exist.",
            code="DUPLICATE_TARGET_NOT_FOUND",
            field="duplicate_of_id",
        )
    return original


def _apply_transition_effects(
    incident: Incident,
    *,
    transition: Transition,
    payload: TransitionRequest,
    close_reason: CloseReason | None,
    duplicate_of: Incident | None,
    now: datetime,
) -> None:
    """Write the state a transition implies, keyed on the status being entered.

    Deliberately written as "what it means to *be* in this status" rather than
    per transition. Entering IN_PROGRESS clears the resolution and closure
    fields whether it was reached by starting work, resuming after a block, or
    reopening — so a reopened ticket cannot keep a `closed_at` that the reports
    would then count.
    """
    incident.status = transition.to_status

    if transition.to_status == IncidentStatus.IN_PROGRESS:
        incident.acknowledged_at = incident.acknowledged_at or now
        incident.resolved_at = None
        incident.closed_at = None
        incident.close_reason = None
        incident.duplicate_of_id = None

    if transition.to_status == IncidentStatus.RESOLVED:
        incident.resolved_at = now
        incident.resolution_summary = payload.resolution_summary

    if transition.to_status == IncidentStatus.CLOSED:
        incident.closed_at = now
        incident.close_reason = close_reason
        incident.duplicate_of_id = duplicate_of.id if duplicate_of is not None else None

    if transition.to_status == IncidentStatus.BLOCKED:
        incident.blocked_reason_type = payload.blocked_reason_type
        incident.blocked_reason = payload.blocked_reason
    else:
        # Leaving BLOCKED clears the reason; the event log keeps the history.
        incident.blocked_reason_type = None
        incident.blocked_reason = None

    if transition.is_reopen:
        incident.reopen_count += 1


# --- Escalation --------------------------------------------------------------


def escalate(
    session: Session,
    *,
    incident: Incident,
    user: User,
    payload: EscalateRequest,
    now: datetime | None = None,
) -> Incident:
    """Flag an incident as needing attention. The caller commits."""
    if not may_escalate(incident, user):
        raise AuthorizationError(
            "Only the reporter of an active ticket or a facility admin can escalate it.",
            code="ESCALATE_NOT_PERMITTED",
        )
    if incident.is_escalated:
        raise ConflictError(
            "This ticket is already escalated.",
            code="ALREADY_ESCALATED",
        )

    moment = now or utc_now()
    incident.is_escalated = True
    incident.escalation_reason = payload.reason
    incident.escalated_at = moment
    incident.escalated_by = user.id

    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=user.id,
        event_type=EventType.ESCALATED,
        reason=payload.reason,
    )
    return repository.reload(session, incident)


def clear_escalation(
    session: Session,
    *,
    incident: Incident,
    admin: User,
    payload: ClearEscalationRequest,
) -> Incident:
    """Clear an escalation, optionally re-prioritising at the same time.

    The two go together because they are one decision: an admin who accepts
    that a ticket is more urgent than it looked raises the priority, and an
    admin who does not says so in the note. Either way the reporter sees an
    answer rather than a flag that quietly disappeared.
    """
    if not can_clear_escalation(incident, admin):
        raise ConflictError(
            "This ticket is not escalated.",
            code="NOT_ESCALATED",
        )

    incident.is_escalated = False
    incident.escalation_reason = None
    incident.escalated_at = None
    incident.escalated_by = None

    repository.add_event(
        session,
        incident_id=incident.id,
        actor_id=admin.id,
        event_type=EventType.ESCALATION_CLEARED,
        reason=payload.note,
    )

    if payload.priority is not None and payload.priority != incident.priority:
        previous_priority = incident.priority
        incident.priority = payload.priority
        repository.add_event(
            session,
            incident_id=incident.id,
            actor_id=admin.id,
            event_type=EventType.PRIORITY_CHANGED,
            from_value=previous_priority.value,
            to_value=payload.priority.value,
            reason=payload.note,
        )

    return repository.reload(session, incident)
