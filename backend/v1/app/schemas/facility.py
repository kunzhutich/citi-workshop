"""Request and response models for buildings, floors and seats.

Three tables, one domain: a location is only ever meaningful as a path through
all three, so they share a module and a router rather than being split by table.

Every text field is trimmed by a validator here, so the service layer and the
database never see a name that differs from another only by whitespace.
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import SeatType

#: Most codes and names a facility uses are short; the bounds exist so a typo
#: cannot store a paragraph in a column that a dropdown has to render.
BuildingName = Annotated[str, StringConstraints(min_length=1, max_length=120)]
BuildingCode = Annotated[str, StringConstraints(min_length=1, max_length=20)]
FloorName = Annotated[str, StringConstraints(min_length=1, max_length=60)]
SeatCode = Annotated[str, StringConstraints(min_length=1, max_length=40)]

#: Ceiling on one bulk-seat request. A floor of 40 desks is the realistic case;
#: this is high enough never to be hit by hand and low enough to bound the
#: single INSERT the service issues.
MAX_BULK_SEAT_CODES = 500


def _trimmed(value: str | None) -> str | None:
    """Strip surrounding whitespace, mapping a now-empty string to None."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class BuildingCreate(BaseModel):
    """A new building. `code` is the short form shown in dense tables."""

    name: BuildingName = Field(description="Full name, for example 'San Francisco HQ'.")
    code: BuildingCode = Field(description="Short unique code, for example 'SFO-1'.")
    address: str | None = Field(default=None, max_length=500)

    @field_validator("name", "code")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        """Trim a required field, rejecting a value that was only whitespace."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("address")
    @classmethod
    def _strip_address(cls, value: str | None) -> str | None:
        return _trimmed(value)


class BuildingUpdate(BaseModel):
    """A partial update. Only the fields present in the request body are applied."""

    name: BuildingName | None = None
    code: BuildingCode | None = None
    address: str | None = Field(default=None, max_length=500)
    is_active: bool | None = Field(
        default=None,
        description="Set false to deactivate; the building stops appearing in the tree.",
    )

    @field_validator("name", "code")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        """Trim an optional field, rejecting an explicit blank."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("address")
    @classmethod
    def _strip_address(cls, value: str | None) -> str | None:
        return _trimmed(value)


class BuildingRead(BaseModel):
    """A building as returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    address: str | None
    is_active: bool


class FloorCreate(BaseModel):
    """A new floor. The building comes from the path, never the body."""

    name: FloorName = Field(description="Display name, for example 'Level 3'.")
    level_number: int = Field(
        ge=-20,
        le=200,
        description="Storey number, unique within the building. Negative for basements.",
    )

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class FloorUpdate(BaseModel):
    """A partial update to a floor. The building it belongs to cannot change."""

    name: FloorName | None = None
    level_number: int | None = Field(default=None, ge=-20, le=200)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class FloorRead(BaseModel):
    """A floor as returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    name: str
    level_number: int
    is_active: bool


class SeatCreate(BaseModel):
    """A new seat. The floor comes from the path, never the body."""

    code: SeatCode = Field(description="Desk or room identifier, for example '3-A-12'.")
    seat_type: SeatType = Field(default=SeatType.DESK)

    @field_validator("code")
    @classmethod
    def _strip_code(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class SeatUpdate(BaseModel):
    """A partial update to a seat. The floor it belongs to cannot change."""

    code: SeatCode | None = None
    seat_type: SeatType | None = None
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _strip_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class SeatRead(BaseModel):
    """A seat as returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    floor_id: uuid.UUID
    code: str
    seat_type: SeatType
    is_active: bool


class SeatBulkCreate(BaseModel):
    """Many seats at once, from a pasted list of codes.

    The admin screen accepts one code per line, so blank lines and repeats are
    expected input rather than client errors; the service drops both.
    """

    codes: list[SeatCode] = Field(
        min_length=1,
        max_length=MAX_BULK_SEAT_CODES,
        description=f"Between 1 and {MAX_BULK_SEAT_CODES} seat codes.",
    )
    seat_type: SeatType = Field(default=SeatType.DESK, description="Applied to every code.")


class SeatBulkResult(BaseModel):
    """What a bulk create did, code by code.

    A partial success is the normal outcome when re-pasting a list, so codes
    that already existed are reported rather than failing the whole request.
    """

    created: list[SeatRead] = Field(description="Seats inserted by this request.")
    skipped_codes: list[str] = Field(description="Codes that already existed on this floor.")
    created_count: int
    skipped_count: int


class FloorNode(FloorRead):
    """A floor inside `GET /facilities/tree`, carrying its seats."""

    seats: list[SeatRead] = Field(default_factory=list)


class BuildingNode(BuildingRead):
    """A building inside `GET /facilities/tree`, carrying its floors."""

    floors: list[FloorNode] = Field(default_factory=list)


class FacilityTree(BaseModel):
    """The whole location hierarchy in one response.

    Returned whole rather than paginated: the report questionnaire's location
    picker needs every level at once, and a facility is tens of rows, not
    thousands.
    """

    buildings: list[BuildingNode]
