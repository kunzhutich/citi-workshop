"""Notification inbox endpoints.

Four routes, all scoped to the caller. None of them takes a user parameter:
there is nothing to tamper with, because the only inbox any request can reach
is the one belonging to the bearer token it arrived with.

`GET /notifications/unread-count` is the busiest route in the application —
every open tab asks for it every thirty seconds — so it is kept to one scalar
query and a one-field response. See `repositories/notifications.unread_count`
for why that query is an index-only scan.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.models.notification import Notification
from app.schemas.common import Page, Paging, build_page
from app.schemas.notification import MarkAllReadResult, NotificationRead, UnreadCount
from app.security.dependencies import CurrentUser, DbSession
from app.services import notification_service as service

router = APIRouter(prefix="/notifications", tags=["notifications"])

UnreadOnly = Annotated[
    bool,
    Query(description="Show only notifications that have not been read yet."),
]


@router.get(
    "/unread-count",
    response_model=UnreadCount,
    summary="How many notifications the caller has not read",
)
def get_unread_count(session: DbSession, user: CurrentUser) -> UnreadCount:
    """Return the number the bell badge shows.

    Declared before `/{notification_id}/read` so the literal path is never at
    risk of being read as an id, and kept separate from the list endpoint so
    that polling a count never pays for a page of rows.
    """
    return UnreadCount(unread=service.unread_count(session, user))


@router.get(
    "",
    response_model=Page[NotificationRead],
    summary="List the caller's notifications",
)
def list_notifications(
    session: DbSession,
    user: CurrentUser,
    paging: Paging,
    unread_only: UnreadOnly = False,
) -> Page[NotificationRead]:
    """Return one page of the caller's inbox, newest first."""
    rows, total = service.list_inbox(
        session,
        user=user,
        unread_only=unread_only,
        paging=paging,
    )
    return build_page([_to_read(row) for row in rows], total=total, params=paging)


@router.post(
    "/read-all",
    response_model=MarkAllReadResult,
    summary="Mark every unread notification as read",
)
def mark_all_read(session: DbSession, user: CurrentUser) -> MarkAllReadResult:
    """Clear the caller's badge in one statement, reporting how many rows moved."""
    marked = service.mark_all_read(session, user=user)
    session.commit()
    return MarkAllReadResult(marked=marked)


@router.post(
    "/{notification_id}/read",
    response_model=NotificationRead,
    summary="Mark one notification as read",
)
def mark_read(
    notification_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
) -> NotificationRead:
    """Mark one of the caller's notifications read.

    404 rather than 403 for somebody else's notification: whether a stranger
    has an inbox item is not information this endpoint gives out.
    """
    notification = service.mark_read(session, notification_id=notification_id, user=user)
    session.commit()
    return _to_read(notification)


def _to_read(notification: Notification) -> NotificationRead:
    """Render one notification, with the ticket it points at as it stands now."""
    incident = notification.incident
    return NotificationRead(
        id=notification.id,
        type=notification.type,
        message=notification.message,
        read_at=notification.read_at,
        created_at=notification.created_at,
        incident_id=notification.incident_id,
        incident_reference=incident.reference,
        incident_title=incident.title,
        incident_status=incident.status,
    )
