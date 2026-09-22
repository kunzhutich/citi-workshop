"""Buildings — the top level of the facility hierarchy."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.floor import Floor


class Building(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A physical ACME building, for example 'San Francisco HQ' / 'SFO-1'."""

    __tablename__ = "buildings"

    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building",
        cascade="all, delete-orphan",
        # Lowest storey first, so `GET /facilities/tree` and every other
        # consumer of this relationship agree on the order.
        order_by="Floor.level_number",
    )
