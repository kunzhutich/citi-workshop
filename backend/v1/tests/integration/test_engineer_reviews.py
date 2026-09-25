"""An engineer's rating, and the reviews behind it.

Its own file rather than rows added to `test_reports.py`'s dataset, which is
nine incidents with every figure worked out by hand: adding ratings to it
would change numbers a dozen other tests assert.

Four things are exercised here and nowhere else.

* **The split audience.** Every member of staff may read the *score*; only an
  admin, a lead or the engineer themselves may read the *sentences*. A
  colleague seeing 4.1 and no reviews is the case the whole feature turns on.
* **Attribution by `resolved_by_id`.** The figures count the repairs this
  person *made*, not the tickets they currently hold. S7 moved this report
  onto that column so the satisfaction ratio and the counts beside it would
  mean the same thing by the word "resolved".
* **Which timestamp the window filters on.** The ticket's `resolved_at`, never
  the rating's `created_at` — D5's rule applied to a new pair, and the
  opposite of D29's call for the notification read rate.
* **A zero denominator is `None`, not zero.** An engineer nobody has rated has
  no average; 0.0 is below the scale rather than neutral.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.enums import EngineerLevel, IncidentStatus, LocationDetail
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.user import User
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
    make_user,
)


@pytest.fixture
def reporter(db_session: Session) -> User:
    return make_user(db_session, full_name="Robin Reporter")


@pytest.fixture
def engineer(db_session: Session) -> User:
    """Return the subject: the engineer whose work is being rated."""
    return make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Sam Senior")


@pytest.fixture
def peer(db_session: Session) -> User:
    """Return a colleague at the same level, who sees the score and none of the words."""
    return make_engineer(db_session, level=EngineerLevel.SENIOR, full_name="Jo Sideways")


@pytest.fixture
def lead(db_session: Session) -> User:
    return make_engineer(db_session, level=EngineerLevel.LEAD, full_name="Lee Lead")


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


def headers(client: TestClient, user: User) -> dict[str, str]:
    return auth_header(login(client, user.email))


def resolved(
    db_session: Session,
    *,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor,
    resolved_by: User,
    assignee: User | None = None,
    days_ago: float = 2,
    title: str = "Monitor flickers",
) -> Incident:
    """Insert a ticket resolved `days_ago` by `resolved_by`."""
    return make_incident(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        assignee=assignee if assignee is not None else resolved_by,
        resolved_by=resolved_by,
        status=IncidentStatus.RESOLVED,
        resolved_at=utc_now() - timedelta(days=days_ago),
        title=title,
    )


def report(client: TestClient, user: User, engineer: User, **params: object) -> dict:
    """Fetch one engineer's report as `user`."""
    response = client.get(
        f"/api/v1/reports/engineers/{engineer.id}",
        params={k: v for k, v in params.items() if v is not None},
        headers=headers(client, user),
    )
    assert response.status_code == 200, response.text
    return response.json()


def reviews(client: TestClient, user: User, engineer: User, **params: object) -> dict:
    """Fetch one page of an engineer's reviews as `user`."""
    response = client.get(
        f"/api/v1/reports/engineers/{engineer.id}/reviews",
        params={k: v for k, v in params.items() if v is not None},
        headers=headers(client, user),
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- The figures --------------------------------------------------------------


def test_it_averages_the_scores_and_says_how_many_were_rated(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """Three repairs, two rated 5 and 2. Average 3.5, response rate 66.7%.

    Worked out by hand before the code: (5 + 2) / 2 = 3.5, and 2 of 3 is
    66.666… which `_share` rounds to 66.7.
    """
    for index, score in enumerate([5, 2, None]):
        incident = resolved(
            db_session,
            reporter=reporter,
            category=category,
            building=building,
            floor=floor,
            resolved_by=engineer,
            days_ago=index + 1,
            title=f"Ticket {index}",
        )
        if score is not None:
            make_feedback(
                db_session, incident=incident, author=reporter, rated_user=engineer, rating=score
            )

    body = report(client, admin, engineer)

    assert body["resolved_in_period"] == 3
    assert body["rated_in_period"] == 2
    assert body["average_rating"] == 3.5
    assert body["response_rate_pct"] == 66.7


def test_the_distribution_has_five_entries_including_the_scores_nobody_gave(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A histogram that drops its empty bars changes shape as the data changes.

    And "nobody gave this a 1" is exactly the fact a reader came for, so the
    zero rows are the point rather than padding.
    """
    for index, score in enumerate([4, 4, 5]):
        incident = resolved(
            db_session,
            reporter=reporter,
            category=category,
            building=building,
            floor=floor,
            resolved_by=engineer,
            days_ago=index + 1,
            title=f"Ticket {index}",
        )
        make_feedback(
            db_session, incident=incident, author=reporter, rated_user=engineer, rating=score
        )

    body = report(client, admin, engineer)

    assert [row["rating"] for row in body["rating_distribution"]] == [1, 2, 3, 4, 5]
    assert [row["count"] for row in body["rating_distribution"]] == [0, 0, 0, 2, 1]


def test_an_engineer_nobody_rated_has_no_average_rather_than_a_zero(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """0.0 is not neutral on a scale that starts at 1 — it is worse than the worst.

    The same call `reopen_rate_pct` makes, and the reason `_share` returns
    `None` at a zero denominator throughout this module.
    """
    resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
    )

    body = report(client, admin, engineer)

    assert body["resolved_in_period"] == 1
    assert body["rated_in_period"] == 0
    assert body["average_rating"] is None
    assert body["response_rate_pct"] == 0.0


def test_the_figures_count_who_resolved_it_not_who_holds_it_now(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    peer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The reason S7 moved this report onto `resolved_by_id`.

    `services/assignment.can_assign` refuses reassignment only on CLOSED, so a
    resolved ticket can be handed on. Counting by the live assignee would put
    Sam's repair — and Sam's rating — on Jo's page, and would make "1 of 1
    resolved rated" a ratio between two different sets.

    Both engineers are on this ticket, one as the resolver and one as the
    current assignee, so only the assertion tells them apart.
    """
    incident = resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
        assignee=peer,
    )
    make_feedback(db_session, incident=incident, author=reporter, rated_user=engineer, rating=4)

    theirs = report(client, admin, engineer)
    assert theirs["resolved_in_period"] == 1
    assert theirs["rated_in_period"] == 1
    assert theirs["average_rating"] == 4.0

    # And nothing lands on the engineer who merely holds it.
    not_theirs = report(client, admin, peer)
    assert not_theirs["resolved_in_period"] == 0
    assert not_theirs["rated_in_period"] == 0
    assert not_theirs["average_rating"] is None


def test_the_window_follows_the_repair_and_not_the_rating(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """D5's rule on a new pair, and the opposite of D29's call.

    The subject of this figure is the engineer's *work*, and the denominator
    beside it is "repairs they made in the window" — so a rating written today
    about a repair made forty days ago belongs to the period of the repair.
    Windowing on the rating instead would let one fix count in a month the
    engineer did nothing in, and would break the ratio it is half of.

    The rating here is left *now*, well inside any window; the repair is forty
    days back, outside the default thirty. It must not count.
    """
    old_repair = resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
        days_ago=40,
        title="Fixed well before the window",
    )
    make_feedback(
        db_session,
        incident=old_repair,
        author=reporter,
        rated_user=engineer,
        rating=1,
        created_at=utc_now(),
    )

    body = report(client, admin, engineer)

    assert body["resolved_in_period"] == 0
    assert body["rated_in_period"] == 0
    assert body["average_rating"] is None

    # The control: widen the window past the repair and both appear. Without
    # this the assertions above are also true of a query that matches nothing.
    wide = report(
        client,
        admin,
        engineer,
        **{"from": (utc_now() - timedelta(days=60)).isoformat()},
    )
    assert wide["resolved_in_period"] == 1
    assert wide["rated_in_period"] == 1
    assert wide["average_rating"] == 1.0


# --- Who may read what --------------------------------------------------------


@pytest.mark.parametrize("who", ["admin", "lead", "engineer"])
def test_an_admin_a_lead_and_the_engineer_may_read_the_reviews(
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
    incident = resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
    )
    make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        rating=2,
        comment="Came back the next morning.",
    )
    caller: User = request.getfixturevalue(who)

    assert report(client, caller, engineer)["can_read_reviews"] is True
    body = reviews(client, caller, engineer)
    assert body["total"] == 1
    assert body["items"][0]["comment"] == "Came back the next morning."


def test_a_colleague_sees_the_score_and_not_one_word_of_the_reviews(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    peer: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The owner's rule, and the case the split exists for.

    Engineers may see one another's *ratings*; the sentences behind them are
    not theirs. So the average, the response rate and the whole distribution
    reach a peer — asserted here, not merely left unasserted — and the reviews
    list is empty.

    **Empty rather than 403**: a status code that distinguished "there are
    none" from "there are some and they are not yours" would leak the second.
    """
    incident = resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
    )
    make_feedback(
        db_session,
        incident=incident,
        author=reporter,
        rated_user=engineer,
        rating=2,
        comment="Came back the next morning.",
    )

    body = report(client, peer, engineer)

    # The scores reach them in full.
    assert body["average_rating"] == 2.0
    assert body["rated_in_period"] == 1
    assert body["response_rate_pct"] == 100.0
    assert [row["count"] for row in body["rating_distribution"]] == [0, 1, 0, 0, 0]

    # The sentences do not, and the link to them is not drawn.
    assert body["can_read_reviews"] is False
    assert reviews(client, peer, engineer) == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 25,
    }


def test_an_employee_cannot_reach_either(
    client: TestClient,
    reporter: User,
    engineer: User,
) -> None:
    """§5.5: an employee must not reach an engineer's profile at all.

    Enforced by the route's `StaffUser` guard rather than by nobody drawing a
    link, which is what makes it a rule instead of an omission.
    """
    for path in (
        f"/api/v1/reports/engineers/{engineer.id}",
        f"/api/v1/reports/engineers/{engineer.id}/reviews",
    ):
        response = client.get(path, headers=headers(client, reporter))
        assert response.status_code == 403, path


# --- The list -----------------------------------------------------------------


def test_a_review_carries_the_ticket_it_is_about(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A review detached from its repair is an opinion with no subject.

    Both timestamps are asserted because they are different facts: when the
    work was done, and when the reporter got round to saying something.
    """
    incident = resolved(
        db_session,
        reporter=reporter,
        category=category,
        building=building,
        floor=floor,
        resolved_by=engineer,
        title="Second monitor stays black",
    )
    make_feedback(db_session, incident=incident, author=reporter, rated_user=engineer, rating=5)

    row = reviews(client, admin, engineer)["items"][0]

    assert row["reference"] == incident.reference
    assert row["title"] == "Second monitor stays black"
    assert row["category"].endswith("Monitor")
    assert row["incident_id"] == str(incident.id)
    assert row["author"]["full_name"] == "Robin Reporter"
    assert row["resolved_at"] is not None
    assert row["created_at"] is not None


def test_the_score_filter_narrows_the_list_and_its_total(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """The reason anybody opens this screen: show me the unhappy ones.

    `total` is asserted as well as the rows, because a pager counting the
    unfiltered set would offer page two of a one-page list.
    """
    for index, score in enumerate([1, 5, 5]):
        incident = resolved(
            db_session,
            reporter=reporter,
            category=category,
            building=building,
            floor=floor,
            resolved_by=engineer,
            days_ago=index + 1,
            title=f"Ticket {index}",
        )
        make_feedback(
            db_session, incident=incident, author=reporter, rated_user=engineer, rating=score
        )

    everything = reviews(client, admin, engineer)
    assert everything["total"] == 3

    only_ones = reviews(client, admin, engineer, rating=1)
    assert only_ones["total"] == 1
    assert [row["rating"] for row in only_ones["items"]] == [1]


def test_a_score_off_the_scale_is_refused_rather_than_ignored(
    client: TestClient,
    engineer: User,
    admin: User,
) -> None:
    """422, not a silently unfiltered list — the shape `get_include_inactive` uses.

    A filter that is quietly dropped returns more rows than the caller asked
    for, which is the failure mode that matters on a screen about somebody's
    record.
    """
    response = client.get(
        f"/api/v1/reports/engineers/{engineer.id}/reviews",
        params={"rating": 7},
        headers=headers(client, admin),
    )

    assert response.status_code == 422


def test_reviews_are_newest_first(
    client: TestClient,
    db_session: Session,
    reporter: User,
    engineer: User,
    admin: User,
    category: Category,
    building: Building,
    floor: Floor,
) -> None:
    """A list somebody scans for what has come in lately, not a history.

    The opposite order from the ticket timeline, deliberately, and asserted so
    a change to one does not quietly take the other with it.
    """
    for index in range(3):
        incident = resolved(
            db_session,
            reporter=reporter,
            category=category,
            building=building,
            floor=floor,
            resolved_by=engineer,
            days_ago=index + 1,
            title=f"Ticket {index}",
        )
        make_feedback(
            db_session,
            incident=incident,
            author=reporter,
            rated_user=engineer,
            rating=index + 1,
            created_at=utc_now() - timedelta(days=index),
        )

    scores = [row["rating"] for row in reviews(client, admin, engineer)["items"]]

    assert scores == [1, 2, 3]
