"""The API's error type and its response shape.

Every deliberate error the application raises is an ``ApiError``, rendered by
one handler registered in ``app.main`` as::

    {"detail": "Human readable message", "code": "MACHINE_CODE", "field": "email"}

``code`` and ``field`` are optional. ``code`` is what the frontend branches on
(``PASSWORD_CHANGE_REQUIRED`` drives a redirect, for instance); ``field`` lets a
form attach the message to the input that caused it.

FastAPI's own request-validation failures keep their standard shape —
``{"detail": [{"loc": [...], "msg": ...}]}`` — because that carries per-field
detail for free and every FastAPI client already understands it.
"""

from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """An error with an HTTP status, a message, and optional machine-readable parts."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        code: str | None = None,
        field: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Store the parts of the response this error should produce."""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.field = field
        self.extra = extra or {}


class ValidationError(ApiError):
    """A request was well-formed but broke a business rule. Renders as 422."""

    def __init__(self, detail: str, *, code: str | None = None, field: str | None = None) -> None:
        """Create a 422 error, optionally naming the offending field."""
        super().__init__(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, code=code, field=field)


class AuthenticationError(ApiError):
    """No valid credentials were supplied. Renders as 401."""

    def __init__(self, detail: str = "Not authenticated.", *, code: str | None = None) -> None:
        """Create a 401 error."""
        super().__init__(status.HTTP_401_UNAUTHORIZED, detail, code=code)


class AuthorizationError(ApiError):
    """The caller is known but not allowed to do this. Renders as 403."""

    def __init__(self, detail: str = "Not permitted.", *, code: str | None = None) -> None:
        """Create a 403 error."""
        super().__init__(status.HTTP_403_FORBIDDEN, detail, code=code)


class NotFoundError(ApiError):
    """The addressed resource does not exist. Renders as 404.

    Used for a genuinely missing row only. A row the caller may not touch is a
    403 from ``require_roles``, not a 404 — this API does not hide the
    existence of resources, and keeping the two apart makes the tests
    unambiguous.
    """

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        """Create a 404 error."""
        super().__init__(status.HTTP_404_NOT_FOUND, detail, code=code)


class ConflictError(ApiError):
    """The request conflicts with existing state. Renders as 409."""

    def __init__(self, detail: str, *, code: str | None = None, field: str | None = None) -> None:
        """Create a 409 error."""
        super().__init__(status.HTTP_409_CONFLICT, detail, code=code, field=field)


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render an `ApiError` as the documented JSON error body."""
    del request
    # The handler is registered for ApiError only; the broad signature is what
    # Starlette requires. Anything else is a bug, so fail loudly as a 500.
    if not isinstance(exc, ApiError):
        raise exc

    body: dict[str, Any] = {"detail": exc.detail}
    if exc.code is not None:
        body["code"] = exc.code
    if exc.field is not None:
        body["field"] = exc.field
    body.update(exc.extra)

    headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
    return JSONResponse(status_code=exc.status_code, content=body, headers=headers)
