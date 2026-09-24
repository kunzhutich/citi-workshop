"""The category tree the report questionnaire is built from.

This is *reference data*, not demo data: the questionnaire has nothing to show
without it, so ``seed_categories`` runs as part of the ``migrate`` ops action
rather than being a separate optional step.

It is deliberately not written into the Alembic migration. Categories are
admin-editable at runtime, and a frozen migration is the wrong place for rows
that are expected to change. Keeping the data here also means it can be read,
diffed and tested as ordinary Python.

Seeding is idempotent, matching on ``(parent_id, name)`` — the same pair the
unique constraint uses. Re-running it never duplicates a row and never
resurrects one an admin deactivated, because a deactivated row still exists and
is therefore found.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.enums import LocationDetail


@dataclass(frozen=True)
class CategoryGroupSeed:
    """One top-level group and the subcategories beneath it."""

    name: str
    hint: str
    icon: str
    location_detail: LocationDetail
    subcategories: tuple[str, ...]


@dataclass
class SeedResult:
    """What a seeding run did, so the caller can report it."""

    groups_created: int = 0
    subcategories_created: int = 0
    already_present: int = 0
    group_names: list[str] = field(default_factory=list)

    @property
    def total_created(self) -> int:
        """Return how many rows were inserted."""
        return self.groups_created + self.subcategories_created


#: Groups appear as the cards in step 1 of the questionnaire, subcategories in
#: step 2. `location_detail` is meaningful on the group; subcategories inherit
#: it. Every group ends with an "Other" option so a reporter is never stuck.
CATEGORY_GROUPS: tuple[CategoryGroupSeed, ...] = (
    CategoryGroupSeed(
        name="Hardware",
        hint="Something physical isn't working",
        icon="Computer",
        location_detail=LocationDetail.FLOOR,
        subcategories=(
            "Laptop/Desktop",
            "Monitor",
            "Keyboard/Mouse",
            "Docking Station",
            "Headset/Webcam",
            "Printer/Scanner",
            "Other hardware",
        ),
    ),
    CategoryGroupSeed(
        name="Software",
        hint="An app, email, or your operating system",
        icon="Apps",
        location_detail=LocationDetail.BUILDING,
        subcategories=(
            "Operating System",
            "Email/Calendar",
            "Office Apps",
            "Business Application",
            "Software Install Request",
            "Other software",
        ),
    ),
    CategoryGroupSeed(
        name="Network & Access",
        hint="Wi-Fi, VPN, passwords, badge access",
        icon="Wifi",
        location_detail=LocationDetail.BUILDING,
        subcategories=(
            "Wi-Fi",
            "Wired Network",
            "VPN",
            "Account/Password",
            "Badge/Door Access",
            "Other",
        ),
    ),
    CategoryGroupSeed(
        name="Meeting Rooms",
        hint="Room displays, video calls, audio",
        icon="MeetingRoom",
        location_detail=LocationDetail.SEAT,
        subcategories=(
            "Display/Projector",
            "Video Conferencing",
            "Audio/Microphone",
            "Other",
        ),
    ),
    CategoryGroupSeed(
        name="Building & Facilities",
        hint="Temperature, lighting, plumbing, furniture",
        icon="Apartment",
        location_detail=LocationDetail.FLOOR,
        subcategories=(
            "Temperature/HVAC",
            "Lighting",
            "Plumbing/Restroom",
            "Power/Outlets",
            "Furniture",
            "Cleaning",
            "Kitchen/Appliances",
            "Safety Hazard",
            "Other",
        ),
    ),
    #
    # The three below were added for §6.2 of the redesign brief, which asks for
    # more specialty tags than the original five. A specialty *is* a category
    # group — `services/engineers.py::_require_group_ids` refuses anything else
    # — so the only way to offer an engineer more of them is to have more
    # groups, and a group an employee cannot report against would be a tag with
    # nothing behind it. Each therefore carries its own subcategories and earns
    # its place on the report questionnaire as well as in the engineer dialog.
    #
    # `seed_categories` inserts what is missing and leaves what exists alone,
    # so running `migrate` against a database that predates these adds them
    # without touching a renamed hint or a reordered group.
    #
    CategoryGroupSeed(
        name="Cleaning & Waste",
        hint="Spills, bins, recycling, supplies",
        icon="CleaningServices",
        location_detail=LocationDetail.FLOOR,
        subcategories=(
            "Spill/Stain",
            "Bins/Recycling",
            "Restroom Supplies",
            "Pest Control",
            "Other",
        ),
    ),
    CategoryGroupSeed(
        name="Safety & Security",
        hint="Alarms, doors, lighting outages, hazards",
        icon="HealthAndSafety",
        location_detail=LocationDetail.FLOOR,
        subcategories=(
            "Alarm/Detector",
            "Door/Lock",
            "Emergency Lighting",
            "First Aid/Equipment",
            "Other",
        ),
    ),
    CategoryGroupSeed(
        name="Deliveries & Moves",
        hint="Post, deliveries, desk moves, disposal",
        icon="LocalShipping",
        location_detail=LocationDetail.SEAT,
        subcategories=(
            "Post/Parcel",
            "Desk Move",
            "Equipment Disposal",
            "Other",
        ),
    ),
)


def seed_categories(session: Session) -> SeedResult:
    """Insert any missing groups and subcategories. Safe to run repeatedly.

    Does not modify rows that already exist: an admin who renamed a hint or
    changed a sort order keeps their edit.
    """
    result = SeedResult()

    for group_order, group_seed in enumerate(CATEGORY_GROUPS):
        group = _find_child(session, parent_id=None, name=group_seed.name)
        if group is None:
            group = Category(
                parent_id=None,
                name=group_seed.name,
                hint=group_seed.hint,
                icon=group_seed.icon,
                location_detail=group_seed.location_detail,
                sort_order=group_order,
            )
            session.add(group)
            session.flush()  # assign group.id before inserting its children
            result.groups_created += 1
        else:
            result.already_present += 1

        result.group_names.append(group.name)

        for child_order, subcategory_name in enumerate(group_seed.subcategories):
            existing = _find_child(session, parent_id=group.id, name=subcategory_name)
            if existing is not None:
                result.already_present += 1
                continue
            session.add(
                Category(
                    parent_id=group.id,
                    name=subcategory_name,
                    # Subcategories inherit the group's location requirement.
                    location_detail=group_seed.location_detail,
                    sort_order=child_order,
                )
            )
            result.subcategories_created += 1

    session.flush()
    return result


def _find_child(session: Session, parent_id: object, name: str) -> Category | None:
    """Look up one category by the same key the unique constraint uses."""
    statement = select(Category).where(
        Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id,
        Category.name == name,
    )
    return session.scalars(statement).one_or_none()
