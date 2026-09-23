"""Reporting an incident, reading one back, and finding it again.

Creation is where the report questionnaire's rules are enforced: a subcategory
rather than a group, and a location as precise as that subcategory's group
demands. Each failure is a 422 naming the field, because the React form maps
`field` onto the input that caused it.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    EngineerLevel,
    EventType,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    SeatType,
)
from app.models.floor import Floor
from app.models.seat import Seat
from app.models.user import User
from app.schemas.incident import LOCATION_SEPARATOR
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
def employee(db_session: Session) -> User:
    return make_user(db_session, full_name="Ada Reporter")


@pytest.fixture
def employee_headers(client: TestClient, employee: User) -> dict[str, str]:
    return auth_header(login(client, employee.email))


@pytest.fixture
def admin_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    return auth_header(login(client, make_admin(db_session).email))


@pytest.fixture
def building(db_session: Session) -> Building:
    return make_building(db_session, name="San Francisco HQ", code="SFO-1")


@pytest.fixture
def floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 3", level_number=3)


@pytest.fixture
def seat(db_session: Session, floor: Floor) -> Seat:
    return make_seat(db_session, floor, code="3-A-01")


@pytest.fixture
def subcategory(db_session: Session) -> Category:
    """Return a FLOOR-precision subcategory: building and floor required, seat optional."""
    group = make_category(db_session, location_detail=LocationDetail.FLOOR)
    return make_category(db_session, name="Lighting", parent=group)


def path_of(*parts: str) -> str:
    """Render a location path the way the API does."""
    return LOCATION_SEPARATOR.join(parts)


def report_body(
    subcategory: Category,
    building: Building,
    **overrides: object,
) -> dict[str, object]:
    """Build a valid create payload, overriding whatever the test is about."""
    body: dict[str, object] = {
        "title": "Ceiling light flickering",
        "description": "The light above my desk has been flickering since Monday morning.",
        "category_id": str(subcategory.id),
        "building_id": str(building.id),
    }
    body.update(overrides)
    return body


# --- Creation ----------------------------------------------------------------


def test_reporting_an_incident_returns_it_with_a_ticket_number(
    client: TestClient,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id), priority="HIGH"),
        headers=employee_headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["ticket_number"] >= 1
    assert body["reference"] == f"INC-{body['ticket_number']:06d}"
    assert body["status"] == "OPEN"
    assert body["priority"] == "HIGH"
    assert body["reporter"]["full_name"] == "Ada Reporter"
    assert body["assignee"] is None
    assert body["category"]["name"] == "Lighting"
    assert body["category"]["group_name"] == subcategory.parent.name
    assert body["location"]["path"] == path_of("SFO-1", "Level 3")


def test_a_new_incident_defaults_to_medium_priority(
    client: TestClient,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id)),
        headers=employee_headers,
    )

    assert response.json()["priority"] == IncidentPriority.MEDIUM.value


def test_creation_writes_a_created_event(
    client: TestClient,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    created = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id)),
        headers=employee_headers,
    ).json()

    activity = client.get(
        f"/api/v1/incidents/{created['id']}/activity", headers=employee_headers
    ).json()

    assert [entry["event_type"] for entry in activity] == [EventType.CREATED.value]
    assert activity[0]["to_value"] == IncidentStatus.OPEN.value


def test_reporting_remembers_the_location_for_next_time(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """`users.last_*_id` pre-fills the next report form."""
    client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id), seat_id=str(seat.id)),
        headers=employee_headers,
    )
    db_session.refresh(employee)

    assert employee.last_building_id == building.id
    assert employee.last_floor_id == floor.id
    assert employee.last_seat_id == seat.id


def test_a_category_group_cannot_be_reported_against(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    building: Building,
    floor: Floor,
) -> None:
    """A group such as Hardware is the question in step 1, not an answer."""
    group = make_category(db_session, location_detail=LocationDetail.FLOOR)

    response = client.post(
        "/api/v1/incidents",
        json=report_body(group, building, floor_id=str(floor.id)),
        headers=employee_headers,
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "CATEGORY_NOT_SUBCATEGORY"
    assert body["field"] == "category_id"


def test_a_deactivated_category_cannot_be_reported_against(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    subcategory.is_active = False
    db_session.flush()

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id)),
        headers=employee_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "CATEGORY_INACTIVE"


@pytest.mark.parametrize(
    ("detail", "omit", "expected_field"),
    [
        (LocationDetail.FLOOR, "floor_id", "floor_id"),
        (LocationDetail.SEAT, "floor_id", "floor_id"),
        (LocationDetail.SEAT, "seat_id", "seat_id"),
    ],
    ids=["floor group needs a floor", "seat group needs a floor", "seat group needs a seat"],
)
def test_the_group_decides_how_precise_the_location_must_be(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    building: Building,
    floor: Floor,
    seat: Seat,
    detail: LocationDetail,
    omit: str,
    expected_field: str,
) -> None:
    group = make_category(db_session, location_detail=detail)
    subcategory = make_category(db_session, parent=group)

    location: dict[str, object] = {"floor_id": str(floor.id), "seat_id": str(seat.id)}
    del location[omit]

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, **location),
        headers=employee_headers,
    )

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["field"] == expected_field
    assert body["code"] in {"LOCATION_TOO_VAGUE", "FLOOR_REQUIRED_WITH_SEAT"}


def test_a_building_level_group_needs_only_a_building(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    building: Building,
) -> None:
    group = make_category(db_session, location_detail=LocationDetail.BUILDING)
    subcategory = make_category(db_session, name="Email/Calendar", parent=group)

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building),
        headers=employee_headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["location"]["path"] == "SFO-1"


def test_a_floor_in_another_building_is_refused(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    elsewhere = make_building(db_session, name="New York HQ", code="NYC-1")
    other_floor = make_floor(db_session, elsewhere, name="Level 9", level_number=9)

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(other_floor.id)),
        headers=employee_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "FLOOR_NOT_IN_BUILDING"


def test_a_seat_on_another_floor_is_refused(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    other_floor = make_floor(db_session, building, name="Level 4", level_number=4)
    other_seat = make_seat(db_session, other_floor, code="4-B-02")

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id), seat_id=str(other_seat.id)),
        headers=employee_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "SEAT_NOT_ON_FLOOR"


def test_a_meeting_room_reads_back_as_a_seat_with_its_type(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    building: Building,
    floor: Floor,
) -> None:
    room = make_seat(db_session, floor, code="Room Redwood", seat_type=SeatType.MEETING_ROOM)
    group = make_category(db_session, location_detail=LocationDetail.SEAT)
    subcategory = make_category(db_session, name="Display/Projector", parent=group)

    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id), seat_id=str(room.id)),
        headers=employee_headers,
    )

    assert response.status_code == 201, response.text
    location = response.json()["location"]
    assert location["seat_type"] == SeatType.MEETING_ROOM.value
    assert location["path"] == path_of("SFO-1", "Level 3", "Room Redwood")


@pytest.mark.parametrize(
    ("field", "value"),
    [("title", "Hi"), ("description", "Too short"), ("title", "x" * 121)],
    ids=["title too short", "description too short", "title too long"],
)
def test_length_limits_are_enforced(
    client: TestClient,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
    field: str,
    value: str,
) -> None:
    response = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id), **{field: value}),
        headers=employee_headers,
    )

    assert response.status_code == 422


# --- Reading -----------------------------------------------------------------


def test_an_employee_can_read_someone_elses_ticket(
    client: TestClient,
    db_session: Session,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    """Deliberate: the brief asks employees to check whether something is already reported."""
    someone_else = make_user(db_session, full_name="Bo Other")
    incident = make_incident(
        db_session, reporter=someone_else, category=subcategory, building=building
    )

    response = client.get(f"/api/v1/incidents/{incident.id}", headers=employee_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["reporter"]["full_name"] == "Bo Other"
    assert body["can_edit"] is False
    assert body["can_change_priority"] is False
    assert body["can_escalate"] is False


def test_a_reporter_sees_their_own_permissions(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    incident = make_incident(db_session, reporter=employee, category=subcategory, building=building)

    body = client.get(f"/api/v1/incidents/{incident.id}", headers=employee_headers).json()

    assert body["can_edit"] is True
    assert body["can_change_priority"] is True
    assert body["can_escalate"] is True
    assert body["can_add_note"] is True
    assert body["can_add_internal_note"] is False
    assert body["can_assign"] is False


def test_a_missing_incident_is_a_404(client: TestClient, employee_headers: dict[str, str]) -> None:
    response = client.get(f"/api/v1/incidents/{uuid.uuid4()}", headers=employee_headers)

    assert response.status_code == 404
    assert response.json()["code"] == "INCIDENT_NOT_FOUND"


def test_reading_an_incident_requires_a_session(client: TestClient) -> None:
    assert client.get(f"/api/v1/incidents/{uuid.uuid4()}").status_code == 401


# --- Editing -----------------------------------------------------------------


def test_a_reporter_can_edit_their_open_unassigned_ticket(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    incident = make_incident(db_session, reporter=employee, category=subcategory, building=building)

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"title": "Ceiling light is now completely out"},
        headers=employee_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Ceiling light is now completely out"


def test_a_reporter_cannot_edit_once_the_ticket_is_assigned(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    """An engineer working on "monitor flickering" should not find it has become something else."""
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    incident = make_incident(
        db_session,
        reporter=employee,
        category=subcategory,
        building=building,
        assignee=engineer,
    )

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"description": "Actually the whole floor is dark now, every light."},
        headers=employee_headers,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "EDIT_NOT_PERMITTED"


def test_a_reporter_can_still_raise_the_priority_after_assignment(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    """Hearing that it got worse is useful even after work has started."""
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    incident = make_incident(
        db_session,
        reporter=employee,
        category=subcategory,
        building=building,
        assignee=engineer,
    )

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"priority": "CRITICAL"},
        headers=employee_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["priority"] == "CRITICAL"


def test_a_priority_change_is_recorded(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    incident = make_incident(db_session, reporter=employee, category=subcategory, building=building)

    client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"priority": "LOW"},
        headers=employee_headers,
    )
    activity = client.get(
        f"/api/v1/incidents/{incident.id}/activity", headers=employee_headers
    ).json()

    changes = [entry for entry in activity if entry["event_type"] == "PRIORITY_CHANGED"]
    assert len(changes) == 1
    assert changes[0]["from_value"] == "MEDIUM"
    assert changes[0]["to_value"] == "LOW"


def test_an_engineer_cannot_edit_a_ticket_they_did_not_report(
    client: TestClient,
    db_session: Session,
    employee: User,
    subcategory: Category,
    building: Building,
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)
    incident = make_incident(
        db_session,
        reporter=employee,
        category=subcategory,
        building=building,
        assignee=engineer,
    )
    headers = auth_header(login(client, engineer.email))

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"priority": "CRITICAL"},
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "PRIORITY_CHANGE_NOT_PERMITTED"


def test_an_admin_can_edit_any_ticket(
    client: TestClient,
    db_session: Session,
    employee: User,
    admin_headers: dict[str, str],
    subcategory: Category,
    building: Building,
) -> None:
    incident = make_incident(
        db_session,
        reporter=employee,
        category=subcategory,
        building=building,
        status=IncidentStatus.IN_PROGRESS,
    )

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"title": "Corrected by the facilities team"},
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text


def test_an_edit_that_would_leave_the_location_too_vague_is_refused(
    client: TestClient,
    db_session: Session,
    employee: User,
    admin_headers: dict[str, str],
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """The merged result is what is checked, not the change on its own."""
    floor_group = make_category(db_session, location_detail=LocationDetail.FLOOR)
    floor_subcategory = make_category(db_session, parent=floor_group)
    seat_group = make_category(db_session, location_detail=LocationDetail.SEAT)
    seat_subcategory = make_category(db_session, parent=seat_group)

    incident = make_incident(
        db_session,
        reporter=employee,
        category=floor_subcategory,
        building=building,
        floor=floor,
    )

    response = client.patch(
        f"/api/v1/incidents/{incident.id}",
        json={"category_id": str(seat_subcategory.id)},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["field"] == "seat_id"


# --- Listing, search and filters ---------------------------------------------


@pytest.fixture
def reported_tickets(
    db_session: Session,
    employee: User,
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> list[object]:
    """Three tickets differing in status, priority and words, for the filter tests."""
    other_reporter = make_user(db_session, full_name="Bo Other")
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)

    return [
        make_incident(
            db_session,
            reporter=employee,
            category=subcategory,
            building=building,
            floor=floor,
            title="Ceiling light flickering badly",
            description="The light above my desk flickers all afternoon.",
            priority=IncidentPriority.LOW,
        ),
        make_incident(
            db_session,
            reporter=other_reporter,
            category=subcategory,
            building=building,
            floor=floor,
            assignee=engineer,
            status=IncidentStatus.IN_PROGRESS,
            title="Air conditioning far too cold",
            description="The whole floor is freezing and nobody can concentrate.",
            priority=IncidentPriority.CRITICAL,
        ),
        make_incident(
            db_session,
            reporter=other_reporter,
            category=subcategory,
            building=building,
            floor=floor,
            status=IncidentStatus.BLOCKED,
            title="Broken chair by the window",
            description="One of the chairs has lost a wheel and tips over.",
            priority=IncidentPriority.HIGH,
        ),
    ]


def titles(response_body: dict[str, object]) -> list[str]:
    """Return the titles of a page of incidents, for readable assertions."""
    items = response_body["items"]
    assert isinstance(items, list)
    return [item["title"] for item in items]


def test_listing_returns_every_ticket_to_every_signed_in_user(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    body = client.get("/api/v1/incidents", headers=employee_headers).json()

    assert body["total"] == len(reported_tickets)
    assert body["page"] == 1


def test_searching_by_ticket_number_finds_exactly_one(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    target = reported_tickets[1]
    reference = f"INC-{target.ticket_number:06d}"  # type: ignore[attr-defined]

    for query in (str(target.ticket_number), reference, reference.lower()):  # type: ignore[attr-defined]
        body = client.get(f"/api/v1/incidents?q={query}", headers=employee_headers).json()
        assert titles(body) == ["Air conditioning far too cold"], query


def test_full_text_search_matches_words_in_the_description(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    body = client.get("/api/v1/incidents?q=freezing", headers=employee_headers).json()

    assert titles(body) == ["Air conditioning far too cold"]


def test_full_text_search_stems_words(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    """'flicker' finds 'flickering' — that is what the english configuration buys."""
    body = client.get("/api/v1/incidents?q=flicker", headers=employee_headers).json()

    assert titles(body) == ["Ceiling light flickering badly"]


def test_search_punctuation_does_not_break_the_query(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    """websearch_to_tsquery swallows what to_tsquery would raise on."""
    response = client.get("/api/v1/incidents?q=%26%26%21", headers=employee_headers)

    assert response.status_code == 200
    assert response.json()["total"] == 0


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("status=OPEN", ["Ceiling light flickering badly"]),
        (
            "status=OPEN&status=BLOCKED",
            ["Broken chair by the window", "Ceiling light flickering badly"],
        ),
        ("priority=CRITICAL", ["Air conditioning far too cold"]),
        ("is_escalated=false", None),
        (
            "assignee_id=unassigned",
            ["Broken chair by the window", "Ceiling light flickering badly"],
        ),
    ],
    ids=["one status", "two statuses", "priority", "not escalated", "unassigned"],
)
def test_filters_narrow_the_list(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
    query: str,
    expected: list[str] | None,
) -> None:
    body = client.get(f"/api/v1/incidents?{query}", headers=employee_headers).json()

    if expected is None:
        assert body["total"] == len(reported_tickets)
    else:
        assert sorted(titles(body)) == sorted(expected)


def test_mine_reported_filters_to_the_callers_own_tickets(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    body = client.get("/api/v1/incidents?mine=reported", headers=employee_headers).json()

    assert titles(body) == ["Ceiling light flickering badly"]


def test_mine_assigned_filters_to_the_callers_queue(
    client: TestClient,
    db_session: Session,
    reported_tickets: list[object],
) -> None:
    engineer = db_session.get(User, reported_tickets[1].assignee_id)  # type: ignore[attr-defined]
    assert engineer is not None
    headers = auth_header(login(client, engineer.email))

    body = client.get("/api/v1/incidents?mine=assigned", headers=headers).json()

    assert titles(body) == ["Air conditioning far too cold"]


def test_an_unassigned_sentinel_that_is_not_a_uuid_is_refused(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/incidents?assignee_id=nobody", headers=employee_headers)

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_ASSIGNEE_FILTER"


def test_group_filter_matches_every_subcategory_under_it(
    client: TestClient,
    db_session: Session,
    employee: User,
    employee_headers: dict[str, str],
    building: Building,
    floor: Floor,
    subcategory: Category,
) -> None:
    sibling = make_category(db_session, name="Temperature/HVAC", parent=subcategory.parent)
    make_incident(
        db_session,
        reporter=employee,
        category=sibling,
        building=building,
        floor=floor,
        title="Radiator stuck on maximum heat",
    )
    make_incident(
        db_session, reporter=employee, category=subcategory, building=building, floor=floor
    )

    group_id = subcategory.parent_id
    body = client.get(f"/api/v1/incidents?group_id={group_id}", headers=employee_headers).json()

    assert body["total"] == 2


def test_specialty_filter_uses_the_callers_own_groups(
    client: TestClient,
    db_session: Session,
    employee: User,
    building: Building,
    floor: Floor,
    subcategory: Category,
) -> None:
    other_group = make_category(db_session)
    other_subcategory = make_category(db_session, name="Wi-Fi", parent=other_group)

    make_incident(
        db_session, reporter=employee, category=subcategory, building=building, floor=floor
    )
    make_incident(
        db_session,
        reporter=employee,
        category=other_subcategory,
        building=building,
        floor=floor,
        title="Wi-Fi keeps dropping in the north wing",
    )

    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    assert engineer.engineer_profile is not None
    engineer.engineer_profile.specialty_group_ids = [other_group.id]
    db_session.flush()

    headers = auth_header(login(client, engineer.email))
    body = client.get("/api/v1/incidents?specialty=true", headers=headers).json()

    assert titles(body) == ["Wi-Fi keeps dropping in the north wing"]


def test_specialty_means_nothing_for_an_employee(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/incidents?specialty=true", headers=employee_headers)

    assert response.status_code == 422
    assert response.json()["code"] == "SPECIALTY_NOT_APPLICABLE"


def test_sorting_by_priority_puts_critical_first(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    """Uses the PostgreSQL enum's declared order, not a CASE expression."""
    body = client.get("/api/v1/incidents?sort=-priority", headers=employee_headers).json()

    assert titles(body) == [
        "Air conditioning far too cold",
        "Broken chair by the window",
        "Ceiling light flickering badly",
    ]


def test_the_default_sort_is_newest_first(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    body = client.get("/api/v1/incidents", headers=employee_headers).json()

    assert titles(body) == [
        "Broken chair by the window",
        "Air conditioning far too cold",
        "Ceiling light flickering badly",
    ]


def test_created_from_and_to_bound_the_list(
    client: TestClient,
    employee_headers: dict[str, str],
    reported_tickets: list[object],
) -> None:
    """Passed through `params=` so the `+00:00` offset is percent-encoded, not eaten."""
    tomorrow = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()

    def total(**params: str) -> int:
        response = client.get("/api/v1/incidents", params=params, headers=employee_headers)
        assert response.status_code == 200, response.text
        return int(response.json()["total"])

    assert total(created_from=tomorrow) == 0
    assert total(created_to=yesterday) == 0
    assert total(created_from=yesterday, created_to=tomorrow) == len(reported_tickets)


def test_paging_caps_the_page_size(client: TestClient, employee_headers: dict[str, str]) -> None:
    response = client.get("/api/v1/incidents?page_size=101", headers=employee_headers)

    assert response.status_code == 422


def test_timestamps_come_back_in_utc(
    client: TestClient,
    employee_headers: dict[str, str],
    subcategory: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The database session is pinned to UTC, so local and deployed agree.

    Without that pin a `timestamptz` renders in the server's own zone — UTC on
    the Lambda, whatever the developer machine is set to locally — and the
    difference only shows up after a deploy.
    """
    created = client.post(
        "/api/v1/incidents",
        json=report_body(subcategory, building, floor_id=str(floor.id)),
        headers=employee_headers,
    ).json()

    assert created["created_at"].endswith("Z") or created["created_at"].endswith("+00:00")
