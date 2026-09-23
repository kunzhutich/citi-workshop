"""The JSON log format, and the rules about what may appear in it.

These test the formatter and its helpers directly rather than through a
request, because the interesting properties are properties of a *line*: that it
parses as JSON, that it carries the fields a CloudWatch query needs, and that a
field somebody named `password` never reaches the stream.
"""

import json
import logging
import uuid

import pytest

from app.observability import (
    REDACTED,
    REQUEST_ID_HEADER,
    JsonFormatter,
    _resolve_request_id,
    _route_template,
    bind_user_id,
    current_request_id,
    log_context,
    redact,
)


def record(
    message: str = "hello",
    *,
    level: int = logging.INFO,
    name: str = "app.test",
    args: tuple[object, ...] = (),
    **extra: object,
) -> logging.LogRecord:
    """Build a log record the way `logging` does, including `extra=` fields."""
    built = logging.LogRecord(
        name=name,
        level=level,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=args,
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(built, key, value)
    return built


def formatted(built: logging.LogRecord) -> dict[str, object]:
    """Format a record and parse the result back, which must be one JSON object."""
    line = JsonFormatter().format(built)
    assert "\n" not in line, "a log line must be one line, or CloudWatch splits it"
    return json.loads(line)


# --- The shape of a line -----------------------------------------------------


def test_every_line_carries_the_four_standard_fields() -> None:
    payload = formatted(record("something happened"))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "app.test"
    assert payload["message"] == "something happened"
    assert payload["timestamp"].endswith("Z")


def test_the_message_is_interpolated_not_left_as_a_template() -> None:
    payload = formatted(record("ticket %s moved to %s", args=("INC-1", "RESOLVED")))

    assert payload["message"] == "ticket INC-1 moved to RESOLVED"


def test_extra_fields_are_promoted_to_the_top_level() -> None:
    payload = formatted(record(status=500, duration_ms=12.5, route="/api/v1/incidents"))

    assert payload["status"] == 500
    assert payload["duration_ms"] == 12.5
    assert payload["route"] == "/api/v1/incidents"


def test_a_value_json_cannot_serialise_is_stringified_rather_than_dropping_the_line() -> None:
    identifier = uuid.uuid4()

    payload = formatted(record(user_id=identifier))

    assert payload["user_id"] == str(identifier)


def test_an_exception_becomes_a_traceback_field() -> None:
    try:
        raise ValueError("no")
    except ValueError:
        built = record("it failed", level=logging.ERROR)
        built.exc_info = __import__("sys").exc_info()

    payload = formatted(built)

    assert "ValueError: no" in str(payload["exception"])


def test_exc_info_false_is_not_mistaken_for_a_traceback() -> None:
    """`logger.log(..., exc_info=False)` stores `False`, not `None`.

    Formatting that as a traceback raises inside the handler, and `logging`
    swallows the error to stderr — so the line is lost entirely. Regression
    test for exactly that, which happened on the first run of this module.
    """
    built = record("no failure here")
    built.exc_info = False  # type: ignore[assignment]

    payload = formatted(built)

    assert "exception" not in payload


# --- What must never be logged ----------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "new_password",
        "access_token",
        "refresh_token",
        "jwt_secret",
        "Authorization",
        "cookie",
        "set_cookie",
        "credentials",
    ],
)
def test_a_field_that_names_a_secret_is_redacted(key: str) -> None:
    payload = formatted(record(**{key: "hunter2"}))

    assert payload[key] == REDACTED
    assert "hunter2" not in json.dumps(payload)


def test_an_ordinary_field_is_not_redacted() -> None:
    assert redact("route", "/api/v1/auth/login") == "/api/v1/auth/login"
    assert redact("user_id", "abc") == "abc"


# --- The request id ----------------------------------------------------------


def scope(headers: list[tuple[bytes, bytes]] | None = None, **extra: object) -> dict[str, object]:
    """Build a minimal HTTP ASGI scope."""
    return {"type": "http", "headers": headers or [], "path": "/api/v1/health", **extra}


def test_a_caller_supplied_request_id_is_reused() -> None:
    given = scope([(b"x-request-id", b"trace-abc-123")])

    assert _resolve_request_id(given) == "trace-abc-123"


@pytest.mark.parametrize(
    "forged",
    [
        b'bad", "level": "INFO',
        b"line\nbreak",
        b"\x1b[31mred",
        b"a" * 200,
        b"",
    ],
)
def test_a_request_id_that_could_forge_a_line_is_replaced(forged: bytes) -> None:
    given = scope([(REQUEST_ID_HEADER.encode(), forged)])

    resolved = _resolve_request_id(given)

    assert resolved != forged.decode("latin-1")
    assert len(resolved) == 32


def test_the_lambda_request_id_is_used_when_the_caller_supplies_none() -> None:
    class FakeContext:
        aws_request_id = "8f7c0d5e-0000-4000-8000-1a2b3c4d5e6f"

    given = scope(**{"aws.context": FakeContext()})

    assert _resolve_request_id(given) == FakeContext.aws_request_id


def test_without_a_request_there_is_no_request_id() -> None:
    assert current_request_id() is None


# --- The route template ------------------------------------------------------


def test_a_path_with_no_parameters_is_its_own_template() -> None:
    assert _route_template(scope(path="/api/v1/health")) == "/api/v1/health"


def test_path_parameters_are_put_back_as_placeholders() -> None:
    incident_id = uuid.uuid4()
    note_id = uuid.uuid4()
    given = scope(
        path=f"/api/v1/incidents/{incident_id}/notes/{note_id}",
        path_params={"incident_id": incident_id, "note_id": note_id},
    )

    assert _route_template(given) == "/api/v1/incidents/{incident_id}/notes/{note_id}"


def test_an_unmatched_path_keeps_its_own_spelling() -> None:
    assert _route_template(scope(path="/api/v1/nope")) == "/api/v1/nope"


# --- The per-request context -------------------------------------------------


def test_the_log_context_lives_on_the_scope_and_survives_being_read_twice() -> None:
    given = scope()

    log_context(given)["a"] = 1

    assert log_context(given) == {"a": 1}


def test_binding_a_user_records_it_as_a_string() -> None:
    given = scope()
    user_id = uuid.uuid4()

    bind_user_id(given, user_id)

    assert log_context(given) == {"user_id": str(user_id)}
