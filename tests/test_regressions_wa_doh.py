"""Regression tests for the 2026-09-02 wa_doh pagination guards (see CHANGELOG.md): a Socrata
endpoint that ignores $offset (the same page forever) and a runaway page count both stop the
run with a snapshot instead of looping or silently duplicating rows.

FakeSocrata and the fixtures come from tests/test_wa_doh.py; no network.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs

import httpx
from sqlalchemy import select

from integra.db.models import License, SourceRun
from integra.sources.wa_doh import WaDohAdapter
from tests.test_wa_doh import CONFIG, METADATA_PATH, SAMPLE, FakeSocrata


class OffsetBlindSocrata(FakeSocrata):
    """Serves the first page for every $offset, as a broken SoQL endpoint would."""

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == METADATA_PATH:
            return httpx.Response(200, json=self.metadata)
        limit = int(parse_qs(request.url.query.decode())["$limit"][0])
        return httpx.Response(200, json=self.rows[:limit])


class EndlessSocrata(FakeSocrata):
    """A full page of unique rows at every $offset: pagination never reaches a short page."""

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == METADATA_PATH:
            return httpx.Response(200, json=self.metadata)
        params = parse_qs(request.url.query.decode())
        limit = int(params["$limit"][0])
        offset = int(params.get("$offset", ["0"])[0])
        rows = [
            {**SAMPLE[0], "credentialnumber": f"DENT.DE.{offset + i:08d}"} for i in range(limit)
        ]
        return httpx.Response(200, json=rows)


def _adapter(settings, fake: FakeSocrata, session_factory, **extra) -> WaDohAdapter:
    config = CONFIG.model_copy(update={"extra": {**CONFIG.extra, **extra}})
    return WaDohAdapter(
        settings=settings,
        config=config,
        transport=fake.transport(),
        session_factory=session_factory,
    )


def test_repeated_page_fails_the_run_with_a_snapshot(settings, session_factory) -> None:
    fake = OffsetBlindSocrata(SAMPLE)
    stats = _adapter(settings, fake, session_factory, page_size=5).run()
    assert stats.status == "error"
    assert "$offset" in stats.error
    assert stats.snapshot_path is not None
    assert Path(stats.snapshot_path).parent == settings.snapshot_dir("wa_doh")
    assert [p["$offset"] for p in fake.row_params()] == ["0", "5"]  # stopped on the first repeat
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "error" and "$offset" in run.error
        assert session.execute(select(License)).first() is None  # nothing half-written


def test_max_rows_guard_stops_a_runaway_pagination(settings, session_factory) -> None:
    fake = EndlessSocrata([])
    stats = _adapter(settings, fake, session_factory, page_size=5, max_rows=5).run()
    assert stats.status == "error"
    assert "max_rows" in stats.error
    assert stats.snapshot_path is not None
    assert [p["$offset"] for p in fake.row_params()] == ["0", "5"]
    with session_factory() as session:
        assert session.execute(select(License)).first() is None
