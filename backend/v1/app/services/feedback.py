"""Rules for the rating a reporter leaves on a repair.

Four rules, each in one place here.

**Who may rate.** The reporter of the ticket, and nobody else. Not an admin on
their behalf, not a watcher who said the problem affected them too — a rating
is one person's opinion of work done for them, and a second opinion is a
second person's ticket. The endpoints have no `user_id` field for that reason,
which is a stronger guarantee than checking one.

**What may be rated.** A repair: the ticket has been resolved, and there is a
`resolved_by_id` naming who resolved it. A ticket cancelled by its reporter or
closed as a duplicate has no `resolved_at` and so cannot be rated, because
nobody did any work to have an opinion about.

**How long the window stays open.** Fourteen days from `resolved_at`, and
**deliberately not tied to the ticket being closed**. The obvious rule — you
may rate until you close it — reads well and is a trap twice over. It lets the
engineer close their own ticket and lock out their own review, and once
tickets close themselves after a week of silence it would mean that doing
nothing silently destroys the feedback rather than merely delaying it. So the
two clocks are independent: closing has no effect on rating, and both are
measured from the moment the work was declared done.

**How long a correction stays possible.** Fifteen minutes for the author, the
same window `services/notes.py` gives a note and for the same reason: long
enough to fix a typo, short enough that the version the engineer read is
mostly the version that stays on the record.

## Which repair a rating is about

A ticket can be fixed more than once. Reopening sends it back to IN_PROGRESS,
possibly into different hands, and each repair earns its own rating — so
`resolution_round` (`reopen_count + 1`, frozen at the moment of writing)
identifies which one, and the unique constraint on `(incident_id,
resolution_round)` is what makes "one rating per repair" true of the table
rather than of this file.

A rating already given **survives a reopen**. The owner's call, and the right
one: a fix that did not hold is exactly the thing a score should remember, and
deleting the review would hide the one case the metric exists to surface.

## Who a rating is about, and why it is not the assignee

`rated_user_id` is copied from `Incident.resolved_by_id`, never read live from
`Incident.assignee_id`. `services/assignment.can_assign` refuses reassignment
only on CLOSED, so an admin or a lead may hand a RESOLVED ticket to a
different engineer — and a live read would then move a review onto somebody
who never touched the problem.

Who may *read* a rating is not here. That is
`services/visibility.apply_feedback_visibility`, applied to the query.
Who is *told* about one is `app/notifications.py`.

## What this deliberately does not do

There is no way to delete a rating, and no admin override on the edit window.
`services/notes.py` gives an admin both, because a note can contain a phone
number that thirty people can read. The same argument applies to a review and
the same answer may eventually be right — but moderating reviews is a policy
with its own questions (is a deleted review still counted? is the engineer
told?) and inventing one here, unasked, would put a rule in the codebase that
nobody decided. See D71.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import AuthorizationError, ConflictError, NotFoundError
from app.models.enums import IncidentStatus, NotificationType
from app.models.feedback import IncidentFeedback
from app.models.incident import Incident
from app.models.user import User
from app.repositories import feedback as repository
from app.schemas.feedback import FeedbackCreate, FeedbackUpdate
from app.services import notification_service
from app.services.visibility import apply_feedback_visibility

#: How long after a repair the reporter may still rate it. Measured from
#: `resolved_at` and unaffected by the ticket closing; see the module
#: docstring.
FEEDBACK_WINDOW = timedelta(days=14)

#: How long after writing a rating its author may still correct it.
EDIT_WINDOW = timedelta(minutes=15)

#: The statuses in which a repair is standing: the engineer has declared the
#: work done and nobody has sent it back. A ticket that has been reopened is
#: IN_PROGRESS again and has no current fix to have an opinion about — its
#: earlier rating stays, and the next one waits for the next resolution.
RATEABLE_STATUSES: tuple[IncidentStatus, ...] = (
    IncidentStatus.RESOLVED,
    IncidentStatus.CLOSED,
)


def current_round(incident: Incident) -> int:
    """Return which repair this ticket is on: 1 before any reopen, 2 after one.

    Derived rather than stored on the incident, because `reopen_count` already
    is the count and a second column holding `count + 1` is the same fact
    twice. It is frozen onto the feedback row at the moment of writing, which
    is what stops a later reopen renumbering a rating that has already been
    given.
    """
    return incident.reopen_count + 1


def can_give_feedback(incident: Incident, user: User, now: datetime | None = None) -> bool:
    """Return whether this user may rate this ticket's current repair.

    Drives the button on the detail response as well as gating the endpoint,
    so the frontend never reasons about the window itself.

    Reads `incident.feedback`, a relationship
    `repositories/incidents._detail_loaders` has already loaded, so this costs
    no query — the same arrangement that lets `app/notifications.py` read
    `incident.watchers`.
    """
    if incident.reporter_id != user.id:
        return False
    if incident.status not in RATEABLE_STATUSES:
        return False
    if incident.resolved_at is None or incident.resolved_by_id is None:
        return False

    moment = now or utc_now()
    if moment - incident.resolved_at > FEEDBACK_WINDOW:
        return False

    return not any(entry.resolution_round == current_round(incident) for entry in incident.feedback)


def can_modify(feedback: IncidentFeedback, user: User, now: datetime) -> bool:
    """Return whether this user may still change this rating.

    The author, inside the edit window, and nobody else at any time — there is
    no admin override here, unlike `services/notes.can_modify_note`. See the
    module docstring.
    """
    if feedback.author_id != user.id:
        return False
    return now - feedback.created_at <= EDIT_WINDOW


def list_for_incident(
    session: Session,
    *,
    incident: Incident,
    user: User,
) -> list[IncidentFeedback]:
    """Return the ratings on this ticket that this user may read, oldest first."""
    visible = apply_feedback_visibility(repository.feedback_query(incident.id), user)
    return list(repository.list_feedback(session, visible))


def submit(
    session: Session,
    *,
    incident: Incident,
    author: User,
    payload: FeedbackCreate,
    now: datetime | None = None,
) -> IncidentFeedback:
    """Record the reporter's rating of this ticket's current repair.

    The caller commits, like every other service here — so the rating and the
    notification it causes land in the same transaction, and there is no path
    that tells an engineer about a review the database never kept.
    """
    moment = now or utc_now()
    _require_can_give_feedback(incident, author, moment)

    # `resolved_by_id` is not None: `can_give_feedback` has just established
    # it, and mypy cannot see that across the call.
    resolved_by_id = incident.resolved_by_id
    if resolved_by_id is None:  # pragma: no cover - guarded above
        raise RuntimeError("A rateable incident arrived without a resolver.")

    feedback_id = repository.add(
        session,
        incident_id=incident.id,
        author_id=author.id,
        rated_user_id=resolved_by_id,
        resolution_round=current_round(incident),
        rating=payload.rating,
        comment=payload.comment,
    )
    if feedback_id is None:
        # The insert found one already there. `_require_can_give_feedback`
        # above asks the same question of `incident.feedback` and is the
        # ordinary path; this is the answer when two requests raced, or when
        # the caller handed us an incident whose collection was loaded before
        # the other one landed. Same refusal either way.
        raise _already_rated()

    # The collection was loaded before this insert and does not know about it.
    # Expiring it means a later `can_give_feedback` in the same session — the
    # detail response the router builds next — reloads and answers correctly,
    # rather than offering a button that would now be refused.
    session.expire(incident, ["feedback"])
    stored = _require_stored(session, feedback_id)

    # Who hears about this is decided in `app/notifications.py`, not here.
    # The engineer named on the row is the audience; `plan()` drops them if
    # they somehow reported the ticket themselves.
    notification_service.record(
        session,
        NotificationType.FEEDBACK_RECEIVED,
        incident=incident,
        actor=author,
        feedback=stored,
    )
    return stored


def _require_stored(session: Session, feedback_id: uuid.UUID) -> IncidentFeedback:
    """Re-read a just-inserted rating with both of its people loaded.

    The insert above is a Core statement, so the row is not in the identity
    map and its `author` and `rated_user` relationships have never been
    populated — and the response names both. One query, on the write path.
    """
    stored = repository.get_one(session, repository.one_query(feedback_id))
    if stored is None:  # pragma: no cover - the insert returned this id
        raise RuntimeError("A rating vanished between being written and being read.")
    return stored


def update(
    session: Session,
    *,
    feedback: IncidentFeedback,
    user: User,
    payload: FeedbackUpdate,
    now: datetime | None = None,
) -> IncidentFeedback:
    """Correct a rating inside the edit window. The caller commits.

    **No second notification.** The engineer was told once, when the review
    arrived, and the sentence they were sent — "so-and-so left feedback on
    INC-000123" — is as true of the corrected version as of the original. A
    notification per keystroke-correction would make a fifteen-minute typo fix
    indistinguishable from a change of heart.
    """
    moment = now or utc_now()
    if not can_modify(feedback, user, moment):
        raise AuthorizationError(
            "You can only change your own rating, and only within "
            f"{int(EDIT_WINDOW.total_seconds() // 60)} minutes of leaving it.",
            code="FEEDBACK_EDIT_NOT_PERMITTED",
        )

    feedback.rating = payload.rating
    feedback.comment = payload.comment
    feedback.edited_at = moment
    session.flush()
    return feedback


def get_feedback(session: Session, feedback_id: uuid.UUID, user: User) -> IncidentFeedback:
    """Return one rating this user may read, or raise `NotFoundError`.

    A rating the caller may not see is a **404, not a 403**, exactly as a note
    they may not see is — whether a stranger's work was rated badly is not
    something an error code should confirm. The two cases are indistinguishable
    here on purpose: the visibility filter is applied to the lookup, so a row
    that exists but is not this caller's simply does not come back.
    """
    visible = apply_feedback_visibility(repository.one_query(feedback_id), user)
    feedback = repository.get_one(session, visible)
    if feedback is None:
        raise NotFoundError("That feedback does not exist.", code="FEEDBACK_NOT_FOUND")
    return feedback


def _require_can_give_feedback(incident: Incident, user: User, now: datetime) -> None:
    """Raise the most specific refusal that applies.

    Three different failures, three different codes and three different status
    codes, because the frontend shows a different thing for each: you are not
    the person whose ticket this is (403), the work is not in a state anybody
    can have an opinion about (409), and you have already said your piece
    (409). A single "not permitted" would make the last two unexplainable.
    """
    if incident.reporter_id != user.id:
        raise AuthorizationError(
            "Only the person who reported a ticket can rate the work on it.",
            code="FEEDBACK_NOT_PERMITTED",
        )

    if (
        incident.status not in RATEABLE_STATUSES
        or incident.resolved_at is None
        or incident.resolved_by_id is None
    ):
        raise ConflictError(
            "This ticket has not been resolved, so there is no work to rate yet.",
            code="FEEDBACK_NOT_RESOLVED",
        )

    if now - incident.resolved_at > FEEDBACK_WINDOW:
        raise ConflictError(
            f"Feedback closed {FEEDBACK_WINDOW.days} days after this ticket was resolved.",
            code="FEEDBACK_WINDOW_CLOSED",
        )

    if any(entry.resolution_round == current_round(incident) for entry in incident.feedback):
        raise _already_rated()


def _already_rated() -> ConflictError:
    """Return the refusal for a repair that has been rated already.

    A function because it is raised from two places — the readable pre-check
    and the insert that is the actual authority — and the caller should not be
    able to tell which of them turned them away.
    """
    return ConflictError(
        "You have already rated this repair.",
        code="FEEDBACK_ALREADY_GIVEN",
    )
