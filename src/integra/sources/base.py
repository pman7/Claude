"""Adapter contract (CLAUDE.md section 6.1).

Every adapter: fetch raw records (cached on disk), normalize each into a pydantic record,
upsert idempotently, and record a source_runs row on every invocation, success or failure.
"""

from __future__ import annotations

import importlib
import json
import traceback
from abc import ABC, abstractmethod
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from typing import Any, ClassVar

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings, SourceConfig, get_settings, source_config
from integra.db.models import SourceRun
from integra.db.session import get_session_factory
from integra.db.upsert import UpsertCounts
from integra.http import HTTPFailure, write_snapshot
from integra.logging import get_logger
from integra.records import NormalizedRecord

ADAPTERS: dict[str, str] = {
    "nppes": "integra.sources.nppes:NppesAdapter",
    "wa_doh": "integra.sources.wa_doh:WaDohAdapter",
    "hi_dcca": "integra.sources.hi_dcca:HiDccaAdapter",
}

UPSERT_BATCH = 500


class RawRecord(BaseModel):
    source: str
    key: str
    payload: dict[str, Any]
    fetched_at: datetime
    from_cache: bool = False
    cache_path: str | None = None


class RunStats(BaseModel):
    source: str
    started_at: datetime
    finished_at: datetime | None = None
    status: str = "running"
    record_count: int = 0
    new_count: int = 0
    updated_count: int = 0
    unchanged_count: int = 0
    skipped_count: int = 0
    requests: int = 0  # live HTTP requests / browser actions (cache misses)
    cache_hits: int = 0  # responses served from the same-day raw cache
    error: str | None = None
    traceback: str | None = None
    snapshot_path: str | None = None
    notes: list[str] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)
    run_id: int | None = None

    @property
    def elapsed_seconds(self) -> float:
        end = self.finished_at or datetime.now(UTC)
        return (end - self.started_at).total_seconds()

    def add_counts(self, counts: UpsertCounts) -> None:
        self.new_count += counts.inserted
        self.updated_count += counts.updated
        self.unchanged_count += counts.unchanged

    def summary(self) -> str:
        """One paragraph: rows touched, new rows, errors, elapsed time."""
        parts = [
            f"{self.source}: status {self.status}.",
            f"{self.record_count:,} records fetched"
            f" ({self.requests:,} requests, {self.cache_hits:,} served from cache),",
            f"{self.new_count:,} new, {self.updated_count:,} updated,"
            f" {self.unchanged_count:,} unchanged, {self.skipped_count:,} skipped.",
        ]
        if self.error:
            parts.append(f"Error: {self.error}")
        if self.snapshot_path:
            parts.append(f"Snapshot: {self.snapshot_path}")
        if self.notes:
            parts.append("Notes: " + "; ".join(self.notes) + ".")
        parts.append(f"Elapsed {self.elapsed_seconds:.1f}s.")
        return " ".join(parts)


class Adapter(ABC):
    name: ClassVar[str] = "base"

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        config: SourceConfig | None = None,
        session_factory: sessionmaker[Session] | None = None,
        force: bool = False,
    ) -> None:
        self.settings = settings or get_settings()
        self.config = config or source_config(self.name)
        self.session_factory = session_factory or get_session_factory(self.settings.database_url)
        self.force = force
        self.log = get_logger(source=self.name)
        self.stats = RunStats(source=self.name, started_at=datetime.now(UTC))

    # -- contract ----------------------------------------------------------------------------
    @abstractmethod
    def fetch(self, *, state: str | None = None, limit: int | None = None) -> Iterator[RawRecord]:
        """Yield raw records. Every HTTP response must go through PoliteClient (cache + limits)."""

    @abstractmethod
    def normalize(self, raw: RawRecord) -> NormalizedRecord | None:
        """Turn one raw record into a normalized record, or None to skip it."""

    @abstractmethod
    def upsert(self, records: Iterable[NormalizedRecord]) -> UpsertCounts:
        """Idempotent upsert of a batch. Must commit."""

    def after_run(self) -> None:
        """Hook for post-processing (for example license matching). Runs inside run()."""
        return None

    # -- orchestration -----------------------------------------------------------------------
    def run(self, *, state: str | None = None, limit: int | None = None) -> RunStats:
        self.stats = RunStats(source=self.name, started_at=datetime.now(UTC))
        self.stats.params = {"state": state, "limit": limit, "force": self.force}
        self.stats.run_id = self._open_run()
        self.log.info("run.start", state=state, limit=limit, force=self.force)
        batch: list[NormalizedRecord] = []
        try:
            for raw in self.fetch(state=state, limit=limit):
                self.stats.record_count += 1
                try:
                    record = self.normalize(raw)
                except Exception:
                    self._snapshot_json(raw.payload, f"normalize failed for {raw.key}")
                    raise
                if record is None:
                    self.stats.skipped_count += 1
                else:
                    batch.append(record)
                if len(batch) >= UPSERT_BATCH:
                    self._upsert_batch(batch)
                    batch = []
                if limit and self.stats.record_count >= limit:
                    self.stats.notes.append(f"stopped at --limit {limit}")
                    break
            if batch:
                self._upsert_batch(batch)
            self.after_run()
            if self.stats.status == "running":
                self.stats.status = "ok"
        except Exception as exc:  # noqa: BLE001 - every failure must land in source_runs
            self.stats.status = "error"
            self.stats.error = f"{type(exc).__name__}: {exc}"
            self.stats.traceback = traceback.format_exc()
            if isinstance(exc, HTTPFailure) and exc.snapshot_path:
                self.stats.snapshot_path = str(exc.snapshot_path)
            self.log.error("run.error", error=self.stats.error, snapshot=self.stats.snapshot_path)
        finally:
            self.stats.finished_at = datetime.now(UTC)
            self._close_run()
            self.log.info(
                "run.finish",
                status=self.stats.status,
                records=self.stats.record_count,
                new=self.stats.new_count,
                updated=self.stats.updated_count,
                elapsed=round(self.stats.elapsed_seconds, 1),
            )
        return self.stats

    def _upsert_batch(self, batch: list[NormalizedRecord]) -> None:
        try:
            self.stats.add_counts(self.upsert(batch))
        except Exception:
            self._snapshot_json(
                [r.model_dump(mode="json") for r in batch],
                f"upsert failed for {len(batch)} records",
            )
            raise

    def _snapshot_json(self, payload: Any, reason: str) -> None:
        """Save the offending record(s) so REPAIR_NEEDED.md has something to reproduce against."""
        try:
            path = write_snapshot(
                self.settings, self.name, json.dumps(payload, default=str, indent=1), ".json"
            )
        except Exception as exc:  # noqa: BLE001 - never mask the original failure
            self.log.warning("snapshot.failed", error=str(exc))
            return
        if not self.stats.snapshot_path:
            self.stats.snapshot_path = str(path)
        self.log.error("run.record_failure", reason=reason, snapshot=str(path))

    def _open_run(self) -> int | None:
        try:
            with self.session_factory() as session:
                row = SourceRun(source=self.name, status="running", params=self.stats.params)
                session.add(row)
                session.commit()
                return row.id
        except Exception as exc:  # noqa: BLE001
            self.log.warning("source_runs.open_failed", error=str(exc))
            return None

    def _close_run(self) -> None:
        if self.stats.run_id is None:
            return
        try:
            with self.session_factory() as session:
                row = session.get(SourceRun, self.stats.run_id)
                if row is None:
                    return
                row.finished_at = self.stats.finished_at
                row.status = self.stats.status
                row.record_count = self.stats.record_count
                row.new_count = self.stats.new_count
                row.updated_count = self.stats.updated_count
                row.error = self.stats.error
                row.traceback = self.stats.traceback
                row.snapshot_path = self.stats.snapshot_path
                row.notes = {
                    "notes": self.stats.notes,
                    "unchanged_count": self.stats.unchanged_count,
                    "skipped_count": self.stats.skipped_count,
                    "requests": self.stats.requests,
                    "cache_hits": self.stats.cache_hits,
                }
                session.commit()
        except Exception as exc:  # noqa: BLE001
            self.log.warning("source_runs.close_failed", error=str(exc))


def get_adapter_class(name: str) -> type[Adapter]:
    try:
        path = ADAPTERS[name]
    except KeyError as exc:
        raise KeyError(f"unknown source {name!r}; known: {sorted(ADAPTERS)}") from exc
    module_name, class_name = path.split(":")
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def get_adapter(name: str, **kwargs: Any) -> Adapter:
    return get_adapter_class(name)(**kwargs)
