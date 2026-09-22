"""Building, floor and seat endpoints, plus the whole-hierarchy tree.

Reads are open to any signed-in user — everyone has to pick a location when
reporting an issue. Writes are facility-admin only. Both are declared in the
route decorator with `dependencies=[SIGNED_IN]` or `[ADMIN_ONLY]`, so the
permission sits one line above the handler and no handler has to accept an
argument it never reads.

One router covers all three levels because they are one domain: `/buildings`,
`/floors` and `/seats` are the same tree addressed at different depths.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.models.building import Building
from app.models.enums import SeatType
from app.models.floor import Floor
from app.schemas.common import DeleteResult, Page, Paging, build_page
from app.schemas.facility import (
    BuildingCreate,
    BuildingNode,
    BuildingRead,
    BuildingUpdate,
    FacilityTree,
    FloorCreate,
    FloorNode,
    FloorRead,
    FloorUpdate,
    SeatBulkCreate,
    SeatBulkResult,
    SeatCreate,
    SeatRead,
    SeatUpdate,
)
from app.security.dependencies import ADMIN_ONLY, SIGNED_IN, DbSession, IncludeInactive
from app.services import facilities as service

router = APIRouter(tags=["facilities"])

SeatTypeFilter = Annotated[
    SeatType | None,
    Query(description="Only seats of this type. Used for meeting-room pickers."),
]


# --- Buildings ---------------------------------------------------------------


@router.get(
    "/buildings",
    response_model=Page[BuildingRead],
    dependencies=[SIGNED_IN],
    summary="List buildings",
)
def list_buildings(
    session: DbSession,
    paging: Paging,
    include_inactive: IncludeInactive,
) -> Page[BuildingRead]:
    """Return one page of buildings, ordered by code."""
    rows, total = service.list_buildings(
        session,
        include_inactive=include_inactive,
        paging=paging,
    )
    items = [BuildingRead.model_validate(row) for row in rows]
    return build_page(items, total=total, params=paging)


@router.post(
    "/buildings",
    response_model=BuildingRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Create a building",
)
def create_building(payload: BuildingCreate, session: DbSession) -> BuildingRead:
    """Create a building. The code is stored uppercased and must be unique."""
    building = service.create_building(session, payload)
    session.commit()
    return BuildingRead.model_validate(building)


@router.get(
    "/buildings/{building_id}",
    response_model=BuildingRead,
    dependencies=[SIGNED_IN],
    summary="Get a building",
)
def get_building(building_id: uuid.UUID, session: DbSession) -> BuildingRead:
    """Return one building."""
    return BuildingRead.model_validate(service.get_building(session, building_id))


@router.patch(
    "/buildings/{building_id}",
    response_model=BuildingRead,
    dependencies=[ADMIN_ONLY],
    summary="Update a building",
)
def update_building(
    building_id: uuid.UUID,
    payload: BuildingUpdate,
    session: DbSession,
) -> BuildingRead:
    """Apply a partial update. Send `{"is_active": false}` to deactivate."""
    building = service.update_building(session, building_id, payload)
    session.commit()
    return BuildingRead.model_validate(building)


@router.delete(
    "/buildings/{building_id}",
    response_model=DeleteResult,
    dependencies=[ADMIN_ONLY],
    summary="Delete a building",
)
def delete_building(building_id: uuid.UUID, session: DbSession) -> DeleteResult:
    """Delete a building with its floors and seats.

    Refused with 409 when any incident was reported inside it; deactivate it
    instead.
    """
    result = service.delete_building(session, building_id)
    session.commit()
    return result


# --- Floors ------------------------------------------------------------------


@router.get(
    "/buildings/{building_id}/floors",
    response_model=Page[FloorRead],
    dependencies=[SIGNED_IN],
    summary="List a building's floors",
)
def list_floors(
    building_id: uuid.UUID,
    session: DbSession,
    paging: Paging,
    include_inactive: IncludeInactive,
) -> Page[FloorRead]:
    """Return one page of floors, lowest level first."""
    rows, total = service.list_floors(
        session,
        building_id=building_id,
        include_inactive=include_inactive,
        paging=paging,
    )
    items = [FloorRead.model_validate(row) for row in rows]
    return build_page(items, total=total, params=paging)


@router.post(
    "/buildings/{building_id}/floors",
    response_model=FloorRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Add a floor to a building",
)
def create_floor(
    building_id: uuid.UUID,
    payload: FloorCreate,
    session: DbSession,
) -> FloorRead:
    """Create a floor. `level_number` must be unique within the building."""
    floor = service.create_floor(session, building_id=building_id, payload=payload)
    session.commit()
    return FloorRead.model_validate(floor)


@router.get(
    "/floors/{floor_id}",
    response_model=FloorRead,
    dependencies=[SIGNED_IN],
    summary="Get a floor",
)
def get_floor(floor_id: uuid.UUID, session: DbSession) -> FloorRead:
    """Return one floor."""
    return FloorRead.model_validate(service.get_floor(session, floor_id))


@router.patch(
    "/floors/{floor_id}",
    response_model=FloorRead,
    dependencies=[ADMIN_ONLY],
    summary="Update a floor",
)
def update_floor(floor_id: uuid.UUID, payload: FloorUpdate, session: DbSession) -> FloorRead:
    """Apply a partial update. A floor cannot be moved to another building."""
    floor = service.update_floor(session, floor_id, payload)
    session.commit()
    return FloorRead.model_validate(floor)


@router.delete(
    "/floors/{floor_id}",
    response_model=DeleteResult,
    dependencies=[ADMIN_ONLY],
    summary="Delete a floor",
)
def delete_floor(floor_id: uuid.UUID, session: DbSession) -> DeleteResult:
    """Delete a floor and its seats, or 409 when incidents point at them."""
    result = service.delete_floor(session, floor_id)
    session.commit()
    return result


# --- Seats -------------------------------------------------------------------


@router.get(
    "/floors/{floor_id}/seats",
    response_model=Page[SeatRead],
    dependencies=[SIGNED_IN],
    summary="List a floor's seats",
)
def list_seats(
    floor_id: uuid.UUID,
    session: DbSession,
    paging: Paging,
    include_inactive: IncludeInactive,
    seat_type: SeatTypeFilter = None,
) -> Page[SeatRead]:
    """Return one page of seats, ordered by code."""
    rows, total = service.list_seats(
        session,
        floor_id=floor_id,
        include_inactive=include_inactive,
        seat_type=seat_type,
        paging=paging,
    )
    items = [SeatRead.model_validate(row) for row in rows]
    return build_page(items, total=total, params=paging)


@router.post(
    "/floors/{floor_id}/seats",
    response_model=SeatRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Add a seat to a floor",
)
def create_seat(floor_id: uuid.UUID, payload: SeatCreate, session: DbSession) -> SeatRead:
    """Create a seat. `code` must be unique within the floor."""
    seat = service.create_seat(session, floor_id=floor_id, payload=payload)
    session.commit()
    return SeatRead.model_validate(seat)


@router.post(
    "/floors/{floor_id}/seats/bulk",
    response_model=SeatBulkResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
    summary="Add many seats to a floor at once",
)
def bulk_create_seats(
    floor_id: uuid.UUID,
    payload: SeatBulkCreate,
    session: DbSession,
) -> SeatBulkResult:
    """Create every code that does not already exist on this floor.

    Codes the floor already has are reported in `skipped_codes` rather than
    failing the request, so re-pasting a list is safe.
    """
    created, skipped = service.bulk_create_seats(session, floor_id=floor_id, payload=payload)
    session.commit()
    return SeatBulkResult(
        created=[SeatRead.model_validate(seat) for seat in created],
        skipped_codes=skipped,
        created_count=len(created),
        skipped_count=len(skipped),
    )


@router.get(
    "/seats/{seat_id}",
    response_model=SeatRead,
    dependencies=[SIGNED_IN],
    summary="Get a seat",
)
def get_seat(seat_id: uuid.UUID, session: DbSession) -> SeatRead:
    """Return one seat."""
    return SeatRead.model_validate(service.get_seat(session, seat_id))


@router.patch(
    "/seats/{seat_id}",
    response_model=SeatRead,
    dependencies=[ADMIN_ONLY],
    summary="Update a seat",
)
def update_seat(seat_id: uuid.UUID, payload: SeatUpdate, session: DbSession) -> SeatRead:
    """Apply a partial update. A seat cannot be moved to another floor."""
    seat = service.update_seat(session, seat_id, payload)
    session.commit()
    return SeatRead.model_validate(seat)


@router.delete(
    "/seats/{seat_id}",
    response_model=DeleteResult,
    dependencies=[ADMIN_ONLY],
    summary="Delete a seat",
)
def delete_seat(seat_id: uuid.UUID, session: DbSession) -> DeleteResult:
    """Delete a seat, or 409 when incidents point at it."""
    result = service.delete_seat(session, seat_id)
    session.commit()
    return result


# --- Tree --------------------------------------------------------------------


@router.get(
    "/facilities/tree",
    response_model=FacilityTree,
    dependencies=[SIGNED_IN],
    summary="The whole buildings, floors and seats hierarchy",
)
def get_facility_tree(session: DbSession, include_inactive: IncludeInactive) -> FacilityTree:
    """Return every building with its floors and seats nested inside.

    This is what the report form's location picker loads: one request, three
    queries, and no round trip per level.
    """
    buildings = service.load_tree(session, include_inactive=include_inactive)
    return FacilityTree(buildings=[_to_building_node(building) for building in buildings])


def _to_building_node(building: Building) -> BuildingNode:
    """Convert one eagerly-loaded building into its tree node.

    `model_validate` walks the already-loaded `floors` and `seats`
    relationships, so this issues no further queries.
    """
    return BuildingNode(
        **BuildingRead.model_validate(building).model_dump(),
        floors=[_to_floor_node(floor) for floor in building.floors],
    )


def _to_floor_node(floor: Floor) -> FloorNode:
    """Convert one eagerly-loaded floor into its tree node."""
    return FloorNode(
        **FloorRead.model_validate(floor).model_dump(),
        seats=[SeatRead.model_validate(seat) for seat in floor.seats],
    )
