"""User administration: listing, search, role changes and deactivation."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import EngineerLevel
from tests.factories import (
    DEFAULT_PASSWORD,
    auth_header,
    login,
    make_admin,
    make_engineer,
    make_user,
)


@pytest.fixture
def admin_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as a facility admin and return the Authorization header."""
    admin = make_admin(db_session, email="the.admin@acme.inc")
    return auth_header(login(client, admin.email))


@pytest.fixture
def employee_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as an ordinary employee and return the Authorization header."""
    employee = make_user(db_session)
    return auth_header(login(client, employee.email))


# --- Listing and search ------------------------------------------------------


def test_admin_lists_users_by_name(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="Zoe Zephyr")
    make_user(db_session, full_name="Aaron Able")

    response = client.get("/api/v1/users", headers=admin_headers)

    assert response.status_code == 200, response.text
    names = [item["full_name"] for item in response.json()["items"]]
    assert names[0] == "Aaron Able"
    assert "Zoe Zephyr" in names


def test_user_list_never_exposes_password_hashes(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session)

    body = client.get("/api/v1/users", headers=admin_headers).json()

    assert all("password_hash" not in item for item in body["items"])


def test_filter_by_role(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="An Employee")
    make_engineer(db_session, full_name="An Engineer")

    response = client.get("/api/v1/users?role=ENGINEER", headers=admin_headers)

    assert [item["full_name"] for item in response.json()["items"]] == ["An Engineer"]


def test_search_matches_name_or_email(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="Nina Torres", email="nina.torres@acme.inc")
    make_user(db_session, full_name="Someone Else", email="someone@acme.inc")

    by_name = client.get("/api/v1/users?q=nin", headers=admin_headers).json()
    by_email = client.get("/api/v1/users?q=NINA.TORRES@", headers=admin_headers).json()

    assert [item["full_name"] for item in by_name["items"]] == ["Nina Torres"]
    assert [item["full_name"] for item in by_email["items"]] == ["Nina Torres"]


def test_search_wildcards_are_escaped(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """A search for '%' must not match every account."""
    make_user(db_session, full_name="Ordinary Name")

    response = client.get("/api/v1/users?q=%25", headers=admin_headers)

    assert response.json()["total"] == 0


def test_underscore_is_not_a_wildcard(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="Ab")

    response = client.get("/api/v1/users?q=_", headers=admin_headers)

    assert response.json()["total"] == 0


def test_deactivated_users_are_hidden_by_default(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="Departed Person", is_active=False)

    default_page = client.get("/api/v1/users?q=Departed", headers=admin_headers)
    inclusive = client.get("/api/v1/users?q=Departed&include_inactive=true", headers=admin_headers)

    assert default_page.json()["total"] == 0
    assert inclusive.json()["total"] == 1


def test_user_list_paginates(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    for index in range(4):
        make_user(db_session, full_name=f"Page Person {index}")

    response = client.get("/api/v1/users?q=Page Person&page=2&page_size=2", headers=admin_headers)

    body = response.json()
    assert body["total"] == 4
    assert [item["full_name"] for item in body["items"]] == ["Page Person 2", "Page Person 3"]


# --- Permissions -------------------------------------------------------------


def test_employee_cannot_list_users(client: TestClient, employee_headers: dict[str, str]) -> None:
    assert client.get("/api/v1/users", headers=employee_headers).status_code == 403


def test_engineer_cannot_list_users(client: TestClient, db_session: Session) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)
    headers = auth_header(login(client, engineer.email))

    assert client.get("/api/v1/users", headers=headers).status_code == 403


def test_anonymous_cannot_list_users(client: TestClient) -> None:
    assert client.get("/api/v1/users").status_code == 401


def test_unknown_user_is_a_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get(f"/api/v1/users/{uuid.uuid4()}", headers=admin_headers)

    assert response.status_code == 404
    assert response.json()["code"] == "USER_NOT_FOUND"


# --- Role changes ------------------------------------------------------------


def test_promoting_an_employee_to_engineer_creates_a_profile(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Without a profile the new engineer would fail every level check."""
    employee = make_user(db_session, full_name="Rising Star")

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"role": "ENGINEER"},
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == "ENGINEER"

    engineer = client.get(f"/api/v1/engineers/{employee.id}", headers=admin_headers)
    assert engineer.status_code == 200
    assert engineer.json()["level"] == "JUNIOR"


def test_promotion_is_visible_on_the_next_request(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Role comes from the database per request, not from the access token."""
    employee = make_user(db_session)
    employee_token = login(client, employee.email)
    headers = auth_header(employee_token)

    assert client.get("/api/v1/engineers", headers=headers).status_code == 403

    client.patch(
        f"/api/v1/users/{employee.id}",
        json={"role": "ENGINEER"},
        headers=admin_headers,
    )

    # Same token, new role.
    assert client.get("/api/v1/engineers", headers=headers).status_code == 200


def test_demoting_an_engineer_keeps_their_profile(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """A re-promotion must restore the level they had, not reset them to JUNIOR."""
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)

    client.patch(
        f"/api/v1/users/{engineer.id}",
        json={"role": "EMPLOYEE"},
        headers=admin_headers,
    )
    assert client.get(f"/api/v1/engineers/{engineer.id}", headers=admin_headers).status_code == 404

    client.patch(
        f"/api/v1/users/{engineer.id}",
        json={"role": "ENGINEER"},
        headers=admin_headers,
    )

    restored = client.get(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)
    assert restored.json()["level"] == "LEAD"


def test_promoting_to_admin_needs_no_profile(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session)

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"role": "FACILITY_ADMIN"},
        headers=admin_headers,
    )

    assert response.json()["role"] == "FACILITY_ADMIN"


def test_an_admin_cannot_change_their_own_role(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """This is what makes the last admin account unremovable."""
    admin = client.get("/api/v1/auth/me", headers=admin_headers).json()["user"]

    response = client.patch(
        f"/api/v1/users/{admin['id']}",
        json={"role": "EMPLOYEE"},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "CANNOT_EDIT_SELF"
    assert response.json()["field"] == "role"


def test_an_admin_cannot_deactivate_themselves(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    admin = client.get("/api/v1/auth/me", headers=admin_headers).json()["user"]

    response = client.patch(
        f"/api/v1/users/{admin['id']}",
        json={"is_active": False},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["field"] == "is_active"


def test_an_admin_can_edit_their_own_name(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    """Only role and deactivation are guarded; a typo in your own name is not."""
    admin = client.get("/api/v1/auth/me", headers=admin_headers).json()["user"]

    response = client.patch(
        f"/api/v1/users/{admin['id']}",
        json={"full_name": "Corrected Name"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["full_name"] == "Corrected Name"


def test_an_admin_can_demote_another_admin(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    other_admin = make_admin(db_session, email="second.admin@acme.inc")

    response = client.patch(
        f"/api/v1/users/{other_admin.id}",
        json={"role": "EMPLOYEE"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["role"] == "EMPLOYEE"


def test_setting_the_same_role_again_is_a_no_op(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Re-sending an unchanged role must not trip the self-edit guard."""
    admin = client.get("/api/v1/auth/me", headers=admin_headers).json()["user"]

    response = client.patch(
        f"/api/v1/users/{admin['id']}",
        json={"role": "FACILITY_ADMIN"},
        headers=admin_headers,
    )

    assert response.status_code == 200


# --- Deactivation ------------------------------------------------------------


def test_deactivating_a_user_stops_them_signing_in(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session)

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"is_active": False},
        headers=admin_headers,
    )

    assert response.json()["is_active"] is False
    login_attempt = client.post(
        "/api/v1/auth/login",
        json={"email": employee.email, "password": DEFAULT_PASSWORD},
    )
    assert login_attempt.status_code == 401


def test_deactivation_revokes_live_sessions(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session)
    login(client, employee.email)

    client.patch(
        f"/api/v1/users/{employee.id}",
        json={"is_active": False},
        headers=admin_headers,
    )

    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_reactivating_a_user_restores_access(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session, is_active=False)

    client.patch(
        f"/api/v1/users/{employee.id}",
        json={"is_active": True},
        headers=admin_headers,
    )

    assert login(client, employee.email)


def test_blank_name_is_rejected(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session)

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"full_name": "   "},
        headers=admin_headers,
    )

    assert response.status_code == 422


def test_email_cannot_be_changed_through_this_endpoint(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """UserUpdate has no email field, so an attempt is ignored rather than obeyed."""
    employee = make_user(db_session, email="original@acme.inc")

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"email": "hijacked@acme.inc", "full_name": "Still Them"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["email"] == "original@acme.inc"


def test_employee_cannot_change_a_role(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    victim = make_user(db_session)

    response = client.patch(
        f"/api/v1/users/{victim.id}",
        json={"role": "FACILITY_ADMIN"},
        headers=employee_headers,
    )

    assert response.status_code == 403


def test_employee_cannot_promote_themselves(client: TestClient, db_session: Session) -> None:
    employee = make_user(db_session)
    headers = auth_header(login(client, employee.email))

    response = client.patch(
        f"/api/v1/users/{employee.id}",
        json={"role": "FACILITY_ADMIN"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_NOT_PERMITTED"
