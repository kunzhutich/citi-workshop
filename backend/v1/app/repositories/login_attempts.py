"""Queries over the failed-login counter.

The rule — how many failures in how long — is in
``app.services.auth_service``. This module only knows how to count.
"""

from datetime import datetime

from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.login_attempt import LoginAttempt


def get(session: Session, email: str) -> LoginAttempt | None:
    """Return the current failure window for this address, if there is one.

    ``login_attempts.email`` is ``CITEXT``, so this is case-insensitive in the
    database and does not depend on the caller having normalised first.
    """
    return session.scalars(select(LoginAttempt).where(LoginAttempt.email == email)).one_or_none()


def record_failure(
    session: Session,
    email: str,
    *,
    now: datetime,
    window_start: datetime,
) -> LoginAttempt:
    """Add one failure for this address and return the window it now sits in.

    A single ``INSERT … ON CONFLICT DO UPDATE``, not a read-then-write, so two
    simultaneous failed logins for the same address cannot both read "9" and
    both write "10". PostgreSQL takes a row lock for the duration of the
    statement; the count is exact under concurrency.

    The window is *fixed*, not sliding: a failure lands in the existing window
    if that window began after ``window_start``, and otherwise opens a new one
    starting now. So an address locked at 10:00 is free again at 10:15 no
    matter how many attempts arrived in between — hammering it cannot extend
    its own lockout, which a sliding window would allow.

    In the ``SET`` clause a bare column reference means the **existing** row's
    value. ``excluded.*`` would mean the row we tried to insert, which is
    always a fresh window and would defeat the whole expression.
    """
    window_is_live = LoginAttempt.first_failure_at > window_start

    statement = (
        insert(LoginAttempt)
        .values(email=email, failure_count=1, first_failure_at=now, last_failure_at=now)
        .on_conflict_do_update(
            index_elements=[LoginAttempt.email],
            set_={
                "failure_count": case(
                    (window_is_live, LoginAttempt.failure_count + 1),
                    else_=1,
                ),
                "first_failure_at": case(
                    (window_is_live, LoginAttempt.first_failure_at),
                    else_=now,
                ),
                "last_failure_at": now,
            },
        )
        .returning(LoginAttempt)
    )
    return session.scalars(statement).one()


def clear(session: Session, email: str) -> None:
    """Forget this address's failures. Called when a sign-in succeeds."""
    session.execute(delete(LoginAttempt).where(LoginAttempt.email == email))


def purge_expired(session: Session, *, window_start: datetime) -> int:
    """Delete every window that has already expired. Returns how many went.

    Called on the failure path, which is the only path that inserts, so the
    table cleans itself: it holds the addresses that failed within the last
    window and nothing else.

    A background sweeper would be the conventional answer and is not available
    here. Aurora Serverless v2 runs at ``min_capacity = 0`` and sleeps when
    idle, so a scheduled job would have to wake the cluster on a timer for the
    sole purpose of deleting rows nobody is reading — which costs more than the
    rows do. The delete is unbounded rather than batched because the upper
    bound on what it can find is "distinct addresses that failed a login since
    the last failed login", and at this application's scale that is small.
    """
    result = session.execute(
        delete(LoginAttempt).where(LoginAttempt.first_failure_at <= window_start)
    )
    return result.rowcount or 0
