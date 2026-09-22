"""Queries over users and their refresh tokens."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models.refresh_token import RefreshToken
from app.models.user import User


def get_by_id(session: Session, user_id: uuid.UUID) -> User | None:
    """Return the user with this id, with their engineer profile eagerly loaded."""
    statement = select(User).options(selectinload(User.engineer_profile)).where(User.id == user_id)
    return session.scalars(statement).one_or_none()


def get_by_email(session: Session, email: str) -> User | None:
    """Return the user with this email.

    ``users.email`` is ``CITEXT``, so this comparison is case-insensitive in
    the database and does not depend on the caller having normalised first.
    """
    statement = select(User).options(selectinload(User.engineer_profile)).where(User.email == email)
    return session.scalars(statement).one_or_none()


def email_exists(session: Session, email: str) -> bool:
    """Return whether any account already uses this email."""
    return session.scalars(select(User.id).where(User.email == email).limit(1)).first() is not None


def count_by_role(session: Session, role: str) -> int:
    """Return how many users hold this role."""
    return len(list(session.scalars(select(User.id).where(User.role == role))))


def add_refresh_token(
    session: Session,
    *,
    user_id: uuid.UUID,
    token_hash: str,
    expires_at: datetime,
) -> RefreshToken:
    """Store a newly issued refresh token."""
    token = RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
    session.add(token)
    session.flush()
    return token


def get_refresh_token(session: Session, token_hash: str) -> RefreshToken | None:
    """Return the stored refresh token with this hash, revoked or not."""
    statement = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    return session.scalars(statement).one_or_none()


def revoke_refresh_token(token: RefreshToken, *, now: datetime | None = None) -> None:
    """Mark a single refresh token as revoked."""
    token.revoked_at = now or datetime.now(UTC)


def revoke_all_refresh_tokens(
    session: Session,
    user_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> int:
    """Revoke every live refresh token for a user. Returns how many were revoked."""
    statement = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )
    return session.execute(statement).rowcount
