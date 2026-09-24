"""Response models for the audit log and the activity timeline.

The timeline is three tables read as one stream: `incident_events` (what the
system recorded), `incident_notes` (what people wrote) and `incident_feedback`
(what the reporter thought of a repair). They are merged into `ActivityEntry`
rather than into one another so that no table has to carry columns it does not
need — an event has no body, a note has no from/to pair, and only a rating has
a score.

`kind` is the discriminator the frontend switches on to pick a timeline icon.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import EventType, NoteVisibility
from app.schemas.incident import UserSummary


class IncidentEventRead(BaseModel):
    """One row of the append-only audit log."""

    id: uuid.UUID
    event_type: EventType
    actor: UserSummary | None = Field(default=None, description="None for a system action.")
    from_value: str | None = None
    to_value: str | None = None
    reason: str | None = None
    created_at: datetime


class ActivityEntry(BaseModel):
    """One entry in the merged activity timeline: an event, a note or a rating.

    Only the fields belonging to its `kind` are populated. A note or a rating
    never reaches a client that may not read it — `services/visibility.py`
    filters both in the queries that build this feed, and by two different
    rules: a note's audience depends only on who is reading, a rating's also
    on who it is about.
    """

    kind: Literal["event", "note", "feedback"]
    id: uuid.UUID
    created_at: datetime
    actor: UserSummary | None = None

    # --- Set on event entries -------------------------------------------------
    event_type: EventType | None = None
    from_value: str | None = None
    to_value: str | None = None
    from_label: str | None = Field(
        default=None,
        description="Readable form of `from_value` when it is a user id.",
    )
    to_label: str | None = Field(
        default=None,
        description=(
            "Readable form of `to_value` when it is a user id. An ASSIGNED "
            "event records the assignee's id, which is right for an audit row "
            "and unreadable on a screen; this carries the name without "
            "changing what was recorded."
        ),
    )
    reason: str | None = None

    # --- Set on note entries --------------------------------------------------
    body: str | None = None
    visibility: NoteVisibility | None = None

    # --- Set on feedback entries ----------------------------------------------
    rating: int | None = Field(default=None, description="1 to 5, low to high.")
    comment: str | None = None
    rated_user: UserSummary | None = Field(
        default=None,
        description="The engineer this rating is about, who may not be the assignee now.",
    )
    resolution_round: int | None = Field(
        default=None,
        description="Which repair it rates: 1 for the first, 2 after one reopen.",
    )
    can_edit: bool | None = Field(
        default=None,
        description="Whether the caller may still change this rating.",
    )

    # --- Set on note and feedback entries -------------------------------------
    edited_at: datetime | None = None
