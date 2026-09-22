"""Notes, their visibility, the edit window, and the activity timeline.

The rule that matters most here is that an employee never receives an INTERNAL
note. It is asserted from both ends — the note list and the activity feed —
because the filtering happens in the query, and a route that built its own
query would bypass it.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models.building import Building
from app.models.category import Category
from app.models.enums import EngineerLevel, IncidentStatus, NoteVisibility
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.schemas.note import NoteUpdate
from app.services import notes as note_service
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_incident,
    make_note,
    make_user,
)

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=UTC)


@pytest.fixture
def place(db_session: Session) -> tuple[Category, Building]:
    """Return a subcategory and a building to hang tickets on."""
    group = make_category(db_session, name="Hardware")
    return make_category(db_session, name="Monitor", parent=group), make_building(db_session)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Ada Reporter")


@pytest.fixture
def assignee(db_session: Session) -> User:
    return make_engineer(db_session, level=EngineerLevel.JUNIOR, full_name="Sam Engineer")


@pytest.fixture
def ticket(
    db_session: Session,
    reporter: User,
    assignee: User,
    place: tuple[Category, Building],
) -> Incident:
    """Return an in-progress ticket with a reporter and an assignee."""
    category, building = place
    return make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        assignee=assignee,
        status=IncidentStatus.IN_PROGRESS,
    )


def post_note(
    client: TestClient,
    ticket: Incident,
    author: User,
    body: str = "Taking a look at this now.",
    visibility: str = "PUBLIC",
) -> object:
    """Add a note as `author`."""
    return client.post(
        f"/api/v1/incidents/{ticket.id}/notes",
        json={"body": body, "visibility": visibility},
        headers=auth_header(login(client, author.email)),
    )


# --- Who may write -----------------------------------------------------------


def test_the_reporter_can_write_a_public_note(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    response = post_note(client, ticket, reporter, "Has anyone had a chance to look?")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["visibility"] == "PUBLIC"
    assert body["author"]["full_name"] == "Ada Reporter"
    assert body["can_edit"] is True


def test_the_assignee_can_write_a_public_note(
    client: TestClient, ticket: Incident, assignee: User
) -> None:
    assert post_note(client, ticket, assignee).status_code == 201


def test_an_unrelated_employee_cannot_write_on_someone_elses_ticket(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    stranger = make_user(db_session, full_name="Unrelated Employee")

    response = post_note(client, ticket, stranger, "I have this problem too.")

    assert response.status_code == 403
    assert response.json()["code"] == "NOTE_NOT_PERMITTED"


def test_an_engineer_cannot_write_on_a_ticket_they_do_not_hold(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    other_engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = post_note(client, ticket, other_engineer)

    assert response.status_code == 403


def test_a_lead_can_write_on_any_ticket(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    lead = make_engineer(db_session, level=EngineerLevel.LEAD)

    assert post_note(client, ticket, lead).status_code == 201


def test_nobody_writes_on_a_closed_ticket(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    closed = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.CLOSED,
    )
    admin = make_admin(db_session)

    response = post_note(client, closed, admin, "One last thought.")

    assert response.status_code == 403
    assert "closed" in response.json()["detail"].lower()


# --- Internal notes ----------------------------------------------------------


def test_an_employee_cannot_write_an_internal_note(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    response = post_note(
        client, ticket, reporter, "Something private.", visibility="INTERNAL"
    )

    assert response.status_code == 403
    assert response.json()["code"] == "INTERNAL_NOTE_NOT_PERMITTED"


def test_an_engineer_can_write_an_internal_note(
    client: TestClient, ticket: Incident, assignee: User
) -> None:
    response = post_note(
        client,
        ticket,
        assignee,
        "The part is out of warranty, checking the budget first.",
        visibility="INTERNAL",
    )

    assert response.status_code == 201, response.text
    assert response.json()["visibility"] == "INTERNAL"


def test_an_employee_never_receives_an_internal_note(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    assignee: User,
) -> None:
    """Filtered in the query, so it is absent rather than hidden."""
    make_note(db_session, incident=ticket, author=reporter, body="Any news?")
    make_note(
        db_session,
        incident=ticket,
        author=assignee,
        body="Out of warranty, checking the budget.",
        visibility=NoteVisibility.INTERNAL,
    )

    headers = auth_header(login(client, reporter.email))
    notes = client.get(f"/api/v1/incidents/{ticket.id}/notes", headers=headers).json()

    assert [note["body"] for note in notes] == ["Any news?"]
    assert all(note["visibility"] == "PUBLIC" for note in notes)


def test_an_employee_never_sees_an_internal_note_on_the_timeline(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    assignee: User,
) -> None:
    """The second reading path, asserted separately — one filter, two callers."""
    make_note(
        db_session,
        incident=ticket,
        author=assignee,
        body="Out of warranty, checking the budget.",
        visibility=NoteVisibility.INTERNAL,
    )

    headers = auth_header(login(client, reporter.email))
    activity = client.get(f"/api/v1/incidents/{ticket.id}/activity", headers=headers).json()

    assert [entry for entry in activity if entry["kind"] == "note"] == []


def test_staff_see_both_kinds_of_note(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    assignee: User,
) -> None:
    make_note(db_session, incident=ticket, author=reporter, body="Any news?")
    make_note(
        db_session,
        incident=ticket,
        author=assignee,
        body="Out of warranty.",
        visibility=NoteVisibility.INTERNAL,
    )

    headers = auth_header(login(client, assignee.email))
    notes = client.get(f"/api/v1/incidents/{ticket.id}/notes", headers=headers).json()

    assert {note["visibility"] for note in notes} == {"PUBLIC", "INTERNAL"}


def test_an_employee_cannot_address_an_internal_note_directly(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    assignee: User,
) -> None:
    """404 rather than 403: a 403 would confirm the note exists."""
    internal = make_note(
        db_session,
        incident=ticket,
        author=assignee,
        body="Out of warranty.",
        visibility=NoteVisibility.INTERNAL,
    )

    response = client.patch(
        f"/api/v1/notes/{internal.id}",
        json={"body": "Let me see that."},
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOTE_NOT_FOUND"


# --- The edit window ---------------------------------------------------------


def test_an_author_can_edit_their_own_note_straight_away(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    created = post_note(client, ticket, reporter, "Has anyoen looked at this?").json()

    response = client.patch(
        f"/api/v1/notes/{created['id']}",
        json={"body": "Has anyone looked at this?"},
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["body"] == "Has anyone looked at this?"
    assert body["edited_at"] is not None


def test_the_edit_window_closes_after_fifteen_minutes(
    db_session: Session, ticket: Incident, reporter: User
) -> None:
    """`now` is injected, so the boundary is asserted rather than approximated."""
    note = make_note(
        db_session,
        incident=ticket,
        author=reporter,
        created_at=NOW - note_service.EDIT_WINDOW - timedelta(seconds=1),
    )

    with pytest.raises(ApiError) as refused:
        note_service.update_note(
            db_session,
            note=note,
            user=reporter,
            payload=NoteUpdate(body="Too late."),
            now=NOW,
        )

    assert refused.value.status_code == 403
    assert refused.value.code == "EDIT_WINDOW_CLOSED"


def test_the_edit_window_is_still_open_at_exactly_fifteen_minutes(
    db_session: Session, ticket: Incident, reporter: User
) -> None:
    note = make_note(
        db_session,
        incident=ticket,
        author=reporter,
        created_at=NOW - note_service.EDIT_WINDOW,
    )

    updated = note_service.update_note(
        db_session,
        note=note,
        user=reporter,
        payload=NoteUpdate(body="Just in time."),
        now=NOW,
    )

    assert updated.body == "Just in time."


def test_nobody_edits_someone_elses_note(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    lead = make_engineer(db_session, level=EngineerLevel.LEAD)
    note = make_note(db_session, incident=ticket, author=reporter)

    response = client.patch(
        f"/api/v1/notes/{note.id}",
        json={"body": "Rewriting what you said."},
        headers=auth_header(login(client, lead.email)),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "NOT_NOTE_AUTHOR"


def test_an_admin_can_edit_any_note_at_any_time(
    db_session: Session, ticket: Incident, reporter: User
) -> None:
    """Someone has to be able to remove a phone number from a ticket thirty people read."""
    admin = make_admin(db_session)
    note = make_note(
        db_session,
        incident=ticket,
        author=reporter,
        body="Call me on 555-0100",
        created_at=NOW - timedelta(days=3),
    )

    updated = note_service.update_note(
        db_session,
        note=note,
        user=admin,
        payload=NoteUpdate(body="[contact details removed]"),
        now=NOW,
    )

    assert updated.body == "[contact details removed]"


# --- Deletion ----------------------------------------------------------------


def test_deleting_a_note_removes_it_from_every_reading(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    created = post_note(client, ticket, reporter, "Posted this by mistake.").json()
    headers = auth_header(login(client, reporter.email))

    deleted = client.delete(f"/api/v1/notes/{created['id']}", headers=headers)

    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/api/v1/incidents/{ticket.id}/notes", headers=headers).json() == []
    activity = client.get(f"/api/v1/incidents/{ticket.id}/activity", headers=headers).json()
    assert [entry for entry in activity if entry["kind"] == "note"] == []


def test_a_deleted_note_is_kept_as_a_row(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    """Soft, because the timeline is an audit trail and audit trails keep their shape."""
    created = post_note(client, ticket, reporter, "Posted this by mistake.").json()
    client.delete(
        f"/api/v1/notes/{created['id']}",
        headers=auth_header(login(client, reporter.email)),
    )

    stored = db_session.get(IncidentNote, uuid.UUID(created["id"]))
    assert stored is not None
    assert stored.deleted_at is not None


def test_deleting_a_note_twice_is_a_404(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    created = post_note(client, ticket, reporter).json()
    headers = auth_header(login(client, reporter.email))

    client.delete(f"/api/v1/notes/{created['id']}", headers=headers)
    second = client.delete(f"/api/v1/notes/{created['id']}", headers=headers)

    assert second.status_code == 404


# --- The activity timeline ---------------------------------------------------


def test_the_timeline_merges_events_and_notes_in_order(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    assignee: User,
) -> None:
    headers = auth_header(login(client, assignee.email))

    post_note(client, ticket, reporter, "Has anyone had a chance to look?")
    client.post(
        f"/api/v1/incidents/{ticket.id}/transitions",
        json={
            "to_status": "RESOLVED",
            "resolution_summary": "Swapped the cable; the monitor is fine.",
        },
        headers=headers,
    )
    post_note(client, ticket, assignee, "Left the old cable at the service desk.")

    activity = client.get(f"/api/v1/incidents/{ticket.id}/activity", headers=headers).json()

    assert [entry["kind"] for entry in activity] == ["note", "event", "note"]
    assert activity[1]["to_value"] == "RESOLVED"
    assert activity[2]["body"] == "Left the old cable at the service desk."


def test_timeline_entries_name_who_did_it(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    post_note(client, ticket, reporter, "Has anyone had a chance to look?")

    activity = client.get(
        f"/api/v1/incidents/{ticket.id}/activity",
        headers=auth_header(login(client, reporter.email)),
    ).json()

    assert activity[0]["actor"]["full_name"] == "Ada Reporter"


def test_a_blank_note_is_refused(
    client: TestClient, ticket: Incident, reporter: User
) -> None:
    response = post_note(client, ticket, reporter, "   ")

    assert response.status_code == 422


def test_notes_on_a_missing_ticket_are_a_404(
    client: TestClient, reporter: User
) -> None:
    response = client.get(
        f"/api/v1/incidents/{uuid.uuid4()}/notes",
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 404
