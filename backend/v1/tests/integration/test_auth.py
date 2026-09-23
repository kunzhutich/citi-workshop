"""The authentication endpoints, end to end against a real database."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AuthenticationError
from app.models.enums import UserRole
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security.dependencies import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from app.security.tokens import hash_refresh_token
from app.services import auth_service
from tests.factories import DEFAULT_PASSWORD, auth_header, login, make_engineer, make_user

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
CHANGE_PASSWORD = "/api/v1/auth/change-password"
ME = "/api/v1/auth/me"


# --- Registration ----------------------------------------------------------


def test_register_creates_an_employee(client: TestClient, db_session: Session) -> None:
    response = client.post(
        REGISTER,
        json={
            "email": "New.Person@ACME.inc",
            "full_name": "New Person",
            "password": DEFAULT_PASSWORD,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()["user"]
    assert body["email"] == "new.person@acme.inc"  # normalised on the way in
    assert body["role"] == UserRole.EMPLOYEE.value
    assert body["must_change_password"] is False
    # The credential must never appear in a response, hashed or otherwise.
    assert DEFAULT_PASSWORD not in response.text
    assert "password_hash" not in body

    stored = db_session.scalars(select(User).where(User.email == "new.person@acme.inc")).one()
    assert stored.password_hash != DEFAULT_PASSWORD


def test_register_ignores_a_role_sent_by_the_client(client: TestClient) -> None:
    """A privilege-escalation attempt must produce an ordinary employee."""
    response = client.post(
        REGISTER,
        json={
            "email": "sneaky@acme.inc",
            "full_name": "Sneaky",
            "password": DEFAULT_PASSWORD,
            "role": "FACILITY_ADMIN",
            "is_active": True,
        },
    )

    assert response.status_code == 201
    assert response.json()["user"]["role"] == UserRole.EMPLOYEE.value


def test_register_rejects_a_non_acme_domain(client: TestClient) -> None:
    response = client.post(
        REGISTER,
        json={"email": "outsider@gmail.com", "full_name": "Outsider", "password": DEFAULT_PASSWORD},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "INVALID_EMAIL_DOMAIN"
    assert body["field"] == "email"


def test_register_rejects_a_duplicate_email(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="taken@acme.inc")

    response = client.post(
        REGISTER,
        json={"email": "TAKEN@acme.inc", "full_name": "Impostor", "password": DEFAULT_PASSWORD},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_TAKEN"


@pytest.mark.parametrize("password", ["short", "elevenchars"])
def test_register_rejects_a_password_under_twelve_characters(
    client: TestClient, password: str
) -> None:
    response = client.post(
        REGISTER,
        json={"email": "weak@acme.inc", "full_name": "Weak", "password": password},
    )

    assert response.status_code == 422


# --- Login -----------------------------------------------------------------


def test_login_returns_a_token_and_sets_the_refresh_cookie(
    client: TestClient, db_session: Session
) -> None:
    user = make_user(db_session, email="worker@acme.inc")

    response = client.post(LOGIN, json={"email": "worker@acme.inc", "password": DEFAULT_PASSWORD})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["id"] == str(user.id)
    # The refresh token travels only in the cookie, never in the body.
    assert "refresh" not in response.text.lower()

    cookie = response.cookies.get(REFRESH_COOKIE_NAME)
    assert cookie is not None


def test_refresh_cookie_carries_the_right_flags(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="flags@acme.inc")

    response = client.post(LOGIN, json={"email": "flags@acme.inc", "password": DEFAULT_PASSWORD})

    header = response.headers["set-cookie"]
    assert "HttpOnly" in header
    assert "SameSite=strict" in header.replace("samesite", "SameSite")
    assert f"Path={REFRESH_COOKIE_PATH}" in header
    # Secure is driven from config and is off locally so HTTP dev works.
    assert "Secure" not in header


def test_login_is_case_insensitive_on_email(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="mixed.case@acme.inc")

    response = client.post(
        LOGIN, json={"email": "Mixed.Case@ACME.inc", "password": DEFAULT_PASSWORD}
    )

    assert response.status_code == 200


def test_login_records_the_login_time(client: TestClient, db_session: Session) -> None:
    user = make_user(db_session, email="stamped@acme.inc")
    assert user.last_login_at is None

    client.post(LOGIN, json={"email": "stamped@acme.inc", "password": DEFAULT_PASSWORD})

    db_session.refresh(user)
    assert user.last_login_at is not None


@pytest.mark.parametrize(
    ("email", "password", "case"),
    [
        ("nobody@acme.inc", DEFAULT_PASSWORD, "unknown email"),
        ("known@acme.inc", "wrong-password-here", "wrong password"),
    ],
)
def test_login_gives_one_generic_error(
    client: TestClient, db_session: Session, email: str, password: str, case: str
) -> None:
    """The response must not reveal whether the account exists."""
    make_user(db_session, email="known@acme.inc")

    response = client.post(LOGIN, json={"email": email, "password": password})

    assert response.status_code == 401, case
    assert response.json()["detail"] == "Incorrect email or password."
    assert response.json()["code"] == "INVALID_CREDENTIALS"


def test_deactivated_account_cannot_log_in(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="gone@acme.inc", is_active=False)

    response = client.post(LOGIN, json={"email": "gone@acme.inc", "password": DEFAULT_PASSWORD})

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password."


# --- Refresh rotation ------------------------------------------------------


def test_refresh_rotates_the_token(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="rotate@acme.inc")
    login_response = client.post(
        LOGIN, json={"email": "rotate@acme.inc", "password": DEFAULT_PASSWORD}
    )
    original_cookie = login_response.cookies[REFRESH_COOKIE_NAME]

    response = client.post(REFRESH)

    assert response.status_code == 200, response.text
    rotated_cookie = response.cookies[REFRESH_COOKIE_NAME]
    assert rotated_cookie != original_cookie

    old = db_session.scalars(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(original_cookie))
    ).one()
    assert old.revoked_at is not None, "the presented token must be revoked"


def test_refresh_without_a_cookie_is_rejected(client: TestClient) -> None:
    response = client.post(REFRESH)

    assert response.status_code == 401
    assert response.json()["code"] == "MISSING_REFRESH_TOKEN"


def test_reusing_a_revoked_token_kills_every_session(
    client: TestClient, db_session: Session
) -> None:
    """Replay of a spent token means theft or a race; end all sessions either way."""
    user = make_user(db_session, email="replay@acme.inc")
    first = client.post(LOGIN, json={"email": "replay@acme.inc", "password": DEFAULT_PASSWORD})
    stolen = first.cookies[REFRESH_COOKIE_NAME]

    client.post(REFRESH)  # legitimate rotation; `stolen` is now revoked

    client.cookies.set(REFRESH_COOKIE_NAME, stolen, path=REFRESH_COOKIE_PATH)
    replay = client.post(REFRESH)

    assert replay.status_code == 401
    live = db_session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    assert live == [], "every session for the user must be revoked"


def test_reuse_revocation_is_committed_not_merely_flushed(
    client: TestClient, db_session: Session
) -> None:
    """The mass revocation must survive the request that triggers it failing.

    `test_reusing_a_revoked_token_kills_every_session` above cannot catch a
    regression here. Every request in that test shares this test's session, so
    a write that is only *flushed* is still visible to its assertions — while
    in production each request gets its own session and `get_db` closes it
    without committing, discarding the revocation entirely.

    So this asserts the mechanism rather than the outcome: the reuse path
    commits on its own, because its caller never will.
    """
    user = make_user(db_session, email="replay-commit@acme.inc")
    first = client.post(
        LOGIN, json={"email": "replay-commit@acme.inc", "password": DEFAULT_PASSWORD}
    )
    stolen = first.cookies[REFRESH_COOKIE_NAME]
    client.post(REFRESH)  # legitimate rotation; `stolen` is now revoked

    commits: list[None] = []
    real_commit = db_session.commit

    def counting_commit() -> None:
        commits.append(None)
        real_commit()

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(db_session, "commit", counting_commit)
        with pytest.raises(AuthenticationError):
            auth_service.rotate_session(db_session, stolen)

    assert commits, "the revocation must be committed, since the failing request cannot"
    live = db_session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    assert live == []


def test_expired_refresh_token_is_rejected(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="stale@acme.inc")
    client.post(LOGIN, json={"email": "stale@acme.inc", "password": DEFAULT_PASSWORD})

    stored = db_session.scalars(select(RefreshToken)).one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.flush()

    assert client.post(REFRESH).status_code == 401


def test_unknown_refresh_token_is_rejected(client: TestClient) -> None:
    client.cookies.set(REFRESH_COOKIE_NAME, "not-a-real-token", path=REFRESH_COOKIE_PATH)

    assert client.post(REFRESH).status_code == 401


# --- Logout ----------------------------------------------------------------


def test_logout_revokes_the_token_and_clears_the_cookie(
    client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="bye@acme.inc")
    login_response = client.post(
        LOGIN, json={"email": "bye@acme.inc", "password": DEFAULT_PASSWORD}
    )
    cookie = login_response.cookies[REFRESH_COOKIE_NAME]

    response = client.post(LOGOUT)

    assert response.status_code == 200
    stored = db_session.scalars(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(cookie))
    ).one()
    assert stored.revoked_at is not None
    assert 'acme_refresh_token=""' in response.headers["set-cookie"]


def test_logout_without_a_session_still_succeeds(client: TestClient) -> None:
    """Signing out of a session you do not have is not an error."""
    assert client.post(LOGOUT).status_code == 200


# --- Change password -------------------------------------------------------


def test_change_password_updates_the_credential(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="changer@acme.inc")
    token = login(client, "changer@acme.inc")

    response = client.post(
        CHANGE_PASSWORD,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a-brand-new-passphrase"},
        headers=auth_header(token),
    )

    assert response.status_code == 200, response.text
    assert (
        client.post(
            LOGIN, json={"email": "changer@acme.inc", "password": DEFAULT_PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            LOGIN, json={"email": "changer@acme.inc", "password": "a-brand-new-passphrase"}
        ).status_code
        == 200
    )


def test_change_password_requires_the_current_one(client: TestClient, db_session: Session) -> None:
    make_user(db_session, email="careless@acme.inc")
    token = login(client, "careless@acme.inc")

    response = client.post(
        CHANGE_PASSWORD,
        json={"current_password": "not-my-password", "new_password": "a-brand-new-passphrase"},
        headers=auth_header(token),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_CURRENT_PASSWORD"


def test_change_password_rejects_reusing_the_same_one(
    client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="lazy@acme.inc")
    token = login(client, "lazy@acme.inc")

    response = client.post(
        CHANGE_PASSWORD,
        json={"current_password": DEFAULT_PASSWORD, "new_password": DEFAULT_PASSWORD},
        headers=auth_header(token),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "PASSWORD_UNCHANGED"


def test_change_password_revokes_other_sessions(client: TestClient, db_session: Session) -> None:
    user = make_user(db_session, email="revoker@acme.inc")
    token = login(client, "revoker@acme.inc")

    client.post(
        CHANGE_PASSWORD,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a-brand-new-passphrase"},
        headers=auth_header(token),
    )

    live = db_session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    assert live == []


# --- Who am I --------------------------------------------------------------


def test_me_returns_the_caller(client: TestClient, db_session: Session) -> None:
    user = make_user(db_session, email="self@acme.inc", full_name="Self Knowledge")
    token = login(client, "self@acme.inc")

    response = client.get(ME, headers=auth_header(token))

    assert response.status_code == 200
    body = response.json()["user"]
    assert body["id"] == str(user.id)
    assert body["full_name"] == "Self Knowledge"
    assert body["engineer_profile"] is None


def test_me_includes_the_engineer_profile(client: TestClient, db_session: Session) -> None:
    make_engineer(db_session, email="tech@acme.inc")
    token = login(client, "tech@acme.inc")

    response = client.get(ME, headers=auth_header(token))

    assert response.status_code == 200
    profile = response.json()["user"]["engineer_profile"]
    assert profile is not None
    assert profile["level"] == "JUNIOR"
    assert profile["availability"] == "AVAILABLE"
    assert profile["max_active_tickets"] == 10


@pytest.mark.parametrize(
    ("headers", "case"),
    [
        ({}, "no header at all"),
        ({"Authorization": "Bearer "}, "empty token"),
        ({"Authorization": "Basic abc123"}, "wrong scheme"),
        ({"Authorization": "Bearer not.a.jwt"}, "malformed token"),
    ],
)
def test_me_requires_a_valid_bearer_token(
    client: TestClient, headers: dict[str, str], case: str
) -> None:
    response = client.get(ME, headers=headers)

    assert response.status_code == 401, case
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_token_for_a_deactivated_user_stops_working(
    client: TestClient, db_session: Session
) -> None:
    """Deactivation must take effect immediately, not when the token expires."""
    user = make_user(db_session, email="soon.gone@acme.inc")
    token = login(client, "soon.gone@acme.inc")
    assert client.get(ME, headers=auth_header(token)).status_code == 200

    user.is_active = False
    db_session.flush()

    response = client.get(ME, headers=auth_header(token))
    assert response.status_code == 401
    assert response.json()["code"] == "INACTIVE_ACCOUNT"
