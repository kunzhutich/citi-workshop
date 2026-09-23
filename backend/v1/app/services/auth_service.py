"""Registration, login, session rotation and password changes.

Every rule about *who may hold an account* and *how a session behaves* lives
here. Routers validate shapes and call in; they decide nothing.
"""

import logging
import math
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import AuthenticationError, ConflictError, RateLimitError, ValidationError
from app.models.enums import UserRole
from app.models.user import User
from app.repositories import login_attempts as login_attempt_repository
from app.repositories import users as user_repository
from app.security.passwords import hash_password, verify_password
from app.security.tokens import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    refresh_token_expiry,
)

logger = logging.getLogger(__name__)

#: The only domain allowed to self-register. Compared for exact equality, which
#: is what rejects `sub.acme.inc` and `acme.inc.evil.com` alike.
ALLOWED_EMAIL_DOMAIN = "acme.inc"

#: Local part of an address: the common subset of RFC 5322 that real addresses
#: use. Deliberately conservative — this is a corporate directory, not a
#: general-purpose mail validator.
LOCAL_PART_PATTERN = re.compile(
    r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$"
)

#: Longest local part permitted by RFC 5321.
MAX_LOCAL_PART_LENGTH = 64

#: Length of a generated temporary password, in URL-safe characters.
TEMPORARY_PASSWORD_BYTES = 12


#: How many consecutive failed sign-ins an email address may accumulate before
#: it is refused outright.
MAX_FAILED_LOGIN_ATTEMPTS = 10

#: How long that run has to happen in, and how long the refusal then lasts.
#: Measured from the *first* failure in the run, so an address is free again
#: fifteen minutes after its first bad guess however many followed it.
LOGIN_LOCKOUT_WINDOW = timedelta(minutes=15)


def normalise_email(raw_email: str) -> str:
    """Return the canonical form of an ACME address, or raise `ValidationError`.

    The rules, in order:

    1. Trim surrounding whitespace and lowercase the whole address.
    2. Split on the **last** ``@``. RFC 5321 puts the domain after the final
       ``@``, and parsers that split on the first one can be walked past with
       an address like ``victim@acme.inc@attacker.com``.
    3. Reject anything whose local part still contains an ``@``. Together with
       rule 2 this means exactly one ``@`` is allowed, which removes the
       first-versus-last ambiguity entirely rather than merely picking a side.
    4. The domain must equal ``acme.inc`` exactly. Equality — not ``endswith``,
       not a regex — is what rejects ``sub.acme.inc``, ``acme.inc.evil.com``
       and homograph lookalikes in one stroke.
    """
    email = raw_email.strip().lower()

    if "@" not in email:
        raise ValidationError(
            "Enter a valid email address.",
            code="INVALID_EMAIL",
            field="email",
        )

    local_part, _, domain = email.rpartition("@")

    if "@" in local_part:
        raise ValidationError(
            "Enter a valid email address.",
            code="INVALID_EMAIL",
            field="email",
        )

    if not local_part or len(local_part) > MAX_LOCAL_PART_LENGTH:
        raise ValidationError(
            "Enter a valid email address.",
            code="INVALID_EMAIL",
            field="email",
        )

    if not LOCAL_PART_PATTERN.match(local_part):
        raise ValidationError(
            "Enter a valid email address.",
            code="INVALID_EMAIL",
            field="email",
        )

    if domain != ALLOWED_EMAIL_DOMAIN:
        raise ValidationError(
            f"Registration is open to @{ALLOWED_EMAIL_DOMAIN} addresses only.",
            code="INVALID_EMAIL_DOMAIN",
            field="email",
        )

    return email


def register_employee(session: Session, *, email: str, full_name: str, password: str) -> User:
    """Create a self-registered EMPLOYEE account.

    The role is hardcoded, never read from the request: a client that sends
    ``{"role": "FACILITY_ADMIN"}`` gets an employee like everyone else, because
    ``RegisterRequest`` has no such field to begin with.
    """
    normalised = normalise_email(email)

    if user_repository.email_exists(session, normalised):
        raise ConflictError(
            "An account with that email already exists.",
            code="EMAIL_TAKEN",
            field="email",
        )

    user = User(
        email=normalised,
        full_name=full_name.strip(),
        password_hash=hash_password(password),
        role=UserRole.EMPLOYEE,
        is_active=True,
        must_change_password=False,
    )
    session.add(user)
    session.flush()
    logger.info("Registered employee %s", user.id)
    return user


def authenticate(
    session: Session,
    *,
    email: str,
    password: str,
    now: datetime | None = None,
) -> User:
    """Return the user matching these credentials, or raise.

    One message covers an unknown email, a wrong password and a deactivated
    account, so the endpoint cannot be used to discover who has an account.
    The password is verified even when no user was found, so the response time
    does not leak the answer either.

    After :data:`MAX_FAILED_LOGIN_ATTEMPTS` failures within
    :data:`LOGIN_LOCKOUT_WINDOW`, the address is refused with a 429 until the
    window expires — **including when the password is finally right**, which is
    what makes the lockout worth having rather than a speed bump.

    Two things about counting deserve to be said out loud, because both look
    like bugs until you see what they are for:

    *Attempts against an address with no account are counted the same way.*
    The counter is keyed on the submitted address, not on a user row, and the
    check runs before the lookup. So guessing at ``nobody@acme.inc`` locks out
    exactly as guessing at a real colleague does, and the 429 says nothing
    about whether anybody holds that address. A lockout that only applied to
    real accounts would be a membership oracle with a rate limit attached.

    *Every rejected sign-in counts, including a correct password for a
    deactivated account.* Not because that attempt was a guess, but because one
    rule with no branches is the thing that keeps the endpoint uninformative:
    an attacker who could tell "counted" from "not counted" would have learned
    which of the three refusals they got.

    The cost is real and is accepted: anybody can lock a colleague's address
    for fifteen minutes by failing ten logins against it. Keying on the client
    address instead would trade that for a worse problem — the Function URL is
    publicly reachable, so ``X-Forwarded-For`` is attacker-controlled and would
    make the lockout bypassable rather than merely annoying. The window is
    short, self-clearing and needs no administrator to undo.
    """
    moment = now or utc_now()
    window_start = moment - LOGIN_LOCKOUT_WINDOW
    # `users.email` is CITEXT so the lookup would be case-insensitive anyway;
    # this normalises the *counter* key, which `login_attempts.email` being
    # CITEXT likewise protects. Belt and braces, and it matches what the rest
    # of the file means by an email address.
    lookup_email = email.strip().lower()

    _require_not_locked_out(session, lookup_email, now=moment, window_start=window_start)

    failure = AuthenticationError("Incorrect email or password.", code="INVALID_CREDENTIALS")

    user = user_repository.get_by_email(session, lookup_email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        _record_failed_login(session, lookup_email, now=moment, window_start=window_start)
        raise failure

    if not verify_password(password, user.password_hash):
        _record_failed_login(session, lookup_email, now=moment, window_start=window_start)
        raise failure

    if not user.is_active:
        _record_failed_login(session, lookup_email, now=moment, window_start=window_start)
        raise failure

    login_attempt_repository.clear(session, lookup_email)
    user.last_login_at = moment
    session.flush()
    return user


def _require_not_locked_out(
    session: Session,
    email: str,
    *,
    now: datetime,
    window_start: datetime,
) -> None:
    """Refuse the sign-in outright if this address is inside a lockout.

    Checked before the user lookup and before any password verification, so a
    locked address costs one indexed read rather than a bcrypt comparison. That
    makes a locked response measurably faster than an unlocked one, and that is
    fine: the response says it is locked, so its timing reveals nothing the
    body does not.
    """
    attempt = login_attempt_repository.get(session, email)
    if attempt is None:
        return
    if attempt.first_failure_at <= window_start:
        # The window has expired. The row is stale and the next failure will
        # overwrite it; `purge_expired` removes it either way.
        return
    if attempt.failure_count < MAX_FAILED_LOGIN_ATTEMPTS:
        return

    unlocks_at = attempt.first_failure_at + LOGIN_LOCKOUT_WINDOW
    retry_after = max(1, math.ceil((unlocks_at - now).total_seconds()))
    logger.warning(
        "Refused a sign-in for a locked address",
        extra={"failure_count": attempt.failure_count, "retry_after_seconds": retry_after},
    )
    raise RateLimitError(
        "Too many failed sign-in attempts. Try again in a few minutes.",
        code="TOO_MANY_LOGIN_ATTEMPTS",
        retry_after_seconds=retry_after,
    )


def _record_failed_login(
    session: Session,
    email: str,
    *,
    now: datetime,
    window_start: datetime,
) -> None:
    """Count one failure against this address, and commit it.

    **Committed here, not flushed**, for the same reason `rotate_session`
    commits its mass revocation: the request is about to raise, so the router
    never reaches its own `session.commit()` and `get_db` closes the session
    without one — which would roll the count straight back and make the lockout
    unreachable. A counter that only survives successful requests counts
    nothing.

    The expired windows are purged in the same transaction. The failure path is
    the only path that inserts, so this is where the table gets to tidy itself;
    see `repositories/login_attempts.py::purge_expired` for why there is no
    sweeper.
    """
    login_attempt_repository.purge_expired(session, window_start=window_start)
    attempt = login_attempt_repository.record_failure(
        session, email, now=now, window_start=window_start
    )
    session.commit()

    if attempt.failure_count == MAX_FAILED_LOGIN_ATTEMPTS:
        # Logged once, as the address crosses the line, rather than on every
        # attempt after it. The address itself is not logged: it is a
        # credential half, and often somebody real.
        logger.warning(
            "An email address reached the failed sign-in limit and is locked",
            extra={
                "failure_count": attempt.failure_count,
                "locked_until": attempt.first_failure_at + LOGIN_LOCKOUT_WINDOW,
            },
        )


def issue_session(session: Session, user: User) -> tuple[str, str, datetime]:
    """Mint an access token and a refresh token for `user`.

    Returns ``(access_token, raw_refresh_token, refresh_expiry)``. Only the
    hash of the refresh token is stored; the raw value is handed straight to
    the cookie.
    """
    access_token = create_access_token(user.id, user.role)
    raw_refresh, token_hash = generate_refresh_token()
    expires_at = refresh_token_expiry()
    user_repository.add_refresh_token(
        session,
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    return access_token, raw_refresh, expires_at


def rotate_session(session: Session, raw_refresh_token: str) -> tuple[User, str, str, datetime]:
    """Exchange a refresh token for a new pair, revoking the old one.

    Returns ``(user, access_token, raw_refresh_token, refresh_expiry)``.

    Presenting an **already revoked** token revokes every live token for that
    user. A valid-looking but spent token means either the cookie was stolen
    and replayed or the legitimate client raced itself; in both cases ending
    all sessions is the safe response, and it turns silent theft into a visible
    logout.
    """
    failure = AuthenticationError(
        "Your session has expired. Please sign in again.", code="INVALID_REFRESH_TOKEN"
    )

    stored = user_repository.get_refresh_token(session, hash_refresh_token(raw_refresh_token))
    if stored is None:
        raise failure

    now = datetime.now(UTC)

    if stored.revoked_at is not None:
        revoked = user_repository.revoke_all_refresh_tokens(session, stored.user_id, now=now)
        # Committed here, not flushed. This request is about to fail, so the
        # router never reaches its own `session.commit()` and `get_db` closes
        # the session without one — which would roll the revocation straight
        # back. Ending every session is a security response to a replayed
        # token, so it has to outlive the request that triggered it. This is
        # the one place a service commits on its own.
        session.commit()
        logger.warning(
            "Refresh token reuse detected for user %s; revoked %d active session(s)",
            stored.user_id,
            revoked,
        )
        raise failure

    if stored.expires_at <= now:
        raise failure

    user = user_repository.get_by_id(session, stored.user_id)
    if user is None or not user.is_active:
        raise failure

    user_repository.revoke_refresh_token(stored, now=now)
    access_token, raw_refresh, expires_at = issue_session(session, user)
    session.flush()
    return user, access_token, raw_refresh, expires_at


def revoke_session(session: Session, raw_refresh_token: str | None) -> None:
    """Revoke the refresh token behind the current session, if there is one.

    Logging out is never an error: an absent or unknown cookie simply means
    there is nothing to revoke.
    """
    if not raw_refresh_token:
        return

    stored = user_repository.get_refresh_token(session, hash_refresh_token(raw_refresh_token))
    if stored is None or stored.revoked_at is not None:
        return

    user_repository.revoke_refresh_token(stored)
    session.flush()


def change_password(
    session: Session, user: User, *, current_password: str, new_password: str
) -> None:
    """Replace a user's password, proving they know the current one.

    Clears ``must_change_password`` and revokes every other session: a password
    change should end any session an attacker may already hold.
    """
    if not verify_password(current_password, user.password_hash):
        raise ValidationError(
            "Your current password is incorrect.",
            code="INVALID_CURRENT_PASSWORD",
            field="current_password",
        )

    if current_password == new_password:
        raise ValidationError(
            "Choose a password you have not used before.",
            code="PASSWORD_UNCHANGED",
            field="new_password",
        )

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user_repository.revoke_all_refresh_tokens(session, user.id)
    session.flush()
    logger.info("Password changed for user %s", user.id)


def seed_first_admin(
    session: Session,
    *,
    email: str,
    full_name: str,
    password: str | None,
) -> dict[str, Any]:
    """Create the bootstrap FACILITY_ADMIN account.

    Called only by the ``seed_admin`` ops action. Idempotent: if the address is
    already taken the existing account is left exactly as it is.

    When no password is supplied one is generated and returned **once**, in the
    invoke response. It is never logged and never stored in plain text, and the
    account is flagged ``must_change_password`` so it cannot stay in use.
    """
    normalised = normalise_email(email)
    existing = user_repository.get_by_email(session, normalised)

    if existing is not None:
        return {
            "created": False,
            "detail": "An account with that email already exists; left unchanged.",
            "user_id": str(existing.id),
            "role": existing.role.value,
        }

    generated = password is None
    raw_password = password or secrets.token_urlsafe(TEMPORARY_PASSWORD_BYTES)

    admin = User(
        email=normalised,
        full_name=full_name.strip() or "Facility Admin",
        password_hash=hash_password(raw_password),
        role=UserRole.FACILITY_ADMIN,
        is_active=True,
        # Always true: a password that has travelled through an invoke payload
        # or a CloudWatch-adjacent response is not a password to keep.
        must_change_password=True,
    )
    session.add(admin)
    session.flush()
    logger.info("Seeded first facility admin %s", admin.id)

    result: dict[str, Any] = {
        "created": True,
        "user_id": str(admin.id),
        "email": admin.email,
        "role": admin.role.value,
        "must_change_password": True,  # nosec B105 - a flag, not a credential
    }
    if generated:
        result["temporary_password"] = raw_password
        result["detail"] = "Temporary password shown once. Change it at first sign-in."
    return result


def _build_dummy_hash() -> str:
    """Hash a throwaway value once, to compare against when no user exists."""
    return hash_password(secrets.token_urlsafe(16))


#: Compared against when the email is unknown, so that a failed login costs the
#: same time whether or not the account exists.
_DUMMY_HASH = _build_dummy_hash()


def user_id_from_string(raw: str) -> uuid.UUID | None:
    """Parse a user id, returning None rather than raising on malformed input."""
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None
