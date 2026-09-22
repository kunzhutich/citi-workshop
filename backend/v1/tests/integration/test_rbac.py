"""Role gates and the forced-password-change gate.

``require_roles`` and ``get_current_user`` are exercised through throwaway
routes mounted on a test application. That keeps this suite independent of
which real endpoints happen to exist — the rules are what is under test, not
the resources they will later protect.
"""

from collections.abc import Generator
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.db import get_db
from app.errors import ApiError, api_error_handler
from app.models.enums import EngineerLevel, UserRole
from app.models.user import User
from app.security.dependencies import (
    PASSWORD_CHANGE_REQUIRED,
    CurrentUser,
    require_engineer_levels,
    require_roles,
)
from tests.factories import DEFAULT_PASSWORD, auth_header, login, make_engineer, make_user

ADMIN_ONLY = f"{API_PREFIX}/probe/admin-only"
STAFF_ONLY = f"{API_PREFIX}/probe/staff-only"
ANY_USER = f"{API_PREFIX}/probe/any-user"
SENIOR_OR_LEAD = f"{API_PREFIX}/probe/senior-or-lead"


def build_probe_app(db_session: Session) -> FastAPI:
    """Return an app exposing one route per gate we want to assert on."""
    router = APIRouter(prefix="/probe")

    @router.get("/any-user")
    def any_user(user: CurrentUser) -> dict[str, str]:
        return {"role": user.role.value}

    @router.get("/admin-only")
    def admin_only(
        user: Annotated[User, Depends(require_roles(UserRole.FACILITY_ADMIN))],
    ) -> dict[str, str]:
        return {"role": user.role.value}

    @router.get("/staff-only")
    def staff_only(
        user: Annotated[User, Depends(require_roles(UserRole.ENGINEER, UserRole.FACILITY_ADMIN))],
    ) -> dict[str, str]:
        return {"role": user.role.value}

    @router.get("/senior-or-lead")
    def senior_or_lead(
        user: Annotated[
            User,
            Depends(require_engineer_levels(EngineerLevel.SENIOR, EngineerLevel.LEAD)),
        ],
    ) -> dict[str, str]:
        return {"role": user.role.value}

    application = FastAPI()
    application.add_exception_handler(ApiError, api_error_handler)
    application.include_router(router, prefix=API_PREFIX)
    application.dependency_overrides[get_db] = lambda: db_session
    return application


@pytest.fixture
def probe_client(db_session: Session, client: TestClient) -> Generator[TestClient]:
    """Return a client for the probe app.

    `client` is depended on so that /auth/login is available for sign-in.
    """
    del client
    with TestClient(build_probe_app(db_session)) as probe:
        yield probe


def _token_for(client: TestClient, email: str) -> str:
    return login(client, email)


# --- Role gates ------------------------------------------------------------


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        (UserRole.EMPLOYEE, 403),
        (UserRole.ENGINEER, 403),
        (UserRole.FACILITY_ADMIN, 200),
    ],
)
def test_admin_only_route(
    client: TestClient, probe_client: TestClient, db_session: Session, role: UserRole, expected: int
) -> None:
    email = f"{role.value.lower()}-admin-probe@acme.inc"
    if role == UserRole.ENGINEER:
        make_engineer(db_session, email=email)
    else:
        make_user(db_session, email=email, role=role)

    response = probe_client.get(ADMIN_ONLY, headers=auth_header(_token_for(client, email)))

    assert response.status_code == expected
    if expected == 403:
        assert response.json()["code"] == "ROLE_NOT_PERMITTED"


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        (UserRole.EMPLOYEE, 403),
        (UserRole.ENGINEER, 200),
        (UserRole.FACILITY_ADMIN, 200),
    ],
)
def test_staff_only_route(
    client: TestClient, probe_client: TestClient, db_session: Session, role: UserRole, expected: int
) -> None:
    email = f"{role.value.lower()}-staff-probe@acme.inc"
    if role == UserRole.ENGINEER:
        make_engineer(db_session, email=email)
    else:
        make_user(db_session, email=email, role=role)

    response = probe_client.get(STAFF_ONLY, headers=auth_header(_token_for(client, email)))

    assert response.status_code == expected


@pytest.mark.parametrize("role", list(UserRole))
def test_any_authenticated_user_passes_an_ungated_route(
    client: TestClient, probe_client: TestClient, db_session: Session, role: UserRole
) -> None:
    email = f"{role.value.lower()}-any-probe@acme.inc"
    if role == UserRole.ENGINEER:
        make_engineer(db_session, email=email)
    else:
        make_user(db_session, email=email, role=role)

    response = probe_client.get(ANY_USER, headers=auth_header(_token_for(client, email)))

    assert response.status_code == 200
    assert response.json()["role"] == role.value


def test_role_gates_still_require_authentication(probe_client: TestClient) -> None:
    assert probe_client.get(ADMIN_ONLY).status_code == 401
    assert probe_client.get(ANY_USER).status_code == 401


# --- Engineer level gates --------------------------------------------------


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        (EngineerLevel.JUNIOR, 403),
        (EngineerLevel.SENIOR, 200),
        (EngineerLevel.LEAD, 200),
    ],
)
def test_engineer_level_gate(
    client: TestClient,
    probe_client: TestClient,
    db_session: Session,
    level: EngineerLevel,
    expected: int,
) -> None:
    email = f"{level.value.lower()}-level-probe@acme.inc"
    make_engineer(db_session, email=email, level=level)

    response = probe_client.get(SENIOR_OR_LEAD, headers=auth_header(_token_for(client, email)))

    assert response.status_code == expected


def test_admins_pass_every_engineer_level_gate(
    client: TestClient, probe_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="admin-level-probe@acme.inc", role=UserRole.FACILITY_ADMIN)

    response = probe_client.get(
        SENIOR_OR_LEAD, headers=auth_header(_token_for(client, "admin-level-probe@acme.inc"))
    )

    assert response.status_code == 200


def test_employee_fails_every_engineer_level_gate(
    client: TestClient, probe_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="employee-level-probe@acme.inc")

    response = probe_client.get(
        SENIOR_OR_LEAD, headers=auth_header(_token_for(client, "employee-level-probe@acme.inc"))
    )

    assert response.status_code == 403
    assert response.json()["code"] == "LEVEL_NOT_PERMITTED"


def test_level_is_read_from_the_database_not_the_token(
    client: TestClient, probe_client: TestClient, db_session: Session
) -> None:
    """A promotion must take effect on the next request, not on the next login."""
    engineer = make_engineer(db_session, email="promoted@acme.inc", level=EngineerLevel.JUNIOR)
    token = _token_for(client, "promoted@acme.inc")
    assert probe_client.get(SENIOR_OR_LEAD, headers=auth_header(token)).status_code == 403

    engineer.engineer_profile.level = EngineerLevel.LEAD
    db_session.flush()

    assert probe_client.get(SENIOR_OR_LEAD, headers=auth_header(token)).status_code == 200


def test_role_is_read_from_the_database_not_the_token(
    client: TestClient, probe_client: TestClient, db_session: Session
) -> None:
    """Demotion must take effect immediately, even with a token minted as admin."""
    user = make_user(db_session, email="demoted@acme.inc", role=UserRole.FACILITY_ADMIN)
    token = _token_for(client, "demoted@acme.inc")
    assert probe_client.get(ADMIN_ONLY, headers=auth_header(token)).status_code == 200

    user.role = UserRole.EMPLOYEE
    db_session.flush()

    assert probe_client.get(ADMIN_ONLY, headers=auth_header(token)).status_code == 403


# --- The forced-password-change gate ---------------------------------------


@pytest.mark.parametrize("path", [ANY_USER, STAFF_ONLY, ADMIN_ONLY])
def test_password_change_gate_blocks_every_non_auth_route(
    client: TestClient, probe_client: TestClient, db_session: Session, path: str
) -> None:
    make_user(
        db_session,
        email="must-change@acme.inc",
        role=UserRole.FACILITY_ADMIN,
        must_change_password=True,
    )
    token = _token_for(client, "must-change@acme.inc")

    response = probe_client.get(path, headers=auth_header(token))

    assert response.status_code == 403
    assert response.json()["code"] == PASSWORD_CHANGE_REQUIRED


def test_gated_user_can_still_reach_auth_routes(client: TestClient, db_session: Session) -> None:
    """Otherwise the only way out of the gate would itself be gated."""
    make_user(db_session, email="gated@acme.inc", must_change_password=True)
    token = _token_for(client, "gated@acme.inc")

    assert client.get(f"{API_PREFIX}/auth/me", headers=auth_header(token)).status_code == 200


def test_changing_the_password_lifts_the_gate(
    client: TestClient, probe_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="freed@acme.inc", must_change_password=True)
    token = _token_for(client, "freed@acme.inc")
    assert probe_client.get(ANY_USER, headers=auth_header(token)).status_code == 403

    changed = client.post(
        f"{API_PREFIX}/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a-brand-new-passphrase"},
        headers=auth_header(token),
    )
    assert changed.status_code == 200

    fresh = login(client, "freed@acme.inc", "a-brand-new-passphrase")
    assert probe_client.get(ANY_USER, headers=auth_header(fresh)).status_code == 200
