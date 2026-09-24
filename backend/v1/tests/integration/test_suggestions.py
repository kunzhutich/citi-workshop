"""`GET /incidents/suggestions` — what the questionnaire offers before you file.

The feature is a ranking, so most of this file is about **order**, and order
is the thing a test most easily asserts a proxy for. Two habits here, both
learned from DECISION-LOG D24/D25/D35/D40:

* nothing states "the first row is the seat match" without also stating that
  the building-level row it beat is *newer*, because a ranking that ignored
  specificity entirely would pass the first claim on a lucky fixture;
* every "does not appear" assertion is made on a database that provably
  contains something that does, since a negative assertion is free on an
  empty table.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.category import Category
from app.models.enums import CloseReason, IncidentStatus, LocationDetail
from app.models.floor import Floor
from app.models.seat import Seat
from app.models.user import User
from tests.factories import (
    auth_header,
    login,
    make_building,
    make_category,
    make_floor,
    make_incident,
    make_seat,
    make_user,
)

#: A fixed instant, so "a week ago" and "this morning" are exact and the
#: ordering assertions are not a statement about the hour the suite runs.
NOW = datetime(2026, 6, 15, 12, 0, tzinfo=UTC)


def ago(**delta: float) -> datetime:
    """Return an instant before `NOW`, for placing a ticket in time."""
    return NOW - timedelta(**delta)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Ada Reporter")


@pytest.fixture
def headers(client: TestClient, reporter: User) -> dict[str, str]:
    return auth_header(login(client, reporter.email))


@pytest.fixture
def building(db_session: Session) -> Building:
    return make_building(db_session, name="San Francisco HQ", code="SFO-1")


@pytest.fixture
def floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 3", level_number=3)


@pytest.fixture
def other_floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 4", level_number=4)


@pytest.fixture
def seat(db_session: Session, floor: Floor) -> Seat:
    return make_seat(db_session, floor, code="3-A-01")


@pytest.fixture
def other_seat(db_session: Session, floor: Floor) -> Seat:
    return make_seat(db_session, floor, code="3-A-02")


@pytest.fixture
def printer(db_session: Session) -> Category:
    """Return a SEAT-precision subcategory, so a request can carry every location field.

    The **group** is left unnamed so `make_category` generates a unique one.
    `tests/integration/test_ops_actions.py` runs the `migrate` action, which
    owns its own session and genuinely commits the seeded tree, so a fixture
    that asked for a group called "Hardware" would collide with it in a full
    run and pass on its own.
    """
    group = make_category(db_session, location_detail=LocationDetail.SEAT)
    return make_category(db_session, name="Printer/Scanner", parent=group)


@pytest.fixture
def wifi(db_session: Session) -> Category:
    """Return a second subcategory, for proving the category filter is exact."""
    group = make_category(db_session, location_detail=LocationDetail.SEAT)
    return make_category(db_session, name="Wi-Fi", parent=group)


def ask(
    client: TestClient,
    headers: dict[str, str],
    *,
    category: Category,
    building: Building,
    floor: Floor | None = None,
    seat: Seat | None = None,
) -> dict[str, list[dict[str, object]]]:
    """Call the endpoint the way the questionnaire does."""
    params: dict[str, str] = {
        "category_id": str(category.id),
        "building_id": str(building.id),
    }
    if floor is not None:
        params["floor_id"] = str(floor.id)
    if seat is not None:
        params["seat_id"] = str(seat.id)

    response = client.get("/api/v1/incidents/suggestions", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def references(rows: list[dict[str, object]]) -> list[str]:
    """Return just the ticket references, in the order they came back."""
    return [str(row["reference"]) for row in rows]


# --- The ranking -------------------------------------------------------------


def test_a_week_old_seat_match_outranks_a_fresh_building_level_one(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    other_floor: Floor,
    seat: Seat,
) -> None:
    """The whole point of ranking by band first, and the case one score fails.

    The seat match is **seven days older** than the building-level one, which
    is what makes this an assertion about specificity rather than about
    recency: any implementation that blends the two into a single number puts
    the fresh one first, and so does one that forgot to order by the band at
    all.
    """
    stale_but_exact = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        title="Printer jams on every other page",
        created_at=ago(days=7),
    )
    fresh_but_vague = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=other_floor,
        title="Printer out of toner",
        created_at=ago(hours=1),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [stale_but_exact.reference, fresh_but_vague.reference]
    assert [row["match"] for row in live] == ["SEAT", "BUILDING"]


def test_the_three_bands_come_back_most_specific_first(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    other_floor: Floor,
    seat: Seat,
    other_seat: Seat,
) -> None:
    """All three bands at once, each one older than the band below it.

    The ages run the wrong way on purpose — the seat match is the oldest and
    the building match the newest — so the order asserted here is produced by
    specificity and could not be produced by recency.
    """
    same_seat = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        created_at=ago(days=9),
    )
    same_floor = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=other_seat,
        created_at=ago(days=5),
    )
    same_building = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=other_floor,
        created_at=ago(hours=2),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [
        same_seat.reference,
        same_floor.reference,
        same_building.reference,
    ]
    assert [row["match"] for row in live] == ["SEAT", "FLOOR", "BUILDING"]


def test_inside_one_band_the_newest_comes_first(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """Recency is the second term, and it still has to work.

    Written separately from the specificity tests because the two must stay
    separable: a change that made the band the only term would leave those
    passing and this one failing.
    """
    older = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        created_at=ago(days=3),
    )
    newer = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        created_at=ago(hours=4),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [newer.reference, older.reference]
    assert {row["match"] for row in live} == {"SEAT"}


def test_a_request_with_no_seat_never_produces_a_seat_match(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """`match` describes the overlap, not how precise the suggested ticket is.

    The candidate below *has* a seat. The reporter did not name one, so there
    is nothing for it to be the same as, and calling it a SEAT match would
    tell them "somebody reported this exact desk" about a desk they never
    mentioned. It is a FLOOR match, which is the strongest true claim.
    """
    at_a_desk = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        created_at=ago(hours=3),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor)["live"]

    assert references(live) == [at_a_desk.reference]
    assert live[0]["match"] == "FLOOR"


def test_a_request_with_only_a_building_bands_everything_as_building(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """A BUILDING-precision group asks for no floor, so nothing can beat it."""
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        created_at=ago(hours=3),
    )

    live = ask(client, headers, category=printer, building=building)["live"]

    assert len(live) == 1
    assert live[0]["match"] == "BUILDING"


# --- What is and is not a candidate ------------------------------------------


def test_a_closed_ticket_is_never_in_the_live_list(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """An absence asserted beside a presence, so an empty table cannot pass it.

    The open ticket is there to prove the query found this seat at all. The
    closed one is identical in every other way — same subcategory, same desk,
    newer — so its absence is about its status and nothing else.
    """
    still_open = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.OPEN,
        created_at=ago(days=2),
    )
    closed = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.CLOSED,
        close_reason=CloseReason.CONFIRMED_FIXED,
        created_at=ago(hours=1),
        closed_at=ago(minutes=30),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [still_open.reference]
    assert closed.reference not in references(live)


@pytest.mark.parametrize(
    "status",
    [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED],
)
def test_every_unfinished_status_is_a_live_suggestion(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
    status: IncidentStatus,
) -> None:
    """Live means "still being worked on", not "not yet started"."""
    incident = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=status,
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [incident.reference]


def test_another_subcategory_is_not_a_suggestion(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    wifi: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """Wi-Fi and Printer/Scanner are not the same problem at the same desk."""
    same_kind = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
    )
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=wifi,
        building=building,
        floor=floor,
        seat=seat,
    )

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert references(live) == [same_kind.reference]


def test_another_building_is_not_a_suggestion(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The building is a filter; the floor and the seat only rank."""
    here = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
    )
    elsewhere_building = make_building(db_session, name="Austin Campus", code="AUS-1")
    elsewhere = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=elsewhere_building,
        floor=make_floor(db_session, elsewhere_building),
    )

    live = ask(client, headers, category=printer, building=building, floor=floor)["live"]

    assert references(live) == [here.reference]
    assert elsewhere.reference not in references(live)


def test_at_most_a_handful_come_back(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """The panel is a prompt, not a list to scroll.

    Nine candidates, and the five newest are the ones returned — so the cap is
    applied after the ordering rather than before it, which is the mistake
    that would show the five oldest.
    """
    created = [
        make_incident(
            db_session,
            reporter=make_user(db_session),
            category=printer,
            building=building,
            floor=floor,
            seat=seat,
            created_at=ago(days=index + 1),
        )
        for index in range(9)
    ]

    live = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)["live"]

    assert len(live) == 5
    assert references(live) == [incident.reference for incident in created[:5]]


# --- The resolved list -------------------------------------------------------


def test_a_resolved_ticket_carries_what_was_done_about_it(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """The institutional memory this list exists for."""
    fixed = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.RESOLVED,
        title="Printer jams constantly",
        resolved_at=ago(days=4),
    )
    fixed.resolution_summary = "Cleared a paper fragment from the rear feed roller."
    db_session.flush()

    resolved = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)[
        "resolved"
    ]

    assert len(resolved) == 1
    assert resolved[0]["reference"] == fixed.reference
    assert resolved[0]["resolution_summary"] == (
        "Cleared a paper fragment from the rear feed roller."
    )
    assert resolved[0]["match"] == "SEAT"
    assert resolved[0]["location"]["seat_code"] == "3-A-01"


def test_a_resolved_ticket_with_no_summary_is_not_offered(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """A link with nothing behind it is worse than no link.

    Asserted against a database that also holds a resolved ticket that *does*
    have a summary, so this cannot pass because the query returned nothing at
    all — which is exactly how a wrong `WHERE` clause would look.
    """
    with_summary = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.RESOLVED,
        resolved_at=ago(days=6),
    )
    with_summary.resolution_summary = "Replaced the fuser unit."
    without_summary = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.CLOSED,
        close_reason=CloseReason.ADMIN_CLOSED,
        closed_at=ago(hours=2),
    )
    db_session.flush()

    resolved = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)[
        "resolved"
    ]

    assert references(resolved) == [with_summary.reference]
    assert without_summary.resolution_summary is None


def test_a_closed_ticket_with_a_summary_is_offered(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    seat: Seat,
) -> None:
    """Closed is finished, not forgotten: the fix is still what was done."""
    closed = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.CLOSED,
        close_reason=CloseReason.CONFIRMED_FIXED,
        resolved_at=ago(days=2),
        closed_at=ago(days=1),
    )
    closed.resolution_summary = "Reseated the network cable behind the printer."
    db_session.flush()

    lists = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)

    assert references(lists["resolved"]) == [closed.reference]
    # And still not in the live list, which is the other half of the claim.
    assert lists["live"] == []


def test_resolved_suggestions_rank_by_band_then_by_when_they_were_fixed(
    client: TestClient,
    db_session: Session,
    headers: dict[str, str],
    printer: Category,
    building: Building,
    floor: Floor,
    other_floor: Floor,
    seat: Seat,
) -> None:
    """Same two terms as the live list, and the recency column is `resolved_at`.

    The seat match was *reported* most recently and *fixed* longest ago, so
    neither `created_at` nor a blended score produces this order.
    """
    exact = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=floor,
        seat=seat,
        status=IncidentStatus.RESOLVED,
        created_at=ago(days=2),
        resolved_at=ago(days=1, hours=12),
    )
    exact.resolution_summary = "Cleared the rear feed roller."
    vague = make_incident(
        db_session,
        reporter=make_user(db_session),
        category=printer,
        building=building,
        floor=other_floor,
        status=IncidentStatus.RESOLVED,
        created_at=ago(days=20),
        resolved_at=ago(hours=1),
    )
    vague.resolution_summary = "Refilled the paper tray."
    db_session.flush()

    resolved = ask(client, headers, category=printer, building=building, floor=floor, seat=seat)[
        "resolved"
    ]

    assert references(resolved) == [exact.reference, vague.reference]
    assert [row["match"] for row in resolved] == ["SEAT", "BUILDING"]


# --- Access and edges --------------------------------------------------------


def test_suggestions_need_a_signed_in_caller(client: TestClient, building: Building) -> None:
    response = client.get(
        "/api/v1/incidents/suggestions",
        params={"category_id": str(uuid.uuid4()), "building_id": str(building.id)},
    )

    assert response.status_code == 401


def test_the_category_and_the_building_are_both_required(
    client: TestClient,
    headers: dict[str, str],
    building: Building,
) -> None:
    """Without both there is no question to answer, so it is a 422, not an empty list."""
    response = client.get(
        "/api/v1/incidents/suggestions",
        params={"building_id": str(building.id)},
        headers=headers,
    )

    assert response.status_code == 422


def test_ids_that_match_nothing_produce_empty_lists(
    client: TestClient,
    headers: dict[str, str],
    printer: Category,
    building: Building,
) -> None:
    """Deliberately not a 404.

    This runs while the reporter is still filling the form; an error there has
    nowhere to be shown and nothing for them to do about it. The ids are
    validated for real by `POST /incidents`.
    """
    response = client.get(
        "/api/v1/incidents/suggestions",
        params={"category_id": str(uuid.uuid4()), "building_id": str(building.id)},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {"live": [], "resolved": []}


def test_the_path_is_not_read_as_an_incident_id(
    client: TestClient,
    headers: dict[str, str],
    printer: Category,
    building: Building,
) -> None:
    """`/suggestions` is declared before `/{incident_id}` and must stay there.

    Swapping the two turns every call into "suggestions is not a valid UUID",
    and the symptom — a 422 from a route that takes no path parameter — is
    obscure enough to be worth pinning down here.
    """
    response = client.get(
        "/api/v1/incidents/suggestions",
        params={"category_id": str(printer.id), "building_id": str(building.id)},
        headers=headers,
    )

    assert response.status_code == 200
