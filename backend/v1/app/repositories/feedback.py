"""Reading and writing the ratings reporters leave on repairs.

Every statement that reads feedback is handed out from here **unexecuted**, so
that `services/visibility.apply_feedback_visibility` can narrow it before it
runs. That is the same discipline `notes_query` follows in
`repositories/incidents.py` and it exists for the same reason: if the base
`select(IncidentFeedback)` were built at the point of use, one call site could
forget the filter and the row would travel out of the database before anything
decided whether its reader was allowed it.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app.models.feedback import IncidentFeedback


def feedback_query(incident_id: uuid.UUID) -> Select[tuple[IncidentFeedback]]:
    """Return the base statement for one incident's ratings.

    Callers pass it through `services/visibility.apply_feedback_visibility`
    before executing it.
    """
    return select(IncidentFeedback).where(IncidentFeedback.incident_id == incident_id)


def list_feedback(session: Session, visible: Select[Any]) -> Sequence[IncidentFeedback]:
    """Return ratings oldest first, with both people loaded.

    Both, because a review names two: who wrote it and who it is about. The
    timeline shows the first and `services/visibility.py` has already used the
    second to decide this reader may see the row at all.
    """
    statement = visible.options(
        selectinload(IncidentFeedback.author),
        selectinload(IncidentFeedback.rated_user),
    ).order_by(IncidentFeedback.created_at, IncidentFeedback.id)
    return session.scalars(statement).unique().all()


def one_query(feedback_id: uuid.UUID) -> Select[tuple[IncidentFeedback]]:
    """Return the base statement for one rating, by id.

    Handed out unexecuted for the same reason `feedback_query` is: the caller
    narrows it with `apply_feedback_visibility` and then runs it, so a
    single-row lookup and a list are filtered by the *same* function rather
    than by a list filter and a hand-written copy of it beside the lookup.
    """
    return select(IncidentFeedback).where(IncidentFeedback.id == feedback_id)


def get_one(session: Session, visible: Select[Any]) -> IncidentFeedback | None:
    """Return the single rating a narrowed statement selects, or None."""
    statement = visible.options(
        selectinload(IncidentFeedback.author),
        selectinload(IncidentFeedback.rated_user),
    )
    return session.scalars(statement).unique().one_or_none()


def add(
    session: Session,
    *,
    incident_id: uuid.UUID,
    author_id: uuid.UUID,
    rated_user_id: uuid.UUID,
    resolution_round: int,
    rating: int,
    comment: str,
) -> uuid.UUID | None:
    """Insert a rating. Returns its id, or None if this repair already has one.

    `ON CONFLICT DO NOTHING` rather than a read followed by an insert, for the
    reason `repositories/incidents.add_watcher` gives about the same shape:
    the unique constraint already says one rating per repair, and this is the
    statement that says the same thing without a window between the check and
    the write for a double-clicked dialog to land in.

    Returning None rather than raising keeps the *wording* of the refusal in
    the service, beside the three other reasons a rating can be turned away.
    """
    statement = (
        insert(IncidentFeedback)
        .values(
            incident_id=incident_id,
            author_id=author_id,
            rated_user_id=rated_user_id,
            resolution_round=resolution_round,
            rating=rating,
            comment=comment,
        )
        .on_conflict_do_nothing(index_elements=["incident_id", "resolution_round"])
        .returning(IncidentFeedback.id)
    )
    return session.scalars(statement).one_or_none()
