"""Domain enumerations.

Each of these is a real PostgreSQL enum type as well as a Python ``StrEnum``.
The database type name is the ``snake_case`` form of the class name and is
declared once in ``ENUM_TYPES`` below, which the initial migration uses to
create every type before any table refers to it.

``StrEnum`` members compare equal to their string value, so a value read back
from the database, parsed from JSON, or written in a test all behave the same.
"""

from enum import StrEnum


class UserRole(StrEnum):
    """What a user is allowed to do. One role per user."""

    EMPLOYEE = "EMPLOYEE"
    ENGINEER = "ENGINEER"
    FACILITY_ADMIN = "FACILITY_ADMIN"


class EngineerLevel(StrEnum):
    """Seniority of an engineer, which governs assignment rights."""

    JUNIOR = "JUNIOR"
    SENIOR = "SENIOR"
    LEAD = "LEAD"


class IncidentStatus(StrEnum):
    """Where an incident sits in the workflow."""

    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


#: The statuses that count as live work. An engineer's `active_ticket_count`
#: and the capacity warnings in `services/assignment.py` are both defined in
#: terms of this, so "active" means one thing across the whole application.
ACTIVE_INCIDENT_STATUSES: tuple[IncidentStatus, ...] = (
    IncidentStatus.OPEN,
    IncidentStatus.IN_PROGRESS,
    IncidentStatus.BLOCKED,
)


class IncidentPriority(StrEnum):
    """How urgent an incident is. Ordered least to most urgent."""

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class BlockedReasonType(StrEnum):
    """Why work on an incident cannot continue."""

    WAITING_ON_PARTS = "WAITING_ON_PARTS"
    WAITING_ON_EMPLOYEE = "WAITING_ON_EMPLOYEE"
    WAITING_ON_VENDOR = "WAITING_ON_VENDOR"
    ACCESS_REQUIRED = "ACCESS_REQUIRED"
    OTHER = "OTHER"


class CloseReason(StrEnum):
    """Why an incident was closed."""

    CONFIRMED_FIXED = "CONFIRMED_FIXED"
    CLOSED_BY_ENGINEER = "CLOSED_BY_ENGINEER"
    DUPLICATE = "DUPLICATE"
    INVALID = "INVALID"
    CANCELLED_BY_REPORTER = "CANCELLED_BY_REPORTER"
    ADMIN_CLOSED = "ADMIN_CLOSED"


class NoteVisibility(StrEnum):
    """Who can read a note. INTERNAL notes are hidden from employees."""

    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"


class AvailabilityStatus(StrEnum):
    """Whether an engineer is currently able to take work."""

    AVAILABLE = "AVAILABLE"
    BUSY = "BUSY"
    OFF_DUTY = "OFF_DUTY"
    ON_LEAVE = "ON_LEAVE"


class SeatType(StrEnum):
    """What kind of place a seat record describes."""

    DESK = "DESK"
    MEETING_ROOM = "MEETING_ROOM"
    COMMON_AREA = "COMMON_AREA"
    OTHER = "OTHER"


class LocationDetail(StrEnum):
    """How precise a location a category group needs when reporting."""

    BUILDING = "BUILDING"
    FLOOR = "FLOOR"
    SEAT = "SEAT"


class EventType(StrEnum):
    """Kinds of entry in an incident's append-only audit log."""

    CREATED = "CREATED"
    STATUS_CHANGED = "STATUS_CHANGED"
    ASSIGNED = "ASSIGNED"
    UNASSIGNED = "UNASSIGNED"
    PRIORITY_CHANGED = "PRIORITY_CHANGED"
    ESCALATED = "ESCALATED"
    ESCALATION_CLEARED = "ESCALATION_CLEARED"
    NOTE_ADDED = "NOTE_ADDED"
    MARKED_DUPLICATE = "MARKED_DUPLICATE"
    REOPENED = "REOPENED"


#: PostgreSQL type name -> Python enum. The single source of truth for which
#: enum types exist; the initial migration creates and drops exactly these.
ENUM_TYPES: dict[str, type[StrEnum]] = {
    "user_role": UserRole,
    "engineer_level": EngineerLevel,
    "incident_status": IncidentStatus,
    "incident_priority": IncidentPriority,
    "blocked_reason_type": BlockedReasonType,
    "close_reason": CloseReason,
    "note_visibility": NoteVisibility,
    "availability_status": AvailabilityStatus,
    "seat_type": SeatType,
    "location_detail": LocationDetail,
    "event_type": EventType,
}
