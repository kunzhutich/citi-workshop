"""Count failed logins per email, so ten in fifteen minutes can be refused.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-23

One row per email address, holding the current run of consecutive failures.
The email is the primary key — there is no identity here beyond the address
the attempts were against, and a surrogate key would make two counters for one
address possible.

``CITEXT``, matching ``users.email``, so that ``Victim@acme.inc`` and
``victim@acme.inc`` share one counter rather than two. The extension is
already enabled by revision 0001.

**No foreign key to ``users``.** Attempts against an address with no account
are counted exactly like attempts against one that has an account; that is
what stops the lockout answering "does this person have an account here?", and
a foreign key would make it impossible to record them.

The index on ``first_failure_at`` is for the self-cleaning delete: every failed
login removes the windows that have expired, so the table stays the size of
whatever attack is happening right now rather than growing forever. Aurora
sleeps at ``min_capacity = 0``, so there is nowhere for a scheduled sweeper to
run — the table has to tidy itself on the only path that writes to it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import CITEXT

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the login-attempt counter table."""
    op.create_table(
        "login_attempts",
        sa.Column("email", CITEXT(), nullable=False),
        sa.Column("failure_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("first_failure_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email", name=op.f("pk_login_attempts")),
    )
    op.create_index(
        op.f("ix_login_attempts_first_failure_at"),
        "login_attempts",
        ["first_failure_at"],
    )


def downgrade() -> None:
    """Drop the login-attempt counter table."""
    op.drop_index(op.f("ix_login_attempts_first_failure_at"), table_name="login_attempts")
    op.drop_table("login_attempts")
