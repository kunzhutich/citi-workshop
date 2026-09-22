"""Health probing.

Kept in the service layer rather than the router so that both the HTTP endpoint
and the `health` ops action (direct Lambda invoke) share one implementation.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.health import DatabaseHealth, HealthReport

#: Version of the HTTP API, reported by the health endpoint.
API_VERSION = "1.0.0"

logger = logging.getLogger(__name__)


def check_database(session: Session) -> DatabaseHealth:
    """Probe PostgreSQL with a trivial query and report the outcome.

    Any driver or connection failure becomes an `error` result rather than an
    exception, so a database outage degrades the health report instead of
    crashing it. Only the exception type is returned to the caller; the full
    error goes to the log, because driver messages can carry connection
    details we do not want on a public endpoint.
    """
    try:
        version = session.execute(text("SELECT version()")).scalar_one()
    except SQLAlchemyError as exc:
        logger.exception("Database health probe failed")
        return DatabaseHealth(status="error", detail=type(exc).__name__)
    return DatabaseHealth(status="ok", version=str(version))


def build_health_report(session: Session) -> HealthReport:
    """Assemble the full health report for the current environment."""
    settings = get_settings()
    database = check_database(session)
    return HealthReport(
        status="ok" if database.status == "ok" else "degraded",
        environment=settings.environment_name,
        api_version=API_VERSION,
        checked_at=datetime.now(UTC),
        database=database,
    )
