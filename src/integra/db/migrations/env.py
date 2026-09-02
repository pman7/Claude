from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from integra.config import get_settings
from integra.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Precedence: explicit -x url=..., then Config.attributes["database_url"] (tests),
# then DATABASE_URL from .env. alembic.ini's value is only a fallback.
_x = context.get_x_argument(as_dictionary=True)
config.set_main_option(
    "sqlalchemy.url",
    _x.get("url") or config.attributes.get("database_url") or get_settings().database_url,
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
