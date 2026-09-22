"""Note endpoints.

Two path shapes, one router: notes are created and listed under the incident
they belong to, and addressed directly once they exist. The second shape is
what an edit or a delete needs — the client has a note id from the timeline and
should not have to remember which ticket it came from.

INTERNAL notes are filtered out for employees by
`services/visibility.apply_note_visibility`, which narrows the **query**. No
route here decides what to hide, so no route here can forget to.
"""

import uuid

from fastapi import APIRouter, status

from app.clock import utc_now
from app.models.note import IncidentNote
from app.models.user import User
from app.schemas.common import DeleteResult
from app.schemas.incident import UserSummary
from app.schemas.note import NoteCreate, NoteRead, NoteUpdate
from app.security.dependencies import CurrentUser, DbSession
from app.services import incident_service
from app.services import notes as service

router = APIRouter(tags=["notes"])


@router.get(
    "/incidents/{incident_id}/notes",
    response_model=list[NoteRead],
    summary="List an incident's notes",
)
def list_notes(incident_id: uuid.UUID, session: DbSession, user: CurrentUser) -> list[NoteRead]:
    """Return the notes on an incident that this caller may read, oldest first."""
    incident = incident_service.get_incident(session, incident_id)
    notes = service.list_notes(session, incident=incident, user=user)
    return [_to_read(note, user) for note in notes]


@router.post(
    "/incidents/{incident_id}/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a note to an incident",
)
def create_note(
    incident_id: uuid.UUID,
    payload: NoteCreate,
    session: DbSession,
    user: CurrentUser,
) -> NoteRead:
    """Add a public or internal note to an incident."""
    incident = incident_service.get_incident(session, incident_id)
    note = service.add_note(session, incident=incident, author=user, payload=payload)
    session.commit()
    return _to_read(note, user)


@router.patch("/notes/{note_id}", response_model=NoteRead, summary="Edit a note")
def update_note(
    note_id: uuid.UUID,
    payload: NoteUpdate,
    session: DbSession,
    user: CurrentUser,
) -> NoteRead:
    """Edit a note's body, within the edit window or as an admin."""
    note = service.get_note(session, note_id, user)
    updated = service.update_note(session, note=note, user=user, payload=payload)
    session.commit()
    return _to_read(updated, user)


@router.delete("/notes/{note_id}", response_model=DeleteResult, summary="Delete a note")
def delete_note(note_id: uuid.UUID, session: DbSession, user: CurrentUser) -> DeleteResult:
    """Soft-delete a note, within the edit window or as an admin.

    Soft because the activity timeline is an audit trail: the note stops being
    readable by anyone, and the events around it keep their order.
    """
    note = service.get_note(session, note_id, user)
    service.delete_note(session, note=note, user=user)
    session.commit()
    return DeleteResult(
        id=note_id,
        deleted=False,
        deactivated=True,
        detail="Note deleted. It no longer appears on the ticket.",
    )


def _to_read(note: IncidentNote, user: User) -> NoteRead:
    """Build the response form of a note for this caller."""
    return NoteRead(
        id=note.id,
        incident_id=note.incident_id,
        author=UserSummary.model_validate(note.author),
        body=note.body,
        visibility=note.visibility,
        created_at=note.created_at,
        edited_at=note.edited_at,
        can_edit=service.can_modify_note(note, user, utc_now()),
    )
