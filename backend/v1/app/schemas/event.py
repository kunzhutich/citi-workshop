"""Response models for the audit log and the activity timeline.

The timeline is two tables read as one stream: `incident_events` (what the
system recorded) and `incident_notes` (what people wrote). They are merged
into `ActivityEntry` rather than into one another so that neither table has to
carry columns it does not need — an event has no body, a note has no
from/to pair.

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
    """One entry in the merged activity timeline: an event or a note.

    Only the fields belonging to its `kind` are populated. A note entry never
    reaches a client that may not read it — `services/visibility.py` filters
    the notes in the query that builds this feed.
    """

    kind: Literal["event", "note"]
    id: uuid.UUID
    created_at: datetime
    actor: UserSummary | None = None

    # --- Set on event entries -------------------------------------------------
    event_type: EventType | None = None
    from_value: str | None = None
    to_value: str | None = None
    reason: str | None = None

    # --- Set on note entries --------------------------------------------------
    body: str | None = None
    visibility: NoteVisibility | None = None
    edited_at: datetime | None = None
