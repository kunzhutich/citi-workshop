"""Who may see which rows.

Three filters, applied to the SQL statement and never to the serialised
result. Filtering in a serializer is the bug this module exists to prevent:
the row still travels from the database into the process, `total` counts it,
paging skips over it, and one forgotten call site leaks it.

Every function takes a `Select` and returns a new one, so they compose with
the user's own filters. The rule is to apply them **first**, before any filter
the caller asked for, so that no code path can build a query that has not been
through here.

`apply_feedback_visibility` is the odd one of the three and worth knowing
about before you read it: the other two decide from the *reader* alone — your
role settles whether you see INTERNAL notes, whatever note it is — whereas who
may read a review depends on **which** review it is, because being the person
it is about is one of the ways in. That is why it is the only one of the three
that compares a column to the caller's id.
"""

from typing import Any

from sqlalchemy import Select, or_

from app.models.enums import EngineerLevel, NoteVisibility, UserRole
from app.models.feedback import IncidentFeedback
from app.models.note import IncidentNote
from app.models.user import User


def apply_note_visibility(statement: Select[Any], user: User) -> Select[Any]:
    """Restrict a note query to the notes this user may read.

    Soft-deleted notes are excluded here too, for every role. A deleted note is
    not "hidden from employees", it is gone from every reading of the ticket,
    and keeping the two exclusions together means no query can remember one and
    forget the other.
    """
    statement = statement.where(IncidentNote.deleted_at.is_(None))

    if user.is_staff:
        return statement
    return statement.where(IncidentNote.visibility == NoteVisibility.PUBLIC)


def apply_incident_visibility(statement: Select[Any], user: User) -> Select[Any]:
    """Restrict an incident query to the incidents this user may read.

    **Every signed-in user may read every incident**, deliberately. The brief
    asks employees to be able to check whether something is already reported
    before reporting it again, which only works if "All Tickets" really is all
    of them. What an employee cannot do is *act* on someone else's ticket —
    that is a permission question, answered by `services/incident_service.py`
    and the `can_*` flags on the detail response, not a visibility one.

    So this returns the statement unchanged today. It exists, and every
    incident query goes through it, because the moment that stops being true —
    per-building admin scoping is the obvious next step, and is already listed
    as a known limitation — it is a change to one function rather than an audit
    of every query in the application.
    """
    del user
    return statement


def apply_feedback_visibility(statement: Select[Any], user: User) -> Select[Any]:
    """Restrict a feedback query to the ratings this user may read.

    A rating is a judgement of one engineer's work, so the audience is drawn
    deliberately narrowly — narrower than INTERNAL notes, which every member
    of staff can read.

    **Everything, for an admin or a LEAD engineer.** These are the two roles
    the owner asked to be able to evaluate the team, and a lead here means
    *any* lead: there is no reporting line in the data model — engineers have
    specialties and a home building and no manager — so "this engineer's lead"
    is not a question the schema can answer yet.

    **Your own, for everybody else**, in either of the two senses. The
    reporter who wrote it may re-read what they said, and the engineer it is
    about may read it in full. Those two are a deliberate pair: an engineer
    sees every word written about them and no word written about a colleague,
    which is what stops a rating becoming gossip while leaving the person
    judged able to answer it.

    **A SENIOR or JUNIOR engineer reading a colleague's ticket sees nothing
    here**, including on the timeline of a ticket they are working on. That is
    the case this function exists for; it is also why the rule cannot live on
    `User.is_staff`, which is what separates the two note visibilities and
    would let every engineer read every review.

    Aggregates are a separate question and do **not** come through here. "This
    engineer averages 4.2" is a number about somebody's work that any engineer
    may see; the sentences behind it are not. See `services/reporting.py`.
    """
    if user.role == UserRole.FACILITY_ADMIN:
        return statement

    profile = user.engineer_profile
    if profile is not None and profile.level == EngineerLevel.LEAD:
        return statement

    return statement.where(
        or_(
            IncidentFeedback.author_id == user.id,
            IncidentFeedback.rated_user_id == user.id,
        )
    )
