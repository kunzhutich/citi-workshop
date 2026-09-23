"""Application settings, loaded from the environment injected by Terraform.

`infra/locals.tf` sets `IS_LOCAL`, the `POSTGRES_*` variables and `JWT_SECRET` on
the Lambda. Locally nothing injects them, so every field carries a development
default that matches the local PostgreSQL install described in CLAUDE.md. A
`.env` file next to this package overrides those defaults for local work; it is
never present in the Lambda package.
"""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

#: Every route is mounted under this prefix.
#:
#: CloudFront forwards `/api/<service-dir-name>*` to the Lambda **without**
#: stripping the prefix, and our service directory is `backend/v1`, so the
#: application itself must own the full `/api/v1` path. The Vite dev proxy
#: forwards `/api` unchanged for the same reason.
API_PREFIX = "/api/v1"

#: The signing key used when nothing injects one. It exists so that a fresh
#: clone runs with no setup; it is public, so a deployed environment that still
#: carries it must refuse to start. `Settings._reject_a_weak_deployed_secret`
#: is what enforces that.
DEVELOPMENT_JWT_SECRET = "local-development-secret-change-me"  # nosec B105 - a placeholder

#: Shortest HS256 key we accept outside local development. RFC 7518 section 3.2
#: requires a key at least as long as the hash output, which for SHA-256 is 32
#: bytes; PyJWT warns below that length rather than refusing.
MIN_JWT_SECRET_BYTES = 32


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

    # --- Observability --------------------------------------------------------
    log_level: str = Field(
        default="INFO",
        description=("Root log level. Every line is JSON on stdout; see app/observability.py."),
    )

    # --- Security -------------------------------------------------------------
    jwt_secret: str = Field(
        default=DEVELOPMENT_JWT_SECRET,
        description="HS256 signing key for access tokens. Injected as JWT_SECRET in the cloud.",
    )

    @model_validator(mode="after")
    def _reject_a_weak_deployed_secret(self) -> Self:
        """Refuse to start a deployed environment with a guessable signing key.

        This is a startup check rather than a runtime one because the failure it
        prevents is silent: `infra/lambda.tf` filters out environment variables
        whose value is empty, so a `JWT_SECRET` that failed to apply does not
        arrive as an empty string — it does not arrive at all, and the field
        falls back to `DEVELOPMENT_JWT_SECRET`. Tokens would then be signed with
        a value published in this repository, and every session would look
        perfectly healthy.

        Failing here turns that into a Lambda that cannot initialise, which is
        loud, immediate, and fixed by re-applying Terraform.
        """
        if self.is_local:
            return self

        if self.jwt_secret == DEVELOPMENT_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is still the development default. Set a real signing key "
                "on the Lambda (infra/locals.tf injects random_password.jwt_secret)."
            )

        if len(self.jwt_secret.encode("utf-8")) < MIN_JWT_SECRET_BYTES:
            raise ValueError(
                f"JWT_SECRET must be at least {MIN_JWT_SECRET_BYTES} bytes outside local "
                "development; HS256 keys shorter than the hash output weaken the signature."
            )

        return self

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
