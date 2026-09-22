"""Access and refresh token mechanics."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.models.enums import UserRole
from app.security.tokens import (
    ACCESS_TOKEN_TTL,
    JWT_ALGORITHM,
    REFRESH_TOKEN_TTL,
    AccessTokenClaims,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_refresh_token,
    refresh_token_expiry,
)


def test_access_token_round_trips() -> None:
    user_id = uuid.uuid4()

    claims = decode_access_token(create_access_token(user_id, UserRole.ENGINEER))

    assert isinstance(claims, AccessTokenClaims)
    assert claims.user_id == user_id
    assert claims.role == UserRole.ENGINEER
    assert claims.expires_at - claims.issued_at == ACCESS_TOKEN_TTL


def test_access_token_expires_after_fifteen_minutes() -> None:
    assert timedelta(minutes=15) == ACCESS_TOKEN_TTL


def test_expired_access_token_is_rejected() -> None:
    """`now` is injectable so this needs no sleeping and no clock patching."""
    issued = datetime.now(UTC) - ACCESS_TOKEN_TTL - timedelta(seconds=1)
    token = create_access_token(uuid.uuid4(), UserRole.EMPLOYEE, now=issued)

    with pytest.raises(InvalidTokenError):
        decode_access_token(token)


def test_token_signed_with_another_key_is_rejected() -> None:
    payload = {
        "sub": str(uuid.uuid4()),
        "role": "FACILITY_ADMIN",
        "type": "access",
        "iat": int(datetime.now(UTC).timestamp()),
        "exp": int((datetime.now(UTC) + ACCESS_TOKEN_TTL).timestamp()),
    }
    forged = jwt.encode(payload, "not-the-real-secret", algorithm=JWT_ALGORITHM)

    with pytest.raises(InvalidTokenError):
        decode_access_token(forged)


def test_unsigned_token_is_rejected() -> None:
    """The 'none' algorithm must never be accepted."""
    payload = {
        "sub": str(uuid.uuid4()),
        "role": "FACILITY_ADMIN",
        "type": "access",
        "iat": int(datetime.now(UTC).timestamp()),
        "exp": int((datetime.now(UTC) + ACCESS_TOKEN_TTL).timestamp()),
    }
    unsigned = jwt.encode(payload, key="", algorithm="none")

    with pytest.raises(InvalidTokenError):
        decode_access_token(unsigned)


def test_token_of_the_wrong_type_is_rejected() -> None:
    """A token signed with our key but not marked as an access token is refused."""
    payload = {
        "sub": str(uuid.uuid4()),
        "role": "EMPLOYEE",
        "type": "refresh",
        "iat": int(datetime.now(UTC).timestamp()),
        "exp": int((datetime.now(UTC) + ACCESS_TOKEN_TTL).timestamp()),
    }
    token = jwt.encode(payload, get_settings().jwt_secret, algorithm=JWT_ALGORITHM)

    with pytest.raises(InvalidTokenError):
        decode_access_token(token)


@pytest.mark.parametrize("garbage", ["", "not.a.token", "a.b.c", "Bearer something"])
def test_malformed_tokens_are_rejected(garbage: str) -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token(garbage)


def test_refresh_tokens_are_unique_and_hashed() -> None:
    raw_one, hash_one = generate_refresh_token()
    raw_two, hash_two = generate_refresh_token()

    assert raw_one != raw_two
    assert hash_one != hash_two
    # The raw value must never be recoverable from what we store.
    assert raw_one not in hash_one
    assert hash_refresh_token(raw_one) == hash_one
    assert len(hash_one) == 64  # SHA-256 hex digest


def test_refresh_token_hashing_is_deterministic() -> None:
    """Lookup is an indexed equality match, so the hash cannot be salted."""
    raw, _ = generate_refresh_token()

    assert hash_refresh_token(raw) == hash_refresh_token(raw)


def test_refresh_token_expiry_is_seven_days() -> None:
    assert timedelta(days=7) == REFRESH_TOKEN_TTL

    now = datetime.now(UTC)
    assert refresh_token_expiry(now) == now + timedelta(days=7)
