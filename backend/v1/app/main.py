"""FastAPI application factory and router mounting.

Every path this app serves starts with `/api/v1` — including the OpenAPI docs.
CloudFront only forwards `/api/v1*` to the Lambda, so anything mounted outside
that prefix would be unreachable in the deployed environment.
"""

from fastapi import FastAPI

from app.config import API_PREFIX, get_settings
from app.errors import ApiError, api_error_handler
from app.observability import RequestLogMiddleware, configure_logging
from app.routers import (
    auth,
    categories,
    engineers,
    facilities,
    health,
    incidents,
    notes,
    reports,
    users,
)
from app.services.health import API_VERSION

DESCRIPTION = (
    "Facility incident management for ACME Inc. Employees report workplace "
    "issues, admins define facilities and assign work, engineers resolve tickets."
)


def create_app() -> FastAPI:
    """Build the FastAPI application and mount every router under `/api/v1`."""
    # Before anything else, so that a failure while building the app is itself
    # logged as JSON. This is the one entry point uvicorn, `function.handler`
    # and the test client all share.
    configure_logging(get_settings().log_level)

    application = FastAPI(
        title="ACME Facility Incident Management API",
        description=DESCRIPTION,
        version=API_VERSION,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
        redoc_url=None,
    )

    # The outermost layer, so it sees the status Starlette finally sent —
    # including the 404s and 422s raised before any router is reached. Added
    # first because `add_middleware` builds the stack inside out.
    application.add_middleware(RequestLogMiddleware)

    # One handler renders every deliberate error as {detail, code?, field?}.
    application.add_exception_handler(ApiError, api_error_handler)

    application.include_router(health.router, prefix=API_PREFIX)
    application.include_router(auth.router, prefix=API_PREFIX)
    application.include_router(facilities.router, prefix=API_PREFIX)
    application.include_router(categories.router, prefix=API_PREFIX)
    application.include_router(engineers.router, prefix=API_PREFIX)
    application.include_router(users.router, prefix=API_PREFIX)
    application.include_router(incidents.router, prefix=API_PREFIX)
    application.include_router(notes.router, prefix=API_PREFIX)
    application.include_router(reports.router, prefix=API_PREFIX)
    return application


app = create_app()
