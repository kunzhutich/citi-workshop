"""Buildings, floors, seats, bulk create and the facility tree.

Covers the rules M3 introduces: uniqueness per level, deletion refused while
incidents reference a location, deactivation as the alternative, and who is
allowed to write.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import SeatType
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_floor,
    make_incident,
    make_seat,
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


# --- Buildings ---------------------------------------------------------------


def test_admin_creates_a_building(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/buildings",
        json={"name": "San Francisco HQ", "code": "sfo-1", "address": "1 Market St"},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "San Francisco HQ"
    # Codes are uppercased so `sfo-1` and `SFO-1` cannot both exist.
    assert body["code"] == "SFO-1"
    assert body["is_active"] is True


def test_building_names_are_trimmed(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/buildings",
        json={"name": "  Austin Campus  ", "code": " aus-2 "},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["name"] == "Austin Campus"
    assert response.json()["code"] == "AUS-2"


def test_blank_building_name_is_rejected(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/buildings",
        json={"name": "   ", "code": "BLANK-1"},
        headers=admin_headers,
    )

    assert response.status_code == 422


def test_duplicate_building_name_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_building(db_session, name="Denver Office", code="DEN-1")

    response = client.post(
        "/api/v1/buildings",
        json={"name": "denver office", "code": "DEN-2"},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "BUILDING_NAME_TAKEN"
    assert response.json()["field"] == "name"


def test_duplicate_building_code_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_building(db_session, name="Boston Lab", code="BOS-1")

    response = client.post(
        "/api/v1/buildings",
        json={"name": "Boston Annex", "code": "bos-1"},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "BUILDING_CODE_TAKEN"
    assert response.json()["field"] == "code"


def test_employee_cannot_create_a_building(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/buildings",
        json={"name": "Shadow HQ", "code": "SHD-1"},
        headers=employee_headers,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ROLE_NOT_PERMITTED"


def test_anonymous_cannot_list_buildings(client: TestClient) -> None:
    assert client.get("/api/v1/buildings").status_code == 401


def test_employee_can_list_buildings(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    make_building(db_session, code="AAA-1")
    make_building(db_session, code="BBB-1")

    response = client.get("/api/v1/buildings", headers=employee_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["page"] == 1
    assert body["page_size"] == 25
    assert [item["code"] for item in body["items"]] == ["AAA-1", "BBB-1"]


def test_building_list_paginates(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    for index in range(5):
        make_building(db_session, code=f"PG-{index}")

    response = client.get("/api/v1/buildings?page=2&page_size=2", headers=employee_headers)

    body = response.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert [item["code"] for item in body["items"]] == ["PG-2", "PG-3"]


def test_page_size_above_the_maximum_is_rejected(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/buildings?page_size=101", headers=employee_headers)

    assert response.status_code == 422


def test_inactive_buildings_are_hidden_by_default(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_building(db_session, code="LIVE-1")
    make_building(db_session, code="GONE-1", is_active=False)

    default_response = client.get("/api/v1/buildings", headers=admin_headers)
    inclusive_response = client.get(
        "/api/v1/buildings?include_inactive=true", headers=admin_headers
    )

    assert [item["code"] for item in default_response.json()["items"]] == ["LIVE-1"]
    assert {item["code"] for item in inclusive_response.json()["items"]} == {"LIVE-1", "GONE-1"}


def test_employee_cannot_ask_for_inactive_records(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/buildings?include_inactive=true", headers=employee_headers)

    assert response.status_code == 403
    assert response.json()["code"] == "INCLUDE_INACTIVE_NOT_PERMITTED"


def test_unknown_building_is_a_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get(f"/api/v1/buildings/{uuid.uuid4()}", headers=admin_headers)

    assert response.status_code == 404
    assert response.json()["code"] == "BUILDING_NOT_FOUND"


def test_patch_only_touches_the_fields_sent(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session, name="Old Name", code="OLD-1", address="7 Old Road")

    response = client.patch(
        f"/api/v1/buildings/{building.id}",
        json={"name": "New Name"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["code"] == "OLD-1"
    assert body["address"] == "7 Old Road"


def test_patch_can_clear_an_address(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session, address="7 Old Road")

    response = client.patch(
        f"/api/v1/buildings/{building.id}",
        json={"address": None},
        headers=admin_headers,
    )

    assert response.json()["address"] is None


def test_patch_to_a_name_another_building_holds_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_building(db_session, name="Taken Name", code="TK-1")
    other = make_building(db_session, name="Free Name", code="FR-1")

    response = client.patch(
        f"/api/v1/buildings/{other.id}",
        json={"name": "Taken Name"},
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_patch_keeping_its_own_name_is_allowed(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """The uniqueness check must exclude the row being updated."""
    building = make_building(db_session, name="Same Name", code="SM-1")

    response = client.patch(
        f"/api/v1/buildings/{building.id}",
        json={"name": "Same Name", "address": "New address"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["address"] == "New address"


def test_deactivating_a_building_keeps_the_row(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)

    response = client.patch(
        f"/api/v1/buildings/{building.id}",
        json={"is_active": False},
        headers=admin_headers,
    )

    assert response.json()["is_active"] is False
    assert client.get(f"/api/v1/buildings/{building.id}", headers=admin_headers).status_code == 200


def test_unreferenced_building_is_deleted_with_its_floors_and_seats(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)
    floor = make_floor(db_session, building)
    seat = make_seat(db_session, floor)

    response = client.delete(f"/api/v1/buildings/{building.id}", headers=admin_headers)

    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert response.json()["deactivated"] is False
    assert client.get(f"/api/v1/floors/{floor.id}", headers=admin_headers).status_code == 404
    assert client.get(f"/api/v1/seats/{seat.id}", headers=admin_headers).status_code == 404


def test_referenced_building_cannot_be_deleted(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)
    reporter = make_user(db_session)
    group = make_category(db_session)
    subcategory = make_category(db_session, parent=group)
    make_incident(
        db_session,
        reporter=reporter,
        category=subcategory,
        building=building,
    )

    response = client.delete(f"/api/v1/buildings/{building.id}", headers=admin_headers)

    assert response.status_code == 409
    assert response.json()["code"] == "BUILDING_IN_USE"
    assert "Deactivate it instead" in response.json()["detail"]


def test_building_is_referenced_through_a_seat_incident(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """A ticket filed at a seat protects the whole chain above it."""
    building = make_building(db_session)
    floor = make_floor(db_session, building)
    seat = make_seat(db_session, floor)
    group = make_category(db_session)
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=make_category(db_session, parent=group),
        building=building,
        floor=floor,
        seat=seat,
    )

    assert client.delete(f"/api/v1/seats/{seat.id}", headers=admin_headers).status_code == 409
    assert client.delete(f"/api/v1/floors/{floor.id}", headers=admin_headers).status_code == 409
    assert (
        client.delete(f"/api/v1/buildings/{building.id}", headers=admin_headers).status_code == 409
    )


# --- Floors ------------------------------------------------------------------


def test_admin_adds_a_floor(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)

    response = client.post(
        f"/api/v1/buildings/{building.id}/floors",
        json={"name": "Level 3", "level_number": 3},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["building_id"] == str(building.id)
    assert response.json()["level_number"] == 3


def test_duplicate_level_number_in_one_building_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)
    make_floor(db_session, building, name="Level 3", level_number=3)

    response = client.post(
        f"/api/v1/buildings/{building.id}/floors",
        json={"name": "Third floor", "level_number": 3},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "FLOOR_LEVEL_TAKEN"
    assert response.json()["field"] == "level_number"


def test_the_same_level_number_in_another_building_is_fine(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    first = make_building(db_session)
    second = make_building(db_session)
    make_floor(db_session, first, level_number=3)

    response = client.post(
        f"/api/v1/buildings/{second.id}/floors",
        json={"name": "Level 3", "level_number": 3},
        headers=admin_headers,
    )

    assert response.status_code == 201


def test_basement_levels_are_allowed(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session)

    response = client.post(
        f"/api/v1/buildings/{building.id}/floors",
        json={"name": "Basement", "level_number": -1},
        headers=admin_headers,
    )

    assert response.status_code == 201


def test_floors_are_listed_lowest_first(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    building = make_building(db_session)
    make_floor(db_session, building, name="Level 2", level_number=2)
    make_floor(db_session, building, name="Basement", level_number=-1)
    make_floor(db_session, building, name="Level 1", level_number=1)

    response = client.get(f"/api/v1/buildings/{building.id}/floors", headers=employee_headers)

    assert [item["level_number"] for item in response.json()["items"]] == [-1, 1, 2]


def test_listing_floors_of_an_unknown_building_is_a_404(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get(f"/api/v1/buildings/{uuid.uuid4()}/floors", headers=employee_headers)

    assert response.status_code == 404


# --- Seats -------------------------------------------------------------------


def test_admin_adds_a_seat(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats",
        json={"code": "3-A-12", "seat_type": "DESK"},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["code"] == "3-A-12"
    assert response.json()["seat_type"] == "DESK"


def test_duplicate_seat_code_on_one_floor_conflicts(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))
    make_seat(db_session, floor, code="3-A-12")

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats",
        json={"code": "3-A-12"},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SEAT_CODE_TAKEN"


def test_meeting_rooms_can_be_filtered(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))
    make_seat(db_session, floor, code="3-A-12")
    make_seat(db_session, floor, code="Redwood", seat_type=SeatType.MEETING_ROOM)

    response = client.get(
        f"/api/v1/floors/{floor.id}/seats?seat_type=MEETING_ROOM",
        headers=employee_headers,
    )

    assert response.json()["total"] == 1
    assert response.json()["items"][0]["code"] == "Redwood"


def test_bulk_create_inserts_every_new_code(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": ["3-A-01", "3-A-02", "3-A-03"], "seat_type": "DESK"},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["created_count"] == 3
    assert body["skipped_count"] == 0
    assert [seat["code"] for seat in body["created"]] == ["3-A-01", "3-A-02", "3-A-03"]


def test_bulk_create_skips_codes_that_already_exist(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))
    make_seat(db_session, floor, code="3-A-01")

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": ["3-A-01", "3-A-02"]},
        headers=admin_headers,
    )

    body = response.json()
    assert body["created_count"] == 1
    assert body["skipped_codes"] == ["3-A-01"]


def test_bulk_create_collapses_repeats_within_one_request(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": ["3-A-01", "3-A-01", "3-A-02"]},
        headers=admin_headers,
    )

    body = response.json()
    assert body["created_count"] == 2
    assert body["skipped_count"] == 0


def test_bulk_create_applies_the_seat_type_to_every_code(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": ["Redwood", "Cypress"], "seat_type": "MEETING_ROOM"},
        headers=admin_headers,
    )

    assert {seat["seat_type"] for seat in response.json()["created"]} == {"MEETING_ROOM"}


def test_bulk_create_needs_at_least_one_code(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": []},
        headers=admin_headers,
    )

    assert response.status_code == 422


def test_employee_cannot_bulk_create_seats(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    floor = make_floor(db_session, make_building(db_session))

    response = client.post(
        f"/api/v1/floors/{floor.id}/seats/bulk",
        json={"codes": ["X-1"]},
        headers=employee_headers,
    )

    assert response.status_code == 403


def test_engineer_cannot_write_facilities(client: TestClient, db_session: Session) -> None:
    """Engineers read the facility tree but never edit it."""
    engineer = make_engineer(db_session)
    headers = auth_header(login(client, engineer.email))

    read = client.get("/api/v1/buildings", headers=headers)
    write = client.post(
        "/api/v1/buildings",
        json={"name": "Engineer HQ", "code": "ENG-1"},
        headers=headers,
    )

    assert read.status_code == 200
    assert write.status_code == 403


# --- Tree --------------------------------------------------------------------


def test_tree_nests_buildings_floors_and_seats(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    building = make_building(db_session, code="TREE-1")
    ground = make_floor(db_session, building, name="Ground", level_number=0)
    make_seat(db_session, ground, code="G-02")
    make_seat(db_session, ground, code="G-01")

    response = client.get("/api/v1/facilities/tree", headers=employee_headers)

    assert response.status_code == 200, response.text
    buildings = response.json()["buildings"]
    assert [b["code"] for b in buildings] == ["TREE-1"]
    floors = buildings[0]["floors"]
    assert [f["name"] for f in floors] == ["Ground"]
    assert [s["code"] for s in floors[0]["seats"]] == ["G-01", "G-02"]


def test_tree_hides_inactive_rows_at_every_level(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    building = make_building(db_session, code="ACT-1")
    live_floor = make_floor(db_session, building, name="Live", level_number=1)
    make_floor(db_session, building, name="Closed", level_number=2, is_active=False)
    make_seat(db_session, live_floor, code="OK-1")
    make_seat(db_session, live_floor, code="NO-1", is_active=False)
    make_building(db_session, code="ZZZ-9", is_active=False)

    tree = client.get("/api/v1/facilities/tree", headers=employee_headers).json()

    assert [b["code"] for b in tree["buildings"]] == ["ACT-1"]
    assert [f["name"] for f in tree["buildings"][0]["floors"]] == ["Live"]
    assert [s["code"] for s in tree["buildings"][0]["floors"][0]["seats"]] == ["OK-1"]


def test_admin_can_see_the_whole_tree(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    building = make_building(db_session, code="ADM-1")
    floor = make_floor(db_session, building, name="Closed", level_number=1, is_active=False)
    make_seat(db_session, floor, code="HIDDEN-1", is_active=False)

    tree = client.get("/api/v1/facilities/tree?include_inactive=true", headers=admin_headers).json()

    building_node = next(b for b in tree["buildings"] if b["code"] == "ADM-1")
    assert [f["name"] for f in building_node["floors"]] == ["Closed"]
    assert [s["code"] for s in building_node["floors"][0]["seats"]] == ["HIDDEN-1"]


def test_deactivating_a_building_does_not_cascade_to_its_floors(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Reactivating a building must restore exactly what was there before."""
    building = make_building(db_session, code="CASC-1")
    floor = make_floor(db_session, building)

    client.patch(
        f"/api/v1/buildings/{building.id}",
        json={"is_active": False},
        headers=admin_headers,
    )

    assert client.get(f"/api/v1/floors/{floor.id}", headers=admin_headers).json()["is_active"]
    tree = client.get("/api/v1/facilities/tree", headers=admin_headers).json()
    assert "CASC-1" not in [b["code"] for b in tree["buildings"]]
