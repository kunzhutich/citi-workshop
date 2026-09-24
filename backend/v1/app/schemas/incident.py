"""Request and response models for incidents.

The create payload mirrors the report questionnaire (build plan §7) field for
field, so the form can post what it collected without reshaping it, and the
length limits here are the ones the React form's zod schema copies.

Read models are assembled by `routers/incidents.py` from a loaded ORM row
rather than validated straight off it: an incident's response carries the
*names* of its category group, building, floor and seat, which live on four
other tables.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import (
    BlockedReasonType,
    CloseReason,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    SeatType,
    UserRole,
)

#: Length limits, shared by create and update so the two cannot drift. Long
#: enough for a real description, short enough that a title still fits on a
#: card and a list row.
IncidentTitle = Annotated[str, StringConstraints(min_length=5, max_length=120)]
IncidentDescription = Annotated[str, StringConstraints(min_length=10, max_length=5000)]
TransitionReason = Annotated[str, StringConstraints(min_length=3, max_length=1000)]
ResolutionSummary = Annotated[str, StringConstraints(min_length=3, max_length=2000)]
BlockedReasonText = Annotated[str, StringConstraints(min_length=3, max_length=1000)]
EscalationReason = Annotated[str, StringConstraints(min_length=5, max_length=1000)]

#: The separator between the parts of a rendered location path.
#: Written as an escape so the source file stays plain ASCII; ruff's RUF001
#: flags the literal character as visually ambiguous with ">".
LOCATION_SEPARATOR = " \u203a "


def _strip_or_none(value: str | None) -> str | None:
    """Trim a free-text field, treating an all-whitespace value as absent."""
    if value is None:
        return None
    return value.strip() or None


# --- Nested summaries --------------------------------------------------------


class UserSummary(BaseModel):
    """Enough of a user to name them on a ticket."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: str
    role: UserRole


class CategorySummary(BaseModel):
    """A ticket's subcategory together with the group it belongs to.

    Both are always sent. Every screen shows "Hardware > Monitor", and the
    group is what an engineer's specialties are matched against.
    """

    id: uuid.UUID
    name: str
    group_id: uuid.UUID | None = Field(description="The parent group's id.")
    group_name: str | None = None
    location_detail: LocationDetail = Field(
        description="How precise a location the group requires when reporting.",
    )
    allows_watchers: bool = Field(
        description=(
            "Whether a ticket filed under this subcategory can be followed "
            "with 'I am affected too'. Subcategory-level, unlike "
            "`location_detail`, which belongs to the group."
        ),
    )


class LocationSummary(BaseModel):
    """Where an incident was reported, with the names already resolved."""

    building_id: uuid.UUID
    building_name: str
    building_code: str
    floor_id: uuid.UUID | None = None
    floor_name: str | None = None
    seat_id: uuid.UUID | None = None
    seat_code: str | None = None
    seat_type: SeatType | None = None
    path: str = Field(
        description="Rendered path, for example 'SFO-1 > Level 3 > 3-A-01'.",
    )


# --- Requests ----------------------------------------------------------------


class IncidentCreate(BaseModel):
    """A new incident, as the report questionnaire collects it.

    `category_id` must name a **subcategory**; which location fields are
    required depends on that subcategory's group. Both rules need database
    lookups, so they are enforced in `services/incident_service.py` as 422s
    rather than here.
    """

    title: IncidentTitle
    description: IncidentDescription
    category_id: uuid.UUID = Field(description="A subcategory, never a group.")
    building_id: uuid.UUID
    floor_id: uuid.UUID | None = None
    seat_id: uuid.UUID | None = None
    priority: IncidentPriority = Field(
        default=IncidentPriority.MEDIUM,
        description="Reporters choose freely; the four levels carry plain-language hints.",
    )

    @field_validator("title", "description")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        """Trim surrounding whitespace before the length limits are applied."""
        return value.strip()


class IncidentUpdate(BaseModel):
    """A partial edit to an incident's content or priority.

    Deliberately not a way to change status, assignee or escalation: those have
    their own endpoints because each carries rules and writes an audit event.

    Permissions differ *per field* — a reporter may re-prioritise their own
    OPEN ticket but may not re-describe it once an engineer has picked it up —
    so the service checks the content fields and `priority` separately.
    """

    title: IncidentTitle | None = None
    description: IncidentDescription | None = None
    category_id: uuid.UUID | None = None
    building_id: uuid.UUID | None = None
    floor_id: uuid.UUID | None = None
    seat_id: uuid.UUID | None = None
    priority: IncidentPriority | None = None

    @field_validator("title", "description")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        """Trim surrounding whitespace, rejecting an explicit blank."""
        if value is None:
            return None
        return value.strip()


class TransitionRequest(BaseModel):
    """A request to move an incident to another status.

    Every optional field below is required by *some* transition and ignored by
    the rest. Which ones apply is `required_fields` on the matching row of
    `app/workflow.py`, which is also what
    `GET /incidents/{id}/allowed-transitions` reports, so the dialog collects
    exactly what the service will demand.
    """

    to_status: IncidentStatus
    reason: TransitionReason | None = Field(
        default=None,
        description="Why. Required when reopening, recorded on the audit event either way.",
    )
    blocked_reason_type: BlockedReasonType | None = None
    blocked_reason: BlockedReasonText | None = None
    resolution_summary: ResolutionSummary | None = None
    close_reason: CloseReason | None = None
    duplicate_of_id: uuid.UUID | None = Field(
        default=None,
        description="The original ticket. Required when closing as DUPLICATE.",
    )

    @field_validator("reason", "blocked_reason", "resolution_summary")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        """Trim free text so that whitespace never satisfies a required field."""
        return _strip_or_none(value)


class AssignRequest(BaseModel):
    """Assign an incident to an engineer, or unassign it with a null id."""

    assignee_id: uuid.UUID | None = Field(
        default=None,
        description="An active ENGINEER's user id, or null to unassign.",
    )


class EscalateRequest(BaseModel):
    """Flag an incident as needing attention, with a reason."""

    reason: EscalationReason


class ClearEscalationRequest(BaseModel):
    """Clear an escalation, saying what was done about it.

    `priority` is here because clearing an escalation and re-prioritising are
    usually the same decision: an admin who accepts the escalation raises the
    priority and clears the flag in one action.
    """

    note: TransitionReason = Field(description="What was done. Recorded on the audit event.")
    priority: IncidentPriority | None = Field(
        default=None,
        description="Optionally set the priority at the same time.",
    )

    @field_validator("note")
    @classmethod
    def _strip_note(cls, value: str) -> str:
        """Trim the note before its length limit is applied."""
        return value.strip()


# --- Responses ---------------------------------------------------------------


class IncidentListItem(BaseModel):
    """An incident as a list row: identity, state, where, who, when."""

    id: uuid.UUID
    ticket_number: int
    reference: str = Field(description="Display form of the ticket number, e.g. 'INC-000123'.")
    title: str
    status: IncidentStatus
    priority: IncidentPriority
    is_escalated: bool
    category: CategorySummary
    location: LocationSummary
    reporter: UserSummary
    assignee: UserSummary | None = None
    reopen_count: int
    created_at: datetime
    updated_at: datetime


class IncidentRead(IncidentListItem):
    """One incident in full, plus what the current caller may do to it.

    The `can_*` flags cover the actions that are **not** status changes. Status
    changes come from `GET /incidents/{id}/allowed-transitions`, which is the
    only thing the frontend may build workflow buttons from.
    """

    description: str
    escalation_reason: str | None = None
    escalated_at: datetime | None = None
    escalated_by: UserSummary | None = None
    blocked_reason_type: BlockedReasonType | None = None
    blocked_reason: str | None = None
    resolution_summary: str | None = None
    close_reason: CloseReason | None = None
    duplicate_of_id: uuid.UUID | None = None
    duplicate_of_reference: str | None = None
    assigned_at: datetime | None = None
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None

    can_edit: bool = Field(description="May change title, description, category or location.")
    can_change_priority: bool = Field(description="May change the priority.")
    can_escalate: bool = Field(description="May raise an escalation right now.")
    can_clear_escalation: bool = Field(description="May clear the current escalation.")
    can_assign: bool = Field(description="May assign or unassign this ticket.")
    can_add_note: bool = Field(description="May add a note.")
    can_add_internal_note: bool = Field(description="May add a staff-only note.")

    # Not on `IncidentListItem`, deliberately. `is_watching` is per-caller and
    # `watcher_count` costs a loaded collection, and a page of twenty-five
    # rows has no use for either — the button and the "N others are affected"
    # line are both on the detail screen.
    is_watching: bool = Field(description="Whether the caller has said they are affected too.")
    watcher_count: int = Field(description="How many people are following this ticket.")


class AllowedTransitionRead(BaseModel):
    """One action the caller may take now, as the frontend should render it.

    This is the *only* source the UI may use for workflow buttons and dialog
    fields — `action_label` is the button text and `required_fields` names
    exactly the inputs the dialog must collect.
    """

    to_status: IncidentStatus
    action_label: str
    required_fields: list[str]
    close_reason_choices: list[CloseReason] = Field(
        default_factory=list,
        description="Options for `close_reason`; empty unless it is a required field.",
    )


class AssignResult(BaseModel):
    """The outcome of an assignment, with any advisory warnings.

    Capacity and availability produce warnings rather than refusals: an admin
    who has decided to overload a lead engineer is making a judgement the
    system should record, not overrule.
    """

    incident: IncidentRead
    warnings: list[str] = Field(
        default_factory=list,
        description="Advisory messages to show after a successful assignment.",
    )


# --- Suggestions -------------------------------------------------------------


class SuggestionMatch(StrEnum):
    """How closely a suggested ticket's location matches the one being reported.

    A statement about the **overlap between the request and the row**, not
    about how precise either one is on its own. A reporter who named no seat
    can never produce a SEAT match — there is no seat of theirs for anything
    to be the same as — even though the suggested ticket may well have one.

    Part of the response rather than an implementation detail because the two
    ends of this scale are different claims, and only the reader can weigh
    them: "somebody reported this exact printer an hour ago" and "something
    printer-ish happened in this building last week" are not the same news.
    """

    SEAT = "SEAT"
    FLOOR = "FLOOR"
    BUILDING = "BUILDING"


#: Most specific first. The order is the ranking: `list.index` of a member is
#: its band, and `repositories/incidents` builds its ORDER BY from this, so
#: reordering these three reorders the suggestions and nothing else.
SUGGESTION_SPECIFICITY: tuple[SuggestionMatch, ...] = (
    SuggestionMatch.SEAT,
    SuggestionMatch.FLOOR,
    SuggestionMatch.BUILDING,
)

#: How many of each kind the panel gets. It is a prompt shown beside a form
#: the reporter is still filling in, not a list to scroll: six near-misses
#: read as noise and send them back to typing.
SUGGESTION_LIMIT = 5


class SuggestionQuery(BaseModel):
    """What the reporter has chosen so far, as the questionnaire knows it.

    `floor_id` and `seat_id` are optional because how precise a location the
    reporter was even *asked* for depends on the subcategory's group — see
    `CategorySummary.location_detail`. A BUILDING-level group never collects a
    floor, so a suggestion request for one never has one to send.
    """

    category_id: uuid.UUID = Field(description="The chosen subcategory.")
    building_id: uuid.UUID
    floor_id: uuid.UUID | None = None
    seat_id: uuid.UUID | None = None


class LiveSuggestion(IncidentListItem):
    """An unfinished ticket that may already be this problem.

    A full list row, because the answer to "is this already reported?" is
    decided by looking at the ticket — its title, its status, who has it —
    and the panel should not make the reporter open one to find out.
    """

    match: SuggestionMatch


class ResolvedSuggestion(BaseModel):
    """A finished ticket whose fix is worth reading before reporting again.

    Deliberately **not** a list row. This is institutional memory, not work in
    progress: the reporter cannot join it, chase it or be assigned to it, and
    the only fields that earn their place are what it was and what was done
    about it.

    `resolution_summary` is never null here — a resolved suggestion with
    nothing behind it is a link to a disappointment, so the query excludes it.
    `resolved_at` *can* be null, which is the one surprise: a ticket that was
    resolved, reopened and then closed keeps the summary and loses the
    timestamp, because entering IN_PROGRESS clears `resolved_at`.
    """

    id: uuid.UUID
    reference: str
    title: str
    resolution_summary: str
    resolved_at: datetime | None = None
    location: LocationSummary
    match: SuggestionMatch


class IncidentSuggestions(BaseModel):
    """What the questionnaire shows once a subcategory and a place are chosen.

    Two lists and not one merged and sorted, because they answer two
    questions. `live` answers "should I report this at all?"; `resolved`
    answers "has this been solved before, and how?". A single list ordered by
    anything would bury one of them under the other.
    """

    live: list[LiveSuggestion] = Field(default_factory=list)
    resolved: list[ResolvedSuggestion] = Field(default_factory=list)


# --- Watching ----------------------------------------------------------------


class WatchStatus(BaseModel):
    """Where a ticket's watch list stands after subscribing or unsubscribing.

    Both fields, from both endpoints, so the button and the count beside it
    are updated from one response and cannot disagree. Idempotent on both
    sides: subscribing twice is not two rows, and unsubscribing from a ticket
    you were not following is not an error.
    """

    watching: bool = Field(description="Whether the caller is now following this ticket.")
    watcher_count: int = Field(description="How many people are following it in total.")


# --- List query --------------------------------------------------------------


class IncidentSort(StrEnum):
    """Orderings `GET /incidents` accepts, in the `-field` convention.

    `priority` sorts on the PostgreSQL enum's declared order, so `-priority`
    puts CRITICAL first. Leaving `sort` out means newest first, unless the
    request is a text search, in which case it means most relevant first.
    """

    CREATED_AT = "created_at"
    CREATED_AT_DESC = "-created_at"
    PRIORITY = "priority"
    PRIORITY_DESC = "-priority"
    UPDATED_AT = "updated_at"
    UPDATED_AT_DESC = "-updated_at"
    TICKET_NUMBER = "ticket_number"


class MineFilter(StrEnum):
    """The `mine` shortcut: the caller's own tickets, by relationship."""

    REPORTED = "reported"
    ASSIGNED = "assigned"


#: `?assignee_id=unassigned` — tickets nobody owns. A sentinel value of the
#: existing filter rather than a separate boolean, so "assigned to nobody" is
#: one more answer to the same question and the two can never be combined into
#: something contradictory.
UNASSIGNED = "unassigned"

#: A user id, the unassigned sentinel, or no filter at all.
AssigneeFilter = uuid.UUID | Literal["unassigned"] | None


class IncidentQuery(BaseModel):
    """The query string of `GET /incidents`, exactly as it arrives.

    `mine` and `specialty` are shortcuts whose meaning depends on who is
    asking, so they are resolved against the caller by
    `services/incident_service.resolve_filters` before any SQL is built. This
    model is the unresolved form; `IncidentFilters` is the resolved one.
    """

    q: str | None = None
    statuses: list[IncidentStatus] = Field(default_factory=list)
    priorities: list[IncidentPriority] = Field(default_factory=list)
    group_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    building_id: uuid.UUID | None = None
    floor_id: uuid.UUID | None = None
    seat_id: uuid.UUID | None = None
    assignee_id: AssigneeFilter = None
    reporter_id: uuid.UUID | None = None
    is_escalated: bool | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    mine: MineFilter | None = None
    specialty: bool = False
    sort: IncidentSort | None = None
    closed_last: bool = False


class IncidentFilters(BaseModel):
    """Filters as the repository applies them: every value already concrete."""

    q: str | None = None
    statuses: list[IncidentStatus] = Field(default_factory=list)
    priorities: list[IncidentPriority] = Field(default_factory=list)
    group_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    building_id: uuid.UUID | None = None
    floor_id: uuid.UUID | None = None
    seat_id: uuid.UUID | None = None
    assignee_id: AssigneeFilter = None
    reporter_id: uuid.UUID | None = None
    is_escalated: bool | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    specialty_group_ids: list[uuid.UUID] | None = Field(
        default=None,
        description="Set by `specialty=true`; None means no specialty filter.",
    )
    sort: IncidentSort | None = None
    closed_last: bool = Field(
        default=False,
        description=(
            "Put CLOSED tickets after everything else, whatever `sort` says. "
            "The engineer's queue asks for it: a finished ticket is history "
            "rather than something to do."
        ),
    )
