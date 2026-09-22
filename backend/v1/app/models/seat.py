"""Seats — desks, meeting rooms and other named places on a floor."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Text, UniqueConstraint, text, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import SeatType

if TYPE_CHECKING:
    from app.models.floor import Floor


class Seat(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A named place on a floor: desk '3-A-12', or room 'Redwood'.

    Meeting rooms are seats with ``seat_type = MEETING_ROOM`` rather than a
    separate table — they occupy the same position in the location hierarchy
    and an incident can be reported against either.
    """

    __tablename__ = "seats"
    __table_args__ = (UniqueConstraint("floor_id", "code"),)

    floor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("floors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    seat_type: Mapped[SeatType] = mapped_column(
        pg_enum(SeatType, "seat_type"),
        nullable=False,
        server_default=text("'DESK'"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    floor: Mapped["Floor"] = relationship(back_populates="seats")
