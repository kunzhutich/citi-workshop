r"""Operational actions invoked directly on the Lambda, never over HTTP.

``function.handler`` routes any event carrying an ``action`` key here instead of
to the ASGI app. Because Lambda direct invoke is protected by IAM and is not
reachable through the CloudFront distribution, this gives us migrations and
seeding without a second Lambda or a public maintenance endpoint:

    aws lambda invoke --function-name <name> \
        --payload '{"action": "migrate"}' /dev/stdout

The same actions run locally against the development database, which is how
they are tested — Aurora is not publicly accessible, so a direct invoke is the
only way to reach it at all.

Actions available now:

``health``
    Report API and database health.
``migrate``
    Bring the schema to head, then seed the category reference data.
``seed_admin``
    Create the first FACILITY_ADMIN account.

``seed_demo`` arrives in M7 and must refuse to run against production.
"""

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.db import get_session_factory
from app.migrations import upgrade_to_head
from app.seed.categories import seed_categories
from app.services.health import build_health_report

logger = logging.getLogger(__name__)


def _with_session(work: Callable[[Session], dict[str, Any]]) -> dict[str, Any]:
    """Run `work` in a session, committing on success and closing either way."""
    session = get_session_factory()()
    try:
        result = work(session)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _op_health(event: dict[str, Any]) -> dict[str, Any]:
    """Report API and database health without going through CloudFront.

    Useful for confirming that the Lambda can reach Aurora inside the VPC,
    which cannot be tested from a developer machine because Aurora is not
    publicly accessible.
    """
    del event  # This action takes no parameters.
    session = get_session_factory()()
    try:
        report = build_health_report(session)
    finally:
        session.close()
    return report.model_dump(mode="json")


def _op_migrate(event: dict[str, Any]) -> dict[str, Any]:
    """Upgrade the schema to head and seed the category reference data.

    Seeding is part of this action, not a separate one, because the report
    questionnaire cannot render without categories — a migrated but unseeded
    database is not a usable one. Both halves are idempotent, so running this
    against an up-to-date database is a no-op.
    """
    del event  # This action takes no parameters.
    logger.info("Running Alembic upgrade to head")
    upgrade_to_head()

    def seed(session: Session) -> dict[str, Any]:
        result = seed_categories(session)
        return {
            "groups_created": result.groups_created,
            "subcategories_created": result.subcategories_created,
            "already_present": result.already_present,
            "groups": result.group_names,
        }

    return {"schema": "upgraded to head", "categories": _with_session(seed)}


def _op_seed_admin(event: dict[str, Any]) -> dict[str, Any]:
    """Create the first FACILITY_ADMIN, the account every other one is made from.

    There is no way to register an admin through the API — self-registration
    always produces an EMPLOYEE — so this is the only bootstrap path.

    Payload: ``{"action": "seed_admin", "email": ..., "full_name": ...,
    "password": ...}``. ``password`` may be omitted, in which case one is
    generated and returned **once**, in the invoke response; it is never stored
    in plain text or written to the log.

    Idempotent: if the email already exists the account is left untouched.
    """
    # Imported here rather than at module import time: the auth service pulls
    # in bcrypt and PyJWT, and the health action should not pay for that.
    from app.services.auth_service import seed_first_admin

    email = str(event.get("email") or "").strip()
    full_name = str(event.get("full_name") or "Facility Admin").strip()
    password = event.get("password")

    if not email:
        return {"created": False, "error": "An 'email' is required to seed an admin."}

    def seed(session: Session) -> dict[str, Any]:
        return seed_first_admin(
            session,
            email=email,
            full_name=full_name,
            password=str(password) if password else None,
        )

    return _with_session(seed)


#: Action name -> implementation. The single registry of ops actions.
ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": _op_health,
    "migrate": _op_migrate,
    "seed_admin": _op_seed_admin,
}


def run_ops(action: str, event: dict[str, Any]) -> dict[str, Any]:
    """Run a named ops action and return its result as a plain dictionary.

    Unknown actions return an error payload rather than raising, so a typo in
    an invoke payload produces a readable message instead of a stack trace.
    """
    handler = ACTIONS.get(action)
    if handler is None:
        return {
            "ok": False,
            "action": action,
            "error": f"Unknown action '{action}'. Known actions: {sorted(ACTIONS)}.",
        }
    logger.info("Running ops action %s", action)
    return {"ok": True, "action": action, "result": handler(event)}
