"""Who may see which rows.

Two filters, applied to the SQL statement and never to the serialised result.
Filtering in a serializer is the bug this module exists to prevent: the row
still travels from the database into the process, `total` counts it, paging
skips over it, and one forgotten call site leaks it.

Both functions take a `Select` and return a new one, so they compose with the
user's own filters. The rule is to apply them **first**, before any filter the
caller asked for, so that no code path can build a query that has not been
through here.
"""

from typing import Any

from sqlalchemy import Select

from app.models.enums import NoteVisibility
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
