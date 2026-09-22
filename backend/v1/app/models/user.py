"""User accounts."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, false, text, true
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import UserRole

if TYPE_CHECKING:
    from app.models.engineer_profile import EngineerProfile
    from app.models.refresh_token import RefreshToken


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Someone who can sign in. Exactly one role per user.

    ``email`` is ``CITEXT``, so uniqueness and lookups are case-insensitive in
    the database itself rather than depending on every caller remembering to
    lowercase first. We still normalise on the way in — see
    ``app.services.auth_service.normalise_email`` — but the constraint holds
    regardless.
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"),
        nullable=False,
        server_default=text("'EMPLOYEE'"),
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    must_change_password: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Last place this user reported an issue from, used to pre-fill the report
    # form. Deliberately ON DELETE SET NULL: losing a hint is fine, losing the
    # user is not.
    last_building_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_floor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("floors.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_seat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seats.id", ondelete="SET NULL"),
        nullable=True,
    )

    engineer_profile: Mapped["EngineerProfile | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def is_staff(self) -> bool:
        """Return whether this user is an engineer or an admin, not an employee."""
        return self.role in (UserRole.ENGINEER, UserRole.FACILITY_ADMIN)
