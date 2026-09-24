"""Subscribing yourself to somebody else's ticket: "I'm affected too".

Three rules, and all three of them are here.

**You subscribe yourself.** Every function takes the caller and writes a row
for the caller. There is no "add somebody else" — not as an admin power
either — because a subscription is a statement about who is affected, and
only the person affected can make it. The endpoints have no `user_id` field
for that reason, which is a stronger guarantee than checking one.

**Only where the subcategory allows it.** `categories.allows_watchers` is the
whole point of the flag and it is enforced here, on the API, not merely hidden
in the UI: a personal problem — a laptop that will not charge, an account
locked out — must not acquire an audience because somebody found the endpoint.
The refusal is a 409 rather than a 403: nothing about the *caller* is wrong,
it is the ticket that is not the kind of thing anybody may follow.

**Both directions are idempotent.** Subscribing twice is one row, because the
table is keyed on the pair; unsubscribing from a ticket you were not following
is a no-op. Both answer with the same `WatchStatus`, so a button that got out
of step with the server is corrected by using it rather than by reloading.

Who is *notified* is not here. That is `app/notifications.py`, which reads the
watcher list as an audience — see its WATCHED_RESOLVED rule.
"""

from sqlalchemy.orm import Session

from app.errors import ConflictError
from app.models.incident import Incident
from app.models.user import User
from app.repositories import incidents as repository
from app.schemas.incident import WatchStatus


def status_of(incident: Incident, user: User) -> WatchStatus:
    """Return where this caller stands on this ticket's watch list.

    Reads the `watchers` collection that `repositories/incidents` eager-loads,
    so it costs nothing and — more usefully — the count on the detail response
    and the count returned by the two endpoints below are computed by the same
    three lines. Two implementations of "how many" is how a button ends up
    saying 3 next to a list of 4.
    """
    return WatchStatus(
        watching=any(watcher.user_id == user.id for watcher in incident.watchers),
        watcher_count=len(incident.watchers),
    )


def watch(session: Session, *, incident: Incident, user: User) -> WatchStatus:
    """Subscribe the caller to this incident. The caller commits."""
    _require_a_shared_subcategory(incident)

    repository.add_watcher(session, incident_id=incident.id, user_id=user.id)
    return status_of(repository.reload(session, incident), user)


def unwatch(session: Session, *, incident: Incident, user: User) -> WatchStatus:
    """Unsubscribe the caller from this incident. The caller commits.

    Deliberately **not** gated on `allows_watchers`. An admin who marks a
    subcategory personal after people have subscribed to a ticket under it
    must not leave them unable to get out; the flag governs joining, and
    leaving is always allowed.
    """
    repository.remove_watcher(session, incident_id=incident.id, user_id=user.id)
    return status_of(repository.reload(session, incident), user)


def _require_a_shared_subcategory(incident: Incident) -> None:
    """Raise unless this ticket's subcategory is one other people may follow."""
    if not incident.category.allows_watchers:
        raise ConflictError(
            "This kind of problem is personal to the person who reported it, "
            "so it cannot be followed.",
            code="WATCHERS_NOT_ALLOWED",
        )
