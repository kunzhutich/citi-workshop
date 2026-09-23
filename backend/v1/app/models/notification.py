"""One thing somebody was told about one incident."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import NotificationType

if TYPE_CHECKING:
    from app.models.incident import Incident
    from app.models.user import User


class Notification(UUIDPrimaryKeyMixin, Base):
    """A message in one user's in-app inbox.

    **The message is stored, not rendered on read.** ``message`` holds the
    sentence as it was true at the moment it was written. Rendering it at read
    time from the incident's current state would make an inbox that rewrites
    its own history: "INC-000123 is now Resolved", read a week after the ticket
    was reopened and resolved again, would silently become a sentence nobody
    was ever sent. The wording is decided once, by ``app/notifications.py``.

    **It is a pointer, never a copy.** In particular the NOTE_ADDED message
    names the author and the ticket but never quotes the note. A note can be
    edited within fifteen minutes and soft-deleted by an admin at any time —
    the usual reason being something that should not have been written down —
    and a quotation here would outlive both. Follow the link and
    ``services/visibility.py`` decides what you may read.

    **No ``TimestampMixin``.** ``read_at`` is the only thing that ever changes
    on one of these rows, and it says what happened in domain words; an
    ``updated_at`` beside it would be a second copy of the same fact. That
    puts this table with ``incident_events``, ``refresh_tokens`` and
    ``login_attempts`` — the rows whose missing mixins tell you what kind of
    row they are.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        # The unread badge polls every 30 seconds and is the most-called query
        # in the application: `WHERE user_id = ? AND read_at IS NULL`. Both
        # terms are in the index, in that order, and `count(*)` needs no other
        # column — so PostgreSQL answers it from the index alone.
        Index("ix_notifications_user_id_read_at", "user_id", "read_at"),
        # The inbox page: one user's rows, newest first. A separate index
        # because the badge's index is useless for ordering — its second
        # column is `read_at`, so rows for one user come out grouped by read
        # state and PostgreSQL would have to sort them anyway.
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
    )

    #: Who is being told. CASCADE because a notification has no meaning
    #: without its reader; accounts are deactivated rather than deleted, so
    #: this is a guarantee about the schema rather than something that runs.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: What it is about. Every notification is about a ticket — there is no
    #: system-wide announcement in this application — so this is NOT NULL and
    #: the inbox can always offer somewhere to go.
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Why it was sent. An enum rather than the ``TEXT`` the build plan
    #: sketched: three things have to agree on these four words — the rule
    #: table, the icon the inbox draws, and the report that counts them by
    #: kind — and a misspelling in any of them would be a silent no-op.
    type: Mapped[NotificationType] = mapped_column(
        pg_enum(NotificationType, "notification_type"),
        nullable=False,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    #: NULL until the reader marks it read. Nullable rather than a boolean
    #: because *when* it was read is what `/reports/communication` needs to
    #: answer "are people reading these?", and a boolean throws that away.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # `clock_timestamp()`, not `now()`, for the same reason as
    # `incident_events` and `incident_notes`: `now()` is the transaction start
    # time, and one request can write several of these. See revision 0003.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.clock_timestamp(),
    )

    user: Mapped["User"] = relationship()
    incident: Mapped["Incident"] = relationship()
