"""Timestamp the activity timeline with the wall clock, not the transaction clock.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-22

`incident_events.created_at` and `incident_notes.created_at` both defaulted to
`now()`, which in PostgreSQL is the **transaction** start time and is therefore
identical for every row a single transaction writes.

The activity timeline merges those two tables into one stream ordered by
`created_at`, so that default produced two wrong orderings:

1. **Within one table.** A request that writes two events — ESCALATION_CLEARED
   plus PRIORITY_CHANGED from one clear-escalation call, STATUS_CHANGED plus
   MARKED_DUPLICATE from closing as a duplicate — gave both rows the same
   timestamp, and the `(created_at, id)` tiebreak fell back to comparing random
   UUIDs.
2. **Across the two tables.** Anything that writes a note and an event under
   one transaction interleaves them by transaction start rather than by when
   each was written. The test suite runs every request inside one outer
   transaction, so this is also the difference between a suite that reflects
   production ordering and one that does not.

`clock_timestamp()` is read per row at insert time, so rows are microseconds
apart and sort in the order they happened. Only these two tables change: they
are the ones read as an ordered stream. Everything else keeps `now()`, where a
per-transaction timestamp is the more useful of the two.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The tables whose `created_at` feeds the activity timeline.
TIMELINE_TABLES: tuple[str, ...] = ("incident_events", "incident_notes")


def _set_default(expression: str) -> None:
    """Point both timeline tables' `created_at` at one default expression."""
    for table in TIMELINE_TABLES:
        op.alter_column(
            table,
            "created_at",
            server_default=sa.text(expression),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=False,
        )


def upgrade() -> None:
    """Default timeline timestamps from the wall clock."""
    _set_default("clock_timestamp()")


def downgrade() -> None:
    """Restore the transaction-clock default."""
    _set_default("now()")
