"""FastAPI application factory and router mounting.

Every path this app serves starts with `/api/v1` — including the OpenAPI docs.
CloudFront only forwards `/api/v1*` to the Lambda, so anything mounted outside
that prefix would be unreachable in the deployed environment.
"""

from fastapi import FastAPI

from app.config import API_PREFIX
from app.routers import health
from app.services.health import API_VERSION

DESCRIPTION = (
    "Facility incident management for ACME Inc. Employees report workplace "
    "issues, admins define facilities and assign work, engineers resolve tickets."
)


def create_app() -> FastAPI:
    """Build the FastAPI application and mount every router under `/api/v1`."""
    application = FastAPI(
        title="ACME Facility Incident Management API",
        description=DESCRIPTION,
        version=API_VERSION,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
        redoc_url=None,
    )
    application.include_router(health.router, prefix=API_PREFIX)
    return application


app = create_app()
