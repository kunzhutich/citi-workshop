"""What the reporter thought of the work, once it was done."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.incident import Incident
    from app.models.user import User


class IncidentFeedback(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One rating and comment, about one engineer's fix of one ticket.

    **Why this is a table and not two columns on ``incidents``.** A ticket can
    be fixed more than once. Reopening it sends it back to IN_PROGRESS,
    possibly into different hands, and the reporter may rate each repair — so
    the relationship is one-to-many and a pair of columns could only ever hold
    the last one. Keeping the earlier rating is the owner's decision: a fix
    that did not hold is exactly the thing a score should remember.

    **The key is ``(incident_id, resolution_round)``.** One rating per repair,
    expressed as a constraint rather than as a check in the service, so a
    double-submitted dialog cannot produce two rows. See ``resolution_round``.

    **``rated_user_id`` is a snapshot and must stay one.** It is copied from
    ``Incident.resolved_by_id`` when the row is written, never read live off
    ``Incident.assignee_id``. An admin or a lead may reassign a RESOLVED
    ticket — ``services/assignment.can_assign`` blocks only CLOSED — so the
    engineer holding a ticket today is not always the engineer who fixed it,
    and a live read would silently move somebody's review onto a colleague who
    never touched the problem.

    **``comment`` is NOT NULL.** A score with no words is a number nobody can
    act on, and the owner asked for the text on every rating rather than only
    on bad ones. The schema is where that is enforced, not the form.

    ``TimestampMixin``, unlike ``incident_watchers`` and ``notifications``,
    because this row really is editable: the author may correct it for fifteen
    minutes, the same window ``services/notes.py`` gives a note. ``edited_at``
    beside it is the same pair ``incident_notes`` carries and for the same
    reason — ``updated_at`` moves on any flush, so it cannot answer "did a
    person change this?", which is the question a reader of a review asks.
    """

    __tablename__ = "incident_feedback"
    __table_args__ = (
        # One rating per repair. A constraint rather than a "does one already
        # exist?" in the service, because the two presses of a double click
        # arrive as two requests and the second one would pass that check.
        UniqueConstraint(
            "incident_id",
            "resolution_round",
            name="uq_incident_feedback_incident_id_resolution_round",
        ),
        # The scale, in the schema. `app/schemas/feedback.py` says the same
        # thing to the client so the form can refuse early; this is what makes
        # a 0 or a 7 impossible however the row is written.
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
        # The timeline read: one ticket's ratings, oldest first, merged with
        # the events and the notes. The unique constraint's index leads on
        # `incident_id` and would serve the lookup, but it orders by
        # `resolution_round`, so PostgreSQL would sort anyway — and a ticket
        # rated twice is not necessarily rated in round order, because a
        # correction moves `updated_at` and not the round.
        Index("ix_incident_feedback_incident_id_created_at", "incident_id", "created_at"),
    )

    #: CASCADE because a rating of a ticket that no longer exists is not a row
    #: worth keeping. Incidents are never deleted by the application, so this
    #: is a statement about the schema rather than something that runs.
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Who wrote it. Always the reporter of the ticket —
    #: ``services/feedback.py`` allows nobody else — and stored anyway,
    #: because "the reporter" is a fact about the incident that a later
    #: correction to that column would rewrite, and this is a fact about who
    #: typed these words.
    #:
    #: RESTRICT, matching ``incidents.reporter_id``: an account with feedback
    #: attached cannot be deleted out from under it. Accounts are deactivated
    #: rather than deleted, so this never runs either.
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    #: The engineer being rated: ``Incident.resolved_by_id`` as it stood when
    #: this row was written. RESTRICT rather than SET NULL because a review
    #: with nobody attached is unreadable — the visibility rule in
    #: ``services/visibility.py`` uses this column to decide who may see the
    #: row at all, and a NULL there would be a review only admins could find.
    rated_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    #: Which repair this is about: 1 for the first, 2 after one reopen, and so
    #: on. Derived from ``Incident.reopen_count`` at the moment of writing and
    #: then frozen, because ``reopen_count`` keeps going up and this must not.
    #:
    #: It exists so the unique constraint above can say "one rating per
    #: repair" at all. ``(incident_id, rated_user_id)`` could not: the same
    #: engineer may fix the same ticket twice and earn two separate ratings,
    #: which the owner asked to have averaged rather than replaced.
    resolution_round: Mapped[int] = mapped_column(Integer, nullable=False)
    #: 1 to 5, low to high. A ``SMALLINT`` and not an enum: every reader of
    #: this column is an aggregate — an average, a distribution, a count of
    #: the low ones — and PostgreSQL will not average an enum. The scale's
    #: bounds live in the check constraint above instead.
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Why. NOT NULL; see the class docstring.
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    #: When the author corrected it, or NULL if they never did. Distinct from
    #: ``updated_at``, which any flush moves; this one is set by
    #: ``services/feedback.py`` and means a person changed their mind.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    #: Two relationships point at ``users`` from this table, so each names its
    #: foreign key explicitly — the same reason ``Incident`` names four.
    author: Mapped["User"] = relationship(foreign_keys=[author_id])
    rated_user: Mapped["User"] = relationship(foreign_keys=[rated_user_id])
    #: The ticket this rates. **Bidirectional, like ``incident_notes`` and
    #: unlike ``incident_watchers``**, whose one-way shape this table copied
    #: first and had to give up: an engineer's reviews are read *from the
    #: rating end* — "everything anybody said about this person" — and every
    #: row on that screen names the ticket it is about, which is the whole
    #: reason it is a page rather than a column of scores.
    incident: Mapped["Incident"] = relationship(back_populates="feedback")
