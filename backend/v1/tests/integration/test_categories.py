"""The category tree: depth rules, inheritance, uniqueness and deactivation."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import LocationDetail
from tests.factories import (
    auth_header,
    login,
    make_admin,
    make_building,
    make_category,
    make_incident,
    make_user,
)


@pytest.fixture
def admin_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as a facility admin and return the Authorization header."""
    admin = make_admin(db_session)
    return auth_header(login(client, admin.email))


@pytest.fixture
def employee_headers(client: TestClient, db_session: Session) -> dict[str, str]:
    """Sign in as an ordinary employee and return the Authorization header."""
    employee = make_user(db_session)
    return auth_header(login(client, employee.email))


# --- Reading the tree --------------------------------------------------------


def test_tree_nests_subcategories_under_their_group(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    # The group takes `make_category`'s generated name rather than a seeded one
    # such as "Hardware": `test_ops_actions.py` really commits the five seeded
    # groups, so a fixture naming itself after one collides with
    # `uq_categories_parent_id_name` — but only in runs where that file goes
    # first. The child names are safe as literals because uniqueness is scoped
    # to the parent, and this parent is new.
    group = make_category(db_session, sort_order=1)
    make_category(db_session, name="Monitor", parent=group)
    make_category(db_session, name="Laptop", parent=group)

    response = client.get("/api/v1/categories", headers=employee_headers)

    assert response.status_code == 200, response.text
    created = next(g for g in response.json()["groups"] if g["name"] == group.name)
    assert {child["name"] for child in created["children"]} == {"Monitor", "Laptop"}
    assert all(child["parent_id"] == created["id"] for child in created["children"])


def test_groups_are_ordered_by_sort_order(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    make_category(db_session, name="Zebra group", sort_order=1)
    make_category(db_session, name="Alpha group", sort_order=2)

    tree = client.get("/api/v1/categories", headers=employee_headers).json()

    names = [group["name"] for group in tree["groups"]]

    assert names.index("Zebra group") < names.index("Alpha group")


def test_tree_hides_inactive_groups_and_subcategories(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    group = make_category(db_session, name="Live group")
    make_category(db_session, name="Live child", parent=group)
    make_category(db_session, name="Retired child", parent=group, is_active=False)
    make_category(db_session, name="Retired group", is_active=False)

    tree = client.get("/api/v1/categories", headers=employee_headers).json()

    names = [g["name"] for g in tree["groups"]]
    assert "Retired group" not in names
    live = next(g for g in tree["groups"] if g["name"] == "Live group")
    assert [child["name"] for child in live["children"]] == ["Live child"]


def test_admin_can_include_inactive_categories(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    make_category(db_session, name="Retired group", is_active=False)

    tree = client.get("/api/v1/categories?include_inactive=true", headers=admin_headers).json()

    assert "Retired group" in [g["name"] for g in tree["groups"]]


def test_employee_cannot_include_inactive_categories(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/categories?include_inactive=true", headers=employee_headers)

    assert response.status_code == 403


# --- Depth rules -------------------------------------------------------------


def test_admin_creates_a_group(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/categories",
        json={
            "name": "Catering",
            "hint": "Coffee, water, vending",
            "icon": "LocalCafe",
            "location_detail": "BUILDING",
            "sort_order": 9,
        },
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["parent_id"] is None
    assert body["location_detail"] == "BUILDING"
    assert body["is_active"] is True


def test_admin_creates_a_subcategory(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session, location_detail=LocationDetail.SEAT)

    response = client.post(
        "/api/v1/categories",
        json={"name": "Coffee machine", "parent_id": str(group.id)},
        headers=admin_headers,
    )

    assert response.status_code == 201, response.text
    # Inherited from the group rather than defaulted.
    assert response.json()["location_detail"] == "SEAT"


def test_a_third_level_is_refused(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    subcategory = make_category(db_session, parent=group)

    response = client.post(
        "/api/v1/categories",
        json={"name": "Too deep", "parent_id": str(subcategory.id)},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "CATEGORY_TOO_DEEP"
    assert response.json()["field"] == "parent_id"


def test_unknown_parent_is_refused(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/categories",
        json={"name": "Orphan", "parent_id": str(uuid.uuid4())},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "PARENT_NOT_FOUND"


def test_a_group_defaults_to_floor_level_detail(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/categories",
        json={"name": "Unspecified group"},
        headers=admin_headers,
    )

    assert response.json()["location_detail"] == "FLOOR"


# --- Group-only fields -------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [("hint", "a hint"), ("icon", "Computer"), ("location_detail", "SEAT")],
)
def test_group_only_fields_are_refused_on_a_subcategory(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    field: str,
    value: str,
) -> None:
    group = make_category(db_session)

    response = client.post(
        "/api/v1/categories",
        json={"name": f"Child {field}", "parent_id": str(group.id), field: value},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GROUP_ONLY_FIELD"
    assert response.json()["field"] == field


def test_group_only_fields_are_refused_when_updating_a_subcategory(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group)

    response = client.patch(
        f"/api/v1/categories/{child.id}",
        json={"location_detail": "BUILDING"},
        headers=admin_headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GROUP_ONLY_FIELD"


def test_changing_a_group_location_detail_rewrites_its_children(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session, location_detail=LocationDetail.FLOOR)
    first = make_category(db_session, parent=group)
    second = make_category(db_session, parent=group)

    response = client.patch(
        f"/api/v1/categories/{group.id}",
        json={"location_detail": "SEAT"},
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    for child in (first, second):
        child_body = client.get(f"/api/v1/categories/{child.id}", headers=admin_headers).json()
        assert child_body["location_detail"] == "SEAT"


def test_a_subcategory_can_still_be_renamed_and_reordered(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group, name="Old name")

    response = client.patch(
        f"/api/v1/categories/{child.id}",
        json={"name": "New name", "sort_order": 4},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["name"] == "New name"
    assert response.json()["sort_order"] == 4


# --- Uniqueness --------------------------------------------------------------


def test_two_groups_cannot_share_a_name(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """NULL parent ids must still collide — the whole point of NULLS NOT DISTINCT.

    The name is generated rather than a seeded one, so the collision under test
    is the one this test creates and not a leftover from the seeded tree.
    """
    existing = make_category(db_session)

    response = client.post(
        "/api/v1/categories",
        # Re-cased, so this also proves the comparison ignores case.
        json={"name": existing.name.upper()},
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "CATEGORY_NAME_TAKEN"


def test_two_subcategories_of_one_group_cannot_share_a_name(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    make_category(db_session, name="Other", parent=group)

    response = client.post(
        "/api/v1/categories",
        json={"name": "other", "parent_id": str(group.id)},
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_the_same_subcategory_name_under_another_group_is_fine(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    """Every group ends with an 'Other' option, so this must be allowed."""
    first = make_category(db_session)
    second = make_category(db_session)
    make_category(db_session, name="Other", parent=first)

    response = client.post(
        "/api/v1/categories",
        json={"name": "Other", "parent_id": str(second.id)},
        headers=admin_headers,
    )

    assert response.status_code == 201


def test_renaming_a_category_to_its_own_name_is_allowed(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session, name="Steady")

    response = client.patch(
        f"/api/v1/categories/{group.id}",
        json={"name": "Steady", "sort_order": 3},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["sort_order"] == 3


# --- Deletion ----------------------------------------------------------------


def test_unused_subcategory_is_deleted(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group)

    response = client.delete(f"/api/v1/categories/{child.id}", headers=admin_headers)

    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is True
    assert response.json()["deactivated"] is False
    assert client.get(f"/api/v1/categories/{child.id}", headers=admin_headers).status_code == 404


def test_referenced_subcategory_is_deactivated_not_deleted(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group)
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=child,
        building=make_building(db_session),
    )

    response = client.delete(f"/api/v1/categories/{child.id}", headers=admin_headers)

    assert response.status_code == 200, response.text
    assert response.json()["deleted"] is False
    assert response.json()["deactivated"] is True

    still_there = client.get(f"/api/v1/categories/{child.id}", headers=admin_headers)
    assert still_there.status_code == 200
    assert still_there.json()["is_active"] is False


def test_a_group_whose_child_is_referenced_is_deactivated(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group)
    make_incident(
        db_session,
        reporter=make_user(db_session),
        category=child,
        building=make_building(db_session),
    )

    response = client.delete(f"/api/v1/categories/{group.id}", headers=admin_headers)

    assert response.json()["deactivated"] is True


def test_a_group_with_subcategories_is_deactivated_rather_than_cascaded_away(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)
    child = make_category(db_session, parent=group)

    response = client.delete(f"/api/v1/categories/{group.id}", headers=admin_headers)

    assert response.json()["deactivated"] is True
    assert client.get(f"/api/v1/categories/{child.id}", headers=admin_headers).status_code == 200


def test_an_empty_group_is_deleted(
    client: TestClient, db_session: Session, admin_headers: dict[str, str]
) -> None:
    group = make_category(db_session)

    response = client.delete(f"/api/v1/categories/{group.id}", headers=admin_headers)

    assert response.json()["deleted"] is True


def test_unknown_category_is_a_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.delete(f"/api/v1/categories/{uuid.uuid4()}", headers=admin_headers)

    assert response.status_code == 404
    assert response.json()["code"] == "CATEGORY_NOT_FOUND"


# --- Permissions -------------------------------------------------------------


def test_employee_cannot_create_a_category(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/categories",
        json={"name": "Employee group"},
        headers=employee_headers,
    )

    assert response.status_code == 403


def test_employee_cannot_delete_a_category(
    client: TestClient, db_session: Session, employee_headers: dict[str, str]
) -> None:
    group = make_category(db_session)

    response = client.delete(f"/api/v1/categories/{group.id}", headers=employee_headers)

    assert response.status_code == 403


def test_anonymous_cannot_read_the_tree(client: TestClient) -> None:
    assert client.get("/api/v1/categories").status_code == 401
