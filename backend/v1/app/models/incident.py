"""Incidents — the ticket at the centre of the platform."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    Text,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import BIGINT, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import (
    BlockedReasonType,
    CloseReason,
    IncidentPriority,
    IncidentStatus,
    NoteVisibility,
)

if TYPE_CHECKING:
    from app.models.building import Building
    from app.models.category import Category
    from app.models.event import IncidentEvent
    from app.models.feedback import IncidentFeedback
    from app.models.floor import Floor
    from app.models.note import IncidentNote
    from app.models.seat import Seat
    from app.models.user import User
    from app.models.watcher import IncidentWatcher

#: Human-facing ticket numbers come from a dedicated sequence rather than from
#: a count or the UUID, so they are stable, gap-tolerant and never reused.
ticket_number_seq = Sequence("incident_ticket_seq", metadata=Base.metadata)

#: Full-text search document. Title matches outrank description matches because
#: of the 'A'/'B' weights. Generated and stored by PostgreSQL, so it can never
#: drift from the columns it summarises the way an application-maintained
#: column would.
SEARCH_VECTOR_EXPRESSION = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(description, '')), 'B')"
)


class Incident(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A reported facility or workplace problem, tracked to resolution."""

    __tablename__ = "incidents"
    __table_args__ = (
        # A BLOCKED ticket must say why it is blocked. Enforced by the database
        # so no code path can produce a blocked ticket with no reason.
        CheckConstraint(
            "status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL",
            name="blocked_has_reason",
        ),
        Index("ix_incidents_search_vector", "search_vector", postgresql_using="gin"),
    )

    ticket_number: Mapped[int] = mapped_column(
        BIGINT,
        ticket_number_seq,
        nullable=False,
        unique=True,
        server_default=ticket_number_seq.next_value(),
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # --- Classification -------------------------------------------------------
    # Must be a subcategory, never a group. Enforced in the service layer,
    # which returns 422, because the rule needs a lookup the schema cannot do.
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- Location -------------------------------------------------------------
    building_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    floor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("floors.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    seat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seats.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    # --- Workflow -------------------------------------------------------------
    status: Mapped[IncidentStatus] = mapped_column(
        pg_enum(IncidentStatus, "incident_status"),
        nullable=False,
        server_default=text("'OPEN'"),
        index=True,
    )
    priority: Mapped[IncidentPriority] = mapped_column(
        pg_enum(IncidentPriority, "incident_priority"),
        nullable=False,
        server_default=text("'MEDIUM'"),
        index=True,
    )

    # --- People ---------------------------------------------------------------
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- Escalation -----------------------------------------------------------
    is_escalated: Mapped[bool] = mapped_column(nullable=False, server_default=false(), index=True)
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    escalated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- Blocking -------------------------------------------------------------
    blocked_reason_type: Mapped[BlockedReasonType | None] = mapped_column(
        pg_enum(BlockedReasonType, "blocked_reason_type"),
        nullable=True,
    )
    blocked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Resolution -----------------------------------------------------------
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Who held the ticket when it was resolved, as opposed to who holds it
    #: now. The two are usually the same person and must not be assumed to be:
    #: `services/assignment.can_assign` blocks reassignment only on CLOSED, so
    #: an admin or a lead may hand a RESOLVED ticket to somebody else, and
    #: `assignee_id` then names an engineer who did not fix it.
    #:
    #: Set by `_apply_transition_effects` on entering RESOLVED and cleared on
    #: entering IN_PROGRESS, exactly like `resolved_at` beside it — a reopened
    #: ticket has no current fix and so has nobody who made one.
    #:
    #: `services/feedback.py` copies this onto every rating, which is what
    #: keeps a review attached to the engineer it is about. The engineer
    #: reports in `repositories/reports.py` still attribute resolutions by
    #: `assignee_id` and so still carry the older, looser definition; moving
    #: them onto this column would change numbers the owner has already seen,
    #: so it is deliberately not done here. See D71.
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    close_reason: Mapped[CloseReason | None] = mapped_column(
        pg_enum(CloseReason, "close_reason"),
        nullable=True,
    )
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="SET NULL"),
        nullable=True,
    )
    reopen_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    # --- Lifecycle timestamps -------------------------------------------------
    # assigned_at and acknowledged_at are set once and never overwritten;
    # resolved_at and closed_at are cleared on reopen. `app/workflow.py` and
    # `services/incident_service.py` own those rules.
    #
    # `timezone=True` on every one of them is not decoration: the reopen window
    # subtracts `closed_at` from an aware `now`, which is a TypeError against a
    # naive column. Revision 0002 converted them.
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Search ---------------------------------------------------------------
    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed(SEARCH_VECTOR_EXPRESSION, persisted=True),
        nullable=True,
    )

    # --- Relationships --------------------------------------------------------
    category: Mapped["Category"] = relationship()
    building: Mapped["Building"] = relationship()
    floor: Mapped["Floor | None"] = relationship()
    seat: Mapped["Seat | None"] = relationship()
    reporter: Mapped["User"] = relationship(foreign_keys=[reporter_id])
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])
    # Named `escalator` and `resolver` rather than after their columns. Four
    # relationships point at `users` from this table, so each one has to name
    # its foreign key explicitly.
    escalator: Mapped["User | None"] = relationship(foreign_keys=[escalated_by])
    resolver: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])
    duplicate_of: Mapped["Incident | None"] = relationship(
        remote_side="Incident.id",
        foreign_keys=[duplicate_of_id],
    )
    notes: Mapped[list["IncidentNote"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["IncidentEvent"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
        order_by="IncidentEvent.created_at",
    )
    # Everyone who pressed "I'm affected too". Deliberately **one-way**: there
    # is no `IncidentWatcher.incident` back-reference, unlike `notes` and
    # `events` above. Nothing needs to walk from a watch row back to its
    # ticket, and the absence is what lets `app/seed/demo.py` hang watchers on
    # a throwaway `Incident` to replay a notification without a backref
    # cascading that transient object into the session.
    #
    # Eager-loaded by `repositories/incidents._detail_loaders`, which is what
    # makes `incident.watchers` an ordinary attribute by the time
    # `app/notifications.py` reads it — that module does no database access.
    watchers: Mapped[list["IncidentWatcher"]] = relationship(
        cascade="all, delete-orphan",
    )
    # Every rating left on this ticket — one per repair, so usually nought or
    # one and more only where a fix did not hold. Eager-loaded by
    # `_detail_loaders`, which is what lets
    # `services/feedback.can_give_feedback` ask "have they already rated this
    # repair?" as an attribute read rather than a query.
    #
    # Bidirectional, unlike `watchers`: an engineer's reviews page reads from
    # the rating end and names the ticket on every row, so the walk back is
    # needed. See `IncidentFeedback.incident`.
    #
    # **Unfiltered, deliberately.** This is the whole collection, not the part
    # the current reader may see; narrowing lives in
    # `services/visibility.apply_feedback_visibility` and applies to the
    # queries that build a response. A relationship that quietly hid rows
    # would make `can_give_feedback` answer yes to a reporter who has already
    # rated, on the day somebody gives reporters a narrower view than they
    # have today.
    feedback: Mapped[list["IncidentFeedback"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
        order_by="IncidentFeedback.created_at",
    )

    @property
    def last_public_note_at(self) -> datetime | None:
        """When somebody last wrote on this ticket where the reporter could read it.

        `None` when nobody has. Read by `workflow.autoclose_deadline`, which
        restarts the seven-day quiet clock on a public note: a ticket closing
        itself in the middle of a conversation is what makes an automatic
        close feel like a filing error.

        **INTERNAL notes are excluded, and deleted ones are.** The reporter
        cannot see either, so neither is evidence that anybody is waiting on a
        reply — and a ticket held open by a conversation its reporter is not
        party to would be held open invisibly.

        This reads `self.notes`, which is **not** in `_detail_loaders`: the
        only caller is the auto-close sweep, and
        `repositories/incidents.list_autoclose_candidates` eager-loads them
        for the batch it returns. It is a property rather than a column
        because it has exactly one reader, and a denormalised column with one
        reader is a second thing to keep correct on every note written.
        """
        public = [
            note.created_at
            for note in self.notes
            if note.deleted_at is None and note.visibility == NoteVisibility.PUBLIC
        ]
        return max(public) if public else None

    @property
    def reference(self) -> str:
        """Return the display form of the ticket number, for example 'INC-000123'."""
        return format_reference(self.ticket_number)


def format_reference(ticket_number: int) -> str:
    """Return the display form of a ticket number, for example 'INC-000123'.

    A module-level function as well as the property above, because the reports
    read ticket numbers out of aggregate result rows rather than out of mapped
    objects, and the padding must not be written down in two places.
    """
    return f"INC-{ticket_number:06d}"
