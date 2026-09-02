"""CLI contract: every command prints a one-paragraph summary and exits with a meaningful code.

No database or network: adapters and resolution are replaced with fakes through monkeypatch.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from typer.testing import CliRunner

import integra.resolve.practices as practices
import integra.sources as sources
from integra.cli import app
from integra.resolve.practices import ResolveStats
from integra.sources.base import RunStats

runner = CliRunner()


class FakeAdapter:
    """Records how the CLI called it and returns a pre-built RunStats."""

    calls: list[dict[str, Any]] = []

    def __init__(self, stats: RunStats, **kwargs: Any) -> None:
        self.stats = stats
        self.kwargs = kwargs

    def run(self, *, state: str | None = None, limit: int | None = None) -> RunStats:
        FakeAdapter.calls.append({"state": state, "limit": limit, **self.kwargs})
        return self.stats


def _stats(status: str, **fields: Any) -> RunStats:
    return RunStats(source="nppes", started_at=datetime.now(UTC), status=status, **fields)


@pytest.fixture
def fake_adapter(monkeypatch: pytest.MonkeyPatch):
    FakeAdapter.calls = []

    def install(stats: RunStats) -> None:
        monkeypatch.setattr(
            sources, "get_adapter", lambda name, **kw: FakeAdapter(stats, name=name, **kw)
        )

    return install


def test_help_lists_phase_1_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("migrate", "pull", "resolve", "run-all"):
        assert command in result.output


def test_pull_unknown_source_is_a_one_line_error() -> None:
    result = runner.invoke(app, ["pull", "bogus"])
    assert result.exit_code == 2
    assert "unknown source 'bogus'" in result.output
    assert "Traceback" not in result.output


def test_pull_prints_summary_and_exits_1_on_error(fake_adapter) -> None:
    fake_adapter(_stats("error", error="HTTPFailure: transport error", snapshot_path="snap.html"))
    result = runner.invoke(app, ["pull", "nppes", "--state", "hi", "--limit", "5", "--force"])
    assert result.exit_code == 1
    assert "nppes: status error." in result.output
    assert "Error: HTTPFailure: transport error" in result.output
    assert "Snapshot: snap.html" in result.output
    assert "Traceback" not in result.output
    assert FakeAdapter.calls == [{"state": "HI", "limit": 5, "name": "nppes", "force": True}]


def test_pull_defaults_to_all_states_and_no_limit(fake_adapter) -> None:
    fake_adapter(_stats("ok", record_count=3, new_count=3))
    result = runner.invoke(app, ["pull", "wa_doh"])
    assert result.exit_code == 0
    assert "status ok" in result.output and "3 new" in result.output
    assert FakeAdapter.calls == [{"state": None, "limit": None, "name": "wa_doh", "force": False}]


def test_resolve_prints_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(practices, "run_resolve", lambda: ResolveStats(practices_created=2))
    result = runner.invoke(app, ["resolve"])
    assert result.exit_code == 0
    assert "resolve: 2 practices (2 created" in result.output


@pytest.mark.parametrize("command", ["signals", "score", "enrich", "verify", "export", "health"])
def test_later_phase_commands_say_so(command: str) -> None:
    result = runner.invoke(app, [command])
    assert result.exit_code == 2
    assert "not implemented yet" in result.output
