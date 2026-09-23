"""Engineer creation, the temporary password, workload counts and permissions."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import AvailabilityStatus, EngineerLevel, IncidentStatus
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_incident,
    make_user,
)


@pytest.fixture
def admin_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as a facility admin and return the Authorization header."""
    admin = make_admin(db_session)
    return auth_header(login(client, admin.email))


@pytest.fixture
def employee_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as an ordinary employee and return the Authorization header."""
    employee = make_user(db_session)
    return auth_header(login(client, employee.email))


# --- Creation ----------------------------------------------------------------


def test_admin_creates_an_engineer_with_a_temporary_password(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    building = make_building(db_session)

    response = client.post(
        "/api/v1/engineers",
        json={
            "email": "Nina.Torres@acme.inc",
            "full_name": "Nina Torres",
            "level": "SENIOR",
            "specialty_group_ids": [str(group.id)],
            "home_building_id": str(building.id),
            "phone": "+1 555 0101",
            "max_active_tickets": 8,
        },
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    engineer = body["engineer"]
    assert engineer["email"] == "nina.torres@acme.inc"
    assert engineer["level"] == "SENIOR"
    assert engineer["specialty_group_ids"] == [str(group.id)]
    assert engineer["home_building_id"] == str(building.id)
    assert engineer["max_active_tickets"] == 8
    assert engineer["active_ticket_count"] == 0
    assert engineer["availability"] == "AVAILABLE"
    assert len(body["temporary_password"]) >= 12


def test_a_new_engineer_must_change_their_password(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    """The temporary password has been seen by an admin, so it cannot stay in use."""
    created = client.post(
        "/api/v1/engineers",
        json={"email": "gated@acme.inc", "full_name": "Gated Engineer"},
        headers=admin_headers,
    ).json()

    token = login(client, "gated@acme.inc", created["temporary_password"])
    blocked = client.get("/api/v1/engineers", headers=auth_header(token))

    assert blocked.status_code == 403
    assert blocked.json()["code"] == "PASSWORD_CHANGE_REQUIRED"


def test_the_temporary_password_is_not_stored_in_plain_text(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    from app.repositories import users as user_repository

    created = client.post(
        "/api/v1/engineers",
        json={"email": "hashed@acme.inc", "full_name": "Hashed Engineer"},
        headers=admin_headers,
    ).json()

    stored = user_repository.get_by_email(db_session, "hashed@acme.inc")

    assert stored is not None
    assert stored.password_hash != created["temporary_password"]
    assert stored.password_hash.startswith("$2b$")


def test_engineer_email_must_be_an_acme_address(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/engineers",
        json={"email": "contractor@acme.inc.evil.com", "full_name": "Not Ours"},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_EMAIL_DOMAIN"


def test_duplicate_engineer_email_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, email="taken@acme.inc")

    response = client.post(
        "/api/v1/engineers",
        json={"email": "taken@acme.inc", "full_name": "Second Claim"},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_TAKEN"


def test_a_specialty_must_be_a_group_not_a_subcategory(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    subcategory = make_category(db_session, parent=group)

    response = client.post(
        "/api/v1/engineers",
        json={
            "email": "specialist@acme.inc",
            "full_name": "Specialist",
            "specialty_group_ids": [str(subcategory.id)],
        },
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_SPECIALTY_GROUP"
    assert response.json()["field"] == "specialty_group_ids"


def test_an_unknown_home_building_is_refused(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/engineers",
        json={
            "email": "nowhere@acme.inc",
            "full_name": "Nowhere",
            "home_building_id": str(uuid.uuid4()),
        },
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["field"] == "home_building_id"


def test_max_active_tickets_must_be_positive(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/engineers",
        json={"email": "zero@acme.inc", "full_name": "Zero Capacity", "max_active_tickets": 0},
        headers=admin_headers,
    )

    assert response.status_code == 422


def test_employee_cannot_create_an_engineer(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/engineers",
        json={"email": "self.promoted@acme.inc", "full_name": "Self Promoted"},
        headers=employee_headers,
    )

    assert response.status_code == 403


# --- Workload ----------------------------------------------------------------


def test_active_ticket_count_counts_only_live_statuses(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)
    building = make_building(db_session)
    group = make_category(db_session)
    subcategory = make_category(db_session, parent=group)
    reporter = make_user(db_session)

    live = (IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED)
    finished = (IncidentStatus.RESOLVED, IncidentStatus.CLOSED)
    for status in live + finished:
        make_incident(
            db_session,
            reporter=reporter,
            category=subcategory,
            building=building,
            assignee=engineer,
            status=status,
        )

    response = client.get(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)

    assert response.json()["active_ticket_count"] == len(live)


def test_tickets_assigned_to_someone_else_are_not_counted(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)
    other = make_engineer(db_session)
    building = make_building(db_session)
    subcategory = make_category(db_session, parent=make_category(db_session))
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=subcategory,
        building=building,
        assignee=other,
    )

    response = client.get(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)

    assert response.json()["active_ticket_count"] == 0


def test_each_engineer_in_a_list_gets_its_own_count(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    busy = make_engineer(db_session, full_name="Busy Engineer")
    idle = make_engineer(db_session, full_name="Idle Engineer")
    building = make_building(db_session)
    subcategory = make_category(db_session, parent=make_category(db_session))
    reporter = make_user(db_session)
    for _ in range(3):
        make_incident(
            db_session,
            reporter=reporter,
            category=subcategory,
            building=building,
            assignee=busy,
        )

    items = client.get("/api/v1/engineers", headers=admin_headers).json()["items"]

    counts = {item["full_name"]: item["active_ticket_count"] for item in items}
    assert counts[busy.full_name] == 3
    assert counts[idle.full_name] == 0


# --- Listing and filters -----------------------------------------------------


def test_engineers_are_listed_by_name(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_engineer(db_session, full_name="Zoe Last")
    make_engineer(db_session, full_name="Adam First")

    items = client.get("/api/v1/engineers", headers=admin_headers).json()["items"]

    assert [item["full_name"] for item in items] == ["Adam First", "Zoe Last"]


def test_employees_are_not_engineers(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_user(db_session, full_name="Just An Employee")
    make_engineer(db_session, full_name="Real Engineer")

    items = client.get("/api/v1/engineers", headers=admin_headers).json()["items"]

    assert [item["full_name"] for item in items] == ["Real Engineer"]


def test_filter_by_level(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_engineer(db_session, level=EngineerLevel.LEAD, full_name="Lead One")
    make_engineer(db_session, level=EngineerLevel.JUNIOR, full_name="Junior One")

    items = client.get("/api/v1/engineers?level=LEAD", headers=admin_headers).json()["items"]

    assert [item["full_name"] for item in items] == ["Lead One"]


def test_filter_by_availability(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_engineer(db_session, availability=AvailabilityStatus.ON_LEAVE, full_name="Away")
    make_engineer(db_session, availability=AvailabilityStatus.AVAILABLE, full_name="Here")

    items = client.get("/api/v1/engineers?availability=AVAILABLE", headers=admin_headers).json()

    assert [item["full_name"] for item in items["items"]] == ["Here"]


def test_filter_by_specialty_group(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    # Both groups take generated names. A fixture named after a seeded group
    # ("Hardware", "Network & Access", ...) collides with the rows
    # `test_ops_actions.py` commits, in whichever runs that file goes first.
    speciality = make_category(db_session)
    other_group = make_category(db_session)
    created = client.post(
        "/api/v1/engineers",
        json={
            "email": "network.specialist@acme.inc",
            "full_name": "Network Specialist",
            "specialty_group_ids": [str(speciality.id)],
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    make_engineer(db_session, full_name="Generalist")

    matching = client.get(f"/api/v1/engineers?group_id={speciality.id}", headers=admin_headers)
    other = client.get(f"/api/v1/engineers?group_id={other_group.id}", headers=admin_headers)

    assert [item["full_name"] for item in matching.json()["items"]] == ["Network Specialist"]
    assert other.json()["total"] == 0


def test_filter_by_home_building(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)
    client.post(
        "/api/v1/engineers",
        json={
            "email": "local@acme.inc",
            "full_name": "Local Engineer",
            "home_building_id": str(building.id),
        },
        headers=admin_headers,
    )
    make_engineer(db_session, full_name="Remote Engineer")

    items = client.get(
        f"/api/v1/engineers?building_id={building.id}", headers=admin_headers
    ).json()["items"]

    assert [item["full_name"] for item in items] == ["Local Engineer"]


def test_deactivated_engineers_are_hidden_by_default(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_engineer(db_session, full_name="Present", is_active=True)
    make_engineer(db_session, full_name="Departed", is_active=False)

    default_page = client.get("/api/v1/engineers", headers=admin_headers)
    inclusive = client.get("/api/v1/engineers?include_inactive=true", headers=admin_headers)

    default_names = [item["full_name"] for item in default_page.json()["items"]]

    assert default_names == ["Present"]
    assert {item["full_name"] for item in inclusive.json()["items"]} == {"Present", "Departed"}


def test_engineers_may_read_the_roster(client: TestClient, db_session: Session) -> None:
    """The Team page is an engineer screen, so reading is not admin-only."""
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)
    headers = auth_header(login(client, engineer.email))

    assert client.get("/api/v1/engineers", headers=headers).status_code == 200


def test_employees_cannot_read_the_roster(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    assert client.get("/api/v1/engineers", headers=employee_headers).status_code == 403


def test_unknown_engineer_is_a_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get(f"/api/v1/engineers/{uuid.uuid4()}", headers=admin_headers)

    assert response.status_code == 404
    assert response.json()["code"] == "ENGINEER_NOT_FOUND"


def test_an_employee_id_is_not_an_engineer(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    employee = make_user(db_session)

    response = client.get(f"/api/v1/engineers/{employee.id}", headers=admin_headers)

    assert response.status_code == 404


# --- Updating ----------------------------------------------------------------


def test_admin_promotes_an_engineer(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.JUNIOR)

    response = client.patch(
        f"/api/v1/engineers/{engineer.id}",
        json={"level": "LEAD"},
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["level"] == "LEAD"


def test_patch_only_touches_the_fields_sent(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR, max_active_tickets=7)

    response = client.patch(
        f"/api/v1/engineers/{engineer.id}",
        json={"phone": "+1 555 0199"},
        headers=admin_headers,
    )

    body = response.json()
    assert body["phone"] == "+1 555 0199"
    assert body["level"] == "SENIOR"
    assert body["max_active_tickets"] == 7


def test_admin_updates_the_full_name_on_the_user_row(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """`full_name` lives on users, not the profile, so it must be routed there."""
    engineer = make_engineer(db_session, full_name="Old Name")

    response = client.patch(
        f"/api/v1/engineers/{engineer.id}",
        json={"full_name": "New Name"},
        headers=admin_headers,
    )

    assert response.json()["full_name"] == "New Name"
    assert (
        client.get("/api/v1/engineers", headers=admin_headers).json()["items"][0]["full_name"]
        == "New Name"
    )


def test_update_rejects_a_specialty_that_is_not_a_group(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)
    subcategory = make_category(db_session, parent=make_category(db_session))

    response = client.patch(
        f"/api/v1/engineers/{engineer.id}",
        json={"specialty_group_ids": [str(subcategory.id)]},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_SPECIALTY_GROUP"


def test_engineer_sets_their_own_availability(client: TestClient, db_session: Session) -> None:
    engineer = make_engineer(db_session)
    headers = auth_header(login(client, engineer.email))

    response = client.patch(
        "/api/v1/engineers/me",
        json={"availability": "BUSY", "phone": "+1 555 0123"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["availability"] == "BUSY"
    assert response.json()["phone"] == "+1 555 0123"


def test_engineer_cannot_promote_themselves(client: TestClient, db_session: Session) -> None:
    """EngineerSelfUpdate has no `level` field, so the attempt is ignored, not obeyed."""
    engineer = make_engineer(db_session, level=EngineerLevel.JUNIOR)
    headers = auth_header(login(client, engineer.email))

    response = client.patch(
        "/api/v1/engineers/me",
        json={"availability": "BUSY", "level": "LEAD"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["level"] == "JUNIOR"


def test_engineer_cannot_edit_another_engineer(client: TestClient, db_session: Session) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)
    other = make_engineer(db_session)
    headers = auth_header(login(client, engineer.email))

    response = client.patch(
        f"/api/v1/engineers/{other.id}",
        json={"level": "JUNIOR"},
        headers=headers,
    )

    assert response.status_code == 403


def test_admin_has_no_profile_of_their_own(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Admins edit engineers through /engineers/{id}; they are not engineers."""
    response = client.patch(
        "/api/v1/engineers/me",
        json={"availability": "BUSY"},
        headers=admin_headers,
    )

    assert response.status_code == 403


# --- Deactivation ------------------------------------------------------------


def test_delete_deactivates_rather_than_removing(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)

    response = client.delete(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)

    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is False
    assert response.json()["deactivated"] is True

    still_there = client.get(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)
    assert still_there.status_code == 200
    assert still_there.json()["is_active"] is False


def test_a_deactivated_engineer_cannot_sign_in(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)

    client.delete(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": engineer.email, "password": "correct-horse-battery-staple"},
    )
    assert response.status_code == 401


def test_deactivation_revokes_live_sessions(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """An already-signed-in engineer must not keep working after being removed."""
    engineer = make_engineer(db_session)
    login(client, engineer.email)

    client.delete(f"/api/v1/engineers/{engineer.id}", headers=admin_headers)

    refreshed = client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 401


def test_employee_cannot_deactivate_an_engineer(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    engineer = make_engineer(db_session)

    response = client.delete(f"/api/v1/engineers/{engineer.id}", headers=employee_headers)

    assert response.status_code == 403
