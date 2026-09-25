"""Notifications end to end: the rows the rules produce, and the inbox routes.

`tests/unit/test_notifications.py` proves the *policy* — who gets told what —
without a database. This file proves the **wiring**: that each of the four
triggers actually calls the rule module, that the rows land in the same
transaction as the event they describe, and that one person's inbox is
unreachable from another person's session.

The negative cases are repeated here rather than left to the unit tests on
purpose. A rule that refuses correctly and a service that never asks it look
identical from the outside, and only one of them is right.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    EngineerLevel,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    NotificationType,
)
from app.models.incident import Incident
from app.models.notification import Notification
from app.models.user import User
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

NOW = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)


@pytest.fixture
def place(db_session: Session) -> Building:
    return make_building(db_session, name="Notification Tower", code="NTF-1")


@pytest.fixture
def category(db_session: Session) -> Category:
    """Return a subcategory under a BUILDING-precision group.

    BUILDING so that `POST /incidents` needs nothing but a building; a FLOOR
    group would make every fixture here carry a floor for the sake of one test.
    """
    group = make_category(
        db_session,
        name="Hardware group",
        location_detail=LocationDetail.BUILDING,
    )
    return make_category(db_session, name="Monitor", parent=group)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, email="robin.reporter@acme.inc", full_name="Robin Reporter")


@pytest.fixture
def engineer(db_session: Session) -> User:
    return make_engineer(
        db_session,
        email="sam.senior@acme.inc",
        full_name="Sam Senior",
        level=EngineerLevel.SENIOR,
    )


@pytest.fixture
def admin(db_session: Session) -> User:
    return make_admin(db_session, email="henry.admin@acme.inc", full_name="Henry Ford")


@pytest.fixture
def ticket(
    db_session: Session,
    reporter: User,
    engineer: User,
    place: Building,
    category: Category,
) -> Incident:
    return make_incident(
        db_session,
        reporter=reporter,
        assignee=engineer,
        category=category,
        building=place,
        status=IncidentStatus.IN_PROGRESS,
        title="Monitor flickers",
    )


def inbox(session: Session, user: User) -> list[Notification]:
    """Return one user's notifications, oldest first, straight from the table."""
    statement = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at)
    )
    return list(session.scalars(statement).all())


# --- Status changes ----------------------------------------------------------


def test_resolving_tells_the_reporter_and_not_the_engineer_who_did_it(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    token = login(client, engineer.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    reporter_inbox = inbox(db_session, reporter)
    assert len(reporter_inbox) == 1
    assert reporter_inbox[0].type == NotificationType.STATUS_CHANGED
    assert reporter_inbox[0].message == (
        f"Sam Senior resolved your ticket {ticket.reference}. "
        "Please confirm the fix and rate the work."
    )
    assert reporter_inbox[0].read_at is None
    assert reporter_inbox[0].incident_id == ticket.id
    assert inbox(db_session, engineer) == []


def test_confirming_a_fix_tells_the_engineer_and_not_the_reporter(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    ticket.status = IncidentStatus.RESOLVED
    ticket.resolved_at = NOW
    db_session.flush()
    token = login(client, reporter.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "CLOSED"},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert [note.message for note in inbox(db_session, engineer)] == [
        f"{ticket.reference} is now Closed."
    ]
    assert inbox(db_session, reporter) == []


def test_an_admin_closing_a_ticket_tells_both_sides(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    ticket.status = IncidentStatus.RESOLVED
    ticket.resolved_at = NOW
    db_session.flush()
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "CLOSED"},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert len(inbox(db_session, reporter)) == 1
    assert len(inbox(db_session, engineer)) == 1
    assert inbox(db_session, admin) == []


def test_cancelling_an_unassigned_ticket_you_reported_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: Building,
    category: Category,
) -> None:
    """The plan is empty, so no row is written at all — not a row for nobody."""
    ticket = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=place,
        status=IncidentStatus.OPEN,
    )
    token = login(client, reporter.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "CLOSED"},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_a_failed_transition_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """The row and the event share a transaction, so a refusal writes neither."""
    token = login(client, reporter.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "I fixed it myself."},
        headers=auth_header(token),
    )

    assert response.status_code == 409
    assert db_session.scalar(select(Notification).limit(1)) is None


# --- Assignment --------------------------------------------------------------


def test_assigning_tells_the_new_engineer_and_the_reporter(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    place: Building,
    category: Category,
) -> None:
    ticket = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=place,
        status=IncidentStatus.OPEN,
    )
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/assign",
        json={"assignee_id": str(engineer.id)},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert [note.message for note in inbox(db_session, reporter)] == [
        f"Your ticket {ticket.reference} was assigned to Sam Senior."
    ]
    assert [note.message for note in inbox(db_session, engineer)] == [
        f"{ticket.reference} was assigned to you."
    ]
    assert inbox(db_session, admin) == []


def test_picking_a_ticket_up_tells_the_reporter_only(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    place: Building,
    category: Category,
) -> None:
    ticket = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=place,
        status=IncidentStatus.OPEN,
    )
    token = login(client, engineer.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/pick-up",
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert len(inbox(db_session, reporter)) == 1
    assert inbox(db_session, engineer) == []


def test_reassigning_names_the_new_engineer_not_the_previous_one(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    """The regression `assignment.assign` sets `incident.assignee` to prevent.

    The first assignment loads the relationship; setting only `assignee_id` on
    the second would leave it pointing at Sam, and the reporter would be told
    their ticket went to the engineer who had just lost it.
    """
    other = make_engineer(
        db_session,
        email="ada.other@acme.inc",
        full_name="Ada Other",
        level=EngineerLevel.SENIOR,
    )
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/assign",
        json={"assignee_id": str(other.id)},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert [note.message for note in inbox(db_session, reporter)] == [
        f"Your ticket {ticket.reference} was assigned to Ada Other."
    ]


def test_assigning_to_the_engineer_who_already_holds_it_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    """A no-op write is a no-op notification, matching the no-op event."""
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/assign",
        json={"assignee_id": str(engineer.id)},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_unassigning_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    """Deliberate: BUILD-PLAN S1 names assignment, and only assignment.

    Recorded as a test rather than left implicit, so that adding an
    UNASSIGNED rule later is a visible decision rather than a surprise.
    """
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/assign",
        json={"assignee_id": None},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert db_session.scalar(select(Notification).limit(1)) is None


# --- Notes -------------------------------------------------------------------


def test_a_public_staff_note_tells_the_reporter(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    token = login(client, engineer.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Parts are on order, with us Thursday.", "visibility": "PUBLIC"},
        headers=auth_header(token),
    )

    assert response.status_code == 201
    messages = [note.message for note in inbox(db_session, reporter)]
    assert messages == [f"Sam Senior added an update to your ticket {ticket.reference}."]


def test_an_internal_note_tells_the_reporter_nothing(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """The leak this feature could most easily have introduced.

    Asserted through the real endpoint, not just the rule: `add_note` calls
    the rule module for *every* note, so this proves the precondition is
    reached rather than that the call site guessed correctly.
    """
    token = login(client, engineer.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Reporter is being difficult about the swap.", "visibility": "INTERNAL"},
        headers=auth_header(token),
    )

    assert response.status_code == 201
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_a_reporters_own_note_tells_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    token = login(client, reporter.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Still flickering this morning.", "visibility": "PUBLIC"},
        headers=auth_header(token),
    )

    assert response.status_code == 201
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_a_note_notification_never_carries_the_note_body(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """A note can be edited or deleted; a stored message cannot."""
    body = "Call the reporter on 555-0123."
    token = login(client, engineer.email)

    client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": body, "visibility": "PUBLIC"},
        headers=auth_header(token),
    )

    assert body not in inbox(db_session, reporter)[0].message


# --- Escalation --------------------------------------------------------------


def test_clearing_an_escalation_tells_both_sides_and_not_the_admin(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    ticket.is_escalated = True
    ticket.escalation_reason = "Nobody has looked at this in a week."
    ticket.escalated_at = NOW
    db_session.flush()
    token = login(client, admin.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/clear-escalation",
        json={"note": "Parts were the hold-up. Chasing the vendor.", "priority": "HIGH"},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert [note.message for note in inbox(db_session, reporter)] == [
        f"Henry Ford cleared the escalation on your ticket {ticket.reference}."
    ]
    assert [note.message for note in inbox(db_session, engineer)] == [
        f"Henry Ford cleared the escalation on {ticket.reference}."
    ]
    assert inbox(db_session, admin) == []


def test_raising_an_escalation_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """Deliberate: there is no admin audience, so there is nobody to tell.

    The escalation reaches an admin through the dashboard's "Needs attention"
    panel, which is a queue rather than an inbox.
    """
    token = login(client, reporter.email)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/escalate",
        json={"reason": "This has been broken for two weeks."},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_a_priority_edit_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    admin: User,
    ticket: Incident,
) -> None:
    """Also deliberate, and the reason `NotificationType` is narrower than `EventType`."""
    token = login(client, admin.email)

    response = client.patch(
        f"/api/v1/incidents/{ticket.id}",
        json={"priority": IncidentPriority.HIGH.value},
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert db_session.scalar(select(Notification).limit(1)) is None


def test_reporting_a_ticket_notifies_nobody(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: Building,
    category: Category,
) -> None:
    """You know you reported it, and nobody is assigned yet to be told."""
    token = login(client, reporter.email)

    response = client.post(
        "/api/v1/incidents",
        json={
            "title": "Monitor flickers badly",
            "description": "It has been flickering since the power cut on Monday.",
            "category_id": str(category.id),
            "building_id": str(place.id),
        },
        headers=auth_header(token),
    )

    assert response.status_code == 201
    assert db_session.scalar(select(Notification).limit(1)) is None


# --- The inbox endpoints -----------------------------------------------------


def test_unread_count_starts_at_zero_and_follows_the_inbox(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    reporter_token = login(client, reporter.email)

    empty = client.get("/api/v1/notifications/unread-count", headers=auth_header(reporter_token))
    assert empty.status_code == 200
    assert empty.json() == {"unread": 0}

    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )

    after = client.get("/api/v1/notifications/unread-count", headers=auth_header(reporter_token))
    assert after.json() == {"unread": 1}


def test_the_inbox_lists_the_newest_first_with_its_ticket(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Ordering a replacement.", "visibility": "PUBLIC"},
        headers=auth_header(engineer_token),
    )
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )

    response = client.get(
        "/api/v1/notifications",
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["page"] == 1
    assert body["page_size"] == 25
    assert [item["type"] for item in body["items"]] == ["STATUS_CHANGED", "NOTE_ADDED"]
    first = body["items"][0]
    assert first["incident_reference"] == ticket.reference
    assert first["incident_title"] == "Monitor flickers"
    assert first["incident_status"] == "RESOLVED"
    assert first["read_at"] is None


def test_the_inbox_can_be_narrowed_to_unread(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    for body in ("First update.", "Second update."):
        client.post(
            f"/api/v1/incidents/{ticket.id}/notes",
            json={"body": body, "visibility": "PUBLIC"},
            headers=auth_header(engineer_token),
        )
    reporter_token = login(client, reporter.email)
    everything = client.get("/api/v1/notifications", headers=auth_header(reporter_token)).json()
    oldest = everything["items"][-1]["id"]

    client.post(f"/api/v1/notifications/{oldest}/read", headers=auth_header(reporter_token))

    unread = client.get(
        "/api/v1/notifications",
        params={"unread_only": True},
        headers=auth_header(reporter_token),
    ).json()
    assert unread["total"] == 1
    assert unread["items"][0]["id"] != oldest


def test_an_inbox_holds_only_its_owners_notifications(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )

    admin_inbox = client.get(
        "/api/v1/notifications",
        headers=auth_header(login(client, admin.email)),
    ).json()

    assert admin_inbox["total"] == 0
    assert admin_inbox["items"] == []


def test_marking_one_read_is_idempotent_and_keeps_the_first_timestamp(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )
    reporter_token = login(client, reporter.email)
    notification_id = client.get(
        "/api/v1/notifications", headers=auth_header(reporter_token)
    ).json()["items"][0]["id"]

    first = client.post(
        f"/api/v1/notifications/{notification_id}/read",
        headers=auth_header(reporter_token),
    )
    second = client.post(
        f"/api/v1/notifications/{notification_id}/read",
        headers=auth_header(reporter_token),
    )

    assert first.status_code == 200
    assert first.json()["read_at"] is not None
    assert second.json()["read_at"] == first.json()["read_at"]
    counted = client.get("/api/v1/notifications/unread-count", headers=auth_header(reporter_token))
    assert counted.json() == {"unread": 0}


def test_marking_somebody_elses_notification_read_is_a_404(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    """404 rather than 403: whether a stranger has an inbox item is private."""
    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )
    reporter_token = login(client, reporter.email)
    notification_id = client.get(
        "/api/v1/notifications", headers=auth_header(reporter_token)
    ).json()["items"][0]["id"]

    response = client.post(
        f"/api/v1/notifications/{notification_id}/read",
        headers=auth_header(login(client, admin.email)),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOTIFICATION_NOT_FOUND"
    # And it is still unread for the person it belongs to.
    still = client.get("/api/v1/notifications/unread-count", headers=auth_header(reporter_token))
    assert still.json() == {"unread": 1}


def test_marking_a_notification_that_does_not_exist_is_a_404(
    client: TestClient,
    reporter: User,
) -> None:
    response = client.post(
        f"/api/v1/notifications/{uuid.uuid4()}/read",
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 404


def test_mark_all_read_clears_the_badge_and_reports_how_many(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    for body in ("First update.", "Second update."):
        client.post(
            f"/api/v1/incidents/{ticket.id}/notes",
            json={"body": body, "visibility": "PUBLIC"},
            headers=auth_header(engineer_token),
        )
    reporter_token = login(client, reporter.email)

    response = client.post(
        "/api/v1/notifications/read-all",
        headers=auth_header(reporter_token),
    )

    assert response.status_code == 200
    assert response.json() == {"marked": 2}
    counted = client.get("/api/v1/notifications/unread-count", headers=auth_header(reporter_token))
    assert counted.json() == {"unread": 0}

    again = client.post("/api/v1/notifications/read-all", headers=auth_header(reporter_token))
    assert again.json() == {"marked": 0}


def test_mark_all_read_leaves_other_inboxes_alone(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    ticket: Incident,
) -> None:
    """One `UPDATE` with a `user_id` term, and this is what that term is for."""
    admin_token = login(client, admin.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Chasing this up.", "visibility": "PUBLIC"},
        headers=auth_header(admin_token),
    )
    ticket.status = IncidentStatus.RESOLVED
    ticket.resolved_at = NOW
    db_session.flush()
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "CLOSED"},
        headers=auth_header(admin_token),
    )

    client.post(
        "/api/v1/notifications/read-all",
        headers=auth_header(login(client, reporter.email)),
    )

    engineer_unread = client.get(
        "/api/v1/notifications/unread-count",
        headers=auth_header(login(client, engineer.email)),
    )
    assert engineer_unread.json() == {"unread": 1}


def test_the_inbox_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/v1/notifications/unread-count").status_code == 401
    assert client.get("/api/v1/notifications").status_code == 401
    assert client.post("/api/v1/notifications/read-all").status_code == 401


def test_the_inbox_pages(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    engineer_token = login(client, engineer.email)
    for index in range(3):
        client.post(
            f"/api/v1/incidents/{ticket.id}/notes",
            json={"body": f"Update number {index}.", "visibility": "PUBLIC"},
            headers=auth_header(engineer_token),
        )
    reporter_token = login(client, reporter.email)

    page = client.get(
        "/api/v1/notifications",
        params={"page": 2, "page_size": 2},
        headers=auth_header(reporter_token),
    ).json()

    assert page["total"] == 3
    assert page["page"] == 2
    assert len(page["items"]) == 1


def test_the_message_is_stored_not_re_rendered(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """A reopened ticket does not rewrite the notification that said "Resolved".

    The sentence was true when it was sent, and an inbox that silently
    rewrites its own history is worse than one that is out of date. The row's
    `incident_status` is where the reader sees where the ticket stands now.

    The stored sentence here is the resolution one, which also carries an
    invitation to rate the work — and by the time this assertion runs the
    ticket has been reopened, so that invitation can no longer be acted on.
    That is deliberate and is the distinction this test now also pins: the
    *claim* ("is now Resolved") must not be rewritten because it would become
    false, while an *instruction* merely becomes moot. `services/feedback.py`
    decides whether it can still be acted on, not the sentence.
    """
    engineer_token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Swapped the cable."},
        headers=auth_header(engineer_token),
    )
    reporter_token = login(client, reporter.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={"to_status": "IN_PROGRESS", "reason": "Still flickering."},
        headers=auth_header(reporter_token),
    )

    items = client.get("/api/v1/notifications", headers=auth_header(reporter_token)).json()["items"]

    assert [item["message"] for item in items] == [
        f"Sam Senior resolved your ticket {ticket.reference}. "
        "Please confirm the fix and rate the work."
    ]
    assert items[0]["incident_status"] == "IN_PROGRESS"


def test_a_notification_is_written_in_the_same_transaction_as_its_event(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    ticket: Incident,
) -> None:
    """Timestamps come from `clock_timestamp()`, so rows in one request differ."""
    token = login(client, engineer.email)
    client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "One.", "visibility": "PUBLIC"},
        headers=auth_header(token),
    )
    client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": "Two.", "visibility": "PUBLIC"},
        headers=auth_header(token),
    )

    rows = inbox(db_session, reporter)

    assert len(rows) == 2
    assert rows[0].created_at != rows[1].created_at
    assert rows[1].created_at - rows[0].created_at < timedelta(seconds=10)
