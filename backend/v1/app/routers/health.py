"""Health endpoint.

Returns HTTP 200 even when a dependency is down, with `status: "degraded"` in
the body. The walking-skeleton status page needs to *render* the failure rather
than treat it as a transport error, and nothing in this stack (CloudFront sits
in front of a Lambda Function URL, not a load balancer) reacts to the status
code.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.health import HealthReport
from app.services.health import build_health_report

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthReport, summary="Service and database health")
def read_health(session: Annotated[Session, Depends(get_db)]) -> HealthReport:
    """Report whether the API is up and whether it can reach PostgreSQL."""
    return build_health_report(session)
