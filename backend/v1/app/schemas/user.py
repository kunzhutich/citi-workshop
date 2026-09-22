"""Request and response models for users and engineer profiles."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import AvailabilityStatus, EngineerLevel, UserRole

UserFullName = Annotated[str, StringConstraints(min_length=1, max_length=120)]


class EngineerProfileRead(BaseModel):
    """The engineer-only attributes attached to an ENGINEER user."""

    model_config = ConfigDict(from_attributes=True)

    level: EngineerLevel = Field(description="Seniority, which governs assignment rights.")
    specialty_group_ids: list[uuid.UUID] = Field(
        description="Category groups this engineer handles; a group covers its subcategories.",
    )
    home_building_id: uuid.UUID | None = Field(default=None, description="Usual building.")
    phone: str | None = Field(default=None, description="Contact number.")
    availability: AvailabilityStatus = Field(description="Whether they can take work now.")
    max_active_tickets: int = Field(description="Soft capacity limit used by assignment warnings.")


class UserRead(BaseModel):
    """A user as returned to clients. Never includes the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    must_change_password: bool = Field(
        description="When true, every endpoint outside /auth returns 403 until it is cleared.",
    )
    last_login_at: datetime | None = None
    created_at: datetime


class CurrentUserRead(UserRead):
    """The caller's own record, with their engineer profile when they have one."""

    engineer_profile: EngineerProfileRead | None = Field(
        default=None,
        description="Present only for ENGINEER users.",
    )


class UserUpdate(BaseModel):
    """What an admin may change about another account.

    Email is absent on purpose: it is the sign-in identity and the key every
    audit trail is read by, so changing it is an account migration rather than
    an edit. Password is absent because only its owner can set one — see
    `POST /auth/change-password`.
    """

    full_name: UserFullName | None = None
    role: UserRole | None = Field(
        default=None,
        description=(
            "Promoting to ENGINEER creates a default JUNIOR profile if the "
            "account has none, so the new role is usable immediately."
        ),
    )
    is_active: bool | None = Field(
        default=None,
        description="Set false to deactivate; the account's sessions are revoked.",
    )

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        """Trim the name, rejecting an explicit blank."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped
