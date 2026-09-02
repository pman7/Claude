"""Regression tests for the 2026-09-02 hi_dcca fixes (see CHANGELOG.md): an all-empty window
fails with a snapshot instead of finishing ok, an unrecognized page after hits marks the run
partial, a batch_size change never rewrites rows, and the browser only accepts an unchanged
results area when it shows the submitted numbers.

FakeBrowser and make_adapter come from tests/test_hi_dcca.py; no browser is launched.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import select

from integra.db.models import License, SourceRun
from integra.sources.hi_dcca import RUN_ONLY_KEYS
from integra.sources.hi_dcca_browser import MyPvlBrowser
from tests.test_hi_dcca import FORM_ONLY_HTML, NO_RESULTS_HTML, FakeBrowser, make_adapter


class FlakyBrowser(FakeBrowser):
    """Answers one batch with an unrecognized page (form only: no table, no message)."""

    def __init__(self, broken_batch_start: str) -> None:
        super().__init__()
        self.broken_batch_start = broken_batch_start

    def search_license_numbers(self, numbers: Sequence[str]) -> str:
        if numbers[0] == self.broken_batch_start:
            self.searches.append(list(numbers))
            return FORM_ONLY_HTML
        return super().search_license_numbers(numbers)


def test_no_results_on_every_page_fails_the_run(settings, session_factory) -> None:
    fake = FakeBrowser(page_html=NO_RESULTS_HTML)
    stats = make_adapter(settings, fake, session_factory=session_factory).run()
    assert stats.status == "error"
    assert "no dentist rows" in stats.error
    assert stats.snapshot_path is not None
    assert Path(stats.snapshot_path).read_text(encoding="utf-8") == NO_RESULTS_HTML
    assert len(fake.searches) == 6  # the whole DT-1..DT-60 window in batches of 10
    assert fake.closed == 1
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "error" and run.snapshot_path == stats.snapshot_path
        assert session.execute(select(License)).first() is None


def test_unrecognized_page_after_hits_marks_the_run_partial(settings, session_factory) -> None:
    fake = FlakyBrowser("DT-11")
    stats = make_adapter(settings, fake, session_factory=session_factory).run()
    assert stats.status == "partial"
    assert any("unrecognized results page for DT-11..DT-20" in n for n in stats.notes)
    assert any("1 unrecognized pages skipped" in n for n in stats.notes)
    assert stats.error is None and stats.snapshot_path is None
    assert stats.record_count == 2  # DT-3 before and DT-25 after the bad page
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        numbers = (
            session.execute(select(License.license_number).order_by(License.license_number))
            .scalars()
            .all()
        )
    assert run.status == "partial"
    assert numbers == ["DT-25", "DT-3"]


def test_changing_batch_size_does_not_rewrite_rows(settings, session_factory) -> None:
    first = make_adapter(
        settings,
        FakeBrowser(),
        session_factory=session_factory,
        batch_size=5,
        stop_after_empty_batches=20,
    ).run()
    assert first.status == "ok", first.error
    assert (first.new_count, first.updated_count) == (2, 0)

    second = make_adapter(
        settings,
        FakeBrowser(),
        session_factory=session_factory,
        batch_size=10,
        stop_after_empty_batches=20,
        force=True,
    ).run()
    assert second.status == "ok", second.error
    assert (second.new_count, second.updated_count, second.unchanged_count) == (0, 0, 2)
    with session_factory() as session:
        licenses = session.execute(select(License)).scalars().all()
    assert len(licenses) == 2
    for lic in licenses:
        assert not RUN_ONLY_KEYS & set(lic.source_json)
        assert lic.last_seen > lic.updated_at  # the second run touched last_seen only


def test_signature_shows_accepts_a_no_results_message() -> None:
    assert MyPvlBrowser._signature_shows("message:No records found.", ["DT-21", "DT-25"]) is True


def test_signature_shows_accepts_a_table_with_a_submitted_number() -> None:
    signature = "table:Name License License Type Location\nNoa Kealoha Akana DT-25 DENTIST TEMP"
    assert MyPvlBrowser._signature_shows(signature, ["DT-21", "DT-25"]) is True


def test_signature_shows_rejects_a_table_from_the_previous_batch() -> None:
    signature = "table:Name License License Type Location\nKAHALE, MALIA K DDS DT-3 DENTIST"
    assert MyPvlBrowser._signature_shows(signature, ["DT-21", "DT-25"]) is False


def test_signature_shows_accepts_anything_when_nothing_is_expected() -> None:
    assert MyPvlBrowser._signature_shows("table:stale DT-3", []) is True
