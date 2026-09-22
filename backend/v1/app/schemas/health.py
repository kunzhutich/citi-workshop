"""Response models for the health endpoint."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DependencyState = Literal["ok", "error"]
ServiceState = Literal["ok", "degraded"]


class DatabaseHealth(BaseModel):
    """Result of the PostgreSQL connectivity probe."""

    status: DependencyState = Field(description="Whether the database answered the probe.")
    version: str | None = Field(
        default=None,
        description="PostgreSQL server version, when the probe succeeded.",
    )
    detail: str | None = Field(
        default=None,
        description="Why the probe failed, when it did.",
    )


class HealthReport(BaseModel):
    """Overall service health, used by the walking-skeleton status page."""

    status: ServiceState = Field(description="'ok' when every dependency is reachable.")
    environment: Literal["local", "aws"] = Field(description="Where this instance is running.")
    api_version: str = Field(description="Version of this API.")
    checked_at: datetime = Field(description="UTC time the probe ran.")
    database: DatabaseHealth = Field(description="PostgreSQL connectivity.")
