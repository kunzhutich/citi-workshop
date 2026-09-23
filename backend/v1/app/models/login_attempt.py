"""Failed sign-in attempts, counted per email address."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LoginAttempt(Base):
    """The run of consecutive failed logins for one email address.

    One row per email, not one row per attempt. A row is the *current window*:
    when it started, how many failures are in it, and when the last one
    happened. That is all the lockout rule needs, and it means a
    credential-stuffing run against one address costs one row rather than one
    row per guess.

    **The primary key is the email**, the way ``engineer_profiles`` keys on
    ``user_id``: there is no identity here beyond the address the attempts were
    against, and a surrogate id would only make it possible to have two
    counters for one address. It is ``CITEXT``, matching ``users.email``, so
    that varying the capitalisation cannot buy a second allowance.

    **There is deliberately no foreign key to ``users``.** Attempts against an
    address that has no account are counted exactly like attempts against one
    that does — that is the whole point, and a foreign key would make it
    impossible. See ``app.services.auth_service`` for the rule.

    No ``TimestampMixin``: ``first_failure_at`` and ``last_failure_at`` *are*
    this row's created and updated times, and saying so in domain words is
    better than inheriting two generic columns that mean the same thing.
    """

    __tablename__ = "login_attempts"

    email: Mapped[str] = mapped_column(CITEXT, primary_key=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    #: When the current window opened. The lockout expires relative to this,
    #: not to the last attempt, so hammering an address cannot extend its own
    #: lockout indefinitely — fifteen minutes after the first failure the
    #: counter starts again, whatever happened in between.
    first_failure_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        # Indexed for the self-cleaning delete, which is the only query that
        # ranges over this column. Every failed login removes the windows that
        # have expired; see `repositories/login_attempts.py::purge_expired`.
        index=True,
    )
    #: Kept for the operator reading the table, not used by the rule.
    last_failure_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
