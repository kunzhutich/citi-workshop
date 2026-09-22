"""Access tokens (JWT) and refresh tokens (opaque, hashed at rest).

Two different mechanisms on purpose:

* The **access token** is a short-lived, stateless JWT. It is never stored
  server-side, so checking it costs no database round trip. Fifteen minutes
  caps the damage if one leaks.
* The **refresh token** is a long-lived opaque random string whose SHA-256
  hash is stored in ``refresh_tokens``. Being stateful, it can be revoked —
  which is the whole point of having it.

The access token carries ``role`` for convenience, but authorisation never
trusts it: ``security/dependencies.py`` loads the user, and engineer level, from
the database on every request. A role changed by an admin therefore takes
effect immediately rather than after the current token expires.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.config import get_settings
from app.models.enums import UserRole

#: Signing algorithm. Symmetric because one service both issues and verifies.
JWT_ALGORITHM = "HS256"

#: How long an access token stays valid.
ACCESS_TOKEN_TTL = timedelta(minutes=15)

#: How long a refresh token stays valid, absent rotation.
REFRESH_TOKEN_TTL = timedelta(days=7)

#: Distinguishes an access token from anything else signed with the same key.
ACCESS_TOKEN_TYPE = "access"  # nosec B105 - a claim value, not a credential

#: Bytes of entropy in a refresh token before URL-safe encoding.
REFRESH_TOKEN_BYTES = 32


class InvalidTokenError(Exception):
    """Raised when an access token is missing, malformed, expired or wrong-typed."""


@dataclass(frozen=True)
class AccessTokenClaims:
    """The claims we put in, and read back out of, an access token."""

    user_id: uuid.UUID
    role: UserRole
    issued_at: datetime
    expires_at: datetime


def create_access_token(
    user_id: uuid.UUID,
    role: UserRole,
    *,
    now: datetime | None = None,
) -> str:
    """Sign a new access token for `user_id`.

    `now` is injectable so tests can produce an already-expired token without
    sleeping.
    """
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + ACCESS_TOKEN_TTL
    payload = {
        "sub": str(user_id),
        "role": role.value,
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, get_settings().jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> AccessTokenClaims:
    """Verify `token` and return its claims, or raise `InvalidTokenError`."""
    try:
        payload = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise InvalidTokenError("Token is not an access token.")

    try:
        user_id = uuid.UUID(str(payload["sub"]))
        role = UserRole(payload["role"])
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError("Token claims are malformed.") from exc

    return AccessTokenClaims(
        user_id=user_id,
        role=role,
        issued_at=datetime.fromtimestamp(payload["iat"], UTC),
        expires_at=datetime.fromtimestamp(payload["exp"], UTC),
    )


def generate_refresh_token() -> tuple[str, str]:
    """Return a new ``(raw_token, token_hash)`` pair.

    The raw value goes to the browser in an HttpOnly cookie and is never
    stored; only the hash is persisted.
    """
    raw = secrets.token_urlsafe(REFRESH_TOKEN_BYTES)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw_token: str) -> str:
    """Return the SHA-256 hex digest used to look a refresh token up.

    Plain SHA-256 rather than bcrypt is correct here: the token is 32 bytes of
    cryptographic randomness, not a guessable human secret, so there is nothing
    for a slow hash to defend against — and lookup must be an indexed equality
    match, which a salted hash cannot do.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def refresh_token_expiry(now: datetime | None = None) -> datetime:
    """Return the absolute expiry for a refresh token issued now."""
    return (now or datetime.now(UTC)) + REFRESH_TOKEN_TTL
