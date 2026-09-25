"""Feedback endpoints: the rating a reporter leaves on a repair.

Two path shapes, one router, and the same split `app/routers/notes.py` uses:
ratings are created and listed under the ticket they belong to, and addressed
directly once they exist — a client correcting one has its id from the
timeline and should not have to remember which ticket it came from.

Who may read a rating is decided by
`services/visibility.apply_feedback_visibility`, which narrows the **query**.
No route here decides what to hide, so no route here can forget to. There is
deliberately no `DELETE`; see `services/feedback.py`.
"""

import uuid

from fastapi import APIRouter, status

from app.clock import utc_now
from app.models.feedback import IncidentFeedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate, FeedbackRead, FeedbackUpdate
from app.schemas.incident import UserSummary
from app.security.dependencies import CurrentUser, DbSession
from app.services import feedback as service
from app.services import incident_service

router = APIRouter(tags=["feedback"])


@router.get(
    "/incidents/{incident_id}/feedback",
    response_model=list[FeedbackRead],
    summary="List the ratings on an incident",
)
def list_feedback(
    incident_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
) -> list[FeedbackRead]:
    """Return the ratings on this ticket that this caller may read, oldest first.

    An empty list is the ordinary answer and means two different things that
    this endpoint deliberately does not distinguish: nobody has rated the
    work, or somebody has and it is not yours to read. Saying which would
    leak the second.
    """
    incident = incident_service.get_incident(session, incident_id)
    ratings = service.list_for_incident(session, incident=incident, user=user)
    return [_to_read(entry, user) for entry in ratings]


@router.post(
    "/incidents/{incident_id}/feedback",
    response_model=FeedbackRead,
    status_code=status.HTTP_201_CREATED,
    summary="Rate the work on an incident",
)
def create_feedback(
    incident_id: uuid.UUID,
    payload: FeedbackCreate,
    session: DbSession,
    user: CurrentUser,
) -> FeedbackRead:
    """Record the reporter's rating of this ticket's current repair.

    Refused with 403 `FEEDBACK_NOT_PERMITTED` for anybody but the reporter,
    and with a 409 naming which of the three other conditions failed — the
    work is not resolved, the window has closed, or this repair has already
    been rated. See `services/feedback.py`, which owns all four.
    """
    incident = incident_service.get_incident(session, incident_id)
    feedback = service.submit(session, incident=incident, author=user, payload=payload)
    session.commit()
    return _to_read(feedback, user)


@router.patch(
    "/feedback/{feedback_id}",
    response_model=FeedbackRead,
    summary="Correct a rating within the edit window",
)
def update_feedback(
    feedback_id: uuid.UUID,
    payload: FeedbackUpdate,
    session: DbSession,
    user: CurrentUser,
) -> FeedbackRead:
    """Change a rating's score and comment, within fifteen minutes of leaving it.

    `get_feedback` answers 404 for a rating this caller may not read, so a
    stranger probing ids learns nothing, and the author-only check in
    `services/feedback.can_modify` then answers 403 for one they may read but
    may not change — an engineer looking at their own review.
    """
    feedback = service.get_feedback(session, feedback_id, user)
    updated = service.update(session, feedback=feedback, user=user, payload=payload)
    session.commit()
    return _to_read(updated, user)


def _to_read(feedback: IncidentFeedback, user: User) -> FeedbackRead:
    """Build the response form of a rating for this caller."""
    return FeedbackRead(
        id=feedback.id,
        incident_id=feedback.incident_id,
        author=UserSummary.model_validate(feedback.author),
        rated_user=UserSummary.model_validate(feedback.rated_user),
        resolution_round=feedback.resolution_round,
        rating=feedback.rating,
        comment=feedback.comment,
        created_at=feedback.created_at,
        edited_at=feedback.edited_at,
        can_edit=service.can_modify(feedback, user, utc_now()),
    )
