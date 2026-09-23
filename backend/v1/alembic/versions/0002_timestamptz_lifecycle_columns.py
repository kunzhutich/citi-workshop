"""Make every lifecycle timestamp timezone-aware.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-22

Revision 0001 declared the lifecycle timestamps as bare ``Mapped[datetime]``,
which SQLAlchemy renders as ``TIMESTAMP WITHOUT TIME ZONE`` — unlike
``created_at`` / ``updated_at``, which carry an explicit
``DateTime(timezone=True)``. Seven columns ended up naive in a schema where
everything else is UTC-aware:

* ``incidents.assigned_at``, ``acknowledged_at``, ``resolved_at``,
  ``closed_at``, ``escalated_at``
* ``incident_notes.edited_at``, ``deleted_at``

M4 is the phase that starts writing and comparing them, and all three ways
that mix goes wrong are load-bearing here:

1. **Python raises.** The 7-day reopen window computes
   ``now - incident.closed_at``. An aware ``now`` minus a naive ``closed_at``
   is a ``TypeError``, not a wrong answer.
2. **Clients silently mis-render.** A naive value serialises without a ``Z``,
   so the browser reads "14:03" as local time and an incident resolved an hour
   ago is shown as resolved eight hours from now.
3. **SQL silently skews.** M7's timing metrics subtract these columns from
   ``created_at``. PostgreSQL casts the naive side using the session's
   ``TimeZone``, so the same query returns different numbers depending on who
   runs it.

``USING <column> AT TIME ZONE 'UTC'`` is the correct conversion because every
value written so far came from a UTC clock; it reinterprets the stored wall
time as UTC rather than shifting it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The columns this revision converts, as (table, column) pairs.
LIFECYCLE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("incidents", "assigned_at"),
    ("incidents", "acknowledged_at"),
    ("incidents", "resolved_at"),
    ("incidents", "closed_at"),
    ("incidents", "escalated_at"),
    ("incident_notes", "edited_at"),
    ("incident_notes", "deleted_at"),
)


def upgrade() -> None:
    """Convert each naive lifecycle timestamp to ``TIMESTAMPTZ``, reading it as UTC."""
    for table, column in LIFECYCLE_COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(timezone=True),
            existing_type=sa.DateTime(),
            existing_nullable=True,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    """Convert back to naive timestamps, expressing each value in UTC."""
    for table, column in LIFECYCLE_COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
