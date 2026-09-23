"""The SQL behind the reports. Every number on a dashboard is computed here.

**Nothing in this module iterates over incidents.** Each function issues one
statement and PostgreSQL returns the finished numbers — `COUNT(*) FILTER (...)`
for the segmented counts, `AVG` and `percentile_cont(0.5) WITHIN GROUP (ORDER
BY EXTRACT(EPOCH FROM ...))` for the durations, a window function for the
category group totals. That is not a stylistic preference: the demo dataset is
three hundred incidents and a real one is not, and a report that pulls rows
into Python to add them up gets slower in direct proportion to how successful
the platform is.

Three conventions hold throughout.

**The window filters `created_at`, where a window applies at all.**
"Incidents in this period" means incidents *reported* in it, so two tiles on
the same dashboard always describe the same set of tickets. Three metrics
necessarily name a different timestamp, and each says so where it is defined:
the closed series in `per_day`, `resolved_in_period` in the workload report,
and the current-state snapshot in the workload report's active counts.

**Two reports take no window at all**, because they answer present-tense
questions: `blocked_escalated_*` and `personal_counts` describe what is in a
state *now*, so a ticket blocked or opened ninety days ago is still theirs to
report. They take a `ReportScope` — a building and an instant — rather than a
`ReportWindow`, and `_scope_clauses()` is the whole of their filtering. See
decision D9.

**Durations come back in hours**, rounded by PostgreSQL rather than by Python,
and are `NULL` when the population was empty. `percentile_cont` ignores NULL
inputs, which is exactly what is wanted: the median time to resolve is over the
tickets that were resolved, not over the ones that were not.

**`now` is a parameter, never `now()`.** The ages in the blocked and escalated
report are measured against `scope.as_of`, a moment the caller passes in, so a
test can state what the answer must be. See `app/clock.py`.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Date,
    DateTime,
    Numeric,
    Row,
    Select,
    TableValuedAlias,
    and_,
    cast,
    desc,
    extract,
    func,
    literal,
    select,
    text,
)
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.models.building import Building
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.enums import (
    ACTIVE_INCIDENT_STATUSES,
    EventType,
    IncidentPriority,
    IncidentStatus,
    NoteVisibility,
    UserRole,
)
from app.models.event import IncidentEvent
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.seat import Seat
from app.models.user import User
from app.schemas.report import (
    ESCALATED_TICKET_LIMIT,
    TOP_LOCATION_LIMIT,
    ReportScope,
    ReportWindow,
)

#: Seconds in an hour. Every duration is divided by this in SQL so that the
#: API never has to explain which unit it is speaking in.
SECONDS_PER_HOUR = 3600.0

#: The percentile the reports use. Median rather than mean throughout: one
#: ticket that sat over a long weekend must not move the headline number.
MEDIAN = 0.5

#: Decimal places on an hours figure, and on a percentage.
HOURS_PRECISION = 2
PERCENT_PRECISION = 1

#: Who counts as staff when asking whether an employee was kept informed.
STAFF_ROLES = (UserRole.ENGINEER, UserRole.FACILITY_ADMIN)


# --- Shared building blocks --------------------------------------------------


def status_label(status: IncidentStatus) -> str:
    """Return the result column name carrying one status's count."""
    return f"status_{status.value.lower()}"


def priority_label(priority: IncidentPriority) -> str:
    """Return the result column name carrying one priority's count."""
    return f"priority_{priority.value.lower()}"


def _window_clauses(window: ReportWindow) -> list[ColumnElement[bool]]:
    """Return the WHERE terms restricting incidents to the reported period.

    Both ends inclusive, and the building filter folded in here so that no
    report can apply the period and forget the building.
    """
    clauses: list[ColumnElement[bool]] = [
        Incident.created_at >= window.date_from,
        Incident.created_at <= window.date_to,
    ]
    if window.building_id is not None:
        clauses.append(Incident.building_id == window.building_id)
    return clauses


def _in_window(statement: Select[Any], window: ReportWindow) -> Select[Any]:
    """Narrow a statement to the incidents the report covers."""
    return statement.where(*_window_clauses(window))


def _scope_clauses(scope: ReportScope) -> list[ColumnElement[bool]]:
    """Return the WHERE terms for a report that describes the present.

    There is deliberately no date term here. `building_id` narrows *which*
    tickets are in view and is a scope filter; `from`/`to` would narrow *when*
    they were reported, and a report answering "what is blocked" must not drop
    a ticket for having been raised too long ago. See decision D9.
    """
    if scope.building_id is None:
        return []
    return [Incident.building_id == scope.building_id]


def _in_scope(statement: Select[Any], scope: ReportScope) -> Select[Any]:
    """Narrow a statement to the incidents a current-state report covers."""
    return statement.where(*_scope_clauses(scope))


def _hours(expression: ColumnElement[Any]) -> ColumnElement[Any]:
    """Convert an interval expression to a number of hours."""
    return extract("epoch", expression) / SECONDS_PER_HOUR


def _rounded(expression: ColumnElement[Any], places: int) -> ColumnElement[Any]:
    """Round a double-precision aggregate, which needs a numeric cast first."""
    return func.round(cast(expression, Numeric), places)


def _median_hours_since_created(reached_at: ColumnElement[Any]) -> ColumnElement[Any]:
    """Build the median hours from report to `reached_at`.

    Incidents that never reached the milestone contribute NULL, and
    `percentile_cont` drops them, so no FILTER clause is needed here — the
    counts reported alongside say how many rows the median rests on.
    """
    hours = _hours(reached_at - Incident.created_at)
    return _rounded(func.percentile_cont(MEDIAN).within_group(hours), HOURS_PRECISION)


def _percentage(
    numerator: ColumnElement[Any],
    denominator: ColumnElement[Any],
) -> ColumnElement[Any]:
    """Build a rounded percentage that is NULL rather than an error at zero."""
    share = literal(100.0) * numerator / func.nullif(denominator, 0)
    return _rounded(share, PERCENT_PRECISION)


def _moment(now: datetime) -> ColumnElement[Any]:
    """Bind a Python instant as a `timestamptz`, for age arithmetic."""
    return literal(now, DateTime(timezone=True))


# --- Summary -----------------------------------------------------------------


def summary_totals(session: Session, window: ReportWindow) -> Row[Any]:
    """Return one row of headline counts, segmented by status and priority.

    One statement rather than eleven: every segment is a `COUNT(*) FILTER`
    over the same scan, so adding a segment costs nothing.
    """
    columns: list[Any] = [
        func.count().label("total"),
        func.count().filter(Incident.status.in_(ACTIVE_INCIDENT_STATUSES)).label("active_total"),
        func.count()
        .filter(
            Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
            Incident.assignee_id.is_(None),
        )
        .label("unassigned_total"),
        func.count().filter(Incident.is_escalated).label("escalated_total"),
    ]
    columns.extend(
        func.count().filter(Incident.status == status).label(status_label(status))
        for status in IncidentStatus
    )
    columns.extend(
        func.count().filter(Incident.priority == priority).label(priority_label(priority))
        for priority in IncidentPriority
    )

    statement = _in_window(select(*columns).select_from(Incident), window)
    return session.execute(statement).one()


def summary_by_assignee(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return counts per assignee, busiest first, with unassigned included.

    A LEFT JOIN rather than an inner one, so the unassigned tickets stay in the
    result as a row with a null id instead of quietly disappearing — that row
    is the one an admin is looking for.
    """
    statement = (
        select(
            User.id.label("assignee_id"),
            User.full_name.label("assignee_name"),
            func.count().label("count"),
        )
        .select_from(Incident)
        .outerjoin(User, User.id == Incident.assignee_id)
        .where(*_window_clauses(window))
        .group_by(User.id, User.full_name)
        .order_by(desc("count"), User.full_name)
    )
    return session.execute(statement).all()


def summary_per_day(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return one row per calendar day in the window: created, and closed.

    `generate_series` supplies the calendar, so days on which nothing happened
    come back as zeroes instead of being absent — the client plots the series
    without having to reconstruct the dates. The two counts are deliberately
    independent: a ticket closed on the 9th is counted on the 9th whether it
    was reported that morning or six weeks earlier.
    """
    calendar = (
        func.generate_series(
            cast(window.date_from, Date),
            cast(window.date_to, Date),
            text("'1 day'::interval"),
        )
        .table_valued("day")
        .render_derived(name="calendar", with_types=False)
    )
    day = calendar.c.day

    statement = select(
        cast(day, Date).label("day"),
        _counted_on_day(Incident.created_at, day, window, calendar).label("created"),
        _counted_on_day(Incident.closed_at, day, window, calendar).label("closed"),
    ).order_by(day)
    return session.execute(statement).all()


def _counted_on_day(
    column: ColumnElement[Any],
    day: ColumnElement[Any],
    window: ReportWindow,
    calendar: TableValuedAlias,
) -> ColumnElement[Any]:
    """Build the correlated count of incidents whose `column` falls on `day`.

    The window bounds are applied to `column` too, not only the day equality:
    a window starting at noon must not pick up that morning's tickets just
    because they share a date with its first day.
    """
    clauses: list[ColumnElement[bool]] = [
        cast(column, Date) == cast(day, Date),
        column >= window.date_from,
        column <= window.date_to,
    ]
    if window.building_id is not None:
        clauses.append(Incident.building_id == window.building_id)

    return (
        select(func.count())
        .select_from(Incident)
        .where(*clauses)
        .correlate(calendar)
        .scalar_subquery()
    )


# --- Categories --------------------------------------------------------------


def categories_breakdown(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return one row per subcategory, carrying its group's total alongside.

    The group total is a window function — `sum(count(*)) OVER (PARTITION BY
    group)` — computed in the same pass as the subcategory counts. The
    alternative, a second grouped query or a Python sum, would either double
    the work or move arithmetic out of the database for no reason.
    """
    group = aliased(Category, name="category_group")

    statement = (
        select(
            group.id.label("group_id"),
            group.name.label("group_name"),
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            func.count().label("count"),
            func.sum(func.count()).over(partition_by=group.id).label("group_total"),
        )
        .select_from(Incident)
        .join(Category, Category.id == Incident.category_id)
        .outerjoin(group, group.id == Category.parent_id)
        .where(*_window_clauses(window))
        .group_by(group.id, group.name, Category.id, Category.name)
        .order_by(desc("group_total"), group.name, desc("count"), Category.name)
    )
    return session.execute(statement).all()


# --- Locations ---------------------------------------------------------------


def top_buildings(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return the busiest buildings in the period."""
    statement = (
        select(
            Building.id.label("building_id"),
            Building.name.label("building_name"),
            Building.code.label("building_code"),
            func.count().label("count"),
        )
        .select_from(Incident)
        .join(Building, Building.id == Incident.building_id)
        .where(*_window_clauses(window))
        .group_by(Building.id, Building.name, Building.code)
        .order_by(desc("count"), Building.code)
        .limit(TOP_LOCATION_LIMIT)
    )
    return session.execute(statement).all()


def top_floors(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return the busiest floors in the period.

    Incidents reported against a whole building have no floor and are absent
    here by construction — the inner join drops them — which is right: they
    are not evidence about any one floor.
    """
    statement = (
        select(
            Floor.id.label("floor_id"),
            Floor.name.label("floor_name"),
            Building.id.label("building_id"),
            Building.code.label("building_code"),
            func.count().label("count"),
        )
        .select_from(Incident)
        .join(Floor, Floor.id == Incident.floor_id)
        .join(Building, Building.id == Floor.building_id)
        .where(*_window_clauses(window))
        .group_by(Floor.id, Floor.name, Building.id, Building.code)
        .order_by(desc("count"), Building.code, Floor.name)
        .limit(TOP_LOCATION_LIMIT)
    )
    return session.execute(statement).all()


def top_seats(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return the busiest seats and meeting rooms in the period."""
    statement = (
        select(
            Seat.id.label("seat_id"),
            Seat.code.label("seat_code"),
            Seat.seat_type.label("seat_type"),
            Floor.id.label("floor_id"),
            Floor.name.label("floor_name"),
            Building.id.label("building_id"),
            Building.code.label("building_code"),
            func.count().label("count"),
        )
        .select_from(Incident)
        .join(Seat, Seat.id == Incident.seat_id)
        .join(Floor, Floor.id == Seat.floor_id)
        .join(Building, Building.id == Floor.building_id)
        .where(*_window_clauses(window))
        .group_by(
            Seat.id,
            Seat.code,
            Seat.seat_type,
            Floor.id,
            Floor.name,
            Building.id,
            Building.code,
        )
        .order_by(desc("count"), Building.code, Floor.name, Seat.code)
        .limit(TOP_LOCATION_LIMIT)
    )
    return session.execute(statement).all()


# --- Response times ----------------------------------------------------------


def _timing_columns() -> list[Any]:
    """Return the milestone counts and medians every response-time row carries."""
    return [
        func.count().label("total"),
        func.count().filter(Incident.assigned_at.is_not(None)).label("assigned_count"),
        func.count().filter(Incident.acknowledged_at.is_not(None)).label("acknowledged_count"),
        func.count().filter(Incident.resolved_at.is_not(None)).label("resolved_count"),
        _median_hours_since_created(Incident.assigned_at).label("median_assign_hours"),
        _median_hours_since_created(Incident.acknowledged_at).label("median_acknowledge_hours"),
        _median_hours_since_created(Incident.resolved_at).label("median_resolve_hours"),
    ]


def response_times_overall(session: Session, window: ReportWindow) -> Row[Any]:
    """Return the medians and counts across every priority."""
    statement = _in_window(select(*_timing_columns()).select_from(Incident), window)
    return session.execute(statement).one()


def response_times_by_priority(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return the same medians and counts, one row per priority.

    Ordered by the PostgreSQL enum, whose declared order runs LOW to CRITICAL,
    so the rows arrive in the order a chart wants to draw them.
    """
    statement = (
        _in_window(
            select(Incident.priority.label("priority"), *_timing_columns()).select_from(Incident),
            window,
        )
        .group_by(Incident.priority)
        .order_by(Incident.priority)
    )
    return session.execute(statement).all()


# --- Engineer workload -------------------------------------------------------


def engineer_workload(session: Session, window: ReportWindow) -> Sequence[Row[Any]]:
    """Return every active engineer with their current load and period output.

    Two populations in one statement, which is why the join carries no date
    filter. "How loaded is this engineer" is a question about *now* — a ticket
    they are working on today counts whenever it was reported — while
    `resolved_in_period` is scoped to the window by its own FILTER clause. The
    building filter does sit on the join, so a building-scoped dashboard shows
    each engineer's load in that building.

    `count(Incident.id)` rather than `count(*)`: the LEFT JOIN manufactures a
    null row for an engineer holding nothing, and `count(*)` would score them 1.
    """
    join_clauses: list[ColumnElement[bool]] = [Incident.assignee_id == User.id]
    if window.building_id is not None:
        join_clauses.append(Incident.building_id == window.building_id)

    active_count = func.count(Incident.id).filter(
        Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
    )
    resolved_in_period = func.count(Incident.id).filter(
        Incident.resolved_at.is_not(None),
        Incident.resolved_at >= window.date_from,
        Incident.resolved_at <= window.date_to,
    )

    statement = (
        select(
            User.id.label("user_id"),
            User.full_name.label("full_name"),
            EngineerProfile.level.label("level"),
            EngineerProfile.availability.label("availability"),
            EngineerProfile.max_active_tickets.label("max_active_tickets"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.OPEN)
            .label("open_count"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.IN_PROGRESS)
            .label("in_progress_count"),
            func.count(Incident.id)
            .filter(Incident.status == IncidentStatus.BLOCKED)
            .label("blocked_count"),
            active_count.label("active_count"),
            _percentage(active_count, EngineerProfile.max_active_tickets).label(
                "capacity_used_pct"
            ),
            resolved_in_period.label("resolved_in_period"),
        )
        .select_from(User)
        .join(EngineerProfile, EngineerProfile.user_id == User.id)
        .outerjoin(Incident, and_(*join_clauses))
        .where(User.role == UserRole.ENGINEER, User.is_active)
        .group_by(
            User.id,
            User.full_name,
            EngineerProfile.level,
            EngineerProfile.availability,
            EngineerProfile.max_active_tickets,
        )
        .order_by(desc("active_count"), User.full_name)
    )
    return session.execute(statement).all()


# --- Blocked and escalated ---------------------------------------------------


def _blocked_since() -> ColumnElement[Any]:
    """Build the instant an incident most recently entered BLOCKED.

    Read from the audit log rather than from a column, because there is no
    column: `blocked_reason_type` is cleared when a ticket leaves BLOCKED and
    nothing records when it entered. `COALESCE` to `created_at` covers a row
    whose blocking predates its event log — seeded or imported data — so a
    missing event understates the age rather than producing a NULL.
    """
    latest = (
        select(func.max(IncidentEvent.created_at))
        .where(
            IncidentEvent.incident_id == Incident.id,
            IncidentEvent.event_type == EventType.STATUS_CHANGED,
            IncidentEvent.to_value == IncidentStatus.BLOCKED.value,
        )
        .correlate(Incident)
        .scalar_subquery()
    )
    return func.coalesce(latest, Incident.created_at)


def _live_escalation_clauses() -> list[ColumnElement[bool]]:
    """Return the WHERE terms for an escalation somebody can still act on.

    `is_escalated` is raised by `escalate` and lowered *only* by
    `clear_escalation` — resolving or closing a ticket deliberately leaves it
    standing, because the flag is history and `incident_events` keeps it. So
    the flag alone does not answer "what is escalated" in the present tense:
    the incident has to still be live as well. Shared by the count and the
    list below so the two cannot drift apart. See decision D10.
    """
    return [
        Incident.is_escalated,
        Incident.status.in_(ACTIVE_INCIDENT_STATUSES),
    ]


def blocked_escalated_totals(session: Session, scope: ReportScope) -> Row[Any]:
    """Return how many incidents are blocked right now, and how many escalated.

    Both halves are counted over live tickets: BLOCKED is a status and excludes
    closed work by construction, and the escalated count is restricted to
    `ACTIVE_INCIDENT_STATUSES` for the same reason. See decision D10.
    """
    statement = _in_scope(
        select(
            func.count().filter(Incident.status == IncidentStatus.BLOCKED).label("blocked_total"),
            func.count().filter(*_live_escalation_clauses()).label("escalated_total"),
        ).select_from(Incident),
        scope,
    )
    return session.execute(statement).one()


def blocked_groups(session: Session, scope: ReportScope) -> Sequence[Row[Any]]:
    """Return every currently blocked incident grouped by reason, with its age.

    "With age" is the point of the report, and an age is only worth reading if
    the old ones can appear: the longest-blocked ticket is the one an admin is
    looking for, so nothing is dropped for having been reported long ago.
    """
    age_hours = _hours(_moment(scope.as_of) - _blocked_since())

    statement = (
        select(
            Incident.blocked_reason_type.label("blocked_reason_type"),
            func.count().label("count"),
            _rounded(func.avg(age_hours), HOURS_PRECISION).label("average_age_hours"),
            _rounded(func.max(age_hours), HOURS_PRECISION).label("max_age_hours"),
        )
        .select_from(Incident)
        .where(Incident.status == IncidentStatus.BLOCKED, *_scope_clauses(scope))
        .group_by(Incident.blocked_reason_type)
        .order_by(desc("count"), Incident.blocked_reason_type)
    )
    return session.execute(statement).all()


def escalated_tickets(session: Session, scope: ReportScope) -> Sequence[Row[Any]]:
    """Return the escalated tickets themselves, most recently escalated first.

    A list rather than an aggregate, because "what is escalated and why" is
    answered by the reasons people wrote, not by a count of them. Still
    escalated is still escalated, however old the ticket is — but only while
    the ticket is still live: a closed one carries the flag as history and
    nobody can act on it. See `_live_escalation_clauses()` and decision D10.
    """
    age_hours = _rounded(_hours(_moment(scope.as_of) - Incident.escalated_at), HOURS_PRECISION)

    statement = (
        _in_scope(
            select(
                Incident.id.label("incident_id"),
                Incident.ticket_number.label("ticket_number"),
                Incident.title.label("title"),
                Incident.status.label("status"),
                Incident.priority.label("priority"),
                Incident.escalation_reason.label("escalation_reason"),
                Incident.escalated_at.label("escalated_at"),
                age_hours.label("age_hours"),
            ).select_from(Incident),
            scope,
        )
        .where(*_live_escalation_clauses())
        .order_by(Incident.escalated_at.desc().nullslast(), desc(Incident.ticket_number))
        .limit(ESCALATED_TICKET_LIMIT)
    )
    return session.execute(statement).all()


# --- Communication -----------------------------------------------------------


def _first_public_staff_note() -> ColumnElement[Any]:
    """Build the instant of the first PUBLIC note a member of staff wrote.

    Soft-deleted notes are excluded, matching `services/visibility.py`: a note
    that has been deleted is gone from every reading of the ticket, including
    this one.
    """
    return (
        select(func.min(IncidentNote.created_at))
        .select_from(IncidentNote)
        .join(User, User.id == IncidentNote.author_id)
        .where(
            IncidentNote.incident_id == Incident.id,
            IncidentNote.deleted_at.is_(None),
            IncidentNote.visibility == NoteVisibility.PUBLIC,
            User.role.in_(STAFF_ROLES),
        )
        .correlate(Incident)
        .scalar_subquery()
    )


def communication(session: Session, window: ReportWindow) -> Row[Any]:
    """Return the communication and reopen metrics for the period in one row."""
    first_note = _first_public_staff_note()
    resolved = Incident.resolved_at.is_not(None)
    informed = and_(resolved, first_note.is_not(None), first_note <= Incident.resolved_at)
    reopened = Incident.reopen_count > 0

    resolved_total = func.count().filter(resolved)
    informed_total = func.count().filter(informed)
    reopened_total = func.count().filter(reopened)

    statement = _in_window(
        select(
            func.count().label("total"),
            resolved_total.label("resolved_total"),
            informed_total.label("informed_total"),
            _percentage(informed_total, resolved_total).label("informed_pct"),
            _rounded(
                func.percentile_cont(MEDIAN).within_group(_hours(first_note - Incident.created_at)),
                HOURS_PRECISION,
            ).label("median_first_public_note_hours"),
            reopened_total.label("reopened_total"),
            _percentage(reopened_total, func.count()).label("reopen_rate_pct"),
        ).select_from(Incident),
        window,
    )
    return session.execute(statement).one()


# --- The caller's own tickets ------------------------------------------------


def personal_counts(
    session: Session,
    scope: ReportScope,
    *,
    column: ColumnElement[Any],
    user_id: uuid.UUID,
) -> Row[Any]:
    """Return one person's counts over the tickets `column` links them to.

    `column` is `Incident.reporter_id` or `Incident.assignee_id`. Passing the
    column rather than a flag keeps the two capacities one query with one set
    of segments, so they cannot drift apart.

    No date filter: these are the numbers on somebody's home screen, and "you
    have one open ticket" must mean all of them, not the ones raised this
    month. See decision D9.
    """
    columns: list[Any] = [
        func.count().label("total"),
        func.count().filter(Incident.status.in_(ACTIVE_INCIDENT_STATUSES)).label("active"),
        func.count().filter(Incident.is_escalated).label("escalated"),
    ]
    columns.extend(
        func.count().filter(Incident.status == status).label(status_label(status))
        for status in IncidentStatus
    )

    statement = _in_scope(
        select(*columns).select_from(Incident).where(column == user_id),
        scope,
    )
    return session.execute(statement).one()
