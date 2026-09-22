"""Queries over buildings, floors and seats.

Every statement the facility endpoints run lives here, including the
"is this still referenced?" checks that decide whether a delete is allowed.
Those are written as `SELECT count(*)` rather than loading rows: the caller
only needs the number, and an admin deleting a building that turns out to hold
four hundred tickets should not pull four hundred rows to find that out.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.building import Building
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.seat import Seat

# --- Buildings ---------------------------------------------------------------


def list_buildings(
    session: Session,
    *,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[Sequence[Building], int]:
    """Return one page of buildings ordered by code, and the total count."""
    statement = select(Building)
    if not include_inactive:
        statement = statement.where(Building.is_active)

    total = _count(session, statement)
    rows = session.scalars(statement.order_by(Building.code).limit(limit).offset(offset)).all()
    return rows, total


def get_building(session: Session, building_id: uuid.UUID) -> Building | None:
    """Return one building by id."""
    return session.get(Building, building_id)


def building_name_taken(
    session: Session,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """Return whether another building already uses this name.

    Compared case-insensitively: `buildings.name` is plain `TEXT`, so the
    database would happily hold both "SF HQ" and "sf hq" and an admin would
    have no way to tell them apart in a dropdown.
    """
    statement = select(Building.id).where(func.lower(Building.name) == name.lower())
    if exclude_id is not None:
        statement = statement.where(Building.id != exclude_id)
    return session.scalars(statement.limit(1)).first() is not None


def building_code_taken(
    session: Session,
    code: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """Return whether another building already uses this code."""
    statement = select(Building.id).where(Building.code == code)
    if exclude_id is not None:
        statement = statement.where(Building.id != exclude_id)
    return session.scalars(statement.limit(1)).first() is not None


def count_incidents_in_building(session: Session, building_id: uuid.UUID) -> int:
    """Return how many incidents point anywhere inside this building.

    The three clauses are belt and braces. `incidents.building_id` alone should
    be enough, because the incident service refuses a floor or seat that does
    not belong to the building it was filed against — but that invariant lives
    in application code, and a delete that loses data is not the place to trust
    it.
    """
    floor_ids = select(Floor.id).where(Floor.building_id == building_id)
    seat_ids = (
        select(Seat.id)
        .join(Floor, Seat.floor_id == Floor.id)
        .where(Floor.building_id == building_id)
    )
    statement = select(func.count(Incident.id)).where(
        or_(
            Incident.building_id == building_id,
            Incident.floor_id.in_(floor_ids),
            Incident.seat_id.in_(seat_ids),
        )
    )
    return session.scalars(statement).one()


# --- Floors ------------------------------------------------------------------


def list_floors(
    session: Session,
    *,
    building_id: uuid.UUID,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[Sequence[Floor], int]:
    """Return one page of a building's floors, lowest level first."""
    statement = select(Floor).where(Floor.building_id == building_id)
    if not include_inactive:
        statement = statement.where(Floor.is_active)

    total = _count(session, statement)
    rows = session.scalars(statement.order_by(Floor.level_number).limit(limit).offset(offset)).all()
    return rows, total


def get_floor(session: Session, floor_id: uuid.UUID) -> Floor | None:
    """Return one floor by id."""
    return session.get(Floor, floor_id)


def floor_level_taken(
    session: Session,
    *,
    building_id: uuid.UUID,
    level_number: int,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """Return whether this building already has a floor at this level number."""
    statement = select(Floor.id).where(
        Floor.building_id == building_id,
        Floor.level_number == level_number,
    )
    if exclude_id is not None:
        statement = statement.where(Floor.id != exclude_id)
    return session.scalars(statement.limit(1)).first() is not None


def count_incidents_on_floor(session: Session, floor_id: uuid.UUID) -> int:
    """Return how many incidents point at this floor or at a seat on it."""
    seat_ids = select(Seat.id).where(Seat.floor_id == floor_id)
    statement = select(func.count(Incident.id)).where(
        or_(Incident.floor_id == floor_id, Incident.seat_id.in_(seat_ids))
    )
    return session.scalars(statement).one()


# --- Seats -------------------------------------------------------------------


def list_seats(
    session: Session,
    *,
    floor_id: uuid.UUID,
    include_inactive: bool,
    seat_type: str | None,
    limit: int,
    offset: int,
) -> tuple[Sequence[Seat], int]:
    """Return one page of a floor's seats ordered by code."""
    statement = select(Seat).where(Seat.floor_id == floor_id)
    if not include_inactive:
        statement = statement.where(Seat.is_active)
    if seat_type is not None:
        statement = statement.where(Seat.seat_type == seat_type)

    total = _count(session, statement)
    rows = session.scalars(statement.order_by(Seat.code).limit(limit).offset(offset)).all()
    return rows, total


def get_seat(session: Session, seat_id: uuid.UUID) -> Seat | None:
    """Return one seat by id."""
    return session.get(Seat, seat_id)


def seat_code_taken(
    session: Session,
    *,
    floor_id: uuid.UUID,
    code: str,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """Return whether this floor already has a seat with this code."""
    statement = select(Seat.id).where(Seat.floor_id == floor_id, Seat.code == code)
    if exclude_id is not None:
        statement = statement.where(Seat.id != exclude_id)
    return session.scalars(statement.limit(1)).first() is not None


def existing_seat_codes(session: Session, *, floor_id: uuid.UUID, codes: list[str]) -> set[str]:
    """Return which of `codes` this floor already uses.

    One query for the whole batch — the bulk-create endpoint would otherwise
    issue a lookup per pasted line.
    """
    if not codes:
        return set()
    statement = select(Seat.code).where(Seat.floor_id == floor_id, Seat.code.in_(codes))
    return set(session.scalars(statement).all())


def count_incidents_at_seat(session: Session, seat_id: uuid.UUID) -> int:
    """Return how many incidents point at this seat."""
    statement = select(func.count(Incident.id)).where(Incident.seat_id == seat_id)
    return session.scalars(statement).one()


# --- Tree --------------------------------------------------------------------


def load_tree(session: Session, *, include_inactive: bool) -> Sequence[Building]:
    """Return every building with its floors and seats eagerly loaded.

    Three queries in total, not one per row: `selectinload` issues one
    statement per level, and the `.and_()` on each relationship pushes the
    active-only filter into that statement rather than filtering in Python.
    """
    seats_loader = (
        selectinload(Building.floors).selectinload(Floor.seats)
        if include_inactive
        else selectinload(Building.floors.and_(Floor.is_active)).selectinload(
            Floor.seats.and_(Seat.is_active)
        )
    )

    statement = select(Building).options(seats_loader).order_by(Building.code)
    if not include_inactive:
        statement = statement.where(Building.is_active)

    return session.scalars(statement).unique().all()


def _count(session: Session, statement: Select[tuple[Any]]) -> int:
    """Return how many rows the given filtered statement matches.

    Wrapping the caller's statement as a subquery means the filters are written
    once, for the page and its total alike, rather than being kept in step by
    hand.
    """
    return session.scalars(select(func.count()).select_from(statement.subquery())).one()
