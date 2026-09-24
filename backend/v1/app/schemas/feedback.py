"""Request and response models for the rating a reporter leaves on a repair.

The bounds here are a **mirror**, not the decision. `rating` is held between
1 and 5 by a check constraint in the database and `comment` is NOT NULL there;
what these types add is that the client is told which it got wrong, in a 422,
instead of a driver-level integrity error. See `app/models/feedback.py`.
"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.schemas.incident import UserSummary

#: The scale, low to high. Not an enum for the reason the column is not one:
#: every reader of a rating is an aggregate, and a mean of five words is not a
#: thing PostgreSQL will compute.
MIN_RATING = 1
MAX_RATING = 5

Rating = Annotated[int, Field(ge=MIN_RATING, le=MAX_RATING)]

#: Long enough for a paragraph, capped like a note's body so one field cannot
#: carry an essay into a timeline entry. The minimum is what makes the comment
#: mandatory rather than merely present.
FeedbackComment = Annotated[str, StringConstraints(min_length=1, max_length=2000)]


class FeedbackCreate(BaseModel):
    """A new rating of the work on a ticket.

    There is no `rated_user_id` field, and there must never be one. Who a
    rating is about is read from `Incident.resolved_by_id` by
    `services/feedback.py`; a caller who could name the engineer could move a
    bad review onto a colleague.

    There is no `resolution_round` field either, for the same reason: which
    repair is being rated is a fact about the ticket, not the reporter's to
    choose.
    """

    rating: Rating = Field(description=f"{MIN_RATING} to {MAX_RATING}, low to high.")
    comment: FeedbackComment = Field(
        description="Why. Required on every rating, not only on low ones.",
    )

    @field_validator("comment")
    @classmethod
    def _strip_comment(cls, value: str) -> str:
        """Trim the comment, so whitespace alone cannot pass the minimum length."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class FeedbackUpdate(BaseModel):
    """A correction to a rating, within the edit window.

    Both fields, not either: a rating and the sentence explaining it are one
    statement, and letting the number move while the words stayed would leave
    a row that contradicts itself.
    """

    rating: Rating
    comment: FeedbackComment

    @field_validator("comment")
    @classmethod
    def _strip_comment(cls, value: str) -> str:
        """Trim the comment, so whitespace alone cannot pass the minimum length."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class FeedbackRead(BaseModel):
    """One rating, as the ticket timeline and the reviews list show it.

    A row that reaches a client is one that client may read — the filtering is
    done in the query by `services/visibility.apply_feedback_visibility`, so
    there is no field here that a serializer has to remember to blank.
    """

    id: uuid.UUID
    incident_id: uuid.UUID
    author: UserSummary
    rated_user: UserSummary
    resolution_round: int = Field(
        description="Which repair this rates: 1 for the first, 2 after one reopen.",
    )
    rating: int
    comment: str
    created_at: datetime
    edited_at: datetime | None = Field(
        default=None,
        description="Set only when the author corrected it inside the edit window.",
    )
    can_edit: bool = Field(description="Whether the caller may still change this rating.")
