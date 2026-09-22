"""User administration endpoints.

Facility admins only, in full: employees and engineers have no business
listing accounts, and the RBAC matrix gives neither of them a screen that
needs one.

The caller is taken as `admin: AdminUser` rather than a bare permission, since
the self-edit guard in `services/users.py` has to know who is acting.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.models.enums import UserRole
from app.schemas.common import Page, Paging, build_page
from app.schemas.user import UserRead, UserUpdate
from app.security.dependencies import AdminUser, DbSession, IncludeInactive
from app.services import users as service

router = APIRouter(prefix="/users", tags=["users"])

RoleFilter = Annotated[UserRole | None, Query(description="Only users holding this role.")]
SearchQuery = Annotated[
    str | None,
    Query(max_length=120, description="Match on name or email, case-insensitively."),
]


@router.get("", response_model=Page[UserRead], summary="List users")
def list_users(
    session: DbSession,
    admin: AdminUser,
    paging: Paging,
    include_inactive: IncludeInactive,
    role: RoleFilter = None,
    q: SearchQuery = None,
) -> Page[UserRead]:
    """Return one page of accounts, ordered by name."""
    del admin  # Authorization only; the listing is the same for every admin.
    rows, total = service.list_users(
        session,
        role=role,
        query=q,
        include_inactive=include_inactive,
        paging=paging,
    )
    items = [UserRead.model_validate(row) for row in rows]
    return build_page(items, total=total, params=paging)


@router.get("/{user_id}", response_model=UserRead, summary="Get one user")
def get_user(user_id: uuid.UUID, session: DbSession, admin: AdminUser) -> UserRead:
    """Return one account."""
    del admin
    return UserRead.model_validate(service.get_user(session, user_id))


@router.patch("/{user_id}", response_model=UserRead, summary="Update a user")
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    session: DbSession,
    admin: AdminUser,
) -> UserRead:
    """Change a user's name, role or active flag.

    Promoting to ENGINEER creates a default JUNIOR profile when the account has
    none. An admin cannot change their own role or deactivate themselves, which
    is what keeps the last admin account reachable.
    """
    user = service.update_user(session, actor=admin, user_id=user_id, payload=payload)
    session.commit()
    return UserRead.model_validate(user)
