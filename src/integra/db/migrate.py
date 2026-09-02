"""Programmatic alembic entry points used by the CLI and tests."""

from __future__ import annotations

from alembic import command
from alembic.config import Config

from integra.config import REPO_ROOT


def alembic_config(database_url: str | None = None) -> Config:
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "src" / "integra" / "db" / "migrations"))
    if database_url:
        cfg.attributes["database_url"] = database_url
    return cfg


def upgrade_head(database_url: str | None = None) -> str:
    """Apply all migrations. Returns the head revision id."""
    from alembic.script import ScriptDirectory

    cfg = alembic_config(database_url)
    command.upgrade(cfg, "head")
    return ScriptDirectory.from_config(cfg).get_current_head() or "none"
