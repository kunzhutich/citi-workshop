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
``seed_demo``
    Fill a **local** database with a plausible ninety days of ACME, so the
    dashboards have something with shape to draw. Refuses to run anywhere
    else: see `_op_seed_demo`.
"""

import logging
from collections.abc import Callable
from dataclasses import asdict, replace
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
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


#: Spec fields a `seed_demo` payload may override. Everything else about the
#: shape of the demo world is fixed in `app/seed/demo.py`, where it can be read
#: and reviewed, rather than being assembled from an invoke payload.
SEED_DEMO_OVERRIDES: tuple[str, ...] = ("incidents", "employees", "days", "random_seed")


def _op_seed_demo(event: dict[str, Any]) -> dict[str, Any]:
    """Fill a local database with the demo world. Refuses to run deployed.

    Payload: ``{"action": "seed_demo"}``, optionally with ``incidents``,
    ``employees``, ``days`` or ``random_seed`` to generate something smaller
    or different. The defaults are the numbers BUILD-PLAN section 15 asks for:
    3 buildings, 4-6 floors each, 20-40 desks and 2-3 meeting rooms per floor,
    1 admin, 6 engineers, 30 employees and ~300 incidents over 90 days, with
    the event log backdated so the timing reports mean something.

    **Refused unless `settings.is_local`.** This action invents users, signs
    them all in with one published password and writes three months of
    fictional history; none of that belongs in a database anybody is deciding
    anything from. The check is on `IS_LOCAL`, the same flag that drives
    `sslmode`, the `Secure` cookie flag and the weak-JWT-secret refusal in
    `app/config.py`, so there is one answer in this codebase to "is this
    production" rather than a second, subtly different one here. CLAUDE.md
    records the requirement; this is where it is enforced.

    **Not idempotent in the sense of topping up.** It is safe to run twice —
    the second run finds the demo buildings already present, writes nothing
    and says so — but it will not add to or refresh what is there. To
    regenerate, drop and recreate the database, then run ``migrate`` and this
    again.
    """
    # Imported here rather than at module import time, like the auth service
    # above: the demo generator pulls in bcrypt and every model, and a health
    # probe should not pay for that.
    from app.seed.demo import DEFAULT_SPEC, seed_demo

    settings = get_settings()
    # Refused in a deployed environment unless the caller says, in the payload,
    # that they know what this does. The accounts it invents share one password
    # that is published in this repository, so it must never be the accidental
    # result of an automated deploy — but a workshop demonstration running on a
    # sandbox account is a legitimate reason to want exactly this data, and
    # refusing outright meant the deployed application had nothing to show.
    #
    # The flag is deliberately verbose. `force: true` would be too easy to copy
    # from a runbook without reading it.
    if not settings.is_local and not bool(
        event.get("i_understand_this_publishes_demo_credentials")
    ):
        return {
            "created": False,
            "error": (
                "seed_demo is refused outside local development. It invents accounts "
                "with a shared, published password and three months of fictional "
                f"history; environment is '{settings.environment_name}'. Pass "
                '"i_understand_this_publishes_demo_credentials": true to proceed '
                "on a sandbox account you control."
            ),
        }

    try:
        spec = replace(DEFAULT_SPEC, **_seed_demo_overrides(event))
    except (TypeError, ValueError) as exc:
        return {"created": False, "error": str(exc)}

    def seed(session: Session) -> dict[str, Any]:
        outcome = seed_demo(session, spec)
        payload = asdict(outcome)
        # A derived property, so `asdict` does not see it, but the first thing
        # anybody reading the response wants to know.
        payload["users"] = outcome.users
        return payload

    logger.info("Seeding the demo world with %d incidents", spec.incidents)
    return _with_session(seed)


def _seed_demo_overrides(event: dict[str, Any]) -> dict[str, int]:
    """Return the spec fields the payload asks to change, validated.

    Every override is a positive integer. A payload saying ``"incidents":
    "lots"`` should produce a readable message, not a TypeError halfway through
    generating a world.
    """
    overrides: dict[str, int] = {}
    for name in SEED_DEMO_OVERRIDES:
        if event.get(name) is None:
            continue
        value = event[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"'{name}' must be a positive integer, not {value!r}.")
        overrides[name] = value
    return overrides


#: Action name -> implementation. The single registry of ops actions.
ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": _op_health,
    "migrate": _op_migrate,
    "seed_admin": _op_seed_admin,
    "seed_demo": _op_seed_demo,
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
