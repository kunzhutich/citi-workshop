"""Incident endpoints.

Every signed-in user can read every ticket — the brief asks employees to be
able to check whether a problem is already reported before reporting it again.
What differs by role is what you may *do*, and that is answered in two places
the frontend reads instead of reasoning for itself:

* `GET /incidents/{id}/allowed-transitions` — the workflow buttons and the
  fields their dialogs must collect;
* the `can_*` flags on `GET /incidents/{id}` — everything that is not a status
  change: editing, re-prioritising, escalating, assigning, adding a note.

Neither is a hint. If a button is drawn from anything else, the UI has started
keeping its own copy of the rules.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.errors import ValidationError
from app.models.category import Category
from app.models.enums import IncidentPriority, IncidentStatus, UserRole
from app.models.event import IncidentEvent
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.repositories import incidents as repository
from app.schemas.common import Page, Paging, build_page
from app.schemas.event import ActivityEntry
from app.schemas.incident import (
    LOCATION_SEPARATOR,
    UNASSIGNED,
    AllowedTransitionRead,
    AssigneeFilter,
    AssignRequest,
    AssignResult,
    CategorySummary,
    ClearEscalationRequest,
    EscalateRequest,
    IncidentCreate,
    IncidentListItem,
    IncidentQuery,
    IncidentRead,
    IncidentSort,
    IncidentUpdate,
    LocationSummary,
    MineFilter,
    TransitionRequest,
    UserSummary,
)
from app.security.dependencies import AdminUser, CurrentUser, DbSession, require_roles
from app.services import assignment, incident_service
from app.services import notes as note_service
from app.workflow import Transition

router = APIRouter(prefix="/incidents", tags=["incidents"])

#: The caller, required to be an engineer. Which engineers may pick a ticket up
#: is a level rule, so it is left to `services/assignment.py` to answer with a
#: message that names the level.
EngineerUser = Annotated[User, Depends(require_roles(UserRole.ENGINEER))]

SearchQuery = Annotated[
    str | None,
    Query(
        max_length=200,
        description="A ticket number such as INC-000482, or words to search for.",
    ),
]
StatusFilter = Annotated[
    list[IncidentStatus] | None,
    Query(alias="status", description="Repeatable; several statuses are ORed together."),
]
PriorityFilter = Annotated[
    list[IncidentPriority] | None,
    Query(alias="priority", description="Repeatable; several priorities are ORed together."),
]
AssigneeQuery = Annotated[
    str | None,
    Query(description="A user id, or the literal 'unassigned' for tickets nobody owns."),
]


def get_incident_query(
    q: SearchQuery = None,
    statuses: StatusFilter = None,
    priorities: PriorityFilter = None,
    group_id: Annotated[uuid.UUID | None, Query(description="Category group.")] = None,
    category_id: Annotated[uuid.UUID | None, Query(description="Subcategory.")] = None,
    building_id: uuid.UUID | None = None,
    floor_id: uuid.UUID | None = None,
    seat_id: uuid.UUID | None = None,
    assignee_id: AssigneeQuery = None,
    reporter_id: uuid.UUID | None = None,
    is_escalated: bool | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    mine: Annotated[MineFilter | None, Query(description="Your own tickets.")] = None,
    specialty: Annotated[bool, Query(description="Engineers: your specialty groups.")] = False,
    sort: IncidentSort | None = None,
) -> IncidentQuery:
    """Collect the list filters from the query string into one model."""
    return IncidentQuery(
        q=q,
        statuses=statuses or [],
        priorities=priorities or [],
        group_id=group_id,
        category_id=category_id,
        building_id=building_id,
        floor_id=floor_id,
        seat_id=seat_id,
        assignee_id=_parse_assignee_filter(assignee_id),
        reporter_id=reporter_id,
        is_escalated=is_escalated,
        created_from=created_from,
        created_to=created_to,
        mine=mine,
        specialty=specialty,
        sort=sort,
    )


def _parse_assignee_filter(value: str | None) -> AssigneeFilter:
    """Turn the `assignee_id` query value into an id, the sentinel, or None."""
    if value is None:
        return None

    if value.strip().lower() == UNASSIGNED:
        return UNASSIGNED

    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise ValidationError(
            "'assignee_id' must be a user id or the word 'unassigned'.",
            code="INVALID_ASSIGNEE_FILTER",
            field="assignee_id",
        ) from exc


#: Routers depend on this rather than repeating sixteen query parameters.
ListFilters = Annotated[IncidentQuery, Depends(get_incident_query)]


@router.get("", response_model=Page[IncidentListItem], summary="List and search incidents")
def list_incidents(
    session: DbSession,
    user: CurrentUser,
    paging: Paging,
    query: ListFilters,
) -> Page[IncidentListItem]:
    """Return one page of incidents matching the filters."""
    rows, total = incident_service.list_incidents(session, user=user, query=query, paging=paging)
    return build_page([_to_list_item(row) for row in rows], total=total, params=paging)


@router.post(
    "",
    response_model=IncidentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Report an incident",
)
def create_incident(payload: IncidentCreate, session: DbSession, user: CurrentUser) -> IncidentRead:
    """Create a ticket from a completed report form.

    The caller is always the reporter. Reporting on someone else's behalf is
    not an MVP feature, so there is no field for it to be ignored.
    """
    incident = incident_service.create_incident(session, reporter=user, payload=payload)
    session.commit()
    return _to_read(incident, user)


@router.get("/{incident_id}", response_model=IncidentRead, summary="Get one incident")
def get_incident(incident_id: uuid.UUID, session: DbSession, user: CurrentUser) -> IncidentRead:
    """Return one ticket in full, with what this caller may do to it."""
    return _to_read(incident_service.get_incident(session, incident_id), user)


@router.patch("/{incident_id}", response_model=IncidentRead, summary="Edit an incident")
def update_incident(
    incident_id: uuid.UUID,
    payload: IncidentUpdate,
    session: DbSession,
    user: CurrentUser,
) -> IncidentRead:
    """Change a ticket's content or priority, checking each field group."""
    incident = incident_service.get_incident(session, incident_id)
    updated = incident_service.update_incident(
        session, incident=incident, user=user, payload=payload
    )
    session.commit()
    return _to_read(updated, user)


@router.get(
    "/{incident_id}/allowed-transitions",
    response_model=list[AllowedTransitionRead],
    summary="What this user may do to this incident now",
)
def get_allowed_transitions(
    incident_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
) -> list[AllowedTransitionRead]:
    """Return the workflow moves available to the caller right now.

    The single source of truth for the frontend's action buttons and the
    fields their dialogs collect.
    """
    incident = incident_service.get_incident(session, incident_id)
    transitions = incident_service.allowed_transitions(incident, user)
    return [_to_allowed_transition(transition) for transition in transitions]


@router.post(
    "/{incident_id}/transitions",
    response_model=IncidentRead,
    summary="Move an incident to another status",
)
def create_transition(
    incident_id: uuid.UUID,
    payload: TransitionRequest,
    session: DbSession,
    user: CurrentUser,
) -> IncidentRead:
    """Perform a workflow transition, writing its side effects and audit event."""
    incident = incident_service.get_incident(session, incident_id)
    updated = incident_service.perform_transition(
        session, incident=incident, user=user, payload=payload
    )
    session.commit()
    return _to_read(updated, user)


@router.post(
    "/{incident_id}/assign",
    response_model=AssignResult,
    summary="Assign or unassign an incident",
)
def assign_incident(
    incident_id: uuid.UUID,
    payload: AssignRequest,
    session: DbSession,
    user: CurrentUser,
) -> AssignResult:
    """Set or clear the assignee, returning any capacity warnings."""
    incident = incident_service.get_incident(session, incident_id)
    warnings = assignment.assign(
        session, incident=incident, actor=user, assignee_id=payload.assignee_id
    )
    updated = _reload(session, incident)
    session.commit()
    return AssignResult(incident=_to_read(updated, user), warnings=warnings)


@router.post(
    "/{incident_id}/pick-up",
    response_model=AssignResult,
    summary="Pick up an unassigned ticket",
)
def pick_up_incident(
    incident_id: uuid.UUID,
    session: DbSession,
    engineer: EngineerUser,
) -> AssignResult:
    """Assign an unassigned open ticket to the calling engineer.

    A convenience over `POST /assign` with your own id, and the same rules:
    senior and lead engineers may, juniors are given work instead.
    """
    incident = incident_service.get_incident(session, incident_id)
    warnings = assignment.assign(
        session, incident=incident, actor=engineer, assignee_id=engineer.id
    )
    updated = _reload(session, incident)
    session.commit()
    return AssignResult(incident=_to_read(updated, engineer), warnings=warnings)


@router.post(
    "/{incident_id}/escalate",
    response_model=IncidentRead,
    summary="Escalate an incident",
)
def escalate_incident(
    incident_id: uuid.UUID,
    payload: EscalateRequest,
    session: DbSession,
    user: CurrentUser,
) -> IncidentRead:
    """Flag a ticket as needing attention, with a reason."""
    incident = incident_service.get_incident(session, incident_id)
    updated = incident_service.escalate(session, incident=incident, user=user, payload=payload)
    session.commit()
    return _to_read(updated, user)


@router.post(
    "/{incident_id}/clear-escalation",
    response_model=IncidentRead,
    summary="Clear an escalation",
)
def clear_escalation(
    incident_id: uuid.UUID,
    payload: ClearEscalationRequest,
    session: DbSession,
    admin: AdminUser,
) -> IncidentRead:
    """Clear the escalation flag, saying what was done and optionally re-prioritising."""
    incident = incident_service.get_incident(session, incident_id)
    updated = incident_service.clear_escalation(
        session, incident=incident, admin=admin, payload=payload
    )
    session.commit()
    return _to_read(updated, admin)


@router.get(
    "/{incident_id}/activity",
    response_model=list[ActivityEntry],
    summary="The incident's activity timeline",
)
def get_activity(
    incident_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
) -> list[ActivityEntry]:
    """Return events and readable notes as one chronological stream.

    Not paginated: this is one ticket's history, and the timeline is only
    coherent read whole.
    """
    incident = incident_service.get_incident(session, incident_id)
    timeline = incident_service.load_activity(session, incident=incident, user=user)
    return [_to_activity_entry(entry) for entry in timeline]


# --- Response mapping --------------------------------------------------------


def _reload(session: Session, incident: Incident) -> Incident:
    """Re-read an incident with its detail relationships loaded."""
    return repository.reload(session, incident)


def _user_summary(user: User | None) -> UserSummary | None:
    """Return the nested form of a user, or None."""
    if user is None:
        return None
    return UserSummary.model_validate(user)


def _category_summary(category: Category) -> CategorySummary:
    """Flatten a subcategory and its group into one response object."""
    group = category.parent
    return CategorySummary(
        id=category.id,
        name=category.name,
        group_id=group.id if group is not None else None,
        group_name=group.name if group is not None else None,
        location_detail=category.location_detail,
    )


def _location_summary(incident: Incident) -> LocationSummary:
    """Resolve an incident's location ids into names and a rendered path."""
    parts = [incident.building.code]
    if incident.floor is not None:
        parts.append(incident.floor.name)
    if incident.seat is not None:
        parts.append(incident.seat.code)

    return LocationSummary(
        building_id=incident.building_id,
        building_name=incident.building.name,
        building_code=incident.building.code,
        floor_id=incident.floor_id,
        floor_name=incident.floor.name if incident.floor is not None else None,
        seat_id=incident.seat_id,
        seat_code=incident.seat.code if incident.seat is not None else None,
        seat_type=incident.seat.seat_type if incident.seat is not None else None,
        path=LOCATION_SEPARATOR.join(parts),
    )


def _to_list_item(incident: Incident) -> IncidentListItem:
    """Build the list-row form of an incident."""
    reporter = _user_summary(incident.reporter)
    if reporter is None:  # pragma: no cover - reporter_id is NOT NULL
        raise RuntimeError("An incident has no reporter.")

    return IncidentListItem(
        id=incident.id,
        ticket_number=incident.ticket_number,
        reference=incident.reference,
        title=incident.title,
        status=incident.status,
        priority=incident.priority,
        is_escalated=incident.is_escalated,
        category=_category_summary(incident.category),
        location=_location_summary(incident),
        reporter=reporter,
        assignee=_user_summary(incident.assignee),
        reopen_count=incident.reopen_count,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


def _to_read(incident: Incident, user: User) -> IncidentRead:
    """Build the detail form of an incident, including this caller's permissions."""
    base = _to_list_item(incident)
    duplicate_of = incident.duplicate_of

    return IncidentRead(
        **base.model_dump(),
        description=incident.description,
        escalation_reason=incident.escalation_reason,
        escalated_at=incident.escalated_at,
        escalated_by=_user_summary(incident.escalator),
        blocked_reason_type=incident.blocked_reason_type,
        blocked_reason=incident.blocked_reason,
        resolution_summary=incident.resolution_summary,
        close_reason=incident.close_reason,
        duplicate_of_id=incident.duplicate_of_id,
        duplicate_of_reference=duplicate_of.reference if duplicate_of is not None else None,
        assigned_at=incident.assigned_at,
        acknowledged_at=incident.acknowledged_at,
        resolved_at=incident.resolved_at,
        closed_at=incident.closed_at,
        can_edit=incident_service.can_edit_content(incident, user),
        can_change_priority=incident_service.can_change_priority(incident, user),
        can_escalate=incident_service.can_escalate(incident, user),
        can_clear_escalation=incident_service.can_clear_escalation(incident, user),
        can_assign=assignment.can_assign(incident, user),
        can_add_note=note_service.can_add_note(incident, user),
        can_add_internal_note=note_service.can_add_internal_note(incident, user),
    )


def _to_allowed_transition(transition: Transition) -> AllowedTransitionRead:
    """Render one workflow row as the frontend needs it."""
    choices = sorted(transition.close_reasons) if transition.caller_picks_close_reason else []
    return AllowedTransitionRead(
        to_status=transition.to_status,
        action_label=transition.action_label,
        required_fields=list(transition.required_fields),
        close_reason_choices=list(choices),
    )


def _to_activity_entry(entry: IncidentEvent | IncidentNote) -> ActivityEntry:
    """Render one timeline entry, whichever table it came from."""
    if isinstance(entry, IncidentNote):
        return ActivityEntry(
            kind="note",
            id=entry.id,
            created_at=entry.created_at,
            actor=_user_summary(entry.author),
            body=entry.body,
            visibility=entry.visibility,
            edited_at=entry.edited_at,
        )

    return ActivityEntry(
        kind="event",
        id=entry.id,
        created_at=entry.created_at,
        actor=_user_summary(entry.actor),
        event_type=entry.event_type,
        from_value=entry.from_value,
        to_value=entry.to_value,
        reason=entry.reason,
    )
