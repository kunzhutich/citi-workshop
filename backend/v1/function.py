"""AWS Lambda entry point.

Terraform hardcodes the handler as `function.handler`, so this module must live
at the root of `backend/v1/` and expose a module-level `handler`.

One Lambda serves two kinds of event:

* HTTP events arriving from the CloudFront -> Function URL path, which are
  handed to the ASGI application through Mangum.
* Direct invokes carrying an `action` key, which run an operational task
  (health probe now; migrations and seeding from M2 onwards). Direct invoke is
  IAM-protected and is not routed by CloudFront, so these never have a public
  entry point.
"""

from typing import Any

from mangum import Mangum

from app.main import app
from app.services.ops import run_ops

# Logging is configured by `create_app()`, which `from app.main import app` has
# already run by this point: one JSON handler on stdout, at the level
# `LOG_LEVEL` asks for. It replaces the handler the Lambda runtime installs, so
# nothing is printed twice. See `app/observability.py`.

# lifespan="off": there are no startup or shutdown hooks to run, and Mangum's
# lifespan support would add a per-invocation cost for nothing.
_asgi = Mangum(app, lifespan="off")


def handler(event: dict[str, Any] | None, context: Any) -> Any:  # noqa: ANN401
    """Route a Lambda event either to an ops action or to the ASGI application."""
    action = (event or {}).get("action")
    if action:
        return run_ops(str(action), event or {})
    return _asgi(event, context)
