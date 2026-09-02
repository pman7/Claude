"""The alembic migrations must produce exactly the schema the models describe."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from integra.db.models import Base


def test_migrations_match_models(db_url):
    engine = create_engine(db_url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        tables = set(inspect(conn).get_table_names())
    engine.dispose()
    assert diff == [], diff
    assert {"providers", "practices", "licenses", "signals", "source_runs"} <= tables
