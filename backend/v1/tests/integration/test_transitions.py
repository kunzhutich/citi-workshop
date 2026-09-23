"""Every workflow move, against a real database.

The matrix test below is generated from `workflow.TRANSITIONS` crossed with
four callers. For each pair it asks the table what that caller's move would be
and then asserts the outcome the table implies — so the allowed cases and the
denied cases come from the same source the application uses, and a new row is
covered the moment it is written.

Transitions are exercised through the **service** rather than over HTTP,
because two of the rules under test are about time: the 7-day reopen window and
the lifecycle timestamps. `perform_transition` takes `now`, so the tests set the
clock instead of waiting for it. The endpoints themselves are covered at the
bottom of the file.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import workflow
from app.errors import ApiError
from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    BlockedReasonType,
    CloseReason,
    EngineerLevel,
    EventType,
    IncidentStatus,
)
from app.models.incident import Incident
from app.models.user import User
from app.schemas.incident import TransitionRequest
from app.services import incident_service
from app.workflow import TRANSITIONS, Actor, Transition
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

#: A fixed clock. Every test that cares about time measures from here.
NOW = datetime(2026, 9, 22, 12, 0, tzinfo=UTC)

#: One acceptable value per field a transition can require, so a payload can be
#: built from `required_fields` without the test knowing which move it is.
SAMPLE_FIELDS: dict[str, object] = {
    "reason": "The light started flickering again the next morning.",
    "blocked_reason_type": BlockedReasonType.WAITING_ON_PARTS,
    "blocked_reason": "The replacement ballast is on back order until Friday.",
    "resolution_summary": "Replaced the ballast and both tubes; tested for an hour.",
}


@pytest.fixture
def cast(db_session: Session) -> dict[str, User]:
    """Return the four people every transition test needs.

    `assignee` is a JUNIOR engineer deliberately: a LEAD counts as ASSIGNEE on
    every ticket, which would make the "denied" half of the matrix vacuous.
    """
    return {
        "reporter": make_user(db_session, full_name="Ada Reporter"),
        "assignee": make_engineer(db_session, level=EngineerLevel.JUNIOR),
        "admin": make_admin(db_session),
        "stranger": make_user(db_session, full_name="Unrelated Employee"),
    }


@pytest.fixture
def place(db_session: Session) -> tuple[Category, Building]:
    """Return a subcategory and a building to hang tickets on."""
    group = make_category(db_session)
    return make_category(db_session, name="Lighting", parent=group), make_building(db_session)


def ticket_in(
    db_session: Session,
    place: tuple[Category, Building],
    cast: dict[str, User],
    status: IncidentStatus,
    **overrides: object,
) -> Incident:
    """Insert a ticket in `status`, already satisfying the guards of that status.

    It always has an assignee — "Start work" is guarded on that — and a CLOSED
    one was closed yesterday, inside the reopen window.
    """
    category, building = place
    defaults: dict[str, object] = {
        "assignee": cast["assignee"],
        "acknowledged_at": NOW - timedelta(hours=2) if status != IncidentStatus.OPEN else None,
    }
    if status == IncidentStatus.CLOSED:
        defaults["closed_at"] = NOW - timedelta(days=1)
    if status == IncidentStatus.RESOLVED:
        defaults["resolved_at"] = NOW - timedelta(hours=1)

    defaults.update(overrides)
    return make_incident(
        db_session,
        reporter=cast["reporter"],
        category=category,
        building=building,
        status=status,
        **defaults,  # type: ignore[arg-type]
    )


def payload_for(transition: Transition) -> TransitionRequest:
    """Build a request body satisfying exactly this transition's required fields."""
    values: dict[str, object] = {"to_status": transition.to_status}

    for field in transition.required_fields:
        if field == "close_reason":
            # Deterministic, and never DUPLICATE, which needs a target ticket.
            values["close_reason"] = sorted(
                reason for reason in transition.close_reasons if reason != CloseReason.DUPLICATE
            )[0]
        else:
            values[field] = SAMPLE_FIELDS[field]

    return TransitionRequest.model_validate(values)


def row_id(transition: Transition) -> str:
    """Readable parametrisation id."""
    return (
        f"{transition.from_status.value}->{transition.to_status.value} ({transition.action_label})"
    )


# --- The matrix: every row, every caller -------------------------------------


@pytest.mark.parametrize("transition", TRANSITIONS, ids=row_id)
@pytest.mark.parametrize("who", ["reporter", "assignee", "admin", "stranger"])
def test_every_transition_admits_and_refuses_exactly_who_the_table_says(
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
    transition: Transition,
    who: str,
) -> None:
    """Allowed and denied in one test, both derived from `TRANSITIONS`."""
    user = cast[who]
    incident = ticket_in(db_session, place, cast, transition.from_status)

    actors = workflow.resolve_actors(incident, user)
    expected = workflow.select_transition(transition.from_status, transition.to_status, actors)

    if expected is None:
        with pytest.raises(ApiError) as refused:
            incident_service.perform_transition(
                db_session,
                incident=incident,
                user=user,
                payload=payload_for(transition),
                now=NOW,
            )
        assert refused.value.status_code == 409
        assert refused.value.code == "TRANSITION_NOT_ALLOWED"
        return

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=user,
        payload=payload_for(expected),
        now=NOW,
    )

    assert updated.status == transition.to_status
    if expected.to_status == IncidentStatus.CLOSED:
        assert updated.close_reason in expected.close_reasons


@pytest.mark.parametrize("transition", TRANSITIONS, ids=row_id)
def test_every_transition_writes_its_audit_event(
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
    transition: Transition,
) -> None:
    user = cast[_first_actor_name(transition)]
    incident = ticket_in(db_session, place, cast, transition.from_status)

    incident_service.perform_transition(
        db_session, incident=incident, user=user, payload=payload_for(transition), now=NOW
    )

    events = incident_service.load_activity(db_session, incident=incident, user=user)
    latest = events[-1]
    assert latest.event_type == transition.event_type  # type: ignore[union-attr]
    assert latest.from_value == transition.from_status.value  # type: ignore[union-attr]
    assert latest.to_value == transition.to_status.value  # type: ignore[union-attr]
    assert latest.actor_id == user.id  # type: ignore[union-attr]


@pytest.mark.parametrize("transition", TRANSITIONS, ids=row_id)
def test_every_required_field_is_actually_required(
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
    transition: Transition,
) -> None:
    """Omitting any one of `required_fields` must fail, naming that field."""
    user = cast[_first_actor_name(transition)]

    for field in transition.required_fields:
        incident = ticket_in(db_session, place, cast, transition.from_status)
        body = payload_for(transition).model_dump()
        body[field] = None

        with pytest.raises(ApiError) as refused:
            incident_service.perform_transition(
                db_session,
                incident=incident,
                user=user,
                payload=TransitionRequest.model_validate(body),
                now=NOW,
            )

        assert refused.value.status_code == 422
        assert refused.value.field == field


def _first_actor_name(transition: Transition) -> str:
    """Return the cast member who may perform this transition."""
    names = {
        Actor.REPORTER: "reporter",
        Actor.ASSIGNEE: "assignee",
        Actor.FACILITY_ADMIN: "admin",
    }
    for actor in workflow.ACTOR_PRECEDENCE:
        if actor in transition.allowed_actors:
            return names[actor]
    raise AssertionError(f"no cast member for {transition}")  # pragma: no cover


# --- Timestamp side effects --------------------------------------------------


def test_starting_work_acknowledges_the_ticket(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)
    assert incident.acknowledged_at is None

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["assignee"],
        payload=TransitionRequest(to_status=IncidentStatus.IN_PROGRESS),
        now=NOW,
    )

    assert updated.acknowledged_at == NOW


def test_acknowledged_at_is_never_overwritten(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    """It answers "how long until someone looked at this?", which a resume does not change."""
    first_look = NOW - timedelta(hours=5)
    incident = ticket_in(
        db_session, place, cast, IncidentStatus.BLOCKED, acknowledged_at=first_look
    )

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["assignee"],
        payload=TransitionRequest(to_status=IncidentStatus.IN_PROGRESS),
        now=NOW,
    )

    assert updated.acknowledged_at == first_look


def test_resolving_records_the_summary_and_the_time(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.IN_PROGRESS)

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["assignee"],
        payload=TransitionRequest(
            to_status=IncidentStatus.RESOLVED,
            resolution_summary="Replaced the ballast and both tubes.",
        ),
        now=NOW,
    )

    assert updated.resolved_at == NOW
    assert updated.resolution_summary == "Replaced the ballast and both tubes."


def test_blocking_records_the_reason_and_resuming_clears_it(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    """The reason lives on the ticket while it is blocked and in the events forever."""
    incident = ticket_in(db_session, place, cast, IncidentStatus.IN_PROGRESS)

    blocked = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["assignee"],
        payload=TransitionRequest(
            to_status=IncidentStatus.BLOCKED,
            blocked_reason_type=BlockedReasonType.WAITING_ON_PARTS,
            blocked_reason="Ballast is on back order until Friday.",
        ),
        now=NOW,
    )
    assert blocked.blocked_reason_type == BlockedReasonType.WAITING_ON_PARTS

    resumed = incident_service.perform_transition(
        db_session,
        incident=blocked,
        user=cast["assignee"],
        payload=TransitionRequest(to_status=IncidentStatus.IN_PROGRESS),
        now=NOW,
    )

    assert resumed.blocked_reason_type is None
    assert resumed.blocked_reason is None


def test_confirming_a_fix_closes_it_as_confirmed(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.RESOLVED)

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["reporter"],
        payload=TransitionRequest(to_status=IncidentStatus.CLOSED),
        now=NOW,
    )

    assert updated.close_reason == CloseReason.CONFIRMED_FIXED
    assert updated.closed_at == NOW


def test_still_broken_reopens_and_clears_the_resolution_time(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.RESOLVED)

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["reporter"],
        payload=TransitionRequest(
            to_status=IncidentStatus.IN_PROGRESS,
            reason="It started flickering again an hour later.",
        ),
        now=NOW,
    )

    assert updated.reopen_count == 1
    assert updated.resolved_at is None
    assert updated.status == IncidentStatus.IN_PROGRESS


def test_reopening_a_closed_ticket_clears_the_closure(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(
        db_session,
        place,
        cast,
        IncidentStatus.CLOSED,
        close_reason=CloseReason.CONFIRMED_FIXED,
        resolved_at=NOW - timedelta(days=2),
    )

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=cast["reporter"],
        payload=TransitionRequest(
            to_status=IncidentStatus.IN_PROGRESS,
            reason="The same fault came back two days later.",
        ),
        now=NOW,
    )

    assert updated.reopen_count == 1
    assert updated.closed_at is None
    assert updated.resolved_at is None
    assert updated.close_reason is None


# --- The seven-day reopen window ---------------------------------------------


@pytest.mark.parametrize(
    ("age", "reopenable"),
    [
        (timedelta(days=1), True),
        (workflow.REOPEN_WINDOW, True),
        (workflow.REOPEN_WINDOW + timedelta(seconds=1), False),
        (timedelta(days=30), False),
    ],
    ids=["a day old", "exactly seven days", "a second past seven days", "a month old"],
)
def test_the_reopen_window_closes_after_seven_days(
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
    age: timedelta,
    reopenable: bool,
) -> None:
    """`now` is injected, so this is the real boundary rather than an approximation."""
    incident = ticket_in(db_session, place, cast, IncidentStatus.CLOSED, closed_at=NOW - age)
    payload = TransitionRequest(
        to_status=IncidentStatus.IN_PROGRESS, reason="The fault has come back."
    )

    if reopenable:
        updated = incident_service.perform_transition(
            db_session, incident=incident, user=cast["reporter"], payload=payload, now=NOW
        )
        assert updated.status == IncidentStatus.IN_PROGRESS
        return

    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(
            db_session, incident=incident, user=cast["reporter"], payload=payload, now=NOW
        )

    assert refused.value.status_code == 409
    assert refused.value.code == "TRANSITION_BLOCKED"
    assert refused.value.extra["allowed_transitions"] == []


def test_a_ticket_with_no_assignee_cannot_be_started(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN, assignee=None)

    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(
            db_session,
            incident=incident,
            user=cast["admin"],
            payload=TransitionRequest(to_status=IncidentStatus.IN_PROGRESS),
            now=NOW,
        )

    assert refused.value.status_code == 409
    assert refused.value.code == "TRANSITION_BLOCKED"


# --- Closing as a duplicate --------------------------------------------------


def test_closing_as_a_duplicate_needs_a_target(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)

    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(
            db_session,
            incident=incident,
            user=cast["admin"],
            payload=TransitionRequest(
                to_status=IncidentStatus.CLOSED, close_reason=CloseReason.DUPLICATE
            ),
            now=NOW,
        )

    assert refused.value.status_code == 422
    assert refused.value.field == "duplicate_of_id"


def test_a_ticket_cannot_duplicate_itself(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)

    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(
            db_session,
            incident=incident,
            user=cast["admin"],
            payload=TransitionRequest(
                to_status=IncidentStatus.CLOSED,
                close_reason=CloseReason.DUPLICATE,
                duplicate_of_id=incident.id,
            ),
            now=NOW,
        )

    assert refused.value.code == "DUPLICATE_OF_SELF"


def test_closing_as_a_duplicate_records_both_tickets(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    original = ticket_in(db_session, place, cast, IncidentStatus.IN_PROGRESS)
    copy = ticket_in(db_session, place, cast, IncidentStatus.OPEN)

    updated = incident_service.perform_transition(
        db_session,
        incident=copy,
        user=cast["admin"],
        payload=TransitionRequest(
            to_status=IncidentStatus.CLOSED,
            close_reason=CloseReason.DUPLICATE,
            duplicate_of_id=original.id,
        ),
        now=NOW,
    )

    assert updated.close_reason == CloseReason.DUPLICATE
    assert updated.duplicate_of_id == original.id

    # Two events from one request, and the timeline has to show them in the
    # order they happened. That needs `created_at` to come from the wall clock
    # rather than the transaction clock — see revision 0003.
    events = incident_service.load_activity(db_session, incident=updated, user=cast["admin"])
    assert [entry.event_type for entry in events] == [  # type: ignore[union-attr]
        EventType.STATUS_CHANGED,
        EventType.MARKED_DUPLICATE,
    ]


def test_a_close_reason_outside_the_allowed_set_is_refused(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    """An admin closing an OPEN ticket may not claim the reporter confirmed a fix."""
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)

    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(
            db_session,
            incident=incident,
            user=cast["admin"],
            payload=TransitionRequest(
                to_status=IncidentStatus.CLOSED, close_reason=CloseReason.CONFIRMED_FIXED
            ),
            now=NOW,
        )

    assert refused.value.code == "INVALID_CLOSE_REASON"


# --- A lead covering for their team ------------------------------------------


def test_a_lead_can_act_on_a_ticket_assigned_to_someone_else(
    db_session: Session, cast: dict[str, User], place: tuple[Category, Building]
) -> None:
    lead = make_engineer(db_session, level=EngineerLevel.LEAD)
    incident = ticket_in(db_session, place, cast, IncidentStatus.IN_PROGRESS)

    updated = incident_service.perform_transition(
        db_session,
        incident=incident,
        user=lead,
        payload=TransitionRequest(
            to_status=IncidentStatus.RESOLVED,
            resolution_summary="Finished this off while Sam was on leave.",
        ),
        now=NOW,
    )

    assert updated.status == IncidentStatus.RESOLVED


# --- Through the API ---------------------------------------------------------


def test_allowed_transitions_offers_the_reporter_their_two_moves(
    client: TestClient,
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.RESOLVED)
    headers = auth_header(login(client, cast["reporter"].email))

    body = client.get(
        f"/api/v1/incidents/{incident.id}/allowed-transitions", headers=headers
    ).json()

    assert {(row["to_status"], row["action_label"]) for row in body} == {
        ("CLOSED", "Confirm fixed"),
        ("IN_PROGRESS", "Still broken"),
    }
    still_broken = next(row for row in body if row["to_status"] == "IN_PROGRESS")
    assert still_broken["required_fields"] == ["reason"]


def test_allowed_transitions_tells_an_admin_which_close_reasons_to_offer(
    client: TestClient,
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
) -> None:
    """The dialog's select is populated from this and nowhere else."""
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)
    headers = auth_header(login(client, cast["admin"].email))

    body = client.get(
        f"/api/v1/incidents/{incident.id}/allowed-transitions", headers=headers
    ).json()

    closing = next(row for row in body if row["to_status"] == "CLOSED")
    assert closing["required_fields"] == ["close_reason"]
    assert set(closing["close_reason_choices"]) == {"DUPLICATE", "INVALID", "ADMIN_CLOSED"}


def test_allowed_transitions_is_empty_for_an_unrelated_employee(
    client: TestClient,
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)
    headers = auth_header(login(client, cast["stranger"].email))

    body = client.get(
        f"/api/v1/incidents/{incident.id}/allowed-transitions", headers=headers
    ).json()

    assert body == []


def test_a_transition_through_the_api_updates_the_ticket(
    client: TestClient,
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
) -> None:
    incident = ticket_in(db_session, place, cast, IncidentStatus.IN_PROGRESS)
    headers = auth_header(login(client, cast["assignee"].email))

    response = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={
            "to_status": "RESOLVED",
            "resolution_summary": "Replaced the ballast and both tubes.",
        },
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "RESOLVED"
    assert body["resolution_summary"] == "Replaced the ballast and both tubes."


def test_a_refused_transition_returns_what_is_possible_instead(
    client: TestClient,
    db_session: Session,
    cast: dict[str, User],
    place: tuple[Category, Building],
) -> None:
    """So a client never has to make a second request to find out what it may do."""
    incident = ticket_in(db_session, place, cast, IncidentStatus.OPEN)
    headers = auth_header(login(client, cast["reporter"].email))

    response = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "I fixed it myself."},
        headers=headers,
    )

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "TRANSITION_NOT_ALLOWED"
    assert [row["to_status"] for row in body["allowed_transitions"]] == ["CLOSED"]
    assert body["allowed_transitions"][0]["action_label"] == "Cancel ticket"


def test_transitioning_a_missing_ticket_is_a_404(
    client: TestClient, db_session: Session, cast: dict[str, User]
) -> None:
    headers = auth_header(login(client, cast["admin"].email))

    response = client.post(
        f"/api/v1/incidents/{uuid.uuid4()}/transitions",
        json={"to_status": "CLOSED", "close_reason": "ADMIN_CLOSED"},
        headers=headers,
    )

    assert response.status_code == 404
