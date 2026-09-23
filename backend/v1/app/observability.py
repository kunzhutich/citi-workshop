"""Structured JSON logging, and the one request-scoped context it needs.

CloudWatch Logs parses a log line that is a single JSON object, and only then
can a log group be queried (`fields @timestamp, status, duration_ms | filter
status >= 500`). The default handler emits prose, which CloudWatch stores as an
opaque string. So every line this application writes is one JSON object on one
line, on stdout.

Three things live here because they are one concern — how a running instance of
this application can be observed — and separating them would mean three modules
that are only ever imported together:

* :class:`JsonFormatter`, which renders a :class:`logging.LogRecord` as JSON and
  is the only place a field name is decided;
* :func:`configure_logging`, called once from ``create_app`` so that uvicorn,
  pytest and Lambda all get the same output;
* :class:`RequestLogMiddleware`, which times a request and writes one line for
  it, plus the small amount of per-request state that line needs.

**What is deliberately not logged.** No header, no cookie, no request body, no
response body, and not even the query string. That is a structural guarantee
rather than a filter: the middleware never reads those parts of the request, so
there is no code path on which a password, a bearer token or the refresh cookie
could reach a log line. :data:`SENSITIVE_KEY_PARTS` is a second belt for the
fields callers pass themselves, so a future ``extra={"token": ...}`` is redacted
rather than printed.

**Why this is the application's first middleware.** ``security/dependencies.py``
argues against middleware, and that argument still holds — for *rules*. A gate
that has to pattern-match URLs to decide who may pass is worse than a dependency
that says so in a route's signature. This middleware decides nothing. It cannot
refuse a request, and removing it would change no behaviour, only the record of
it. The thing it needs — a wrapper around every request, including the ones that
fail before any dependency runs — is exactly what a dependency cannot be.
"""

import json
import logging
import re
import sys
import time
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from starlette.datastructures import MutableHeaders

#: Response header carrying the id this request was logged under, so a support
#: conversation can start from something the browser can see.
REQUEST_ID_HEADER = "x-request-id"

#: Where the per-request log context is kept. The ASGI scope, rather than a
#: context variable, because the value travels in the direction a context
#: variable cannot: a dependency deep inside the application writes it and the
#: middleware wrapping that application reads it back afterwards. FastAPI runs
#: synchronous dependencies and endpoints in a worker thread, and a thread gets
#: a *copy* of the context — so a `ContextVar.set` inside one is invisible to
#: the caller. The scope is a plain dict shared by reference, and is not.
LOG_CONTEXT_SCOPE_KEY = "acme.log_context"

#: A caller-supplied request id is accepted only in this shape. It is echoed in
#: a response header and written to the log, so anything that could forge a log
#: line or a header must not survive. `json.dumps` already escapes newlines;
#: this is the belt to that's braces.
SAFE_REQUEST_ID = re.compile(r"\A[A-Za-z0-9._\-]{1,128}\Z")

#: An `extra=` field whose name contains one of these is replaced rather than
#: printed. The middleware logs no headers, cookies or bodies at all, so this
#: guards only what application code passes deliberately.
SENSITIVE_KEY_PARTS: tuple[str, ...] = (
    "password",
    "token",
    "secret",
    "cookie",
    "authorization",
    "credential",
)

REDACTED = "[redacted]"

#: Set by the middleware before the request is handled, so every log record
#: written while handling it carries the same id. This direction *does* work
#: across FastAPI's worker threads: a thread inherits a copy of the context, so
#: it sees values set before it started.
_request_id: ContextVar[str | None] = ContextVar("acme_request_id", default=None)

#: Attributes `logging` puts on every record. Anything else came from `extra=`
#: and is promoted to a top-level JSON field.
_STANDARD_RECORD_ATTRIBUTES = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)

logger = logging.getLogger(__name__)


def current_request_id() -> str | None:
    """Return the id of the request being handled on this task, if any."""
    return _request_id.get()


def log_context(scope: MutableMapping[str, Any]) -> dict[str, Any]:
    """Return the mutable log context for an ASGI scope, creating it if absent.

    Absent when the application is driven without the middleware — a unit test
    calling an endpoint function directly, for instance — so this returns a
    throwaway dictionary rather than raising. Nothing downstream should fail
    because logging is not set up.
    """
    context = scope.get(LOG_CONTEXT_SCOPE_KEY)
    if isinstance(context, dict):
        return context
    context = {}
    scope[LOG_CONTEXT_SCOPE_KEY] = context
    return context


def bind_user_id(scope: MutableMapping[str, Any], user_id: uuid.UUID) -> None:
    """Record whose request this is, for the line the middleware writes later.

    Called from ``security/dependencies.py`` once a token has been verified and
    the account read back, which is the first moment the answer is known and
    trustworthy. Requests that never authenticate simply have no ``user_id``.
    """
    log_context(scope)["user_id"] = str(user_id)


def redact(key: str, value: Any) -> Any:  # noqa: ANN401 - any value may be logged
    """Return `value`, or a placeholder if `key` names something secret."""
    lowered = key.lower()
    if any(part in lowered for part in SENSITIVE_KEY_PARTS):
        return REDACTED
    return value


class JsonFormatter(logging.Formatter):
    """Render a log record as one line of JSON.

    Fields every line carries: ``timestamp``, ``level``, ``logger``,
    ``message``. ``request_id`` is added whenever one is in scope, and anything
    passed as ``extra=`` is promoted to a top-level field, so a query in the
    CloudWatch console can filter on it. An exception is rendered under
    ``exception`` as the formatted traceback.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Return the record as a single-line JSON object."""
        payload: dict[str, Any] = {
            "timestamp": _isoformat(record.created),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        request_id = current_request_id()
        if request_id is not None:
            payload["request_id"] = request_id

        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_ATTRIBUTES or key.startswith("_"):
                continue
            payload[key] = redact(key, value)

        # Truthiness, not `is not None`. `logger.log(..., exc_info=False)` stores
        # the literal `False` on the record rather than `None`, and
        # `formatException(False)` raises inside the handler — which `logging`
        # swallows to stderr, losing the line it was asked to write.
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        # `default=str` so a UUID, a datetime or an enum logs as itself rather
        # than raising inside the logging call and losing the line entirely.
        return json.dumps(payload, default=str, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str | int = logging.INFO) -> None:
    """Send every log record through :class:`JsonFormatter`, on stdout.

    Called from ``create_app``, which is the one entry point every environment
    shares — uvicorn locally, ``function.handler`` in Lambda, and the ``client``
    fixture in the tests.

    The root handler list is *replaced* rather than appended to. The Lambda
    runtime installs its own handler, and appending would print every line
    twice, once as JSON and once as prose.

    ``uvicorn.access`` is silenced because :class:`RequestLogMiddleware` writes
    the same event with strictly more in it. ``uvicorn.error`` — which is where
    uvicorn's startup and shutdown messages go, despite the name — is left to
    propagate to the root handler, so those come out as JSON too.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True

    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.propagate = False


class RequestLogMiddleware:
    """Write one JSON line per HTTP request, and tag the request with an id.

    A pure ASGI middleware rather than ``BaseHTTPMiddleware``: the latter runs
    the rest of the application in a separate task, which both breaks the
    context variable this class sets and buffers the response.

    The line carries the method, the matched **route template** rather than the
    concrete path, the status, the duration in milliseconds, the request id and
    the user id if the request authenticated. The route template is what makes
    the log aggregatable — ten thousand lines for ``/api/v1/incidents/{id}``
    rather than ten thousand distinct paths.
    """

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        """Wrap the ASGI application below this one."""
        self.app = app

    async def __call__(
        self,
        scope: MutableMapping[str, Any],
        receive: Callable[[], Awaitable[MutableMapping[str, Any]]],
        send: Callable[[MutableMapping[str, Any]], Awaitable[None]],
    ) -> None:
        """Time the request, attach an id to it, and log the outcome once."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        context = log_context(scope)
        request_id = _resolve_request_id(scope)
        token = _request_id.set(request_id)
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_with_request_id(message: MutableMapping[str, Any]) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            # Starlette's own error middleware turns this into a 500 above us;
            # we record it on the way past and re-raise unchanged.
            _log_request(scope, context, status=500, started=started, failed=True)
            raise
        else:
            _log_request(scope, context, status=status_holder["status"], started=started)
        finally:
            _request_id.reset(token)


def _log_request(
    scope: MutableMapping[str, Any],
    context: dict[str, Any],
    *,
    status: int,
    started: float,
    failed: bool = False,
) -> None:
    """Emit the one line that describes a finished request."""
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    payload: dict[str, Any] = {
        "event": "request",
        "method": scope.get("method", ""),
        # The concrete path, with no query string: a query string carries what
        # somebody typed into the search box, which is their content, not ours.
        "path": scope.get("path", ""),
        "route": _route_template(scope),
        "status": status,
        "duration_ms": duration_ms,
    }
    user_id = context.get("user_id")
    if user_id is not None:
        payload["user_id"] = user_id

    logger.log(
        _level_for(status, failed=failed),
        "%s %s -> %s",
        payload["method"],
        payload["path"],
        status,
        extra=payload,
        exc_info=failed,
    )


def _level_for(status: int, *, failed: bool) -> int:
    """Return the level a response of this status deserves."""
    if failed or status >= 500:
        return logging.ERROR
    if status >= 400:
        return logging.WARNING
    return logging.INFO


def _route_template(scope: MutableMapping[str, Any]) -> str:
    """Return the request's path with its parameters put back as placeholders.

    ``/api/v1/incidents/6f3a…/notes/1b2c…`` becomes
    ``/api/v1/incidents/{incident_id}/notes/{note_id}``, which is the form worth
    aggregating on: one line in a CloudWatch query rather than one per ticket.

    Rebuilt from ``scope["path"]`` and ``scope["path_params"]`` rather than read
    off ``scope["route"]``, deliberately. Both are set by Starlette as it
    dispatches, so this is only meaningful *after* the application has run — but
    ``scope["route"].path`` is the path **relative to the router the route was
    registered on**, and this FastAPI version mounts an included router as a
    child rather than flattening its routes into the app. So that attribute
    reads ``/auth/login`` where the request was ``/api/v1/auth/login``, and it
    would silently start reading the full path again if a future version
    flattened them. Substitution gives the whole path in every version.

    A request that matched no route — a 404 — has no parameters, and its raw
    path is the honest answer.
    """
    path = str(scope.get("path", ""))
    parameters = scope.get("path_params") or {}

    template = path
    for name, value in parameters.items():
        # `str(value)` is the *converted* parameter, so a caller who spelled a
        # UUID in capitals will not match and keeps their concrete segment.
        # That costs one extra distinct route value and nothing else.
        text = str(value)
        if text and text in template:
            template = template.replace(text, f"{{{name}}}", 1)
    return template


def _resolve_request_id(scope: MutableMapping[str, Any]) -> str:
    """Return the id to log this request under.

    Preferring, in order: an ``x-request-id`` the caller supplied and that looks
    safe to echo, the Lambda request id (which is also the one CloudWatch files
    the invocation under, so the two views join), or a fresh one.
    """
    for raw in _header_values(scope, REQUEST_ID_HEADER):
        if SAFE_REQUEST_ID.match(raw):
            return raw

    lambda_context = scope.get("aws.context")
    lambda_request_id = getattr(lambda_context, "aws_request_id", None)
    if isinstance(lambda_request_id, str) and SAFE_REQUEST_ID.match(lambda_request_id):
        return lambda_request_id

    return uuid.uuid4().hex


def _header_values(scope: MutableMapping[str, Any], name: str) -> list[str]:
    """Return the decoded values of one request header."""
    wanted = name.lower().encode("latin-1")
    values = []
    for key, value in scope.get("headers", []):
        if key.lower() == wanted:
            values.append(value.decode("latin-1").strip())
    return values


def _isoformat(created: float) -> str:
    """Return a log record's creation time as an ISO-8601 UTC string."""
    moment = datetime.fromtimestamp(created, UTC)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")
