"""Shared pytest fixtures.

Integration tests run against a real PostgreSQL database, created once per
session and brought up to date with the **actual Alembic migrations** rather
than ``Base.metadata.create_all()``. Two reasons:

* the schema uses ``create_type=False`` enums, extensions and a sequence that
  only the migration creates, so ``create_all`` could not build it anyway;
* it means every test run also proves the migration works, which is the one
  thing we cannot verify against Aurora until credentials exist.

Each test then runs inside a transaction that is rolled back afterwards, so
tests are isolated and fast without re-migrating between them.
"""

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.orm import Session

#: Database used by the test suite. Created and migrated by `_migrated_database`.
TEST_DATABASE_NAME = os.environ.get("POSTGRES_TEST_NAME", "acme_incidents_test")

#: Database connected to in order to issue CREATE DATABASE.
MAINTENANCE_DATABASE_NAME = "postgres"


def pytest_configure(config: pytest.Config) -> None:
    """Point the application at the test database before anything imports settings."""
    del config
    os.environ["IS_LOCAL"] = "true"
    os.environ["POSTGRES_NAME"] = TEST_DATABASE_NAME
    os.environ.setdefault("JWT_SECRET", "test-secret-not-used-in-any-real-environment")


@pytest.fixture(autouse=True)
def _clean_settings_cache() -> Generator[None]:
    """Drop cached settings around every test.

    ``get_settings`` is cached for the life of a warm Lambda container, so
    tests that change environment variables must clear it or they leak into
    each other.
    """
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def _migrated_database() -> Generator[Engine]:
    """Create the test database, migrate it to head, and yield an engine for it."""
    from app.config import get_settings

    settings = get_settings()
    _recreate_database(settings.database_url)
    _upgrade_to_head()

    engine = create_engine(settings.database_url, poolclass=None)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(_migrated_database: Engine) -> Generator[Session]:
    """Yield a session whose writes are rolled back when the test finishes.

    The session joins an outer transaction on a dedicated connection.
    ``join_transaction_mode="create_savepoint"`` means a ``commit()`` inside the
    code under test releases a savepoint instead of ending the outer
    transaction, so service code can commit normally and still be undone here.
    """
    connection = _migrated_database.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient]:
    """Return a test client whose requests share the test's rolled-back session."""
    from app.db import get_db
    from app.main import create_app

    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session

    with TestClient(application) as test_client:
        yield test_client

    application.dependency_overrides.clear()


def _recreate_database(target: URL) -> None:
    """Drop and recreate the test database, so every run starts from nothing.

    Most tests roll their writes back, but the ops-action tests deliberately
    commit — they exercise ``function.handler``, which owns its own session.
    Without a clean slate those rows would survive into the next run and turn
    "seed_admin creates an account" into "seed_admin found one already".

    ``WITH (FORCE)`` disconnects anyone still attached, so a forgotten psql
    session does not block the suite.
    """
    if target.database == MAINTENANCE_DATABASE_NAME:
        raise RuntimeError("Refusing to drop the maintenance database. Set POSTGRES_TEST_NAME.")

    maintenance_url = target.set(database=MAINTENANCE_DATABASE_NAME)
    engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            # Identifiers cannot be bound as parameters; the value comes from
            # our own configuration, never from user input.
            connection.execute(text(f'DROP DATABASE IF EXISTS "{target.database}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{target.database}"'))
    finally:
        engine.dispose()


def _upgrade_to_head() -> None:
    """Run the Alembic migrations against the test database."""
    from app.migrations import upgrade_to_head

    upgrade_to_head()
