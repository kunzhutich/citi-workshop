"""In-app notifications: one row per thing one person was told.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-23

Two indexes, because this table has two readers with opposite needs.

``ix_notifications_user_id_read_at`` serves the unread badge, which every open
browser tab asks for every thirty seconds and which is therefore the busiest
query in the application. ``SELECT count(*) WHERE user_id = ? AND read_at IS
NULL`` matches both columns in index order and needs no others, so PostgreSQL
answers it with an index-only scan and never touches the table.

``ix_notifications_user_id_created_at`` serves the inbox page — one user's
rows, newest first. The badge's index cannot do this job: its second column is
``read_at``, so a user's rows come out of it grouped by read state and would
have to be sorted afterwards.

``notification_type`` is created here rather than by revision 0001. 0001 used
to create every type in ``app.models.enums.ENUM_TYPES``, which meant that
adding a type to the registry changed what an already-applied revision did —
so a database created after this change would have had 0001 create
``notification_type`` and this revision fail on "type already exists". 0001 now
names the eleven types it has always created; see its docstring.

**No backfill.** Existing databases get an empty table. A backfill could honestly
reconstruct which notifications *would* have been sent — ``incident_events``
and ``incident_notes`` hold the whole history — but not which of them anybody
read, and a read-rate of 0% computed from invented rows is a worse answer than
"nothing has been sent yet". Fresh environments get demo notifications from
``app.seed.demo``; existing ones accumulate real ones from use.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The enum type this revision owns, and the values it is created with.
#:
#: Spelled out rather than read from ``app.models.enums.NotificationType``, for
#: the reason given above: a revision that reads a live application constant is
#: not frozen. Adding a fifth kind of notification is a new revision running
#: ``ALTER TYPE notification_type ADD VALUE``, not a quiet change to this one.
NOTIFICATION_TYPE = "notification_type"
NOTIFICATION_TYPE_VALUES: tuple[str, ...] = (
    "STATUS_CHANGED",
    "ASSIGNED",
    "NOTE_ADDED",
    "ESCALATION_CLEARED",
)


def upgrade() -> None:
    """Create the notification type and the notifications table."""
    values = ", ".join(f"'{value}'" for value in NOTIFICATION_TYPE_VALUES)
    op.execute(f"CREATE TYPE {NOTIFICATION_TYPE} AS ENUM ({values})")

    op.create_table(
        "notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "type",
            postgresql.ENUM(
                *NOTIFICATION_TYPE_VALUES,
                name=NOTIFICATION_TYPE,
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["incident_id"],
            ["incidents.id"],
            name=op.f("fk_notifications_incident_id_incidents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(
        "ix_notifications_user_id_read_at",
        "notifications",
        ["user_id", "read_at"],
    )
    op.create_index(
        "ix_notifications_user_id_created_at",
        "notifications",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    """Drop the notifications table and its enum type."""
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications")
    op.drop_index("ix_notifications_user_id_read_at", table_name="notifications")
    op.drop_table("notifications")
    op.execute(f"DROP TYPE IF EXISTS {NOTIFICATION_TYPE}")
