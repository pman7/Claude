"""Regression tests for the run-all CLI contract and the polite HTTP client's retry rules.

No database or network: adapters and resolution are fakes installed with monkeypatch; HTTP
goes through httpx.MockTransport via make_client from tests/test_http.py.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from email.utils import formatdate
from typing import Any

import httpx
import pytest
from typer.testing import CliRunner

import integra.config as config
import integra.resolve.practices as practices
import integra.sources as sources
from integra.cli import app
from integra.http import HTTPFailure
from integra.resolve.practices import ResolveStats
from integra.sources.base import RunStats
from tests.test_http import make_client

runner = CliRunner()


# -- run-all ----------------------------------------------------------------------------------


class CrashingAdapter:
    """Fails before the adapter's own error handling could record anything."""

    def run(self, *, state: str | None = None, limit: int | None = None) -> RunStats:
        raise RuntimeError("boom before source_runs")


class StatsAdapter:
    def __init__(self, stats: RunStats) -> None:
        self.stats = stats

    def run(self, *, state: str | None = None, limit: int | None = None) -> RunStats:
        return self.stats


def _stats(source: str, status: str, **fields: Any) -> RunStats:
    return RunStats(source=source, started_at=datetime.now(UTC), status=status, **fields)


def test_run_all_continues_past_a_crash_and_reports_every_source(monkeypatch) -> None:
    fakes = {
        "nppes": CrashingAdapter(),
        "wa_doh": StatsAdapter(_stats("wa_doh", "error", error="SchemaDriftError: column gone")),
        "hi_dcca": StatsAdapter(_stats("hi_dcca", "ok", record_count=2, new_count=2)),
    }
    built: list[str] = []

    def get_adapter(name: str, **kwargs: Any):
        built.append(name)
        return fakes[name]

    real_source_config = config.source_config
    monkeypatch.setattr(sources, "get_adapter", get_adapter)
    monkeypatch.setattr(
        config,
        "source_config",
        lambda name: real_source_config(name).model_copy(update={"enabled": name != "hi_dcca"}),
    )
    monkeypatch.setattr(practices, "run_resolve", lambda: ResolveStats())

    result = runner.invoke(app, ["run-all"])

    assert result.exit_code == 1
    expected_in_order = [
        "nppes: crashed outside the adapter: RuntimeError: boom before source_runs",
        "wa_doh: status error.",
        "Error: SchemaDriftError: column gone",
        "hi_dcca: disabled in config/sources.yaml.",
        "resolve: 0 practices",
        "run_all: 4 steps, 2 failed.",
    ]
    positions = [result.output.find(text) for text in expected_in_order]
    assert all(p >= 0 for p in positions), result.output
    assert positions == sorted(positions), result.output
    assert built == ["nppes", "wa_doh"]  # the disabled source is never built, let alone run
    assert "Traceback" not in result.output


# -- http retries -----------------------------------------------------------------------------


def _then_ok(first: httpx.Response | Exception, attempts: dict[str, int]):
    """A handler that answers the first request with `first`, then 200 for every other one."""

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            if isinstance(first, Exception):
                raise first
            return first
        return httpx.Response(200, json={"ok": True})

    return handler


def test_retry_after_http_date_is_honored(settings) -> None:
    attempts = {"n": 0}
    retry_at = formatdate(time.time() + 5, usegmt=True)
    throttled = httpx.Response(429, headers={"Retry-After": retry_at}, text="slow down")
    client, sleeps = make_client(
        settings, _then_ok(throttled, attempts), max_attempts=3, rate_limit_per_sec=0
    )
    body, _ = client.get_json("https://example.gov/dated")
    assert body == {"ok": True}
    assert attempts["n"] == 2
    assert len(sleeps) == 1
    assert 3 <= sleeps[0] <= 6


def test_retry_after_is_capped_at_two_minutes(settings) -> None:
    attempts = {"n": 0}
    throttled = httpx.Response(429, headers={"Retry-After": "600"}, text="slow down")
    client, sleeps = make_client(
        settings, _then_ok(throttled, attempts), max_attempts=3, rate_limit_per_sec=0
    )
    body, _ = client.get_json("https://example.gov/capped")
    assert body == {"ok": True}
    assert attempts["n"] == 2
    assert sleeps == [120.0]


def test_transport_errors_are_retried_until_a_response_arrives(settings) -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json={"ok": True})

    client, sleeps = make_client(settings, handler, max_attempts=3, rate_limit_per_sec=0)
    body, result = client.get_json("https://example.gov/flaky")
    assert body == {"ok": True}
    assert attempts["n"] == 3
    assert result.from_cache is False and result.cache_path is not None
    assert len(sleeps) == 2  # backoff between the three attempts, none after the last


def test_persistent_transport_error_fails_without_a_snapshot(settings) -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        raise httpx.ConnectError("connection refused", request=request)

    client, sleeps = make_client(settings, handler, max_attempts=3, rate_limit_per_sec=0)
    with pytest.raises(HTTPFailure) as info:
        client.get("https://example.gov/down")
    assert attempts["n"] == 3
    assert info.value.snapshot_path is None  # there was never a response to save
    assert info.value.status_code is None
    assert "transport error after 3 attempts" in str(info.value)
    assert len(sleeps) == 2
