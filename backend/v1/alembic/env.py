"""Alembic environment.

The database URL comes from ``app.config.Settings`` — the same object the
application uses — so migrations can never connect somewhere the API does not.
That matters most in the cloud, where this runs inside the Lambda through the
``migrate`` ops action rather than from a shell.

Importing ``app.models`` is what populates ``Base.metadata``; without it
autogenerate would believe the schema is empty.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.models import Base

config = context.config

if config.config_file_name is not None:
    # `disable_existing_loggers=False` is not cosmetic. `fileConfig` defaults to
    # True, which sets `disabled = True` on every logger that already exists —
    # and in the Lambda this file is imported by the in-process `migrate` ops
    # action, long after `app.*` loggers have been created. With the default, a
    # warm container goes silent after one migration: not quieter, *silent*,
    # for the rest of its life. Keeping alembic's own handlers while leaving
    # everyone else's alive is the whole intent here.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    """Return the connection URL, with the password rendered for the driver."""
    return get_settings().database_url.render_as_string(hide_password=False)


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it, for review or manual application."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Connect to the database and run migrations against it."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _database_url()

    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
