"""Ten failed sign-ins per email per fifteen minutes.

One test does the whole thing over HTTP with ten real requests, because that
is the claim. The rest seed the counter row directly: each failed login costs
a deliberate quarter-second of bcrypt, and ten of those per test to re-prove
what the first test already proved would add minutes to the suite for nothing.
"""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.errors import RateLimitError
from app.models.login_attempt import LoginAttempt
from app.repositories import login_attempts as login_attempt_repository
from app.services import auth_service
from app.services.auth_service import LOGIN_LOCKOUT_WINDOW, MAX_FAILED_LOGIN_ATTEMPTS
from tests.factories import DEFAULT_PASSWORD, make_user

LOGIN = "/api/v1/auth/login"
WRONG_PASSWORD = "not-the-right-password-at-all"


def attempt_login(client: TestClient, email: str, password: str = WRONG_PASSWORD):  # noqa: ANN201
    """Post one sign-in and return the response."""
    return client.post(LOGIN, json={"email": email, "password": password})


def seed_failures(
    session: Session,
    email: str,
    *,
    count: int,
    first_failure_at: datetime | None = None,
) -> LoginAttempt:
    """Put a failure window straight into the table, without spending bcrypt."""
    started = first_failure_at or utc_now()
    attempt = LoginAttempt(
        email=email,
        failure_count=count,
        first_failure_at=started,
        last_failure_at=started,
    )
    session.add(attempt)
    session.flush()
    return attempt


# --- The rule, end to end ----------------------------------------------------


def test_ten_failures_lock_the_eleventh_attempt(client: TestClient, db_session: Session) -> None:
    """The whole claim, over HTTP, with real requests and a real password."""
    user = make_user(db_session, email="locks-out@acme.inc")

    for _ in range(MAX_FAILED_LOGIN_ATTEMPTS):
        assert attempt_login(client, user.email).status_code == 401

    refused = attempt_login(client, user.email)

    assert refused.status_code == 429
    assert refused.json()["code"] == "TOO_MANY_LOGIN_ATTEMPTS"
    assert 0 < refused.json()["retry_after_seconds"] <= LOGIN_LOCKOUT_WINDOW.total_seconds()
    assert refused.headers["Retry-After"] == str(refused.json()["retry_after_seconds"])


def test_the_tenth_failure_is_still_a_401_not_a_429(
    client: TestClient, db_session: Session
) -> None:
    """The limit is ten allowed failures, not nine."""
    user = make_user(db_session, email="exactly-ten@acme.inc")
    seed_failures(db_session, user.email, count=MAX_FAILED_LOGIN_ATTEMPTS - 1)

    assert attempt_login(client, user.email).status_code == 401
    assert attempt_login(client, user.email).status_code == 429


def test_the_right_password_is_refused_while_the_address_is_locked(
    client: TestClient, db_session: Session
) -> None:
    """Otherwise the lockout is a speed bump rather than a lockout."""
    user = make_user(db_session, email="locked-but-correct@acme.inc")
    seed_failures(db_session, user.email, count=MAX_FAILED_LOGIN_ATTEMPTS)

    refused = attempt_login(client, user.email, DEFAULT_PASSWORD)

    assert refused.status_code == 429


def test_a_successful_sign_in_forgets_the_failures_before_it(
    client: TestClient, db_session: Session
) -> None:
    user = make_user(db_session, email="forgiven@acme.inc")
    seed_failures(db_session, user.email, count=MAX_FAILED_LOGIN_ATTEMPTS - 1)

    assert attempt_login(client, user.email, DEFAULT_PASSWORD).status_code == 200

    assert login_attempt_repository.get(db_session, user.email) is None
    # And the allowance starts again rather than resuming at nine.
    assert attempt_login(client, user.email).status_code == 401


# --- Not leaking who has an account -----------------------------------------


def test_an_address_with_no_account_locks_out_exactly_the_same(
    client: TestClient, db_session: Session
) -> None:
    """The counter is keyed on the address, not on a user row.

    If only real accounts could be locked out, the 429 would answer "does this
    person have an account here?" — which is the question the single generic
    401 exists to refuse.
    """
    seed_failures(db_session, "nobody-at-all@acme.inc", count=MAX_FAILED_LOGIN_ATTEMPTS)

    refused = attempt_login(client, "nobody-at-all@acme.inc")

    assert refused.status_code == 429
    assert refused.json()["code"] == "TOO_MANY_LOGIN_ATTEMPTS"


def test_a_locked_real_address_and_a_locked_unknown_one_answer_identically(
    client: TestClient, db_session: Session
) -> None:
    real = make_user(db_session, email="real-person@acme.inc")
    seed_failures(db_session, real.email, count=MAX_FAILED_LOGIN_ATTEMPTS)
    seed_failures(db_session, "ghost@acme.inc", count=MAX_FAILED_LOGIN_ATTEMPTS)

    for_real = attempt_login(client, real.email)
    for_ghost = attempt_login(client, "ghost@acme.inc")

    assert for_real.status_code == for_ghost.status_code
    assert for_real.json()["detail"] == for_ghost.json()["detail"]
    assert for_real.json()["code"] == for_ghost.json()["code"]


def test_a_correct_password_for_a_deactivated_account_still_counts(
    client: TestClient, db_session: Session
) -> None:
    """Every rejected sign-in counts, with no branch an attacker could read."""
    user = make_user(db_session, email="deactivated@acme.inc", is_active=False)

    assert attempt_login(client, user.email, DEFAULT_PASSWORD).status_code == 401

    attempt = login_attempt_repository.get(db_session, user.email)
    assert attempt is not None
    assert attempt.failure_count == 1


def test_changing_the_capitalisation_does_not_buy_a_second_allowance(
    client: TestClient, db_session: Session
) -> None:
    make_user(db_session, email="mixed.case@acme.inc")
    seed_failures(db_session, "mixed.case@acme.inc", count=MAX_FAILED_LOGIN_ATTEMPTS)

    assert attempt_login(client, "MIXED.CASE@acme.inc").status_code == 429
    assert attempt_login(client, "  Mixed.Case@Acme.Inc  ").status_code == 429


# --- The window --------------------------------------------------------------


def test_the_lockout_expires_and_the_account_works_again(db_session: Session) -> None:
    """Time is injected, not slept through."""
    user = make_user(db_session, email="expires@acme.inc")
    started = utc_now()
    seed_failures(db_session, user.email, count=MAX_FAILED_LOGIN_ATTEMPTS, first_failure_at=started)

    with pytest.raises(RateLimitError):
        auth_service.authenticate(
            db_session,
            email=user.email,
            password=DEFAULT_PASSWORD,
            now=started + LOGIN_LOCKOUT_WINDOW - timedelta(seconds=1),
        )

    signed_in = auth_service.authenticate(
        db_session,
        email=user.email,
        password=DEFAULT_PASSWORD,
        now=started + LOGIN_LOCKOUT_WINDOW + timedelta(seconds=1),
    )

    assert signed_in.id == user.id


def test_the_window_is_fixed_so_hammering_cannot_extend_it(db_session: Session) -> None:
    """A failure inside a live window does not restart the clock.

    With a *sliding* window an attacker could keep an address locked for ever
    by failing one login every fourteen minutes. The expiry is measured from
    the first failure in the run, so it cannot be pushed out.
    """
    started = utc_now()
    email = "hammered@acme.inc"
    make_user(db_session, email=email)
    seed_failures(db_session, email, count=MAX_FAILED_LOGIN_ATTEMPTS, first_failure_at=started)

    fourteen_minutes_later = started + timedelta(minutes=14)
    with pytest.raises(RateLimitError):
        auth_service.authenticate(
            db_session, email=email, password=WRONG_PASSWORD, now=fourteen_minutes_later
        )

    attempt = login_attempt_repository.get(db_session, email)
    assert attempt is not None
    assert attempt.first_failure_at == started, "the window must not have moved"


def test_a_failure_after_the_window_starts_counting_again_from_one(
    db_session: Session,
) -> None:
    started = utc_now()
    email = "stale-window@acme.inc"
    make_user(db_session, email=email)
    seed_failures(db_session, email, count=MAX_FAILED_LOGIN_ATTEMPTS, first_failure_at=started)

    later = started + LOGIN_LOCKOUT_WINDOW + timedelta(minutes=1)
    with pytest.raises(Exception, match="Incorrect email or password"):
        auth_service.authenticate(db_session, email=email, password=WRONG_PASSWORD, now=later)

    attempt = login_attempt_repository.get(db_session, email)
    assert attempt is not None
    assert attempt.failure_count == 1
    assert attempt.first_failure_at == later


# --- Keeping the table small -------------------------------------------------


def test_a_failed_login_sweeps_away_the_windows_that_have_expired(
    client: TestClient, db_session: Session
) -> None:
    """The table cleans itself; there is nowhere for a sweeper to run.

    Aurora sleeps at `min_capacity = 0`, so a scheduled job would have to wake
    the cluster on a timer purely to delete rows nobody is reading.
    """
    long_ago = utc_now() - LOGIN_LOCKOUT_WINDOW - timedelta(hours=2)
    seed_failures(db_session, "abandoned-one@acme.inc", count=3, first_failure_at=long_ago)
    seed_failures(db_session, "abandoned-two@acme.inc", count=7, first_failure_at=long_ago)
    live = seed_failures(db_session, "still-trying@acme.inc", count=2)

    attempt_login(client, "someone-else@acme.inc")

    remaining = set(db_session.scalars(select(LoginAttempt.email)).all())
    assert "abandoned-one@acme.inc" not in remaining
    assert "abandoned-two@acme.inc" not in remaining
    assert live.email in remaining
    assert "someone-else@acme.inc" in remaining


def test_the_counter_is_committed_not_merely_flushed(
    client: TestClient, db_session: Session
) -> None:
    """A count that only survives a successful request counts nothing.

    The request that increments the counter is the request that then raises
    401, so its router never reaches `session.commit()` and `get_db` closes
    the session without one. This asserts the mechanism rather than the
    outcome, because every request in this test shares the test's session and
    a merely-flushed write would still be visible to the assertions.
    """
    make_user(db_session, email="commit-me@acme.inc")

    commits: list[None] = []
    real_commit = db_session.commit

    def counting_commit() -> None:
        commits.append(None)
        real_commit()

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(db_session, "commit", counting_commit)
        assert attempt_login(client, "commit-me@acme.inc").status_code == 401

    assert commits, "the failure path must commit its own count"


def test_a_locked_address_costs_no_password_verification(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The lockout is checked before the lookup and before bcrypt.

    Which is also what makes it a defence rather than a message: a locked
    address cannot be used to spend the server's CPU.
    """
    user = make_user(db_session, email="no-bcrypt@acme.inc")
    seed_failures(db_session, user.email, count=MAX_FAILED_LOGIN_ATTEMPTS)

    def explode(*_args: object, **_kwargs: object) -> bool:
        raise AssertionError("a locked address must not reach password verification")

    monkeypatch.setattr(auth_service, "verify_password", explode)

    assert attempt_login(client, user.email, DEFAULT_PASSWORD).status_code == 429
