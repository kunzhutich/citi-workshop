"""Notes added to an incident by its reporter or by staff."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import NoteVisibility

if TYPE_CHECKING:
    from app.models.incident import Incident
    from app.models.user import User


class IncidentNote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A comment on an incident.

    INTERNAL notes are staff-only. That filtering happens in the query, never
    in a serializer — see ``services/visibility.py`` from M4 — so an employee's
    result set never contains one in the first place.

    Deletion is soft (``deleted_at``): the activity timeline must stay coherent
    and an audit trail cannot have holes punched in it.
    """

    __tablename__ = "incident_notes"
    __table_args__ = (
        Index("ix_incident_notes_incident_id_created_at", "incident_id", "created_at"),
    )

    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[NoteVisibility] = mapped_column(
        pg_enum(NoteVisibility, "note_visibility"),
        nullable=False,
        server_default=text("'PUBLIC'"),
    )
    edited_at: Mapped[datetime | None] = mapped_column(nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(nullable=True)

    incident: Mapped["Incident"] = relationship(back_populates="notes")
    author: Mapped["User"] = relationship()
