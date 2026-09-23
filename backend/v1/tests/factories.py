"""Helpers for building database rows in tests.

Kept deliberately thin: plain functions with keyword defaults rather than a
factory library, so a test reads as ordinary Python and nothing is hidden.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.enums import (
    AvailabilityStatus,
    BlockedReasonType,
    CloseReason,
    EngineerLevel,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    NoteVisibility,
    SeatType,
    UserRole,
)
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.seat import Seat
from app.models.user import User
from app.security.passwords import hash_password

#: Password used by every test account unless one is passed explicitly.
DEFAULT_PASSWORD = "correct-horse-battery-staple"


def make_user(
    session: Session,
    *,
    email: str | None = None,
    full_name: str = "Test User",
    role: UserRole = UserRole.EMPLOYEE,
    password: str = DEFAULT_PASSWORD,
    is_active: bool = True,
    must_change_password: bool = False,
) -> User:
    """Insert a user and return it. The email is unique unless one is given."""
    user = User(
        email=email or f"user-{uuid.uuid4().hex[:12]}@acme.inc",
        full_name=full_name,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
        must_change_password=must_change_password,
    )
    session.add(user)
    session.flush()
    return user


def make_engineer(
    session: Session,
    *,
    level: EngineerLevel = EngineerLevel.JUNIOR,
    availability: AvailabilityStatus = AvailabilityStatus.AVAILABLE,
    max_active_tickets: int = 10,
    **user_kwargs: Any,
) -> User:
    """Insert an ENGINEER user together with its one-to-one profile."""
    user_kwargs.setdefault("full_name", f"{level.value.title()} Engineer")
    user = make_user(session, role=UserRole.ENGINEER, **user_kwargs)
    session.add(
        EngineerProfile(
            user_id=user.id,
            level=level,
            availability=availability,
            max_active_tickets=max_active_tickets,
        )
    )
    session.flush()
    session.refresh(user)
    return user


def make_admin(session: Session, **user_kwargs: Any) -> User:
    """Insert a FACILITY_ADMIN user."""
    user_kwargs.setdefault("full_name", "Facility Admin")
    return make_user(session, role=UserRole.FACILITY_ADMIN, **user_kwargs)


def make_building(
    session: Session,
    *,
    name: str | None = None,
    code: str | None = None,
    address: str | None = None,
    is_active: bool = True,
) -> Building:
    """Insert a building. Name and code are unique unless given."""
    suffix = uuid.uuid4().hex[:8]
    building = Building(
        name=name or f"Building {suffix}",
        code=code or f"B-{suffix.upper()}",
        address=address,
        is_active=is_active,
    )
    session.add(building)
    session.flush()
    return building


def make_floor(
    session: Session,
    building: Building,
    *,
    name: str = "Level 1",
    level_number: int = 1,
    is_active: bool = True,
) -> Floor:
    """Insert a floor of `building`."""
    floor = Floor(
        building_id=building.id,
        name=name,
        level_number=level_number,
        is_active=is_active,
    )
    session.add(floor)
    session.flush()
    return floor


def make_seat(
    session: Session,
    floor: Floor,
    *,
    code: str | None = None,
    seat_type: SeatType = SeatType.DESK,
    is_active: bool = True,
) -> Seat:
    """Insert a seat on `floor`."""
    seat = Seat(
        floor_id=floor.id,
        code=code or f"S-{uuid.uuid4().hex[:6]}",
        seat_type=seat_type,
        is_active=is_active,
    )
    session.add(seat)
    session.flush()
    return seat


def make_category(
    session: Session,
    *,
    name: str | None = None,
    parent: Category | None = None,
    hint: str | None = None,
    icon: str | None = None,
    location_detail: LocationDetail = LocationDetail.FLOOR,
    sort_order: int = 0,
    is_active: bool = True,
) -> Category:
    """Insert a category group, or a subcategory when `parent` is given."""
    category = Category(
        parent_id=parent.id if parent is not None else None,
        name=name or f"Category {uuid.uuid4().hex[:8]}",
        hint=hint,
        icon=icon,
        location_detail=parent.location_detail if parent is not None else location_detail,
        sort_order=sort_order,
        is_active=is_active,
    )
    session.add(category)
    session.flush()
    return category


def make_incident(
    session: Session,
    *,
    reporter: User,
    category: Category,
    building: Building,
    floor: Floor | None = None,
    seat: Seat | None = None,
    assignee: User | None = None,
    status: IncidentStatus = IncidentStatus.OPEN,
    priority: IncidentPriority = IncidentPriority.MEDIUM,
    title: str = "Something is broken",
    description: str = "It stopped working this morning and has not recovered.",
    is_escalated: bool = False,
    escalation_reason: str | None = None,
    assigned_at: datetime | None = None,
    acknowledged_at: datetime | None = None,
    resolved_at: datetime | None = None,
    closed_at: datetime | None = None,
    close_reason: CloseReason | None = None,
    reopen_count: int = 0,
) -> Incident:
    """Insert an incident in whatever state the test needs it to start in.

    Everything is a keyword with a sensible default, so a test about the reopen
    window says `closed_at=...` and nothing else, and a test about assignment
    says `assignee=...` and nothing else.

    A BLOCKED incident is given a reason automatically: the table's CHECK
    constraint requires one, and a test about workload counts should not have
    to know that. An escalated one is given a reason and a timestamp for the
    same reason — the columns are meant to travel together.
    """
    incident = Incident(
        title=title,
        description=description,
        category_id=category.id,
        building_id=building.id,
        floor_id=floor.id if floor is not None else None,
        seat_id=seat.id if seat is not None else None,
        reporter_id=reporter.id,
        assignee_id=assignee.id if assignee is not None else None,
        status=status,
        priority=priority,
        blocked_reason_type=(
            BlockedReasonType.WAITING_ON_PARTS if status == IncidentStatus.BLOCKED else None
        ),
        is_escalated=is_escalated,
        escalation_reason=(
            escalation_reason or ("Nobody has looked at this" if is_escalated else None)
        ),
        escalated_at=utc_now() if is_escalated else None,
        escalated_by=reporter.id if is_escalated else None,
        assigned_at=assigned_at or (utc_now() if assignee is not None else None),
        acknowledged_at=acknowledged_at,
        resolved_at=resolved_at,
        closed_at=closed_at,
        close_reason=close_reason,
        reopen_count=reopen_count,
    )
    session.add(incident)
    session.flush()
    session.refresh(incident)
    return incident


def make_note(
    session: Session,
    *,
    incident: Incident,
    author: User,
    body: str = "Taking a look at this now.",
    visibility: NoteVisibility = NoteVisibility.PUBLIC,
    created_at: datetime | None = None,
) -> IncidentNote:
    """Insert a note. `created_at` is settable so edit-window tests can age one."""
    note = IncidentNote(
        incident_id=incident.id,
        author_id=author.id,
        body=body,
        visibility=visibility,
    )
    if created_at is not None:
        note.created_at = created_at
    session.add(note)
    session.flush()
    session.refresh(note)
    return note


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> str:
    """Sign in through the API and return the access token."""
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    """Return the Authorization header for a bearer token."""
    return {"Authorization": f"Bearer {token}"}
