"""Settings and database URL construction."""

import pytest

from app.config import Settings


def test_local_settings_use_a_plain_connection() -> None:
    settings = Settings(is_local=True, postgres_host="localhost", postgres_name="postgres")

    url = settings.database_url

    assert url.drivername == "postgresql+psycopg"
    assert url.host == "localhost"
    assert url.database == "postgres"
    assert "sslmode" not in url.query
    assert settings.environment_name == "local"
    assert settings.cookie_secure is False


def test_cloud_settings_require_tls() -> None:
    settings = Settings(
        is_local=False,
        postgres_host="aurora.example.aws",
        postgres_name="codingworkshop",
    )

    url = settings.database_url

    assert url.query["sslmode"] == "require"
    assert settings.environment_name == "aws"
    assert settings.cookie_secure is True


def test_password_special_characters_are_escaped() -> None:
    """Aurora generates passwords containing characters that are unsafe in a URL."""
    settings = Settings(postgres_pass="p@ss/word:with#chars")

    rendered = settings.database_url.render_as_string(hide_password=False)

    # The raw password must not appear unescaped in the connection string.
    assert "p@ss/word:with#chars" not in rendered
    assert "p%40ss%2Fword%3Awith%23chars" in rendered
    # And SQLAlchemy must still hand the original value back to the driver.
    assert settings.database_url.password == "p@ss/word:with#chars"


@pytest.mark.parametrize("raw", ["true", "True", "1"])
def test_is_local_reads_truthy_environment_values(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    monkeypatch.setenv("IS_LOCAL", raw)

    assert Settings().is_local is True


@pytest.mark.parametrize("raw", ["false", "False", "0"])
def test_is_local_reads_falsey_environment_values(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    monkeypatch.setenv("IS_LOCAL", raw)

    assert Settings().is_local is False


def test_postgres_environment_variables_win_over_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Connection details come from the environment Terraform injects, never from code."""
    monkeypatch.setenv("POSTGRES_HOST", "cluster.eu-west-1.rds.amazonaws.com")
    monkeypatch.setenv("POSTGRES_PORT", "6432")
    monkeypatch.setenv("POSTGRES_NAME", "codingworkshop")
    monkeypatch.setenv("POSTGRES_USER", "superadmin")

    settings = Settings()

    assert settings.postgres_host == "cluster.eu-west-1.rds.amazonaws.com"
    assert settings.postgres_port == 6432
    assert settings.postgres_name == "codingworkshop"
    assert settings.postgres_user == "superadmin"
