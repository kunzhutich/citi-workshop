"""The notification rules, tested by reading the table rather than restating it.

The tests that matter here are the **negative** ones. A notification that is
sent is visible the moment anybody uses the application; a notification that
should not have been sent is only visible to the person who receives it, and
by then it has already leaked. So every rule is asserted from both ends: who
gets one, and who specifically does not.

These are pure unit tests. `app/notifications.py` takes no session — it reads
an incident, a user and possibly a note and returns a list of plans — so every
model object below is built in memory and never flushed. That is a property of
the design worth keeping: the whole policy, including every refusal, is
checkable without a database.
"""

import uuid

import pytest

from app import notifications
from app.models.enums import (
    IncidentStatus,
    NoteVisibility,
    NotificationType,
    UserRole,
)
from app.models.feedback import IncidentFeedback
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.models.watcher import IncidentWatcher
from app.notifications import (
    CAPACITY_HOLDERS,
    RULES,
    Audience,
    NotificationContext,
    NotificationRule,
)


def make_user(role: UserRole = UserRole.EMPLOYEE, full_name: str = "Test User") -> User:
    """Build a transient user; no session, no insert."""
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@acme.inc",
        full_name=full_name,
        password_hash="not-a-real-hash",
        role=role,
    )


def make_incident(
    *,
    reporter: User,
    assignee: User | None = None,
    watchers: list[User] | None = None,
    status: IncidentStatus = IncidentStatus.OPEN,
    ticket_number: int = 123,
    title: str = "Monitor flickers",
) -> Incident:
    """Build a transient incident with its people attached.

    `watchers` stands in for the relationship
    `repositories/incidents._detail_loaders` eager-loads. Nothing here is
    flushed, which is the property this whole file rests on: the policy is
    checkable without a session, watchers included.
    """
    incident = Incident(
        id=uuid.uuid4(),
        ticket_number=ticket_number,
        title=title,
        status=status,
        reporter_id=reporter.id,
        assignee_id=assignee.id if assignee is not None else None,
    )
    incident.reporter = reporter
    incident.assignee = assignee
    incident.watchers = [
        IncidentWatcher(incident_id=incident.id, user_id=watcher.id) for watcher in watchers or []
    ]
    return incident


def make_note(
    *,
    incident: Incident,
    author: User,
    visibility: NoteVisibility = NoteVisibility.PUBLIC,
) -> IncidentNote:
    """Build a transient note."""
    return IncidentNote(
        id=uuid.uuid4(),
        incident_id=incident.id,
        author_id=author.id,
        body="Parts are on order, should be with us Thursday.",
        visibility=visibility,
    )


def make_feedback(
    *,
    incident: Incident,
    author: User,
    rated_user: User,
    rating: int = 4,
    resolution_round: int = 1,
) -> IncidentFeedback:
    """Build a transient rating.

    `rated_user` is passed rather than taken from `incident.assignee`, because
    the two being allowed to differ is the reason this row carries the id at
    all — see `test_the_rated_engineer_is_read_off_the_rating_not_the_ticket`.
    """
    return IncidentFeedback(
        id=uuid.uuid4(),
        incident_id=incident.id,
        author_id=author.id,
        rated_user_id=rated_user.id,
        rating=rating,
        comment="Quick and explained what had gone wrong.",
        resolution_round=resolution_round,
    )


def recipients(planned: list[notifications.PlannedNotification]) -> set[uuid.UUID]:
    """Return just the user ids, for the many assertions that only care who."""
    return {item.user_id for item in planned}


# --- The table itself --------------------------------------------------------


@pytest.mark.parametrize("notification_type", list(NotificationType))
def test_every_notification_type_has_exactly_one_rule(
    notification_type: NotificationType,
) -> None:
    """A kind of notification with no rule would be unsendable, and silently so."""
    matching = [rule for rule in RULES if rule.type == notification_type]

    assert len(matching) == 1, notification_type
    assert notifications.rule_for(notification_type) is matching[0]


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.type.value)
def test_every_rule_speaks_to_at_least_one_audience(rule: NotificationRule) -> None:
    """A rule with no audience is a trigger that notifies nobody, ever."""
    assert rule.audiences


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.type.value)
def test_every_audience_has_wording(rule: NotificationRule) -> None:
    """`messages` is the audience list, so this cannot fail — assert it anyway.

    It is the property that makes `NotificationRule` one field instead of two,
    and a refactor back to a separate `audience` set would break it here
    rather than in production.
    """
    assert set(rule.messages) == rule.audiences


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.type.value)
def test_every_message_mentions_the_ticket(rule: NotificationRule) -> None:
    """A notification with no ticket number in it cannot be acted on."""
    reporter = make_user(full_name="Robin Reporter")
    assignee = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(reporter=reporter, assignee=assignee, status=IncidentStatus.RESOLVED)
    admin = make_user(UserRole.FACILITY_ADMIN, full_name="Henry Ford")
    context = NotificationContext(incident=incident, actor=admin)

    for render in rule.messages.values():
        assert incident.reference in render(context)


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.type.value)
def test_every_audience_a_rule_speaks_to_is_a_relationship_to_the_ticket(
    rule: NotificationRule,
) -> None:
    """There is no FACILITY_ADMIN audience, and adding one is a design decision.

    Notifying every admin about every event in the estate is a fan-out with no
    bound. If a rule ever needs it, this test is the place that says so out
    loud rather than the inbox quietly filling up.

    WATCHER passes this because it is not a role either: it is a row somebody
    wrote about themselves on this one ticket, and `allows_watchers` decides
    which tickets may have any. It is the first audience more than one person
    can hold, which is the whole of `CAPACITY_HOLDERS`.

    RATED_ENGINEER passes for the same kind of reason and is the sharpest case
    of it: an engineer is a role, but *the engineer this rating is about* is a
    relationship to one repair of one ticket, frozen when the work was done.
    The engineer who holds the ticket today may be somebody else, and is not
    in this audience.
    """
    assert rule.audiences <= {
        Audience.REPORTER,
        Audience.ASSIGNEE,
        Audience.RATED_ENGINEER,
        Audience.WATCHER,
    }


def test_every_audience_can_be_resolved() -> None:
    """An audience with no lookup would raise `KeyError` mid-notification.

    Declared as a comparison of two whole sets rather than a loop over the
    audiences the table happens to use today, so a member added to `Audience`
    and forgotten in `CAPACITY_HOLDERS` fails here and not in production.
    """
    assert set(CAPACITY_HOLDERS) == set(Audience)


# --- Rule 1: never your own action -------------------------------------------


def test_an_engineer_who_resolves_a_ticket_is_not_told_they_resolved_it() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert recipients(planned) == {reporter.id}


def test_a_reporter_who_confirms_the_fix_is_not_told_they_confirmed_it() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.CLOSED,
    )

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=reporter),
    )

    assert recipients(planned) == {engineer.id}


def test_an_engineer_who_picks_a_ticket_up_tells_the_reporter_and_not_themselves() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(reporter=reporter, assignee=engineer)

    planned = notifications.plan(
        NotificationType.ASSIGNED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert recipients(planned) == {reporter.id}
    assert planned[0].message == "Your ticket INC-000123 was assigned to Sam Senior."


def test_a_reporter_who_cancels_their_own_unassigned_ticket_notifies_nobody() -> None:
    """The commonest empty plan, and the one a naive implementation gets wrong."""
    reporter = make_user()
    incident = make_incident(reporter=reporter, status=IncidentStatus.CLOSED)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=reporter),
    )

    assert planned == []


def test_an_admin_clearing_an_escalation_on_their_own_ticket_is_not_told() -> None:
    admin = make_user(UserRole.FACILITY_ADMIN, full_name="Henry Ford")
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=admin, assignee=engineer)

    planned = notifications.plan(
        NotificationType.ESCALATION_CLEARED,
        NotificationContext(incident=incident, actor=admin),
    )

    assert recipients(planned) == {engineer.id}


# --- Rule 2: one person, one notification ------------------------------------


def test_someone_who_reported_and_holds_a_ticket_gets_one_notification() -> None:
    """A lead who reported a fault at their own desk and then picked it up."""
    lead = make_user(UserRole.ENGINEER, full_name="Lee Lead")
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=lead, assignee=lead, status=IncidentStatus.CLOSED)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=admin),
    )

    assert len(planned) == 1
    # AUDIENCE_PRECEDENCE puts the reporter first, so they read "your ticket".
    assert planned[0].message == "Your ticket INC-000123 is now Closed."


# --- Rule 3: a capacity nobody holds -----------------------------------------


def test_an_unassigned_ticket_notifies_only_its_reporter() -> None:
    reporter = make_user()
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter, status=IncidentStatus.CLOSED)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=admin),
    )

    assert recipients(planned) == {reporter.id}


def test_a_stranger_is_never_a_recipient() -> None:
    """Being signed in is not a relationship to somebody else's ticket."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    bystander = make_user()
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter, assignee=engineer)

    for notification_type in NotificationType:
        note = make_note(incident=incident, author=admin)
        planned = notifications.plan(
            notification_type,
            NotificationContext(incident=incident, actor=admin, note=note),
        )
        assert bystander.id not in recipients(planned), notification_type


# --- NOTE_ADDED: the visibility rule -----------------------------------------


def test_a_public_staff_note_tells_the_reporter() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Alex Chen")
    incident = make_incident(reporter=reporter, assignee=engineer)
    note = make_note(incident=incident, author=engineer)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=engineer, note=note),
    )

    assert recipients(planned) == {reporter.id}
    assert planned[0].message == "Alex Chen added an update to your ticket INC-000123."


def test_an_internal_note_tells_nobody() -> None:
    """The most important assertion in this file.

    An INTERNAL note is staff-only. A notification about one would announce
    its existence to the person it was withheld from, which is the same leak
    `services/visibility.py` exists to prevent — arriving through a different
    door.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer)
    note = make_note(incident=incident, author=engineer, visibility=NoteVisibility.INTERNAL)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=engineer, note=note),
    )

    assert planned == []


def test_an_internal_note_by_an_admin_also_tells_nobody() -> None:
    """Staffness is not the only half of the check; visibility is the other."""
    reporter = make_user()
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter)
    note = make_note(incident=incident, author=admin, visibility=NoteVisibility.INTERNAL)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=admin, note=note),
    )

    assert planned == []


def test_a_reporters_own_public_note_tells_nobody() -> None:
    """Two reasons at once: they are not staff, and it is their own action.

    Either alone would be enough. Both are asserted here because the rule is
    "a PUBLIC note *from staff*", and a version that only dropped the actor
    would notify the reporter about an employee-written note on a ticket they
    also reported... which is nobody, until the day an employee can write on
    somebody else's ticket.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer)
    note = make_note(incident=incident, author=reporter)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=reporter, note=note),
    )

    assert planned == []


def test_a_note_never_quotes_itself() -> None:
    """The message is a pointer, not a copy — a note can be edited or deleted."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer)
    note = make_note(incident=incident, author=engineer)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=engineer, note=note),
    )

    assert note.body not in planned[0].message


def test_a_note_added_plan_without_a_note_sends_nothing() -> None:
    """Defensive, and cheap: a caller that forgets the note notifies nobody."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer)

    planned = notifications.plan(
        NotificationType.NOTE_ADDED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert planned == []


# --- WATCHED_RESOLVED: the watcher rules -------------------------------------


def test_resolving_tells_the_watchers() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    first = make_user(full_name="Bo Nearby")
    second = make_user(full_name="Cam Nextdesk")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[first, second],
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.WATCHED_RESOLVED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert recipients(planned) == {first.id, second.id}
    assert planned[0].message == ("INC-000123, which you said affected you too, has been resolved.")


def test_a_watcher_hears_nothing_about_any_other_move() -> None:
    """The trigger is a status change; the audience cares about one status.

    Asserted for every status a ticket can reach, so a change to
    `_is_a_resolution` that widened it — CLOSED is the tempting one — fails
    here. Four of the five cases are the point: a watcher is not subscribed to
    a commentary on the repair, and BLOCKED in particular would arrive as bad
    news about somebody else's ticket.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    onlooker = make_user()

    for status in IncidentStatus:
        incident = make_incident(
            reporter=reporter,
            assignee=engineer,
            watchers=[onlooker],
            status=status,
        )
        planned = notifications.plan(
            NotificationType.WATCHED_RESOLVED,
            NotificationContext(incident=incident, actor=engineer),
        )
        expected = {onlooker.id} if status == IncidentStatus.RESOLVED else set()
        assert recipients(planned) == expected, status


def test_a_ticket_nobody_follows_notifies_nobody_when_it_resolves() -> None:
    """The ordinary case, and the one an empty-database test would also pass.

    Paired with `test_resolving_tells_the_watchers` above deliberately: on its
    own this assertion is satisfied by a rule that never fires at all.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.WATCHED_RESOLVED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert planned == []


def test_a_watcher_who_resolved_it_themselves_is_not_told() -> None:
    """Rule 1, reaching an audience that was written long after it."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    bystander = make_user()
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[engineer, bystander],
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.WATCHED_RESOLVED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert recipients(planned) == {bystander.id}


def test_the_reporter_of_a_ticket_they_also_follow_is_told_once() -> None:
    """Rule 2, across the two rules that both fire on one resolution.

    `already_told` spans a single `plan()` call, and a resolution calls it
    twice. Without the exclusion in `_the_watchers` this person would read the
    same news in two sentences, which is precisely what rule 2 forbids — and
    every other test in this file would still pass.

    Both calls are made here, exactly as `perform_transition` makes them, and
    the assertion is on the total.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[reporter],
        status=IncidentStatus.RESOLVED,
    )
    context = NotificationContext(incident=incident, actor=engineer)

    everything = notifications.plan(NotificationType.STATUS_CHANGED, context) + notifications.plan(
        NotificationType.WATCHED_RESOLVED, context
    )

    assert [item.user_id for item in everything] == [reporter.id]
    assert everything[0].message == (
        "Sam Senior resolved your ticket INC-000123. Please confirm the fix and rate the work."
    )


def test_an_assignee_who_also_follows_the_ticket_is_told_once() -> None:
    """The same, from the other capacity. An engineer may well press it too."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[engineer],
        status=IncidentStatus.RESOLVED,
    )
    context = NotificationContext(incident=incident, actor=admin)

    everything = notifications.plan(NotificationType.STATUS_CHANGED, context) + notifications.plan(
        NotificationType.WATCHED_RESOLVED, context
    )

    assert sorted(item.user_id for item in everything) == sorted([reporter.id, engineer.id])
    by_user = {item.user_id: item.message for item in everything}
    assert by_user[engineer.id] == "INC-000123 is now Resolved."


def test_a_duplicate_watch_row_cannot_produce_two_notifications() -> None:
    """Belt and braces: the primary key forbids this, and so does `plan`."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    onlooker = make_user()
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[onlooker, onlooker],
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.WATCHED_RESOLVED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert len(planned) == 1


def test_a_status_change_does_not_reach_a_watcher_through_the_other_rule() -> None:
    """STATUS_CHANGED has no WATCHER audience, and must not acquire one.

    If it did, every watcher would hear about every move — the outcome the
    two-rules-with-a-precondition shape exists to prevent — and this file's
    other tests would all still pass.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    onlooker = make_user()
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        watchers=[onlooker],
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert recipients(planned) == {reporter.id}


# --- FEEDBACK_RECEIVED: the rated engineer -----------------------------------


def test_the_engineer_who_was_rated_is_told() -> None:
    reporter = make_user(full_name="Robin Reporter")
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )
    feedback = make_feedback(incident=incident, author=reporter, rated_user=engineer)

    planned = notifications.plan(
        NotificationType.FEEDBACK_RECEIVED,
        NotificationContext(incident=incident, actor=reporter, feedback=feedback),
    )

    assert recipients(planned) == {engineer.id}
    assert planned[0].message == "Robin Reporter rated your work on INC-000123."


def test_the_rated_engineer_is_read_off_the_rating_not_the_ticket() -> None:
    """The reason `rated_user_id` exists at all, asserted from the audience end.

    A RESOLVED ticket can be reassigned — `services/assignment.can_assign`
    blocks only CLOSED — so by the time the reporter rates the work, the
    engineer holding the ticket may be somebody who never touched it. This
    builds exactly that: Sam did the work and Jo holds the ticket now.

    An implementation that read `incident.assignee_id` would tell Jo and
    would pass every other test in this file, because everywhere else the two
    are the same person.
    """
    reporter = make_user(full_name="Robin Reporter")
    who_fixed_it = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    who_holds_it_now = make_user(UserRole.ENGINEER, full_name="Jo Junior")
    incident = make_incident(
        reporter=reporter,
        assignee=who_holds_it_now,
        status=IncidentStatus.RESOLVED,
    )
    feedback = make_feedback(incident=incident, author=reporter, rated_user=who_fixed_it)

    planned = notifications.plan(
        NotificationType.FEEDBACK_RECEIVED,
        NotificationContext(incident=incident, actor=reporter, feedback=feedback),
    )

    assert recipients(planned) == {who_fixed_it.id}


def test_nobody_else_hears_that_a_rating_was_left() -> None:
    """The negative half, and the one that matters.

    A rating is the reporter's private judgement of one engineer's work.
    Watchers of the ticket, the current assignee if that is somebody else, and
    the reporter themselves all get nothing — the rule has exactly one
    audience, and this is what would fail if a second were added without the
    argument being had.

    Built so that every one of those people exists on the ticket: an assertion
    that nobody was told is satisfied by an empty ticket, so the ticket is not
    empty.
    """
    reporter = make_user(full_name="Robin Reporter")
    who_fixed_it = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    who_holds_it_now = make_user(UserRole.ENGINEER, full_name="Jo Junior")
    onlooker = make_user(full_name="Bo Nearby")
    incident = make_incident(
        reporter=reporter,
        assignee=who_holds_it_now,
        watchers=[onlooker],
        status=IncidentStatus.RESOLVED,
    )
    feedback = make_feedback(incident=incident, author=reporter, rated_user=who_fixed_it)

    planned = notifications.plan(
        NotificationType.FEEDBACK_RECEIVED,
        NotificationContext(incident=incident, actor=reporter, feedback=feedback),
    )

    told = recipients(planned)
    assert told == {who_fixed_it.id}
    assert reporter.id not in told
    assert who_holds_it_now.id not in told
    assert onlooker.id not in told


def test_an_engineer_rating_their_own_ticket_is_not_told_about_it() -> None:
    """Rule 1, in the one arrangement where it can fire for this notification.

    An engineer who reported a fault at their own desk and then fixed it is
    both the author of the rating and the person it is about. `plan()` drops a
    recipient who is also the actor, with no line in this rule saying so.
    """
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(
        reporter=engineer,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )
    feedback = make_feedback(incident=incident, author=engineer, rated_user=engineer)

    planned = notifications.plan(
        NotificationType.FEEDBACK_RECEIVED,
        NotificationContext(incident=incident, actor=engineer, feedback=feedback),
    )

    assert planned == []


def test_a_rating_notification_quotes_neither_the_score_nor_the_words() -> None:
    """`models/notification.py`'s rule: a notification is a pointer, never a copy.

    A rating is editable for fifteen minutes, so a stored "rated 2 out of 5"
    could outlive the 2 — the same argument that keeps NOTE_ADDED from
    quoting a note.

    Asserted as **the two sentences being identical** rather than as "the
    digit is absent", which was the first version of this test and was wrong:
    `INC-000123` contains a 1, so a message that did quote a rating of 1 would
    have passed. Equality across the extremes of the scale cannot be satisfied
    by any wording that reads the score at all.
    """
    reporter = make_user(full_name="Robin Reporter")
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )

    def message_for(rating: int, comment: str) -> str:
        feedback = make_feedback(
            incident=incident,
            author=reporter,
            rated_user=engineer,
            rating=rating,
        )
        feedback.comment = comment
        planned = notifications.plan(
            NotificationType.FEEDBACK_RECEIVED,
            NotificationContext(incident=incident, actor=reporter, feedback=feedback),
        )
        return planned[0].message

    worst = message_for(1, "Never turned up and closed it anyway.")
    best = message_for(5, "Fixed in ten minutes and explained the cause.")

    assert worst == best
    assert "Never turned up" not in worst
    assert "Fixed in ten minutes" not in best


def test_a_rating_that_never_arrived_notifies_nobody_rather_than_raising() -> None:
    """The context without its row. Unreachable through `services/feedback.py`.

    `submit` always passes the row it has just written, so this is a guard on
    a future caller rather than on today's. It is asserted because the
    alternative shape — an `AttributeError` on `None.rated_user_id` — would
    turn a forgotten argument into a 500 on a ticket page rather than into a
    notification nobody got.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.FEEDBACK_RECEIVED,
        NotificationContext(incident=incident, actor=reporter),
    )

    assert planned == []


# --- The wording -------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (IncidentStatus.IN_PROGRESS, "Your ticket INC-000123 is now In progress."),
        (IncidentStatus.BLOCKED, "Your ticket INC-000123 is now Blocked."),
        (
            IncidentStatus.RESOLVED,
            "Sam Senior resolved your ticket INC-000123. Please confirm the fix and rate the work.",
        ),
        (IncidentStatus.CLOSED, "Your ticket INC-000123 is now Closed."),
    ],
)
def test_the_reporter_is_told_the_new_status_in_words(
    status: IncidentStatus,
    expected: str,
) -> None:
    """RESOLVED is the one that reads differently, and the three others prove it.

    A resolution is the only move that wants something back from the reader —
    confirm the fix, rate the work — so it is the only one that asks. The
    other three are here so that a change which made *every* status carry the
    invitation would fail: an inbox that asks for feedback on a ticket that
    has just been blocked is worse than one that never asks.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    incident = make_incident(reporter=reporter, assignee=engineer, status=status)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert planned[0].message == expected


def test_the_resolution_sentence_names_whoever_resolved_it_not_the_assignee() -> None:
    """An admin may resolve a ticket on an engineer's behalf, and it should say so.

    Reading `incident.assignee` instead of `context.actor` would have been the
    easy way to write that sentence and would be wrong here — the reporter
    would be told the engineer fixed it on a ticket the engineer never
    touched. Both people are on the incident, so only the assertion tells them
    apart.
    """
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    admin = make_user(UserRole.FACILITY_ADMIN, full_name="Henry Ford")
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.RESOLVED,
    )

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=admin),
    )

    assert planned[0].message.startswith("Henry Ford resolved your ticket INC-000123.")


def test_every_status_has_wording() -> None:
    """A status with no wording would raise `KeyError` mid-transition."""
    assert set(notifications.STATUS_WORDING) == set(IncidentStatus)


def test_the_assignee_is_told_without_the_your_ticket_framing() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(
        reporter=reporter,
        assignee=engineer,
        status=IncidentStatus.CLOSED,
    )

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=admin),
    )

    by_user = {item.user_id: item.message for item in planned}
    assert by_user[reporter.id] == "Your ticket INC-000123 is now Closed."
    assert by_user[engineer.id] == "INC-000123 is now Closed."


def test_an_admin_assigning_tells_both_sides_differently() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER, full_name="Sam Senior")
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter, assignee=engineer)

    planned = notifications.plan(
        NotificationType.ASSIGNED,
        NotificationContext(incident=incident, actor=admin),
    )

    by_user = {item.user_id: item.message for item in planned}
    assert by_user == {
        reporter.id: "Your ticket INC-000123 was assigned to Sam Senior.",
        engineer.id: "INC-000123 was assigned to you.",
    }


def test_the_escalation_message_names_who_cleared_it() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    admin = make_user(UserRole.FACILITY_ADMIN, full_name="Henry Ford")
    incident = make_incident(reporter=reporter, assignee=engineer)

    planned = notifications.plan(
        NotificationType.ESCALATION_CLEARED,
        NotificationContext(incident=incident, actor=admin),
    )

    by_user = {item.user_id: item.message for item in planned}
    assert by_user == {
        reporter.id: "Henry Ford cleared the escalation on your ticket INC-000123.",
        engineer.id: "Henry Ford cleared the escalation on INC-000123.",
    }


def test_every_plan_carries_the_type_it_was_asked_for() -> None:
    """The row's `type` drives the icon and the report's per-kind counts."""
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter, assignee=engineer)

    for notification_type in NotificationType:
        note = make_note(incident=incident, author=admin)
        planned = notifications.plan(
            notification_type,
            NotificationContext(incident=incident, actor=admin, note=note),
        )
        assert all(item.type == notification_type for item in planned), notification_type


# --- The capacity lookup -----------------------------------------------------


def test_a_lead_is_not_an_audience_on_every_ticket() -> None:
    """`workflow.resolve_actors` makes a LEAD an ASSIGNEE anywhere; this does not.

    Leads cover for their team when *acting*. Notifying every lead about every
    ticket in the estate is not covering for anybody.
    """
    reporter = make_user()
    lead = make_user(UserRole.ENGINEER, full_name="Lee Lead")
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(reporter=reporter, status=IncidentStatus.RESOLVED)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=admin),
    )

    assert lead.id not in recipients(planned)


def test_users_in_capacity_reads_the_context_and_nothing_else() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    onlooker = make_user()
    incident = make_incident(reporter=reporter, assignee=engineer, watchers=[onlooker])
    context = NotificationContext(incident=incident, actor=reporter)

    assert notifications.users_in_capacity(Audience.REPORTER, context) == (reporter.id,)
    assert notifications.users_in_capacity(Audience.ASSIGNEE, context) == (engineer.id,)
    assert notifications.users_in_capacity(Audience.WATCHER, context) == (onlooker.id,)
    # No rating on this context, so the capacity is held by nobody — the same
    # empty tuple an unassigned ticket gives for ASSIGNEE.
    assert notifications.users_in_capacity(Audience.RATED_ENGINEER, context) == ()

    bare = make_incident(reporter=reporter)
    bare_context = NotificationContext(incident=bare, actor=reporter)
    assert notifications.users_in_capacity(Audience.ASSIGNEE, bare_context) == ()
    assert notifications.users_in_capacity(Audience.WATCHER, bare_context) == ()
