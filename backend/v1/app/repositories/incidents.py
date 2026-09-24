"""Queries over incidents, their events and their notes.

Three things worth knowing before changing anything here.

**Search has two modes.** A `q` that looks like a ticket number — `482`,
`INC-482`, `inc-000482` — is an exact lookup on `ticket_number`. Anything else
is full-text search over the stored `search_vector` column, ranked with
`ts_rank`. Users type both into the same box, so the box decides which one they
meant rather than asking.

**Filters never join to `categories`.** Filtering by group, or by an engineer's
specialties, is expressed as `category_id IN (SELECT id FROM categories WHERE
parent_id = ...)`. A subquery keeps the `ix_incidents_category_id` index usable
and keeps the eager-loading options below independent of the filters.

**Every list is eager-loaded.** A ticket row shows its category, its group, its
building, floor, seat, reporter and assignee — seven relationships, counting the
group as a second hop off the category. With the loaders below a page costs nine
statements whatever its size; without them a page of 25 costs 1 + 25 * 7 = 176,
and on Aurora that is the whole response time.
"""

import re
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import ColumnElement, Select, case, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.category import Category
from app.models.enums import EventType, IncidentStatus
from app.models.event import IncidentEvent
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.schemas.incident import UNASSIGNED, IncidentFilters, IncidentSort

#: A ticket number as a user might type it: `482`, `INC482`, `inc-000482`.
TICKET_NUMBER_PATTERN = re.compile(r"^(?:INC-?)?(\d+)$", re.IGNORECASE)

#: PostgreSQL text search configuration. English matches the seeded category
#: names and the language the UI is written in; it also drives the stemming
#: that makes "flickering" find "flicker".
SEARCH_CONFIG = "english"


def _list_loaders() -> tuple[Any, ...]:
    """Return the eager-loading options every incident query uses."""
    return (
        selectinload(Incident.category).selectinload(Category.parent),
        selectinload(Incident.building),
        selectinload(Incident.floor),
        selectinload(Incident.seat),
        selectinload(Incident.reporter),
        selectinload(Incident.assignee),
    )


def _detail_loaders() -> tuple[Any, ...]:
    """Return the eager-loading options for a single incident.

    Two more than a list row: who escalated it, and which ticket it duplicates.
    Both appear only on the detail page, so a list does not pay for them.
    """
    return (*_list_loaders(), selectinload(Incident.escalator), selectinload(Incident.duplicate_of))


def parse_ticket_number(query: str) -> int | None:
    """Return the ticket number a search string names, or None if it names none."""
    match = TICKET_NUMBER_PATTERN.match(query.strip())
    if match is None:
        return None
    return int(match.group(1))


def add(session: Session, incident: Incident) -> Incident:
    """Insert an incident and flush so its id and ticket number are available."""
    session.add(incident)
    session.flush()
    session.refresh(incident)
    return incident


def get(session: Session, incident_id: uuid.UUID) -> Incident | None:
    """Return one incident with everything the detail page shows, or None."""
    statement = select(Incident).where(Incident.id == incident_id).options(*_detail_loaders())
    return session.scalars(statement).one_or_none()


def get_bare(session: Session, incident_id: uuid.UUID) -> Incident | None:
    """Return one incident without eager loading, for code that only writes to it."""
    return session.get(Incident, incident_id)


def reload(session: Session, incident: Incident) -> Incident:
    """Re-read an incident with the detail loaders after it has been written to.

    `populate_existing` is what makes this do anything. Without it, the query
    finds the object already in the session's identity map and hands it back
    untouched, **including relationships that were loaded before the write**.
    Setting `incident.assignee_id` does not update `incident.assignee`, so a
    response built from the returned object would say the ticket is still
    unassigned immediately after assigning it — and the same for `escalator`
    after an escalation and `duplicate_of` after closing as a duplicate.
    """
    session.flush()

    statement = (
        select(Incident)
        .where(Incident.id == incident.id)
        .options(*_detail_loaders())
        .execution_options(populate_existing=True)
    )
    loaded = session.scalars(statement).one_or_none()
    if loaded is None:  # pragma: no cover - the row was just written in this session
        raise RuntimeError("An incident disappeared between writing and reading it back.")
    return loaded


def list_incidents(
    session: Session,
    *,
    visible: Select[Any],
    filters: IncidentFilters,
    limit: int,
    offset: int,
) -> tuple[Sequence[Incident], int]:
    """Return one page of incidents matching `filters`, and the total count.

    `visible` is the base statement, already through
    `services/visibility.apply_incident_visibility`. Taking it as an argument
    rather than building it here is what stops a caller from skipping that
    step: there is no `select(Incident)` in this function to start from.
    """
    statement = _apply_filters(visible, filters)

    total = session.scalars(select(func.count()).select_from(statement.subquery())).one()

    ordered = statement.order_by(*_order_by(filters)).limit(limit).offset(offset)
    rows = session.scalars(ordered.options(*_list_loaders())).unique().all()
    return rows, total


def _apply_filters(statement: Select[Any], filters: IncidentFilters) -> Select[Any]:
    """Narrow a statement by every filter the caller supplied."""
    if filters.statuses:
        statement = statement.where(Incident.status.in_(filters.statuses))
    if filters.priorities:
        statement = statement.where(Incident.priority.in_(filters.priorities))

    if filters.category_id is not None:
        statement = statement.where(Incident.category_id == filters.category_id)
    if filters.group_id is not None:
        statement = statement.where(Incident.category_id.in_(_subcategory_ids(filters.group_id)))
    if filters.specialty_group_ids is not None:
        statement = statement.where(
            Incident.category_id.in_(_subcategory_ids_in(filters.specialty_group_ids))
        )

    if filters.building_id is not None:
        statement = statement.where(Incident.building_id == filters.building_id)
    if filters.floor_id is not None:
        statement = statement.where(Incident.floor_id == filters.floor_id)
    if filters.seat_id is not None:
        statement = statement.where(Incident.seat_id == filters.seat_id)

    if filters.assignee_id == UNASSIGNED:
        statement = statement.where(Incident.assignee_id.is_(None))
    elif filters.assignee_id is not None:
        statement = statement.where(Incident.assignee_id == filters.assignee_id)
    if filters.reporter_id is not None:
        statement = statement.where(Incident.reporter_id == filters.reporter_id)

    if filters.is_escalated is not None:
        statement = statement.where(Incident.is_escalated.is_(filters.is_escalated))

    if filters.created_from is not None:
        statement = statement.where(Incident.created_at >= filters.created_from)
    if filters.created_to is not None:
        statement = statement.where(Incident.created_at <= filters.created_to)

    return _apply_search(statement, filters)


def _apply_search(statement: Select[Any], filters: IncidentFilters) -> Select[Any]:
    """Apply the `q` parameter as either a ticket lookup or a text search."""
    if not filters.q:
        return statement

    ticket_number = parse_ticket_number(filters.q)
    if ticket_number is not None:
        return statement.where(Incident.ticket_number == ticket_number)

    return statement.where(Incident.search_vector.op("@@")(_tsquery(filters.q)))


def _tsquery(query: str) -> ColumnElement[Any]:
    """Build the parsed search query.

    `websearch_to_tsquery` rather than `to_tsquery`: it accepts what people
    actually type — quoted phrases, `or`, a leading `-` to exclude — and it
    never raises a syntax error on stray punctuation, which `to_tsquery` does
    and which would turn a typo into a 500.
    """
    return func.websearch_to_tsquery(SEARCH_CONFIG, query)


def _order_by(filters: IncidentFilters) -> tuple[Any, ...]:
    """Return the ORDER BY terms for a listing.

    A text search with no explicit `sort` is ordered by relevance, then newest
    first. An explicit `sort` always wins: a caller who asked for "most urgent
    first" gets that, searching or not.

    `closed_last` prepends one term to whichever of those applies. It is a
    *prefix* rather than a sort of its own because it answers a different
    question: the sort says how to arrange the work, and this says that
    finished work goes at the end of it however it is arranged.

    It has to be done here rather than in the browser. A list is paged, so a
    client that reorders the twenty-five rows it was given moves a closed
    ticket to the bottom of *page one* and leaves it above every open ticket
    on page two.
    """
    terms: tuple[Any, ...] = ()
    if filters.closed_last:
        # `case` yields 1 for closed and 0 for everything else, ascending — so
        # closed sorts after, and the rest keep whatever order follows.
        terms += (case((Incident.status == IncidentStatus.CLOSED, 1), else_=0).asc(),)

    if filters.sort is None and filters.q and parse_ticket_number(filters.q) is None:
        rank = func.ts_rank(Incident.search_vector, _tsquery(filters.q))
        return (*terms, rank.desc(), Incident.created_at.desc())

    return terms + _SORT_TERMS[filters.sort or IncidentSort.CREATED_AT_DESC]


#: `sort` value -> ORDER BY terms. Priority sorts on the PostgreSQL enum, whose
#: declared order is LOW < MEDIUM < HIGH < CRITICAL, so `-priority` really is
#: "most urgent first" without a CASE expression. Every sort falls back to
#: `ticket_number` so that paging is stable when the primary key ties.
_SORT_TERMS: dict[IncidentSort, tuple[Any, ...]] = {
    IncidentSort.CREATED_AT: (Incident.created_at.asc(), Incident.ticket_number.asc()),
    IncidentSort.CREATED_AT_DESC: (Incident.created_at.desc(), Incident.ticket_number.desc()),
    IncidentSort.PRIORITY: (Incident.priority.asc(), Incident.ticket_number.desc()),
    IncidentSort.PRIORITY_DESC: (Incident.priority.desc(), Incident.ticket_number.desc()),
    IncidentSort.UPDATED_AT: (Incident.updated_at.asc(), Incident.ticket_number.asc()),
    IncidentSort.UPDATED_AT_DESC: (Incident.updated_at.desc(), Incident.ticket_number.desc()),
    IncidentSort.TICKET_NUMBER: (Incident.ticket_number.asc(),),
}


def _subcategory_ids(group_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Return a subquery selecting every subcategory id under one group."""
    return select(Category.id).where(Category.parent_id == group_id)


def _subcategory_ids_in(group_ids: Sequence[uuid.UUID]) -> Select[tuple[uuid.UUID]]:
    """Return a subquery selecting every subcategory id under any of these groups."""
    return select(Category.id).where(Category.parent_id.in_(group_ids))


# --- Events ------------------------------------------------------------------


def add_event(
    session: Session,
    *,
    incident_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    event_type: EventType,
    from_value: str | None = None,
    to_value: str | None = None,
    reason: str | None = None,
) -> IncidentEvent:
    """Append one row to an incident's audit log.

    Takes the fields rather than a built `IncidentEvent` so that every service
    that records history — transitions, assignment, escalation — writes it the
    same way, and so `from_value` / `to_value` are always stringified here
    instead of at four call sites.
    """
    event = IncidentEvent(
        incident_id=incident_id,
        actor_id=actor_id,
        event_type=event_type,
        from_value=from_value,
        to_value=to_value,
        reason=reason,
    )
    session.add(event)
    session.flush()
    return event


def list_events(session: Session, incident_id: uuid.UUID) -> Sequence[IncidentEvent]:
    """Return an incident's audit log oldest first, with its actors loaded."""
    statement = (
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .options(selectinload(IncidentEvent.actor))
        .order_by(IncidentEvent.created_at, IncidentEvent.id)
    )
    return session.scalars(statement).all()


# --- Notes -------------------------------------------------------------------


def notes_query(incident_id: uuid.UUID) -> Select[tuple[IncidentNote]]:
    """Return the base statement for one incident's notes.

    Callers pass it through `services/visibility.apply_note_visibility` before
    executing it. Like `list_incidents`, the base statement is handed out
    rather than built at the point of use so the filter cannot be skipped.
    """
    return select(IncidentNote).where(IncidentNote.incident_id == incident_id)


def list_notes(session: Session, visible: Select[Any]) -> Sequence[IncidentNote]:
    """Return notes oldest first, with their authors loaded."""
    statement = visible.options(selectinload(IncidentNote.author)).order_by(
        IncidentNote.created_at, IncidentNote.id
    )
    return session.scalars(statement).unique().all()


def add_note(session: Session, note: IncidentNote) -> IncidentNote:
    """Insert a note and flush so its id and timestamps are available."""
    session.add(note)
    session.flush()
    session.refresh(note)
    return note


def get_note(session: Session, note_id: uuid.UUID) -> IncidentNote | None:
    """Return one note with its author loaded, deleted or not."""
    statement = (
        select(IncidentNote)
        .where(IncidentNote.id == note_id)
        .options(selectinload(IncidentNote.author))
    )
    return session.scalars(statement).one_or_none()
