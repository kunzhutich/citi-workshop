"""Helpers for building database rows in tests.

Kept deliberately thin: plain functions with keyword defaults rather than a
factory library, so a test reads as ordinary Python and nothing is hidden.
"""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.engineer_profile import EngineerProfile
from app.models.enums import AvailabilityStatus, EngineerLevel, UserRole
from app.models.user import User
from app.security.passwords import hash_password

#: Password used by every test account unless one is passed explicitly.
DEFAULT_PASSWORD = "correct-horse-battery-staple"


def make_user(
    session: Session,
    *,
    email: str | None = None,
    full_name: str = "Test User",
    role: UserRole = UserRole.EMPLOYEE,
    password: str = DEFAULT_PASSWORD,
    is_active: bool = True,
    must_change_password: bool = False,
) -> User:
    """Insert a user and return it. The email is unique unless one is given."""
    user = User(
        email=email or f"user-{uuid.uuid4().hex[:12]}@acme.inc",
        full_name=full_name,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
        must_change_password=must_change_password,
    )
    session.add(user)
    session.flush()
    return user


def make_engineer(
    session: Session,
    *,
    level: EngineerLevel = EngineerLevel.JUNIOR,
    availability: AvailabilityStatus = AvailabilityStatus.AVAILABLE,
    max_active_tickets: int = 10,
    **user_kwargs: Any,
) -> User:
    """Insert an ENGINEER user together with its one-to-one profile."""
    user_kwargs.setdefault("full_name", f"{level.value.title()} Engineer")
    user = make_user(session, role=UserRole.ENGINEER, **user_kwargs)
    session.add(
        EngineerProfile(
            user_id=user.id,
            level=level,
            availability=availability,
            max_active_tickets=max_active_tickets,
        )
    )
    session.flush()
    session.refresh(user)
    return user


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> str:
    """Sign in through the API and return the access token."""
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    """Return the Authorization header for a bearer token."""
    return {"Authorization": f"Bearer {token}"}
