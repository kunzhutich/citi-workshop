"""Reporting endpoints — the numbers behind the dashboards.

Every report here is **admin-only** except `/reports/me`, which answers only
about the caller and therefore needs no role at all. That split is the whole
permission story for this router: the seven aggregate reports describe the
organisation, and an employee who could read "median time to resolve by
engineer" could rank their colleagues.

`/reports/me` takes no user parameter on purpose. There is no
`?user_id=` to tamper with — the caller is the subject, resolved from the
access token, so an employee cannot read another employee's counts by
guessing an id.

Six of them cover a **period** and accept three query parameters, collected by
`get_report_window`:

* `from` — start of the period, inclusive. Defaults to 30 days before `to`.
* `to` — end of the period, inclusive. Defaults to now.
* `building_id` — optional; narrows every count to one building.

`from` and `to` are the names the build plan specifies and `from` is a Python
keyword, so the parameters are declared as `date_from` / `date_to` with query
aliases. Nothing else in the application needs to know that.

The other two — `/reports/blocked-escalated` and `/reports/me` — describe the
**present** rather than a period, so they accept `building_id` only, collected
by `get_report_scope`. "Which incidents are blocked" and "what have I got open"
are present-tense questions: a ticket blocked ninety days ago and still blocked
is the row that matters most, and a thirty-day window would hide it. They
therefore declare no `from`/`to` at all rather than accepting a period they
would ignore, and their responses carry a `scope` rather than a `window`. See
decision D9.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.schemas.report import (
    BlockedEscalatedReport,
    CategoriesReport,
    CommunicationReport,
    EngineerWorkloadReport,
    LocationsReport,
    MyReport,
    ReportScope,
    ReportWindow,
    ResponseTimesReport,
    SummaryReport,
)
from app.security.dependencies import ADMIN_ONLY, CurrentUser, DbSession
from app.services import reporting as service

router = APIRouter(prefix="/reports", tags=["reports"])

FromQuery = Annotated[
    datetime | None,
    Query(alias="from", description="Start of the period, inclusive. Default: 30 days ago."),
]
ToQuery = Annotated[
    datetime | None,
    Query(alias="to", description="End of the period, inclusive. Default: now."),
]
BuildingQuery = Annotated[
    uuid.UUID | None,
    Query(description="Only count incidents reported in this building."),
]


def get_report_window(
    date_from: FromQuery = None,
    date_to: ToQuery = None,
    building_id: BuildingQuery = None,
) -> ReportWindow:
    """Collect and validate the period every report is scoped to."""
    return service.build_window(
        date_from=date_from,
        date_to=date_to,
        building_id=building_id,
    )


#: The six period reports depend on this rather than declaring the three
#: parameters six times.
ReportPeriod = Annotated[ReportWindow, Depends(get_report_window)]


def get_report_scope(building_id: BuildingQuery = None) -> ReportScope:
    """Collect the scope of a report that describes the present, not a period."""
    return service.build_scope(building_id=building_id)


#: The two current-state reports depend on this. No `from`/`to`: see D9.
ReportScopeDep = Annotated[ReportScope, Depends(get_report_scope)]


@router.get(
    "/summary",
    response_model=SummaryReport,
    dependencies=[ADMIN_ONLY],
    summary="Backlog summary: status, priority, assignee and daily flow",
)
def get_summary(session: DbSession, window: ReportPeriod) -> SummaryReport:
    """Return what is open, how urgent it is, who holds it, and the daily flow."""
    return service.summary(session, window)


@router.get(
    "/categories",
    response_model=CategoriesReport,
    dependencies=[ADMIN_ONLY],
    summary="What people report most, by group and subcategory",
)
def get_categories(session: DbSession, window: ReportPeriod) -> CategoriesReport:
    """Return incident counts per category group, with subcategories nested."""
    return service.categories(session, window)


@router.get(
    "/locations",
    response_model=LocationsReport,
    dependencies=[ADMIN_ONLY],
    summary="Which buildings, floors and seats have the most issues",
)
def get_locations(session: DbSession, window: ReportPeriod) -> LocationsReport:
    """Return the top ten buildings, floors and seats by incident count."""
    return service.locations(session, window)


@router.get(
    "/response-times",
    response_model=ResponseTimesReport,
    dependencies=[ADMIN_ONLY],
    summary="Median time to assign, acknowledge and resolve",
)
def get_response_times(session: DbSession, window: ReportPeriod) -> ResponseTimesReport:
    """Return median milestone times, overall and per priority."""
    return service.response_times(session, window)


@router.get(
    "/engineer-workload",
    response_model=EngineerWorkloadReport,
    dependencies=[ADMIN_ONLY],
    summary="Engineer availability, current load and output",
)
def get_engineer_workload(session: DbSession, window: ReportPeriod) -> EngineerWorkloadReport:
    """Return every active engineer's live load and what they resolved in the period."""
    return service.engineer_workload(session, window)


@router.get(
    "/blocked-escalated",
    response_model=BlockedEscalatedReport,
    dependencies=[ADMIN_ONLY],
    summary="What is stuck right now, and why",
)
def get_blocked_escalated(session: DbSession, scope: ReportScopeDep) -> BlockedEscalatedReport:
    """Return blocked tickets grouped by reason with their age, and the escalations.

    A live queue, not a period: everything currently blocked or escalated is
    here however old it is, narrowed only by `building_id`.
    """
    return service.blocked_escalated(session, scope)


@router.get(
    "/communication",
    response_model=CommunicationReport,
    dependencies=[ADMIN_ONLY],
    summary="Whether reporters are being kept informed",
)
def get_communication(session: DbSession, window: ReportPeriod) -> CommunicationReport:
    """Return the share of resolved tickets updated first, and the reopen rate."""
    return service.communication(session, window)


@router.get(
    "/me",
    response_model=MyReport,
    summary="The caller's own ticket counts, as they stand now",
)
def get_my_report(session: DbSession, user: CurrentUser, scope: ReportScopeDep) -> MyReport:
    """Return the caller's own counts: reported always, assigned for engineers.

    Current state, not a period: a ticket the caller raised months ago and is
    still waiting on belongs on their home screen.
    """
    return service.my_report(session, scope, user=user)
