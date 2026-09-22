"""Request and response models for engineer profiles.

An engineer is a `User` with `role = ENGINEER` plus a one-to-one
`EngineerProfile`. The API presents them as one resource — `/engineers` —
because no screen ever wants half of it.
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import AvailabilityStatus, EngineerLevel

EngineerName = Annotated[str, StringConstraints(min_length=1, max_length=120)]

#: Ceiling on `max_active_tickets`. The column's CHECK constraint only requires
#: a positive number; this keeps the capacity bar in the assign dialog readable.
MAX_ACTIVE_TICKETS_LIMIT = 100


class EngineerCreate(BaseModel):
    """Create an engineer account and its profile in one call.

    There is no password field: the endpoint generates a temporary one and
    returns it once. An engineer who chose their own password at creation would
    have it travel through an admin's screen, a support chat, or both.
    """

    email: str = Field(min_length=3, max_length=320, description="An @acme.inc address.")
    full_name: EngineerName
    level: EngineerLevel = Field(
        default=EngineerLevel.JUNIOR,
        description="JUNIOR cannot assign, SENIOR may self-assign, LEAD may assign anyone.",
    )
    specialty_group_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Top-level category groups this engineer handles.",
    )
    home_building_id: uuid.UUID | None = None
    phone: str | None = Field(default=None, max_length=40)
    max_active_tickets: int = Field(
        default=10,
        ge=1,
        le=MAX_ACTIVE_TICKETS_LIMIT,
        description="Soft capacity limit; assigning past it warns rather than fails.",
    )

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("phone")
    @classmethod
    def _strip_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class EngineerUpdate(BaseModel):
    """An admin's partial update to an engineer. Absent fields are untouched."""

    full_name: EngineerName | None = None
    level: EngineerLevel | None = None
    specialty_group_ids: list[uuid.UUID] | None = None
    home_building_id: uuid.UUID | None = None
    phone: str | None = Field(default=None, max_length=40)
    availability: AvailabilityStatus | None = None
    max_active_tickets: int | None = Field(default=None, ge=1, le=MAX_ACTIVE_TICKETS_LIMIT)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("phone")
    @classmethod
    def _strip_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class EngineerSelfUpdate(BaseModel):
    """What an engineer may change about themselves.

    Availability and phone only. Level, specialties and capacity are an admin's
    call — an engineer who could raise their own level could assign work.
    """

    availability: AvailabilityStatus | None = None
    phone: str | None = Field(default=None, max_length=40)

    @field_validator("phone")
    @classmethod
    def _strip_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class EngineerRead(BaseModel):
    """An engineer as the Team page and the assign dialog need them.

    Flattened deliberately: `user_id` rather than a nested user object, because
    every consumer wants the name, the level and the workload together.
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    level: EngineerLevel
    specialty_group_ids: list[uuid.UUID]
    home_building_id: uuid.UUID | None
    phone: str | None
    availability: AvailabilityStatus
    max_active_tickets: int
    active_ticket_count: int = Field(
        description="Assigned tickets in OPEN, IN_PROGRESS or BLOCKED.",
    )


class EngineerCreated(BaseModel):
    """The response to creating an engineer, carrying the one-time password."""

    engineer: EngineerRead
    temporary_password: str = Field(
        description=(
            "Shown once and never stored in plain text. The account is flagged "
            "must_change_password, so it has to be replaced at first sign-in."
        ),
    )
