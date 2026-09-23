"""Request and response models for the reporting endpoints.

Every report answers one of the business questions in the brief. Six of them
are shaped the same way: a `window` echoing the period that was actually
measured, then the numbers. The echo is not decoration — `from` and `to` both
default, so a caller that passed neither still needs to know which thirty days
it is looking at before it can label a chart.

The other two — `/reports/blocked-escalated` and `/reports/me` — answer
present-tense questions and are **not** window-scoped. They carry a `scope`
instead: the building they were narrowed to, and the moment the snapshot was
taken. A `window` on those responses would advertise a filtering that is not
happening. See decision D9.

Two naming conventions run through this module.

* **`from` and `to` are the wire names**, because that is what the build plan
  specifies, and `from` is a Python keyword. The fields are `date_from` and
  `date_to`, aliased; `populate_by_name` keeps them constructible from Python.
* **Counts are lists, not maps**, and they carry every member of their enum
  including the zeroes. A chart that has to decide whether a missing key means
  "none" or "the server forgot" is a chart with a bug in it.

Durations are reported in **hours, rounded to two decimals**, and are `None`
when nothing in the period had reached that milestone — which is different from
zero and must stay different.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    AvailabilityStatus,
    BlockedReasonType,
    EngineerLevel,
    IncidentPriority,
    IncidentStatus,
    SeatType,
    UserRole,
)

#: How far back a report looks when the caller names no period.
DEFAULT_WINDOW_DAYS = 30

#: How many rows a "top locations" list returns per level of the hierarchy.
TOP_LOCATION_LIMIT = 10

#: How many escalated tickets `/reports/blocked-escalated` lists. Escalations
#: are meant to be rare; a period with more than this many of them is a
#: staffing problem, not a paging problem.
ESCALATED_TICKET_LIMIT = 50


class ReportWindow(BaseModel):
    """The period a report covers, and the building it was narrowed to.

    Both ends are **inclusive**, matching the `created_from` / `created_to`
    filters on `GET /incidents` so that a dashboard tile and the list it links
    to cannot disagree about which tickets are in the period.
    """

    model_config = ConfigDict(populate_by_name=True)

    date_from: datetime = Field(
        alias="from",
        description="Start of the period, inclusive. Defaults to 30 days before `to`.",
    )
    date_to: datetime = Field(
        alias="to",
        description="End of the period, inclusive. Defaults to now.",
    )
    building_id: uuid.UUID | None = Field(
        default=None,
        description="When set, only incidents reported in this building are counted.",
    )


class ReportScope(BaseModel):
    """The scope of a report that describes the present rather than a period.

    `/reports/blocked-escalated` and `/reports/me` ask *what is in this state
    now* — which incidents are blocked, what do I have open — so no date
    filter applies to them and there is no period to echo back. What they can
    honestly report is the building they were narrowed to and the instant the
    snapshot was taken. `building_id` is a scope filter, not a time filter, and
    survives here for that reason. See decision D9.
    """

    as_of: datetime = Field(description="The instant this snapshot describes.")
    building_id: uuid.UUID | None = Field(
        default=None,
        description="When set, only incidents reported in this building are counted.",
    )


class StatusCount(BaseModel):
    """How many incidents are in one status."""

    status: IncidentStatus
    count: int


class PriorityCount(BaseModel):
    """How many incidents carry one priority."""

    priority: IncidentPriority
    count: int


class AssigneeCount(BaseModel):
    """How many incidents one person holds.

    `assignee_id` and `assignee_name` are both `None` on the row counting
    tickets nobody owns, which is the row an admin looks at first.
    """

    assignee_id: uuid.UUID | None
    assignee_name: str | None
    count: int


class DayCount(BaseModel):
    """One day of the created-versus-closed series.

    Every day in the window appears, zeroes included, so the series can be
    plotted without the client reconstructing the calendar.
    """

    day: date
    created: int = Field(description="Incidents created on this day.")
    closed: int = Field(description="Incidents closed on this day, whenever they were created.")


class SummaryReport(BaseModel):
    """`/reports/summary` — what is open, and what shape the backlog is in."""

    window: ReportWindow
    total: int = Field(description="Incidents created in the period.")
    active_total: int = Field(description="Of those, still OPEN, IN_PROGRESS or BLOCKED.")
    unassigned_total: int = Field(description="Of those active tickets, the ones with no owner.")
    blocked_total: int
    escalated_total: int
    by_status: list[StatusCount]
    by_priority: list[PriorityCount]
    by_assignee: list[AssigneeCount]
    per_day: list[DayCount]


class SubcategoryCount(BaseModel):
    """How many incidents one subcategory accounts for."""

    category_id: uuid.UUID
    category_name: str
    count: int


class CategoryGroupCount(BaseModel):
    """One category group's total, with the subcategories that make it up."""

    group_id: uuid.UUID | None
    group_name: str | None
    count: int
    subcategories: list[SubcategoryCount]


class CategoriesReport(BaseModel):
    """`/reports/categories` — what people are reporting most."""

    window: ReportWindow
    total: int
    groups: list[CategoryGroupCount]


class BuildingCount(BaseModel):
    """One building's incident count."""

    building_id: uuid.UUID
    building_name: str
    building_code: str
    count: int


class FloorCount(BaseModel):
    """One floor's incident count, named with its building."""

    floor_id: uuid.UUID
    floor_name: str
    building_id: uuid.UUID
    building_code: str
    count: int


class SeatCount(BaseModel):
    """One seat's incident count, named with its floor and building."""

    seat_id: uuid.UUID
    seat_code: str
    seat_type: SeatType
    floor_id: uuid.UUID
    floor_name: str
    building_id: uuid.UUID
    building_code: str
    count: int


class LocationsReport(BaseModel):
    """`/reports/locations` — where the problems are."""

    window: ReportWindow
    total: int
    buildings: list[BuildingCount]
    floors: list[FloorCount]
    seats: list[SeatCount]


class ResponseTimes(BaseModel):
    """Median milestone times for one population of incidents.

    `priority` is `None` on the overall row. Each median is over the incidents
    that actually reached that milestone, so `median_resolve_hours` is not
    dragged down by everything still open — the counts beside it say how much
    of the population each median rests on.
    """

    priority: IncidentPriority | None
    total: int
    assigned_count: int
    acknowledged_count: int
    resolved_count: int
    median_assign_hours: float | None
    median_acknowledge_hours: float | None
    median_resolve_hours: float | None


class ResponseTimesReport(BaseModel):
    """`/reports/response-times` — how fast the team reacts."""

    window: ReportWindow
    overall: ResponseTimes
    by_priority: list[ResponseTimes]


class EngineerWorkload(BaseModel):
    """One engineer's current load and their output over the period.

    The active counts are a **snapshot of now**, not of the window: "how busy
    is this person" is a question about today. Only `resolved_in_period` is
    scoped to the window.
    """

    user_id: uuid.UUID
    full_name: str
    level: EngineerLevel
    availability: AvailabilityStatus
    max_active_tickets: int
    open_count: int
    in_progress_count: int
    blocked_count: int
    active_count: int
    capacity_used_pct: float = Field(description="active_count as a percentage of the maximum.")
    resolved_in_period: int = Field(description="Tickets this engineer resolved in the window.")


class EngineerWorkloadReport(BaseModel):
    """`/reports/engineer-workload` — who is available and who is buried."""

    window: ReportWindow
    engineers: list[EngineerWorkload]


class BlockedGroup(BaseModel):
    """Blocked tickets sharing one reason, and how long they have been stuck.

    Age runs from the moment the ticket most recently entered BLOCKED, not from
    when it was reported — a ticket raised in March and blocked yesterday has
    been blocked for a day.
    """

    blocked_reason_type: BlockedReasonType | None
    count: int
    average_age_hours: float | None
    max_age_hours: float | None


class EscalatedTicket(BaseModel):
    """One escalated ticket, with the reason someone gave for escalating it."""

    incident_id: uuid.UUID
    reference: str
    title: str
    status: IncidentStatus
    priority: IncidentPriority
    escalation_reason: str | None
    escalated_at: datetime | None
    age_hours: float | None


class BlockedEscalatedReport(BaseModel):
    """`/reports/blocked-escalated` — what is stuck, and why.

    **A live queue, not a period.** Everything currently BLOCKED is here and
    everything currently escalated is here, however long ago it was reported —
    a ticket blocked ninety days ago and still blocked is the row an admin most
    needs to see, and a thirty-day window would hide exactly that one. Only
    `building_id` narrows it. See decision D9.
    """

    scope: ReportScope
    blocked_total: int
    escalated_total: int
    blocked: list[BlockedGroup]
    escalated: list[EscalatedTicket]


class CommunicationReport(BaseModel):
    """`/reports/communication` — is anybody telling the reporter what is happening.

    A ticket counts as *informed* when at least one PUBLIC note written by an
    engineer or an admin exists on it and was written **before** it was
    resolved. A public note added after the fact is a resolution summary, not
    keeping someone posted.
    """

    window: ReportWindow
    total: int = Field(description="Incidents created in the period.")
    resolved_total: int = Field(description="Of those, the ones that reached RESOLVED or CLOSED.")
    informed_total: int = Field(description="Of those resolved, the ones kept informed first.")
    informed_pct: float | None = Field(description="None when nothing was resolved.")
    median_first_public_note_hours: float | None
    reopened_total: int
    reopen_rate_pct: float | None = Field(description="None when nothing was created.")


class PersonalCounts(BaseModel):
    """One person's ticket counts, in one capacity."""

    total: int
    active: int = Field(description="OPEN, IN_PROGRESS or BLOCKED.")
    open: int
    in_progress: int
    blocked: int
    resolved: int
    closed: int
    escalated: int


class MyReport(BaseModel):
    """`/reports/me` — the numbers a persona's home screen opens with.

    `reported` is always present: everybody can report something. `assigned` is
    present only for engineers, because only an engineer can be an assignee
    (`services/assignment.py` refuses anyone else), and a block of guaranteed
    zeroes on an employee's home screen would be worse than its absence.

    **These counts are current state, not a period.** "Open", "in progress",
    "blocked" and "awaiting your confirmation" are tiles about what is on
    somebody's plate right now, so a ticket they raised in February and is
    still open is counted. See decision D9.
    """

    scope: ReportScope
    role: UserRole
    reported: PersonalCounts
    assigned: PersonalCounts | None
