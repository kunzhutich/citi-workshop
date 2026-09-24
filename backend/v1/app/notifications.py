"""Who gets told what, written as data.

This module is the single source of truth for **who is notified, when, and in
what words**. It is the sibling of `app/workflow.py`, and it is shaped the same
way for the same reason: the alternative is four services each carrying a line
that says "and also tell the reporter", and a fifth one added later that
forgets to.

Three things read it and nothing restates it:

* `services/notification_service.record` turns a plan into rows;
* `seed/demo.py` builds the demo world's inbox from the same rules rather than
  inventing its own;
* `tests/unit/test_notifications.py` parametrises over `RULES` itself, so a
  kind of notification added without a test is not possible.

There is deliberately **no database access here**. A rule takes an incident, a
user and possibly a note, and returns a list of `PlannedNotification`. That is
what makes the whole policy — including every "does *not* get notified" case —
testable without a session, and it is why the service layer is a thin caller
rather than the place the thinking happens.

`incident.watchers` does not break that. It is an attribute of the object it
was handed, exactly like `incident.reporter_id`, and it is loaded before the
object gets here by `repositories/incidents._detail_loaders`. The property
this module keeps is that it never *issues* a query; it was never that the
incident arrives half-built.

## The three rules that are not in the table

They are conditions on every row, so they are applied once in `plan()` rather
than repeated on each of them:

1. **Nobody is notified about their own action.** An engineer who resolves a
   ticket does not need telling that it was resolved. This is why
   `NotificationContext` carries the actor at all.
2. **One person, one notification.** A LEAD who reported a ticket and is also
   its assignee matches two audiences; they get the reporter's wording once,
   not two rows. `AUDIENCE_PRECEDENCE` decides which wording.
3. **A capacity nobody holds is skipped.** An unassigned ticket has no
   ASSIGNEE, so the ASSIGNEE entry of every rule simply does not fire.

## One audience, many people

WATCHER is the first capacity more than one person can hold at once, and the
place that absorbs it is `CAPACITY_HOLDERS`: every audience is now looked up
as a **tuple** of user ids, and REPORTER and ASSIGNEE are simply the ones that
always answer with nought or one. `plan()` loops over that tuple.

Doing it there rather than in the table is what keeps both of the rules above
true for watchers without a word being written about watchers in either of
them. A watcher who resolved the ticket themselves is dropped by the actor
check, and a watcher listed twice by `already_told` — the same two lines that
have always been there.

Rule 2 needs one addition, because a resolution fires two rules and
`already_told` only spans one call: `_the_watchers` excludes anybody who is
already the reporter or the assignee. See its docstring; it is the one place
where "one person, one notification" had to be extended rather than reused.

**Rejected:** a `watchers` field on `NotificationRule` alongside `messages`,
and a second `plan_for_watchers()` beside `plan()`. Each would have made
"nobody is notified about their own action" a rule with two implementations,
and the second one is the one that gets forgotten.

## A rule that does not always fire

The trigger for WATCHED_RESOLVED is a status change — the same action that
produces STATUS_CHANGED — but the audience only cares about one destination
status. That is `applies`, the mechanism `NOTE_ADDED` already uses, and it is
why WATCHED_RESOLVED is **its own rule** rather than a third audience on
STATUS_CHANGED: `applies` gates a whole row, so putting the condition there
would have silenced the reporter and the assignee on every move that is not a
resolution. Two rows, one condition each, and nothing conditional per
audience.

## What an INTERNAL note must never do

`NOTE_ADDED` carries a precondition, `_is_a_public_staff_note`, and it is the
most important line in this file. An INTERNAL note is staff-only — the whole
of `services/visibility.py` exists to keep it that way — and a notification
telling an employee "Alex Chen added an update" would announce the existence
of a note they may not read. The check lives here, with the audience, rather
than at the call site in `services/notes.py`, so that "an internal note
notifies nobody" is a statement in the rule table instead of an `if` somebody
can delete while refactoring a service.

The messages never quote a note, for a related reason recorded on
`models/notification.py`: a note can be edited or deleted, a stored message
cannot.
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum

from app.models.enums import IncidentStatus, NoteVisibility, NotificationType
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User


class Audience(StrEnum):
    """The capacity in which a user hears about one particular incident.

    Not a role, for the same reason `workflow.Actor` is not: the same person
    is a different audience on a different ticket. The two enums overlap but
    are not the same set — there is no FACILITY_ADMIN audience, because
    notifying every admin of every event is a fan-out with no bound and the
    admin dashboard is already the screen that answers "what needs me?".

    WATCHER is bounded in the one way that matters against that objection:
    nobody is in it who did not put themselves in it. There is no endpoint
    that subscribes somebody else, and `categories.allows_watchers` decides
    which kinds of problem may be subscribed to at all.
    """

    REPORTER = "REPORTER"
    ASSIGNEE = "ASSIGNEE"
    WATCHER = "WATCHER"


#: Which wording wins when one person holds two capacities on one ticket.
#:
#: The reporter's wording first: "your ticket" is both the more informative
#: framing and the one the person is more likely to be checking for. The
#: consequence worth knowing is that a LEAD engineer who reported a fault at
#: their own desk and then picked it up reads "Your ticket INC-000123 is now
#: Resolved", not the assignee's wording.
#:
#: WATCHER is last because it is the weakest claim on a ticket: somebody who
#: reported a fault and then pressed "I'm affected too" on it is a reporter
#: who clicked a button, and should read "your ticket".
AUDIENCE_PRECEDENCE: tuple[Audience, ...] = (
    Audience.REPORTER,
    Audience.ASSIGNEE,
    Audience.WATCHER,
)


#: Human wording for a status, for use inside a stored message.
#:
#: The only place the backend renders a domain value into English. Everywhere
#: else the API returns the enum and the browser decides how to say it
#: (`frontend/src/display/labels.ts`), which is the right split — except here,
#: where the sentence is *stored* and must still read correctly years later,
#: long after a label in the frontend has been reworded.
STATUS_WORDING: Mapping[IncidentStatus, str] = {
    IncidentStatus.OPEN: "Open",
    IncidentStatus.IN_PROGRESS: "In progress",
    IncidentStatus.BLOCKED: "Blocked",
    IncidentStatus.RESOLVED: "Resolved",
    IncidentStatus.CLOSED: "Closed",
}


@dataclass(frozen=True)
class NotificationContext:
    """Everything a rule is allowed to look at.

    `actor` is whoever performed the action — the engineer who resolved it,
    the admin who assigned it, the author of the note. It is here so that
    `plan()` can drop them from their own audience, and so that a message can
    name them.

    `note` is set only for `NOTE_ADDED`, where the rule has to read the note's
    visibility. Nothing else may use it.
    """

    incident: Incident
    actor: User
    note: IncidentNote | None = None


#: Renders one audience's sentence. Stored verbatim on the notification row.
Message = Callable[[NotificationContext], str]

#: An extra condition on the triggering action itself, as opposed to on who is
#: listening. Returns False to send nothing at all. The analogue of
#: `workflow.TransitionGuard`.
Precondition = Callable[[NotificationContext], bool]


def _status_message_for_reporter(context: NotificationContext) -> str:
    """Tell the reporter their own ticket moved."""
    wording = STATUS_WORDING[context.incident.status]
    return f"Your ticket {context.incident.reference} is now {wording}."


def _status_message_for_assignee(context: NotificationContext) -> str:
    """Tell the assignee a ticket they hold moved without them."""
    wording = STATUS_WORDING[context.incident.status]
    return f"{context.incident.reference} is now {wording}."


def _assigned_message_for_assignee(context: NotificationContext) -> str:
    """Tell an engineer they have just been given a ticket."""
    return f"{context.incident.reference} was assigned to you."


def _assigned_message_for_reporter(context: NotificationContext) -> str:
    """Tell the reporter their ticket finally has an owner, and who."""
    assignee = context.incident.assignee
    name = assignee.full_name if assignee is not None else "an engineer"
    return f"Your ticket {context.incident.reference} was assigned to {name}."


def _note_message_for_reporter(context: NotificationContext) -> str:
    """Tell the reporter that staff wrote on their ticket.

    Names the author and the ticket and quotes nothing — see the module
    docstring and `models/notification.py`.
    """
    return f"{context.actor.full_name} added an update to your ticket {context.incident.reference}."


def _escalation_cleared_message_for_reporter(context: NotificationContext) -> str:
    """Tell the reporter their escalation was answered rather than dropped."""
    reference = context.incident.reference
    return f"{context.actor.full_name} cleared the escalation on your ticket {reference}."


def _escalation_cleared_message_for_assignee(context: NotificationContext) -> str:
    """Tell the assignee the flag on their ticket has gone, and who removed it."""
    reference = context.incident.reference
    return f"{context.actor.full_name} cleared the escalation on {reference}."


def _resolution_message_for_watcher(context: NotificationContext) -> str:
    """Tell a watcher the problem they said affected them has been fixed.

    Names why they are hearing from us. A watcher is the one audience with no
    other connection to the ticket — they did not report it and they do not
    hold it — so a bare "INC-000123 has been resolved" would arrive as a
    reference number from nowhere, possibly weeks after the button was pressed.

    Does not quote `resolution_summary`, for the reason on
    `models/notification.py`: the message is stored and the summary is not
    final — reopening a ticket and resolving it again overwrites it, and this
    sentence would then be describing a fix that is no longer the fix. The
    ticket page is one click away and always current.
    """
    return f"{context.incident.reference}, which you said affected you too, has been resolved."


def _is_a_resolution(context: NotificationContext) -> bool:
    """Return whether this status change is the one watchers asked about.

    Watchers subscribed to an answer, not to a commentary. A ticket typically
    moves five or six times between being reported and being fixed — picked
    up, blocked on a part, resumed — and none of those is news to somebody
    whose only interest is whether the printer works yet.

    CLOSED is deliberately not included. Closing is the reporter confirming
    the fix, or an admin tidying up, and the watcher has already been told the
    thing they were waiting for. Adding it here would mean two notifications
    for one repair.
    """
    return context.incident.status == IncidentStatus.RESOLVED


def _is_a_public_staff_note(context: NotificationContext) -> bool:
    """Return whether this note is one the reporter may be told about.

    Both halves matter. **PUBLIC**, because an INTERNAL note is invisible to an
    employee and a notification about one would leak its existence. **Staff**,
    because `/reports/communication` defines being kept informed as a public
    note from an engineer or an admin, and this notification is the thing that
    report measures — a reporter's own note is not somebody keeping them
    posted.
    """
    note = context.note
    if note is None:
        return False
    return note.visibility == NoteVisibility.PUBLIC and context.actor.is_staff


#: Reads one capacity off an incident. Every one of these is attribute
#: access: no session, no query. See the module docstring.
CapacityLookup = Callable[[Incident], tuple[uuid.UUID, ...]]


def _the_reporter(incident: Incident) -> tuple[uuid.UUID, ...]:
    """Return the person who reported this ticket. Always exactly one."""
    return (incident.reporter_id,)


def _the_assignee(incident: Incident) -> tuple[uuid.UUID, ...]:
    """Return the engineer holding this ticket, or nobody."""
    if incident.assignee_id is None:
        return ()
    return (incident.assignee_id,)


def _the_watchers(incident: Incident) -> tuple[uuid.UUID, ...]:
    """Return everyone following this ticket who is not otherwise on it.

    **The exclusion is the interesting half.** Rule 2 — one person, one
    notification — is enforced by `plan()` within a single call, and a
    resolution fires *two* rules: STATUS_CHANGED for the reporter and the
    assignee, WATCHED_RESOLVED for the watchers. `already_told` cannot see
    across the two, so a reporter who also pressed the button would read "Your
    ticket INC-000123 is now Resolved" and, underneath it, "INC-000123, which
    you said affected you too, has been resolved" — the same news twice,
    which is exactly the outcome rule 2 exists to prevent.

    Fixing it here rather than in `plan()` is deliberate: `plan()` handles one
    rule and cannot know which others fired on the same moment, whereas this
    is a statement about what the WATCHER *audience means* — the people
    following a ticket who would not otherwise hear about it. Everybody else
    is better served by their own capacity's wording.

    `watcher_count` on the API is **not** this number. That is a count of the
    watch rows, because "four people are affected" is a fact about the
    problem; this is an audience for one notification.

    Reads a relationship that `repositories/incidents._detail_loaders` has
    already loaded, and issues no query. Duplicates are impossible —
    `incident_watchers` is keyed on the pair — so the de-duplication in
    `plan()` is a second line of defence rather than the only one.
    """
    already_on_the_ticket = {incident.reporter_id, incident.assignee_id}
    return tuple(
        watcher.user_id
        for watcher in incident.watchers
        if watcher.user_id not in already_on_the_ticket
    )


#: Audience -> how to find who is in it. A mapping rather than a chain of
#: `if`s so that "every audience is resolvable" is a comparison of two sets,
#: which `tests/unit/test_notifications.py` makes.
CAPACITY_HOLDERS: Mapping[Audience, CapacityLookup] = {
    Audience.REPORTER: _the_reporter,
    Audience.ASSIGNEE: _the_assignee,
    Audience.WATCHER: _the_watchers,
}


@dataclass(frozen=True)
class NotificationRule:
    """One kind of notification: who hears about it, and what each is told.

    `messages` is the audience list *and* the wording, as one mapping rather
    than two fields. A capacity that is not a key is never notified, so it is
    impossible to declare an audience and forget to give it a sentence.
    """

    type: NotificationType
    messages: Mapping[Audience, Message]
    #: Checked before any recipient is worked out. None means "always".
    applies: Precondition | None = None

    @property
    def audiences(self) -> frozenset[Audience]:
        """Return the capacities this rule speaks to."""
        return frozenset(self.messages)


#: Every notification this application ever sends.
#:
#: Read BUILD-PLAN section 15's S1 entry alongside this: the four triggers it
#: names are these four rows.
RULES: tuple[NotificationRule, ...] = (
    # A ticket moved. Both sides of the ticket care, and whichever of them
    # moved it is dropped by `plan()` rather than by a condition here.
    NotificationRule(
        type=NotificationType.STATUS_CHANGED,
        messages={
            Audience.REPORTER: _status_message_for_reporter,
            Audience.ASSIGNEE: _status_message_for_assignee,
        },
    ),
    # A ticket got an owner. The new assignee needs to know they have work;
    # the reporter needs to know somebody is on it, which is half of what
    # "kept informed" means.
    NotificationRule(
        type=NotificationType.ASSIGNED,
        messages={
            Audience.REPORTER: _assigned_message_for_reporter,
            Audience.ASSIGNEE: _assigned_message_for_assignee,
        },
    ),
    # Staff wrote something the reporter can read. Reporter only: the
    # assignee is usually the author, and when they are not, the ticket page
    # is where they are already looking.
    NotificationRule(
        type=NotificationType.NOTE_ADDED,
        messages={Audience.REPORTER: _note_message_for_reporter},
        applies=_is_a_public_staff_note,
    ),
    # A shared problem got fixed, and the people who said it affected them
    # too are told once. A separate row from STATUS_CHANGED rather than a
    # third audience on it, because `applies` gates the whole row — see the
    # module docstring.
    NotificationRule(
        type=NotificationType.WATCHED_RESOLVED,
        messages={Audience.WATCHER: _resolution_message_for_watcher},
        applies=_is_a_resolution,
    ),
    # An escalation was answered. Only an admin can clear one, so in practice
    # both audiences hear about it — unless the admin is one of them.
    NotificationRule(
        type=NotificationType.ESCALATION_CLEARED,
        messages={
            Audience.REPORTER: _escalation_cleared_message_for_reporter,
            Audience.ASSIGNEE: _escalation_cleared_message_for_assignee,
        },
    ),
)

#: Lookup built from the table, so `RULES` stays the thing you read.
_RULES_BY_TYPE: Mapping[NotificationType, NotificationRule] = {rule.type: rule for rule in RULES}


@dataclass(frozen=True)
class PlannedNotification:
    """One row the service is about to write. No database types, on purpose."""

    user_id: uuid.UUID
    type: NotificationType
    message: str


def rule_for(notification_type: NotificationType) -> NotificationRule:
    """Return the rule for this kind of notification.

    Raises `KeyError` rather than returning None: every member of
    `NotificationType` has a row, and `tests/unit/test_notifications.py`
    asserts it, so a miss here is a programming error and not a case to handle.
    """
    return _RULES_BY_TYPE[notification_type]


def plan(
    notification_type: NotificationType,
    context: NotificationContext,
) -> list[PlannedNotification]:
    """Return who should be told about this, and what each of them is told.

    An empty list is an ordinary answer, and the common one: an engineer
    resolving an unassigned-to-anyone-else ticket they also reported notifies
    nobody, and so does every INTERNAL note ever written.
    """
    rule = rule_for(notification_type)

    if rule.applies is not None and not rule.applies(context):
        return []

    planned: list[PlannedNotification] = []
    already_told: set[uuid.UUID] = set()

    for audience in AUDIENCE_PRECEDENCE:
        render = rule.messages.get(audience)
        if render is None:
            continue

        for user_id in users_in_capacity(audience, context.incident):
            # Rule 1: never your own action. Rule 2: one person, one
            # notification. Both hold for a capacity held by twenty people
            # exactly as they held for one.
            if user_id == context.actor.id or user_id in already_told:
                continue

            already_told.add(user_id)
            planned.append(
                PlannedNotification(
                    user_id=user_id,
                    type=rule.type,
                    message=render(context),
                )
            )

    return planned


def users_in_capacity(audience: Audience, incident: Incident) -> tuple[uuid.UUID, ...]:
    """Return everyone who holds this capacity on this incident.

    A tuple rather than a single id, because WATCHER is held by as many people
    as pressed the button and REPORTER by exactly one, and `plan()` should not
    have to know which is which. An empty tuple is the ordinary answer for a
    capacity nobody holds — an unassigned ticket, a ticket nobody follows.

    The mirror of `workflow.resolve_actors`, which answers the same question
    from the other end. It is deliberately *not* that function: a LEAD engineer
    counts as ASSIGNEE for the purpose of *acting* on any ticket, because leads
    cover for their team — but notifying every lead about every ticket in the
    estate is not covering for anybody, it is an unreadable inbox.
    """
    return CAPACITY_HOLDERS[audience](incident)
