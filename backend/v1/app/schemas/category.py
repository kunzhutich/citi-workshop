"""Request and response models for the two-level category tree.

A group is a category with no parent; a subcategory is one with a group as its
parent. There is no third level — `app.services.categories` enforces that, and
these models keep the payloads honest about which fields belong to which.
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import LocationDetail

CategoryName = Annotated[str, StringConstraints(min_length=1, max_length=80)]


class CategoryCreate(BaseModel):
    """A new group, or a new subcategory when `parent_id` is given."""

    name: CategoryName
    parent_id: uuid.UUID | None = Field(
        default=None,
        description="Omit for a group. Must be a group's id for a subcategory.",
    )
    hint: str | None = Field(
        default=None,
        max_length=200,
        description="One-line description on the group card. Groups only.",
    )
    icon: str | None = Field(
        default=None,
        max_length=60,
        description="Material UI icon name, for example 'Computer'. Groups only.",
    )
    location_detail: LocationDetail | None = Field(
        default=None,
        description=(
            "How precise a location this group needs. Groups only — a "
            "subcategory inherits its group's value."
        ),
    )
    sort_order: int = Field(default=0, ge=0, le=9999, description="Ascending display order.")

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("hint", "icon")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CategoryUpdate(BaseModel):
    """A partial update. Only the fields present in the request body are applied.

    `parent_id` is absent on purpose: moving a category between groups would
    silently reclassify every incident already filed under it. Deactivate the
    old one and create a new one instead.
    """

    name: CategoryName | None = None
    hint: str | None = Field(default=None, max_length=200)
    icon: str | None = Field(default=None, max_length=60)
    location_detail: LocationDetail | None = None
    sort_order: int | None = Field(default=None, ge=0, le=9999)
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

    @field_validator("hint", "icon")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CategoryRead(BaseModel):
    """One category, group or subcategory, without its children."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    hint: str | None
    icon: str | None
    location_detail: LocationDetail
    sort_order: int
    is_active: bool


class CategoryNode(CategoryRead):
    """A group with its subcategories nested inside.

    The questionnaire renders groups as the cards in step one and `children` as
    the cards in step two, so both arrive in one request.
    """

    children: list[CategoryRead] = Field(default_factory=list)


class CategoryTree(BaseModel):
    """Every group, each carrying its subcategories, in display order."""

    groups: list[CategoryNode]
