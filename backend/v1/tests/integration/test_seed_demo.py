"""The `seed_demo` generator, at a scale small enough to reason about.

Generating three hundred incidents to prove that a generator produces
incidents is a slow way to learn nothing, so everything here runs against
`SMALL`: sixty tickets, eight employees, the same ninety-day span. The one
thing asserted at full scale is that `DEFAULT_SPEC` still says what BUILD-PLAN
section 15 asks it to say.

**What is asserted, and what is deliberately not.** The data is random, so
nothing here states a value it cannot derive. The tests state *shape* —
counts, relationships, orderings, and the one property the whole exercise
exists for: that the event log is backdated, so the timing reports have
something to measure. `DemoSpec.random_seed` makes a run reproducible, so
these are deterministic despite being about random data.

Everything runs through `seed_demo(db_session, ...)` rather than through the
`seed_demo` ops action, which would commit. The ops tests deliberately commit
and the suite recreates the database once per session to cope with that; a
committed demo world would then be visible to every test that ran afterwards,
including the report tests, which assert exact counts over their own fixtures.
The action's own behaviour — its place in the registry, its refusal to run
outside local development, its payload validation — is tested in
`tests/unit/test_ops.py`, where none of it needs a database.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.enums import (
    ACTIVE_INCIDENT_STATUSES,
    EngineerLevel,
    EventType,
    IncidentStatus,
    SeatType,
    UserRole,
)
from app.models.event import IncidentEvent
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.seat import Seat
from app.models.user import User
from app.schemas.report import ReportScope, ReportWindow
from app.seed.categories import seed_categories
from app.seed.demo import (
    BUILDING_SEEDS,
    DEFAULT_SPEC,
    DEMO_PASSWORD,
    ENGINEER_SEEDS,
    DemoSeedResult,
    DemoSpec,
    seed_demo,
)
from app.services import reporting

#: Small enough to be quick, big enough that every path in `PATH_WEIGHTS` is
#: taken at least once. The seed is fixed, so "at least once" is a fact about
#: this spec rather than a hope about the distribution.
SMALL = DemoSpec(
    min_floors=2,
    max_floors=3,
    min_desks=6,
    max_desks=9,
    employees=8,
    incidents=60,
    hotspots=2,
)


@pytest.fixture
def users_before(db_session: Session) -> set[uuid.UUID]:
    """Return the ids of any accounts that were already there.

    `tests/integration/test_ops_actions.py` exercises `seed_admin` through the
    real Lambda handler, which owns its own session and **commits**; the suite
    recreates the test database only once per session, so those bootstrap
    admins are still present when this file runs. Counting every row in
    `users` would therefore be counting theirs as well, and the count would
    depend on which tests ran first.
    """
    return set(db_session.scalars(select(User.id)).all())


@pytest.fixture
def seeded(db_session: Session, users_before: set[uuid.UUID]) -> tuple[DemoSeedResult, datetime]:
    """Seed the small demo world once and return its result and its `now`.

    Depends on `users_before` so that the snapshot is taken first.

    Categories are reference data seeded by the `migrate` action rather than by
    the Alembic migration, so a freshly migrated test database may not have
    them. `seed_categories` is idempotent, so calling it here is safe whether
    or not an earlier test in the session already committed them.
    """
    seed_categories(db_session)
    now = utc_now()
    return seed_demo(db_session, SMALL, now=now), now


# --- The shape the plan asks for ---------------------------------------------


def test_the_default_spec_is_the_one_build_plan_section_15_asks_for() -> None:
    """The numbers in the brief, asserted where they cannot drift unnoticed."""
    assert DEFAULT_SPEC.buildings == 3
    assert (DEFAULT_SPEC.min_floors, DEFAULT_SPEC.max_floors) == (4, 6)
    assert (DEFAULT_SPEC.min_desks, DEFAULT_SPEC.max_desks) == (20, 40)
    assert (DEFAULT_SPEC.min_meeting_rooms, DEFAULT_SPEC.max_meeting_rooms) == (2, 3)
    assert DEFAULT_SPEC.employees == 30
    assert DEFAULT_SPEC.incidents == 300
    assert DEFAULT_SPEC.days == 90
    assert len(BUILDING_SEEDS) >= DEFAULT_SPEC.buildings
    assert len(ENGINEER_SEEDS) == 6


def test_it_builds_a_whole_facility_tree(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    result, _ = seeded

    assert result.created is True
    assert result.buildings == SMALL.buildings

    floors = db_session.scalars(select(Floor)).all()
    assert len(floors) == result.floors
    per_building = Counter(floor.building_id for floor in floors)
    assert len(per_building) == SMALL.buildings
    for count in per_building.values():
        assert SMALL.min_floors <= count <= SMALL.max_floors

    seats = db_session.scalars(select(Seat)).all()
    assert len(seats) == result.desks + result.meeting_rooms
    by_floor = Counter(seat.floor_id for seat in seats)
    assert len(by_floor) == result.floors

    for floor in floors:
        on_this_floor = [seat for seat in seats if seat.floor_id == floor.id]
        desks = [seat for seat in on_this_floor if seat.seat_type == SeatType.DESK]
        rooms = [seat for seat in on_this_floor if seat.seat_type == SeatType.MEETING_ROOM]
        assert SMALL.min_desks <= len(desks) <= SMALL.max_desks
        assert SMALL.min_meeting_rooms <= len(rooms) <= SMALL.max_meeting_rooms
        # Every seat on a floor has to have a distinct code: the table's unique
        # constraint says so, and a generator that reuses one fails the insert.
        assert len({seat.code for seat in on_this_floor}) == len(on_this_floor)


def test_it_creates_one_admin_six_engineers_and_the_employees(
    db_session: Session,
    seeded: tuple[DemoSeedResult, datetime],
    users_before: set[uuid.UUID],
) -> None:
    result, _ = seeded
    # Only the accounts this run created — see `users_before`.
    users = [user for user in db_session.scalars(select(User)).all() if user.id not in users_before]
    by_role = Counter(user.role for user in users)

    assert by_role[UserRole.FACILITY_ADMIN] == result.admins == 1
    assert by_role[UserRole.ENGINEER] == result.engineers == 6
    assert by_role[UserRole.EMPLOYEE] == result.employees == SMALL.employees
    assert result.users == len(users)
    assert result.demo_password == DEMO_PASSWORD

    # Every account is an ACME address, because `ALLOWED_EMAIL_DOMAIN` is the
    # only domain that can sign in.
    assert all(user.email.endswith("@acme.inc") for user in users)
    assert len({user.email for user in users}) == len(users)
    # Nobody is forced through a password change: a reviewer signing in as six
    # different people should not have to change six passwords first.
    assert not any(user.must_change_password for user in users)


def test_engineers_are_two_per_level_and_cover_every_category_group(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """Assignment rights depend on level, and routing depends on specialty."""
    del seeded
    profiles = db_session.scalars(select(EngineerProfile)).all()
    assert len(profiles) == 6
    assert Counter(profile.level for profile in profiles) == {
        EngineerLevel.JUNIOR: 2,
        EngineerLevel.SENIOR: 2,
        EngineerLevel.LEAD: 2,
    }

    groups = db_session.scalars(select(Category).where(Category.parent_id.is_(None))).all()
    covered = {group_id for profile in profiles for group_id in profile.specialty_group_ids}
    # Every group has at least one engineer who covers it, so no group's
    # tickets are stranded.
    assert {group.id for group in groups} <= covered


# --- The point of the exercise: backdated history ----------------------------


def test_incidents_are_spread_over_the_whole_window_not_stamped_with_now(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """A generator that inserts everything at `now()` fails this and only this.

    Every chart in the phase is a function of `created_at`, so if this test
    ever passes trivially — because one day holds every ticket — the daily
    series, the medians and the ages are all worthless whatever else passes.
    """
    result, now = seeded
    incidents = db_session.scalars(select(Incident).order_by(Incident.created_at)).all()
    assert len(incidents) == result.incidents == SMALL.incidents

    earliest = incidents[0].created_at
    latest = incidents[-1].created_at
    assert earliest >= now - timedelta(days=SMALL.days, hours=1)
    assert latest <= now
    # Spread over most of the window, not clustered in a corner of it.
    assert (latest - earliest) > timedelta(days=SMALL.days * 0.7)

    distinct_days = {incident.created_at.date() for incident in incidents}
    assert len(distinct_days) > SMALL.incidents / 2

    # Ticket numbers follow creation order, as they would in a system that had
    # actually been running for ninety days.
    numbers = [incident.ticket_number for incident in incidents]
    assert numbers == sorted(numbers)


def test_every_event_is_backdated_and_in_order(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """The event log is where `/reports/blocked-escalated` reads ages from.

    Events default to `clock_timestamp()`, so an unset `created_at` stamps the
    whole history with the moment of seeding and every blocked age becomes
    zero. Three things are checked: nothing happened in the future, nothing
    happened before its own ticket was reported, and each ticket opens with a
    CREATED event at exactly the instant it was created.
    """
    result, now = seeded
    incidents = {incident.id: incident for incident in db_session.scalars(select(Incident)).all()}
    events = db_session.scalars(
        select(IncidentEvent).order_by(IncidentEvent.incident_id, IncidentEvent.created_at)
    ).all()
    assert len(events) == result.events > result.incidents

    by_incident: dict[object, list[IncidentEvent]] = {}
    for event in events:
        by_incident.setdefault(event.incident_id, []).append(event)

    assert len(by_incident) == len(incidents)
    # Not everything can have happened today, or the log is not a history.
    assert len({event.created_at.date() for event in events}) > 10

    for incident_id, log in by_incident.items():
        incident = incidents[incident_id]
        assert log[0].event_type == EventType.CREATED
        assert log[0].created_at == incident.created_at
        for event in log:
            assert incident.created_at <= event.created_at <= now
        timestamps = [event.created_at for event in log]
        assert timestamps == sorted(timestamps)


def test_lifecycle_timestamps_are_populated_and_in_the_right_order(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """`/reports/response-times` subtracts these four columns from each other."""
    _, now = seeded
    incidents = db_session.scalars(select(Incident)).all()

    assigned = [row for row in incidents if row.assigned_at is not None]
    acknowledged = [row for row in incidents if row.acknowledged_at is not None]
    resolved = [row for row in incidents if row.resolved_at is not None]
    closed = [row for row in incidents if row.closed_at is not None]

    # All four milestones are represented, or a median over them is NULL.
    assert assigned and acknowledged and resolved and closed

    for incident in incidents:
        stamps = [
            stamp
            for stamp in (
                incident.created_at,
                incident.assigned_at,
                incident.acknowledged_at,
                incident.resolved_at,
                incident.closed_at,
            )
            if stamp is not None
        ]
        assert stamps == sorted(stamps)
        assert stamps[-1] <= now

    # Acknowledgement never precedes assignment, which would make the median
    # time to acknowledge negative.
    for incident in acknowledged:
        assert incident.assigned_at is not None
        assert incident.acknowledged_at >= incident.assigned_at


def test_the_dataset_contains_the_awkward_cases_the_dashboards_are_for(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """Blocked, escalated, duplicate and reopened, as BUILD-PLAN asks."""
    result, _ = seeded

    assert result.blocked_now > 0
    assert result.duplicates > 0
    assert result.reopened > 0
    assert result.unassigned > 0
    # Both kinds of escalation, which is what makes the demo data prove D10 and
    # D11 rather than merely be compatible with them: a live one belongs in the
    # "needs attention" panel and a closed-but-still-flagged one does not.
    assert result.escalated_live > 0
    assert result.escalated_on_closed > 0

    blocked = db_session.scalars(
        select(Incident).where(Incident.status == IncidentStatus.BLOCKED)
    ).all()
    assert len(blocked) == result.blocked_now
    for incident in blocked:
        # The table's CHECK constraint requires this; so does the report, which
        # groups by it.
        assert incident.blocked_reason_type is not None
        assert incident.blocked_reason

    duplicates = db_session.scalars(
        select(Incident).where(Incident.duplicate_of_id.is_not(None))
    ).all()
    for incident in duplicates:
        original = db_session.get(Incident, incident.duplicate_of_id)
        assert original is not None
        # Only ever backwards: the original existed before its duplicate.
        assert original.created_at <= incident.created_at


def test_every_status_and_priority_appears_and_no_single_one_dominates(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """A dashboard needs shape; a dataset that is 95% closed has none."""
    result, _ = seeded
    assert set(result.by_status) == {status.value for status in IncidentStatus}
    assert set(result.by_priority) == {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert len(result.by_category_group) == 5

    live = sum(result.by_status[status.value] for status in ACTIVE_INCIDENT_STATUSES)
    assert live > result.incidents * 0.15

    # Some engineers busier than others, which is one of the questions the
    # admin dashboard exists to answer.
    loads = sorted(result.by_engineer.values())
    assert len(loads) == 6
    assert loads[-1] > loads[0]


# --- The reports, over the generated world -----------------------------------


def test_the_response_time_report_finds_real_medians(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """The end-to-end proof that backdating worked.

    Against a dataset created at `now()` every one of these is zero or null.
    The relative assertions hold by construction rather than by luck:
    `RESPONSE_MEDIANS` makes resolution take far longer than assignment, and
    makes a CRITICAL ticket move faster than a LOW one.
    """
    _, now = seeded
    window = ReportWindow(date_from=now - timedelta(days=SMALL.days), date_to=now, building_id=None)
    report = reporting.response_times(db_session, window)

    assert report.overall.median_assign_hours is not None
    assert report.overall.median_acknowledge_hours is not None
    assert report.overall.median_resolve_hours is not None
    assert report.overall.median_assign_hours > 0
    assert report.overall.median_acknowledge_hours > report.overall.median_assign_hours
    assert report.overall.median_resolve_hours > report.overall.median_acknowledge_hours
    assert report.overall.resolved_count > 0

    by_priority = {row.priority: row for row in report.by_priority}
    critical = by_priority["CRITICAL"].median_resolve_hours
    low = by_priority["LOW"].median_resolve_hours
    assert critical is not None and low is not None
    assert critical < low


def test_the_blocked_report_reads_a_real_age_out_of_the_event_log(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """There is no `blocked_at` column (D6), so this is the event log's proof."""
    _, now = seeded
    report = reporting.blocked_escalated(db_session, ReportScope(as_of=now, building_id=None))

    assert report.blocked_total > 0
    assert report.blocked
    oldest = max(row.max_age_hours or 0.0 for row in report.blocked)
    # A whole day at least: these are blocks that have outlasted the seeding
    # run by weeks, not rows stamped a moment ago.
    assert oldest > 24.0

    # And the escalated half lists only live work, which is D10 and D11. The
    # generated world contains closed tickets that still carry the flag.
    assert report.escalated_total > 0
    assert all(row.status in ACTIVE_INCIDENT_STATUSES for row in report.escalated)


def test_the_communication_report_is_neither_zero_nor_a_perfect_score(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """Notes are backdated too, or "time to first update" has nothing to measure.

    The upper bound is the interesting half. Every resolved ticket gets a note
    saying what was done; if that note were stamped at exactly `resolved_at` it
    would satisfy "the reporter was told something before resolution" on every
    row and pin this at 100%, which is a number no facilities team has ever
    had. `_resolution_steps` puts it a few minutes later for that reason.
    """
    _, now = seeded
    window = ReportWindow(date_from=now - timedelta(days=SMALL.days), date_to=now, building_id=None)
    report = reporting.communication(db_session, window)

    assert report.resolved_total > 0
    assert report.informed_pct is not None
    assert 0.0 < report.informed_pct < 100.0
    assert report.median_first_public_note_hours is not None
    assert report.median_first_public_note_hours > 0


# --- Running it twice --------------------------------------------------------


def test_running_it_twice_changes_nothing_and_says_so(
    db_session: Session, seeded: tuple[DemoSeedResult, datetime]
) -> None:
    """Not idempotent in the sense of topping up — safe in the sense of harmless.

    Half of what the generator writes is unique-constrained (building names and
    codes, user emails) and half is not, so a blind second run would either
    fail an insert or silently double the incident count. It does neither: it
    notices the world is already there and returns without writing.
    """
    _, now = seeded
    before = db_session.scalars(select(func.count()).select_from(Incident)).one()

    second = seed_demo(db_session, SMALL, now=now)

    assert second.created is False
    assert "already present" in second.detail
    assert "does not top up or refresh" in second.detail
    assert second.incidents == 0
    assert db_session.scalars(select(func.count()).select_from(Incident)).one() == before
