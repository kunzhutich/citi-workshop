"""Ops dispatch: the direct-invoke path that keeps migrations off the public API."""

from dataclasses import fields
from typing import Any

import pytest

import function
from app.services import ops


def test_unknown_action_returns_an_error_payload() -> None:
    result = ops.run_ops("definitely-not-an-action", {})

    assert result["ok"] is False
    assert "Unknown action" in result["error"]
    assert "health" in result["error"]


def test_known_action_is_dispatched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(ops.ACTIONS, "spy", lambda event: {"saw": event.get("value")})

    result = ops.run_ops("spy", {"action": "spy", "value": 42})

    assert result == {"ok": True, "action": "spy", "result": {"saw": 42}}


def test_handler_routes_action_events_to_ops(monkeypatch: pytest.MonkeyPatch) -> None:
    """An event with an `action` key must never reach the ASGI application."""
    calls: list[tuple[str, dict[str, Any]]] = []

    def record(action: str, event: dict[str, Any]) -> dict[str, Any]:
        calls.append((action, event))
        return {"ok": True}

    monkeypatch.setattr(function, "run_ops", record)
    monkeypatch.setattr(function, "_asgi", _fail_if_called)

    response = function.handler({"action": "health"}, None)

    assert response == {"ok": True}
    assert calls == [("health", {"action": "health"})]


def test_handler_routes_http_events_to_the_asgi_app(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Function URL event has no `action` key and must reach FastAPI."""
    monkeypatch.setattr(function, "_asgi", lambda event, context: {"statusCode": 200})
    monkeypatch.setattr(function, "run_ops", _fail_if_called)

    response = function.handler({"rawPath": "/api/v1/health", "requestContext": {}}, None)

    assert response == {"statusCode": 200}


def test_handler_tolerates_an_empty_event(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(function, "_asgi", lambda event, context: {"statusCode": 200})

    assert function.handler(None, None) == {"statusCode": 200}


def _fail_if_called(*args: object, **kwargs: object) -> None:
    raise AssertionError(f"unexpected call with {args} {kwargs}")


# --- seed_demo ---------------------------------------------------------------
#
# The generator itself is tested in `tests/integration/test_seed_demo.py`
# against a real database. What is left here is the action wrapper, none of
# which needs one: its place in the registry, its refusal to run anywhere but
# local development, and its payload validation. All three return before any
# session is opened.


def test_seed_demo_is_a_registered_action() -> None:
    assert "seed_demo" in ops.ACTIONS
    assert sorted(ops.ACTIONS) == ["health", "migrate", "seed_admin", "seed_demo"]


def test_seed_demo_refuses_to_run_outside_local_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CLAUDE.md: refuse `seed_demo` when the environment is production.

    The check is on `IS_LOCAL` — the same flag that drives `sslmode`, the
    `Secure` cookie flag and the weak-JWT-secret refusal — so there is one
    answer in this codebase to "is this production".
    """
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setenv("JWT_SECRET", "a-long-enough-deployed-signing-key-for-hs256")

    result = ops.run_ops("seed_demo", {"action": "seed_demo"})["result"]

    assert result["created"] is False
    assert "refused outside local development" in result["error"]
    assert "'aws'" in result["error"]


def test_seed_demo_rejects_an_override_that_is_not_a_positive_integer() -> None:
    """A bad payload must produce a message, not a TypeError mid-generation."""
    result = ops.run_ops("seed_demo", {"action": "seed_demo", "incidents": "lots"})["result"]

    assert result["created"] is False
    assert "'incidents' must be a positive integer" in result["error"]


def test_seed_demo_rejects_an_unknown_override() -> None:
    """Only the four documented fields may be overridden from a payload."""
    from app.seed.demo import DEFAULT_SPEC

    assert set(ops.SEED_DEMO_OVERRIDES) <= {field.name for field in fields(DEFAULT_SPEC)}
    # Anything else in the payload is ignored rather than passed through, so an
    # invoke cannot reach into the shape of the demo world.
    assert ops._seed_demo_overrides({"action": "seed_demo", "buildings": 99}) == {}
