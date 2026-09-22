"""Category endpoints.

`GET /categories` is the questionnaire's data source and is open to every
signed-in user; everything that edits the tree is facility-admin only.

The tree is returned whole rather than paginated: it is five groups and about
thirty subcategories, and the report form needs all of it before it can render
step one.
"""

import uuid

from fastapi import APIRouter, status

from app.models.category import Category
from app.schemas.category import (
    CategoryCreate,
    CategoryNode,
    CategoryRead,
    CategoryTree,
    CategoryUpdate,
)
from app.schemas.common import DeleteResult
from app.security.dependencies import ADMIN_ONLY, SIGNED_IN, DbSession, IncludeInactive
from app.services import categories as service

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get(
    "",
    response_model=CategoryTree,
    dependencies=[SIGNED_IN],
    summary="The category tree",
)
def get_category_tree(session: DbSession, include_inactive: IncludeInactive) -> CategoryTree:
    """Return every group with its subcategories nested inside."""
    groups = service.load_tree(session, include_inactive=include_inactive)
    return CategoryTree(groups=[_to_node(group) for group in groups])


@router.post(
    "",
    response_model=CategoryRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Create a group or subcategory",
)
def create_category(payload: CategoryCreate, session: DbSession) -> CategoryRead:
    """Create a group, or a subcategory when `parent_id` names one.

    A `parent_id` that points at a subcategory is a 422: the tree is two levels
    deep and stays that way.
    """
    category = service.create_category(session, payload)
    session.commit()
    return CategoryRead.model_validate(category)


@router.get(
    "/{category_id}",
    response_model=CategoryRead,
    dependencies=[SIGNED_IN],
    summary="Get one category",
)
def get_category(category_id: uuid.UUID, session: DbSession) -> CategoryRead:
    """Return one group or subcategory."""
    return CategoryRead.model_validate(service.get_category(session, category_id))


@router.patch(
    "/{category_id}",
    response_model=CategoryRead,
    dependencies=[ADMIN_ONLY],
    summary="Update a category",
)
def update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    session: DbSession,
) -> CategoryRead:
    """Rename, reorder, re-icon or deactivate a category.

    Changing a group's `location_detail` rewrites its subcategories to match.
    Setting a group-only field on a subcategory is a 422.
    """
    category = service.update_category(session, category_id, payload)
    session.commit()
    return CategoryRead.model_validate(category)


@router.delete(
    "/{category_id}",
    response_model=DeleteResult,
    dependencies=[ADMIN_ONLY],
    summary="Delete or deactivate a category",
)
def delete_category(category_id: uuid.UUID, session: DbSession) -> DeleteResult:
    """Remove a category, or deactivate it when it cannot be removed.

    A category incidents were filed under, and a group that still has
    subcategories, are deactivated instead; `deleted` and `deactivated` in the
    response say which happened.
    """
    result = service.delete_category(session, category_id)
    session.commit()
    return result


def _to_node(group: Category) -> CategoryNode:
    """Convert one eagerly-loaded group into its tree node."""
    return CategoryNode(
        **CategoryRead.model_validate(group).model_dump(),
        children=[CategoryRead.model_validate(child) for child in group.children],
    )
