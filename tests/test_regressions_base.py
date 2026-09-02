"""Regression tests for Adapter.run failure handling (CHANGELOG 2026-09-02, resolve entry).

When normalize() or upsert() raises, the run is recorded as an error and the offending payload
(or the whole batch) is snapshotted as JSON, so REPAIR_NEEDED.md has something to reproduce
against even when the failure is not an HTTP one.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

from sqlalchemy import select

from integra.config import SourceConfig
from integra.db.models import SourceRun
from integra.db.upsert import UpsertCounts
from integra.records import LicenseRecord, NormalizedRecord
from integra.sources.base import Adapter, RawRecord, RunStats

PAYLOAD: dict[str, Any] = {"name": "KAHALE, MALIA K", "license": "X-1", "detail": {"status": "?"}}


class OneRecordAdapter(Adapter):
    """Minimal concrete adapter: one raw record; normalize or upsert fails on demand."""

    name: ClassVar[str] = "fake_source"

    def __init__(self, *, fail_in: str | None = None, **kwargs: Any) -> None:
        super().__init__(config=SourceConfig(name=self.name), **kwargs)
        self.fail_in = fail_in

    def fetch(self, *, state: str | None = None, limit: int | None = None) -> Iterator[RawRecord]:
        yield RawRecord(source=self.name, key="X-1", payload=PAYLOAD, fetched_at=datetime.now(UTC))

    def normalize(self, raw: RawRecord) -> NormalizedRecord | None:
        if self.fail_in == "normalize":
            raise ValueError(f"cannot parse {raw.key}")
        return LicenseRecord(
            source=self.name, state="WA", license_number=raw.key, source_json=raw.payload
        )

    def upsert(self, records: Iterable[NormalizedRecord]) -> UpsertCounts:
        if self.fail_in == "upsert":
            raise RuntimeError("database says no")
        return UpsertCounts(inserted=len(list(records)))


def _snapshot(stats: RunStats) -> Any:
    assert stats.snapshot_path is not None
    path = Path(stats.snapshot_path)
    assert path.suffix == ".json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_normalize_failure_is_an_error_run_with_the_payload_snapshotted(
    settings, session_factory
) -> None:
    adapter = OneRecordAdapter(
        fail_in="normalize", settings=settings, session_factory=session_factory
    )
    stats = adapter.run()
    assert stats.status == "error"
    assert stats.error == "ValueError: cannot parse X-1"
    assert Path(stats.snapshot_path).parent == settings.snapshot_dir("fake_source")
    assert _snapshot(stats) == PAYLOAD
    assert (stats.record_count, stats.new_count) == (1, 0)
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
    assert run.source == "fake_source" and run.status == "error"
    assert run.snapshot_path == stats.snapshot_path
    assert run.traceback and "ValueError" in run.traceback


def test_upsert_failure_snapshots_the_whole_batch(settings, session_factory) -> None:
    adapter = OneRecordAdapter(fail_in="upsert", settings=settings, session_factory=session_factory)
    stats = adapter.run()
    assert stats.status == "error"
    assert stats.error == "RuntimeError: database says no"
    batch = _snapshot(stats)
    assert isinstance(batch, list) and len(batch) == 1
    assert batch[0]["license_number"] == "X-1"
    assert batch[0]["state"] == "WA"
    assert batch[0]["source_json"] == PAYLOAD
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
    assert run.status == "error" and run.snapshot_path == stats.snapshot_path


def test_healthy_adapter_still_finishes_ok_without_a_snapshot(settings, session_factory) -> None:
    stats = OneRecordAdapter(settings=settings, session_factory=session_factory).run()
    assert stats.status == "ok" and stats.snapshot_path is None
    assert (stats.record_count, stats.new_count) == (1, 1)
