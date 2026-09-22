"""The append-only audit log behind the activity timeline."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import EventType

if TYPE_CHECKING:
    from app.models.incident import Incident
    from app.models.user import User


class IncidentEvent(UUIDPrimaryKeyMixin, Base):
    """One thing that happened to an incident.

    Rows are written and never updated, so there is no ``updated_at``. Every
    workflow transition, assignment and escalation writes one. Together they
    power both the timeline the user sees and the timing metrics the reports
    compute, which is why they carry ``from_value``/``to_value`` rather than a
    rendered message.
    """

    __tablename__ = "incident_events"
    __table_args__ = (
        Index("ix_incident_events_incident_id_created_at", "incident_id", "created_at"),
    )

    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Who caused it. Nullable so a system-generated event is representable.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    event_type: Mapped[EventType] = mapped_column(
        pg_enum(EventType, "event_type"),
        nullable=False,
    )
    #: Stored as text rather than an enum: one column carries statuses,
    #: priorities and user identifiers depending on ``event_type``.
    from_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # `clock_timestamp()`, not `now()`. PostgreSQL's `now()` is the
    # transaction start time, so every event written by one request would carry
    # the same value and the timeline's ORDER BY would fall back to comparing
    # random UUIDs. See revision 0003.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.clock_timestamp(),
    )

    incident: Mapped["Incident"] = relationship(back_populates="events")
    actor: Mapped["User | None"] = relationship()
