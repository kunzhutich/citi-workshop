"""Shapes shared by every resource: pagination and delete results.

The paging contract is fixed by the build plan — list endpoints return
``{items, total, page, page_size}``, default 25, maximum 100 — so it is
expressed once, here, rather than per router.
"""

import uuid
from typing import Annotated, TypeVar

from fastapi import Depends, Query
from pydantic import BaseModel, Field

#: Item type of a `Page`.
ItemT = TypeVar("ItemT")

#: Paging defaults. `MAX_PAGE_SIZE` is a hard cap, not a default: a client that
#: asks for more gets a 422 rather than a silently truncated answer.
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


class PageParams(BaseModel):
    """`page` and `page_size` query parameters, validated once for every list."""

    page: int = Field(default=1, ge=1, description="1-based page number.")
    page_size: int = Field(
        default=DEFAULT_PAGE_SIZE,
        ge=1,
        le=MAX_PAGE_SIZE,
        description=f"Rows per page, at most {MAX_PAGE_SIZE}.",
    )

    @property
    def offset(self) -> int:
        """Return the SQL OFFSET this page starts at."""
        return (self.page - 1) * self.page_size


class Page[ItemT](BaseModel):
    """One page of results plus the total matching row count.

    `total` counts every row matching the filters, not the rows in `items`, so
    a client can render "showing 25 of 312" without a second request.
    """

    items: list[ItemT]
    total: int = Field(description="Rows matching the filters, across all pages.")
    page: int
    page_size: int


class DeleteResult(BaseModel):
    """What a DELETE did.

    Some resources cannot always be removed — a category an incident already
    points at is deactivated instead — so the caller is told which happened
    rather than having to infer it from a status code.
    """

    id: uuid.UUID
    deleted: bool = Field(description="True when the row was removed from the database.")
    deactivated: bool = Field(description="True when the row was kept but `is_active` cleared.")
    detail: str = Field(description="Human-readable summary, safe to show to an admin.")


def get_page_params(
    page: Annotated[int, Query(ge=1, description="1-based page number.")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=MAX_PAGE_SIZE, description=f"Rows per page, at most {MAX_PAGE_SIZE}."),
    ] = DEFAULT_PAGE_SIZE,
) -> PageParams:
    """Return the validated paging parameters for a list endpoint."""
    return PageParams(page=page, page_size=page_size)


#: Routers depend on this rather than declaring the two query parameters again.
Paging = Annotated[PageParams, Depends(get_page_params)]


def build_page[T](items: list[T], *, total: int, params: PageParams) -> Page[T]:
    """Wrap a page of rows in the standard envelope."""
    return Page[T](items=items, total=total, page=params.page, page_size=params.page_size)
