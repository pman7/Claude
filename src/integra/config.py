"""Settings from .env and YAML config loaders.

Secrets live in .env only (hard rule 11). Never log a Settings object.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://integra:integra@localhost:5432/integra"
    test_database_url: str = "postgresql+psycopg://integra:integra@localhost:5432/integra_test"
    data_dir: Path = Path("data")
    exports_dir: Path = Path("exports")
    home_address: str = "35 148th Ave SE, Bellevue, WA 98007"
    user_agent: str = "IntegraDentalBot/1.0 (+https://integra.dental)"
    log_level: str = "INFO"
    proxy_url: str | None = None

    socrata_app_token: SecretStr | None = None
    google_places_api_key: SecretStr | None = None
    millionverifier_api_key: SecretStr | None = None
    zerobounce_api_key: SecretStr | None = None
    findymail_api_key: SecretStr | None = None
    prospeo_api_key: SecretStr | None = None
    anymailfinder_api_key: SecretStr | None = None
    hunter_api_key: SecretStr | None = None
    instantly_api_key: SecretStr | None = None

    def _abs(self, p: Path) -> Path:
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def data_root(self) -> Path:
        return self._abs(self.data_dir)

    def raw_dir(self, source: str) -> Path:
        return self.data_root / "raw" / source

    def snapshot_dir(self, source: str) -> Path:
        return self.data_root / "snapshots" / source

    @property
    def review_dir(self) -> Path:
        return self.data_root / "review"

    @property
    def suppression_dir(self) -> Path:
        return self.data_root / "suppression"

    @property
    def exports_root(self) -> Path:
        return self._abs(self.exports_dir)

    def secret(self, name: str) -> str | None:
        """Return a secret's plain value, or None when the key is not configured."""
        value = getattr(self, name)
        if value is None:
            return None
        text = value.get_secret_value().strip()
        return text or None


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def load_yaml(name: str) -> Any:
    path = CONFIG_DIR / name
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


class SourceConfig(BaseModel):
    name: str
    enabled: bool = True
    base_url: str | None = None
    rate_limit_per_sec: float = 1.0
    concurrency: int = 1
    timeout_sec: float = 30
    max_attempts: int = 5
    cache: bool = True
    extra: dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self.extra.get(key, default)


def source_config(name: str) -> SourceConfig:
    """Merge config/sources.yaml defaults with the named source block."""
    doc = load_yaml("sources.yaml")
    defaults = dict(doc.get("defaults") or {})
    block = dict((doc.get("sources") or {}).get(name) or {})
    if not block and name not in (doc.get("sources") or {}):
        raise KeyError(f"unknown source {name!r} in config/sources.yaml")
    merged = {**defaults, **block}
    known = set(SourceConfig.model_fields) - {"name", "extra"}
    fields = {k: v for k, v in merged.items() if k in known}
    extra = {k: v for k, v in merged.items() if k not in known}
    return SourceConfig(name=name, extra=extra, **fields)
