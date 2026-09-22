r"""Operational actions invoked directly on the Lambda, never over HTTP.

`function.handler` routes any event carrying an `action` key here instead of to
the ASGI app. Because Lambda direct invoke is protected by IAM and is not
reachable through the CloudFront distribution, this gives us migrations and
seeding without a second Lambda or a public maintenance endpoint:

    aws lambda invoke --function-name <name> \\
        --payload '{"action": "health"}' /dev/stdout

Later phases register `migrate`, `seed_admin` and `seed_demo` in `ACTIONS`.
"""

from collections.abc import Callable
from typing import Any

from app.db import get_session_factory
from app.services.health import build_health_report


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


#: Action name -> implementation. The single registry of ops actions.
ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": _op_health,
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
    return {"ok": True, "action": action, "result": handler(event)}
