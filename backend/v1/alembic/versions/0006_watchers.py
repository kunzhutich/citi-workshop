"""Watchers: "I'm affected too", and the subcategories that offer it.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-24

Three things, because they are one feature and there is no useful state in
which a database has some of them.

``incident_watchers`` is **keyed on the pair** ``(incident_id, user_id)``
rather than on a surrogate ``id``, so a second press of the button cannot
produce a second row. Both foreign keys cascade: a watch on a ticket that no
longer exists, or held by an account that no longer exists, is not a row worth
keeping.

``categories.allows_watchers`` decides where the button is offered at all. It
is NOT NULL with a server default of false, so every existing subcategory
becomes personal the moment this runs — which is the right default and the
wrong *answer* for the seventeen subcategories the owner decided are shared,
hence the backfill below.

**Why ``ALTER TYPE ... ADD VALUE`` is safe here and would not always be.**
PostgreSQL refuses to let a newly added enum value be *used* in the same
transaction that added it, and Alembic runs one revision in one transaction.
Adding the value is fine; inserting a ``notifications`` row with
``type = 'WATCHED_RESOLVED'`` in this revision would fail with "unsafe use of
new value of enum type". Nothing below writes a notification, and nothing ever
should: this revision creates the *possibility* of that kind of notification,
and the application writes them from use.

**The backfill overwrites nothing, by construction.** ``allows_watchers`` did
not exist until four statements ago, so no administrator can have had an
opinion about it yet. That matters because it is the one and only moment this
mapping may be applied to rows that already exist: ``app.seed.categories``
deliberately sets the flag only on subcategories it *inserts*, since
``seed_categories`` runs on every ``migrate`` and a deploy that silently
reverted an admin's decision would be worse than a deploy that left it alone.
So the initial value is the owner's list, applied once, here; every value
after that is the admin's.

**The mapping is spelled out rather than imported**, for the reason revision
0005 gives about ``NotificationType``: a revision that reads a live
application constant is not frozen, and this one has to keep saying what it
said on the day it ran even after somebody edits the seed table. The live copy
lives on ``CategoryGroupSeed.shared_subcategories`` in
``app/seed/categories.py``, and the two are kept honest by
``tests/integration/test_seed_categories.py``, which asserts the seeded flag
against the seed table on a freshly migrated database.

The mapping is keyed on **(group, subcategory)**, never on the subcategory
name alone. Six subcategories in the tree are called "Other" and this list
contains two of them — Meeting Rooms and Building & Facilities are shared,
Network & Access is not.

**The downgrade cannot remove the enum value.** PostgreSQL has no
``ALTER TYPE ... DROP VALUE``; undoing it means creating a replacement type,
rewriting every column that uses it and dropping the old one, which is a great
deal of machinery for a value that is harmless when unused. The table and the
column go; ``WATCHED_RESOLVED`` stays, and re-upgrading finds it already there
because the ``ADD VALUE`` below is written ``IF NOT EXISTS``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The ``notification_type`` member this revision adds. Spelled out, not read
#: from ``app.models.enums.NotificationType`` — see the docstring.
WATCHED_RESOLVED = "WATCHED_RESOLVED"

#: ``(group name, subcategory name)`` for every subcategory that starts life
#: shared. Frozen: a snapshot of the owner's decision as it stood on the day
#: this revision was written.
SHARED_SUBCATEGORIES: tuple[tuple[str, str], ...] = (
    ("Hardware", "Printer/Scanner"),
    ("Network & Access", "Wi-Fi"),
    ("Network & Access", "Wired Network"),
    ("Network & Access", "Badge/Door Access"),
    ("Meeting Rooms", "Display/Projector"),
    ("Meeting Rooms", "Video Conferencing"),
    ("Meeting Rooms", "Audio/Microphone"),
    ("Meeting Rooms", "Other"),
    ("Building & Facilities", "Temperature/HVAC"),
    ("Building & Facilities", "Lighting"),
    ("Building & Facilities", "Plumbing/Restroom"),
    ("Building & Facilities", "Power/Outlets"),
    ("Building & Facilities", "Furniture"),
    ("Building & Facilities", "Cleaning"),
    ("Building & Facilities", "Kitchen/Appliances"),
    ("Building & Facilities", "Safety Hazard"),
    ("Building & Facilities", "Other"),
)


def _categories_table() -> sa.Table:
    """Return a minimal ``categories`` table for the backfill statement.

    Declared here rather than imported from ``app.models`` so the statement
    describes the schema as this revision knows it, and keeps working after a
    column is added to the model.
    """
    return sa.table(
        "categories",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("parent_id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.Text()),
        sa.column("allows_watchers", sa.Boolean()),
    )


def upgrade() -> None:
    """Add the watchers table, the subcategory flag, and the notification type."""
    # First, and alone in not touching a table. Safe in this transaction
    # because nothing below writes a value of this type; see the docstring.
    op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{WATCHED_RESOLVED}'")

    op.create_table(
        "incident_watchers",
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["incident_id"],
            ["incidents.id"],
            name=op.f("fk_incident_watchers_incident_id_incidents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_incident_watchers_user_id_users"),
            ondelete="CASCADE",
        ),
        # The pair is the key: one person watches one ticket at most once.
        sa.PrimaryKeyConstraint("incident_id", "user_id", name=op.f("pk_incident_watchers")),
    )

    op.add_column(
        "categories",
        sa.Column(
            "allows_watchers",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    apply_the_shared_mapping()


def apply_the_shared_mapping() -> None:
    """Turn the flag on for the seventeen subcategories that start shared.

    One ``UPDATE ... FROM``, joining each subcategory to its group so the
    match is on the pair. A statement per pair would be seventeen round trips
    to say one thing.

    Public, unusually for a revision helper, because
    ``tests/integration/test_seed_categories.py`` calls it against a seeded
    tree. The test databases are created empty and migrated before anything
    is seeded, so this statement updates **nought rows** on every ordinary
    run — indistinguishable from a row-value ``IN`` that matches nothing —
    and the whole point of it is the rows it changes.
    """
    categories = _categories_table()
    groups = categories.alias("category_groups")

    statement = (
        categories.update()
        .where(categories.c.parent_id == groups.c.id)
        .where(sa.tuple_(groups.c.name, categories.c.name).in_(SHARED_SUBCATEGORIES))
        .values(allows_watchers=True)
    )
    op.execute(statement)


def downgrade() -> None:
    """Drop the watchers table and the flag. The enum value has to stay."""
    op.drop_column("categories", "allows_watchers")
    op.drop_table("incident_watchers")
