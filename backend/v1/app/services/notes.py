"""Rules for the notes people leave on an incident.

Three rules, each in one place here.

**Who may write.** A note is a conversation about a ticket, so you have to be
part of it: the reporter, the assignee, a lead engineer, or an admin. Nobody
writes on a CLOSED ticket — reopen it first, and the 7-day reopen window is
what stops that being a way to edit history forever.

**Who may write INTERNAL.** Staff only. The visibility filter in
`services/visibility.py` is what stops employees *reading* them; this is what
stops an employee creating one and then being the only person unable to see
their own note.

**How long an edit stays possible.** Fifteen minutes for the author — long
enough to fix a typo, short enough that the version the reporter read is
mostly the version that stays on the record. Admins may edit or delete any
note at any time, because someone has to be able to remove a phone number
pasted into a ticket that thirty people can read.

Deletion is soft. The activity timeline is an audit trail and audit trails do
not get holes punched in them; `apply_note_visibility` excludes deleted rows
from every read.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import AuthorizationError, NotFoundError
from app.models.enums import (
    EngineerLevel,
    IncidentStatus,
    NoteVisibility,
    NotificationType,
    UserRole,
)
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.repositories import incidents as repository
from app.schemas.note import NoteCreate, NoteUpdate
from app.services import notification_service
from app.services.visibility import apply_note_visibility

#: How long after writing a note its author may still edit or delete it.
EDIT_WINDOW = timedelta(minutes=15)


def can_add_note(incident: Incident, user: User) -> bool:
    """Return whether this user may add a PUBLIC note to this incident."""
    if incident.status == IncidentStatus.CLOSED:
        return False

    if user.role == UserRole.FACILITY_ADMIN:
        return True

    if incident.reporter_id == user.id:
        return True

    if user.role != UserRole.ENGINEER:
        return False

    if incident.assignee_id == user.id:
        return True

    profile = user.engineer_profile
    return profile is not None and profile.level == EngineerLevel.LEAD


def can_add_internal_note(incident: Incident, user: User) -> bool:
    """Return whether this user may add a staff-only note to this incident."""
    return user.is_staff and can_add_note(incident, user)


def can_modify_note(note: IncidentNote, user: User, now: datetime) -> bool:
    """Return whether this user may still edit or delete this note."""
    if note.deleted_at is not None:
        return False
    if user.role == UserRole.FACILITY_ADMIN:
        return True
    if note.author_id != user.id:
        return False
    return now - note.created_at <= EDIT_WINDOW


def list_notes(session: Session, *, incident: Incident, user: User) -> list[IncidentNote]:
    """Return the notes on an incident that this user may read, oldest first."""
    visible = apply_note_visibility(repository.notes_query(incident.id), user)
    return list(repository.list_notes(session, visible))


def add_note(
    session: Session,
    *,
    incident: Incident,
    author: User,
    payload: NoteCreate,
) -> IncidentNote:
    """Add a note to an incident. The caller commits."""
    if payload.visibility == NoteVisibility.INTERNAL:
        _require_internal_note_permission(incident, author)
    elif not can_add_note(incident, author):
        raise AuthorizationError(
            _why_not_permitted(incident),
            code="NOTE_NOT_PERMITTED",
        )

    note = IncidentNote(
        incident_id=incident.id,
        author_id=author.id,
        body=payload.body,
        visibility=payload.visibility,
    )
    stored = repository.add_note(session, note)

    # Called for *every* note, including INTERNAL ones. The rule that an
    # internal note reaches nobody lives in `app/notifications.py` beside the
    # audience it is protecting, not in an `if` here — see that module's
    # docstring, and decisions D9-D11 for what this class of leak looks like
    # when it is spread across call sites.
    notification_service.record(
        session,
        NotificationType.NOTE_ADDED,
        incident=incident,
        actor=author,
        note=stored,
    )
    return stored


def get_note(session: Session, note_id: uuid.UUID, user: User) -> IncidentNote:
    """Return a note this user may read, or raise `NotFoundError`.

    A note the caller may not see is reported as missing rather than
    forbidden — unlike incidents, where 403 is the right answer. The existence
    of an INTERNAL note is itself staff-only information, and a 403 would
    confirm it.
    """
    note = repository.get_note(session, note_id)
    if note is None or note.deleted_at is not None:
        raise NotFoundError("That note does not exist.", code="NOTE_NOT_FOUND")

    if note.visibility == NoteVisibility.INTERNAL and not user.is_staff:
        raise NotFoundError("That note does not exist.", code="NOTE_NOT_FOUND")

    return note


def update_note(
    session: Session,
    *,
    note: IncidentNote,
    user: User,
    payload: NoteUpdate,
    now: datetime | None = None,
) -> IncidentNote:
    """Edit a note's body within the edit window. The caller commits."""
    moment = now or utc_now()
    _require_modify_permission(note, user, moment)

    note.body = payload.body
    note.edited_at = moment
    session.flush()
    return note


def delete_note(
    session: Session,
    *,
    note: IncidentNote,
    user: User,
    now: datetime | None = None,
) -> IncidentNote:
    """Soft-delete a note within the edit window. The caller commits."""
    moment = now or utc_now()
    _require_modify_permission(note, user, moment)

    note.deleted_at = moment
    session.flush()
    return note


def _require_internal_note_permission(incident: Incident, author: User) -> None:
    """Raise unless this user may add an internal note to this incident."""
    if not author.is_staff:
        raise AuthorizationError(
            "Only engineers and facility admins can write internal notes.",
            code="INTERNAL_NOTE_NOT_PERMITTED",
        )
    if not can_add_note(incident, author):
        raise AuthorizationError(_why_not_permitted(incident), code="NOTE_NOT_PERMITTED")


def _require_modify_permission(note: IncidentNote, user: User, now: datetime) -> None:
    """Raise unless this user may still change this note."""
    if note.deleted_at is not None:
        raise NotFoundError("That note does not exist.", code="NOTE_NOT_FOUND")

    if user.role == UserRole.FACILITY_ADMIN:
        return

    if note.author_id != user.id:
        raise AuthorizationError("You can only change your own notes.", code="NOT_NOTE_AUTHOR")

    if now - note.created_at > EDIT_WINDOW:
        minutes = int(EDIT_WINDOW.total_seconds() // 60)
        raise AuthorizationError(
            f"Notes can only be changed within {minutes} minutes of being written.",
            code="EDIT_WINDOW_CLOSED",
        )


def _why_not_permitted(incident: Incident) -> str:
    """Return the message explaining why a note cannot be added right now."""
    if incident.status == IncidentStatus.CLOSED:
        return "This ticket is closed. Reopen it to add a note."
    return "You can only add notes to tickets you reported or are working on."
