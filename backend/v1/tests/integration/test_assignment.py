"""Who may give a ticket to whom, and escalation.

The assignment matrix is the one place where an engineer's *level* changes what
they can do, so it is parametrised over all three levels plus an employee and
an admin. Capacity and availability are checked separately, because they are
deliberately not refusals: they come back as `warnings` on a successful call.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    AvailabilityStatus,
    EngineerLevel,
    EventType,
    IncidentPriority,
    IncidentStatus,
)
from app.models.incident import Incident
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


@pytest.fixture
def place(db_session: Session) -> tuple[Category, Building]:
    """Return a subcategory and a building to hang tickets on."""
    group = make_category(db_session)
    return make_category(db_session, name="Monitor", parent=group), make_building(db_session)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Ada Reporter")


@pytest.fixture
def ticket(db_session: Session, reporter: User, place: tuple[Category, Building]) -> Incident:
    """Return an unassigned, open ticket — the state a freshly reported one is in."""
    category, building = place
    return make_incident(db_session, reporter=reporter, category=category, building=building)


def assign(client: TestClient, incident: Incident, actor: User, assignee: User | None) -> object:
    """Call the assign endpoint as `actor`."""
    return client.post(
        f"/api/v1/incidents/{incident.id}/assign",
        json={"assignee_id": str(assignee.id) if assignee is not None else None},
        headers=auth_header(login(client, actor.email)),
    )


# --- The matrix --------------------------------------------------------------


@pytest.mark.parametrize(
    ("level", "may_self_assign", "may_assign_others"),
    [
        (EngineerLevel.JUNIOR, False, False),
        (EngineerLevel.SENIOR, True, False),
        (EngineerLevel.LEAD, True, True),
    ],
)
def test_engineer_level_decides_who_may_assign(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    level: EngineerLevel,
    may_self_assign: bool,
    may_assign_others: bool,
) -> None:
    engineer = make_engineer(db_session, level=level)
    colleague = make_engineer(db_session, level=EngineerLevel.JUNIOR)

    self_response = assign(client, ticket, engineer, engineer)
    assert (self_response.status_code == 200) is may_self_assign, self_response.text

    other_response = assign(client, ticket, engineer, colleague)
    assert (other_response.status_code == 200) is may_assign_others, other_response.text


def test_an_employee_can_never_assign(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = assign(client, ticket, reporter, engineer)

    assert response.status_code == 403
    assert response.json()["code"] == "ASSIGN_NOT_PERMITTED"


def test_an_admin_can_assign_anyone(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)
    engineer = make_engineer(db_session, level=EngineerLevel.JUNIOR)

    response = assign(client, ticket, admin, engineer)

    assert response.status_code == 200, response.text
    assert response.json()["incident"]["assignee"]["id"] == str(engineer.id)


def test_a_senior_cannot_pick_up_a_ticket_someone_else_holds(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    holder = make_engineer(db_session, level=EngineerLevel.JUNIOR)
    taken = make_incident(
        db_session, reporter=reporter, category=category, building=building, assignee=holder
    )
    senior = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = assign(client, taken, senior, senior)

    assert response.status_code == 403
    assert response.json()["code"] == "INCIDENT_NOT_AVAILABLE"


def test_a_senior_cannot_pick_up_a_ticket_that_is_no_longer_open(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    in_flight = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.IN_PROGRESS,
    )
    senior = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = assign(client, in_flight, senior, senior)

    assert response.status_code == 403


def test_a_closed_ticket_cannot_be_assigned(
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
    engineer = make_engineer(db_session, level=EngineerLevel.LEAD)

    response = assign(client, closed, admin, engineer)

    assert response.status_code == 403
    assert response.json()["code"] == "INCIDENT_CLOSED"


# --- Who may receive work ----------------------------------------------------


def test_a_ticket_cannot_be_assigned_to_a_non_engineer(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    admin = make_admin(db_session)

    response = assign(client, ticket, admin, reporter)

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "ASSIGNEE_NOT_ENGINEER"
    assert body["field"] == "assignee_id"


def test_a_ticket_cannot_be_assigned_to_a_deactivated_engineer(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    engineer.is_active = False
    db_session.flush()

    response = assign(client, ticket, admin, engineer)

    assert response.status_code == 422
    assert response.json()["code"] == "ASSIGNEE_INACTIVE"


def test_assigning_to_an_unknown_id_is_refused(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/assign",
        json={"assignee_id": str(uuid.uuid4())},
        headers=auth_header(login(client, admin.email)),
    )

    assert response.status_code == 422


# --- Warnings, not refusals --------------------------------------------------


def test_assigning_to_an_unavailable_engineer_succeeds_with_a_warning(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    """A lead who has decided to do this knows something the system does not."""
    admin = make_admin(db_session)
    engineer = make_engineer(
        db_session,
        level=EngineerLevel.SENIOR,
        availability=AvailabilityStatus.ON_LEAVE,
        full_name="Sam Away",
    )

    response = assign(client, ticket, admin, engineer)

    assert response.status_code == 200, response.text
    warnings = response.json()["warnings"]
    assert len(warnings) == 1
    assert "on leave" in warnings[0]


def test_assigning_past_capacity_succeeds_with_a_warning(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    engineer = make_engineer(
        db_session, level=EngineerLevel.SENIOR, max_active_tickets=1, full_name="Sam Busy"
    )
    make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )
    admin = make_admin(db_session)

    response = assign(client, ticket, admin, engineer)

    assert response.status_code == 200, response.text
    warnings = response.json()["warnings"]
    assert any("limit of 1" in warning for warning in warnings)


def test_a_comfortable_assignment_warns_about_nothing(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = assign(client, ticket, admin, engineer)

    assert response.json()["warnings"] == []


# --- Timestamps, events and unassignment -------------------------------------


def test_the_first_assignment_stamps_assigned_at_and_later_ones_do_not(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    """`assigned_at` answers "how long did this wait for an owner?"."""
    admin = make_admin(db_session)
    first = make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="First Owner")
    second = make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Second Owner")

    assign(client, ticket, admin, first)
    db_session.refresh(ticket)
    stamped = ticket.assigned_at
    assert stamped is not None

    assign(client, ticket, admin, second)
    db_session.refresh(ticket)

    assert ticket.assigned_at == stamped
    assert ticket.assignee_id == second.id


def test_assigning_and_unassigning_are_both_recorded(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    headers = auth_header(login(client, admin.email))

    assign(client, ticket, admin, engineer)
    unassigned = assign(client, ticket, admin, None)

    assert unassigned.status_code == 200, unassigned.text
    assert unassigned.json()["incident"]["assignee"] is None

    # In write order, which needs `incident_events.created_at` to come from
    # the wall clock rather than the transaction clock — see revision 0003.
    activity = client.get(f"/api/v1/incidents/{ticket.id}/activity", headers=headers).json()
    types = [entry["event_type"] for entry in activity]
    assert types == [EventType.ASSIGNED.value, EventType.UNASSIGNED.value]


def test_reassigning_to_the_same_engineer_records_nothing(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    """A no-op must not put a misleading entry on the timeline."""
    admin = make_admin(db_session)
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)
    headers = auth_header(login(client, admin.email))

    assign(client, ticket, admin, engineer)
    assign(client, ticket, admin, engineer)

    activity = client.get(f"/api/v1/incidents/{ticket.id}/activity", headers=headers).json()
    assigned = [e for e in activity if e["event_type"] == EventType.ASSIGNED.value]
    assert len(assigned) == 1


# --- Pick up -----------------------------------------------------------------


def test_a_senior_engineer_can_pick_up_an_unassigned_ticket(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.SENIOR)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/pick-up",
        headers=auth_header(login(client, engineer.email)),
    )

    assert response.status_code == 200, response.text
    assert response.json()["incident"]["assignee"]["id"] == str(engineer.id)


def test_a_junior_engineer_is_told_work_comes_to_them(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    engineer = make_engineer(db_session, level=EngineerLevel.JUNIOR)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/pick-up",
        headers=auth_header(login(client, engineer.email)),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ASSIGN_NOT_PERMITTED"


def test_only_engineers_can_pick_up(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    response = client.post(
        f"/api/v1/incidents/{ticket.id}/pick-up",
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 403


# --- Escalation --------------------------------------------------------------


def test_a_reporter_can_escalate_their_own_ticket(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    response = client.post(
        f"/api/v1/incidents/{ticket.id}/escalate",
        json={"reason": "Nobody has looked at this in three days and I cannot work."},
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_escalated"] is True
    assert body["escalated_by"]["id"] == str(reporter.id)
    assert body["escalated_at"] is not None


def test_escalating_someone_elses_ticket_is_refused(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    stranger = make_user(db_session, full_name="Unrelated Employee")

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/escalate",
        json={"reason": "This looks urgent to me as well."},
        headers=auth_header(login(client, stranger.email)),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ESCALATE_NOT_PERMITTED"


def test_a_resolved_ticket_cannot_be_escalated(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    """A resolved ticket does not need flagging as urgent; it needs reopening."""
    category, building = place
    resolved = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        status=IncidentStatus.RESOLVED,
    )

    response = client.post(
        f"/api/v1/incidents/{resolved.id}/escalate",
        json={"reason": "I do not think this is actually fixed."},
        headers=auth_header(login(client, reporter.email)),
    )

    assert response.status_code == 403


def test_escalating_twice_is_a_conflict(
    client: TestClient, db_session: Session, ticket: Incident, reporter: User
) -> None:
    headers = auth_header(login(client, reporter.email))
    body = {"reason": "Still nothing has happened and it is getting worse."}

    client.post(f"/api/v1/incidents/{ticket.id}/escalate", json=body, headers=headers)
    second = client.post(f"/api/v1/incidents/{ticket.id}/escalate", json=body, headers=headers)

    assert second.status_code == 409
    assert second.json()["code"] == "ALREADY_ESCALATED"


def test_an_admin_can_clear_an_escalation_and_reprioritise_at_once(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    """Clearing and re-prioritising are one decision, so they are one call."""
    category, building = place
    escalated = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        is_escalated=True,
        priority=IncidentPriority.LOW,
    )
    admin = make_admin(db_session)
    headers = auth_header(login(client, admin.email))

    response = client.post(
        f"/api/v1/incidents/{escalated.id}/clear-escalation",
        json={"note": "Agreed, raising this and assigning it today.", "priority": "HIGH"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_escalated"] is False
    assert body["escalation_reason"] is None
    assert body["priority"] == "HIGH"

    activity = client.get(f"/api/v1/incidents/{escalated.id}/activity", headers=headers).json()
    types = [entry["event_type"] for entry in activity]
    assert EventType.ESCALATION_CLEARED.value in types
    assert EventType.PRIORITY_CHANGED.value in types


def test_clearing_an_escalation_that_is_not_there_is_a_conflict(
    client: TestClient, db_session: Session, ticket: Incident
) -> None:
    admin = make_admin(db_session)

    response = client.post(
        f"/api/v1/incidents/{ticket.id}/clear-escalation",
        json={"note": "Nothing to clear."},
        headers=auth_header(login(client, admin.email)),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "NOT_ESCALATED"


def test_only_an_admin_can_clear_an_escalation(
    client: TestClient,
    db_session: Session,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    escalated = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        is_escalated=True,
    )
    lead = make_engineer(db_session, level=EngineerLevel.LEAD)

    response = client.post(
        f"/api/v1/incidents/{escalated.id}/clear-escalation",
        json={"note": "I have picked this up."},
        headers=auth_header(login(client, lead.email)),
    )

    assert response.status_code == 403


def test_escalated_tickets_can_be_filtered_for(
    client: TestClient,
    db_session: Session,
    ticket: Incident,
    reporter: User,
    place: tuple[Category, Building],
) -> None:
    category, building = place
    make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        is_escalated=True,
        title="This one has been escalated",
    )

    body = client.get(
        "/api/v1/incidents?is_escalated=true",
        headers=auth_header(login(client, reporter.email)),
    ).json()

    assert [item["title"] for item in body["items"]] == ["This one has been escalated"]
