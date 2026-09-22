"""Database engine and session management.

One `Engine` is created per process. In Lambda that means one per warm
container, so its small connection pool is reused across invocations instead of
paying a new TLS handshake — and a fresh Aurora wake-up — on every request.
"""

from collections.abc import Generator
from typing import Any

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Return the process-wide SQLAlchemy engine, creating it on first use.

    Creating an engine does not open a connection, so this is safe to call even
    when the database is unreachable.
    """
    global _engine
    if _engine is None:
        settings = get_settings()
        connect_args: dict[str, Any] = {"connect_timeout": settings.postgres_connect_timeout}
        _engine = create_engine(
            settings.database_url,
            connect_args=connect_args,
            # A Lambda container handles one request at a time, so a single
            # pooled connection is all we need.
            pool_size=1,
            max_overflow=1,
            pool_recycle=300,
            # Aurora drops idle connections while it scales down; pre-ping
            # discards a dead connection instead of failing the request.
            pool_pre_ping=True,
        )
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Return the process-wide session factory, creating it on first use."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)
    return _session_factory


def get_db() -> Generator[Session]:
    """Yield a database session for the lifetime of one request.

    Used as a FastAPI dependency. The session is always closed, and the
    connection returned to the pool, even when the route raises.
    """
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def reset_engine() -> None:
    """Dispose of the engine and forget it, so the next call rebuilds it.

    Only used by tests that change the database settings mid-process.
    """
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
