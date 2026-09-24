"""Category reference data."""

import pytest
from sqlalchemy import delete, func, select
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
