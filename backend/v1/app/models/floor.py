"""Floors within a building."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, Text, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.building import Building
    from app.models.seat import Seat


class Floor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One floor of a building, for example 'Level 3' with level_number 3."""

    __tablename__ = "floors"
    __table_args__ = (UniqueConstraint("building_id", "level_number"),)

    building_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    level_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    building: Mapped["Building"] = relationship(back_populates="floors")
    seats: Mapped[list["Seat"]] = relationship(
        back_populates="floor",
        cascade="all, delete-orphan",
    )
