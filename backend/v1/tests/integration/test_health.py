"""Health endpoint against a real PostgreSQL instance."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.config import API_PREFIX
from app.db import get_db
from app.main import create_app
from app.services import health as health_service


@pytest.mark.integration
def test_health_reports_ok_when_the_database_answers(client: TestClient) -> None:
    response = client.get(f"{API_PREFIX}/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "ok"
    assert "PostgreSQL" in body["database"]["version"]
    assert body["api_version"] == health_service.API_VERSION
    assert body["environment"] in {"local", "aws"}


@pytest.mark.integration
def test_openapi_is_served_under_the_api_prefix(client: TestClient) -> None:
    """CloudFront only forwards `/api/v1*`, so the schema must live there too."""
    response = client.get(f"{API_PREFIX}/openapi.json")

    assert response.status_code == 200
    assert f"{API_PREFIX}/health" in response.json()["paths"]


@pytest.mark.integration
def test_unprefixed_health_is_not_served(client: TestClient) -> None:
    """A route outside `/api/v1` would be unreachable once deployed."""
    assert client.get("/health").status_code == 404


def test_health_reports_degraded_when_the_database_is_unreachable() -> None:
    """A database outage degrades the report; it does not crash the endpoint."""
    application = create_app()
    application.dependency_overrides[get_db] = _unreachable_session

    with TestClient(application) as client:
        response = client.get(f"{API_PREFIX}/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == {"status": "error", "version": None, "detail": "OperationalError"}


class _BrokenSession:
    """Stands in for a session whose connection attempt fails."""

    def execute(self, *args: object, **kwargs: object) -> None:
        raise OperationalError("SELECT version()", {}, Exception("connection refused"))

    def close(self) -> None:
        return None


def _unreachable_session() -> _BrokenSession:
    return _BrokenSession()


def test_every_api_response_refuses_to_be_cached(client: TestClient) -> None:
    """A browser must never reuse an API response it has already seen.

    FastAPI sends no cache directives, and RFC 9111 section 4.2.2 lets a cache
    invent a freshness lifetime when the server gave none. That is not
    theoretical: after a password change the app signs the user in again and
    re-reads `/auth/me`, and a browser answered that read from its own store
    with the body from before the change. `must_change_password` was still true
    in that stale copy, so the guard returned the user to the change-password
    screen — with the correct new password, in a loop, forever.

    It only appeared once deployed, because Vite's dev proxy does not cache.
    See the decision log.

    Asserted on an error as well as a success: the middleware is registered
    outside the request logger so that responses raised before any router runs
    carry the header too.
    """
    ok = client.get("/api/v1/health")
    assert ok.status_code == 200
    assert ok.headers["cache-control"] == "no-store"

    unauthorised = client.get("/api/v1/auth/me")
    assert unauthorised.status_code == 401
    assert unauthorised.headers["cache-control"] == "no-store"
