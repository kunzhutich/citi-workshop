r"""The demo dataset: a plausible ninety days of ACME, generated on demand.

This is *demo* data, not reference data. ``seed_categories`` runs as part of
``migrate`` because the questionnaire cannot render without categories; nothing
here is needed for the application to work. It exists so that the three
dashboard screens have something with shape to draw, and so that a reviewer
opening the admin dashboard sees a business rather than a scatter plot.

**Why the events are backdated, and why that is the whole point.** Four of the
eight reports measure *durations*:
``/reports/response-times`` takes medians over ``assigned_at - created_at``,
``acknowledged_at - created_at`` and ``resolved_at - created_at``;
``/reports/blocked-escalated`` reads how long a ticket has been blocked out of
``incident_events`` (there is no ``blocked_at`` column — see decision D6);
``/reports/communication`` measures the gap to the first public staff note; and
``/reports/summary`` plots created-versus-closed per calendar day. A generator
that inserts three hundred rows with ``created_at = now()`` satisfies every
count in the application and makes every one of those numbers zero, null or a
single spike on today's date. So each incident here is generated as a
*timeline* — a list of moments with explicit timestamps — and the rows are
written from it.

**How a ticket's current state is decided.** It is not chosen and then
back-filled. Each incident gets a full intended path (assigned, acknowledged,
perhaps blocked, resolved, closed, perhaps reopened) with a duration drawn for
every hop, and the walk stops at the first moment later than ``now``. A ticket
created eighty days ago with a thirty-hour path is therefore closed; one
created this morning is still open, and one whose block outlasts the run is
still blocked with a real age. The status distribution falls out of the ages
and the durations instead of being imposed on top of them, which is what makes
the dashboards look like a workplace.

The walk applies exactly the effects ``_apply_transition_effects`` in
``services/incident_service.py`` applies — entering IN_PROGRESS clears the
resolution fields, leaving BLOCKED clears the blocked reason, reopening clears
``resolved_at`` and ``closed_at`` and increments ``reopen_count`` — so the rows
this produces are rows the state machine could have produced.

**Determinism.** Everything is drawn from one ``random.Random`` seeded from the
spec, so two runs of the same spec produce the same world. That is what lets
the tests assert relationships rather than shrug at random values, and it means
a demo can be rehearsed.

**Idempotence.** Running this twice does *not* top up or refresh the data: the
second run finds the demo buildings already present, changes nothing, and says
so in its return payload. Half of what it writes is unique-constrained
(building names and codes, user emails) and the other half is not, so a
blind second run would either fail on a constraint or silently double the
incident count. To regenerate, drop and recreate the database and run
``migrate`` then ``seed_demo`` again — which is what decision D4 already
prescribes for the review database.
"""

import random
import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import notifications as notification_rules
from app.clock import utc_now
from app.models.building import Building
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.enums import (
    ACTIVE_INCIDENT_STATUSES,
    AvailabilityStatus,
    BlockedReasonType,
    CloseReason,
    EngineerLevel,
    EventType,
    IncidentPriority,
    IncidentStatus,
    LocationDetail,
    NoteVisibility,
    NotificationType,
    SeatType,
    UserRole,
)
from app.models.event import IncidentEvent
from app.models.feedback import IncidentFeedback
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.note import IncidentNote
from app.models.notification import Notification
from app.models.seat import Seat
from app.models.user import User
from app.models.watcher import IncidentWatcher
from app.security.passwords import hash_password
from app.services.feedback import FEEDBACK_WINDOW

#: Every demo account shares this password. It is printed in the return payload
#: and in the README: these are throwaway accounts on a demo database, and a
#: reviewer who has to reset thirty passwords to look around will not look
#: around. `must_change_password` is False for the same reason.
DEMO_PASSWORD = "AcmeDemo2026!"

#: Only ``@acme.inc`` addresses exist in this application — see
#: ``ALLOWED_EMAIL_DOMAIN`` in ``services/auth_service.py``.
EMAIL_DOMAIN = "acme.inc"


@dataclass(frozen=True)
class DemoSpec:
    """How much of everything to generate.

    The defaults are the numbers BUILD-PLAN section 15 asks for. The tests
    build a much smaller spec: generating three hundred incidents to prove that
    a generator produces incidents is a slow way to learn nothing.
    """

    buildings: int = 3
    min_floors: int = 4
    max_floors: int = 6
    min_desks: int = 20
    max_desks: int = 40
    min_meeting_rooms: int = 2
    max_meeting_rooms: int = 3
    employees: int = 30
    # Raised from 300 with the wider category list and the bigger roster: ten
    # engineers over eight groups need enough history for each of them to have
    # a record worth reading on their own page (§6.1), and 300 spread that
    # thin left the newest groups with a handful each.
    incidents: int = 420
    days: int = 90
    hotspots: int = 3
    random_seed: int = 20260923


#: The shape BUILD-PLAN section 15 specifies, and what the ops action uses.
DEFAULT_SPEC = DemoSpec()


@dataclass
class DemoSeedResult:
    """What a run of ``seed_demo`` created, so the caller can report it."""

    created: bool = True
    detail: str = ""
    buildings: int = 0
    floors: int = 0
    desks: int = 0
    meeting_rooms: int = 0
    admins: int = 0
    engineers: int = 0
    employees: int = 0
    incidents: int = 0
    events: int = 0
    notes: int = 0
    watchers: int = 0
    feedback: int = 0
    notifications: int = 0
    by_status: dict[str, int] = field(default_factory=dict)
    by_priority: dict[str, int] = field(default_factory=dict)
    by_category_group: dict[str, int] = field(default_factory=dict)
    by_engineer: dict[str, int] = field(default_factory=dict)
    blocked_now: int = 0
    escalated_live: int = 0
    escalated_on_closed: int = 0
    duplicates: int = 0
    reopened: int = 0
    unassigned: int = 0
    earliest_incident: str | None = None
    latest_incident: str | None = None
    demo_password: str | None = None

    @property
    def users(self) -> int:
        """Return how many accounts were created in total."""
        return self.admins + self.engineers + self.employees


# --- The static world --------------------------------------------------------

#: Name, code and address for each building, in the order they are created.
BUILDING_SEEDS: tuple[tuple[str, str, str], ...] = (
    ("San Francisco HQ", "SFO-1", "500 Market Street, San Francisco, CA 94105"),
    ("Austin Campus", "AUS-1", "1200 Congress Avenue, Austin, TX 78701"),
    ("Dublin Office", "DUB-1", "8 Grand Canal Quay, Dublin 2, D02 XY45"),
)

#: How likely a given building is to be the one an incident is reported in.
#: San Francisco is headquarters and carries most of the traffic; Dublin is the
#: smallest site. A uniform split would make `/reports/locations` a flat bar
#: chart, which tells a reviewer nothing.
BUILDING_WEIGHTS: tuple[float, ...] = (0.50, 0.32, 0.18)

#: Meeting rooms are named, not numbered. Drawn without replacement per floor.
MEETING_ROOM_NAMES: tuple[str, ...] = (
    "Redwood",
    "Cypress",
    "Juniper",
    "Sequoia",
    "Aspen",
    "Willow",
    "Alder",
    "Hazel",
    "Rowan",
    "Maple",
    "Birch",
    "Laurel",
    "Olive",
    "Cedar",
    "Larch",
    "Poplar",
    "Spruce",
    "Elmwood",
    "Fern",
    "Heather",
)

#: Name, level, specialty groups and home building index for each engineer.
#: **Between them they cover every category group** —
#: `test_engineers_covers_every_category_group` asserts it, and the property is
#: what stops the demo world holding a ticket nobody is a specialist for.
#:
#: Ten of them, across three levels, after §6.2 added three category groups and
#: the owner asked for a wider pool. The variety is the point rather than the
#: count: the admin dashboard has to answer "who is free", "who is buried" and
#: "who knows about this", and none of those is interesting when everybody has
#: one specialty and the same load. So there are generalists with three groups
#: and specialists with one, two engineers who cover nothing anybody else does,
#: and two groups covered by three people each.
ENGINEER_SEEDS: tuple[tuple[str, EngineerLevel, tuple[str, ...], int], ...] = (
    ("Nina Alvarez", EngineerLevel.SENIOR, ("Building & Facilities", "Cleaning & Waste"), 0),
    ("Omar Haddad", EngineerLevel.SENIOR, ("Network & Access", "Software"), 1),
    ("Grace Lin", EngineerLevel.LEAD, ("Hardware", "Meeting Rooms"), 0),
    (
        "Diego Santos",
        EngineerLevel.LEAD,
        ("Building & Facilities", "Network & Access", "Safety & Security"),
        2,
    ),
    ("Priya Raman", EngineerLevel.JUNIOR, ("Hardware", "Deliveries & Moves"), 0),
    ("Tom Okafor", EngineerLevel.JUNIOR, ("Meeting Rooms", "Software"), 1),
    # Added with the wider pool. Each one exists to make a question answerable:
    # a second Safety specialist so that group is not one person deep, a
    # generalist who can take almost anything, a Cleaning & Waste pairing so
    # the newest groups have real cover, and a junior with a single subject.
    ("Yusuf Demir", EngineerLevel.SENIOR, ("Safety & Security", "Building & Facilities"), 2),
    (
        "Mei Tanaka",
        EngineerLevel.LEAD,
        ("Hardware", "Software", "Network & Access"),
        1,
    ),
    ("Ana Costa", EngineerLevel.JUNIOR, ("Cleaning & Waste", "Deliveries & Moves"), 0),
    ("Liam Byrne", EngineerLevel.JUNIOR, ("Meeting Rooms",), 2),
)

#: Base share of assignments per engineer, in the order above. Deliberately
#: uneven: "who is overloaded" is one of the questions the admin dashboard has
#: to answer, and it cannot be answered from six equal bars.
ENGINEER_LOAD_WEIGHTS: tuple[float, ...] = (
    0.16,
    0.14,
    0.12,
    0.11,
    0.10,
    0.09,
    0.08,
    0.08,
    0.07,
    0.05,
)

#: How many active tickets each level is expected to carry. Feeds the capacity
#: percentages on `/reports/engineer-workload`.
MAX_ACTIVE_BY_LEVEL: dict[EngineerLevel, int] = {
    EngineerLevel.JUNIOR: 6,
    EngineerLevel.SENIOR: 12,
    EngineerLevel.LEAD: 16,
}

#: Availability by engineer index. One on leave and one busy, so the
#: availability column on the workload report is not a single repeated value.
ENGINEER_AVAILABILITY: tuple[AvailabilityStatus, ...] = (
    AvailabilityStatus.AVAILABLE,
    AvailabilityStatus.BUSY,
    AvailabilityStatus.AVAILABLE,
    AvailabilityStatus.AVAILABLE,
    AvailabilityStatus.ON_LEAVE,
    AvailabilityStatus.AVAILABLE,
)

#: Thirty-six names, so a spec asking for thirty employees has room to spare.
EMPLOYEE_NAMES: tuple[str, ...] = (
    "Eve Carter",
    "Evan Brooks",
    "Maya Iyer",
    "Luis Ortega",
    "Hannah Weiss",
    "Kofi Mensah",
    "Sofia Rossi",
    "Daniel Park",
    "Amara Obi",
    "Jonas Lund",
    "Ines Duarte",
    "Wei Zhang",
    "Ruth Adeyemi",
    "Marco Bianchi",
    "Leila Haddad",
    "Tomas Novak",
    "Grace Mwangi",
    "Ben Sutton",
    "Aria Nakamura",
    "Felix Braun",
    "Nadia Karim",
    "Oliver Shaw",
    "Clara Jensen",
    "Raj Patel",
    "Mia Andersen",
    "Samir Toure",
    "Lena Fischer",
    "Hugo Marques",
    "Yuki Tanaka",
    "Paula Gomez",
    "Ivan Petrov",
    "Dara O'Neill",
    "Zoe Kelly",
    "Anton Meier",
    "Rosa Delgado",
    "Noah Whitfield",
)

#: How likely each category group is to be the subject of a ticket. Facilities
#: problems dominate a facilities platform; meeting-room faults are the rarest
#: because there are fewer rooms than desks.
CATEGORY_GROUP_WEIGHTS: dict[str, float] = {
    "Building & Facilities": 0.26,
    "Hardware": 0.19,
    "Network & Access": 0.15,
    "Software": 0.11,
    "Meeting Rooms": 0.08,
    # The three §6.2 added, at a share that actually shows up. They were 2-5%
    # at first, which put "Deliveries & Moves" at about six tickets in three
    # months — enough to satisfy a test that every group appears and not enough
    # to look at. A fifth of the queue between them is the honest shape for a
    # facilities team: fewer than the broken-monitor traffic, common enough
    # that a chart segment is worth clicking.
    "Cleaning & Waste": 0.09,
    "Safety & Security": 0.07,
    "Deliveries & Moves": 0.05,
}

#: Priority mix. Most workplace problems are an annoyance, a few are urgent.
PRIORITY_WEIGHTS: dict[IncidentPriority, float] = {
    IncidentPriority.LOW: 0.20,
    IncidentPriority.MEDIUM: 0.46,
    IncidentPriority.HIGH: 0.24,
    IncidentPriority.CRITICAL: 0.10,
}

#: Subcategories that are urgent by nature, whatever the usual mix says.
URGENT_SUBCATEGORIES: frozenset[str] = frozenset(
    {"Safety Hazard", "Plumbing/Restroom", "Power/Outlets", "VPN", "Wired Network"}
)

#: Median hours to assign, to acknowledge after assignment, and to resolve
#: after acknowledgement, per priority. Every draw is a lognormal around these,
#: so the medians the reports compute are recognisably these numbers and the
#: tail is long enough to be realistic.
RESPONSE_MEDIANS: dict[IncidentPriority, tuple[float, float, float]] = {
    IncidentPriority.CRITICAL: (0.5, 0.4, 5.0),
    IncidentPriority.HIGH: (2.0, 1.5, 14.0),
    IncidentPriority.MEDIUM: (6.0, 3.5, 36.0),
    IncidentPriority.LOW: (16.0, 9.0, 84.0),
}

#: What a ticket's life looks like, and how often.
#:
#: Only "normal" runs to a close. The other five stop somewhere, and they are
#: the reason the finished dataset looks like a working queue rather than an
#: archive. A generator that gives every ticket a path to CLOSED produces a
#: database that is 85% closed after ninety days — measured, not guessed — and
#: then the blocked report has three rows in it, the "awaiting your
#: confirmation" tile is empty and the engineer workload chart shows nobody
#: holding anything. Real queues carry work that stalled: a ticket nobody
#: picked up, one an engineer started and got pulled off, one blocked on a
#: vendor since July, one resolved that the reporter never got round to
#: confirming. Each of those is a path here, not an accident of the draw.
PATH_WEIGHTS: dict[str, float] = {
    "normal": 0.58,
    "never_assigned": 0.09,
    "assigned_not_started": 0.04,
    "stalled": 0.07,
    "stuck_blocked": 0.07,
    "awaiting_confirmation": 0.05,
    "duplicate": 0.05,
    "invalid": 0.05,
}

#: Paths whose ticket is still live at the end, and is therefore more likely to
#: have been escalated by somebody who got tired of waiting.
STALLED_PATHS: frozenset[str] = frozenset(
    {"never_assigned", "assigned_not_started", "stalled", "stuck_blocked"}
)

#: What share of the tickets that *could* be followed actually are.
#:
#: Applies only to tickets in a subcategory with `allows_watchers`, which is
#: roughly a third of the tree. Neither 0 nor 1, for the same reason as the
#: read share below: a demo in which every shared ticket has followers is as
#: uninformative as one in which none has, and the "N others are affected"
#: line should be absent often enough that a reviewer notices when it appears.
WATCHED_SHARE = 0.55

#: How many colleagues follow one of those, drawn inclusively. A jammed
#: printer annoys a handful of people on that floor, not the whole building.
WATCHERS_PER_INCIDENT = (1, 4)

#: What share of repaired tickets the reporter goes on to rate.
#:
#: Deliberately well under half, and the number is the point rather than a
#: guess at realism: feedback is optional, so every average computed from it
#: is over people who chose to answer. A demo world in which everybody rates
#: would make the response rate on the engineer page read 100% and quietly
#: teach a reviewer that the figure never varies.
RATED_SHARE = 0.45

#: How the demo's scores are distributed, as weights over 1..5.
#:
#: Skewed high, because most repairs do work and a demo world where a third of
#: the engineers look incompetent is not a demo of this system. The tail is
#: what earns its place: some 1s and 2s exist, so the low-rating case has
#: something to show and the distribution chart on an engineer's page is not a
#: single bar.
RATING_WEIGHTS: tuple[int, ...] = (2, 5, 14, 40, 39)

#: How long after the repair the reporter gets round to saying something.
#: Inside the fourteen-day window `services/feedback.py` allows, because a
#: seeded rating outside it would be a row the application could not have
#: written.
FEEDBACK_DELAY_HOURS = (2, 96)

#: What a rating says, by score. One sentence each, so a reviewer reading the
#: timeline sees words that match the stars rather than lorem ipsum.
FEEDBACK_COMMENTS: dict[int, tuple[str, ...]] = {
    1: (
        "Still exactly as it was. Nobody came.",
        "Marked as fixed without anything changing.",
    ),
    2: (
        "Working again but it took far longer than it should have.",
        "Fixed, then broke again the same week.",
    ),
    3: (
        "Sorted in the end. I had to chase it twice.",
        "Fine. Would have liked to know what was happening.",
    ),
    4: (
        "Quick and tidy, and they explained what had gone wrong.",
        "Sorted the same afternoon. No complaints.",
    ),
    5: (
        "Turned up within the hour and had it working immediately.",
        "Could not have been handled better. Thank you.",
    ),
}

#: What share of the demo world's notifications have been read.
#:
#: The number `/reports/communication` will report as the notification read
#: rate, give or take the ones too recent to have been read yet. Deliberately
#: neither 0 nor 100: both are useless on a dashboard, and a generator that
#: produced either would make the tile impossible to tell from a broken query.
NOTIFICATION_READ_SHARE = 0.62

#: How long after arriving a notification tends to be read, in hours. Drawn
#: uniformly; the point is only that `read_at` is after `created_at` and
#: usually within a working day or two.
NOTIFICATION_READ_DELAY_HOURS = (0.5, 40.0)

#: How often the assignee writes the reporter a public note early on. Not
#: every ticket: `/reports/communication` exists to measure how often the
#: reporter was told something before their ticket was resolved, and a
#: generator that writes one on every ticket answers "100%", which is a number
#: no facilities team has ever had and tells a reviewer nothing.
PUBLIC_UPDATE_PROBABILITY = 0.72

#: Why work stops, and how often. Parts and vendors dominate in a facilities
#: business; access is the one that produces the very long blocks.
BLOCKED_REASON_WEIGHTS: dict[BlockedReasonType, float] = {
    BlockedReasonType.WAITING_ON_PARTS: 0.34,
    BlockedReasonType.WAITING_ON_VENDOR: 0.26,
    BlockedReasonType.WAITING_ON_EMPLOYEE: 0.18,
    BlockedReasonType.ACCESS_REQUIRED: 0.16,
    BlockedReasonType.OTHER: 0.06,
}

#: Short symptom phrases per category group, used to build titles that read
#: like something a person typed.
SYMPTOMS: dict[str, tuple[str, ...]] = {
    "Building & Facilities": (
        "is freezing cold all morning",
        "keeps flickering",
        "has been leaking since Monday",
        "smells of damp",
        "will not switch off",
        "is blocked and unusable",
    ),
    "Hardware": (
        "will not power on",
        "disconnects every few minutes",
        "is making a grinding noise",
        "shows no signal",
        "overheats under load",
        "has a dead battery",
    ),
    "Network & Access": (
        "drops every ten minutes",
        "will not authenticate",
        "times out from this floor",
        "rejects my badge",
        "is unreachable from the guest network",
        "is stuck asking for a password",
    ),
    "Software": (
        "crashes on launch",
        "will not sync",
        "hangs when saving",
        "reports a licence error",
        "cannot open attachments",
        "is stuck installing",
    ),
    "Meeting Rooms": (
        "shows a blank screen",
        "has no sound",
        "cannot join the call",
        "keeps dropping the camera",
        "will not mirror a laptop",
        "has a dead remote",
    ),
    "Cleaning & Waste": (
        "has not been emptied for days",
        "was left in a state this morning",
        "needs restocking again",
        "has something spilled across it",
    ),
    "Safety & Security": (
        "is beeping every few minutes",
        "will not latch properly",
        "has been out since last week",
        "looks like it needs checking",
    ),
    "Deliveries & Moves": (
        "has been sitting in reception for days",
        "never turned up",
        "needs collecting before Friday",
        "was delivered to the wrong floor",
    ),
}

#: Public notes staff write early, which is what `/reports/communication`
#: measures the delay to.
STAFF_PUBLIC_NOTES: tuple[str, ...] = (
    "Thanks for reporting this — I have picked it up and will take a look today.",
    "On my way over now. I will update you once I have seen it.",
    "Logged and triaged. We have a part on order; I will keep you posted.",
    "I have reproduced the problem and am working on a fix.",
)

#: Internal notes, invisible to employees. They exist so the note visibility
#: rules have something to hide on a demo database.
STAFF_INTERNAL_NOTES: tuple[str, ...] = (
    "Third report from this area this month — worth checking the riser.",
    "Vendor quoted two working days. Chasing on Thursday.",
    "Needs a lead to sign off the spend before I order the replacement.",
    "Spare in the store cupboard on level 2 if this comes up again.",
)

#: What the reporter says back.
REPORTER_NOTES: tuple[str, ...] = (
    "Thanks — it is still happening this morning.",
    "I have moved to another desk in the meantime.",
    "Any update on this one? It is slowing the whole team down.",
    "Happy to be around this afternoon if you need access.",
)

#: Resolution summaries, written when a ticket is resolved.
RESOLUTIONS: tuple[str, ...] = (
    "Replaced the failed unit and tested it with the reporter.",
    "Re-seated the connection and confirmed it has been stable for an hour.",
    "Vendor attended and completed the repair. Signed off on site.",
    "Reset the configuration and verified the problem is gone.",
    "Part fitted from stock. Asked the reporter to confirm before closing.",
)

#: Why someone escalated. The first is the common case: nothing happened. The
#: last one is about the building itself, so `_with_escalation` only offers it
#: on facilities tickets — "health and safety risk" on a stuck software install
#: reads as generated text, because it is.
ESCALATION_REASONS: tuple[str, ...] = (
    "Nobody has looked at this and it is still not working.",
    "Third time this month at the same desk.",
    "This is now blocking a customer demo on Thursday.",
    "Health and safety risk — needs attention today.",
)

#: The group the last escalation reason above belongs to.
SAFETY_REASON_GROUP = "Building & Facilities"

#: Why work stopped, written alongside the reason type.
BLOCKED_NOTES: dict[BlockedReasonType, str] = {
    BlockedReasonType.WAITING_ON_PARTS: "Replacement part ordered; two to three working days.",
    BlockedReasonType.WAITING_ON_VENDOR: "Vendor ticket raised; waiting on their engineer.",
    BlockedReasonType.WAITING_ON_EMPLOYEE: "Waiting for the reporter to be at their desk.",
    BlockedReasonType.ACCESS_REQUIRED: "Needs facilities to open the plant room.",
    BlockedReasonType.OTHER: "Paused pending a decision from the workplace team.",
}


# --- Planning types ----------------------------------------------------------


@dataclass(frozen=True)
class _World:
    """Everything the incident generator needs to look things up.

    A bundle rather than nine parameters threaded through five functions. The
    facility lookups are dictionaries because a ticket picks its location by
    walking down the tree, three hundred times, and re-querying for each would
    be the one genuinely slow thing in here.
    """

    buildings: list[Building]
    floors: dict[uuid.UUID, list[Floor]]
    seats: dict[uuid.UUID, list[Seat]]
    groups: list[Category]
    subcategories: dict[str, list[Category]]
    admin: User
    engineers: list[User]
    employees: list[User]
    reporter_weights: list[float]


@dataclass
class _Step:
    """One moment in an incident's intended life, with the instant it happens."""

    when: datetime
    kind: str
    detail: str | None = None


@dataclass
class _Plan:
    """Everything decided about one incident before any row is written."""

    created_at: datetime
    reporter: User
    group_name: str
    category: Category
    building: Building
    floor: Floor | None
    seat: Seat | None
    priority: IncidentPriority
    title: str
    description: str
    path: str
    assignee: User | None
    steps: list[_Step] = field(default_factory=list)


@dataclass
class _Outcome:
    """The state an incident is in once its timeline has been walked to `now`."""

    status: IncidentStatus = IncidentStatus.OPEN
    assignee_id: uuid.UUID | None = None
    assigned_at: datetime | None = None
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    close_reason: CloseReason | None = None
    resolution_summary: str | None = None
    blocked_reason_type: BlockedReasonType | None = None
    blocked_reason: str | None = None
    is_escalated: bool = False
    escalation_reason: str | None = None
    escalated_at: datetime | None = None
    escalated_by: uuid.UUID | None = None
    reopen_count: int = 0
    is_duplicate: bool = False
    last_activity: datetime | None = None


# --- Entry point -------------------------------------------------------------


def seed_demo(
    session: Session,
    spec: DemoSpec = DEFAULT_SPEC,
    *,
    now: datetime | None = None,
) -> DemoSeedResult:
    """Generate the demo world. The caller commits.

    Returns without writing anything if the demo buildings are already there,
    so a second invoke is a no-op rather than a constraint violation or a
    silently doubled dataset. See the module docstring.

    `now` is a parameter rather than a call to `utc_now()` inside the loop, so
    that every timestamp in one run is measured from the same instant and a
    test can state what the answers must be.
    """
    moment = now or utc_now()
    existing = _existing_demo_building(session, spec)
    if existing is not None:
        return DemoSeedResult(
            created=False,
            detail=(
                f"Demo data is already present ('{existing.name}' exists). Nothing was "
                "changed: seed_demo does not top up or refresh. Drop and recreate the "
                "database, run migrate, then run seed_demo again."
            ),
        )

    rng = random.Random(spec.random_seed)
    result = DemoSeedResult(detail="Demo world created.", demo_password=DEMO_PASSWORD)

    groups = _category_groups(session)
    buildings, floors, seats = _seed_facilities(session, rng, spec, result)
    admin, engineers, employees = _seed_people(session, rng, spec, buildings, groups, result)

    world = _World(
        buildings=buildings,
        floors=floors,
        seats=seats,
        groups=groups,
        subcategories=_subcategories_by_group(session, groups),
        admin=admin,
        engineers=engineers,
        employees=employees,
        reporter_weights=_reporter_weights(employees),
    )
    _seed_incidents(session, rng, spec, result, now=moment, world=world)

    session.flush()
    return result


def _existing_demo_building(session: Session, spec: DemoSpec) -> Building | None:
    """Return a demo building that is already in the database, if any."""
    codes = [code for _, code, _ in BUILDING_SEEDS[: spec.buildings]]
    statement = select(Building).where(Building.code.in_(codes)).limit(1)
    return session.scalars(statement).first()


# --- Facilities --------------------------------------------------------------


def _seed_facilities(
    session: Session,
    rng: random.Random,
    spec: DemoSpec,
    result: DemoSeedResult,
) -> tuple[list[Building], dict[uuid.UUID, list[Floor]], dict[uuid.UUID, list[Seat]]]:
    """Create the buildings, their floors, and the desks and rooms on them.

    Returns the buildings plus two lookups — floors by building id and seats by
    floor id — because the incident generator picks a location by walking down
    that tree and would otherwise re-query for every ticket.
    """
    if spec.buildings > len(BUILDING_SEEDS):
        raise ValueError(f"Only {len(BUILDING_SEEDS)} demo buildings are defined.")

    buildings: list[Building] = []
    floors_by_building: dict[uuid.UUID, list[Floor]] = {}
    seats_by_floor: dict[uuid.UUID, list[Seat]] = {}

    for name, code, address in BUILDING_SEEDS[: spec.buildings]:
        building = Building(name=name, code=code, address=address, is_active=True)
        session.add(building)
        session.flush()  # the floors need building.id
        buildings.append(building)
        result.buildings += 1

        floors: list[Floor] = []
        for level in range(1, rng.randint(spec.min_floors, spec.max_floors) + 1):
            floor = Floor(
                building_id=building.id,
                name=f"Level {level}",
                level_number=level,
                is_active=True,
            )
            session.add(floor)
            floors.append(floor)
            result.floors += 1
        session.flush()  # the seats need floor.id

        for floor in floors:
            seats_by_floor[floor.id] = _seed_seats(session, rng, spec, floor, result)
        floors_by_building[building.id] = floors

    session.flush()
    return buildings, floors_by_building, seats_by_floor


def _seed_seats(
    session: Session,
    rng: random.Random,
    spec: DemoSpec,
    floor: Floor,
    result: DemoSeedResult,
) -> list[Seat]:
    """Create one floor's desks and meeting rooms.

    Desk codes are `<level>-<block>-<number>`, blocks of twenty, which is how
    an office actually numbers them and makes the top-seats report readable.
    Meeting rooms are named rather than numbered — they are seats with
    `seat_type = MEETING_ROOM`, not a separate table.
    """
    seats: list[Seat] = []

    desk_count = rng.randint(spec.min_desks, spec.max_desks)
    for index in range(desk_count):
        block = chr(ord("A") + index // 20)
        seats.append(
            Seat(
                floor_id=floor.id,
                code=f"{floor.level_number}-{block}-{index % 20 + 1:02d}",
                seat_type=SeatType.DESK,
                is_active=True,
            )
        )
    result.desks += desk_count

    room_count = rng.randint(spec.min_meeting_rooms, spec.max_meeting_rooms)
    for room_name in rng.sample(MEETING_ROOM_NAMES, room_count):
        seats.append(
            Seat(
                floor_id=floor.id,
                code=f"{floor.level_number}-{room_name}",
                seat_type=SeatType.MEETING_ROOM,
                is_active=True,
            )
        )
    result.meeting_rooms += room_count

    session.add_all(seats)
    session.flush()
    return seats


# --- People ------------------------------------------------------------------


def _seed_people(
    session: Session,
    rng: random.Random,
    spec: DemoSpec,
    buildings: list[Building],
    groups: list[Category],
    result: DemoSeedResult,
) -> tuple[User, list[User], list[User]]:
    """Create the admin, the six engineers and the employees.

    Every account shares one bcrypt hash, computed once. bcrypt at twelve
    rounds costs roughly a quarter of a second per hash by design, so hashing
    thirty-seven identical demo passwords separately would add about nine
    seconds to a seed for no benefit whatever: the password is published in the
    return payload, so the salt is protecting nothing. Real accounts still go
    through `hash_password` per user — this shortcut is confined to demo data.
    """
    shared_hash = hash_password(DEMO_PASSWORD)
    group_ids = {group.name: group.id for group in groups}

    admin = _make_user(
        "Ada Whitfield", UserRole.FACILITY_ADMIN, shared_hash, buildings[0], email="demo.admin"
    )
    session.add(admin)
    result.admins += 1

    engineers: list[User] = []
    for index, (name, level, specialties, home_index) in enumerate(ENGINEER_SEEDS):
        home = buildings[home_index % len(buildings)]
        engineer = _make_user(name, UserRole.ENGINEER, shared_hash, home)
        session.add(engineer)
        session.flush()  # the profile's primary key *is* the user id
        session.add(
            EngineerProfile(
                user_id=engineer.id,
                level=level,
                specialty_group_ids=[
                    group_ids[group_name] for group_name in specialties if group_name in group_ids
                ],
                home_building_id=home.id,
                phone=f"+1 555 0{100 + index:03d}",
                availability=ENGINEER_AVAILABILITY[index % len(ENGINEER_AVAILABILITY)],
                max_active_tickets=MAX_ACTIVE_BY_LEVEL[level],
            )
        )
        engineers.append(engineer)
        result.engineers += 1

    employees: list[User] = []
    # How many we will actually create, which is not len(EMPLOYEE_NAMES): the
    # name list is longer than the default spec so that a larger run has names
    # to draw on. Deactivation below counts from THIS number. Keying it off the
    # length of the name list instead meant the condition targeted indices 34
    # and 35 while the loop stopped at 29, so nobody was ever deactivated and
    # the test — which asserted the employee count, not how many were active —
    # stayed green. See D34.
    created = min(spec.employees, len(EMPLOYEE_NAMES))
    for index in range(created):
        home = _weighted_choice(rng, buildings, BUILDING_WEIGHTS[: len(buildings)])
        employee = _make_user(EMPLOYEE_NAMES[index], UserRole.EMPLOYEE, shared_hash, home)
        # The last two people have left. A users screen where everyone is active
        # never shows the deactivated state, and the reports still count their
        # old tickets, which is the behaviour worth demonstrating.
        employee.is_active = index < created - 2
        session.add(employee)
        employees.append(employee)
        result.employees += 1

    session.flush()
    return admin, engineers, employees


def _make_user(
    full_name: str,
    role: UserRole,
    password_hash: str,
    home: Building,
    *,
    email: str | None = None,
) -> User:
    """Build one demo account, with its home building pre-selected."""
    local = email or full_name.lower().replace(" ", ".").replace("'", "")
    return User(
        email=f"{local}@{EMAIL_DOMAIN}",
        password_hash=password_hash,
        full_name=full_name,
        role=role,
        is_active=True,
        # Deliberately False: a reviewer signing in as six different people
        # should not have to change six passwords first.
        must_change_password=False,
        last_building_id=home.id,
    )


def _category_groups(session: Session) -> list[Category]:
    """Return the top-level category groups, which `migrate` has already seeded."""
    statement = select(Category).where(Category.parent_id.is_(None)).order_by(Category.sort_order)
    return list(session.scalars(statement).all())


# --- Incidents ---------------------------------------------------------------

#: Hour of the day a ticket is reported, and how likely each is. Two humps,
#: mid-morning and mid-afternoon, so the daily series on `/reports/summary`
#: looks like an office rather than a uniform smear.
WORKING_HOURS: tuple[int, ...] = (7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)
WORKING_HOUR_WEIGHTS: tuple[float, ...] = (
    0.02,
    0.06,
    0.13,
    0.15,
    0.12,
    0.06,
    0.05,
    0.11,
    0.12,
    0.09,
    0.05,
    0.03,
    0.01,
)

#: How likely a ticket is to be reported in its reporter's home building.
#: The rest are people visiting another site, which is what stops
#: `/reports/locations` being a restatement of where everyone sits.
HOME_BUILDING_SHARE = 0.85

#: How often a ticket's life includes a period of blocked work.
BLOCK_PROBABILITY = 0.18

#: How often a ticket is escalated at some point, and how often the escalation
#: is cleared afterwards. The gap between the two is the reason D10 and D11
#: exist: most escalations end with the work being done, not with a Clear.
ESCALATE_PROBABILITY = 0.13
CLEAR_ESCALATION_PROBABILITY = 0.35

#: How often a closed ticket comes back. M4 allows a reopen within seven days.
REOPEN_PROBABILITY = 0.09
REOPEN_WINDOW_HOURS = 6.5 * 24


@dataclass
class _EventSpec:
    """One `incident_events` row, before it knows which incident it belongs to."""

    when: datetime
    event_type: EventType
    actor_id: uuid.UUID | None = None
    from_value: str | None = None
    to_value: str | None = None
    reason: str | None = None


@dataclass
class _NoteSpec:
    """One `incident_notes` row, before it knows which incident it belongs to."""

    when: datetime
    author_id: uuid.UUID
    body: str
    visibility: NoteVisibility


def _seed_incidents(
    session: Session,
    rng: random.Random,
    spec: DemoSpec,
    result: DemoSeedResult,
    *,
    now: datetime,
    world: _World,
) -> None:
    """Plan every ticket, walk each timeline to `now`, then write the rows.

    Three passes, in this order and for this reason: incidents are inserted
    first because events, notes and the duplicate links all need
    `incident.id`, which only exists after the flush.
    """
    plans = _plan_all(rng, spec, now=now, world=world)

    incidents: list[Incident] = []
    outcomes: list[_Outcome] = []
    specs: list[tuple[list[_EventSpec], list[_NoteSpec]]] = []

    for plan in plans:
        outcome, events, notes = _walk(plan, now=now, admin=world.admin)
        incidents.append(_build_incident(plan, outcome))
        outcomes.append(outcome)
        specs.append((events, notes))

    session.add_all(incidents)
    session.flush()  # assigns id and ticket_number

    _link_duplicates(rng, plans, incidents, outcomes, specs)
    _write_events_and_notes(session, incidents, specs, result)
    watchers = _write_watchers(session, rng, plans, incidents, result, world=world)
    feedback = _write_feedback(session, rng, plans, incidents, outcomes, result, now=now)
    _write_notifications(
        session,
        rng,
        incidents,
        specs,
        result,
        world=world,
        watchers=watchers,
        feedback=feedback,
        now=now,
    )
    _summarise(result, plans, incidents, world.engineers)


def _subcategories_by_group(session: Session, groups: list[Category]) -> dict[str, list[Category]]:
    """Return each group's subcategories, keyed by the group's name."""
    parent_ids = [group.id for group in groups]
    statement = (
        select(Category)
        .where(Category.parent_id.in_(parent_ids))
        .order_by(Category.parent_id, Category.sort_order)
    )
    by_id = {group.id: group.name for group in groups}
    result: dict[str, list[Category]] = {name: [] for name in by_id.values()}
    for subcategory in session.scalars(statement).all():
        result[by_id[subcategory.parent_id]].append(subcategory)
    return result


def _reporter_weights(employees: list[User]) -> list[float]:
    """Return how often each employee reports something.

    A long tail: a handful of people raise most of the tickets, which is what
    actually happens and what makes "top reporters" a question worth asking.
    The exponent is gentle on purpose — at 0.6 the busiest employee reported
    forty of three hundred tickets in ninety days, which is not a colleague,
    it is a fault-reporting robot.
    """
    return [1.0 / (index + 1) ** 0.4 for index in range(len(employees))]


def _plan_all(rng: random.Random, spec: DemoSpec, *, now: datetime, world: _World) -> list[_Plan]:
    """Decide every ticket, hotspots first, then sort them into time order.

    Sorting matters for more than tidiness: ticket numbers come from a
    sequence, so inserting in chronological order makes INC-000001 the oldest
    ticket the way it would be in a system that had been running for ninety
    days. It also means a duplicate can only ever point backwards.
    """
    plans: list[_Plan] = []

    for hotspot in _choose_hotspots(rng, spec, world):
        plans.extend(
            _plan_incident(rng, spec, now=now, world=world, placement=hotspot)
            for _ in range(rng.randint(4, 7))
        )

    while len(plans) < spec.incidents:
        placement = _random_placement(rng, world)
        plans.append(_plan_incident(rng, spec, now=now, world=world, placement=placement))

    plans.sort(key=lambda plan: plan.created_at)
    return plans[: spec.incidents]


@dataclass(frozen=True)
class _Placement:
    """Where a ticket happened and what kind of problem it is."""

    group_name: str
    category: Category
    building: Building
    floor: Floor | None
    seat: Seat | None


def _choose_hotspots(rng: random.Random, spec: DemoSpec, world: _World) -> list[_Placement]:
    """Pick a few desks with a recurring problem.

    The brief's business questions include "are there recurring problems at the
    same location?", and the answer has to be yes for the report to be worth
    reading. Each hotspot is one seat and one subcategory, repeated across the
    ninety days.
    """
    hotspots: list[_Placement] = []
    recurring_groups = ("Building & Facilities", "Hardware", "Meeting Rooms")

    for index in range(spec.hotspots):
        group_name = recurring_groups[index % len(recurring_groups)]
        building = world.buildings[index % len(world.buildings)]
        floor = rng.choice(world.floors[building.id])
        wants_room = group_name == "Meeting Rooms"
        seat = _pick_seat(rng, world.seats[floor.id], meeting_room=wants_room)
        hotspots.append(
            _Placement(
                group_name=group_name,
                category=rng.choice(world.subcategories[group_name]),
                building=building,
                floor=floor,
                seat=seat,
            )
        )
    return hotspots


def _random_placement(rng: random.Random, world: _World) -> _Placement:
    """Pick a category and a location, at the precision the category demands.

    `location_detail` is honoured exactly as the questionnaire honours it: a
    SEAT group always gets a seat (a meeting room, for the Meeting Rooms
    group), a FLOOR group always gets a floor, and a BUILDING group may get
    neither. More precision than required is allowed — see
    `_require_location_precision` — and is supplied often, because a location
    report over tickets that only name a building has nothing to rank.
    """
    group = _weighted_choice(
        rng,
        world.groups,
        [CATEGORY_GROUP_WEIGHTS.get(group.name, 0.1) for group in world.groups],
    )
    building = _weighted_choice(rng, world.buildings, BUILDING_WEIGHTS[: len(world.buildings)])
    floor = rng.choice(world.floors[building.id])
    detail = group.location_detail
    on_this_floor = world.seats[floor.id]

    if detail == LocationDetail.SEAT:
        seat = _pick_seat(rng, on_this_floor, meeting_room=group.name == "Meeting Rooms")
    elif detail == LocationDetail.FLOOR:
        seat = _pick_seat(rng, on_this_floor) if rng.random() < 0.65 else None
    else:
        seat = _pick_seat(rng, on_this_floor) if rng.random() < 0.25 else None
        if seat is None and rng.random() < 0.45:
            return _Placement(
                group_name=group.name,
                category=rng.choice(world.subcategories[group.name]),
                building=building,
                floor=None,
                seat=None,
            )

    return _Placement(
        group_name=group.name,
        category=_weighted_choice(
            rng,
            world.subcategories[group.name],
            _subcategory_weights(len(world.subcategories[group.name])),
        ),
        building=building,
        floor=floor,
        seat=seat,
    )


def _subcategory_weights(count: int) -> list[float]:
    """Return a decaying weight per subcategory, so the first ones dominate.

    The seed lists each group's subcategories roughly in order of how common
    they are, and every group ends with "Other", which should be rare.
    """
    return [1.0 / (index + 1) ** 0.8 for index in range(count)]


def _pick_seat(rng: random.Random, seats: list[Seat], *, meeting_room: bool = False) -> Seat | None:
    """Return a desk, or a meeting room when the category calls for one."""
    wanted = SeatType.MEETING_ROOM if meeting_room else SeatType.DESK
    candidates = [seat for seat in seats if seat.seat_type == wanted]
    return rng.choice(candidates) if candidates else None


# --- One ticket's life -------------------------------------------------------


#: What a ticket says when its group has no phrases of its own.
#:
#: `CATEGORY_GROUP_WEIGHTS` has always had a `.get(name, 0.1)` fallback, so a
#: category group added after this file was written is picked and given a
#: share — and `SYMPTOMS` had no equivalent, so the seeder raised `KeyError`
#: on the first ticket it tried to word. Adding three groups in §6.2 broke
#: `seed_demo` outright, which is the one path the demo database is rebuilt
#: through. Both halves fall back now, so the next group to be added is a
#: slightly duller sentence rather than a broken seeder.
GENERIC_SYMPTOMS: tuple[str, ...] = (
    "needs looking at",
    "is not working properly",
    "has been a problem all week",
)


def _symptoms_for(group_name: str) -> tuple[str, ...]:
    """Return the phrases for this group, or the generic ones."""
    return SYMPTOMS.get(group_name, GENERIC_SYMPTOMS)


def _plan_incident(
    rng: random.Random,
    spec: DemoSpec,
    *,
    now: datetime,
    world: _World,
    placement: _Placement,
) -> _Plan:
    """Decide when a ticket was reported and everything that was going to happen.

    Nothing here looks at `now`: the path is the path the work would have
    taken. `_walk` is what decides how much of it has happened yet.
    """
    created_at = _draw_created_at(rng, spec, now)
    reporter = _weighted_choice(rng, world.employees, world.reporter_weights)
    priority = _draw_priority(rng, placement.category.name)
    path = _weighted_choice(rng, list(PATH_WEIGHTS), list(PATH_WEIGHTS.values()))
    assignee = None if path == "never_assigned" else _draw_assignee(rng, world.engineers, placement)

    symptom = rng.choice(_symptoms_for(placement.group_name))
    where = (
        placement.seat.code
        if placement.seat
        else (placement.floor.name if placement.floor else placement.building.code)
    )
    plan = _Plan(
        created_at=created_at,
        reporter=reporter,
        group_name=placement.group_name,
        category=placement.category,
        building=placement.building,
        floor=placement.floor,
        seat=placement.seat,
        priority=priority,
        title=f"{placement.category.name} {symptom}",
        description=(
            f"{placement.category.name} at {where} in {placement.building.name} {symptom}. "
            "It started earlier today and has not cleared on its own."
        ),
        path=path,
        assignee=assignee,
    )
    plan.steps = _plan_steps(rng, plan)
    return plan


def _plan_steps(rng: random.Random, plan: _Plan) -> list[_Step]:
    """Build the full intended timeline for one ticket, in time order.

    Every step carries an absolute instant, and every instant is derived from
    `created_at` plus a drawn duration. This is where the backdating lives: the
    rows written later copy these timestamps rather than defaulting to `now()`.
    """
    steps: list[_Step] = []
    assign_median, ack_median, work_median = RESPONSE_MEDIANS[plan.priority]

    if plan.path == "invalid":
        reason = rng.choice([CloseReason.INVALID, CloseReason.CANCELLED_BY_REPORTER])
        when = plan.created_at + timedelta(hours=_draw_hours(rng, 6.0))
        steps.append(_Step(when, "close", reason.value))
        return _with_escalation(rng, plan, steps)

    if plan.path == "duplicate":
        when = plan.created_at + timedelta(hours=_draw_hours(rng, 4.0))
        steps.append(_Step(when, "close", CloseReason.DUPLICATE.value))
        return _with_escalation(rng, plan, steps)

    if plan.path == "never_assigned":
        # Nothing happens at all. These are the backlog, and they are why an
        # "unassigned" figure on the admin dashboard is not always zero.
        return _with_escalation(rng, plan, steps)

    assigned_at = plan.created_at + timedelta(hours=_draw_hours(rng, assign_median))
    steps.append(_Step(assigned_at, "assign"))

    if plan.path == "assigned_not_started":
        # Assigned and not picked up. Still OPEN, and sitting in an engineer's
        # "assigned to me" list — which is what puts a number in the
        # `open_count` column of `/reports/engineer-workload`.
        return _with_escalation(rng, plan, steps)

    started_at = assigned_at + timedelta(hours=_draw_hours(rng, ack_median))
    steps.append(_Step(started_at, "start"))
    if rng.random() < PUBLIC_UPDATE_PROBABILITY:
        steps.append(
            _Step(
                started_at + timedelta(hours=_draw_hours(rng, 1.5)),
                "note_public_staff",
            )
        )
    if rng.random() < 0.35:
        steps.append(_Step(started_at + timedelta(hours=_draw_hours(rng, 3.0)), "note_internal"))
    if rng.random() < 0.25:
        steps.append(_Step(started_at + timedelta(hours=_draw_hours(rng, 8.0)), "note_reporter"))

    work_hours = _draw_hours(rng, work_median)
    resolved_at = started_at + timedelta(hours=work_hours)

    if plan.path == "stuck_blocked":
        # Blocked and still blocked. The age is however long ago the ticket was
        # reported, which is what gives `/reports/blocked-escalated` a spread of
        # ages to rank rather than a column of single-digit hours.
        reason_type = _weighted_choice(
            rng, list(BLOCKED_REASON_WEIGHTS), list(BLOCKED_REASON_WEIGHTS.values())
        )
        blocked_at = started_at + timedelta(hours=work_hours * rng.uniform(0.1, 0.5))
        steps.append(_Step(blocked_at, "block", reason_type.value))
        return _with_escalation(rng, plan, steps)

    if plan.path == "stalled":
        # Started and never finished. Stays IN_PROGRESS for good.
        return _with_escalation(rng, plan, steps)

    if rng.random() < BLOCK_PROBABILITY:
        blocked_at = started_at + timedelta(hours=work_hours * rng.uniform(0.15, 0.6))
        reason_type = _weighted_choice(
            rng, list(BLOCKED_REASON_WEIGHTS), list(BLOCKED_REASON_WEIGHTS.values())
        )
        steps.append(_Step(blocked_at, "block", reason_type.value))
        # Blocks are long: that is what makes the age column on
        # `/reports/blocked-escalated` worth a column. A block that outlasts
        # `now` is how a ticket ends up BLOCKED in the finished dataset.
        unblocked_at = blocked_at + timedelta(hours=_draw_hours(rng, 60.0))
        steps.append(_Step(unblocked_at, "unblock"))
        resolved_at = unblocked_at + timedelta(hours=work_hours * rng.uniform(0.3, 0.8))

    steps.extend(_resolution_steps(rng, resolved_at))

    if plan.path == "awaiting_confirmation":
        # Fixed, and waiting on the reporter to say so. This is the state the
        # employee home screen's fourth tile is about.
        return _with_escalation(rng, plan, steps)

    closed_at = resolved_at + timedelta(hours=_draw_hours(rng, 30.0))
    close_reason = (
        CloseReason.CONFIRMED_FIXED if rng.random() < 0.7 else CloseReason.CLOSED_BY_ENGINEER
    )
    steps.append(_Step(closed_at, "close", close_reason.value))

    if rng.random() < REOPEN_PROBABILITY:
        reopened_at = closed_at + timedelta(hours=rng.uniform(6.0, REOPEN_WINDOW_HOURS))
        steps.append(_Step(reopened_at, "reopen"))
        second_resolve = reopened_at + timedelta(hours=_draw_hours(rng, work_median * 0.6))
        steps.extend(_resolution_steps(rng, second_resolve))
        steps.append(
            _Step(
                second_resolve + timedelta(hours=_draw_hours(rng, 30.0)),
                "close",
                CloseReason.CONFIRMED_FIXED.value,
            )
        )

    return _with_escalation(rng, plan, steps)


def _resolution_steps(rng: random.Random, resolved_at: datetime) -> list[_Step]:
    """Resolve a ticket, then write the note that says what was done.

    The note lands a few minutes *after* `resolved_at`, not on it, because that
    is the order the two actually happen in: marking a ticket resolved is one
    request and writing a note is another, and nobody types the summary before
    pressing the button.

    It matters to a report. `/reports/communication` counts a reporter as
    "kept informed" when the first public staff note is at or before
    `resolved_at`, which is asking whether they heard anything *while the
    ticket was open*. A resolution note stamped at exactly `resolved_at` would
    satisfy that test on every single resolved ticket and pin the number at
    100% — which is what it did, before this. The note the metric is about is
    the early update, and that one is written `PUBLIC_UPDATE_PROBABILITY` of
    the time.
    """
    summary = rng.choice(RESOLUTIONS)
    return [
        _Step(resolved_at, "resolve", summary),
        _Step(resolved_at + timedelta(minutes=rng.randint(3, 40)), "note_resolution", summary),
    ]


def _with_escalation(rng: random.Random, plan: _Plan, steps: list[_Step]) -> list[_Step]:
    """Add an escalation, and sometimes a clearing, then put it all in time order.

    An unassigned ticket is escalated because nobody has looked at it, which is
    the most common real reason, so those are escalated more often. Most
    escalations are never cleared — the work simply gets done — which is the
    behaviour that made D10 and D11 necessary and is worth having in the demo
    data so the fix has something to be right about.
    """
    likelihood = ESCALATE_PROBABILITY * (2.5 if plan.path in STALLED_PATHS else 1.0)
    if rng.random() < likelihood:
        escalated_at = plan.created_at + timedelta(hours=_draw_hours(rng, 26.0))
        reasons = (
            ESCALATION_REASONS
            if plan.group_name == SAFETY_REASON_GROUP
            else ESCALATION_REASONS[:-1]
        )
        steps.append(_Step(escalated_at, "escalate", rng.choice(reasons)))
        if rng.random() < CLEAR_ESCALATION_PROBABILITY:
            cleared_at = escalated_at + timedelta(hours=_draw_hours(rng, 20.0))
            steps.append(_Step(cleared_at, "clear_escalation"))
    steps.sort(key=lambda step: step.when)
    return steps


def _walk(
    plan: _Plan, *, now: datetime, admin: User
) -> tuple[_Outcome, list[_EventSpec], list[_NoteSpec]]:
    """Apply the timeline up to `now` and return the state it leaves behind.

    The stopping rule is the whole design: steps are in time order, so the
    first one later than `now` ends the walk and everything after it simply
    has not happened yet. A ticket is OPEN because its assignment is still in
    the future, not because a status was picked for it.

    The effects mirror `_apply_transition_effects` in
    `services/incident_service.py` exactly — entering IN_PROGRESS clears the
    resolution and closure fields, anything other than BLOCKED clears the
    blocked reason, a reopen increments the counter — so nothing here can
    produce a row the state machine could not.
    """
    outcome = _Outcome(last_activity=plan.created_at)
    events: list[_EventSpec] = [
        _EventSpec(plan.created_at, EventType.CREATED, actor_id=plan.reporter.id)
    ]
    notes: list[_NoteSpec] = []
    worker_id = plan.assignee.id if plan.assignee else admin.id

    for step in plan.steps:
        if step.when > now:
            break
        outcome.last_activity = step.when
        _apply_step(step, plan, outcome, events, notes, worker_id=worker_id, admin=admin)

    return outcome, events, notes


def _apply_step(
    step: _Step,
    plan: _Plan,
    outcome: _Outcome,
    events: list[_EventSpec],
    notes: list[_NoteSpec],
    *,
    worker_id: uuid.UUID,
    admin: User,
) -> None:
    """Apply one moment to the running state, and log what it would have logged."""
    previous = outcome.status

    if step.kind == "assign" and plan.assignee is not None:
        outcome.assignee_id = plan.assignee.id
        outcome.assigned_at = step.when
        events.append(
            _EventSpec(
                step.when,
                EventType.ASSIGNED,
                actor_id=admin.id,
                to_value=str(plan.assignee.id),
            )
        )
        return

    if step.kind == "start":
        _enter(outcome, IncidentStatus.IN_PROGRESS)
        outcome.acknowledged_at = outcome.acknowledged_at or step.when
        events.append(_status_event(step.when, worker_id, previous, outcome.status))
        return

    if step.kind == "block":
        reason_type = BlockedReasonType(step.detail or BlockedReasonType.OTHER.value)
        _enter(outcome, IncidentStatus.BLOCKED)
        outcome.blocked_reason_type = reason_type
        outcome.blocked_reason = BLOCKED_NOTES[reason_type]
        events.append(
            _status_event(
                step.when, worker_id, previous, outcome.status, reason=outcome.blocked_reason
            )
        )
        return

    if step.kind == "unblock":
        _enter(outcome, IncidentStatus.IN_PROGRESS)
        events.append(_status_event(step.when, worker_id, previous, outcome.status))
        return

    if step.kind == "resolve":
        _enter(outcome, IncidentStatus.RESOLVED)
        outcome.resolved_at = step.when
        outcome.resolution_summary = step.detail
        events.append(_status_event(step.when, worker_id, previous, outcome.status))
        return

    if step.kind == "close":
        reason = CloseReason(step.detail or CloseReason.CONFIRMED_FIXED.value)
        _enter(outcome, IncidentStatus.CLOSED)
        outcome.closed_at = step.when
        outcome.close_reason = reason
        outcome.is_duplicate = reason == CloseReason.DUPLICATE
        actor = plan.reporter.id if reason == CloseReason.CONFIRMED_FIXED else worker_id
        events.append(_status_event(step.when, actor, previous, outcome.status))
        if outcome.is_duplicate:
            # to_value is filled in once the target incident has an id.
            events.append(_EventSpec(step.when, EventType.MARKED_DUPLICATE, actor_id=worker_id))
        return

    if step.kind == "reopen":
        _enter(outcome, IncidentStatus.IN_PROGRESS)
        outcome.reopen_count += 1
        events.append(
            _EventSpec(
                step.when,
                EventType.REOPENED,
                actor_id=plan.reporter.id,
                from_value=previous.value,
                to_value=outcome.status.value,
                reason="Same problem has come back.",
            )
        )
        return

    if step.kind == "escalate":
        outcome.is_escalated = True
        outcome.escalation_reason = step.detail
        outcome.escalated_at = step.when
        outcome.escalated_by = plan.reporter.id
        events.append(
            _EventSpec(
                step.when, EventType.ESCALATED, actor_id=plan.reporter.id, reason=step.detail
            )
        )
        return

    if step.kind == "clear_escalation":
        outcome.is_escalated = False
        outcome.escalation_reason = None
        outcome.escalated_at = None
        outcome.escalated_by = None
        events.append(_EventSpec(step.when, EventType.ESCALATION_CLEARED, actor_id=admin.id))
        return

    _add_note(step, plan, notes, events, worker_id=worker_id)


def _add_note(
    step: _Step,
    plan: _Plan,
    notes: list[_NoteSpec],
    events: list[_EventSpec],
    *,
    worker_id: uuid.UUID,
) -> None:
    """Write one of the four kinds of note, with its NOTE_ADDED event.

    The public staff note is the one that matters to a report:
    `/reports/communication` measures the share of resolved tickets whose
    reporter was told something *before* it was resolved, and the median delay
    to that first note. Without these the communication tile reads 0%.
    """
    if step.kind == "note_public_staff":
        author = worker_id
        body, visibility = _pick_note(step, STAFF_PUBLIC_NOTES), NoteVisibility.PUBLIC
    elif step.kind == "note_internal":
        author = worker_id
        body, visibility = _pick_note(step, STAFF_INTERNAL_NOTES), NoteVisibility.INTERNAL
    elif step.kind == "note_reporter":
        author = plan.reporter.id
        body, visibility = _pick_note(step, REPORTER_NOTES), NoteVisibility.PUBLIC
    elif step.kind == "note_resolution":
        author = worker_id
        body, visibility = step.detail or "Resolved.", NoteVisibility.PUBLIC
    else:
        raise ValueError(f"Unknown planned step '{step.kind}'.")

    notes.append(_NoteSpec(step.when, author, body, visibility))
    events.append(_EventSpec(step.when, EventType.NOTE_ADDED, actor_id=author))


def _pick_note(step: _Step, pool: tuple[str, ...]) -> str:
    """Choose a note body deterministically from the step's own timestamp.

    Keyed on the instant rather than drawn from the shared generator, so that
    changing how many notes an earlier ticket gets does not reshuffle the text
    on every ticket after it.
    """
    return pool[(step.when.minute + step.when.second) % len(pool)]


def _enter(outcome: _Outcome, status: IncidentStatus) -> None:
    """Apply "what it means to be in this status", as the service layer does."""
    outcome.status = status

    if status == IncidentStatus.IN_PROGRESS:
        outcome.resolved_at = None
        outcome.closed_at = None
        outcome.close_reason = None
        outcome.is_duplicate = False

    if status != IncidentStatus.BLOCKED:
        outcome.blocked_reason_type = None
        outcome.blocked_reason = None


def _status_event(
    when: datetime,
    actor_id: uuid.UUID | None,
    previous: IncidentStatus,
    current: IncidentStatus,
    *,
    reason: str | None = None,
) -> _EventSpec:
    """Build the STATUS_CHANGED row the reports read blocked ages out of."""
    return _EventSpec(
        when,
        EventType.STATUS_CHANGED,
        actor_id=actor_id,
        from_value=previous.value,
        to_value=current.value,
        reason=reason,
    )


# --- Writing the rows --------------------------------------------------------


def _build_incident(plan: _Plan, outcome: _Outcome) -> Incident:
    """Turn one finished timeline into the incident row it implies.

    `created_at` and `updated_at` are set explicitly. Both carry a
    `server_default` of `now()`, so leaving them alone would stamp ninety days
    of history with today's date and flatten every chart the phase exists to
    fill.
    """
    return Incident(
        title=plan.title,
        description=plan.description,
        category_id=plan.category.id,
        building_id=plan.building.id,
        floor_id=plan.floor.id if plan.floor else None,
        seat_id=plan.seat.id if plan.seat else None,
        status=outcome.status,
        priority=plan.priority,
        reporter_id=plan.reporter.id,
        assignee_id=outcome.assignee_id,
        is_escalated=outcome.is_escalated,
        escalation_reason=outcome.escalation_reason,
        escalated_at=outcome.escalated_at,
        escalated_by=outcome.escalated_by,
        blocked_reason_type=outcome.blocked_reason_type,
        blocked_reason=outcome.blocked_reason,
        resolution_summary=outcome.resolution_summary,
        close_reason=outcome.close_reason,
        reopen_count=outcome.reopen_count,
        assigned_at=outcome.assigned_at,
        acknowledged_at=outcome.acknowledged_at,
        resolved_at=outcome.resolved_at,
        # Who the fix belongs to. The assignee, because in the demo world
        # nothing reassigns a ticket after it has been resolved — the case
        # that makes this column necessary at all is real and is not one the
        # generator produces. `_apply_transition_effects` writes the same
        # thing on the live path.
        resolved_by_id=outcome.assignee_id if outcome.resolved_at is not None else None,
        closed_at=outcome.closed_at,
        created_at=plan.created_at,
        updated_at=outcome.last_activity or plan.created_at,
    )


def _link_duplicates(
    rng: random.Random,
    plans: list[_Plan],
    incidents: list[Incident],
    outcomes: list[_Outcome],
    specs: list[tuple[list[_EventSpec], list[_NoteSpec]]],
) -> None:
    """Point each duplicate at an earlier ticket about the same thing.

    Only backwards: the plans are in chronological order and ticket numbers
    follow them, so a duplicate always refers to a ticket that already existed.
    The very first ticket of its kind has nothing to be a duplicate of, so it
    is closed as INVALID instead and its MARKED_DUPLICATE event is dropped.
    """
    seen_by_category: dict[uuid.UUID, list[int]] = {}
    seen_by_building: dict[uuid.UUID, list[int]] = {}

    for index, plan in enumerate(plans):
        if outcomes[index].is_duplicate:
            candidates = seen_by_category.get(plan.category.id) or seen_by_building.get(
                plan.building.id, []
            )
            _apply_duplicate_link(rng, index, candidates, incidents, specs)

        seen_by_category.setdefault(plan.category.id, []).append(index)
        seen_by_building.setdefault(plan.building.id, []).append(index)


def _apply_duplicate_link(
    rng: random.Random,
    index: int,
    candidates: list[int],
    incidents: list[Incident],
    specs: list[tuple[list[_EventSpec], list[_NoteSpec]]],
) -> None:
    """Attach one duplicate to its original, or downgrade it if there is none."""
    events = specs[index][0]
    marker = next(
        (event for event in events if event.event_type == EventType.MARKED_DUPLICATE), None
    )

    if not candidates:
        incidents[index].close_reason = CloseReason.INVALID
        if marker is not None:
            events.remove(marker)
        return

    target = incidents[rng.choice(candidates[-10:])]
    incidents[index].duplicate_of_id = target.id
    if marker is not None:
        marker.to_value = str(target.id)
        marker.reason = f"Duplicate of {target.reference}."


def _write_events_and_notes(
    session: Session,
    incidents: list[Incident],
    specs: list[tuple[list[_EventSpec], list[_NoteSpec]]],
    result: DemoSeedResult,
) -> None:
    """Insert the backdated event log and the notes.

    `IncidentEvent.created_at` defaults to `clock_timestamp()` and
    `IncidentNote.created_at` to the same, so both are set explicitly here.
    The event log is what `/reports/blocked-escalated` reads a blocked age out
    of (there is no `blocked_at` column — decision D6), so a log stamped with
    the moment of seeding would report every block as zero hours old.
    """
    rows: list[IncidentEvent | IncidentNote] = []

    for incident, (events, notes) in zip(incidents, specs, strict=True):
        rows.extend(
            IncidentEvent(
                incident_id=incident.id,
                actor_id=event.actor_id,
                event_type=event.event_type,
                from_value=event.from_value,
                to_value=event.to_value,
                reason=event.reason,
                created_at=event.when,
            )
            for event in events
        )
        rows.extend(
            IncidentNote(
                incident_id=incident.id,
                author_id=note.author_id,
                body=note.body,
                visibility=note.visibility,
                created_at=note.when,
                updated_at=note.when,
            )
            for note in notes
        )
        result.events += len(events)
        result.notes += len(notes)

    session.add_all(rows)
    session.flush()


def _write_watchers(
    session: Session,
    rng: random.Random,
    plans: list[_Plan],
    incidents: list[Incident],
    result: DemoSeedResult,
    *,
    world: _World,
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Subscribe a few colleagues to the tickets whose subcategory allows it.

    Returns the followers per incident id, because `_write_notifications`
    needs them a moment later and re-reading rows this function just wrote
    would be a query to learn something it already knew.

    **Reads `allows_watchers` off the real category row** rather than
    re-deciding which kinds of problem are shared. The seeded mapping lives in
    `app/seed/categories.py`; a second opinion here would eventually disagree
    with it, and the demo world would then be demonstrating something the
    application does not do.

    Only employees follow tickets, and never the one who reported it — a
    reporter is already on their own ticket, and giving them a watch row as
    well would make the demo's "N others are affected" count one person too
    many on every ticket.
    """
    rows: list[IncidentWatcher] = []
    followers_by_incident: dict[uuid.UUID, list[uuid.UUID]] = {}

    for plan, incident in zip(plans, incidents, strict=True):
        if not plan.category.allows_watchers or rng.random() > WATCHED_SHARE:
            continue

        candidates = [person for person in world.employees if person.id != incident.reporter_id]
        wanted = min(rng.randint(*WATCHERS_PER_INCIDENT), len(candidates))
        followers = rng.sample(candidates, wanted)
        if not followers:
            continue

        followers_by_incident[incident.id] = [person.id for person in followers]
        rows.extend(
            IncidentWatcher(incident_id=incident.id, user_id=person.id) for person in followers
        )

    session.add_all(rows)
    session.flush()
    result.watchers = len(rows)
    return followers_by_incident


@dataclass(frozen=True)
class _FeedbackSpec:
    """One seeded rating, and the moment it was left.

    A spec rather than the row itself, because `_write_notifications` has to
    replay it through `app/notifications.py` a moment later and the rule reads
    `rated_user_id` off the object it is handed. Carrying the plan keeps the
    persisted row and the replayed one built from one set of decisions.
    """

    incident_id: uuid.UUID
    author_id: uuid.UUID
    rated_user_id: uuid.UUID
    resolution_round: int
    rating: int
    comment: str
    when: datetime


def _write_feedback(
    session: Session,
    rng: random.Random,
    plans: list[_Plan],
    incidents: list[Incident],
    outcomes: list[_Outcome],
    result: DemoSeedResult,
    *,
    now: datetime,
) -> dict[uuid.UUID, _FeedbackSpec]:
    """Have some reporters rate the repairs that were actually made.

    Returns the rating per incident id, because `_write_notifications` needs
    it immediately afterwards and re-reading rows this function just wrote
    would be a query to learn something it already knows — the same
    arrangement `_write_watchers` uses.

    **Only tickets the application would allow a rating on.** There has to be
    a `resolved_at` and somebody to attribute the work to, which rules out
    every ticket cancelled by its reporter or closed as a duplicate, and the
    rating has to fall inside `services/feedback.FEEDBACK_WINDOW` and before
    `now`. A seeded row outside those is a row no user could have created, and
    a demo world that contains one is showing a reviewer something the system
    does not do.

    **One rating per ticket, always round 1.** The table allows one per repair
    and a reopened ticket could carry two; the generator does not produce that
    case, because `reopen_count` is decided while the timeline is walked and
    matching a rating to each individual repair would mean replaying the walk.
    The case is covered by `tests/integration/test_feedback.py` instead, which
    is where a rule belongs rather than in a fixture.
    """
    specs: dict[uuid.UUID, _FeedbackSpec] = {}
    rows: list[IncidentFeedback] = []

    for plan, incident, outcome in zip(plans, incidents, outcomes, strict=True):
        rated_user_id = incident.resolved_by_id
        resolved_at = outcome.resolved_at
        if rated_user_id is None or resolved_at is None:
            continue
        if rng.random() > RATED_SHARE:
            continue

        when = resolved_at + timedelta(hours=rng.uniform(*FEEDBACK_DELAY_HOURS))
        if when > now or when - resolved_at > FEEDBACK_WINDOW:
            continue

        rating = rng.choices(range(1, 6), weights=RATING_WEIGHTS, k=1)[0]
        spec = _FeedbackSpec(
            incident_id=incident.id,
            author_id=plan.reporter.id,
            rated_user_id=rated_user_id,
            resolution_round=1,
            rating=rating,
            comment=rng.choice(FEEDBACK_COMMENTS[rating]),
            when=when,
        )
        specs[incident.id] = spec
        rows.append(
            IncidentFeedback(
                incident_id=spec.incident_id,
                author_id=spec.author_id,
                rated_user_id=spec.rated_user_id,
                resolution_round=spec.resolution_round,
                rating=spec.rating,
                comment=spec.comment,
                created_at=spec.when,
                updated_at=spec.when,
            )
        )

    session.add_all(rows)
    session.flush()
    result.feedback = len(rows)
    return specs


#: Which `EventType` produces which notification, when replaying a timeline.
#:
#: Four kinds of event out of ten. The absences are the rules: CREATED,
#: PRIORITY_CHANGED, ESCALATED, UNASSIGNED and MARKED_DUPLICATE notify nobody,
#: which is decision D31 and not an oversight here.
_NOTIFYING_EVENTS: dict[EventType, NotificationType] = {
    EventType.STATUS_CHANGED: NotificationType.STATUS_CHANGED,
    EventType.REOPENED: NotificationType.STATUS_CHANGED,
    EventType.ASSIGNED: NotificationType.ASSIGNED,
    EventType.ESCALATION_CLEARED: NotificationType.ESCALATION_CLEARED,
}


def _write_notifications(
    session: Session,
    rng: random.Random,
    incidents: list[Incident],
    specs: list[tuple[list[_EventSpec], list[_NoteSpec]]],
    result: DemoSeedResult,
    *,
    world: _World,
    watchers: dict[uuid.UUID, list[uuid.UUID]],
    feedback: dict[uuid.UUID, _FeedbackSpec],
    now: datetime,
) -> None:
    """Build the demo inbox by replaying each ticket through the real rules.

    **Deliberately not a second implementation of the policy.**
    ``app/notifications.py`` decides who hears about what; this walks a
    ticket's planned history in order, hands each moment to ``plan()``, and
    writes whatever comes back. A demo world whose notifications disagreed
    with the application's own rules would be worse than a demo world with no
    notifications in it — a reviewer comparing the inbox to the timeline would
    be shown a lie.

    The replay is necessary because the rules read *state*: the message for a
    status change names the status the ticket had reached at that moment, and
    the message for an assignment names the engineer it went to. The finished
    `Incident` row carries only the last of each. So a throwaway `Incident` is
    built per step carrying the state as of that step — transient, never added
    to the session, which is safe because `Incident.assignee` has no backref to
    pull it in.

    `read_at` is invented, like everything else in the demo world, and it is
    the one column a backfill of a *real* database could not honestly produce
    (D31). Here it is legitimate: the tickets are fictional too.

    A resolution is handed to `plan()` **twice**, once for each rule that
    fires on it — STATUS_CHANGED for the two people on the ticket, and
    WATCHED_RESOLVED for the people following it — which is exactly what
    `services/incident_service.perform_transition` does at the two lines it
    calls `notification_service.record`. Whether the second one produces
    anything is `_is_a_resolution` in the rule table, not a condition here.

    A rating is handed to it once more, after the timeline, because that is
    when it happened: `_write_feedback` places every rating after the repair
    it is about. The row is transient here for the same reason the incident
    snapshot is — `app/notifications.py` reads `rated_user_id` as an
    attribute, and reads nothing from a session.
    """
    people = {person.id: person for person in [world.admin, *world.engineers, *world.employees]}
    rows: list[Notification] = []

    for incident, (events, notes) in zip(incidents, specs, strict=True):
        assignee_id: uuid.UUID | None = None
        status = IncidentStatus.OPEN
        watcher_ids = watchers.get(incident.id, [])

        # One chronological stream. `sorted` is stable, so events and notes
        # written at the same instant keep the order the planner put them in.
        timeline: list[tuple[datetime, _EventSpec | _NoteSpec]] = sorted(
            [(event.when, event) for event in events] + [(note.when, note) for note in notes],
            key=lambda item: item[0],
        )

        for when, step in timeline:
            if isinstance(step, _NoteSpec):
                actor = people.get(step.author_id)
                if actor is None:
                    continue
                note = IncidentNote(
                    incident_id=incident.id,
                    author_id=step.author_id,
                    body=step.body,
                    visibility=step.visibility,
                )
                snapshot = _snapshot(
                    incident,
                    status=status,
                    assignee_id=assignee_id,
                    people=people,
                    watcher_ids=watcher_ids,
                )
                planned = notification_rules.plan(
                    NotificationType.NOTE_ADDED,
                    notification_rules.NotificationContext(
                        incident=snapshot, actor=actor, note=note
                    ),
                )
            else:
                if step.event_type in (EventType.STATUS_CHANGED, EventType.REOPENED):
                    status = IncidentStatus(step.to_value) if step.to_value else status
                elif step.event_type == EventType.ASSIGNED:
                    assignee_id = uuid.UUID(step.to_value) if step.to_value else None
                elif step.event_type == EventType.UNASSIGNED:
                    assignee_id = None

                notification_type = _NOTIFYING_EVENTS.get(step.event_type)
                actor = people.get(step.actor_id) if step.actor_id else None
                if notification_type is None or actor is None:
                    continue
                snapshot = _snapshot(
                    incident,
                    status=status,
                    assignee_id=assignee_id,
                    people=people,
                    watcher_ids=watcher_ids,
                )
                context = notification_rules.NotificationContext(incident=snapshot, actor=actor)
                planned = notification_rules.plan(notification_type, context)
                # The second rule this same moment can fire. `plan` returns
                # nothing unless the ticket has just reached RESOLVED and
                # somebody is following it.
                planned += notification_rules.plan(
                    NotificationType.WATCHED_RESOLVED,
                    context,
                )

            rows.extend(
                Notification(
                    user_id=item.user_id,
                    incident_id=incident.id,
                    type=item.type,
                    message=item.message,
                    created_at=when,
                    read_at=_read_at(rng, when, now=now),
                )
                for item in planned
            )

        rated = feedback.get(incident.id)
        if rated is None:
            continue

        author = people.get(rated.author_id)
        if author is None:  # pragma: no cover - the reporter is always seeded
            continue

        snapshot = _snapshot(
            incident,
            status=status,
            assignee_id=assignee_id,
            people=people,
            watcher_ids=watcher_ids,
        )
        rows.extend(
            Notification(
                user_id=item.user_id,
                incident_id=incident.id,
                type=item.type,
                message=item.message,
                created_at=rated.when,
                read_at=_read_at(rng, rated.when, now=now),
            )
            for item in notification_rules.plan(
                NotificationType.FEEDBACK_RECEIVED,
                notification_rules.NotificationContext(
                    incident=snapshot,
                    actor=author,
                    feedback=IncidentFeedback(
                        incident_id=rated.incident_id,
                        author_id=rated.author_id,
                        rated_user_id=rated.rated_user_id,
                        resolution_round=rated.resolution_round,
                        rating=rated.rating,
                        comment=rated.comment,
                    ),
                ),
            )
        )

    session.add_all(rows)
    session.flush()
    result.notifications = len(rows)


def _snapshot(
    incident: Incident,
    *,
    status: IncidentStatus,
    assignee_id: uuid.UUID | None,
    people: dict[uuid.UUID, User],
    watcher_ids: Sequence[uuid.UUID],
) -> Incident:
    """Return a throwaway `Incident` carrying the state as of one moment.

    Transient on purpose: never passed to `session.add`, and `Incident.assignee`
    is a one-way many-to-one, so setting it cannot drag this object into the
    session through a backref.

    `watchers` is filled with **fresh transient rows** rather than the ones
    `_write_watchers` persisted, for the same reason. `Incident.watchers` has
    no back-reference either, so nothing here can reach the session — but
    handing a persisted row to a throwaway parent is the kind of thing that
    stops being safe when somebody adds a `back_populates` years from now, and
    building two throwaway objects costs nothing.
    """
    snapshot = Incident(
        id=incident.id,
        ticket_number=incident.ticket_number,
        title=incident.title,
        status=status,
        reporter_id=incident.reporter_id,
        assignee_id=assignee_id,
    )
    snapshot.assignee = people.get(assignee_id) if assignee_id else None
    snapshot.watchers = [IncidentWatcher(user_id=user_id) for user_id in watcher_ids]
    return snapshot


def _read_at(rng: random.Random, sent_at: datetime, *, now: datetime) -> datetime | None:
    """Decide whether and when this notification was read.

    A notification is unread if the draw says so, and also if the moment it
    would have been read has not arrived yet — which is what leaves the most
    recent ones unread and gives the demo world a believable badge rather than
    an inbox that is either wholly read or wholly not.
    """
    if rng.random() > NOTIFICATION_READ_SHARE:
        return None
    delay = timedelta(hours=rng.uniform(*NOTIFICATION_READ_DELAY_HOURS))
    read_at = sent_at + delay
    return read_at if read_at <= now else None


def _summarise(
    result: DemoSeedResult,
    plans: list[_Plan],
    incidents: list[Incident],
    engineers: list[User],
) -> None:
    """Fill in the counts the invoke response reports back.

    Deliberately counted from the objects just built rather than re-queried:
    the point of the payload is to say what this run wrote, and a query would
    also pick up anything that was already there.
    """
    names = {engineer.id: engineer.full_name for engineer in engineers}
    result.incidents = len(incidents)
    result.by_status = dict(
        sorted(Counter(incident.status.value for incident in incidents).items())
    )
    result.by_priority = dict(
        sorted(Counter(incident.priority.value for incident in incidents).items())
    )
    result.by_category_group = dict(sorted(Counter(plan.group_name for plan in plans).items()))
    result.by_engineer = dict(
        sorted(
            Counter(
                names[incident.assignee_id]
                for incident in incidents
                if incident.assignee_id in names
            ).items()
        )
    )
    result.blocked_now = sum(
        1 for incident in incidents if incident.status == IncidentStatus.BLOCKED
    )
    result.escalated_live = sum(
        1
        for incident in incidents
        if incident.is_escalated and incident.status in ACTIVE_INCIDENT_STATUSES
    )
    result.escalated_on_closed = sum(
        1
        for incident in incidents
        if incident.is_escalated and incident.status not in ACTIVE_INCIDENT_STATUSES
    )
    result.duplicates = sum(1 for incident in incidents if incident.duplicate_of_id is not None)
    result.reopened = sum(1 for incident in incidents if incident.reopen_count > 0)
    result.unassigned = sum(1 for incident in incidents if incident.assignee_id is None)

    if incidents:
        result.earliest_incident = incidents[0].created_at.isoformat()
        result.latest_incident = incidents[-1].created_at.isoformat()


# --- Drawing numbers ---------------------------------------------------------


def _draw_created_at(rng: random.Random, spec: DemoSpec, now: datetime) -> datetime:
    """Pick when a ticket was reported: a working hour, on a working day.

    Skewed towards the recent end, because a growing site reports more now than
    it did three months ago, and the daily series is more interesting for it.
    Weekends are mostly pushed back to the Friday: an office reports very
    little on a Saturday, and a created-versus-closed chart with no weekly
    rhythm looks generated, because it is.
    """
    moment = now - timedelta(days=spec.days * rng.random() ** 1.25)
    if moment.weekday() >= 5 and rng.random() < 0.8:
        moment -= timedelta(days=moment.weekday() - 4)

    moment = moment.replace(
        hour=_weighted_choice(rng, list(WORKING_HOURS), list(WORKING_HOUR_WEIGHTS)),
        minute=rng.randrange(60),
        second=rng.randrange(60),
        microsecond=rng.randrange(1_000_000),
    )
    if moment >= now:
        moment = now - timedelta(minutes=rng.randrange(10, 180))
    return moment


def _draw_priority(rng: random.Random, subcategory_name: str) -> IncidentPriority:
    """Pick a priority, raising it for the kinds of problem that are urgent."""
    priority = _weighted_choice(rng, list(PRIORITY_WEIGHTS), list(PRIORITY_WEIGHTS.values()))
    if subcategory_name in URGENT_SUBCATEGORIES and rng.random() < 0.6:
        return IncidentPriority.HIGH if rng.random() < 0.6 else IncidentPriority.CRITICAL
    return priority


def _draw_assignee(rng: random.Random, engineers: list[User], placement: _Placement) -> User | None:
    """Pick who the ticket went to: mostly a specialist, weighted by load.

    Two effects combined. The base weights make some engineers busier than
    others, so "who is overloaded" has an answer. The specialty multiplier
    makes tickets mostly land with an engineer whose group covers them, so the
    workload report agrees with the engineers screen.
    """
    if not engineers:
        return None

    weights: list[float] = []
    for index, (_, _, specialties, _) in enumerate(ENGINEER_SEEDS[: len(engineers)]):
        base = ENGINEER_LOAD_WEIGHTS[index % len(ENGINEER_LOAD_WEIGHTS)]
        weights.append(base * (4.0 if placement.group_name in specialties else 1.0))
    return _weighted_choice(rng, engineers, weights)


def _draw_hours(rng: random.Random, median: float) -> float:
    """Return a duration in hours, lognormally distributed about `median`.

    Lognormal rather than uniform because that is the shape response times
    actually have: a cluster near the median and a thin tail of jobs that took
    a fortnight. It also means the medians `/reports/response-times` computes
    come out close to the numbers in `RESPONSE_MEDIANS`, so the dashboard can
    be checked against this file by eye.
    """
    return max(0.05, median * rng.lognormvariate(0.0, 0.62))


def _weighted_choice[T](rng: random.Random, population: Sequence[T], weights: Sequence[float]) -> T:
    """Return one item from `population`, chosen with the given weights."""
    return rng.choices(list(population), weights=list(weights), k=1)[0]
