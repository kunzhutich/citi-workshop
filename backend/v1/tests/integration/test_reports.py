"""The M7 report endpoints, against a fixture dataset with known answers.

Every number asserted here was worked out by hand from `dataset` below before
the code was written. That is the point of the file: an aggregate that returns
*something* is worthless as evidence, so each test states the answer and the
arithmetic behind it in a comment.

The dataset is nine incidents inside the reporting window plus one deliberately
outside it, spread over two buildings, three floors, four seats, three
subcategories in two groups, two reporters and three engineers. Full layout:

Where each one is, and what it is:

| #   | age    | location       | subcategory | status      | priority | assignee |
| --- | ------ | -------------- | ----------- | ----------- | -------- | -------- |
| I1  | -10 d  | A / A1 / A1-S1 | Lighting    | OPEN        | HIGH     | —        |
| I2  | -9 d   | A / A1 / A1-S1 | Lighting    | IN_PROGRESS | HIGH     | Nina     |
| I3  | -8 d   | A / A1 / A1-S2 | HVAC        | BLOCKED     | CRITICAL | Nina     |
| I4  | -7 d   | A / A2 / A2-S1 | HVAC        | RESOLVED    | MEDIUM   | Nina     |
| I5  | -6 d   | A / A2 / A2-S1 | Network     | CLOSED      | LOW      | Omar     |
| I6  | -5 d   | B / B1 / B1-S1 | Lighting    | OPEN        | MEDIUM   | —        |
| I7  | -4 d   | B / B1         | Network     | IN_PROGRESS | MEDIUM   | Omar     |
| I8  | -3 d   | B              | Lighting    | CLOSED      | LOW      | Omar     |
| I9  | -2 d   | A / A1 / A1-S1 | Lighting    | RESOLVED    | HIGH     | Nina     |
| I10 | -45 d  | A / A1 / A1-S1 | HVAC        | OPEN        | CRITICAL | —        |

When each milestone was reached, as hours after the ticket was reported:

| #   | assigned | acknowledged | resolved | closed | escalated | reopens |
| --- | -------- | ------------ | -------- | ------ | --------- | ------- |
| I1  | —        | —            | —        | —      | —         | 0       |
| I2  | 2 h      | 4 h          | —        | —      | -1 d      | 0       |
| I3  | 1 h      | 2 h          | —        | —      | —         | 0       |
| I4  | 4 h      | 6 h          | 12 h     | —      | —         | 0       |
| I5  | 8 h      | 10 h         | 20 h     | 24 h   | —         | 1       |
| I6  | —        | —            | —        | —      | -2 d      | 0       |
| I7  | 6 h      | 8 h          | —        | —      | —         | 0       |
| I8  | 2 h      | 3 h          | 5 h      | 6 h    | —         | 0       |
| I9  | 3 h      | 5 h          | 9 h      | —      | —         | 2       |
| I10 | —        | —            | —        | —      | —         | 0       |

`I10` is outside the default thirty days. It proves the window is applied on
the six reports that cover a *period*, where it must never be counted — and
that it is **not** applied on the two that describe the *present*,
`/reports/blocked-escalated` and `/reports/me`, where a ticket that is still
open is still open however long ago it was reported (decision D9).

Every test of a period report pins the window explicitly to `now - 30 days` …
`now`, where `now` is captured once when the fixtures are built. One test
deliberately omits the parameters, to prove the default is the same thing. The
two current-state tests send a window as well, to prove it changes nothing.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    AvailabilityStatus,
    BlockedReasonType,
    CloseReason,
    EngineerLevel,
    EventType,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    NoteVisibility,
    SeatType,
)
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.seat import Seat
from app.models.user import User
from app.schemas.report import ReportScope
from app.services import reporting
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_event,
    make_floor,
    make_incident,
    make_note,
    make_seat,
    make_user,
)

#: Every admin report lives under this prefix.
REPORTS = "/api/v1/reports"

#: The window every test pins, in days.
WINDOW_DAYS = 30


@dataclass(frozen=True)
class Dataset:
    """The fixture world, with `now` captured so durations are exact."""

    now: datetime
    building_a: Building
    building_b: Building
    floor_a1: Floor
    floor_a2: Floor
    floor_b1: Floor
    seat_a1_s1: Seat
    seat_a1_s2: Seat
    seat_a2_s1: Seat
    seat_b1_s1: Seat
    group_facilities: Category
    group_it: Category
    lighting: Category
    hvac: Category
    network: Category
    admin: User
    employee_one: User
    employee_two: User
    nina: User
    omar: User
    pia: User
    incidents: dict[str, Incident]


def _hours(count: float) -> timedelta:
    """Return a duration in hours, for readability at the call sites."""
    return timedelta(hours=count)


@pytest.fixture
def dataset(db_session: Session) -> Dataset:
    """Build the fixture world described in this module's docstring."""
    now = utc_now()

    building_a = make_building(db_session, name="Alpha House", code="A-1")
    building_b = make_building(db_session, name="Bravo House", code="B-2")
    floor_a1 = make_floor(db_session, building_a, name="Level 1", level_number=1)
    floor_a2 = make_floor(db_session, building_a, name="Level 2", level_number=2)
    floor_b1 = make_floor(db_session, building_b, name="Level 1", level_number=1)
    seat_a1_s1 = make_seat(db_session, floor_a1, code="A1-S1")
    seat_a1_s2 = make_seat(db_session, floor_a1, code="A1-S2")
    seat_a2_s1 = make_seat(db_session, floor_a2, code="A2-S1", seat_type=SeatType.MEETING_ROOM)
    seat_b1_s1 = make_seat(db_session, floor_b1, code="B1-S1")

    group_facilities = make_category(
        db_session, name="Facilities", location_detail=LocationDetail.SEAT
    )
    group_it = make_category(db_session, name="IT", location_detail=LocationDetail.SEAT)
    lighting = make_category(db_session, name="Lighting", parent=group_facilities)
    hvac = make_category(db_session, name="HVAC", parent=group_facilities)
    network = make_category(db_session, name="Network", parent=group_it)

    admin = make_admin(db_session, full_name="Ada Admin")
    employee_one = make_user(db_session, full_name="Eve Employee")
    employee_two = make_user(db_session, full_name="Evan Employee")
    nina = make_engineer(
        db_session, full_name="Nina Engineer", level=EngineerLevel.SENIOR, max_active_tickets=10
    )
    omar = make_engineer(
        db_session, full_name="Omar Engineer", level=EngineerLevel.JUNIOR, max_active_tickets=5
    )
    pia = make_engineer(
        db_session,
        full_name="Pia Engineer",
        level=EngineerLevel.LEAD,
        max_active_tickets=10,
        availability=AvailabilityStatus.ON_LEAVE,
    )

    incidents = _build_incidents(
        db_session,
        now=now,
        building_a=building_a,
        building_b=building_b,
        floor_a1=floor_a1,
        floor_a2=floor_a2,
        floor_b1=floor_b1,
        seat_a1_s1=seat_a1_s1,
        seat_a1_s2=seat_a1_s2,
        seat_a2_s1=seat_a2_s1,
        seat_b1_s1=seat_b1_s1,
        lighting=lighting,
        hvac=hvac,
        network=network,
        employee_one=employee_one,
        employee_two=employee_two,
        nina=nina,
        omar=omar,
    )
    _build_notes(db_session, incidents=incidents, admin=admin, nina=nina, omar=omar)

    return Dataset(
        now=now,
        building_a=building_a,
        building_b=building_b,
        floor_a1=floor_a1,
        floor_a2=floor_a2,
        floor_b1=floor_b1,
        seat_a1_s1=seat_a1_s1,
        seat_a1_s2=seat_a1_s2,
        seat_a2_s1=seat_a2_s1,
        seat_b1_s1=seat_b1_s1,
        group_facilities=group_facilities,
        group_it=group_it,
        lighting=lighting,
        hvac=hvac,
        network=network,
        admin=admin,
        employee_one=employee_one,
        employee_two=employee_two,
        nina=nina,
        omar=omar,
        pia=pia,
        incidents=incidents,
    )


def _build_incidents(
    session: Session,
    *,
    now: datetime,
    building_a: Building,
    building_b: Building,
    floor_a1: Floor,
    floor_a2: Floor,
    floor_b1: Floor,
    seat_a1_s1: Seat,
    seat_a1_s2: Seat,
    seat_a2_s1: Seat,
    seat_b1_s1: Seat,
    lighting: Category,
    hvac: Category,
    network: Category,
    employee_one: User,
    employee_two: User,
    nina: User,
    omar: User,
) -> dict[str, Incident]:
    """Insert the ten incidents in the table at the top of this module."""
    day = timedelta(days=1)
    made: dict[str, Incident] = {}

    i1_at = now - 10 * day
    made["I1"] = make_incident(
        session,
        reporter=employee_one,
        category=lighting,
        building=building_a,
        floor=floor_a1,
        seat=seat_a1_s1,
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.HIGH,
        created_at=i1_at,
        title="Flickering light over the desk",
    )

    i2_at = now - 9 * day
    made["I2"] = make_incident(
        session,
        reporter=employee_one,
        category=lighting,
        building=building_a,
        floor=floor_a1,
        seat=seat_a1_s1,
        assignee=nina,
        status=IncidentStatus.IN_PROGRESS,
        priority=IncidentPriority.HIGH,
        created_at=i2_at,
        assigned_at=i2_at + _hours(2),
        acknowledged_at=i2_at + _hours(4),
        is_escalated=True,
        escalation_reason="Nobody has looked at this",
        escalated_at=now - day,
        title="Whole bank of lights out",
    )

    i3_at = now - 8 * day
    made["I3"] = make_incident(
        session,
        reporter=employee_one,
        category=hvac,
        building=building_a,
        floor=floor_a1,
        seat=seat_a1_s2,
        assignee=nina,
        status=IncidentStatus.BLOCKED,
        priority=IncidentPriority.CRITICAL,
        created_at=i3_at,
        assigned_at=i3_at + _hours(1),
        acknowledged_at=i3_at + _hours(2),
        title="No cooling on the south side",
    )

    i4_at = now - 7 * day
    made["I4"] = make_incident(
        session,
        reporter=employee_one,
        category=hvac,
        building=building_a,
        floor=floor_a2,
        seat=seat_a2_s1,
        assignee=nina,
        status=IncidentStatus.RESOLVED,
        priority=IncidentPriority.MEDIUM,
        created_at=i4_at,
        assigned_at=i4_at + _hours(4),
        acknowledged_at=i4_at + _hours(6),
        resolved_at=i4_at + _hours(12),
        title="Meeting room is freezing",
    )

    i5_at = now - 6 * day
    made["I5"] = make_incident(
        session,
        reporter=employee_one,
        category=network,
        building=building_a,
        floor=floor_a2,
        seat=seat_a2_s1,
        assignee=omar,
        status=IncidentStatus.CLOSED,
        priority=IncidentPriority.LOW,
        created_at=i5_at,
        assigned_at=i5_at + _hours(8),
        acknowledged_at=i5_at + _hours(10),
        resolved_at=i5_at + _hours(20),
        closed_at=i5_at + _hours(24),
        close_reason=CloseReason.CONFIRMED_FIXED,
        reopen_count=1,
        title="Wi-fi drops in the meeting room",
    )

    i6_at = now - 5 * day
    made["I6"] = make_incident(
        session,
        reporter=employee_two,
        category=lighting,
        building=building_b,
        floor=floor_b1,
        seat=seat_b1_s1,
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.MEDIUM,
        created_at=i6_at,
        is_escalated=True,
        escalation_reason="Third time this month",
        escalated_at=now - 2 * day,
        title="Desk lamp socket is dead",
    )

    i7_at = now - 4 * day
    made["I7"] = make_incident(
        session,
        reporter=employee_two,
        category=network,
        building=building_b,
        floor=floor_b1,
        assignee=omar,
        status=IncidentStatus.IN_PROGRESS,
        priority=IncidentPriority.MEDIUM,
        created_at=i7_at,
        assigned_at=i7_at + _hours(6),
        acknowledged_at=i7_at + _hours(8),
        title="Switch port keeps resetting",
    )

    i8_at = now - 3 * day
    made["I8"] = make_incident(
        session,
        reporter=employee_two,
        category=lighting,
        building=building_b,
        assignee=omar,
        status=IncidentStatus.CLOSED,
        priority=IncidentPriority.LOW,
        created_at=i8_at,
        assigned_at=i8_at + _hours(2),
        acknowledged_at=i8_at + _hours(3),
        resolved_at=i8_at + _hours(5),
        closed_at=i8_at + _hours(6),
        close_reason=CloseReason.CONFIRMED_FIXED,
        title="Lobby lighting on a timer fault",
    )

    i9_at = now - 2 * day
    made["I9"] = make_incident(
        session,
        reporter=employee_two,
        category=lighting,
        building=building_a,
        floor=floor_a1,
        seat=seat_a1_s1,
        assignee=nina,
        status=IncidentStatus.RESOLVED,
        priority=IncidentPriority.HIGH,
        created_at=i9_at,
        assigned_at=i9_at + _hours(3),
        acknowledged_at=i9_at + _hours(5),
        resolved_at=i9_at + _hours(9),
        reopen_count=2,
        title="Same light out again",
    )

    made["I10"] = make_incident(
        session,
        reporter=employee_one,
        category=hvac,
        building=building_a,
        floor=floor_a1,
        seat=seat_a1_s1,
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.CRITICAL,
        created_at=now - 45 * day,
        title="Old ticket from before the window",
    )

    return made


def _build_notes(
    session: Session,
    *,
    incidents: dict[str, Incident],
    admin: User,
    nina: User,
    omar: User,
) -> None:
    """Add the notes the communication report measures.

    Four resolved tickets, deliberately one of each kind: kept informed by an
    engineer, kept informed by an admin, given only an INTERNAL note, and given
    only a note the reporter wrote themselves.
    """
    i2 = incidents["I2"]
    i4 = incidents["I4"]
    i5 = incidents["I5"]
    i8 = incidents["I8"]
    i9 = incidents["I9"]

    # Unresolved, so it counts towards the median first-note time only.
    make_note(
        session,
        incident=i2,
        author=nina,
        body="On my way up with a replacement tube.",
        created_at=i2.created_at + _hours(1),
    )
    make_note(
        session,
        incident=i4,
        author=nina,
        body="Thermostat is being replaced this afternoon.",
        created_at=i4.created_at + _hours(6),
    )
    # INTERNAL: staff-only, so the reporter was never told anything.
    make_note(
        session,
        incident=i5,
        author=omar,
        body="Access point firmware is out of date.",
        visibility=NoteVisibility.INTERNAL,
        created_at=i5.created_at + _hours(4),
    )
    # PUBLIC, but written by the employee who reported it: not staff.
    make_note(
        session,
        incident=i8,
        author=i8.reporter,
        body="Still happening as of this morning.",
        created_at=i8.created_at + _hours(1),
    )
    make_note(
        session,
        incident=i9,
        author=admin,
        body="Reassigning this to the team that fixed it last time.",
        created_at=i9.created_at + _hours(3),
    )


def window_params(dataset: Dataset, *, building_id: uuid.UUID | None = None) -> dict[str, str]:
    """Return the query string pinning the standard thirty-day window."""
    params = {
        "from": (dataset.now - timedelta(days=WINDOW_DAYS)).isoformat(),
        "to": dataset.now.isoformat(),
    }
    if building_id is not None:
        params["building_id"] = str(building_id)
    return params


def scope_params(*, building_id: uuid.UUID | None = None) -> dict[str, str]:
    """Return the query string for a current-state report: a building, or nothing.

    `/reports/blocked-escalated` and `/reports/me` take no period at all, so
    there is nothing else to pin. See decision D9.
    """
    if building_id is None:
        return {}
    return {"building_id": str(building_id)}


@pytest.fixture
def admin_headers(client: TestClient, dataset: Dataset) -> dict[str, str]:
    """Sign in as the fixture admin."""
    return auth_header(login(client, dataset.admin.email))


def get_report(
    client: TestClient,
    path: str,
    headers: dict[str, str],
    params: dict[str, str],
) -> dict:
    """Fetch one report and fail loudly with the body if it did not work."""
    response = client.get(f"{REPORTS}{path}", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


# --- /reports/summary --------------------------------------------------------


def test_summary_counts_the_nine_incidents_in_the_window(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/summary", admin_headers, window_params(dataset))

    # I1..I9 are inside the window; I10 was reported 45 days ago.
    assert body["total"] == 9
    # OPEN I1, I6 + IN_PROGRESS I2, I7 + BLOCKED I3.
    assert body["active_total"] == 5
    # Of those five, I1 and I6 have no assignee.
    assert body["unassigned_total"] == 2
    assert body["blocked_total"] == 1
    # I2 and I6 carry the escalation flag.
    assert body["escalated_total"] == 2


def test_summary_segments_by_status_and_priority(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/summary", admin_headers, window_params(dataset))

    by_status = {row["status"]: row["count"] for row in body["by_status"]}
    assert by_status == {
        "OPEN": 2,  # I1, I6
        "IN_PROGRESS": 2,  # I2, I7
        "BLOCKED": 1,  # I3
        "RESOLVED": 2,  # I4, I9
        "CLOSED": 2,  # I5, I8
    }
    # Every status is present even at zero, and they add up to the total.
    assert sum(by_status.values()) == 9

    by_priority = {row["priority"]: row["count"] for row in body["by_priority"]}
    assert by_priority == {
        "LOW": 2,  # I5, I8
        "MEDIUM": 3,  # I4, I6, I7
        "HIGH": 3,  # I1, I2, I9
        "CRITICAL": 1,  # I3
    }


def test_summary_counts_by_assignee_including_the_unassigned(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/summary", admin_headers, window_params(dataset))

    # Busiest first: Nina holds I2, I3, I4, I9; Omar holds I5, I7, I8; and
    # I1 and I6 belong to nobody, which is the row with a null id.
    assert body["by_assignee"] == [
        {"assignee_id": str(dataset.nina.id), "assignee_name": "Nina Engineer", "count": 4},
        {"assignee_id": str(dataset.omar.id), "assignee_name": "Omar Engineer", "count": 3},
        {"assignee_id": None, "assignee_name": None, "count": 2},
    ]


def test_summary_reports_created_and_closed_for_every_day_in_the_window(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/summary", admin_headers, window_params(dataset))
    per_day = {row["day"]: row for row in body["per_day"]}

    # A thirty-day window spans thirty-one calendar days, inclusive of both ends.
    assert len(body["per_day"]) == 31
    assert sum(row["created"] for row in body["per_day"]) == 9
    # Only I5 and I8 were ever closed.
    assert sum(row["closed"] for row in body["per_day"]) == 2

    day = timedelta(days=1)
    # I6 was reported on this day and I5 was closed on it, 24 h after it was
    # reported on the day before — the two series are independent.
    five_days_ago = (dataset.now - 5 * day).date().isoformat()
    assert per_day[five_days_ago]["created"] == 1
    assert per_day[five_days_ago]["closed"] == 1

    # I8 was reported and closed six hours later, both on this day.
    three_days_ago = (dataset.now - 3 * day).date().isoformat()
    assert per_day[three_days_ago]["created"] == 1
    assert per_day[three_days_ago]["closed"] == 1

    # Nothing at all happened on this one, and it is still in the series.
    quiet_day = (dataset.now - 20 * day).date().isoformat()
    assert per_day[quiet_day] == {"day": quiet_day, "created": 0, "closed": 0}


def test_summary_defaults_to_the_last_thirty_days(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    # No `from` or `to` at all: the same nine incidents, and still not I10.
    body = get_report(client, "/summary", admin_headers, {})

    assert body["total"] == 9
    window_length = datetime.fromisoformat(body["window"]["to"]) - datetime.fromisoformat(
        body["window"]["from"]
    )
    assert window_length == timedelta(days=30)


def test_summary_narrows_to_one_building(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    params = window_params(dataset, building_id=dataset.building_a.id)
    body = get_report(client, "/summary", admin_headers, params)

    # Building A holds I1, I2, I3, I4, I5 and I9. I10 is in building A too but
    # outside the window, so the two filters are both being applied.
    assert body["total"] == 6
    assert body["window"]["building_id"] == str(dataset.building_a.id)


def test_summary_honours_a_narrower_window(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    params = {
        "from": (dataset.now - timedelta(days=5)).isoformat(),
        "to": dataset.now.isoformat(),
    }
    body = get_report(client, "/summary", admin_headers, params)

    # I6 was reported exactly five days ago and `from` is inclusive, so the
    # window holds I6, I7, I8 and I9.
    assert body["total"] == 4


def test_an_inverted_window_is_refused(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    params = {
        "from": dataset.now.isoformat(),
        "to": (dataset.now - timedelta(days=1)).isoformat(),
    }
    response = client.get(f"{REPORTS}/summary", headers=admin_headers, params=params)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "INVALID_REPORT_WINDOW"


# --- /reports/categories -----------------------------------------------------


def test_categories_nests_subcategories_under_their_group(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/categories", admin_headers, window_params(dataset))

    assert body["total"] == 9
    # Facilities = Lighting (I1, I2, I6, I8, I9) + HVAC (I3, I4) = 7, and
    # IT = Network (I5, I7) = 2. Busiest group first, busiest subcategory first.
    assert body["groups"] == [
        {
            "group_id": str(dataset.group_facilities.id),
            "group_name": "Facilities",
            "count": 7,
            "subcategories": [
                {"category_id": str(dataset.lighting.id), "category_name": "Lighting", "count": 5},
                {"category_id": str(dataset.hvac.id), "category_name": "HVAC", "count": 2},
            ],
        },
        {
            "group_id": str(dataset.group_it.id),
            "group_name": "IT",
            "count": 2,
            "subcategories": [
                {"category_id": str(dataset.network.id), "category_name": "Network", "count": 2},
            ],
        },
    ]


def test_categories_respects_the_building_filter(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    params = window_params(dataset, building_id=dataset.building_b.id)
    body = get_report(client, "/categories", admin_headers, params)

    # Building B holds I6 (Lighting), I7 (Network) and I8 (Lighting).
    assert body["total"] == 3
    counts = {group["group_name"]: group["count"] for group in body["groups"]}
    assert counts == {"Facilities": 2, "IT": 1}


# --- /reports/locations ------------------------------------------------------


def test_locations_ranks_buildings_floors_and_seats(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/locations", admin_headers, window_params(dataset))

    assert body["total"] == 9
    # A-1 holds I1..I5 and I9; B-2 holds I6, I7 and I8.
    assert [(row["building_code"], row["count"]) for row in body["buildings"]] == [
        ("A-1", 6),
        ("B-2", 3),
    ]

    # A1 holds I1, I2, I3, I9; A2 holds I4, I5; B1 holds I6, I7. I8 was
    # reported against a whole building and so appears on no floor at all.
    assert [(row["building_code"], row["floor_name"], row["count"]) for row in body["floors"]] == [
        ("A-1", "Level 1", 4),
        ("A-1", "Level 2", 2),
        ("B-2", "Level 1", 2),
    ]

    # A1-S1 holds I1, I2, I9; A2-S1 holds I4, I5; A1-S2 holds I3; B1-S1 holds I6.
    assert [(row["seat_code"], row["count"]) for row in body["seats"]] == [
        ("A1-S1", 3),
        ("A2-S1", 2),
        ("A1-S2", 1),
        ("B1-S1", 1),
    ]
    # The meeting room is carried through as a seat with its type.
    assert body["seats"][1]["seat_type"] == "MEETING_ROOM"


# --- /reports/response-times -------------------------------------------------


def test_response_times_medians_overall(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/response-times", admin_headers, window_params(dataset))
    overall = body["overall"]

    assert overall["priority"] is None
    assert overall["total"] == 9
    # Seven of the nine were assigned and acknowledged; four were resolved.
    assert overall["assigned_count"] == 7
    assert overall["acknowledged_count"] == 7
    assert overall["resolved_count"] == 4

    # Assign times in hours: 2, 1, 4, 8, 6, 2, 3 -> sorted 1, 2, 2, 3, 4, 6, 8.
    assert overall["median_assign_hours"] == 3.0
    # Acknowledge times: 4, 2, 6, 10, 8, 3, 5 -> sorted 2, 3, 4, 5, 6, 8, 10.
    assert overall["median_acknowledge_hours"] == 5.0
    # Resolve times: 12, 20, 5, 9 -> sorted 5, 9, 12, 20. An even count, so
    # percentile_cont interpolates halfway between 9 and 12.
    assert overall["median_resolve_hours"] == 10.5


def test_response_times_per_priority(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/response-times", admin_headers, window_params(dataset))
    rows = {row["priority"]: row for row in body["by_priority"]}

    # The rows arrive in the enum's own order, least urgent first.
    assert [row["priority"] for row in body["by_priority"]] == [
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
    ]

    # LOW is I5 and I8: assign 8 and 2 -> 5.0; acknowledge 10 and 3 -> 6.5;
    # resolve 20 and 5 -> 12.5.
    assert rows["LOW"]["total"] == 2
    assert rows["LOW"]["median_assign_hours"] == 5.0
    assert rows["LOW"]["median_acknowledge_hours"] == 6.5
    assert rows["LOW"]["median_resolve_hours"] == 12.5

    # MEDIUM is I4, I6 and I7. I6 was never assigned, so it contributes to the
    # total and to nothing else: assign 4 and 6 -> 5.0, resolve 12 alone.
    assert rows["MEDIUM"]["total"] == 3
    assert rows["MEDIUM"]["assigned_count"] == 2
    assert rows["MEDIUM"]["resolved_count"] == 1
    assert rows["MEDIUM"]["median_assign_hours"] == 5.0
    assert rows["MEDIUM"]["median_resolve_hours"] == 12.0

    # HIGH is I1, I2 and I9: assign 2 and 3 -> 2.5; only I9 was resolved.
    assert rows["HIGH"]["median_assign_hours"] == 2.5
    assert rows["HIGH"]["median_acknowledge_hours"] == 4.5
    assert rows["HIGH"]["median_resolve_hours"] == 9.0

    # CRITICAL is I3 alone, which is blocked and so has never been resolved.
    # A missing median is null, not zero.
    assert rows["CRITICAL"]["total"] == 1
    assert rows["CRITICAL"]["median_assign_hours"] == 1.0
    assert rows["CRITICAL"]["resolved_count"] == 0
    assert rows["CRITICAL"]["median_resolve_hours"] is None


# --- /reports/engineer-workload ----------------------------------------------


def test_engineer_workload_load_capacity_and_output(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/engineer-workload", admin_headers, window_params(dataset))
    rows = {row["full_name"]: row for row in body["engineers"]}

    # All three engineers appear, busiest first, including the one holding
    # nothing — an availability report that omits idle people is useless.
    assert [row["full_name"] for row in body["engineers"]] == [
        "Nina Engineer",
        "Omar Engineer",
        "Pia Engineer",
    ]

    # Nina holds I2 (IN_PROGRESS), I3 (BLOCKED), I4 and I9 (both RESOLVED).
    # Active means live work only, so two of the four, out of a maximum of ten.
    nina = rows["Nina Engineer"]
    assert nina["level"] == "SENIOR"
    assert nina["availability"] == "AVAILABLE"
    assert (nina["open_count"], nina["in_progress_count"], nina["blocked_count"]) == (0, 1, 1)
    assert nina["active_count"] == 2
    assert nina["max_active_tickets"] == 10
    assert nina["capacity_used_pct"] == 20.0
    # I4 and I9 were both resolved inside the window.
    assert nina["resolved_in_period"] == 2

    # Omar holds I5 and I8 (both CLOSED) and I7 (IN_PROGRESS): one active
    # ticket against a maximum of five, so the same 20% at a different scale.
    omar = rows["Omar Engineer"]
    assert omar["active_count"] == 1
    assert omar["max_active_tickets"] == 5
    assert omar["capacity_used_pct"] == 20.0
    # A closed ticket still records when it was resolved, and both were.
    assert omar["resolved_in_period"] == 2

    pia = rows["Pia Engineer"]
    assert pia["availability"] == "ON_LEAVE"
    assert pia["active_count"] == 0
    assert pia["capacity_used_pct"] == 0.0
    assert pia["resolved_in_period"] == 0


def test_engineer_workload_scopes_output_to_the_window(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    params = {
        "from": (dataset.now - timedelta(days=3)).isoformat(),
        "to": dataset.now.isoformat(),
    }
    body = get_report(client, "/engineer-workload", admin_headers, params)
    rows = {row["full_name"]: row for row in body["engineers"]}

    # Within the last three days only I9 was resolved (Nina) and only I8
    # (Omar) — I4 and I5 were resolved earlier than that.
    assert rows["Nina Engineer"]["resolved_in_period"] == 1
    assert rows["Omar Engineer"]["resolved_in_period"] == 1
    # The live load is a snapshot of now, so a narrower window does not shrink
    # it: Nina is still holding the same two active tickets.
    assert rows["Nina Engineer"]["active_count"] == 2


# --- /reports/blocked-escalated ----------------------------------------------


def test_blocked_and_escalated_totals_and_reasons(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/blocked-escalated", admin_headers, scope_params())

    # A live queue, so there is no period to echo back — only the scope.
    assert "window" not in body
    assert body["scope"]["building_id"] is None

    assert body["blocked_total"] == 1  # I3
    assert body["escalated_total"] == 2  # I2 and I6

    assert len(body["blocked"]) == 1
    assert body["blocked"][0]["blocked_reason_type"] == "WAITING_ON_PARTS"
    assert body["blocked"][0]["count"] == 1

    # Most recently escalated first: I2 yesterday, then I6 the day before.
    assert [row["title"] for row in body["escalated"]] == [
        "Whole bank of lights out",
        "Desk lamp socket is dead",
    ]
    assert body["escalated"][0]["escalation_reason"] == "Nobody has looked at this"
    assert body["escalated"][1]["escalation_reason"] == "Third time this month"
    assert body["escalated"][0]["reference"].startswith("INC-")
    # I2 was escalated 24 hours before `now`, I6 48 hours before it.
    assert body["escalated"][0]["age_hours"] == pytest.approx(24.0, abs=0.05)
    assert body["escalated"][1]["age_hours"] == pytest.approx(48.0, abs=0.05)


def test_blocked_age_is_measured_from_when_the_ticket_became_blocked(
    db_session: Session,
) -> None:
    """Three blocked tickets with ages nobody has to guess at.

    Driven through the service rather than HTTP so `now` is fixed and the ages
    are exact rather than approximate.
    """
    now = utc_now()
    day = timedelta(days=1)

    reporter = make_user(db_session)
    building = make_building(db_session)
    group = make_category(db_session)
    category = make_category(db_session, parent=group)

    # Reported ten days ago but only blocked two days ago: 48 hours stuck.
    recently_blocked = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.BLOCKED,
        created_at=now - 10 * day,
    )
    make_event(
        db_session,
        incident=recently_blocked,
        event_type=EventType.STATUS_CHANGED,
        from_value=IncidentStatus.IN_PROGRESS.value,
        to_value=IncidentStatus.BLOCKED.value,
        created_at=now - 2 * day,
    )

    # No event at all, so the age falls back to when it was reported: 144 hours.
    make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.BLOCKED,
        created_at=now - 6 * day,
    )

    # A different reason, so a group of its own: 96 hours.
    make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.BLOCKED,
        blocked_reason_type=BlockedReasonType.ACCESS_REQUIRED,
        created_at=now - 4 * day,
    )

    scope = ReportScope(as_of=now)
    report = reporting.blocked_escalated(db_session, scope)

    assert report.blocked_total == 3
    waiting, access = report.blocked

    assert waiting.blocked_reason_type == BlockedReasonType.WAITING_ON_PARTS
    assert waiting.count == 2
    # (48 + 144) / 2.
    assert waiting.average_age_hours == 96.0
    assert waiting.max_age_hours == 144.0

    assert access.blocked_reason_type == BlockedReasonType.ACCESS_REQUIRED
    assert access.count == 1
    assert access.average_age_hours == 96.0
    assert access.max_age_hours == 96.0


def test_blocked_escalated_shows_a_ticket_blocked_long_before_the_window(
    client: TestClient,
    db_session: Session,
    dataset: Dataset,
    admin_headers: dict[str, str],
) -> None:
    """The regression test for D9: an old ticket that is still stuck must appear.

    This report was window-scoped under D5, so a ticket blocked ninety days ago
    and still blocked was missing from the default thirty-day view — the single
    row an admin most needs to see. The request below still sends that window,
    because a dashboard with a period picker will, and it must make no
    difference.
    """
    day = timedelta(days=1)
    make_incident(
        db_session,
        reporter=dataset.employee_one,
        category=dataset.hvac,
        building=dataset.building_a,
        floor=dataset.floor_a1,
        status=IncidentStatus.BLOCKED,
        blocked_reason_type=BlockedReasonType.ACCESS_REQUIRED,
        created_at=dataset.now - 90 * day,
        title="Plant room has been locked since the summer",
    )

    body = get_report(client, "/blocked-escalated", admin_headers, window_params(dataset))

    # I3, blocked eight days ago, plus the ninety-day-old one.
    assert body["blocked_total"] == 2
    groups = {row["blocked_reason_type"]: row for row in body["blocked"]}
    assert groups["WAITING_ON_PARTS"]["count"] == 1
    assert groups["ACCESS_REQUIRED"]["count"] == 1

    # No STATUS_CHANGED event on it, so the age falls back to when it was
    # reported: 90 days is 2160 hours, and it is the oldest thing here.
    access = groups["ACCESS_REQUIRED"]
    assert access["average_age_hours"] == pytest.approx(2160.0, abs=0.05)
    assert access["max_age_hours"] == pytest.approx(2160.0, abs=0.05)


def test_escalated_list_drops_a_ticket_that_was_closed_while_still_flagged(
    client: TestClient,
    db_session: Session,
    dataset: Dataset,
    admin_headers: dict[str, str],
) -> None:
    """The regression test for D10: a flag outliving the work it was about.

    `is_escalated` is raised by `escalate` and lowered only by
    `clear_escalation`; resolving or closing a ticket leaves it standing, on
    purpose, because it is history. So an escalation that was dealt with by
    fixing the thing rather than by an admin clicking Clear stays flagged for
    ever. D9 removed the thirty-day window that used to age those rows out, so
    without a status filter they accumulate until fifty of them crowd the live
    escalations out of a list capped at `ESCALATED_TICKET_LIMIT`.

    Both tickets below are escalated *more recently* than I2 and I6, so if the
    filter were missing they would head the list rather than hide at the end of
    it.
    """
    hour = timedelta(hours=1)
    make_incident(
        db_session,
        reporter=dataset.employee_one,
        category=dataset.hvac,
        building=dataset.building_a,
        floor=dataset.floor_a1,
        status=IncidentStatus.CLOSED,
        created_at=dataset.now - 3 * timedelta(days=1),
        closed_at=dataset.now - hour,
        close_reason=CloseReason.CONFIRMED_FIXED,
        is_escalated=True,
        escalation_reason="Escalated, then fixed and closed without clearing",
        escalated_at=dataset.now - 2 * hour,
        title="Closed but still flagged",
    )
    make_incident(
        db_session,
        reporter=dataset.employee_one,
        category=dataset.hvac,
        building=dataset.building_a,
        floor=dataset.floor_a1,
        status=IncidentStatus.RESOLVED,
        created_at=dataset.now - 3 * timedelta(days=1),
        resolved_at=dataset.now - hour,
        is_escalated=True,
        escalation_reason="Escalated, then resolved without clearing",
        escalated_at=dataset.now - 3 * hour,
        title="Resolved but still flagged",
    )

    body = get_report(client, "/blocked-escalated", admin_headers, scope_params())

    # Four incidents now carry the flag; only I2 and I6 are still live work.
    assert body["escalated_total"] == 2
    assert len(body["escalated"]) == 2
    assert [row["title"] for row in body["escalated"]] == [
        "Whole bank of lights out",
        "Desk lamp socket is dead",
    ]
    assert [row["status"] for row in body["escalated"]] == ["IN_PROGRESS", "OPEN"]
    assert "Closed but still flagged" not in [row["title"] for row in body["escalated"]]
    assert "Resolved but still flagged" not in [row["title"] for row in body["escalated"]]

    # The blocked half is untouched by this: I3 is still the only blocked one.
    assert body["blocked_total"] == 1


def test_blocked_escalated_still_narrows_to_a_building(
    client: TestClient,
    db_session: Session,
    dataset: Dataset,
    admin_headers: dict[str, str],
) -> None:
    """`building_id` is a scope filter and survives D9; only the period went."""
    day = timedelta(days=1)
    make_incident(
        db_session,
        reporter=dataset.employee_one,
        category=dataset.hvac,
        building=dataset.building_a,
        status=IncidentStatus.BLOCKED,
        created_at=dataset.now - 90 * day,
        title="Plant room has been locked since the summer",
    )

    params = scope_params(building_id=dataset.building_b.id)
    body = get_report(client, "/blocked-escalated", admin_headers, params)

    assert body["scope"]["building_id"] == str(dataset.building_b.id)
    # Both blocked tickets are in building A, so building B has none.
    assert body["blocked_total"] == 0
    assert body["blocked"] == []
    # I6 is escalated and in building B; I2 is escalated and in building A.
    assert body["escalated_total"] == 1
    assert [row["title"] for row in body["escalated"]] == ["Desk lamp socket is dead"]


# --- /reports/communication --------------------------------------------------


def test_communication_measures_who_was_kept_informed(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    body = get_report(client, "/communication", admin_headers, window_params(dataset))

    assert body["total"] == 9
    # I4, I5, I8 and I9 all carry a resolved_at — closing a ticket does not
    # erase the fact that it was resolved first.
    assert body["resolved_total"] == 4
    # Of those four only I4 (engineer's public note) and I9 (admin's public
    # note) were told anything before resolution. I5's note was INTERNAL and
    # I8's was written by the reporter, who is not staff.
    assert body["informed_total"] == 2
    assert body["informed_pct"] == 50.0

    # First public staff note, in hours after the ticket was reported:
    # I2 at 1, I9 at 3, I4 at 6. I5 and I8 have none and drop out.
    assert body["median_first_public_note_hours"] == 3.0

    # I5 was reopened once and I9 twice; 2 of 9 is 22.2% to one decimal.
    assert body["reopened_total"] == 2
    assert body["reopen_rate_pct"] == 22.2


def test_communication_is_null_rather_than_zero_when_nothing_resolved(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str]
) -> None:
    # A window covering only the last day holds nothing at all: no ticket was
    # reported in it. "No data" must not render as "0% informed".
    params = {
        "from": (dataset.now - timedelta(hours=12)).isoformat(),
        "to": dataset.now.isoformat(),
    }
    body = get_report(client, "/communication", admin_headers, params)

    assert body["total"] == 0
    assert body["resolved_total"] == 0
    assert body["informed_pct"] is None
    assert body["reopen_rate_pct"] is None
    assert body["median_first_public_note_hours"] is None


# --- /reports/me -------------------------------------------------------------


def test_me_gives_an_employee_the_tickets_they_reported(
    client: TestClient, dataset: Dataset
) -> None:
    headers = auth_header(login(client, dataset.employee_one.email))
    body = get_report(client, "/me", headers, scope_params())

    assert body["role"] == "EMPLOYEE"
    # Current state, not a period: Eve reported I1 to I5, and I10 forty-five
    # days ago. I10 is still OPEN, so it is still on her home screen (D9).
    assert body["reported"] == {
        "total": 6,
        "active": 4,  # I1 OPEN, I2 IN_PROGRESS, I3 BLOCKED, I10 OPEN
        "open": 2,  # I1 and I10
        "in_progress": 1,
        "blocked": 1,
        "resolved": 1,  # I4
        "closed": 1,  # I5
        "escalated": 1,  # I2
    }
    # Only an engineer can be an assignee, so there is no assigned block.
    assert body["assigned"] is None
    # No period was applied, so none is echoed back.
    assert "window" not in body
    assert body["scope"]["building_id"] is None


def test_me_gives_an_engineer_both_capacities(client: TestClient, dataset: Dataset) -> None:
    headers = auth_header(login(client, dataset.nina.email))
    body = get_report(client, "/me", headers, scope_params())

    assert body["role"] == "ENGINEER"
    # Nina reported nothing herself.
    assert body["reported"]["total"] == 0
    assert body["assigned"] == {
        "total": 4,  # I2, I3, I4, I9
        "active": 2,  # I2 IN_PROGRESS, I3 BLOCKED
        "open": 0,
        "in_progress": 1,
        "blocked": 1,
        "resolved": 2,  # I4, I9
        "closed": 0,
        "escalated": 1,  # I2
    }


def test_me_narrows_to_a_building(client: TestClient, dataset: Dataset) -> None:
    """`building_id` is a scope filter, so it survives D9 where the period did not."""
    headers = auth_header(login(client, dataset.employee_two.email))
    params = scope_params(building_id=dataset.building_b.id)
    body = get_report(client, "/me", headers, params)

    # Evan reported I6, I7, I8 in building B and I9 in building A.
    assert body["reported"]["total"] == 3


def test_me_counts_a_ticket_reported_long_before_the_window(
    client: TestClient, db_session: Session, dataset: Dataset
) -> None:
    """The regression test for D9: home tiles are current state, not a period.

    `/reports/me` was window-scoped under D7, so a ticket somebody reported
    sixty days ago and is still waiting on was silently missing from their
    "Open" tile. The request below still sends the thirty-day window, and it
    must make no difference.
    """
    day = timedelta(days=1)
    make_incident(
        db_session,
        reporter=dataset.employee_two,
        category=dataset.lighting,
        building=dataset.building_b,
        floor=dataset.floor_b1,
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.LOW,
        created_at=dataset.now - 60 * day,
        title="Stairwell light has been out since July",
    )

    headers = auth_header(login(client, dataset.employee_two.email))
    body = get_report(client, "/me", headers, window_params(dataset))

    # Evan reported I6, I7, I8 and I9 inside the window, plus this one sixty
    # days before it. Two of his five are open: I6 and the sixty-day-old one.
    assert body["reported"] == {
        "total": 5,
        "active": 3,  # I6 OPEN, I7 IN_PROGRESS, the sixty-day-old one OPEN
        "open": 2,
        "in_progress": 1,
        "blocked": 0,
        "resolved": 1,  # I9
        "closed": 1,  # I8
        "escalated": 1,  # I6
    }


def test_me_drops_an_escalation_on_a_ticket_the_reporter_has_had_closed(
    client: TestClient, db_session: Session, dataset: Dataset
) -> None:
    """The regression test for D11: the same stale flag D10 fixed next door.

    `/reports/me` is the other current-state report (D9), so the same rule
    applies to it: `is_escalated` is lowered only by `clear_escalation`, never
    by closing the ticket, so an escalation that ended the usual way — an
    engineer fixed the thing and the ticket closed — leaves the flag standing
    for ever. Counting it on an employee's home tile tells them they have an
    escalation outstanding when the work is finished and there is nothing they
    or anybody else can do about it.

    Eve's live escalation (I2, IN_PROGRESS) must still be counted; the closed
    one below must not.
    """
    day = timedelta(days=1)
    make_incident(
        db_session,
        reporter=dataset.employee_one,
        category=dataset.hvac,
        building=dataset.building_a,
        floor=dataset.floor_a1,
        status=IncidentStatus.CLOSED,
        priority=IncidentPriority.HIGH,
        created_at=dataset.now - 4 * day,
        resolved_at=dataset.now - 2 * day,
        closed_at=dataset.now - day,
        close_reason=CloseReason.CONFIRMED_FIXED,
        is_escalated=True,
        escalation_reason="Escalated, then fixed and closed without clearing",
        escalated_at=dataset.now - 3 * day,
        title="Escalated and since closed",
    )

    headers = auth_header(login(client, dataset.employee_one.email))
    body = get_report(client, "/me", headers, scope_params())

    # Eve's six from the fixture table plus the closed one above. Two of her
    # tickets now carry the flag; only I2 is still live work.
    assert body["reported"] == {
        "total": 7,
        "active": 4,  # I1 OPEN, I2 IN_PROGRESS, I3 BLOCKED, I10 OPEN
        "open": 2,  # I1 and I10
        "in_progress": 1,
        "blocked": 1,
        "resolved": 1,  # I4
        "closed": 2,  # I5 and the one above
        "escalated": 1,  # I2 only: the closed one is history, not a live flag
    }


# --- Permissions -------------------------------------------------------------


ADMIN_REPORTS = [
    "/summary",
    "/categories",
    "/locations",
    "/response-times",
    "/engineer-workload",
    "/blocked-escalated",
    "/communication",
]


@pytest.mark.parametrize("path", ADMIN_REPORTS)
def test_an_employee_cannot_read_an_admin_report(
    client: TestClient, dataset: Dataset, path: str
) -> None:
    headers = auth_header(login(client, dataset.employee_one.email))
    response = client.get(f"{REPORTS}{path}", headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["code"] == "ROLE_NOT_PERMITTED"


@pytest.mark.parametrize("path", ADMIN_REPORTS)
def test_an_engineer_cannot_read_an_admin_report(
    client: TestClient, dataset: Dataset, path: str
) -> None:
    headers = auth_header(login(client, dataset.nina.email))
    response = client.get(f"{REPORTS}{path}", headers=headers)

    assert response.status_code == 403, response.text


@pytest.mark.parametrize("path", ADMIN_REPORTS)
def test_an_admin_can_read_every_report(
    client: TestClient, dataset: Dataset, admin_headers: dict[str, str], path: str
) -> None:
    response = client.get(f"{REPORTS}{path}", headers=admin_headers)

    assert response.status_code == 200, response.text
    # The period reports echo the window they measured; the blocked/escalated
    # queue describes the present and echoes its scope instead (D9).
    echo = "scope" if path == "/blocked-escalated" else "window"
    assert response.json()[echo]["building_id"] is None


@pytest.mark.parametrize("path", [*ADMIN_REPORTS, "/me"])
def test_every_report_needs_a_signed_in_caller(client: TestClient, path: str) -> None:
    response = client.get(f"{REPORTS}{path}")

    assert response.status_code == 401, response.text


def test_everyone_may_read_their_own_counts(client: TestClient, dataset: Dataset) -> None:
    for user in (dataset.employee_one, dataset.nina, dataset.admin):
        headers = auth_header(login(client, user.email))
        response = client.get(f"{REPORTS}/me", headers=headers)
        assert response.status_code == 200, response.text
