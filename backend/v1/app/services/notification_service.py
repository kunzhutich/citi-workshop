"""Writing and reading the notification inbox.

Deliberately thin. Every decision about *who* hears about something and *in
what words* lives in `app/notifications.py`; this module turns a plan into
rows and answers the four questions the inbox screen asks. If you are looking
for the rule, it is not here.

**`record` is the only way a notification is written**, and the five services
that call it each do so in one line that names the kind of event, never the
recipient:

| Where | Line |
| --- | --- |
| `services/incident_service.perform_transition` | `NotificationType.STATUS_CHANGED` |
| `services/assignment.assign` | `NotificationType.ASSIGNED` |
| `services/notes.add_note` | `NotificationType.NOTE_ADDED` |
| `services/incident_service.clear_escalation` | `NotificationType.ESCALATION_CLEARED` |
| `services/feedback.submit` | `NotificationType.FEEDBACK_RECEIVED` |

The caller commits, like every other service here. A notification therefore
lands in the same transaction as the event it describes: a resolve that fails
its commit tells nobody it happened, and there is no path that notifies
somebody about a status the database never reached.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy.orm import Session

from app import notifications as rules
from app.clock import utc_now
from app.errors import NotFoundError
from app.models.enums import NotificationType
from app.models.feedback import IncidentFeedback
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.notification import Notification
from app.models.user import User
from app.repositories import notifications as repository
from app.schemas.common import PageParams


def record(
    session: Session,
    notification_type: NotificationType,
    *,
    incident: Incident,
    actor: User,
    note: IncidentNote | None = None,
    feedback: IncidentFeedback | None = None,
) -> list[Notification]:
    """Write whatever `app/notifications.py` says this action is worth telling.

    Returns the rows written, which is usually one, often none, and never more
    than one per person. The caller commits.

    `note` and `feedback` are the two rows a rule may need to look at beyond
    the incident itself — one to read a note's visibility, one to read which
    engineer a rating is about. Each is used by exactly one rule and ignored
    by every other, which the rule table rather than this function decides.
    """
    context = rules.NotificationContext(
        incident=incident, actor=actor, note=note, feedback=feedback
    )
    planned = rules.plan(notification_type, context)

    return [
        repository.add(
            session,
            user_id=item.user_id,
            incident_id=incident.id,
            notification_type=item.type,
            message=item.message,
        )
        for item in planned
    ]


def unread_count(session: Session, user: User) -> int:
    """Return the number on the bell."""
    return repository.unread_count(session, user.id)


def list_inbox(
    session: Session,
    *,
    user: User,
    unread_only: bool,
    paging: PageParams,
) -> tuple[Sequence[Notification], int]:
    """Return one page of a user's notifications, newest first, and the total."""
    statement = repository.inbox_query(user.id, unread_only=unread_only)
    return repository.list_page(
        session,
        statement,
        limit=paging.page_size,
        offset=paging.offset,
    )


def mark_read(
    session: Session,
    *,
    notification_id: uuid.UUID,
    user: User,
    now: datetime | None = None,
) -> Notification:
    """Mark one notification read. The caller commits.

    Idempotent: marking an already-read notification read again keeps the
    first timestamp rather than moving it. When it was read is a fact, and a
    second click on a row is not a second reading of it — `/reports/
    communication` measures those timestamps.

    A notification belonging to somebody else raises `NotFoundError`, not a
    403: whether a stranger has an inbox item is not the caller's business.
    """
    notification = repository.get_for_user(session, notification_id, user.id)
    if notification is None:
        raise NotFoundError(
            "That notification does not exist.",
            code="NOTIFICATION_NOT_FOUND",
        )

    if notification.read_at is None:
        notification.read_at = now or utc_now()
        session.flush()

    return notification


def mark_all_read(
    session: Session,
    *,
    user: User,
    now: datetime | None = None,
) -> int:
    """Mark every unread notification read, returning how many. Caller commits."""
    return repository.mark_all_read(session, user.id, now=now or utc_now())
