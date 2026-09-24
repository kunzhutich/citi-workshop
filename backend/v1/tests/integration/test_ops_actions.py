"""The migrate and seed_admin ops actions, through the real Lambda handler.

These go through ``function.handler`` rather than calling the service directly,
because the handler's dispatch is part of what we are verifying: this is
byte-for-byte the code path ``aws lambda invoke`` will take. The only thing
that differs in the cloud is which database it reaches.
"""

from typing import Any

from alembic.script import ScriptDirectory
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

import function
from app.migrations import build_alembic_config
from app.models.category import Category
from app.models.enums import UserRole
from app.models.user import User
from app.repositories import users as user_repository
from app.security.passwords import verify_password
from app.seed.categories import CATEGORY_GROUPS


def invoke(payload: dict[str, Any]) -> dict[str, Any]:
    """Call the Lambda handler exactly as a direct invoke would."""
    return function.handler(payload, None)


def head_revision() -> str:
    """Return the newest revision id in alembic/versions."""
    return ScriptDirectory.from_config(build_alembic_config()).get_current_head() or ""


# --- migrate ---------------------------------------------------------------


def test_migrate_reports_schema_and_reference_data(_migrated_database: Engine) -> None:
    """The test database is already at head, so this proves the idempotent path."""
    response = invoke({"action": "migrate"})

    assert response["ok"] is True
    assert response["action"] == "migrate"
    result = response["result"]
    assert result["schema"] == "upgraded to head"
    # Derived from the seed, not listed again: §6.2 added three groups and a
    # literal list here was one of four tests that had to be edited to agree.
    assert result["categories"]["groups"] == [group.name for group in CATEGORY_GROUPS]


def test_migrate_leaves_the_database_usable(_migrated_database: Engine) -> None:
    """A migrated database with no categories could not render the questionnaire."""
    invoke({"action": "migrate"})

    with _migrated_database.connect() as connection:
        groups = connection.scalar(text("SELECT count(*) FROM categories WHERE parent_id IS NULL"))
        revision = connection.scalar(text("SELECT version_num FROM alembic_version"))

    # Counted against the seed rather than a literal, so adding a category
    # group is one edit instead of two. Getting that wrong is what §6.2's three
    # new groups did to four tests at once.
    assert groups == len(CATEGORY_GROUPS)
    # Compared against the script directory's head rather than a literal, so
    # adding a revision does not mean editing this test to agree with it.
    assert revision == head_revision()


def test_migrate_is_idempotent(_migrated_database: Engine, db_session: Session) -> None:
    invoke({"action": "migrate"})
    before = db_session.scalars(select(func.count()).select_from(Category)).one()

    second = invoke({"action": "migrate"})["result"]["categories"]

    assert second["groups_created"] == 0
    assert second["subcategories_created"] == 0
    assert db_session.scalars(select(func.count()).select_from(Category)).one() == before


# --- seed_admin ------------------------------------------------------------


def test_seed_admin_creates_a_facility_admin(
    _migrated_database: Engine, db_session: Session
) -> None:
    result = invoke(
        {
            "action": "seed_admin",
            "email": "  Bootstrap.Admin@ACME.inc ",
            "full_name": "Bootstrap Admin",
            "password": "a-known-bootstrap-password",
        }
    )["result"]

    assert result["created"] is True
    assert result["email"] == "bootstrap.admin@acme.inc"
    assert result["role"] == UserRole.FACILITY_ADMIN.value
    # A supplied password is never echoed back.
    assert "temporary_password" not in result

    admin = user_repository.get_by_email(db_session, "bootstrap.admin@acme.inc")
    assert admin is not None
    assert admin.role == UserRole.FACILITY_ADMIN
    assert admin.is_active is True
    assert verify_password("a-known-bootstrap-password", admin.password_hash)


def test_seeded_admin_must_change_their_password(
    _migrated_database: Engine, db_session: Session
) -> None:
    """A bootstrap credential has travelled through an invoke payload; force a change."""
    invoke(
        {
            "action": "seed_admin",
            "email": "forced@acme.inc",
            "password": "a-known-bootstrap-password",
        }
    )

    admin = user_repository.get_by_email(db_session, "forced@acme.inc")
    assert admin is not None
    assert admin.must_change_password is True


def test_seed_admin_generates_a_password_when_none_is_given(
    _migrated_database: Engine, db_session: Session
) -> None:
    result = invoke({"action": "seed_admin", "email": "generated@acme.inc"})["result"]

    assert result["created"] is True
    generated = result["temporary_password"]
    assert len(generated) >= 16

    admin = user_repository.get_by_email(db_session, "generated@acme.inc")
    assert admin is not None
    assert verify_password(generated, admin.password_hash)
    # Stored hashed, never in the clear.
    assert admin.password_hash != generated


def test_seed_admin_is_idempotent(_migrated_database: Engine, db_session: Session) -> None:
    first = invoke(
        {"action": "seed_admin", "email": "once@acme.inc", "password": "a-known-bootstrap-password"}
    )["result"]

    second = invoke(
        {"action": "seed_admin", "email": "once@acme.inc", "password": "a-different-password"}
    )["result"]

    assert second["created"] is False
    assert second["user_id"] == first["user_id"]

    admin = user_repository.get_by_email(db_session, "once@acme.inc")
    assert admin is not None
    # The existing credential must not be silently replaced.
    assert verify_password("a-known-bootstrap-password", admin.password_hash)


def test_seed_admin_requires_an_email(_migrated_database: Engine) -> None:
    result = invoke({"action": "seed_admin"})["result"]

    assert result["created"] is False
    assert "email" in result["error"]


def test_seed_admin_enforces_the_acme_domain(
    _migrated_database: Engine, db_session: Session
) -> None:
    """Even the bootstrap account has to be an ACME address."""
    from app.errors import ValidationError

    try:
        invoke({"action": "seed_admin", "email": "outsider@gmail.com"})
    except ValidationError as exc:
        assert exc.code == "INVALID_EMAIL_DOMAIN"
    else:
        raise AssertionError("an outside domain must be rejected")

    assert db_session.scalars(select(User).where(User.email == "outsider@gmail.com")).all() == []
