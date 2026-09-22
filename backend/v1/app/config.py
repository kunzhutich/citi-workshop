"""Application settings, loaded from the environment injected by Terraform.

`infra/locals.tf` sets `IS_LOCAL`, the `POSTGRES_*` variables and `JWT_SECRET` on
the Lambda. Locally nothing injects them, so every field carries a development
default that matches the local PostgreSQL install described in CLAUDE.md. A
`.env` file next to this package overrides those defaults for local work; it is
never present in the Lambda package.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

#: Every route is mounted under this prefix.
#:
#: CloudFront forwards `/api/<service-dir-name>*` to the Lambda **without**
#: stripping the prefix, and our service directory is `backend/v1`, so the
#: application itself must own the full `/api/v1` path. The Vite dev proxy
#: forwards `/api` unchanged for the same reason.
API_PREFIX = "/api/v1"


class Settings(BaseSettings):
    """Runtime configuration for the API."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Environment identity -------------------------------------------------
    is_local: bool = Field(
        default=True,
        description="True on a developer machine, False in the deployed Lambda.",
    )
    app_name: str = Field(default="acme-incidents", description="Deployed application name.")

    # --- Database -------------------------------------------------------------
    postgres_host: str = Field(default="localhost", description="PostgreSQL host name.")
    postgres_port: int = Field(default=5432, description="PostgreSQL port.")
    postgres_name: str = Field(default="postgres", description="PostgreSQL database name.")
    postgres_user: str = Field(default="postgres", description="PostgreSQL user name.")
    postgres_pass: str = Field(default="postgres123", description="PostgreSQL password.")
    postgres_connect_timeout: int = Field(
        default=30,
        description=(
            "Seconds to wait for a connection. Aurora Serverless v2 runs with "
            "min_capacity = 0 and takes roughly 15 seconds to wake from idle."
        ),
    )

    # --- Security -------------------------------------------------------------
    jwt_secret: str = Field(
        default="local-development-secret-change-me",
        description="HS256 signing key for access tokens. Injected as JWT_SECRET in the cloud.",
    )

    @property
    def environment_name(self) -> Literal["local", "aws"]:
        """Return a human-readable name for the environment we are running in."""
        return "local" if self.is_local else "aws"

    @property
    def cookie_secure(self) -> bool:
        """Return whether auth cookies should carry the `Secure` flag.

        False locally so that plain-HTTP development works, True once the app is
        served over HTTPS by CloudFront.
        """
        return not self.is_local

    @property
    def database_url(self) -> URL:
        """Build the SQLAlchemy URL for the configured PostgreSQL instance.

        `URL.create` escapes the password for us, which matters because Aurora
        generates passwords containing characters that are unsafe in a URL.
        Aurora also requires TLS, so `sslmode=require` is appended whenever we
        are not running locally.
        """
        query: dict[str, str] = {} if self.is_local else {"sslmode": "require"}
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_pass,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_name,
            query=query,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance.

    Cached so that a warm Lambda container parses the environment once. Tests
    call `get_settings.cache_clear()` when they need to change it.
    """
    return Settings()
