"""Turning the report aggregates into the shapes the dashboards consume.

This layer does three things and deliberately no arithmetic:

* **it resolves the period.** `from` and `to` both default, naive datetimes are
  read as UTC, and an inverted range is refused rather than silently returning
  nothing. Every endpoint shares one implementation, so "last 30 days" means
  the same thing on all eight of them;
* **it maps aggregate rows onto response models**, filling in the zeroes that
  a `GROUP BY` never produces — a status nobody used still appears in
  `by_status` with a count of 0, because a chart cannot distinguish "none" from
  "absent";
* **it nests what is naturally nested**, subcategories under their group. The
  totals were computed by the database; assembling them into a tree is not
  recomputing them.

`now` is a parameter everywhere it matters, defaulting to `app.clock.utc_now`,
so a test can state what a blocked ticket's age must be instead of measuring it.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Row
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import ValidationError
from app.models.enums import IncidentPriority, IncidentStatus, UserRole
from app.models.incident import Incident, format_reference
from app.models.user import User
from app.repositories import reports as repository
from app.schemas.report import (
    DEFAULT_WINDOW_DAYS,
    AssigneeCount,
    BlockedEscalatedReport,
    BlockedGroup,
    BuildingCount,
    CategoriesReport,
    CategoryGroupCount,
    CommunicationReport,
    DayCount,
    EngineerWorkload,
    EngineerWorkloadReport,
    EscalatedTicket,
    FloorCount,
    LocationsReport,
    MyReport,
    PersonalCounts,
    PriorityCount,
    ReportWindow,
    ResponseTimes,
    ResponseTimesReport,
    SeatCount,
    StatusCount,
    SubcategoryCount,
    SummaryReport,
)

# --- The reporting period ----------------------------------------------------


def build_window(
    *,
    date_from: datetime | None,
    date_to: datetime | None,
    building_id: uuid.UUID | None,
    now: datetime | None = None,
) -> ReportWindow:
    """Resolve the requested period, applying the defaults and checking it.

    Defaults run backwards from `to`, not forwards from `from`: a caller who
    supplies only `to` is asking about the thirty days leading up to it.
    """
    moment = now or utc_now()
    end = _as_utc(date_to) if date_to is not None else moment
    default_start = end - timedelta(days=DEFAULT_WINDOW_DAYS)
    start = _as_utc(date_from) if date_from is not None else default_start

    if start > end:
        raise ValidationError(
            "'from' must not be later than 'to'.",
            code="INVALID_REPORT_WINDOW",
            field="from",
        )

    return ReportWindow(date_from=start, date_to=end, building_id=building_id)


def _as_utc(moment: datetime) -> datetime:
    """Read a query-string datetime as UTC when it carried no offset.

    Every lifecycle column is `timestamptz`; comparing a naive value against
    one would be resolved using whatever the session time zone happens to be.
    `app/db.py` pins that to UTC, so this makes the assumption explicit rather
    than relying on it.
    """
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment


# --- Summary -----------------------------------------------------------------


def summary(session: Session, window: ReportWindow) -> SummaryReport:
    """Build `/reports/summary` from three aggregate queries."""
    totals = repository.summary_totals(session, window)
    assignees = repository.summary_by_assignee(session, window)
    per_day = repository.summary_per_day(session, window)

    return SummaryReport(
        window=window,
        total=totals.total,
        active_total=totals.active_total,
        unassigned_total=totals.unassigned_total,
        blocked_total=_status_count(totals, IncidentStatus.BLOCKED),
        escalated_total=totals.escalated_total,
        by_status=[
            StatusCount(status=status, count=_status_count(totals, status))
            for status in IncidentStatus
        ],
        by_priority=[
            PriorityCount(priority=priority, count=_priority_count(totals, priority))
            for priority in IncidentPriority
        ],
        by_assignee=[
            AssigneeCount(
                assignee_id=row.assignee_id,
                assignee_name=row.assignee_name,
                count=row.count,
            )
            for row in assignees
        ],
        per_day=[DayCount(day=row.day, created=row.created, closed=row.closed) for row in per_day],
    )


def _status_count(row: Row[Any], status: IncidentStatus) -> int:
    """Read one status's count out of a segmented aggregate row."""
    return int(getattr(row, repository.status_label(status)))


def _priority_count(row: Row[Any], priority: IncidentPriority) -> int:
    """Read one priority's count out of a segmented aggregate row."""
    return int(getattr(row, repository.priority_label(priority)))


# --- Categories --------------------------------------------------------------


def categories(session: Session, window: ReportWindow) -> CategoriesReport:
    """Build `/reports/categories`, nesting subcategories under their group.

    The rows arrive ordered by group total and then by subcategory count, so
    walking them in order produces the groups in the right order too and
    nothing needs re-sorting.
    """
    groups: list[CategoryGroupCount] = []
    by_group_id: dict[uuid.UUID | None, CategoryGroupCount] = {}
    total = 0

    for row in repository.categories_breakdown(session, window):
        group = by_group_id.get(row.group_id)
        if group is None:
            group = CategoryGroupCount(
                group_id=row.group_id,
                group_name=row.group_name,
                count=int(row.group_total),
                subcategories=[],
            )
            by_group_id[row.group_id] = group
            groups.append(group)

        group.subcategories.append(
            SubcategoryCount(
                category_id=row.category_id,
                category_name=row.category_name,
                count=row.count,
            )
        )
        total += row.count

    return CategoriesReport(window=window, total=total, groups=groups)


# --- Locations ---------------------------------------------------------------


def locations(session: Session, window: ReportWindow) -> LocationsReport:
    """Build `/reports/locations` from one query per level of the hierarchy."""
    buildings = [
        BuildingCount(
            building_id=row.building_id,
            building_name=row.building_name,
            building_code=row.building_code,
            count=row.count,
        )
        for row in repository.top_buildings(session, window)
    ]
    floors = [
        FloorCount(
            floor_id=row.floor_id,
            floor_name=row.floor_name,
            building_id=row.building_id,
            building_code=row.building_code,
            count=row.count,
        )
        for row in repository.top_floors(session, window)
    ]
    seats = [
        SeatCount(
            seat_id=row.seat_id,
            seat_code=row.seat_code,
            seat_type=row.seat_type,
            floor_id=row.floor_id,
            floor_name=row.floor_name,
            building_id=row.building_id,
            building_code=row.building_code,
            count=row.count,
        )
        for row in repository.top_seats(session, window)
    ]

    # The building totals cover every incident in the period, floor and seat
    # being optional, so they are the honest denominator for all three lists.
    total = sum(row.count for row in buildings)
    return LocationsReport(
        window=window,
        total=total,
        buildings=buildings,
        floors=floors,
        seats=seats,
    )


# --- Response times ----------------------------------------------------------


def response_times(session: Session, window: ReportWindow) -> ResponseTimesReport:
    """Build `/reports/response-times`, overall and per priority."""
    overall = _to_response_times(repository.response_times_overall(session, window), priority=None)
    by_priority = [
        _to_response_times(row, priority=row.priority)
        for row in repository.response_times_by_priority(session, window)
    ]
    return ResponseTimesReport(window=window, overall=overall, by_priority=by_priority)


def _to_response_times(row: Row[Any], *, priority: IncidentPriority | None) -> ResponseTimes:
    """Render one row of milestone counts and medians."""
    return ResponseTimes(
        priority=priority,
        total=row.total,
        assigned_count=row.assigned_count,
        acknowledged_count=row.acknowledged_count,
        resolved_count=row.resolved_count,
        median_assign_hours=_as_float(row.median_assign_hours),
        median_acknowledge_hours=_as_float(row.median_acknowledge_hours),
        median_resolve_hours=_as_float(row.median_resolve_hours),
    )


def _as_float(value: Decimal | float | None) -> float | None:
    """Return a rounded numeric aggregate as a plain float, preserving NULL.

    PostgreSQL's `round(numeric, n)` comes back as a `Decimal`, and `None` when
    there was nothing to aggregate. `None` has to survive: "no ticket reached
    this milestone" is not "it took zero hours".
    """
    if value is None:
        return None
    return float(value)


# --- Engineer workload -------------------------------------------------------


def engineer_workload(session: Session, window: ReportWindow) -> EngineerWorkloadReport:
    """Build `/reports/engineer-workload`."""
    engineers = [
        EngineerWorkload(
            user_id=row.user_id,
            full_name=row.full_name,
            level=row.level,
            availability=row.availability,
            max_active_tickets=row.max_active_tickets,
            open_count=row.open_count,
            in_progress_count=row.in_progress_count,
            blocked_count=row.blocked_count,
            active_count=row.active_count,
            capacity_used_pct=_as_float(row.capacity_used_pct) or 0.0,
            resolved_in_period=row.resolved_in_period,
        )
        for row in repository.engineer_workload(session, window)
    ]
    return EngineerWorkloadReport(window=window, engineers=engineers)


# --- Blocked and escalated ---------------------------------------------------


def blocked_escalated(
    session: Session,
    window: ReportWindow,
    *,
    now: datetime | None = None,
) -> BlockedEscalatedReport:
    """Build `/reports/blocked-escalated`, ageing everything against `now`."""
    moment = now or utc_now()
    totals = repository.blocked_escalated_totals(session, window)

    blocked = [
        BlockedGroup(
            blocked_reason_type=row.blocked_reason_type,
            count=row.count,
            average_age_hours=_as_float(row.average_age_hours),
            max_age_hours=_as_float(row.max_age_hours),
        )
        for row in repository.blocked_groups(session, window, now=moment)
    ]
    escalated = [
        EscalatedTicket(
            incident_id=row.incident_id,
            reference=format_reference(row.ticket_number),
            title=row.title,
            status=row.status,
            priority=row.priority,
            escalation_reason=row.escalation_reason,
            escalated_at=row.escalated_at,
            age_hours=_as_float(row.age_hours),
        )
        for row in repository.escalated_tickets(session, window, now=moment)
    ]

    return BlockedEscalatedReport(
        window=window,
        blocked_total=totals.blocked_total,
        escalated_total=totals.escalated_total,
        blocked=blocked,
        escalated=escalated,
    )


# --- Communication -----------------------------------------------------------


def communication(session: Session, window: ReportWindow) -> CommunicationReport:
    """Build `/reports/communication`."""
    row = repository.communication(session, window)
    return CommunicationReport(
        window=window,
        total=row.total,
        resolved_total=row.resolved_total,
        informed_total=row.informed_total,
        informed_pct=_as_float(row.informed_pct),
        median_first_public_note_hours=_as_float(row.median_first_public_note_hours),
        reopened_total=row.reopened_total,
        reopen_rate_pct=_as_float(row.reopen_rate_pct),
    )


# --- The caller's own tickets ------------------------------------------------


def my_report(session: Session, window: ReportWindow, *, user: User) -> MyReport:
    """Build `/reports/me` for whoever is asking.

    Employees and admins get the tickets they reported. Engineers get those
    **and** the ones assigned to them, which is the pair their home screen
    shows. Nobody gets anybody else's numbers: this endpoint takes no user
    parameter, so there is nothing to tamper with.
    """
    reported = _to_personal_counts(
        repository.personal_counts(session, window, column=Incident.reporter_id, user_id=user.id)
    )

    assigned = None
    if user.role == UserRole.ENGINEER:
        assigned = _to_personal_counts(
            repository.personal_counts(
                session, window, column=Incident.assignee_id, user_id=user.id
            )
        )

    return MyReport(window=window, role=user.role, reported=reported, assigned=assigned)


def _to_personal_counts(row: Row[Any]) -> PersonalCounts:
    """Render one person's segmented counts."""
    return PersonalCounts(
        total=row.total,
        active=row.active,
        open=_status_count(row, IncidentStatus.OPEN),
        in_progress=_status_count(row, IncidentStatus.IN_PROGRESS),
        blocked=_status_count(row, IncidentStatus.BLOCKED),
        resolved=_status_count(row, IncidentStatus.RESOLVED),
        closed=_status_count(row, IncidentStatus.CLOSED),
        escalated=row.escalated,
    )
