"""Ops dispatch: the direct-invoke path that keeps migrations off the public API."""

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
