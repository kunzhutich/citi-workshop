"""Password hashing policy."""

import pytest

from app.security.passwords import (
    BCRYPT_ROUNDS,
    MAX_PASSWORD_LENGTH,
    hash_password,
    verify_password,
)


def test_hash_round_trips() -> None:
    hashed = hash_password("correct-horse-battery-staple")

    assert verify_password("correct-horse-battery-staple", hashed) is True
    assert verify_password("wrong-password-entirely", hashed) is False


def test_hash_is_salted() -> None:
    """The same password hashed twice must not produce the same string."""
    first = hash_password("correct-horse-battery-staple")
    second = hash_password("correct-horse-battery-staple")

    assert first != second
    assert verify_password("correct-horse-battery-staple", first)
    assert verify_password("correct-horse-battery-staple", second)


def test_hash_uses_the_configured_cost() -> None:
    hashed = hash_password("correct-horse-battery-staple")

    # bcrypt hashes look like $2b$<rounds>$<salt+digest>.
    assert hashed.split("$")[2] == f"{BCRYPT_ROUNDS:02d}"


@pytest.mark.parametrize("length", [12, 72, 73, MAX_PASSWORD_LENGTH])
def test_long_passwords_are_accepted(length: int) -> None:
    """Bcrypt rejects inputs over 72 bytes, so we SHA-256 first. Prove it holds."""
    password = "a" * length

    assert verify_password(password, hash_password(password)) is True


def test_multibyte_passwords_are_accepted() -> None:
    """128 emoji is far over bcrypt's 72-byte limit before pre-hashing."""
    password = "🔐" * MAX_PASSWORD_LENGTH

    assert verify_password(password, hash_password(password)) is True


def test_long_passwords_are_not_truncated() -> None:
    """Two passwords sharing their first 72 bytes must not be interchangeable."""
    base = "a" * 72
    hashed = hash_password(base + "ending-one")

    assert verify_password(base + "ending-two", hashed) is False
    assert verify_password(base + "ending-one", hashed) is True


def test_malformed_stored_hash_fails_closed() -> None:
    """A corrupt row must fail the login, not raise."""
    assert verify_password("anything", "not-a-bcrypt-hash") is False
    assert verify_password("anything", "") is False
