"""Running Alembic programmatically.

Kept out of ``services/ops.py`` because two very different callers need it: the
``migrate`` ops action inside the Lambda, and the test fixtures that build a
database to run against. Both need the same absolute-path handling, and
neither can rely on the working directory — the Lambda's is ``/var/task`` and
pytest's is wherever it was started.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

#: Root of the service directory: backend/v1. Resolved from this file rather
#: than from the working directory, which we do not control.
SERVICE_ROOT = Path(__file__).resolve().parents[1]


def build_alembic_config() -> Config:
    """Return an Alembic config with `script_location` pinned to an absolute path."""
    config = Config(str(SERVICE_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
    return config


def upgrade_to_head() -> None:
    """Apply every migration that has not run yet."""
    command.upgrade(build_alembic_config(), "head")
