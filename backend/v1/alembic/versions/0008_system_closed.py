"""The close reason a resolved ticket that went quiet gets.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-24

One statement, and it is the smallest revision in this project. A resolved
ticket nobody came back to is closed after seven days of silence by
``services/autoclose.py``, and ``SYSTEM_CLOSED`` is what makes that a fact in
the data rather than something a reader has to infer from an audit row with a
null actor.

**Why a new member and not ``ADMIN_CLOSED``.** Reusing it would be one fewer
migration and would put a lie in every report that groups by close reason: an
admin deciding a ticket is finished and nobody deciding anything are different
events, and the second is the one somebody auditing a quiet estate wants to be
able to count separately.

``ALTER TYPE ... ADD VALUE`` is safe in this transaction for the reason
revisions 0005, 0006 and 0007 give in full: PostgreSQL refuses to let a newly
added enum value be *used* in the transaction that adds it, and nothing below
writes one. Revision 0007 added a ``notification_type`` member the same way.

**The downgrade cannot remove it.** PostgreSQL has no
``ALTER TYPE ... DROP VALUE``, and undoing it means building a replacement
type and rewriting every column that uses it — a great deal of machinery for a
value that is harmless when unused. So ``downgrade`` is a no-op that says so,
and re-upgrading finds the value already there because the ``ADD VALUE`` below
is written ``IF NOT EXISTS``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The ``close_reason`` member this revision adds. Spelled out, not read from
#: ``app.models.enums.CloseReason``: a revision that reads a live application
#: constant is not frozen. See revision 0005's docstring.
SYSTEM_CLOSED = "SYSTEM_CLOSED"


def upgrade() -> None:
    """Add the close reason an automatic close records."""
    op.execute(f"ALTER TYPE close_reason ADD VALUE IF NOT EXISTS '{SYSTEM_CLOSED}'")


def downgrade() -> None:
    """Leave the enum value in place; PostgreSQL cannot drop one.

    Deliberately a no-op rather than a raise. A downgrade that fails would
    make every revision above this one un-revertable, to protect a value that
    costs nothing while unused — and any row already carrying it would have to
    be rewritten to something untrue before it could be removed anyway.
    """
