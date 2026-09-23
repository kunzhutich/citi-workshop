"""SQL for the notification inbox.

Every statement here is keyed on one `user_id` and takes it as an argument.
That is this table's whole access-control story, and the reason there is no
`apply_notification_visibility` beside the two functions in
`services/visibility.py`: a notification is not a row somebody may or may not
be allowed to see, it is a row addressed to exactly one person. There is no
query in the application that reads another user's inbox, so the safe shape is
one where a caller cannot express one.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import Session, joinedload

from app.models.enums import NotificationType
from app.models.incident import Incident
from app.models.notification import Notification


def add(
    session: Session,
    *,
    user_id: uuid.UUID,
    incident_id: uuid.UUID,
    notification_type: NotificationType,
    message: str,
) -> Notification:
    """Append one notification. The caller commits.

    Takes the fields rather than a built `Notification` for the same reason
    `incidents.add_event` does: every service that notifies somebody writes it
    the same way, through one function.
    """
    notification = Notification(
        user_id=user_id,
        incident_id=incident_id,
        type=notification_type,
        message=message,
    )
    session.add(notification)
    return notification


def unread_count(session: Session, user_id: uuid.UUID) -> int:
    """Return how many unread notifications this user has.

    **The hot query.** Every open browser tab asks for this every thirty
    seconds, so it is deliberately the cheapest statement in the codebase: no
    join, no ORM entity, no ordering, and `count(*)` over
    `ix_notifications_user_id_read_at`, whose two columns are exactly this
    WHERE clause. PostgreSQL answers it with an index-only scan and never
    visits the table.
    """
    statement = (
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
    )
    return session.scalar(statement) or 0


def inbox_query(user_id: uuid.UUID, *, unread_only: bool) -> Select[tuple[Notification]]:
    """Build the statement for one user's inbox, newest first.

    Returned rather than executed, matching `incidents.notes_query`: the
    service decides what else to narrow, and no caller can build a
    `select(Notification)` of their own that forgets the `user_id`.

    The incident is loaded with the row because every line of the inbox shows
    the ticket it points at, and twenty-five lazy loads would be twenty-five
    round trips. `load_only` keeps the join narrow — `incidents` carries a
    `tsvector` search document that this screen has no use for.
    """
    statement = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .options(
            joinedload(Notification.incident).load_only(
                Incident.ticket_number,
                Incident.title,
                Incident.status,
            )
        )
        # `id` breaks ties. `clock_timestamp()` makes a collision unlikely
        # rather than impossible, and a page boundary that is not stable is a
        # row shown twice or not at all.
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    return statement


def list_page(
    session: Session,
    statement: Select[tuple[Notification]],
    *,
    limit: int,
    offset: int,
) -> tuple[Sequence[Notification], int]:
    """Return one page of an inbox statement, and the total behind it.

    The count is taken from the statement before paging is applied, so `total`
    describes the whole inbox rather than the page.
    """
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(statement.limit(limit).offset(offset)).unique().all()
    return rows, total


def get_for_user(
    session: Session,
    notification_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Notification | None:
    """Return one of this user's notifications, or None.

    The `user_id` is part of the lookup rather than checked afterwards, so
    somebody else's notification is indistinguishable from one that does not
    exist — which is the answer the router gives, for the same reason
    `services/notes.get_note` 404s on an INTERNAL note.
    """
    statement = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    )
    return session.scalars(statement).first()


def mark_all_read(session: Session, user_id: uuid.UUID, *, now: datetime) -> int:
    """Stamp every unread notification this user has, returning how many.

    One `UPDATE`, not a loop: an inbox left alone for a month can hold
    hundreds of rows, and this runs on a button press. `synchronize_session`
    is left at its default so the session's own copies stay correct, and the
    `read_at IS NULL` term makes a second press cost nothing and report zero.
    """
    statement = (
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    return session.execute(statement).rowcount
