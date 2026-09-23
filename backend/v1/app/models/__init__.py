"""SQLAlchemy ORM models, one module per domain object.

Importing this package imports every model, which is what registers them on
``Base.metadata``. Alembic's ``env.py`` and the test fixtures rely on that, so
import from here rather than from the individual modules when you need the full
metadata.
"""

from app.models.base import Base
from app.models.building import Building
from app.models.category import Category
from app.models.engineer_profile import EngineerProfile
from app.models.event import IncidentEvent
from app.models.floor import Floor
from app.models.incident import Incident
from app.models.login_attempt import LoginAttempt
from app.models.note import IncidentNote
from app.models.notification import Notification
from app.models.refresh_token import RefreshToken
from app.models.seat import Seat
from app.models.user import User

__all__ = [
    "Base",
    "Building",
    "Category",
    "EngineerProfile",
    "Floor",
    "Incident",
    "IncidentEvent",
    "IncidentNote",
    "LoginAttempt",
    "Notification",
    "RefreshToken",
    "Seat",
    "User",
]
