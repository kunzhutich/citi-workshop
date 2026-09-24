"""The two-level category tree used by the report questionnaire."""

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, Text, UniqueConstraint, false, text, true
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
    #: Whether a problem of this kind is one other people can be affected by,
    #: and so whether "I'm affected too" is offered on tickets filed under it.
    #:
    #: The mirror image of `location_detail`: that belongs to the **group** and
    #: is inherited downwards, because how precisely you must say *where*
    #: depends on the kind of thing; this belongs to the **subcategory**,
    #: because "the third-floor printer is jammed" and "my laptop will not
    #: charge" sit in the same group and are not the same kind of problem at
    #: all. `services/categories.py` refuses it on a group for that reason.
    #:
    #: Defaults to false, and the seed turns it on for a named list. A problem
    #: is personal until somebody decides otherwise: filing a duplicate costs
    #: an engineer a minute, and a stranger subscribing to a fault with your
    #: laptop cannot be undone.
    allows_watchers: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
    )

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
