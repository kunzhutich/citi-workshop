"""Response models for users and engineer profiles."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AvailabilityStatus, EngineerLevel, UserRole


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
