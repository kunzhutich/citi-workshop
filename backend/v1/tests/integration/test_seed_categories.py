"""Category reference data."""

import importlib.util
import pathlib
import types

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, aliased

from app.models.category import Category
from app.models.enums import LocationDetail
from app.seed.categories import CATEGORY_GROUPS, seed_categories

# Counted from the seed itself rather than written down twice. Three groups
# were added in §6.2 and these two literals failed four tests between them,
# which is the whole argument for deriving them.
EXPECTED_GROUPS = len(CATEGORY_GROUPS)
EXPECTED_SUBCATEGORIES = sum(len(group.subcategories) for group in CATEGORY_GROUPS)


@pytest.fixture(autouse=True)
def _empty_categories(db_session: Session) -> None:
    """Start each test from an empty category table.

    The ops-action tests exercise `function.handler`, which owns its own
    session and therefore genuinely commits. Those rows are still visible from
    this test's transaction, so clear them here — the delete is rolled back
    with everything else when the test finishes.
    """
    db_session.execute(delete(Category))
    db_session.flush()


#: The owner's mapping, read out of the seed table rather than restated.
#:
#: A list of pairs, never of names: six subcategories in the tree are called
#: "Other" and the mapping tells them apart. Deriving it here the same way the
#: seed applies it is the point — what these tests check is that the *pairs*
#: are right, which is the thing a name-keyed implementation gets wrong.
SHARED_PAIRS: frozenset[tuple[str, str]] = frozenset(
    (group.name, name)
    for group in CATEGORY_GROUPS
    for name in group.subcategories
    if name in group.shared_subcategories
)


def flag_of(db_session: Session, group_name: str, subcategory_name: str) -> bool:
    """Return one subcategory's `allows_watchers`, looked up by the pair."""
    parent = aliased(Category)
    statement = (
        select(Category.allows_watchers)
        .join(parent, Category.parent_id == parent.id)
        .where(parent.name == group_name, Category.name == subcategory_name)
    )
    return db_session.scalars(statement).one()


def test_seeding_creates_the_whole_tree(db_session: Session) -> None:
    result = seed_categories(db_session)

    assert result.groups_created == EXPECTED_GROUPS
    assert result.subcategories_created == EXPECTED_SUBCATEGORIES
    assert result.already_present == 0

    groups = db_session.scalars(
        select(func.count()).select_from(Category).where(Category.parent_id.is_(None))
    ).one()
    assert groups == EXPECTED_GROUPS


def test_seeding_twice_changes_nothing(db_session: Session) -> None:
    seed_categories(db_session)
    before = db_session.scalars(select(func.count()).select_from(Category)).one()

    second = seed_categories(db_session)

    assert second.total_created == 0
    assert second.already_present == EXPECTED_GROUPS + EXPECTED_SUBCATEGORIES
    after = db_session.scalars(select(func.count()).select_from(Category)).one()
    assert after == before


def test_seeding_does_not_overwrite_admin_edits(db_session: Session) -> None:
    """An admin's change to a hint or sort order must survive a re-run."""
    seed_categories(db_session)
    hardware = db_session.scalars(
        select(Category).where(Category.parent_id.is_(None), Category.name == "Hardware")
    ).one()
    hardware.hint = "Edited by an admin"
    hardware.sort_order = 99
    db_session.flush()

    seed_categories(db_session)

    db_session.refresh(hardware)
    assert hardware.hint == "Edited by an admin"
    assert hardware.sort_order == 99


def test_seeding_does_not_resurrect_a_deactivated_category(db_session: Session) -> None:
    """Deactivation is a soft delete, so the row is still found and left alone."""
    seed_categories(db_session)
    printers = db_session.scalars(select(Category).where(Category.name == "Printer/Scanner")).one()
    printers.is_active = False
    db_session.flush()

    seed_categories(db_session)

    matches = db_session.scalars(select(Category).where(Category.name == "Printer/Scanner")).all()
    assert len(matches) == 1
    assert matches[0].is_active is False


def test_every_group_has_the_expected_shape(db_session: Session) -> None:
    seed_categories(db_session)

    for seed in CATEGORY_GROUPS:
        group = db_session.scalars(
            select(Category).where(Category.parent_id.is_(None), Category.name == seed.name)
        ).one()
        assert group.is_group is True
        assert group.hint == seed.hint
        assert group.icon == seed.icon
        assert group.location_detail == seed.location_detail
        assert len(group.children) == len(seed.subcategories)


def test_subcategories_inherit_their_group_location_detail(db_session: Session) -> None:
    seed_categories(db_session)

    rooms = db_session.scalars(
        select(Category).where(Category.parent_id.is_(None), Category.name == "Meeting Rooms")
    ).one()

    assert rooms.location_detail == LocationDetail.SEAT
    assert all(child.location_detail == LocationDetail.SEAT for child in rooms.children)


def test_every_group_offers_an_other_option(db_session: Session) -> None:
    """A reporter must never be unable to file because nothing fits."""
    seed_categories(db_session)

    for seed in CATEGORY_GROUPS:
        group = db_session.scalars(
            select(Category).where(Category.parent_id.is_(None), Category.name == seed.name)
        ).one()
        names = [child.name.lower() for child in group.children]
        assert any(name.startswith("other") for name in names), seed.name


def test_tree_is_only_two_levels_deep(db_session: Session) -> None:
    seed_categories(db_session)

    parent = aliased(Category)
    grandchildren = db_session.scalars(
        select(func.count())
        .select_from(Category)
        .join(parent, Category.parent_id == parent.id)
        .where(parent.parent_id.isnot(None))
    ).one()

    assert grandchildren == 0


# --- allows_watchers ---------------------------------------------------------


def test_the_two_other_subcategories_that_are_shared_are_the_right_two(
    db_session: Session,
) -> None:
    """The case a mapping keyed on the subcategory name alone gets wrong.

    All three of these are called "Other". Two are shared and one is not, so
    any implementation that looks up by name has to give the same answer for
    all three and fails on at least one of them whichever answer it picks.
    """
    seed_categories(db_session)

    assert flag_of(db_session, "Meeting Rooms", "Other") is True
    assert flag_of(db_session, "Building & Facilities", "Other") is True
    assert flag_of(db_session, "Network & Access", "Other") is False


def test_the_seeded_flag_is_the_owners_list_and_nothing_else(db_session: Session) -> None:
    """Every subcategory, checked against the mapping in both directions.

    Asserted as one set comparison rather than a loop of individual asserts,
    so a subcategory that is shared and should not be shows up here as
    plainly as one that is missing.
    """
    seed_categories(db_session)

    parent = aliased(Category)
    rows = db_session.execute(
        select(parent.name, Category.name)
        .join(parent, Category.parent_id == parent.id)
        .where(Category.allows_watchers.is_(True))
    ).all()

    assert {(group, name) for group, name in rows} == SHARED_PAIRS
    assert len(SHARED_PAIRS) == 17


@pytest.mark.parametrize(
    ("group_name", "subcategory_name"),
    [
        ("Hardware", "Laptop/Desktop"),
        ("Network & Access", "VPN"),
        ("Network & Access", "Account/Password"),
        ("Cleaning & Waste", "Spill/Stain"),
        ("Safety & Security", "Door/Lock"),
        ("Deliveries & Moves", "Desk Move"),
    ],
)
def test_a_personal_problem_stays_personal(
    db_session: Session,
    group_name: str,
    subcategory_name: str,
) -> None:
    """Including every subcategory of the three groups R6 added.

    The owner's list does not name them, and the arguable ones default to
    personal on purpose: a duplicate ticket costs an engineer a minute, and a
    stranger subscribing to a problem with somebody's laptop cannot be undone.
    """
    seed_categories(db_session)

    assert flag_of(db_session, group_name, subcategory_name) is False


def test_every_shared_name_is_one_of_that_groups_subcategories() -> None:
    """A typo in `shared_subcategories` would otherwise be a silent no-op.

    The seed applies the flag by asking whether each subcategory it inserts is
    in the set, so a misspelled entry never matches anything and nothing
    anywhere would say so.
    """
    for group in CATEGORY_GROUPS:
        unknown = group.shared_subcategories - set(group.subcategories)
        assert not unknown, f"{group.name}: {sorted(unknown)}"


def test_seeding_does_not_overwrite_an_admins_watcher_decision(db_session: Session) -> None:
    """`migrate` runs the seed on every deploy; it must not revert a decision.

    Both directions, because a seed that only ever turned the flag *on* would
    pass a test that checked one of them.
    """
    seed_categories(db_session)
    parent = aliased(Category)
    lighting = db_session.scalars(
        select(Category)
        .join(parent, Category.parent_id == parent.id)
        .where(parent.name == "Building & Facilities", Category.name == "Lighting")
    ).one()
    monitor = db_session.scalars(
        select(Category)
        .join(parent, Category.parent_id == parent.id)
        .where(parent.name == "Hardware", Category.name == "Monitor")
    ).one()

    lighting.allows_watchers = False
    monitor.allows_watchers = True
    db_session.flush()

    seed_categories(db_session)

    assert flag_of(db_session, "Building & Facilities", "Lighting") is False
    assert flag_of(db_session, "Hardware", "Monitor") is True


def load_revision_0006() -> types.ModuleType:
    """Import revision 0006 by path.

    By path because `alembic/versions` is not a package — the revisions are
    loaded by Alembic's own script directory, never imported by name.
    """
    revision = pathlib.Path(__file__).parents[2] / "alembic" / "versions" / "0006_watchers.py"
    spec = importlib.util.spec_from_file_location("revision_0006", revision)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migrations_frozen_mapping_still_matches_the_seed() -> None:
    """Revision 0006 spells the mapping out; this is what keeps the two honest.

    The duplication is deliberate — revision 0005 records why a revision must
    not read a live application constant — so the guard against it drifting
    has to be a test rather than a shared import. The migration's copy applies
    once, to rows that already existed; the seed's applies to rows it inserts.
    Only one of them will still be running in a year, and they have to agree
    for the year before that.
    """
    module = load_revision_0006()

    assert frozenset(module.SHARED_SUBCATEGORIES) == SHARED_PAIRS


def test_the_migrations_backfill_turns_on_exactly_the_right_rows(db_session: Session) -> None:
    """The backfill statement, run for once against a populated tree.

    Every ordinary run of this suite executes it against an **empty**
    `categories` table — the test database is created, migrated, and only then
    seeded — so a row-value `IN` that matched nothing, or a join written the
    wrong way round, would update nought rows and be indistinguishable from
    success. That is the shape of defect DECISION-LOG D24, D25, D35 and D40
    all share, and this is the assertion that closes it: the flag is cleared
    on a seeded tree, the migration's own function is run against it, and the
    rows it turned back on are compared with the mapping.

    The `Operations.context` block is what makes `op.execute` inside the
    revision resolve to this session's connection. The whole thing is inside
    the test's transaction and is rolled back with it.
    """
    seed_categories(db_session)
    db_session.execute(update(Category).values(allows_watchers=False))
    db_session.flush()

    module = load_revision_0006()
    operations = Operations(MigrationContext.configure(db_session.connection()))
    with Operations.context(operations):
        module.apply_the_shared_mapping()

    parent = aliased(Category)
    rows = db_session.execute(
        select(parent.name, Category.name)
        .join(parent, Category.parent_id == parent.id)
        .where(Category.allows_watchers.is_(True))
    ).all()

    assert {(group, name) for group, name in rows} == SHARED_PAIRS
