"""Rules for the category tree.

The tree is exactly two levels deep and stays that way because of four rules,
all of which live here:

* **Depth.** A subcategory's parent must be a group, checked when it is
  created. There is no way to re-parent afterwards — `CategoryUpdate` has no
  `parent_id` — so a third level cannot appear later either.
* **Location detail belongs to the group.** Subcategories inherit it. A payload
  that sets it on a subcategory is refused rather than quietly ignored, and
  changing a group's value rewrites its children in the same transaction, so
  the two can never drift.
* **`allows_watchers` belongs to the subcategory**, and is the one field that
  runs the other way. Whether a problem is shared or personal is not a
  property of "Hardware": a jammed floor printer and a laptop that will not
  charge are both filed under it. So it is refused on a *group*, by the same
  argument and the same shape as the three fields above — a value set where
  nothing reads it is a silent no-op, and an admin who set it would believe
  they had turned the feature on.
* **Siblings have distinct names**, compared case-insensitively.
* **Deletion versus deactivation.** A category an incident was filed under is
  deactivated, never deleted: the ticket would otherwise lose the only record
  of what kind of problem it was. Unlike a facility this is not an error — an
  admin curating the questionnaire expects "stop offering this", so the
  response says which of the two happened.

`hint` and `icon` are group-level presentation, so the same refusal applies to
them on a subcategory.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.category import Category
from app.models.enums import LocationDetail
from app.repositories import categories as repository
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.schemas.common import DeleteResult

#: Fields that describe how a *group* is presented in the questionnaire. A
#: subcategory has no card of its own to carry them.
GROUP_ONLY_FIELDS = ("hint", "icon", "location_detail")

#: Fields that only mean something on a subcategory. Incidents are filed
#: against subcategories, so this is where a rule about what may happen to a
#: ticket has to live. A group's copy would never be read.
SUBCATEGORY_ONLY_FIELDS = ("allows_watchers",)

#: Default for a group that does not say how precise a location it needs.
DEFAULT_LOCATION_DETAIL = LocationDetail.FLOOR


def load_tree(session: Session, *, include_inactive: bool) -> Sequence[Category]:
    """Return every group with its subcategories, in display order."""
    return repository.load_tree(session, include_inactive=include_inactive)


def get_category(session: Session, category_id: uuid.UUID) -> Category:
    """Return one category, or raise `NotFoundError`."""
    category = repository.get(session, category_id)
    if category is None:
        raise NotFoundError("That category does not exist.", code="CATEGORY_NOT_FOUND")
    return category


def create_category(session: Session, payload: CategoryCreate) -> Category:
    """Create a group, or a subcategory when `parent_id` is given."""
    parent = _resolve_parent(session, payload.parent_id)

    if parent is None:
        _reject_subcategory_only_fields(payload)
        location_detail = payload.location_detail or DEFAULT_LOCATION_DETAIL
    else:
        _reject_group_only_fields(payload)
        location_detail = parent.location_detail

    _require_free_name(session, parent_id=payload.parent_id, name=payload.name)

    category = Category(
        parent_id=payload.parent_id,
        name=payload.name,
        hint=payload.hint,
        icon=payload.icon,
        location_detail=location_detail,
        sort_order=payload.sort_order,
        # A new subcategory is personal unless the admin says otherwise, the
        # same way the seed's default is personal: an audience is something
        # somebody chooses to allow, never something that arrives by default.
        allows_watchers=bool(payload.allows_watchers),
    )
    session.add(category)
    session.flush()
    return category


def update_category(
    session: Session,
    category_id: uuid.UUID,
    payload: CategoryUpdate,
) -> Category:
    """Apply a partial update, keeping subcategories in step with their group."""
    category = get_category(session, category_id)
    changes = payload.model_dump(exclude_unset=True)

    if category.is_group:
        _reject_subcategory_only_changes(changes)
    else:
        _reject_group_only_changes(changes)

    if "name" in changes:
        _require_free_name(
            session,
            parent_id=category.parent_id,
            name=changes["name"],
            exclude_id=category.id,
        )

    for field, value in changes.items():
        setattr(category, field, value)

    # A group's location detail is the one its subcategories inherit, so push
    # the new value down rather than leaving stale copies behind.
    if category.is_group and "location_detail" in changes:
        repository.set_children_location_detail(
            session,
            parent_id=category.id,
            location_detail=category.location_detail,
        )

    session.flush()
    return category


def delete_category(session: Session, category_id: uuid.UUID) -> DeleteResult:
    """Delete a category, or deactivate it when incidents reference it.

    A group with subcategories is deactivated too, whether or not anything has
    been filed under it: removing it would cascade its children away, and an
    admin who wants them gone can delete them first.
    """
    category = get_category(session, category_id)

    referencing = repository.count_incidents_in_category(session, category.id)
    if referencing:
        return _deactivate(
            session,
            category,
            detail=(
                f"{referencing} incident(s) reference this category, so it was "
                "deactivated instead of deleted. It no longer appears in the report form."
            ),
        )

    if category.is_group and repository.count_children(session, category.id):
        return _deactivate(
            session,
            category,
            detail=(
                "This group still has subcategories, so it was deactivated instead of "
                "deleted. Delete the subcategories first to remove it outright."
            ),
        )

    session.delete(category)
    session.flush()
    return DeleteResult(
        id=category_id,
        deleted=True,
        deactivated=False,
        detail="Category deleted.",
    )


def _deactivate(session: Session, category: Category, *, detail: str) -> DeleteResult:
    """Clear `is_active` and report the category as deactivated, not deleted."""
    category.is_active = False
    session.flush()
    return DeleteResult(id=category.id, deleted=False, deactivated=True, detail=detail)


def _resolve_parent(session: Session, parent_id: uuid.UUID | None) -> Category | None:
    """Return the parent for a new category, enforcing the two-level limit."""
    if parent_id is None:
        return None

    parent = repository.get(session, parent_id)
    if parent is None:
        raise ValidationError(
            "That parent category does not exist.",
            code="PARENT_NOT_FOUND",
            field="parent_id",
        )

    if not parent.is_group:
        raise ValidationError(
            "Categories are only two levels deep: a subcategory's parent must be a group.",
            code="CATEGORY_TOO_DEEP",
            field="parent_id",
        )

    return parent


def _reject_group_only_fields(payload: CategoryCreate) -> None:
    """Refuse a create payload that sets group-level fields on a subcategory."""
    for field in GROUP_ONLY_FIELDS:
        if getattr(payload, field) is not None:
            raise ValidationError(
                f"'{field}' belongs to the group; subcategories inherit it.",
                code="GROUP_ONLY_FIELD",
                field=field,
            )


def _reject_group_only_changes(changes: dict[str, object]) -> None:
    """Refuse an update payload that sets group-level fields on a subcategory."""
    for field in GROUP_ONLY_FIELDS:
        if field in changes:
            raise ValidationError(
                f"'{field}' belongs to the group; subcategories inherit it.",
                code="GROUP_ONLY_FIELD",
                field=field,
            )


def _reject_subcategory_only_fields(payload: CategoryCreate) -> None:
    """Refuse a create payload that sets subcategory-level fields on a group."""
    for field in SUBCATEGORY_ONLY_FIELDS:
        if getattr(payload, field) is not None:
            raise ValidationError(
                f"'{field}' is set per subcategory; a group has no tickets of its own.",
                code="SUBCATEGORY_ONLY_FIELD",
                field=field,
            )


def _reject_subcategory_only_changes(changes: dict[str, object]) -> None:
    """Refuse an update payload that sets subcategory-level fields on a group."""
    for field in SUBCATEGORY_ONLY_FIELDS:
        if field in changes:
            raise ValidationError(
                f"'{field}' is set per subcategory; a group has no tickets of its own.",
                code="SUBCATEGORY_ONLY_FIELD",
                field=field,
            )


def _require_free_name(
    session: Session,
    *,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise `ConflictError` when a sibling already uses this name."""
    if repository.name_taken(session, parent_id=parent_id, name=name, exclude_id=exclude_id):
        scope = "group" if parent_id is None else "subcategory"
        raise ConflictError(
            f"A {scope} with that name already exists.",
            code="CATEGORY_NAME_TAKEN",
            field="name",
        )
