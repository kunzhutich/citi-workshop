"""The one place the application asks what time it is.

Every timestamp the domain writes — `assigned_at`, `resolved_at`, the 15-minute
note edit window, the 7-day reopen window — is read from here, and every
service that needs one accepts it as a parameter with this as the default::

    def perform_transition(..., *, now: datetime | None = None) -> Incident:
        moment = now or utc_now()

That shape is what makes the time-sensitive rules testable. A test that needs a
ticket closed eight days ago passes `now=` explicitly rather than sleeping,
freezing the clock globally, or monkeypatching a module it does not own.

Always timezone-aware UTC. `datetime.utcnow()` returns a *naive* datetime whose
value happens to be UTC, which compares wrongly against every aware value in
the schema; it is deprecated in Python 3.12+ for exactly that reason.
"""

from datetime import UTC, datetime


def utc_now() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(UTC)
