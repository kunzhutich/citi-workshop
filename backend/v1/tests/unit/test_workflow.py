"""The transition table, tested by reading it rather than by restating it.

Almost every test here is parametrised over `workflow.TRANSITIONS` itself.
That is the point: a row added to the table without a matching rule change is
caught here, and a row cannot be "forgotten" by the suite because the suite
does not carry its own list of rows to forget it from.

These are pure unit tests. Transitions are decided from an incident's status
and the caller's relationship to it, neither of which needs a database, so the
model objects below are built in memory and never flushed.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app import workflow
from app.models.engineer_profile import EngineerProfile
from app.models.enums import (
    CloseReason,
    EngineerLevel,
    EventType,
    IncidentStatus,
    NoteVisibility,
    UserRole,
)
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.user import User
from app.schemas.incident import TransitionRequest
from app.workflow import AUTOCLOSE_AFTER, TRANSITIONS, Actor, Transition

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=UTC)


def make_user(role: UserRole = UserRole.EMPLOYEE, level: EngineerLevel | None = None) -> User:
    """Build a transient user; no session, no insert."""
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@acme.inc",
        full_name="Test User",
        password_hash="not-a-real-hash",
        role=role,
    )
    if level is not None:
        user.engineer_profile = EngineerProfile(user_id=user.id, level=level)
    return user


def make_incident(
    status: IncidentStatus,
    *,
    reporter_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    closed_at: datetime | None = None,
    resolved_at: datetime | None = None,
    notes: list[IncidentNote] | None = None,
) -> Incident:
    """Build a transient incident in the given state.

    `notes` stands in for the relationship `Incident.last_public_note_at`
    reads, which the auto-close guard reads through. Nothing here is flushed,
    which is the property this whole file rests on: the workflow table is
    checkable without a session, and the newest guard did not change that.
    """
    incident = Incident(
        id=uuid.uuid4(),
        status=status,
        reporter_id=reporter_id or uuid.uuid4(),
        assignee_id=assignee_id,
        closed_at=closed_at,
        resolved_at=resolved_at,
        reopen_count=0,
    )
    incident.notes = notes or []
    return incident


def note(
    *,
    created_at: datetime,
    visibility: NoteVisibility = NoteVisibility.PUBLIC,
    deleted_at: datetime | None = None,
) -> IncidentNote:
    """Build a transient note, for the guard that reads them."""
    return IncidentNote(
        id=uuid.uuid4(),
        incident_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
        body="Checking this is still holding up.",
        visibility=visibility,
        deleted_at=deleted_at,
        created_at=created_at,
    )


def satisfying_incident(transition: Transition, *, actor_id: uuid.UUID) -> Incident:
    """Build an incident in `transition.from_status` whose guard passes."""
    return make_incident(
        transition.from_status,
        reporter_id=actor_id,
        # "Start work" is guarded on the ticket having an owner.
        assignee_id=actor_id,
        # "Reopen" is guarded on the 7-day window.
        closed_at=NOW - timedelta(days=1),
        # "Close automatically" is guarded on the ticket having been quiet for
        # longer than that — so this has to be *outside* the window the line
        # above is inside. One row's satisfying state is another's blocked
        # one, which is why this helper takes the transition at all.
        resolved_at=NOW - workflow.AUTOCLOSE_AFTER - timedelta(days=1),
    )


def ids(transition: Transition) -> str:
    """Readable parametrisation id: 'OPEN->CLOSED (Cancel ticket)'."""
    return (
        f"{transition.from_status.value}->{transition.to_status.value} ({transition.action_label})"
    )


# --- The table is internally consistent --------------------------------------


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_only_closing_transitions_carry_close_reasons(transition: Transition) -> None:
    """A close reason is meaningless on a move that does not close the ticket."""
    if transition.to_status == IncidentStatus.CLOSED:
        assert transition.close_reasons, "a closing transition must record why"
    else:
        assert not transition.close_reasons


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_a_choice_of_close_reasons_is_asked_for(transition: Transition) -> None:
    """Several possible reasons means the caller picks; one means we write it."""
    if len(transition.close_reasons) > 1:
        assert transition.caller_picks_close_reason
        assert transition.fixed_close_reason is None
    elif len(transition.close_reasons) == 1:
        assert not transition.caller_picks_close_reason
        assert transition.fixed_close_reason in transition.close_reasons


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_required_fields_exist_on_the_request_body(transition: Transition) -> None:
    """`required_fields` is what the dialog collects, so it must name real fields."""
    for field in transition.required_fields:
        assert field in TransitionRequest.model_fields, f"no such request field: {field}"


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_every_transition_has_an_actor_and_a_label(transition: Transition) -> None:
    assert transition.allowed_actors
    assert transition.action_label.strip()
    assert transition.from_status != transition.to_status


def test_rows_sharing_a_from_and_to_pair_are_separated_by_actor() -> None:
    """Two rows for the same move must be distinguishable, or selection is a coin toss."""
    by_pair: dict[tuple[IncidentStatus, IncidentStatus], list[Transition]] = {}
    for transition in TRANSITIONS:
        by_pair.setdefault((transition.from_status, transition.to_status), []).append(transition)

    for pair, rows in by_pair.items():
        if len(rows) == 1:
            continue
        for index, row in enumerate(rows):
            for other in rows[index + 1 :]:
                assert not (row.allowed_actors & other.allowed_actors), (
                    f"{pair} has two rows sharing an actor"
                )


def test_reopening_transitions_record_a_reopened_event() -> None:
    """Every other move is a STATUS_CHANGED; the reopens are what reports count."""
    for transition in TRANSITIONS:
        expected = EventType.REOPENED if transition.is_reopen else EventType.STATUS_CHANGED
        assert transition.event_type == expected


# --- Every row admits its actors and refuses everyone else -------------------


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
@pytest.mark.parametrize("actor", list(Actor))
def test_each_actor_is_admitted_or_refused_as_the_table_says(
    transition: Transition, actor: Actor
) -> None:
    """The allowed/denied matrix, generated from the table rather than typed out."""
    selected = workflow.select_transition(
        transition.from_status, transition.to_status, frozenset({actor})
    )

    if actor in transition.allowed_actors:
        assert selected is not None
        assert actor in selected.allowed_actors
        # Where several rows share the pair, the one chosen must be a row that
        # admits this actor — not necessarily this exact row.
        assert selected.to_status == transition.to_status
    else:
        # Another row may still admit this actor for the same pair; what must
        # never happen is being given *this* row.
        assert selected is None or selected is not transition


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_a_move_with_no_actor_at_all_is_refused(transition: Transition) -> None:
    assert (
        workflow.select_transition(transition.from_status, transition.to_status, frozenset())
        is None
    )


@pytest.mark.parametrize("transition", TRANSITIONS, ids=ids)
def test_every_row_is_offered_to_its_actors(transition: Transition) -> None:
    """Each row must be reachable through `available_transitions`, guards included."""
    actor_id = uuid.uuid4()
    incident = satisfying_incident(transition, actor_id=actor_id)

    for actor in transition.allowed_actors:
        offered = workflow.available_transitions(incident, frozenset({actor}), NOW)
        assert transition.to_status in {row.to_status for row in offered}


def test_no_transition_leaves_a_closed_ticket_after_the_window() -> None:
    """After seven days CLOSED is terminal, for everyone."""
    incident = make_incident(
        IncidentStatus.CLOSED,
        closed_at=NOW - workflow.REOPEN_WINDOW - timedelta(seconds=1),
    )

    for actor in Actor:
        assert workflow.available_transitions(incident, frozenset({actor}), NOW) == []


# --- Guards ------------------------------------------------------------------


def test_work_cannot_start_on_a_ticket_with_no_assignee() -> None:
    incident = make_incident(IncidentStatus.OPEN)
    transition = workflow.select_transition(
        IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, frozenset({Actor.FACILITY_ADMIN})
    )

    assert transition is not None
    assert workflow.check_guard(transition, incident, NOW) is not None


def test_work_can_start_once_the_ticket_has_an_assignee() -> None:
    incident = make_incident(IncidentStatus.OPEN, assignee_id=uuid.uuid4())
    transition = workflow.select_transition(
        IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, frozenset({Actor.FACILITY_ADMIN})
    )

    assert transition is not None
    assert workflow.check_guard(transition, incident, NOW) is None


@pytest.mark.parametrize(
    ("age", "reopenable"),
    [
        (timedelta(0), True),
        (timedelta(days=6, hours=23), True),
        (workflow.REOPEN_WINDOW, True),
        (workflow.REOPEN_WINDOW + timedelta(seconds=1), False),
        (timedelta(days=30), False),
    ],
    ids=["just closed", "day 6", "exactly 7 days", "a second late", "a month later"],
)
def test_the_reopen_window_is_seven_days(age: timedelta, reopenable: bool) -> None:
    """The boundary is inclusive: exactly seven days still reopens."""
    incident = make_incident(IncidentStatus.CLOSED, closed_at=NOW - age)
    transition = workflow.select_transition(
        IncidentStatus.CLOSED, IncidentStatus.IN_PROGRESS, frozenset({Actor.REPORTER})
    )

    assert transition is not None
    assert (workflow.check_guard(transition, incident, NOW) is None) is reopenable


# --- Actor resolution --------------------------------------------------------


def test_the_reporter_is_an_actor_on_their_own_ticket() -> None:
    user = make_user()
    incident = make_incident(IncidentStatus.OPEN, reporter_id=user.id)

    assert workflow.resolve_actors(incident, user) == frozenset({Actor.REPORTER})


def test_an_unrelated_employee_is_no_actor_at_all() -> None:
    user = make_user()
    incident = make_incident(IncidentStatus.OPEN)

    assert workflow.resolve_actors(incident, user) == frozenset()


def test_the_assignee_is_an_actor() -> None:
    engineer = make_user(UserRole.ENGINEER, EngineerLevel.JUNIOR)
    incident = make_incident(IncidentStatus.OPEN, assignee_id=engineer.id)

    assert workflow.resolve_actors(incident, engineer) == frozenset({Actor.ASSIGNEE})


@pytest.mark.parametrize("level", [EngineerLevel.JUNIOR, EngineerLevel.SENIOR])
def test_a_non_lead_engineer_is_nobody_on_a_ticket_they_do_not_hold(
    level: EngineerLevel,
) -> None:
    engineer = make_user(UserRole.ENGINEER, level)
    incident = make_incident(IncidentStatus.IN_PROGRESS, assignee_id=uuid.uuid4())

    assert workflow.resolve_actors(incident, engineer) == frozenset()


def test_a_lead_counts_as_the_assignee_on_any_ticket() -> None:
    """Leads cover for their team; a ticket whose owner is on leave is not stuck."""
    lead = make_user(UserRole.ENGINEER, EngineerLevel.LEAD)
    incident = make_incident(IncidentStatus.IN_PROGRESS, assignee_id=uuid.uuid4())

    assert workflow.resolve_actors(incident, lead) == frozenset({Actor.ASSIGNEE})


def test_an_admin_is_an_actor_on_every_ticket() -> None:
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(IncidentStatus.OPEN)

    assert workflow.resolve_actors(incident, admin) == frozenset({Actor.FACILITY_ADMIN})


def test_a_user_can_hold_several_actor_roles_at_once() -> None:
    admin = make_user(UserRole.FACILITY_ADMIN)
    incident = make_incident(IncidentStatus.RESOLVED, reporter_id=admin.id, assignee_id=admin.id)

    assert workflow.resolve_actors(incident, admin) == frozenset(
        {Actor.REPORTER, Actor.ASSIGNEE, Actor.FACILITY_ADMIN}
    )


# --- Precedence --------------------------------------------------------------


def test_an_admin_who_reported_the_ticket_keeps_their_admin_options() -> None:
    """Being the reporter must never cost an admin an option they would have had."""
    selected = workflow.select_transition(
        IncidentStatus.OPEN,
        IncidentStatus.CLOSED,
        frozenset({Actor.REPORTER, Actor.FACILITY_ADMIN}),
    )

    assert selected is not None
    assert selected.action_label == "Close ticket"
    assert selected.caller_picks_close_reason
    assert CloseReason.DUPLICATE in selected.close_reasons


def test_a_plain_reporter_gets_the_simple_cancel() -> None:
    selected = workflow.select_transition(
        IncidentStatus.OPEN, IncidentStatus.CLOSED, frozenset({Actor.REPORTER})
    )

    assert selected is not None
    assert selected.action_label == "Cancel ticket"
    assert selected.required_fields == ()
    assert selected.fixed_close_reason == CloseReason.CANCELLED_BY_REPORTER


def test_closing_a_resolved_ticket_records_who_closed_it() -> None:
    """Three rows, one per actor, so the recorded reason names the right person."""
    expectations = {
        Actor.REPORTER: CloseReason.CONFIRMED_FIXED,
        Actor.ASSIGNEE: CloseReason.CLOSED_BY_ENGINEER,
        Actor.FACILITY_ADMIN: CloseReason.ADMIN_CLOSED,
    }

    for actor, expected in expectations.items():
        selected = workflow.select_transition(
            IncidentStatus.RESOLVED, IncidentStatus.CLOSED, frozenset({actor})
        )
        assert selected is not None
        assert selected.fixed_close_reason == expected


def test_available_transitions_offers_each_status_once() -> None:
    """Two rows for one pair must not become two buttons that do different things."""
    incident = make_incident(IncidentStatus.OPEN, assignee_id=uuid.uuid4())
    actors = frozenset({Actor.REPORTER, Actor.ASSIGNEE, Actor.FACILITY_ADMIN})

    offered = workflow.available_transitions(incident, actors, NOW)
    statuses = [transition.to_status for transition in offered]

    assert len(statuses) == len(set(statuses))


# --- The auto-close guard -----------------------------------------------------


def test_the_quiet_clock_runs_from_the_repair() -> None:
    incident = make_incident(IncidentStatus.RESOLVED, resolved_at=NOW - timedelta(days=3))

    assert workflow.autoclose_deadline(incident) == NOW - timedelta(days=3) + AUTOCLOSE_AFTER


def test_a_ticket_that_was_never_resolved_has_no_deadline() -> None:
    """`None` rather than something far in the future, so a caller must handle it.

    A sentinel date would make "not a candidate" indistinguishable from "due
    in a hundred years", and the sweep would be one comparison away from
    closing tickets that were never fixed.
    """
    assert workflow.autoclose_deadline(make_incident(IncidentStatus.OPEN)) is None


def test_a_public_note_pushes_the_deadline_out() -> None:
    """The rule that makes an automatic close housekeeping rather than a filing error."""
    resolved_at = NOW - timedelta(days=30)
    spoke_at = NOW - timedelta(days=1)
    incident = make_incident(
        IncidentStatus.RESOLVED,
        resolved_at=resolved_at,
        notes=[note(created_at=spoke_at)],
    )

    assert workflow.autoclose_deadline(incident) == spoke_at + AUTOCLOSE_AFTER


def test_an_internal_note_does_not() -> None:
    """The reporter cannot see one, so it is not evidence anybody is waiting.

    Asserted against the same instant the public case uses, so the only
    difference between the two is the visibility.
    """
    resolved_at = NOW - timedelta(days=30)
    incident = make_incident(
        IncidentStatus.RESOLVED,
        resolved_at=resolved_at,
        notes=[note(created_at=NOW - timedelta(days=1), visibility=NoteVisibility.INTERNAL)],
    )

    assert workflow.autoclose_deadline(incident) == resolved_at + AUTOCLOSE_AFTER


def test_a_deleted_note_does_not_either() -> None:
    """A note nobody can read is not a conversation."""
    resolved_at = NOW - timedelta(days=30)
    incident = make_incident(
        IncidentStatus.RESOLVED,
        resolved_at=resolved_at,
        notes=[note(created_at=NOW - timedelta(days=1), deleted_at=NOW - timedelta(hours=1))],
    )

    assert workflow.autoclose_deadline(incident) == resolved_at + AUTOCLOSE_AFTER


def test_a_note_written_before_the_repair_does_not_move_it() -> None:
    """Only silence *since* the fix counts.

    Every ticket has notes from while it was being worked on; if those
    restarted the clock, a ticket would close seven days after the last thing
    anybody said during the repair rather than seven days after the repair —
    earlier than intended on a long job, and never later.
    """
    resolved_at = NOW - timedelta(days=10)
    incident = make_incident(
        IncidentStatus.RESOLVED,
        resolved_at=resolved_at,
        notes=[note(created_at=resolved_at - timedelta(days=2))],
    )

    assert workflow.autoclose_deadline(incident) == resolved_at + AUTOCLOSE_AFTER


def test_the_guard_refuses_a_ticket_that_is_not_due_yet() -> None:
    transition = workflow.select_transition(
        IncidentStatus.RESOLVED, IncidentStatus.CLOSED, frozenset({Actor.SYSTEM})
    )
    assert transition is not None

    early = make_incident(
        IncidentStatus.RESOLVED, resolved_at=NOW - AUTOCLOSE_AFTER + timedelta(hours=1)
    )
    assert workflow.check_guard(transition, early, NOW) is not None

    due = make_incident(
        IncidentStatus.RESOLVED, resolved_at=NOW - AUTOCLOSE_AFTER - timedelta(hours=1)
    )
    assert workflow.check_guard(transition, due, NOW) is None


def test_no_human_actor_can_reach_the_autoclose_row() -> None:
    """The whole reason `Actor.SYSTEM` exists.

    Asserted over every other member of `Actor` rather than over the three we
    happen to have, so a fourth human capacity added later cannot quietly
    acquire the ability to close tickets on the system's behalf.
    """
    incident = make_incident(
        IncidentStatus.RESOLVED,
        resolved_at=NOW - AUTOCLOSE_AFTER - timedelta(days=1),
    )

    for actor in Actor:
        if actor is Actor.SYSTEM:
            continue
        offered = workflow.available_transitions(incident, frozenset({actor}), NOW)
        labels = {row.action_label for row in offered}
        assert "Close automatically" not in labels, actor
