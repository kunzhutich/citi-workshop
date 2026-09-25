"""Feedback: the reporter's rating of a repair, and who the repair was by.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-24

Three things, because they are one feature and there is no useful state in
which a database has some of them.

``incidents.resolved_by_id`` records **who held the ticket when it was
resolved**, which is not the same question as who holds it now.
``services/assignment.can_assign`` refuses reassignment only on CLOSED, so an
admin or a lead may hand a RESOLVED ticket to a different engineer — and every
rating written after that would otherwise land on somebody who never touched
the problem. Nullable, because a ticket that has never been resolved has no
answer, and cleared again on reopen by ``_apply_transition_effects``.

``incident_feedback`` is keyed on ``(incident_id, resolution_round)``: one
rating per repair. A ticket that is reopened and fixed again earns a second,
separate rating, which is the owner's decision — a fix that did not hold is
exactly what a score should remember — and is why the pair
``(incident_id, rated_user_id)`` could not have been the key. The same
engineer may fix the same ticket twice.

**The backfill is a guess, and says so.** Every existing resolved ticket gets
``resolved_by_id = assignee_id``. That is right for every ticket that was not
reassigned after resolution and wrong for any that was, and there is no way to
tell which is which without walking ``incident_events`` for the last ASSIGNED
before each RESOLVED — a window function over the whole audit log, to correct
rows that no feature reads. The column's *purpose* is to be correct from now
on; the backfill exists so it is not half NULL for tickets whose history it
cannot recover. New rows are written by the application and are exact.

**Why ``ALTER TYPE ... ADD VALUE`` is safe here**, and the caveat revision
0006 states in full: PostgreSQL refuses to let a newly added enum value be
*used* in the transaction that added it, and Alembic runs one revision in one
transaction. Nothing below writes a ``notifications`` row, and nothing ever
should — this revision creates the *possibility* of that kind of
notification, and the application writes them from use.

**The downgrade cannot remove the enum value**, for the reason 0006 gives:
PostgreSQL has no ``ALTER TYPE ... DROP VALUE``, and undoing it means building
a replacement type and rewriting every column that uses it. The table and the
column go; ``FEEDBACK_RECEIVED`` stays, and re-upgrading finds it already
there because the ``ADD VALUE`` below is written ``IF NOT EXISTS``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The ``notification_type`` member this revision adds. Spelled out, not read
#: from ``app.models.enums.NotificationType``: a revision that reads a live
#: application constant is not frozen. See revision 0005's docstring.
FEEDBACK_RECEIVED = "FEEDBACK_RECEIVED"


def upgrade() -> None:
    """Add who resolved each ticket, the feedback table, and the notification type."""
    # First, and alone in not touching a table. Safe in this transaction
    # because nothing below writes a value of this type; see the docstring.
    op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{FEEDBACK_RECEIVED}'")

    op.add_column(
        "incidents",
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_incidents_resolved_by_id_users"),
        "incidents",
        "users",
        ["resolved_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    backfill_resolved_by()

    op.create_table(
        "incident_feedback",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rated_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resolution_round", sa.Integer(), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["incident_id"],
            ["incidents.id"],
            name=op.f("fk_incident_feedback_incident_id_incidents"),
            ondelete="CASCADE",
        ),
        # RESTRICT on both people, matching `incidents.reporter_id`: a review
        # with nobody attached at either end is unreadable, and the visibility
        # rule reads `rated_user_id` to decide who may see the row at all.
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_incident_feedback_author_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["rated_user_id"],
            ["users.id"],
            name=op.f("fk_incident_feedback_rated_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incident_feedback")),
        # One rating per repair, in the schema rather than in the service: the
        # two presses of a double click arrive as two requests, and a "does
        # one already exist?" check would pass in both of them.
        sa.UniqueConstraint(
            "incident_id",
            "resolution_round",
            name="uq_incident_feedback_incident_id_resolution_round",
        ),
        # The scale. `app/schemas/feedback.py` says the same thing to the
        # client so a form can refuse early; this is what makes a 0 or a 7
        # impossible however the row is written.
        sa.CheckConstraint(
            "rating BETWEEN 1 AND 5", name=op.f("ck_incident_feedback_rating_range")
        ),
    )
    op.create_index(
        "ix_incident_feedback_incident_id_created_at",
        "incident_feedback",
        ["incident_id", "created_at"],
    )
    op.create_index(op.f("ix_incident_feedback_author_id"), "incident_feedback", ["author_id"])
    op.create_index(
        op.f("ix_incident_feedback_rated_user_id"), "incident_feedback", ["rated_user_id"]
    )


def backfill_resolved_by() -> None:
    """Point every already-resolved ticket at its current assignee.

    The best available evidence and not a recovery of the truth — see the
    revision docstring. Restricted to rows that have been resolved, so a
    ticket still in OPEN does not acquire a resolver it has not had.

    Public, like revision 0006's backfill helper, so a test can call it
    against a seeded database: on an ordinary run the test databases are
    created empty and migrated before anything is seeded, which means this
    statement updates **nought rows** and is indistinguishable from one that
    matched nothing.
    """
    incidents = sa.table(
        "incidents",
        sa.column("resolved_at", sa.DateTime(timezone=True)),
        sa.column("assignee_id", postgresql.UUID(as_uuid=True)),
        sa.column("resolved_by_id", postgresql.UUID(as_uuid=True)),
    )
    statement = (
        incidents.update()
        .where(incidents.c.resolved_at.is_not(None))
        .where(incidents.c.assignee_id.is_not(None))
        .values(resolved_by_id=incidents.c.assignee_id)
    )
    op.execute(statement)


def downgrade() -> None:
    """Drop the feedback table and the resolver column. The enum value has to stay."""
    op.drop_table("incident_feedback")
    op.drop_constraint(op.f("fk_incidents_resolved_by_id_users"), "incidents", type_="foreignkey")
    op.drop_column("incidents", "resolved_by_id")
