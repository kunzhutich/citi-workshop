"""Extra attributes carried only by ENGINEER users."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, pg_enum
from app.models.enums import AvailabilityStatus, EngineerLevel

if TYPE_CHECKING:
    from app.models.user import User


class EngineerProfile(TimestampMixin, Base):
    """One-to-one extension of ``users`` for engineers.

    Kept in its own table rather than as nullable columns on ``users`` so that
    the engineer-only fields are genuinely not-nullable and the employee case
    stays uncluttered. The primary key *is* ``user_id`` — there is no separate
    identity here.
    """

    __tablename__ = "engineer_profiles"
    __table_args__ = (
        CheckConstraint("max_active_tickets > 0", name="max_active_tickets_positive"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    level: Mapped[EngineerLevel] = mapped_column(
        pg_enum(EngineerLevel, "engineer_level"),
        nullable=False,
        server_default=text("'JUNIOR'"),
    )
    # Top-level category groups this engineer handles. A group implies all of
    # its subcategories. Stored as an array rather than a join table because it
    # is only ever read and written whole, never queried by membership alone.
    specialty_group_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        server_default=text("'{}'::uuid[]"),
    )
    home_building_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="SET NULL"),
        nullable=True,
    )
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    availability: Mapped[AvailabilityStatus] = mapped_column(
        pg_enum(AvailabilityStatus, "availability_status"),
        nullable=False,
        server_default=text("'AVAILABLE'"),
    )
    max_active_tickets: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("10"),
    )

    user: Mapped["User"] = relationship(back_populates="engineer_profile")
