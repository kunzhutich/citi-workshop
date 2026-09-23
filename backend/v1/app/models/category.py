"""The two-level category tree used by the report questionnaire."""

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, Text, UniqueConstraint, text, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, pg_enum
from app.models.enums import LocationDetail


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A category group (``parent_id IS NULL``) or one of its subcategories.

    Depth is capped at two by the service layer, not by the schema: a
    subcategory's parent must itself be a group. Incidents may only reference
    subcategories.

    The unique constraint uses ``NULLS NOT DISTINCT`` (PostgreSQL 15+) so that
    two *groups* cannot share a name. With the default NULLS DISTINCT the
    constraint would silently never apply to groups, because their ``parent_id``
    is NULL and NULLs never collide.
    """

    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("parent_id", "name", postgresql_nulls_not_distinct=True),)

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    #: One-line description shown on the group card in the questionnaire.
    hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Material UI icon name, for example 'Computer'. Rendered by the frontend.
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: How precise a location this group needs. Subcategories inherit it.
    location_detail: Mapped[LocationDetail] = mapped_column(
        pg_enum(LocationDetail, "location_detail"),
        nullable=False,
        server_default=text("'FLOOR'"),
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())

    parent: Mapped["Category | None"] = relationship(
        back_populates="children",
        remote_side="Category.id",
    )
    children: Mapped[list["Category"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="Category.sort_order",
    )

    @property
    def is_group(self) -> bool:
        """Return whether this row is a top-level group rather than a subcategory."""
        return self.parent_id is None
