"""Password hashing.

bcrypt is used directly rather than through passlib: passlib adds a dependency
and an abstraction layer we would never swap out, and its bcrypt backend has
been a recurring source of version-compatibility breakage.

bcrypt refuses passwords longer than 72 bytes outright (it does not silently
truncate in 5.x, it raises). Our policy allows up to 128 characters, and a
multi-byte character costs more than one byte, so the input is first reduced to
a fixed-length SHA-256 digest and base64-encoded — 44 ASCII bytes, always under
the limit, with no loss of entropy. This is the same construction passlib calls
``bcrypt_sha256``.

The digest step must never be removed or reordered: doing so would invalidate
every stored hash.
"""

import base64
import hashlib

import bcrypt

#: bcrypt work factor. 12 is the current sensible default: roughly 250 ms per
#: hash on modern hardware, which is slow enough to matter to an attacker and
#: fast enough for a login request.
BCRYPT_ROUNDS = 12

#: Policy bounds, mirrored by the Pydantic schemas so the API returns a clean
#: 422 rather than letting a bad password reach this module.
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128


def hash_password(password: str) -> str:
    """Return a bcrypt hash of `password`, safe to store."""
    digest = _prehash(password)
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    """Return whether `password` matches `password_hash`.

    A malformed stored hash returns False rather than raising: a corrupt row
    should fail the login, not the request.
    """
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def _prehash(password: str) -> bytes:
    """Reduce a password of any length to 44 ASCII bytes for bcrypt."""
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())
