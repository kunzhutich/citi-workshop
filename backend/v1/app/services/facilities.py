"""Rules for buildings, floors and seats.

Three rules live here and nowhere else:

* **Uniqueness.** A building's name and code, a floor's level number within its
  building, a seat's code within its floor. Each is checked before the write so
  the caller gets a 409 naming the field, rather than a database error.
* **Deletion versus deactivation.** A facility an incident points at is never
  removed — the ticket's location would become unreadable. The delete is
  refused with a 409 and the count of referencing tickets; the admin
  deactivates it instead, with `PATCH {"is_active": false}`.
* **Code normalisation.** Building codes are uppercased, so `sfo-1` and `SFO-1`
  cannot both exist.

Deactivation deliberately does **not** cascade. A floor of a deactivated
building stays active in its own row, and the tree query simply never reaches
it, so reactivating the building restores exactly what was there before.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.errors import ConflictError, NotFoundError
from app.models.building import Building
from app.models.enums import SeatType
from app.models.floor import Floor
from app.models.seat import Seat
from app.repositories import facilities as repository
from app.schemas.common import DeleteResult, PageParams
from app.schemas.facility import (
    BuildingCreate,
    BuildingUpdate,
    FloorCreate,
    FloorUpdate,
    SeatBulkCreate,
    SeatCreate,
    SeatUpdate,
)

# --- Buildings ---------------------------------------------------------------


def list_buildings(
    session: Session,
    *,
    include_inactive: bool,
    paging: PageParams,
) -> tuple[Sequence[Building], int]:
    """Return one page of buildings and the total number matching."""
    return repository.list_buildings(
        session,
        include_inactive=include_inactive,
        limit=paging.page_size,
        offset=paging.offset,
    )


def get_building(session: Session, building_id: uuid.UUID) -> Building:
    """Return one building, or raise `NotFoundError`."""
    building = repository.get_building(session, building_id)
    if building is None:
        raise NotFoundError("That building does not exist.", code="BUILDING_NOT_FOUND")
    return building


def create_building(session: Session, payload: BuildingCreate) -> Building:
    """Create a building, refusing a duplicate name or code."""
    code = _normalise_code(payload.code)
    _require_free_building_name(session, payload.name)
    _require_free_building_code(session, code)

    building = Building(name=payload.name, code=code, address=payload.address)
    session.add(building)
    session.flush()
    return building


def update_building(session: Session, building_id: uuid.UUID, payload: BuildingUpdate) -> Building:
    """Apply a partial update to a building.

    Only fields present in the request body are touched, so sending
    `{"is_active": false}` deactivates without disturbing the address.
    """
    building = get_building(session, building_id)
    changes = payload.model_dump(exclude_unset=True)

    if "name" in changes:
        _require_free_building_name(session, changes["name"], exclude_id=building.id)
    if "code" in changes:
        changes["code"] = _normalise_code(changes["code"])
        _require_free_building_code(session, changes["code"], exclude_id=building.id)

    for field, value in changes.items():
        setattr(building, field, value)
    session.flush()
    return building


def delete_building(session: Session, building_id: uuid.UUID) -> DeleteResult:
    """Delete a building, or refuse when tickets still point inside it.

    Floors and seats go with it — the foreign keys cascade — which is safe
    precisely because the reference check has already proved no incident
    mentions any of them.
    """
    building = get_building(session, building_id)
    referencing = repository.count_incidents_in_building(session, building.id)
    if referencing:
        raise ConflictError(
            f"{referencing} incident(s) were reported in this building. "
            "Deactivate it instead of deleting it.",
            code="BUILDING_IN_USE",
        )

    session.delete(building)
    session.flush()
    return DeleteResult(
        id=building_id,
        deleted=True,
        deactivated=False,
        detail="Building deleted, with its floors and seats.",
    )


# --- Floors ------------------------------------------------------------------


def list_floors(
    session: Session,
    *,
    building_id: uuid.UUID,
    include_inactive: bool,
    paging: PageParams,
) -> tuple[Sequence[Floor], int]:
    """Return one page of a building's floors. 404s if the building is unknown."""
    get_building(session, building_id)
    return repository.list_floors(
        session,
        building_id=building_id,
        include_inactive=include_inactive,
        limit=paging.page_size,
        offset=paging.offset,
    )


def get_floor(session: Session, floor_id: uuid.UUID) -> Floor:
    """Return one floor, or raise `NotFoundError`."""
    floor = repository.get_floor(session, floor_id)
    if floor is None:
        raise NotFoundError("That floor does not exist.", code="FLOOR_NOT_FOUND")
    return floor


def create_floor(session: Session, *, building_id: uuid.UUID, payload: FloorCreate) -> Floor:
    """Add a floor to a building, refusing a duplicate level number."""
    building = get_building(session, building_id)
    _require_free_floor_level(session, building_id=building.id, level_number=payload.level_number)

    floor = Floor(
        building_id=building.id,
        name=payload.name,
        level_number=payload.level_number,
    )
    session.add(floor)
    session.flush()
    return floor


def update_floor(session: Session, floor_id: uuid.UUID, payload: FloorUpdate) -> Floor:
    """Apply a partial update to a floor. Its building cannot change."""
    floor = get_floor(session, floor_id)
    changes = payload.model_dump(exclude_unset=True)

    if "level_number" in changes:
        _require_free_floor_level(
            session,
            building_id=floor.building_id,
            level_number=changes["level_number"],
            exclude_id=floor.id,
        )

    for field, value in changes.items():
        setattr(floor, field, value)
    session.flush()
    return floor


def delete_floor(session: Session, floor_id: uuid.UUID) -> DeleteResult:
    """Delete a floor and its seats, or refuse when tickets point at them."""
    floor = get_floor(session, floor_id)
    referencing = repository.count_incidents_on_floor(session, floor.id)
    if referencing:
        raise ConflictError(
            f"{referencing} incident(s) were reported on this floor. "
            "Deactivate it instead of deleting it.",
            code="FLOOR_IN_USE",
        )

    session.delete(floor)
    session.flush()
    return DeleteResult(
        id=floor_id,
        deleted=True,
        deactivated=False,
        detail="Floor deleted, with its seats.",
    )


# --- Seats -------------------------------------------------------------------


def list_seats(
    session: Session,
    *,
    floor_id: uuid.UUID,
    include_inactive: bool,
    seat_type: SeatType | None,
    paging: PageParams,
) -> tuple[Sequence[Seat], int]:
    """Return one page of a floor's seats. 404s if the floor is unknown.

    `seat_type` exists for the questionnaire's meeting-room case: a category
    group with `location_detail = SEAT` for Meeting Rooms lists only
    `MEETING_ROOM` seats.
    """
    get_floor(session, floor_id)
    return repository.list_seats(
        session,
        floor_id=floor_id,
        include_inactive=include_inactive,
        seat_type=seat_type.value if seat_type is not None else None,
        limit=paging.page_size,
        offset=paging.offset,
    )


def get_seat(session: Session, seat_id: uuid.UUID) -> Seat:
    """Return one seat, or raise `NotFoundError`."""
    seat = repository.get_seat(session, seat_id)
    if seat is None:
        raise NotFoundError("That seat does not exist.", code="SEAT_NOT_FOUND")
    return seat


def create_seat(session: Session, *, floor_id: uuid.UUID, payload: SeatCreate) -> Seat:
    """Add a seat to a floor, refusing a duplicate code."""
    floor = get_floor(session, floor_id)
    _require_free_seat_code(session, floor_id=floor.id, code=payload.code)

    seat = Seat(floor_id=floor.id, code=payload.code, seat_type=payload.seat_type)
    session.add(seat)
    session.flush()
    return seat


def bulk_create_seats(
    session: Session,
    *,
    floor_id: uuid.UUID,
    payload: SeatBulkCreate,
) -> tuple[list[Seat], list[str]]:
    """Create many seats at once, skipping codes the floor already has.

    Returns ``(created, skipped_codes)``. Codes that already exist are reported
    rather than failing the request: the admin screen takes a pasted list, and
    re-pasting a list with one new desk in it is the normal way to use it.

    Duplicates *within* the payload are collapsed, keeping the first occurrence,
    so a list pasted twice by accident inserts each code once.
    """
    floor = get_floor(session, floor_id)

    unique_codes = _deduplicate(payload.codes)
    already_present = repository.existing_seat_codes(
        session,
        floor_id=floor.id,
        codes=unique_codes,
    )

    created: list[Seat] = []
    skipped: list[str] = []
    for code in unique_codes:
        if code in already_present:
            skipped.append(code)
            continue
        seat = Seat(floor_id=floor.id, code=code, seat_type=payload.seat_type)
        session.add(seat)
        created.append(seat)

    session.flush()
    return created, skipped


def update_seat(session: Session, seat_id: uuid.UUID, payload: SeatUpdate) -> Seat:
    """Apply a partial update to a seat. Its floor cannot change."""
    seat = get_seat(session, seat_id)
    changes = payload.model_dump(exclude_unset=True)

    if "code" in changes:
        _require_free_seat_code(
            session,
            floor_id=seat.floor_id,
            code=changes["code"],
            exclude_id=seat.id,
        )

    for field, value in changes.items():
        setattr(seat, field, value)
    session.flush()
    return seat


def delete_seat(session: Session, seat_id: uuid.UUID) -> DeleteResult:
    """Delete a seat, or refuse when tickets point at it."""
    seat = get_seat(session, seat_id)
    referencing = repository.count_incidents_at_seat(session, seat.id)
    if referencing:
        raise ConflictError(
            f"{referencing} incident(s) were reported at this seat. "
            "Deactivate it instead of deleting it.",
            code="SEAT_IN_USE",
        )

    session.delete(seat)
    session.flush()
    return DeleteResult(
        id=seat_id,
        deleted=True,
        deactivated=False,
        detail="Seat deleted.",
    )


# --- Tree --------------------------------------------------------------------


def load_tree(session: Session, *, include_inactive: bool) -> Sequence[Building]:
    """Return the whole buildings → floors → seats hierarchy."""
    return repository.load_tree(session, include_inactive=include_inactive)


# --- Internal helpers --------------------------------------------------------


def _normalise_code(code: str) -> str:
    """Return a building code in its canonical form.

    Uppercased because a code is an identifier a human types into a search box;
    without this, `sfo-1` and `SFO-1` are two buildings as far as the unique
    constraint is concerned.
    """
    return code.strip().upper()


def _deduplicate(codes: list[str]) -> list[str]:
    """Return `codes` with repeats removed, preserving the original order."""
    seen: set[str] = set()
    unique: list[str] = []
    for code in codes:
        if code not in seen:
            seen.add(code)
            unique.append(code)
    return unique


def _require_free_building_name(
    session: Session,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise `ConflictError` when another building already uses this name."""
    if repository.building_name_taken(session, name, exclude_id=exclude_id):
        raise ConflictError(
            "A building with that name already exists.",
            code="BUILDING_NAME_TAKEN",
            field="name",
        )


def _require_free_building_code(
    session: Session,
    code: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise `ConflictError` when another building already uses this code."""
    if repository.building_code_taken(session, code, exclude_id=exclude_id):
        raise ConflictError(
            "A building with that code already exists.",
            code="BUILDING_CODE_TAKEN",
            field="code",
        )


def _require_free_floor_level(
    session: Session,
    *,
    building_id: uuid.UUID,
    level_number: int,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise `ConflictError` when the building already has this level number."""
    if repository.floor_level_taken(
        session,
        building_id=building_id,
        level_number=level_number,
        exclude_id=exclude_id,
    ):
        raise ConflictError(
            "That building already has a floor with this level number.",
            code="FLOOR_LEVEL_TAKEN",
            field="level_number",
        )


def _require_free_seat_code(
    session: Session,
    *,
    floor_id: uuid.UUID,
    code: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise `ConflictError` when the floor already has a seat with this code."""
    if repository.seat_code_taken(session, floor_id=floor_id, code=code, exclude_id=exclude_id):
        raise ConflictError(
            "That floor already has a seat with this code.",
            code="SEAT_CODE_TAKEN",
            field="code",
        )
