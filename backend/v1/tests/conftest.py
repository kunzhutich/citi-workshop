"""Shared pytest fixtures."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import reset_engine
from app.main import create_app


@pytest.fixture(autouse=True)
def _clean_settings_cache() -> Generator[None]:
    """Drop cached settings and the engine around every test.

    `get_settings` is cached for the life of a warm Lambda container, so tests
    that change environment variables must clear it or they leak into each
    other.
    """
    get_settings.cache_clear()
    reset_engine()
    yield
    get_settings.cache_clear()
    reset_engine()


@pytest.fixture
def client() -> Generator[TestClient]:
    """Return a test client for a freshly built application."""
    with TestClient(create_app()) as test_client:
        yield test_client
