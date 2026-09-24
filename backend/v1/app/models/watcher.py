"""Who asked to hear when a shared problem is fixed."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class IncidentWatcher(Base):
    """One person following one ticket they did not report.

    **The primary key is the pair.** "I'm affected too" is a fact about a
    person and a ticket, and it is either true or it is not — so a second
    press of the button must not be able to produce a second row. Expressing
    that as the primary key rather than as a unique index plus a surrogate
    ``id`` makes it the only shape the table can hold, and means
    ``services/watchers.py`` never has to ask "is there already one?" for
    correctness, only to decide what to say back.

    **No ``TimestampMixin``.** A watch row is written once and then either
    exists or is deleted; there is nothing on it that could be updated, so an
    ``updated_at`` beside ``created_at`` would be a column that never changes.
    That puts this table with ``notifications``, ``incident_events``,
    ``refresh_tokens`` and ``login_attempts``.

    **No index on ``user_id`` alone.** Both readers are per-incident — the
    watcher count on the ticket and the audience in ``app/notifications.py`` —
    and the primary key's leading column already serves them. "Every ticket I
    watch" is a screen that does not exist yet; the index belongs with it,
    not before it.
    """

    __tablename__ = "incident_watchers"

    #: CASCADE because a watch on a deleted ticket is meaningless. Incidents
    #: are never deleted by the application, so this is a statement about the
    #: schema rather than something that runs.
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        primary_key=True,
    )
    #: CASCADE for the same reason, and with the same caveat: accounts are
    #: deactivated rather than deleted.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    #: When they subscribed. Nothing reads it yet; it is here because "since
    #: when" is the first question anybody asks of a subscription list, and a
    #: row written without it can never answer it retrospectively.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
