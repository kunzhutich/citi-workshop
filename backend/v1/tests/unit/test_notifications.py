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
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.notifications import RULES, Audience, NotificationContext, NotificationRule


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
    status: IncidentStatus = IncidentStatus.OPEN,
    ticket_number: int = 123,
    title: str = "Monitor flickers",
) -> Incident:
    """Build a transient incident with its two people attached."""
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
def test_no_rule_speaks_to_an_admin_as_an_audience(rule: NotificationRule) -> None:
    """There is no FACILITY_ADMIN audience, and adding one is a design decision.

    Notifying every admin about every event in the estate is a fan-out with no
    bound. If a rule ever needs it, this test is the place that says so out
    loud rather than the inbox quietly filling up.
    """
    assert rule.audiences <= {Audience.REPORTER, Audience.ASSIGNEE}


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


# --- The wording -------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (IncidentStatus.IN_PROGRESS, "Your ticket INC-000123 is now In progress."),
        (IncidentStatus.BLOCKED, "Your ticket INC-000123 is now Blocked."),
        (IncidentStatus.RESOLVED, "Your ticket INC-000123 is now Resolved."),
        (IncidentStatus.CLOSED, "Your ticket INC-000123 is now Closed."),
    ],
)
def test_the_reporter_is_told_the_new_status_in_words(
    status: IncidentStatus,
    expected: str,
) -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer, status=status)

    planned = notifications.plan(
        NotificationType.STATUS_CHANGED,
        NotificationContext(incident=incident, actor=engineer),
    )

    assert planned[0].message == expected


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


def test_user_in_capacity_reads_the_incident_and_nothing_else() -> None:
    reporter = make_user()
    engineer = make_user(UserRole.ENGINEER)
    incident = make_incident(reporter=reporter, assignee=engineer)

    assert notifications.user_in_capacity(Audience.REPORTER, incident) == reporter.id
    assert notifications.user_in_capacity(Audience.ASSIGNEE, incident) == engineer.id

    unassigned = make_incident(reporter=reporter)
    assert notifications.user_in_capacity(Audience.ASSIGNEE, unassigned) is None
