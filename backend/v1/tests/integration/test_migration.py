"""What the initial migration actually built.

These assertions run against the real, migrated database. They are the closest
thing we have to a rehearsal for the Aurora run, which cannot happen until
credentials exist: everything here except the extension-privilege question is
identical on both.
"""

import pytest
from sqlalchemy import Engine, inspect, text

from app.models import Base
from app.models.enums import ENUM_TYPES

EXPECTED_TABLES = {
    "buildings",
    "categories",
    "engineer_profiles",
    "floors",
    "incident_events",
    "incident_notes",
    "incidents",
    "refresh_tokens",
    "seats",
    "users",
}


def test_every_model_table_exists(_migrated_database: Engine) -> None:
    present = set(inspect(_migrated_database).get_table_names())

    assert present >= EXPECTED_TABLES
    assert set(Base.metadata.tables) <= present


def test_required_extensions_are_installed(_migrated_database: Engine) -> None:
    """gen_random_uuid() comes from pgcrypto; CITEXT from citext."""
    with _migrated_database.connect() as connection:
        installed = set(connection.scalars(text("SELECT extname FROM pg_extension")).all())

    assert {"pgcrypto", "citext"} <= installed


def test_every_enum_type_exists_with_the_right_values(_migrated_database: Engine) -> None:
    with _migrated_database.connect() as connection:
        for type_name, enum_cls in ENUM_TYPES.items():
            labels = connection.scalars(
                text(
                    "SELECT e.enumlabel FROM pg_enum e "
                    "JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = :name ORDER BY e.enumsortorder"
                ),
                {"name": type_name},
            ).all()
            assert labels == [member.value for member in enum_cls], type_name


def test_ticket_sequence_exists_and_advances(_migrated_database: Engine) -> None:
    with _migrated_database.connect() as connection:
        first = connection.scalar(text("SELECT nextval('incident_ticket_seq')"))
        second = connection.scalar(text("SELECT nextval('incident_ticket_seq')"))

    assert second == first + 1


def test_search_vector_is_a_stored_generated_column(_migrated_database: Engine) -> None:
    with _migrated_database.connect() as connection:
        generated = connection.scalar(
            text(
                "SELECT attgenerated FROM pg_attribute "
                "WHERE attrelid = 'incidents'::regclass AND attname = 'search_vector'"
            )
        )

    assert generated == "s", "'s' means STORED; an empty string would mean not generated"


def test_search_vector_has_a_gin_index(_migrated_database: Engine) -> None:
    with _migrated_database.connect() as connection:
        definition = connection.scalar(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE tablename = 'incidents' AND indexname = 'ix_incidents_search_vector'"
            )
        )

    assert definition is not None
    assert "USING gin" in definition


def test_category_uniqueness_covers_groups(_migrated_database: Engine) -> None:
    """NULLS NOT DISTINCT is what stops two groups sharing a name."""
    with _migrated_database.connect() as connection:
        definition = connection.scalar(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE tablename = 'categories' AND indexname = 'uq_categories_parent_id_name'"
            )
        )

    assert definition is not None
    assert "NULLS NOT DISTINCT" in definition


@pytest.mark.parametrize(
    ("table", "constraint"),
    [
        ("incidents", "ck_incidents_blocked_has_reason"),
        ("engineer_profiles", "ck_engineer_profiles_max_active_tickets_positive"),
    ],
)
def test_check_constraints_exist(_migrated_database: Engine, table: str, constraint: str) -> None:
    with _migrated_database.connect() as connection:
        found = connection.scalar(
            # Joined rather than cast with `:table::regclass`, because the `::`
            # cast confuses SQLAlchemy's bind-parameter parsing in a text().
            text(
                "SELECT c.conname FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "WHERE t.relname = :table AND c.conname = :name"
            ),
            {"table": table, "name": constraint},
        )

    assert found == constraint


def test_email_column_is_case_insensitive(_migrated_database: Engine) -> None:
    with _migrated_database.connect() as connection:
        data_type = connection.scalar(
            text(
                "SELECT udt_name FROM information_schema.columns "
                "WHERE table_name = 'users' AND column_name = 'email'"
            )
        )

    assert data_type == "citext"


def test_models_and_migration_do_not_drift() -> None:
    """A model changed without a migration would be caught here, not in production."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.db import get_engine

    with get_engine().connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        differences = compare_metadata(context, Base.metadata)

    assert differences == [], f"models and migrations disagree: {differences}"
