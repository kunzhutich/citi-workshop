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

from app.schemas.common import Page, Paging, build_page
from app.schemas.feedback import MAX_RATING, MIN_RATING
from app.schemas.report import (
    BlockedEscalatedReport,
    CategoriesReport,
    CommunicationReport,
    EngineerDetailReport,
    EngineerReview,
    EngineerWorkloadReport,
    LocationsReport,
    MyReport,
    ReportScope,
    ReportWindow,
    ResponseTimesReport,
    SummaryReport,
)
from app.security.dependencies import ADMIN_ONLY, CurrentUser, DbSession, StaffUser
from app.services import reporting as service

router = APIRouter(prefix="/reports", tags=["reports"])

#: One score to narrow an engineer's reviews to. Bounded by the scale rather
#: than validated in the handler, so a 7 is a 422 before any query runs.
RatingFilter = Annotated[
    int | None,
    Query(ge=MIN_RATING, le=MAX_RATING, description="Show only reviews with this score."),
]

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
    "/engineers/{user_id}",
    response_model=EngineerDetailReport,
    summary="One engineer's output over a period, how it was rated, and what came back",
)
def get_engineer_detail(
    user_id: uuid.UUID, session: DbSession, user: StaffUser, window: ReportPeriod
) -> EngineerDetailReport:
    """Return what this engineer resolved in the window, how it was rated, and the reopen signal.

    **Staff, not admin only**, and that is the one thing about this route worth
    reading twice. `StaffUser` is the guard as well as the caller: it is
    `require_roles(ENGINEER, FACILITY_ADMIN)`, so the route needs no separate
    `dependencies=[STAFF_ONLY]` beside it — that pair would be one check
    written twice. Seven of the other reports are `ADMIN_ONLY`; this one backs
    the engineer profile page, which a LEAD opens to decide who to hand work
    to and which an engineer can open on themselves. An employee cannot —
    §5.5 of the redesign brief is explicit that an employee must not reach an
    engineer's profile, and this dependency is what enforces it rather than the
    absence of a link on a screen.

    The caller is taken for one field. Every figure here is the same for any
    member of staff, including the satisfaction average and its distribution —
    the owner's rule is that engineers may see each other's *scores*. Only
    `can_read_reviews` depends on who is asking, and it gates the sentences.
    """
    return service.engineer_detail(session, user_id, window, user)


@router.get(
    "/engineers/{user_id}/reviews",
    response_model=Page[EngineerReview],
    summary="The individual reviews behind one engineer's rating",
)
def get_engineer_reviews(
    user_id: uuid.UUID,
    session: DbSession,
    user: StaffUser,
    window: ReportPeriod,
    paging: Paging,
    rating: RatingFilter = None,
) -> Page[EngineerReview]:
    """Return one page of this engineer's reviews, newest first.

    Gated by `services/visibility.apply_feedback_visibility` rather than by a
    check here, so this list can never disagree with the ticket timeline about
    who may read a rating. A colleague at the same level gets an **empty page
    rather than a 403** — the same answer `GET /incidents/{id}/feedback`
    gives, for the reason it gives: a status code that distinguished "there
    are none" from "there are some and they are not yours" would leak the
    second.

    Windowed on the ticket's `resolved_at`, exactly like the figures on the
    report above, so the list a reader arrives at by clicking "18 of 26
    resolved rated" contains those eighteen and nothing else.

    `rating` narrows to one score. It is what makes this screen answer the
    question people actually arrive with — "show me the unhappy ones" — and
    the distribution on the report above is the control that sets it.
    """
    items, total = service.engineer_reviews(
        session, user_id=user_id, viewer=user, window=window, rating=rating, paging=paging
    )
    return build_page(items, total=total, params=paging)


@router.get(
    "/blocked-escalated",
    response_model=BlockedEscalatedReport,
    dependencies=[ADMIN_ONLY],
    summary="What is stuck right now, and why",
)
def get_blocked_escalated(session: DbSession, scope: ReportScopeDep) -> BlockedEscalatedReport:
    """Return blocked tickets grouped by reason with their age, and the escalations.

    A live queue, not a period: everything currently blocked or escalated is
    here however old it is, narrowed only by `building_id`. "Currently
    escalated" means a flagged ticket that is still open, in progress or
    blocked — a closed one keeps the flag as history but needs no attention.
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
