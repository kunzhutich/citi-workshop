"""Request and response models for incident notes."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.models.enums import NoteVisibility
from app.schemas.incident import UserSummary

NoteBody = Annotated[str, StringConstraints(min_length=1, max_length=5000)]


class NoteCreate(BaseModel):
    """A new note on an incident.

    `visibility` is fixed at creation and has no update field. Flipping a
    PUBLIC note to INTERNAL after the reporter has already read it would hide
    nothing, and flipping the other way would publish something written on the
    understanding that it was private.
    """

    body: NoteBody
    visibility: NoteVisibility = Field(
        default=NoteVisibility.PUBLIC,
        description="INTERNAL is staff-only and never reaches an employee.",
    )

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        """Trim the body, so whitespace alone cannot pass the minimum length."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class NoteUpdate(BaseModel):
    """An edit to a note's body, within the edit window."""

    body: NoteBody

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        """Trim the body, so whitespace alone cannot pass the minimum length."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class NoteRead(BaseModel):
    """A note as the activity timeline and the note list show it."""

    id: uuid.UUID
    incident_id: uuid.UUID
    author: UserSummary
    body: str
    visibility: NoteVisibility
    created_at: datetime
    edited_at: datetime | None = None
    can_edit: bool = Field(description="Whether the caller may still edit or delete this note.")
