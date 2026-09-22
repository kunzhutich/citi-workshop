"""Queries over the category tree."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.category import Category
from app.models.enums import LocationDetail
from app.models.incident import Incident


def get(session: Session, category_id: uuid.UUID) -> Category | None:
    """Return one category by id, group or subcategory."""
    return session.get(Category, category_id)


def load_tree(session: Session, *, include_inactive: bool) -> Sequence[Category]:
    """Return every group with its subcategories eagerly loaded.

    Two queries, one per level. The `.and_()` on the relationship pushes the
    active-only filter into the children statement rather than filtering in
    Python, so an inactive subcategory never reaches the response.
    """
    children_loader = (
        selectinload(Category.children)
        if include_inactive
        else selectinload(Category.children.and_(Category.is_active))
    )

    statement = (
        select(Category)
        .where(Category.parent_id.is_(None))
        .options(children_loader)
        .order_by(Category.sort_order, Category.name)
    )
    if not include_inactive:
        statement = statement.where(Category.is_active)

    return session.scalars(statement).unique().all()


def name_taken(
    session: Session,
    *,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """Return whether a sibling already uses this name.

    Siblings are compared case-insensitively — the database constraint is
    exact, so without this an admin could create both "Wi-Fi" and "wi-fi" and
    see two indistinguishable cards in the questionnaire.

    `parent_id IS NULL` is matched with `is_()`, not `==`, so two *groups* are
    compared as siblings rather than never matching.
    """
    statement = select(Category.id).where(func.lower(Category.name) == name.lower())
    if parent_id is None:
        statement = statement.where(Category.parent_id.is_(None))
    else:
        statement = statement.where(Category.parent_id == parent_id)
    if exclude_id is not None:
        statement = statement.where(Category.id != exclude_id)
    return session.scalars(statement.limit(1)).first() is not None


def count_children(session: Session, category_id: uuid.UUID) -> int:
    """Return how many subcategories a group has, active or not."""
    statement = select(func.count(Category.id)).where(Category.parent_id == category_id)
    return session.scalars(statement).one()


def count_incidents_in_category(session: Session, category_id: uuid.UUID) -> int:
    """Return how many incidents reference this category or any child of it.

    Incidents may only reference subcategories, but a group is checked through
    its children so that deleting a group is as safe as deleting one of them.
    """
    child_ids = select(Category.id).where(Category.parent_id == category_id)
    statement = select(func.count(Incident.id)).where(
        or_(Incident.category_id == category_id, Incident.category_id.in_(child_ids))
    )
    return session.scalars(statement).one()


def set_children_location_detail(
    session: Session,
    *,
    parent_id: uuid.UUID,
    location_detail: LocationDetail,
) -> None:
    """Copy a group's location detail onto every one of its subcategories.

    Subcategories inherit the value rather than owning it, so the two can never
    be allowed to drift: the frontend reads `location_detail` off whichever row
    it has to hand.
    """
    children = session.scalars(select(Category).where(Category.parent_id == parent_id)).all()
    for child in children:
        child.location_detail = location_detail
