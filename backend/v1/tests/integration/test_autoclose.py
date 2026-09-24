"""Resolved tickets that nobody came back to, closed after a week of silence.

Four rules, and each is asserted from both sides because three of the four are
about a boundary.

* **Seven days of quiet, measured from the repair.** A ticket one hour short
  is not closed; one hour past is.
* **A public note restarts the clock.** This is the rule an implementation
  would most plausibly drop — it is the one that makes an automatic close feel
  like housekeeping rather than a filing error — so it is asserted with the
  ticket's *resolution* long past the deadline and only the note holding it
  open.
* **An internal note does not.** The reporter cannot see one, so staff talking
  among themselves is not evidence anybody is waiting on a reply.
* **Only RESOLVED tickets.** Everything else is either finished or still being
  worked on.

The sweep runs on `GET /incidents`, so most of these drive that endpoint
rather than calling the service: a rule that holds in a unit test and is never
reached from a request is a rule nobody has.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    CloseReason,
    EventType,
    IncidentStatus,
    LocationDetail,
    NoteVisibility,
)
from app.models.event import IncidentEvent
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.user import User
from app.services import autoclose
from app.workflow import AUTOCLOSE_AFTER
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_floor,
    make_incident,
    make_note,
    make_user,
)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Robin Reporter")


@pytest.fixture
def engineer(db_session: Session) -> User:
    return make_engineer(db_session, full_name="Sam Senior")


@pytest.fixture
def admin(db_session: Session) -> User:
    return make_admin(db_session, full_name="Henry Ford")


@pytest.fixture
def building(db_session: Session) -> Building:
    return make_building(db_session, name="San Francisco HQ", code="SFO-1")


@pytest.fixture
def floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 3", level_number=3)


@pytest.fixture
def category(db_session: Session) -> Category:
    group = make_category(db_session, location_detail=LocationDetail.FLOOR)
    return make_category(db_session, name="Monitor", parent=group)


def ticket(
    db_session: Session,
    *,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor,
    engineer: User,
    resolved_ago: timedelta,
    status: IncidentStatus = IncidentStatus.RESOLVED,
    title: str = "Monitor flickers",
) -> Incident:
    """Insert a ticket resolved `resolved_ago` in the past."""
    return make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
        resolved_by=engineer,
        status=status,
        resolved_at=utc_now() - resolved_ago,
        title=title,
    )


def sweep(client: TestClient, user: User) -> None:
    """Drive the route the sweep hangs off, as a person would."""
    response = client.get("/api/v1/incidents", headers=auth_header(login(client, user.email)))
    assert response.status_code == 200


def reread(db_session: Session, incident: Incident) -> Incident:
    """Re-read a ticket, so an assertion sees what the request committed."""
    db_session.expire_all()
    fresh = db_session.get(Incident, incident.id)
    assert fresh is not None
    return fresh


# --- The deadline -------------------------------------------------------------


def test_a_resolved_ticket_closes_itself_after_the_quiet_window(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER + timedelta(hours=1),
    )

    sweep(client, admin)

    closed = reread(db_session, incident)
    assert closed.status == IncidentStatus.CLOSED
    assert closed.close_reason == CloseReason.SYSTEM_CLOSED
    assert closed.closed_at is not None


def test_a_ticket_an_hour_short_of_the_window_is_left_alone(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The other side of the boundary, without which the test above is about nothing.

    A sweep that closed everything resolved would satisfy it perfectly.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER - timedelta(hours=1),
    )

    sweep(client, admin)

    assert reread(db_session, incident).status == IncidentStatus.RESOLVED


@pytest.mark.parametrize(
    "status",
    [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED],
)
def test_only_resolved_tickets_are_swept(
    client: TestClient,
    db_session: Session,
    status: IncidentStatus,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A ticket still being worked on is not stale, however old it is.

    These are ancient on purpose — far past any deadline — so the thing
    keeping them open is the status rule rather than the clock.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=timedelta(days=90),
        status=status,
    )

    sweep(client, admin)

    assert reread(db_session, incident).status == status


# --- The note that holds it open ----------------------------------------------


def test_a_public_note_restarts_the_clock(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The rule that makes an automatic close housekeeping rather than a filing error.

    The repair is a month old — far past any deadline — and the only thing
    holding this ticket open is that somebody wrote to the reporter yesterday.
    An implementation that measured from `resolved_at` alone closes it, and
    closes it in the middle of a conversation.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=timedelta(days=30),
    )
    make_note(
        db_session,
        incident=incident,
        author=engineer,
        body="Checking this is still holding up — let me know either way.",
        created_at=utc_now() - timedelta(days=1),
    )

    sweep(client, admin)

    assert reread(db_session, incident).status == IncidentStatus.RESOLVED


def test_a_public_note_older_than_the_window_does_not_hold_it_open(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The other side of the same rule: a conversation that itself went quiet.

    Without this, "a public note restarts the clock" is satisfied by an
    implementation that never closes a ticket which has any note on it at all.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=timedelta(days=30),
    )
    make_note(
        db_session,
        incident=incident,
        author=engineer,
        body="Replaced the cable.",
        created_at=utc_now() - timedelta(days=20),
    )

    sweep(client, admin)

    assert reread(db_session, incident).status == IncidentStatus.CLOSED


def test_an_internal_note_does_not_hold_it_open(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The reporter cannot see one, so it is not evidence anybody is waiting.

    A ticket held open by a conversation its reporter is not party to would be
    held open invisibly — and the same note written PUBLIC *does* hold it
    open, which the test above proves, so this is a statement about
    visibility rather than about notes.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=timedelta(days=30),
    )
    make_note(
        db_session,
        incident=incident,
        author=engineer,
        body="Third failure on this batch — flag to the vendor.",
        visibility=NoteVisibility.INTERNAL,
        created_at=utc_now() - timedelta(days=1),
    )

    sweep(client, admin)

    assert reread(db_session, incident).status == IncidentStatus.CLOSED


# --- What it records ----------------------------------------------------------


def test_it_records_an_event_with_no_actor(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Nobody closed it, so the audit row names nobody.

    `incident_events.actor_id` has always been nullable, which is why this
    needs no invented "System" account — a real row somebody could try to
    sign in as. The timeline already renders a null actor as "System".
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER + timedelta(hours=1),
    )

    sweep(client, admin)

    db_session.expire_all()
    events = list(
        db_session.scalars(
            select(IncidentEvent)
            .where(IncidentEvent.incident_id == incident.id)
            .order_by(IncidentEvent.created_at)
        )
    )
    closing = [event for event in events if event.to_value == IncidentStatus.CLOSED.value]
    assert len(closing) == 1
    assert closing[0].actor_id is None
    assert closing[0].event_type == EventType.STATUS_CHANGED
    assert closing[0].from_value == IncidentStatus.RESOLVED.value


def test_it_tells_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A week later the reporter is told the system tidied up — and should not be.

    Nothing they can act on has changed: their rating window is open for
    another week either way. The assertion is that the *reporter's* inbox is
    untouched by the sweep, and it is made against a count taken before it so
    that an inbox which was empty for some other reason cannot pass it.
    """
    from app.models.notification import Notification

    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER + timedelta(hours=1),
    )
    before = len(
        list(db_session.scalars(select(Notification).where(Notification.user_id == reporter.id)))
    )

    sweep(client, admin)

    db_session.expire_all()
    after = list(
        db_session.scalars(select(Notification).where(Notification.user_id == reporter.id))
    )
    assert len(after) == before
    # And the sweep did happen, or the assertion above is about nothing.
    assert reread(db_session, incident).status == IncidentStatus.CLOSED


def test_a_closed_ticket_is_not_swept_twice(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Two sweeps, one closure, one audit row.

    The status filter is what makes the second pass find nothing; this pins it
    from the outside, because a duplicate event in an append-only log is the
    kind of damage that is only visible long after it is done.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER + timedelta(hours=1),
    )

    sweep(client, admin)
    sweep(client, admin)

    db_session.expire_all()
    closing = list(
        db_session.scalars(
            select(IncidentEvent).where(
                IncidentEvent.incident_id == incident.id,
                IncidentEvent.to_value == IncidentStatus.CLOSED.value,
            )
        )
    )
    assert len(closing) == 1


# --- The ops action -----------------------------------------------------------


def test_the_ops_action_reports_what_it_closed(
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The sweep is silent on the request path, so the invoke is how you see it.

    Called as a service rather than through `run_ops`, which opens a session
    of its own that this test's transaction cannot see.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        engineer=engineer,
        resolved_ago=AUTOCLOSE_AFTER + timedelta(hours=1),
    )

    closed = autoclose.close_stale(db_session)

    assert [entry.reference for entry in closed] == [incident.reference]


def test_the_sweep_is_capped(
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A first sweep over a neglected estate must not be the request that times out.

    Three overdue tickets, a limit of two: two close and the third waits for
    the next sweep. `list_autoclose_candidates` orders oldest first, so a
    capped sweep always makes progress rather than revisiting the same page.
    """
    for index in range(3):
        ticket(
            db_session,
            reporter=reporter,
            category=category,
            building=building,
            floor=floor,
            engineer=engineer,
            resolved_ago=AUTOCLOSE_AFTER + timedelta(days=index + 1),
            title=f"Ticket {index}",
        )

    first = autoclose.close_stale(db_session, limit=2)
    assert len(first) == 2

    second = autoclose.close_stale(db_session, limit=2)
    assert len(second) == 1
