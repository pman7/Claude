"""Shared fixtures. Database tests run against TEST_DATABASE_URL and skip when it is unreachable."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings
from integra.db.models import Base

FIXTURES = Path(__file__).parent / "fixtures"


def _ensure_database(url: str) -> bool:
    parsed = make_url(url)
    maintenance = parsed.set(database="postgres")
    try:
        engine = create_engine(maintenance, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": parsed.database}
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{parsed.database}"'))
        engine.dispose()
        return True
    except OperationalError:
        return False


@pytest.fixture(scope="session")
def db_url() -> str:
    url = Settings().test_database_url
    if not _ensure_database(url):
        pytest.skip("test database unavailable; set TEST_DATABASE_URL to a reachable Postgres")
    engine = create_engine(url)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    engine.dispose()
    return url


@pytest.fixture
def session_factory(db_url: str) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def settings(tmp_path: Path, db_url_or_none: str | None) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        exports_dir=tmp_path / "exports",
        database_url=db_url_or_none or "postgresql+psycopg://invalid@localhost:1/none",
        _env_file=None,
    )


@pytest.fixture
def db_url_or_none(request: pytest.FixtureRequest) -> str | None:
    """Settings for pure unit tests must not require Postgres."""
    if "session_factory" in request.fixturenames or "db_url" in request.fixturenames:
        return request.getfixturevalue("db_url")
    return None


def load_fixture(*parts: str) -> str:
    return (FIXTURES.joinpath(*parts)).read_text(encoding="utf-8")
