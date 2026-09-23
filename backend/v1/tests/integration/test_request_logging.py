"""One JSON line per request, and nothing secret in it.

The unit tests next door cover the format. These cover the wiring: that the
middleware is actually mounted, that it learns who the caller is from the
dependency that verified them, and — the assertion that matters most — that a
login carrying a real password produces a log line the password does not appear
in.
"""

import json
import logging
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.observability import REQUEST_ID_HEADER, JsonFormatter
from tests.factories import DEFAULT_PASSWORD, auth_header, login, make_user


class CapturingHandler(logging.Handler):
    """Keep every formatted line, so a test can assert on what was written."""

    def __init__(self) -> None:
        """Start with no lines."""
        super().__init__()
        self.setFormatter(JsonFormatter())
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        """Format the record exactly as the real handler would and keep it."""
        self.lines.append(self.format(record))

    def requests(self) -> list[dict[str, object]]:
        """Return the parsed lines the request middleware wrote."""
        parsed = [json.loads(line) for line in self.lines]
        return [entry for entry in parsed if entry.get("event") == "request"]

    def application_output(self) -> str:
        """Return every line **this application** wrote, joined.

        Scoped to `app.*` loggers on purpose. The root handler also catches
        third-party libraries, and under `TestClient` one of them is `httpx`,
        which logs the full outbound URL including its query string. That is
        the test harness talking to itself; it does not exist in the Lambda,
        where nothing makes outbound HTTP calls. Asserting over it would be
        asserting about httpx.
        """
        parsed = [json.loads(line) for line in self.lines]
        return "\n".join(
            json.dumps(entry) for entry in parsed if str(entry["logger"]).startswith("app.")
        )


@pytest.fixture
def captured_logs(client: TestClient) -> Generator[CapturingHandler]:
    """Capture log output for one test.

    Depends on `client` rather than being independent of it, and that ordering
    is load-bearing: building the app calls `configure_logging`, which
    *replaces* the root handler list. A handler attached first would be thrown
    away before the first request.
    """
    del client
    handler = CapturingHandler()
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        yield handler
    finally:
        root.removeHandler(handler)


def test_a_request_writes_one_line_with_the_fields_cloudwatch_needs(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    client.get("/api/v1/health")

    (entry,) = captured_logs.requests()
    assert entry["method"] == "GET"
    assert entry["path"] == "/api/v1/health"
    assert entry["route"] == "/api/v1/health"
    assert entry["status"] == 200
    assert isinstance(entry["duration_ms"], float)
    assert entry["request_id"]


def test_the_route_is_the_template_so_two_tickets_aggregate_as_one_route(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    client.get("/api/v1/incidents/11111111-1111-4111-8111-111111111111")
    client.get("/api/v1/incidents/22222222-2222-4222-8222-222222222222")

    routes = {entry["route"] for entry in captured_logs.requests()}
    assert routes == {"/api/v1/incidents/{incident_id}"}


def test_an_authenticated_request_records_who_made_it(
    client: TestClient, db_session: Session, captured_logs: CapturingHandler
) -> None:
    user = make_user(db_session)
    token = login(client, user.email)
    captured_logs.lines.clear()

    client.get("/api/v1/auth/me", headers=auth_header(token))

    (entry,) = captured_logs.requests()
    assert entry["user_id"] == str(user.id)


def test_an_anonymous_request_records_no_user(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    client.get("/api/v1/health")

    (entry,) = captured_logs.requests()
    assert "user_id" not in entry


def test_a_failed_request_logs_at_warning_and_a_served_one_at_info(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    client.get("/api/v1/health")
    client.get("/api/v1/incidents")

    by_status = {entry["status"]: entry["level"] for entry in captured_logs.requests()}
    assert by_status[200] == "INFO"
    assert by_status[401] == "WARNING"


def test_a_login_never_writes_the_password_or_the_tokens_it_issued(
    client: TestClient, db_session: Session, captured_logs: CapturingHandler
) -> None:
    """The one assertion this whole module exists for.

    A login is the request that carries a password in its body, returns an
    access token in its response and sets a refresh cookie — all three of the
    things that must not be logged, in one request.
    """
    user = make_user(db_session, password=DEFAULT_PASSWORD)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 200

    written = captured_logs.application_output()
    assert DEFAULT_PASSWORD not in written
    assert response.json()["access_token"] not in written
    assert response.cookies["acme_refresh_token"] not in written
    assert "authorization" not in written.lower()
    assert "set-cookie" not in written.lower()


def test_the_query_string_is_not_logged_because_it_carries_what_people_typed(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    client.get("/api/v1/incidents", params={"q": "medical room 3 incident"})

    (entry,) = captured_logs.requests()
    assert entry["path"] == "/api/v1/incidents"
    assert "medical" not in captured_logs.application_output()


def test_the_response_carries_the_id_its_line_was_logged_under(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    response = client.get("/api/v1/health")

    (entry,) = captured_logs.requests()
    assert response.headers[REQUEST_ID_HEADER] == entry["request_id"]


def test_a_request_id_supplied_by_the_caller_is_carried_through(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    response = client.get("/api/v1/health", headers={REQUEST_ID_HEADER: "edge-trace-42"})

    (entry,) = captured_logs.requests()
    assert entry["request_id"] == "edge-trace-42"
    assert response.headers[REQUEST_ID_HEADER] == "edge-trace-42"


def test_every_line_written_while_serving_a_request_carries_its_id(
    client: TestClient, db_session: Session, captured_logs: CapturingHandler
) -> None:
    """A service's own log call joins the request that caused it.

    `register_employee` logs one line of its own. It knows nothing about
    requests, and does not have to: the id travels on a context variable set
    before the application was called.
    """
    del db_session
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "joins.up@acme.inc",
            "full_name": "Joins Up",
            "password": DEFAULT_PASSWORD,
        },
    )
    assert response.status_code == 201

    parsed = [json.loads(line) for line in captured_logs.lines]
    service_lines = [entry for entry in parsed if entry["logger"] == "app.services.auth_service"]
    request_lines = [entry for entry in parsed if entry.get("event") == "request"]

    assert service_lines, "registration should log that it happened"
    assert {entry["request_id"] for entry in service_lines} == {
        entry["request_id"] for entry in request_lines
    }


def test_logging_survives_a_migration_run_in_the_same_process(
    client: TestClient, captured_logs: CapturingHandler
) -> None:
    """A `migrate` ops action must not silence the container that ran it.

    Alembic's `env.py` calls `logging.config.fileConfig`, which by default sets
    `disabled = True` on every logger that already exists and replaces the root
    handler with a plain-text one. In a warm Lambda both outlive the
    invocation, so without the two countermeasures — `disable_existing_loggers
    = False` in `env.py`, and reapplying `configure_logging` in
    `upgrade_to_head` — a single migration would end structured logging for the
    life of that container. This is the test that says so.
    """
    from app.migrations import upgrade_to_head

    upgrade_to_head()

    # Every logger is still alive — this is the assertion that fails against
    # alembic's default `disable_existing_loggers=True`.
    assert not logging.getLogger("app.observability").disabled
    assert not logging.getLogger("app.services.auth_service").disabled

    # And the root handler is ours again rather than alembic's plain-text one.
    (installed,) = logging.getLogger().handlers
    assert isinstance(installed.formatter, JsonFormatter)

    # `upgrade_to_head` reapplies `configure_logging`, which replaces the root
    # handler list — including this test's capture handler. Putting it back is
    # the honest way to look at what a *subsequent* request writes.
    logging.getLogger().addHandler(captured_logs)
    captured_logs.lines.clear()

    client.get("/api/v1/health")

    (entry,) = captured_logs.requests()
    assert entry["status"] == 200
