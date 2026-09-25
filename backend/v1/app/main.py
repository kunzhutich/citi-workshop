"""FastAPI application factory and router mounting.

Every path this app serves starts with `/api/v1` — including the OpenAPI docs.
CloudFront only forwards `/api/v1*` to the Lambda, so anything mounted outside
that prefix would be unreachable in the deployed environment.
"""

from fastapi import FastAPI
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import API_PREFIX, get_settings
from app.errors import ApiError, api_error_handler
from app.observability import RequestLogMiddleware, configure_logging
from app.routers import (
    auth,
    categories,
    engineers,
    facilities,
    feedback,
    health,
    incidents,
    notes,
    notifications,
    reports,
    users,
)
from app.services.health import API_VERSION

DESCRIPTION = (
    "Facility incident management for ACME Inc. Employees report workplace "
    "issues, admins define facilities and assign work, engineers resolve tickets."
)


class NoStoreMiddleware:
    """Tell browsers never to reuse an API response.

    FastAPI sends no cache directives of its own, and a 200 with no
    ``Cache-Control`` may be cached *heuristically* — RFC 9111 §4.2.2 permits a
    cache to guess a freshness lifetime when the server gave none. CloudFront
    does not do this (the `/api/v1*` behaviour uses the managed CachingDisabled
    policy), but the browser does, and the browser is the one that matters.

    It cost a real bug. After a password change the app signs the user in again
    and re-reads ``/auth/me``; the browser answered that read from its own cache
    with the body from *before* the change, so ``must_change_password`` was
    still true and the guard sent the user back to the change-password screen.
    Correct password, correct API response, endless loop — and only when
    deployed, because Vite's dev proxy does not cache.

    ``no-store`` rather than ``no-cache``: ``no-cache`` permits storing the
    response and revalidating, which is a weaker promise than we want for
    responses that are per-user and frequently carry a session's state.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap the next application in the ASGI stack."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Add `Cache-Control: no-store` to every HTTP response."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["cache-control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_no_store)


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
    # Outside the logger, so every response leaves with the header —
    # including errors raised before any router runs. See the class.
    application.add_middleware(NoStoreMiddleware)

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
    application.include_router(feedback.router, prefix=API_PREFIX)
    application.include_router(notifications.router, prefix=API_PREFIX)
    application.include_router(reports.router, prefix=API_PREFIX)
    return application


app = create_app()
