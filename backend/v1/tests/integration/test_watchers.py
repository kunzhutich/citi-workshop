"""Subscribing, unsubscribing, and being told about the fix.

Three rules are exercised here and nowhere else:

* **the flag is enforced on the API**, not merely hidden in the UI — a
  personal subcategory refuses the subscription with a code;
* **a watcher is told once, when the ticket resolves**, and is not told about
  any of the moves on the way there;
* **whoever did it is never told they did it**, which for watchers means an
  engineer who follows a ticket and then fixes it hears nothing.

The notification assertions read the `notifications` table rather than the
inbox endpoint. The rule under test is who a *row* is written for; going
through the reader as well would make a failure ambiguous between the two.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    EngineerLevel,
    IncidentStatus,
    LocationDetail,
    NotificationType,
)
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.notification import Notification
from app.models.user import User
from app.models.watcher import IncidentWatcher
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_floor,
    make_incident,
    make_user,
    make_watcher,
)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Ada Reporter")


@pytest.fixture
def colleague(db_session: Session) -> User:
    return make_user(db_session, full_name="Bo Nearby")


@pytest.fixture
def engineer(db_session: Session) -> User:
    return make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Sam Senior")


@pytest.fixture
def colleague_headers(client: TestClient, colleague: User) -> dict[str, str]:
    return auth_header(login(client, colleague.email))


@pytest.fixture
def building(db_session: Session) -> Building:
    return make_building(db_session, name="San Francisco HQ", code="SFO-1")


@pytest.fixture
def floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 3", level_number=3)


@pytest.fixture
def shared_group(db_session: Session) -> Category:
    """Return a group with a generated name.

    Not named after a real one: `tests/integration/test_ops_actions.py` runs
    the `migrate` action, which commits the seeded tree in its own session, so
    a group called "Building & Facilities" would collide in a full run while
    passing when this file is run alone.
    """
    return make_category(db_session, location_detail=LocationDetail.FLOOR)


@pytest.fixture
def shared(db_session: Session, shared_group: Category) -> Category:
    """Return a subcategory other people may follow."""
    return make_category(db_session, name="Lighting", parent=shared_group, allows_watchers=True)


@pytest.fixture
def personal(db_session: Session, shared_group: Category) -> Category:
    """Return a subcategory in the *same group* that nobody else may follow.

    Same group on purpose: the flag is per subcategory, so a test that put the
    personal one in a group of its own could not tell this rule apart from one
    that read the group.
    """
    return make_category(db_session, name="Laptop/Desktop", parent=shared_group)


def ticket(
    db_session: Session,
    *,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor,
    assignee: User | None = None,
    status: IncidentStatus = IncidentStatus.OPEN,
) -> Incident:
    """Insert a ticket in the given state."""
    return make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=assignee,
        status=status,
        title="Lights out in the north corridor",
    )


def watcher_rows(db_session: Session, incident: Incident) -> list[uuid.UUID]:
    """Return the user ids following an incident."""
    statement = select(IncidentWatcher.user_id).where(IncidentWatcher.incident_id == incident.id)
    return list(db_session.scalars(statement).all())


def notifications_for(
    db_session: Session,
    *,
    user: User,
    notification_type: NotificationType | None = None,
) -> list[Notification]:
    """Return one user's notification rows, optionally of one kind."""
    statement = select(Notification).where(Notification.user_id == user.id)
    if notification_type is not None:
        statement = statement.where(Notification.type == notification_type)
    return list(db_session.scalars(statement).all())


# --- Subscribing -------------------------------------------------------------


def test_a_colleague_can_say_a_shared_problem_affects_them_too(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    colleague: User,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )

    response = client.post(
        f"/api/v1/incidents/{incident.id}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"watching": True, "watcher_count": 1}
    assert watcher_rows(db_session, incident) == [colleague.id]


def test_subscribing_twice_is_one_row(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A double-clicked button is not two people affected."""
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )

    client.post(f"/api/v1/incidents/{incident.id}/watchers", headers=colleague_headers)
    second = client.post(f"/api/v1/incidents/{incident.id}/watchers", headers=colleague_headers)

    assert second.status_code == 200
    assert second.json() == {"watching": True, "watcher_count": 1}
    assert len(watcher_rows(db_session, incident)) == 1


def test_subscribing_to_a_personal_problem_is_refused(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    reporter: User,
    personal: Category,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The rule the whole flag exists for, enforced on the API.

    A ticket in the *shared* subcategory is subscribed to first, in the same
    test, so the refusal below cannot be a watch endpoint that refuses
    everything — which is how a broken `allows_watchers` lookup would look
    from the outside.
    """
    allowed = ticket(db_session, reporter=reporter, category=shared, building=building, floor=floor)
    assert (
        client.post(
            f"/api/v1/incidents/{allowed.id}/watchers", headers=colleague_headers
        ).status_code
        == 200
    )

    refused = ticket(
        db_session, reporter=reporter, category=personal, building=building, floor=floor
    )
    response = client.post(
        f"/api/v1/incidents/{refused.id}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "WATCHERS_NOT_ALLOWED"
    assert watcher_rows(db_session, refused) == []


def test_subscribing_needs_a_signed_in_caller(
    client: TestClient,
    db_session: Session,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )

    assert client.post(f"/api/v1/incidents/{incident.id}/watchers").status_code == 401


def test_subscribing_to_a_ticket_that_does_not_exist_is_a_404(
    client: TestClient,
    colleague_headers: dict[str, str],
) -> None:
    response = client.post(
        f"/api/v1/incidents/{uuid.uuid4()}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 404
    assert response.json()["code"] == "INCIDENT_NOT_FOUND"


# --- Unsubscribing -----------------------------------------------------------


def test_unsubscribing_removes_the_row(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    colleague: User,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )
    make_watcher(db_session, incident=incident, user=colleague)

    response = client.delete(
        f"/api/v1/incidents/{incident.id}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"watching": False, "watcher_count": 0}
    assert watcher_rows(db_session, incident) == []


def test_unsubscribing_when_you_were_not_following_is_not_an_error(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )

    response = client.delete(
        f"/api/v1/incidents/{incident.id}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"watching": False, "watcher_count": 0}


def test_unsubscribing_still_works_after_the_subcategory_turns_personal(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    colleague: User,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The flag governs joining. Leaving is always allowed.

    Otherwise an admin's change would strand everybody who had already
    subscribed, with no way out but a database edit.
    """
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )
    make_watcher(db_session, incident=incident, user=colleague)
    shared.allows_watchers = False
    db_session.flush()

    response = client.delete(
        f"/api/v1/incidents/{incident.id}/watchers",
        headers=colleague_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"watching": False, "watcher_count": 0}
    # And joining is now refused, which is what makes the above a statement
    # about the two directions differing rather than about the flag being
    # ignored entirely.
    assert (
        client.post(
            f"/api/v1/incidents/{incident.id}/watchers", headers=colleague_headers
        ).status_code
        == 409
    )


# --- What the ticket says ----------------------------------------------------


def test_the_detail_response_says_whether_you_are_following_and_how_many_are(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    colleague: User,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """`is_watching` is per caller; `watcher_count` is not.

    Read by two different people on the same ticket, because a `is_watching`
    computed from "are there any watchers?" would agree with this test for one
    of them.
    """
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )
    make_watcher(db_session, incident=incident, user=colleague)

    theirs = client.get(f"/api/v1/incidents/{incident.id}", headers=colleague_headers).json()
    reporter_headers = auth_header(login(client, reporter.email))
    mine = client.get(f"/api/v1/incidents/{incident.id}", headers=reporter_headers).json()

    assert theirs["is_watching"] is True
    assert theirs["watcher_count"] == 1
    assert mine["is_watching"] is False
    assert mine["watcher_count"] == 1


def test_the_detail_response_says_whether_this_kind_of_problem_can_be_followed(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    reporter: User,
    shared: Category,
    personal: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Without this the screen would have to fetch the whole category tree."""
    followable = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )
    private = ticket(
        db_session, reporter=reporter, category=personal, building=building, floor=floor
    )

    first = client.get(f"/api/v1/incidents/{followable.id}", headers=colleague_headers).json()
    second = client.get(f"/api/v1/incidents/{private.id}", headers=colleague_headers).json()

    assert first["category"]["allows_watchers"] is True
    assert second["category"]["allows_watchers"] is False


def test_the_count_after_subscribing_matches_the_detail_response(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    colleague: User,
    reporter: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Two code paths, one answer — the reason `status_of` is one function."""
    incident = ticket(
        db_session, reporter=reporter, category=shared, building=building, floor=floor
    )
    make_watcher(db_session, incident=incident, user=make_user(db_session))

    subscribed = client.post(
        f"/api/v1/incidents/{incident.id}/watchers", headers=colleague_headers
    ).json()
    detail = client.get(f"/api/v1/incidents/{incident.id}", headers=colleague_headers).json()

    assert subscribed == {"watching": True, "watcher_count": 2}
    assert detail["is_watching"] is True
    assert detail["watcher_count"] == 2


# --- Being told --------------------------------------------------------------


def resolve(client: TestClient, incident: Incident, headers: dict[str, str]) -> None:
    """Move a ticket to RESOLVED through the API, as an engineer would."""
    response = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={
            "to_status": IncidentStatus.RESOLVED.value,
            "resolution_summary": "Replaced the ballast and both tubes.",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text


def test_resolving_tells_a_watcher_exactly_once(
    client: TestClient,
    db_session: Session,
    colleague: User,
    reporter: User,
    engineer: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    incident = ticket(
        db_session,
        reporter=reporter,
        category=shared,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )
    make_watcher(db_session, incident=incident, user=colleague)

    resolve(client, incident, auth_header(login(client, engineer.email)))

    told = notifications_for(db_session, user=colleague)
    assert len(told) == 1
    assert told[0].type == NotificationType.WATCHED_RESOLVED
    assert told[0].incident_id == incident.id
    assert "has been resolved" in told[0].message


def test_a_watcher_is_told_nothing_while_the_work_is_going_on(
    client: TestClient,
    db_session: Session,
    colleague: User,
    reporter: User,
    engineer: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Blocking and resuming are not what anybody subscribed to.

    The ticket is then resolved in the same test, so the empty inbox above is
    provably an empty inbox *so far* rather than a watcher who is never told
    anything at all.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=shared,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )
    make_watcher(db_session, incident=incident, user=colleague)
    headers = auth_header(login(client, engineer.email))

    blocked = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={
            "to_status": IncidentStatus.BLOCKED.value,
            "blocked_reason_type": "WAITING_ON_PARTS",
            "blocked_reason": "Ballast on order, Thursday.",
        },
        headers=headers,
    )
    assert blocked.status_code == 200, blocked.text
    assert notifications_for(db_session, user=colleague) == []

    client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={"to_status": IncidentStatus.IN_PROGRESS.value},
        headers=headers,
    )
    resolve(client, incident, headers)

    assert len(notifications_for(db_session, user=colleague)) == 1


def test_a_watcher_who_resolved_it_themselves_is_not_told(
    client: TestClient,
    db_session: Session,
    colleague: User,
    reporter: User,
    engineer: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Rule 1, end to end. The bystander proves the rule fired at all."""
    incident = ticket(
        db_session,
        reporter=reporter,
        category=shared,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )
    make_watcher(db_session, incident=incident, user=engineer)
    make_watcher(db_session, incident=incident, user=colleague)

    resolve(client, incident, auth_header(login(client, engineer.email)))

    assert notifications_for(db_session, user=engineer) == []
    assert len(notifications_for(db_session, user=colleague)) == 1


def test_a_reporter_who_also_follows_their_own_ticket_is_told_once(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Two rules fire on one resolution; this person must hear one of them."""
    incident = ticket(
        db_session,
        reporter=reporter,
        category=shared,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )
    make_watcher(db_session, incident=incident, user=reporter)

    resolve(client, incident, auth_header(login(client, engineer.email)))

    told = notifications_for(db_session, user=reporter)
    assert len(told) == 1
    assert told[0].type == NotificationType.STATUS_CHANGED
    # The reporter's wording, not the watcher's. A resolution addresses the
    # reporter by name and asks them for something; "which you said affected
    # you too" is the sentence they must *not* have been sent.
    assert told[0].message.endswith("Please confirm the fix and rate the work.")
    assert "affected you too" not in told[0].message


def test_a_ticket_nobody_follows_writes_no_watcher_notification(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    shared: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The ordinary case. Reads the whole table, not one user's rows."""
    incident = ticket(
        db_session,
        reporter=reporter,
        category=shared,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )

    resolve(client, incident, auth_header(login(client, engineer.email)))

    watcher_notifications = db_session.scalars(
        select(Notification).where(Notification.type == NotificationType.WATCHED_RESOLVED)
    ).all()
    assert list(watcher_notifications) == []
    # The reporter was still told the ordinary thing, so this is not a test
    # passing because nothing notified anybody.
    assert len(notifications_for(db_session, user=reporter)) == 1


# --- The admin flag ----------------------------------------------------------


def test_an_admin_can_turn_a_subcategory_shared(
    client: TestClient,
    db_session: Session,
    personal: Category,
) -> None:
    admin_headers = auth_header(login(client, make_admin(db_session).email))

    response = client.patch(
        f"/api/v1/categories/{personal.id}",
        json={"allows_watchers": True},
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["allows_watchers"] is True
    db_session.refresh(personal)
    assert personal.allows_watchers is True


def test_the_flag_cannot_be_set_on_a_group(
    client: TestClient,
    db_session: Session,
    shared_group: Category,
) -> None:
    """A group has no tickets, so a value there would be a silent no-op."""
    admin_headers = auth_header(login(client, make_admin(db_session).email))

    response = client.patch(
        f"/api/v1/categories/{shared_group.id}",
        json={"allows_watchers": True},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "SUBCATEGORY_ONLY_FIELD"
    assert response.json()["field"] == "allows_watchers"


def test_the_category_tree_carries_the_flag(
    client: TestClient,
    db_session: Session,
    colleague_headers: dict[str, str],
    shared: Category,
    personal: Category,
) -> None:
    """The questionnaire reads it from here to decide whether to offer the button."""
    response = client.get("/api/v1/categories", headers=colleague_headers)

    assert response.status_code == 200
    # Keyed on id, not on name. The seeded tree has a "Lighting" of its own,
    # and a lookup by name would silently read whichever of the two came last.
    by_id = {
        child["id"]: child for group in response.json()["groups"] for child in group["children"]
    }
    assert by_id[str(shared.id)]["allows_watchers"] is True
    assert by_id[str(personal.id)]["allows_watchers"] is False
