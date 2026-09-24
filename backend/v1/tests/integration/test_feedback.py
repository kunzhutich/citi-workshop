"""Rating a repair: who may, when they may, and who may read it afterwards.

Four groups of rules are exercised here and nowhere else.

* **The window is independent of closing.** This is the rule most likely to be
  "simplified" back into "you may rate until the ticket is closed", so it is
  asserted from both ends: closing does not shut the window, and the fourteen
  days do.
* **A rating belongs to a repair, not to a ticket.** A reopened and re-fixed
  ticket carries two, and the first survives the reopen.
* **A rating belongs to the engineer who did the work**, which is not always
  the engineer holding the ticket by the time it is rated.
* **Who may read one** — and the case the whole visibility rule exists for: an
  engineer who is not the one being rated sees nothing, even on a ticket they
  are working on.

The visibility assertions read the API rather than the table, because the
thing under test is what reaches a client. The notification assertions read
the `notifications` table rather than the inbox, because the thing under test
is who a *row* is written for; going through the reader as well would make a
failure ambiguous between the two.
"""

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.enums import (
    CloseReason,
    EngineerLevel,
    IncidentStatus,
    LocationDetail,
    NotificationType,
)
from app.models.feedback import IncidentFeedback
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.notification import Notification
from app.models.user import User
from app.services.feedback import EDIT_WINDOW, FEEDBACK_WINDOW
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_engineer,
    make_feedback,
    make_floor,
    make_incident,
    make_note,
    make_user,
)

# --- People ------------------------------------------------------------------


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Robin Reporter")


@pytest.fixture
def stranger(db_session: Session) -> User:
    return make_user(db_session, full_name="Bo Nearby")


@pytest.fixture
def engineer(db_session: Session) -> User:
    """Return the engineer who does the work in most of these tests."""
    return make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Sam Senior")


@pytest.fixture
def other_engineer(db_session: Session) -> User:
    """Return a colleague of `engineer`, at the same level, who did none of the work.

    Same level deliberately. A junior would pass the visibility assertions for
    the wrong reason — it would be impossible to tell "not this rating's
    engineer" from "not senior enough".
    """
    return make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Jo Sideways")


@pytest.fixture
def lead(db_session: Session) -> User:
    return make_engineer(db_session, level=EngineerLevel.LEAD, full_name="Lee Lead")


@pytest.fixture
def admin(db_session: Session) -> User:
    return make_admin(db_session, full_name="Henry Ford")


# --- Places and kinds ---------------------------------------------------------


@pytest.fixture
def building(db_session: Session) -> Building:
    return make_building(db_session, name="San Francisco HQ", code="SFO-1")


@pytest.fixture
def floor(db_session: Session, building: Building) -> Floor:
    return make_floor(db_session, building, name="Level 3", level_number=3)


@pytest.fixture
def category(db_session: Session) -> Category:
    """Return a subcategory with a generated group name.

    Not named after a real one, for the reason `test_watchers.py` gives: the
    ops-action test commits the seeded tree in its own session, so a fixed
    group name would collide in a full run while passing in isolation.
    """
    group = make_category(db_session, location_detail=LocationDetail.FLOOR)
    return make_category(db_session, name="Monitor", parent=group)


# --- Helpers ------------------------------------------------------------------


def ticket(
    db_session: Session,
    *,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor,
    assignee: User | None = None,
    resolved_by: User | None = None,
    status: IncidentStatus = IncidentStatus.RESOLVED,
    resolved_ago: timedelta | None = None,
    reopen_count: int = 0,
    close_reason: CloseReason | None = None,
) -> Incident:
    """Insert a ticket that has been resolved, unless told otherwise.

    `resolved_ago` places the resolution in the past, which is how the
    fourteen-day window is tested without waiting.
    """
    resolved_at = None
    if status in (IncidentStatus.RESOLVED, IncidentStatus.CLOSED):
        resolved_at = utc_now() - (resolved_ago or timedelta(hours=2))

    return make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=assignee,
        resolved_by=resolved_by,
        status=status,
        resolved_at=resolved_at,
        closed_at=utc_now() if status == IncidentStatus.CLOSED else None,
        close_reason=close_reason,
        reopen_count=reopen_count,
        title="Monitor flickers every few minutes",
    )


def headers(client: TestClient, user: User) -> dict[str, str]:
    return auth_header(login(client, user.email))


def rate(
    client: TestClient,
    incident: Incident,
    user: User,
    *,
    rating: int = 4,
    comment: str = "Swapped the cable and it has been steady since.",
) -> Response:
    """Post one rating as `user`."""
    return client.post(
        f"/api/v1/incidents/{incident.id}/feedback",
        json={"rating": rating, "comment": comment},
        headers=headers(client, user),
    )


def feedback_rows(db_session: Session, incident: Incident) -> list[IncidentFeedback]:
    """Return every rating on a ticket, unfiltered by anybody's visibility."""
    statement = (
        select(IncidentFeedback)
        .where(IncidentFeedback.incident_id == incident.id)
        .order_by(IncidentFeedback.resolution_round)
    )
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


def timeline(client: TestClient, incident: Incident, user: User) -> list[dict]:
    """Return one caller's view of a ticket's activity timeline."""
    response = client.get(
        f"/api/v1/incidents/{incident.id}/activity",
        headers=headers(client, user),
    )
    assert response.status_code == 200
    return response.json()


# --- Leaving a rating ---------------------------------------------------------


def test_the_reporter_can_rate_a_resolved_ticket(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )

    response = rate(client, incident, reporter, rating=5, comment="Fixed within the hour.")

    assert response.status_code == 201
    body = response.json()
    assert body["rating"] == 5
    assert body["comment"] == "Fixed within the hour."
    assert body["author"]["id"] == str(reporter.id)
    assert body["rated_user"]["id"] == str(engineer.id)
    assert body["resolution_round"] == 1
    assert body["edited_at"] is None

    rows = feedback_rows(db_session, incident)
    assert len(rows) == 1
    assert rows[0].rated_user_id == engineer.id


@pytest.mark.parametrize("who", ["engineer", "admin", "stranger"])
def test_only_the_reporter_may_rate(
    client: TestClient,
    db_session: Session,
    request: pytest.FixtureRequest,
    who: str,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Three people who can all *see* the ticket and none of whom may rate it.

    The admin is the case worth naming: an admin may do almost everything else
    on a ticket, including closing it, and a rating is still not theirs to
    give. It is the reporter's opinion or it is nobody's.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )
    caller: User = request.getfixturevalue(who)

    response = rate(client, incident, caller)

    assert response.status_code == 403
    assert response.json()["code"] == "FEEDBACK_NOT_PERMITTED"
    assert feedback_rows(db_session, incident) == []


@pytest.mark.parametrize(
    "status",
    [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED],
)
def test_there_is_nothing_to_rate_before_the_work_is_resolved(
    client: TestClient,
    db_session: Session,
    status: IncidentStatus,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
        status=status,
    )

    response = rate(client, incident, reporter)

    assert response.status_code == 409
    assert response.json()["code"] == "FEEDBACK_NOT_RESOLVED"


def test_a_ticket_the_reporter_cancelled_cannot_be_rated(
    client: TestClient,
    db_session: Session,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """CLOSED is a rateable status and this ticket is CLOSED, yet it is refused.

    Cancelling your own OPEN ticket closes it without ever resolving it, so
    `resolved_at` and `resolved_by_id` are both NULL and there is no work to
    have an opinion about. The check that catches this is the one on those two
    columns rather than the one on the status, which is why the case is here:
    a version that trusted the status alone would pass every other test in
    this file and crash on a NULL resolver.
    """
    incident = make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        status=IncidentStatus.CLOSED,
        closed_at=utc_now(),
        close_reason=CloseReason.CANCELLED_BY_REPORTER,
        title="Reported by mistake",
    )

    response = rate(client, incident, reporter)

    assert response.status_code == 409
    assert response.json()["code"] == "FEEDBACK_NOT_RESOLVED"


def test_the_window_closes_fourteen_days_after_the_repair(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
        resolved_ago=FEEDBACK_WINDOW + timedelta(hours=1),
    )

    response = rate(client, incident, reporter)

    assert response.status_code == 409
    assert response.json()["code"] == "FEEDBACK_WINDOW_CLOSED"


def test_the_window_is_still_open_just_inside_it(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The other side of the boundary, so the test above is about the window.

    Without this one, a bug that closed the window immediately would satisfy
    its assertion perfectly.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
        resolved_ago=FEEDBACK_WINDOW - timedelta(hours=1),
    )

    assert rate(client, incident, reporter).status_code == 201


def test_closing_the_ticket_does_not_close_the_rating_window(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The decoupling, asserted directly. The one rule likeliest to be undone.

    "You may rate until you close it" is the intuitive rule and it is a trap:
    it lets whoever closes the ticket decide whether the work gets rated, and
    once tickets close themselves after a week of silence it would mean that
    doing nothing destroys the feedback rather than delaying it.

    So a CLOSED ticket, well inside the fourteen days, is still rateable.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.CLOSED,
        close_reason=CloseReason.CONFIRMED_FIXED,
        resolved_ago=timedelta(days=3),
    )

    response = rate(client, incident, reporter)

    assert response.status_code == 201
    assert len(feedback_rows(db_session, incident)) == 1


def test_a_repair_can_only_be_rated_once(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )
    assert rate(client, incident, reporter).status_code == 201

    second = rate(client, incident, reporter, rating=1, comment="Changed my mind entirely.")

    assert second.status_code == 409
    assert second.json()["code"] == "FEEDBACK_ALREADY_GIVEN"
    rows = feedback_rows(db_session, incident)
    assert len(rows) == 1
    assert rows[0].rating == 4


@pytest.mark.parametrize(
    "payload",
    [
        {"rating": 0, "comment": "Nothing happened."},
        {"rating": 6, "comment": "Better than perfect."},
        {"rating": 4, "comment": "   "},
        {"rating": 4},
        {"comment": "No score given."},
    ],
    ids=["below-the-scale", "above-the-scale", "blank-comment", "no-comment", "no-rating"],
)
def test_a_rating_needs_a_score_in_range_and_words_to_go_with_it(
    client: TestClient,
    db_session: Session,
    payload: dict,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The comment is mandatory on every rating, not only on low ones.

    A score with no words is a number nobody can act on, which is the owner's
    reason; the whitespace case is here because `min_length` alone would have
    let a space through.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )

    response = client.post(
        f"/api/v1/incidents/{incident.id}/feedback",
        json=payload,
        headers=headers(client, reporter),
    )

    assert response.status_code == 422
    assert feedback_rows(db_session, incident) == []


# --- Which engineer a rating lands on -----------------------------------------


def test_a_rating_names_the_engineer_who_resolved_it_not_the_one_holding_it_now(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    other_engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A RESOLVED ticket may be reassigned, and a review must not follow it.

    `services/assignment.can_assign` refuses reassignment only on CLOSED, so
    an admin or a lead can hand a resolved ticket to somebody else while the
    reporter is still deciding what to say about it. Reading the live
    `assignee_id` at that moment would put Sam's review on Jo's record.

    Both engineers are on the ticket here — one as the resolver, one as the
    current assignee — so only the assertion tells them apart.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=other_engineer,
        resolved_by=engineer,
    )

    response = rate(client, incident, reporter)

    assert response.status_code == 201
    assert response.json()["rated_user"]["id"] == str(engineer.id)
    assert feedback_rows(db_session, incident)[0].rated_user_id == engineer.id


def test_resolving_records_who_resolved_it(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """`resolved_by_id` is written by the transition, not by the factory.

    Everything else in this file hands `make_incident` a resolver directly,
    which would keep passing if `_apply_transition_effects` stopped setting
    the column — so this one drives the real workflow endpoint and reads the
    row back.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )

    response = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={"to_status": "RESOLVED", "resolution_summary": "Replaced the display cable."},
        headers=headers(client, engineer),
    )

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(Incident, incident.id).resolved_by_id == engineer.id


def test_reopening_clears_the_resolver_and_the_earlier_rating_survives(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A fix that did not hold is exactly what a score should remember.

    So the round-1 rating stays on the record after the reopen, while the
    ticket itself goes back to having no current fix and nobody who made one.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )
    rated = rate(client, incident, reporter, rating=2, comment="Back again by lunchtime.")
    assert rated.status_code == 201

    response = client.post(
        f"/api/v1/incidents/{incident.id}/transitions",
        json={"to_status": "IN_PROGRESS", "reason": "It has started flickering again."},
        headers=headers(client, reporter),
    )
    assert response.status_code == 200

    db_session.expire_all()
    reopened = db_session.get(Incident, incident.id)
    assert reopened.resolved_by_id is None
    assert reopened.resolved_at is None

    rows = feedback_rows(db_session, incident)
    assert len(rows) == 1
    assert rows[0].rating == 2


def test_a_second_repair_earns_a_second_rating(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    other_engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """One rating per repair, and the two can name different engineers.

    Sam fixed it first and it came back; Jo fixed it the second time. Each
    rating stays with the engineer who earned it, which is the whole reason
    the table is keyed on `(incident_id, resolution_round)` rather than on the
    ticket alone.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )
    make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        rating=2,
        resolution_round=1,
    )

    # The reopen and the second repair, as the workflow would leave them.
    incident.status = IncidentStatus.RESOLVED
    incident.reopen_count = 1
    incident.assignee_id = other_engineer.id
    incident.resolved_by_id = other_engineer.id
    incident.resolved_at = utc_now()
    db_session.flush()

    response = rate(client, incident, reporter, rating=5, comment="Properly sorted this time.")

    assert response.status_code == 201
    assert response.json()["resolution_round"] == 2

    rows = feedback_rows(db_session, incident)
    assert [(row.resolution_round, row.rating) for row in rows] == [(1, 2), (2, 5)]
    assert [row.rated_user_id for row in rows] == [engineer.id, other_engineer.id]


# --- Who is told --------------------------------------------------------------


def test_the_rated_engineer_gets_a_notification(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )

    assert rate(client, incident, reporter).status_code == 201

    db_session.expire_all()
    told = notifications_for(
        db_session, user=engineer, notification_type=NotificationType.FEEDBACK_RECEIVED
    )
    assert len(told) == 1
    assert told[0].message == "Robin Reporter rated your work on " + incident.reference + "."
    assert told[0].incident_id == incident.id
    # And nobody else heard about it.
    assert (
        notifications_for(
            db_session, user=reporter, notification_type=NotificationType.FEEDBACK_RECEIVED
        )
        == []
    )


# --- Who may read one ---------------------------------------------------------


@pytest.mark.parametrize("who", ["reporter", "engineer", "lead", "admin"])
def test_the_reporter_the_rated_engineer_leads_and_admins_can_read_a_rating(
    client: TestClient,
    db_session: Session,
    request: pytest.FixtureRequest,
    who: str,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )
    make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        comment="Explained what had gone wrong, which I appreciated.",
    )
    caller: User = request.getfixturevalue(who)

    response = client.get(
        f"/api/v1/incidents/{incident.id}/feedback",
        headers=headers(client, caller),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["comment"] == "Explained what had gone wrong, which I appreciated."


@pytest.mark.parametrize("who", ["other_engineer", "stranger"])
def test_a_colleague_and_an_onlooker_see_no_rating_at_all(
    client: TestClient,
    db_session: Session,
    request: pytest.FixtureRequest,
    who: str,
    reporter: User,
    engineer: User,
    other_engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The case `apply_feedback_visibility` exists for.

    `other_engineer` is a SENIOR, exactly like the engineer being rated, and
    is the current assignee of this ticket — so they can open it, read its
    notes including INTERNAL ones, and act on it. They still cannot read a
    word of somebody else's review. An implementation that keyed the rule on
    `User.is_staff`, which is what separates the two note visibilities, would
    hand them the lot.

    The list is asserted **empty rather than redacted**: the filter is applied
    to the query, so the row never leaves the database.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=other_engineer,
        resolved_by=engineer,
    )
    make_feedback(db_session, incident=incident, author=reporter, rated_user=engineer)
    caller: User = request.getfixturevalue(who)

    response = client.get(
        f"/api/v1/incidents/{incident.id}/feedback",
        headers=headers(client, caller),
    )

    assert response.status_code == 200
    assert response.json() == []


def test_a_rating_appears_on_the_timeline_for_those_who_may_see_it(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    other_engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The timeline is a third reader of the same filter, so it is asserted too.

    Both callers are looking at the same ticket, and a public note is put on
    it so that both of them have something to see. That note is the control:
    without it, "the colleague's timeline has no rating on it" would also be
    true of a timeline that failed to load, of a ticket that does not exist,
    and of a filter that hid everything from everybody.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=other_engineer,
        resolved_by=engineer,
    )
    make_note(db_session, incident=incident, author=engineer, body="Cable replaced.")
    make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        rating=5,
        comment="Could not have been quicker.",
    )

    mine = timeline(client, incident, reporter)
    theirs = timeline(client, incident, other_engineer)

    ratings = [entry for entry in mine if entry["kind"] == "feedback"]
    assert len(ratings) == 1
    assert ratings[0]["rating"] == 5
    assert ratings[0]["comment"] == "Could not have been quicker."
    assert ratings[0]["rated_user"]["id"] == str(engineer.id)

    assert [entry for entry in theirs if entry["kind"] == "feedback"] == []
    # The control: the colleague's timeline loaded and has the note on it.
    # Only the rating is missing from it.
    assert [entry["body"] for entry in theirs if entry["kind"] == "note"] == ["Cable replaced."]
    assert [entry["body"] for entry in mine if entry["kind"] == "note"] == ["Cable replaced."]


def test_one_persons_rating_is_not_found_by_another(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    other_engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """404, not 403: whether a stranger's work was rated badly is not confirmable."""
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )
    feedback = make_feedback(db_session, incident=incident, author=reporter, rated_user=engineer)

    response = client.patch(
        f"/api/v1/feedback/{feedback.id}",
        json={"rating": 5, "comment": "Rewriting somebody else's review."},
        headers=headers(client, other_engineer),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "FEEDBACK_NOT_FOUND"


# --- Correcting one -----------------------------------------------------------


def test_the_author_can_correct_a_rating_inside_the_window(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )
    feedback = make_feedback(
        db_session, incident=incident, author=reporter, rated_user=engineer, rating=2
    )

    response = client.patch(
        f"/api/v1/feedback/{feedback.id}",
        json={"rating": 4, "comment": "On reflection that was harsh — it was fixed."},
        headers=headers(client, reporter),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["rating"] == 4
    assert body["edited_at"] is not None

    db_session.expire_all()
    assert feedback_rows(db_session, incident)[0].rating == 4


def test_a_rating_goes_cold_after_fifteen_minutes(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
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
        assignee=engineer,
    )
    feedback = make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        rating=2,
        created_at=utc_now() - EDIT_WINDOW - timedelta(minutes=1),
    )

    response = client.patch(
        f"/api/v1/feedback/{feedback.id}",
        json={"rating": 5, "comment": "Too late to change my mind."},
        headers=headers(client, reporter),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "FEEDBACK_EDIT_NOT_PERMITTED"
    db_session.expire_all()
    assert feedback_rows(db_session, incident)[0].rating == 2


def test_the_engineer_can_read_their_review_but_not_rewrite_it(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The pair that makes the two rules distinguishable.

    Reading is 200 and writing is 403, from the same person on the same row —
    so neither answer can be coming from a single "may this person touch it"
    check.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
    )
    feedback = make_feedback(
        db_session, incident=incident, author=reporter, rated_user=engineer, rating=2
    )

    readable = client.get(
        f"/api/v1/incidents/{incident.id}/feedback",
        headers=headers(client, engineer),
    )
    assert readable.status_code == 200
    assert readable.json()[0]["rating"] == 2
    assert readable.json()[0]["can_edit"] is False

    rewritten = client.patch(
        f"/api/v1/feedback/{feedback.id}",
        json={"rating": 5, "comment": "Actually I did a great job."},
        headers=headers(client, engineer),
    )
    assert rewritten.status_code == 403
    assert rewritten.json()["code"] == "FEEDBACK_EDIT_NOT_PERMITTED"
    db_session.expire_all()
    assert feedback_rows(db_session, incident)[0].rating == 2


# --- The flag the button is drawn from ----------------------------------------


def test_can_give_feedback_follows_the_same_rules_as_the_endpoint(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The flag and the endpoint must agree, or the UI offers a button that 409s.

    Checked across the three states that matter: before the work is resolved,
    after it is resolved, and after it has been rated.
    """
    incident = ticket(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=engineer,
        status=IncidentStatus.IN_PROGRESS,
    )

    def flag(user: User) -> bool:
        response = client.get(
            f"/api/v1/incidents/{incident.id}",
            headers=headers(client, user),
        )
        assert response.status_code == 200
        return response.json()["can_give_feedback"]

    assert flag(reporter) is False

    incident.status = IncidentStatus.RESOLVED
    incident.resolved_at = utc_now()
    incident.resolved_by_id = engineer.id
    db_session.flush()

    assert flag(reporter) is True
    # Never for anybody else, whatever state the ticket is in.
    assert flag(engineer) is False

    assert rate(client, incident, reporter).status_code == 201
    assert flag(reporter) is False


def test_an_unknown_ticket_is_a_404_not_a_permission_error(
    client: TestClient,
    reporter: User,
) -> None:
    response = client.post(
        f"/api/v1/incidents/{uuid.uuid4()}/feedback",
        json={"rating": 4, "comment": "Rating a ticket that is not there."},
        headers=headers(client, reporter),
    )

    assert response.status_code == 404
    assert response.json()["code"] == "INCIDENT_NOT_FOUND"
