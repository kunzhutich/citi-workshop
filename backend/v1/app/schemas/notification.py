"""Request and response models for the notification inbox."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import IncidentStatus, NotificationType


class NotificationRead(BaseModel):
    """One line of the inbox.

    `message` is the sentence exactly as it was stored when the thing
    happened, and the API never re-renders it. The `incident_*` fields are
    read live, because they are what the row *links to* rather than what it
    said: a ticket renamed since the notification was sent should appear under
    its current title, and its current status is how the reader decides
    whether the message still needs acting on.
    """

    id: uuid.UUID
    type: NotificationType
    message: str
    read_at: datetime | None = Field(description="None while unread.")
    created_at: datetime

    incident_id: uuid.UUID
    incident_reference: str = Field(description="The display ticket number, e.g. INC-000123.")
    incident_title: str
    incident_status: IncidentStatus


class UnreadCount(BaseModel):
    """The number on the bell, and nothing else.

    A one-field response on purpose: this is polled every thirty seconds by
    every open tab, so it carries no timestamps, no list and no echo of the
    request.
    """

    unread: int = Field(ge=0, description="Notifications this user has not read.")


class MarkAllReadResult(BaseModel):
    """How many notifications one press of "Mark all as read" actually changed."""

    marked: int = Field(ge=0, description="Rows that were unread and now are not.")
