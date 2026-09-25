"""Closing resolved tickets that nobody came back to.

A ticket the engineer marked fixed sits in RESOLVED until a human closes it.
Most get confirmed; some never do, and without this they stay there for ever —
which makes every "still open" figure on the admin dashboard slowly less true.

## Why this is a sweep and not a scheduled job

**There is no scheduler available, and that is a fact about the deployment
rather than a preference.** `infra/policy.tftpl` grants no `events:*` and no
`scheduler:*`, so no EventBridge rule can be created; SQS is granted and its
maximum message delay is fifteen minutes; Aurora Serverless v2 runs at
`min_capacity = 0`, so even a cron would be waking a database on a timer to
look for rows nobody is reading.

This codebase has already had this argument once and written the answer down,
in `purge_expired` in `repositories/login_attempts.py`: *"A background sweeper
would be the conventional answer and is not available here."* That table
cleans itself on the path that writes to it. This does the same thing one
level up — the work happens on a request that was going to happen anyway.

**What that costs, stated plainly.** A ticket closes when somebody next uses
the application, not at the stroke of its deadline. Since the sweep is not
scoped to the tickets being listed, any single page load catches the whole
estate up, so the only way a ticket stays open past its deadline is for nobody
to use the system at all — in which case nothing was urgent. What it buys is
no new infrastructure, no Aurora wake, and a mechanism that degrades to
silence rather than to a queue that stopped draining without telling anyone.

## What it is not allowed to do

**It must not be a second implementation of "what it means to be CLOSED".**
`_apply_transition_effects` in `services/incident_service.py` owns that, keyed
on the status being entered, and this calls it with a real `Transition` row —
`Actor.SYSTEM`'s, in `app/workflow.py`. So the closure sets `closed_at` and
the close reason the same way every other closure does, and a field added to
that function is not a field this one forgets.

**Whether a ticket is due is `workflow.autoclose_deadline`**, not a comparison
written here. That is where the seven days live and where the rule that a
public note restarts the clock lives.

## What it deliberately does not do

**It notifies nobody.** The reporter was told when the ticket was resolved and
asked to confirm the fix; being told a week later that the system tidied up
is an interruption about something nobody did and nothing they can act on —
their rating window is open for another week either way (D71). This is the
same call `app/notifications.py` already makes for CREATED, ESCALATED and
PRIORITY_CHANGED: not everything worth an audit row is worth interrupting
somebody with (D31).

**It writes an event with no actor.** `incident_events.actor_id` is nullable
and always was, so a system action needs no invented "System" user account —
which would be a real row somebody could try to sign in as.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app import workflow
from app.clock import utc_now
from app.models.enums import CloseReason, IncidentStatus
from app.models.incident import Incident
from app.repositories import incidents as repository
from app.services import incident_service
from app.workflow import AUTOCLOSE_AFTER, Actor

#: How many tickets one sweep may close.
#:
#: A cap rather than "all of them", because this runs inside somebody's page
#: load: a first sweep over a long-neglected estate should not be the request
#: that times out. Anything left is picked up by the next one, which is why
#: `list_autoclose_candidates` orders oldest first — a capped sweep always
#: makes progress rather than revisiting the same page.
SWEEP_LIMIT = 50


def close_stale(
    session: Session,
    *,
    now: datetime | None = None,
    limit: int = SWEEP_LIMIT,
) -> list[Incident]:
    """Close every resolved ticket that has gone quiet. Returns what it closed.

    **The caller commits**, like every other service here. That matters more
    than usual: this runs alongside a read, and a sweep that committed on its
    own would write rows into the middle of a request that then failed.

    Returns the incidents rather than a count, so a caller that wants to log
    or report them can, and so the tests can assert on which tickets were
    chosen rather than on how many.
    """
    moment = now or utc_now()
    transition = _the_autoclose_transition()

    closed: list[Incident] = []
    candidates = repository.list_autoclose_candidates(
        session,
        resolved_before=moment - AUTOCLOSE_AFTER,
        limit=limit,
    )

    for incident in candidates:
        # The prefilter is permissive on purpose; this is the rule. A ticket
        # whose reporter wrote yesterday is selected above and refused here.
        if workflow.check_guard(transition, incident, moment) is not None:
            continue

        incident_service.apply_system_transition(
            session,
            incident=incident,
            transition=transition,
            close_reason=CloseReason.SYSTEM_CLOSED,
            now=moment,
        )
        closed.append(incident)

    return closed


def _the_autoclose_transition() -> workflow.Transition:
    """Return the one row `Actor.SYSTEM` may act on.

    Looked up from `TRANSITIONS` rather than constructed, so this cannot drift
    from the table: if the row is edited, removed or given a different guard,
    this function follows it or fails loudly.
    """
    transition = workflow.select_transition(
        IncidentStatus.RESOLVED,
        IncidentStatus.CLOSED,
        frozenset({Actor.SYSTEM}),
    )
    if transition is None:  # pragma: no cover - the row is asserted by the unit tests
        raise RuntimeError("app/workflow.py has no RESOLVED -> CLOSED row for Actor.SYSTEM.")
    return transition


def next_deadline(incident: Incident) -> datetime | None:
    """Return when this ticket would close itself, or None if it would not.

    A thin re-export of `workflow.autoclose_deadline` so that callers outside
    the workflow — a screen that wants to say "closes in three days", an ops
    action reporting what it is about to do — depend on this service rather
    than reaching into the table. Nothing renders it yet.
    """
    return workflow.autoclose_deadline(incident)


#: Re-exported so a caller can say how long the window is without importing
#: two modules. The value itself lives in `app/workflow.py`, beside the guard
#: that reads it.
WINDOW: timedelta = AUTOCLOSE_AFTER

__all__ = ["SWEEP_LIMIT", "WINDOW", "close_stale", "next_deadline"]
