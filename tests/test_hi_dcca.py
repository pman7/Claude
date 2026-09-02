"""HI DCCA adapter tests. No browser is launched: a fake implements LicenseSearchBrowser and
serves HTML built from the hand-written SYNTHETIC_* fixtures under tests/fixtures/hi_dcca/."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from html import escape
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from integra.config import source_config
from integra.db.models import License, SourceRun
from integra.sources.base import RawRecord
from integra.sources.hi_dcca import FIRST_RESULTS_SUFFIX, HiDccaAdapter
from integra.sources.hi_dcca_parse import (
    city_from_location,
    filter_license_types,
    looks_like_challenge,
    looks_like_no_results,
    normalize_license_number,
    parse_detail_page,
    parse_results_table,
    split_name,
)
from tests.conftest import load_fixture

RESULTS_HTML = load_fixture("hi_dcca", "SYNTHETIC_results_table.html")
DETAIL_HTML = load_fixture("hi_dcca", "SYNTHETIC_detail.html")
CONFIG = source_config("hi_dcca")
RUN_DATE = date(2026, 9, 2)

CLOUDFLARE_HTML = """<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><div id="cf-challenge-running">Verify you are human by completing the action below.
<div class="cf-turnstile"></div></div></body></html>"""

NO_RESULTS_HTML = """<div id="app"><form><label>License Number</label>
<input type="text"><button>Submit</button></form><p class="msg">No records found.</p></div>"""

FORM_ONLY_HTML = """<div id="app"><form><label>License Number</label>
<input type="text"><button>Submit</button></form></div>"""

# Invented placeholder licensees keyed by the number the search receives.
LICENSEES: dict[str, dict[str, str]] = {
    "DT-3": {"name": "KAHALE, MALIA K", "type": "DENTIST", "location": "HONOLULU, HI"},
    "DT-7": {"name": "LEE, SUSAN", "type": "DENTAL HYGIENIST", "location": "HILO, HI"},
    "DT-25": {"name": "Noa Kealoha Akana", "type": "DENTIST TEMP", "location": "KAHULUI, HI"},
}


def render_results(numbers: Sequence[str], licensees: dict[str, dict[str, str]]) -> str:
    rows = []
    for number in numbers:
        row = licensees.get(number)
        if row is None:
            continue
        rows.append(
            "<tr><td><a href='/public-license-search/detail/{n}'>{name}</a></td>"
            "<td>{n}</td><td>{type}</td><td>{loc}</td></tr>".format(
                n=escape(number),
                name=escape(row["name"]),
                type=escape(row["type"]),
                loc=escape(row["location"]),
            )
        )
    if not rows:
        return NO_RESULTS_HTML
    return (
        "<div id='app'><table><thead><tr><th>Name</th><th>License</th>"
        "<th>License Type</th><th>Location</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></div>"
    )


class FakeBrowser:
    """Serves synthetic results for known licensees; records every call for assertions."""

    def __init__(
        self,
        licensees: dict[str, dict[str, str]] | None = None,
        *,
        page_html: str | None = None,
        detail_html: str | None = DETAIL_HTML,
    ) -> None:
        self.licensees = LICENSEES if licensees is None else licensees
        self.page_html = page_html
        self.detail_html = detail_html
        self.opened = 0
        self.closed = 0
        self.searches: list[list[str]] = []
        self.details: list[str] = []

    def open(self) -> None:
        self.opened += 1

    def close(self) -> None:
        self.closed += 1

    def search_license_numbers(self, numbers: Sequence[str]) -> str:
        self.searches.append(list(numbers))
        if self.page_html is not None:
            return self.page_html
        return render_results(numbers, self.licensees)

    def open_detail(self, row: dict[str, Any]) -> str | None:
        self.details.append(row["license_number"])
        return self.detail_html


class NoDb:
    def __call__(self):  # pragma: no cover - only reached on a wrong code path
        raise AssertionError("database must not be touched here")


def make_adapter(settings, fake: FakeBrowser, *, session_factory=None, **overrides):
    """Adapter with a small enumeration window so tests stay fast: DT-1..DT-60, batches of 10."""
    extra = {
        **CONFIG.extra,
        "license_number_start": 1,
        "license_number_end": 60,
        "batch_size": 10,
        "stop_after_empty_batches": 2,
    }
    extra.update({k: v for k, v in overrides.items() if k in extra or k == "fetch_details"})
    kwargs = {k: v for k, v in overrides.items() if k not in extra}
    config = CONFIG.model_copy(update={"extra": extra})
    sleeps: list[float] = []
    adapter = HiDccaAdapter(
        settings=settings,
        config=config,
        session_factory=session_factory or NoDb(),
        browser_factory=lambda: fake,
        sleep=sleeps.append,
        run_date=RUN_DATE,
        **kwargs,
    )
    adapter.test_sleeps = sleeps  # type: ignore[attr-defined]
    return adapter


def raw(payload: dict[str, Any], key: str = "DT-1") -> RawRecord:
    return RawRecord(source="hi_dcca", key=key, payload=payload, fetched_at=datetime.now(UTC))


# -- parser: results table --------------------------------------------------------------------


def test_results_table_is_found_by_header_and_rows_are_read():
    rows = parse_results_table(RESULTS_HTML)
    assert rows is not None
    assert [r.license_number for r in rows] == ["DT-1", "DT 2", "DH-3", "DT4", "DT-5"]
    first = rows[0]
    assert first.name == "KAHALE, MALIA K DDS"
    assert first.license_type == "DENTIST"
    assert first.location == "HONOLULU, HI"
    assert first.detail_href == "/public-license-search/detail/DT-1"
    assert rows[1].detail_href is None
    assert rows[4].location is None  # empty cell stays None, never invented


def test_dentist_rows_are_kept_and_hygienists_dropped():
    rows = parse_results_table(RESULTS_HTML) or []
    kept = filter_license_types(rows, CONFIG.get("license_types"))
    assert [r.license_number for r in kept] == ["DT-1", "DT 2", "DT4", "DT-5"]
    assert all(r.license_type.upper() != "DENTAL HYGIENIST" for r in kept)


def test_page_without_results_table_returns_none():
    assert parse_results_table(NO_RESULTS_HTML) is None
    assert parse_results_table(FORM_ONLY_HTML) is None
    assert looks_like_no_results(NO_RESULTS_HTML) is True
    assert looks_like_no_results(FORM_ONLY_HTML) is False


def test_table_without_the_expected_headers_is_ignored():
    html = "<table><tr><th>Foo</th><th>Bar</th></tr><tr><td>1</td><td>2</td></tr></table>"
    assert parse_results_table(html) is None


# -- parser: names, numbers, cities ------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw_name", "expected"),
    [
        ("KAHALE, MALIA K DDS", ("MALIA", "K", "KAHALE")),
        ("Noa Kealoha Akana", ("Noa", "Kealoha", "Akana")),
        ("LEE, SUSAN", ("SUSAN", None, "LEE")),
        ("O'NEIL-SANTOS, PATRICK", ("PATRICK", None, "O'NEIL-SANTOS")),
        ("Madonna", (None, None, "Madonna")),
        ("John Smith DDS", ("John", None, "Smith")),
        ("  ", (None, None, None)),
        (None, (None, None, None)),
    ],
)
def test_split_name_is_conservative(raw_name, expected):
    assert split_name(raw_name) == expected


@pytest.mark.parametrize(
    ("raw_number", "expected"),
    [
        ("DT-2878", "DT-2878"),
        ("DT1513", "DT-1513"),
        ("DT 939", "DT-939"),
        ("dt-0042", "DT-42"),
        (" DT-5 ", "DT-5"),
        ("DH-3", "DH-3"),  # other prefixes are kept verbatim (uppercased), not rewritten
        ("", None),
        (None, None),
    ],
)
def test_normalize_license_number(raw_number, expected):
    assert normalize_license_number(raw_number, "DT") == expected


@pytest.mark.parametrize(
    ("location", "expected"),
    [("HONOLULU, HI", "HONOLULU"), ("Kahului", "Kahului"), ("HI", None), ("", None), (None, None)],
)
def test_city_from_location(location, expected):
    assert city_from_location(location) == expected


# -- parser: detail page -------------------------------------------------------------------------


def test_detail_labels_are_extracted_from_dl_and_table():
    detail = parse_detail_page(DETAIL_HTML)
    assert detail == {
        "status": "ACTIVE",
        "first_issue_date": "2010-06-15",
        "expiration_date": "2027-12-31",
    }


def test_detail_missing_values_stay_none():
    assert parse_detail_page("<div><p>Nothing useful here</p></div>") == {
        "status": None,
        "first_issue_date": None,
        "expiration_date": None,
    }
    partial = (
        "<div><span>Status:</span><span>EXPIRED</span>"
        "<span>Issue Date:</span><span>n/a</span></div>"
    )
    assert parse_detail_page(partial) == {
        "status": "EXPIRED",
        "first_issue_date": None,  # unparseable date is not guessed
        "expiration_date": None,
    }


# -- challenge detection --------------------------------------------------------------------------


def test_challenge_detector_flags_cloudflare_pages_only():
    assert looks_like_challenge(CLOUDFLARE_HTML) == "verify you are human"  # first marker wins
    assert looks_like_challenge("<title>Just a moment...</title>") == "just a moment"
    assert looks_like_challenge("<html><body>Access Denied</body></html>") == "access denied"
    assert looks_like_challenge(RESULTS_HTML) is None
    assert looks_like_challenge(NO_RESULTS_HTML) is None


def test_challenge_page_stops_the_run_with_a_snapshot_and_no_retry(settings, session_factory):
    fake = FakeBrowser(page_html=CLOUDFLARE_HTML)
    stats = make_adapter(settings, fake, session_factory=session_factory).run()
    assert stats.status == "error"
    assert "challenge marker 'verify you are human'" in stats.error
    assert "hard rule 1" in stats.error
    assert len(fake.searches) == 1  # never retried through the challenge
    assert fake.closed == 1
    assert stats.snapshot_path is not None
    snapshot = Path(stats.snapshot_path)
    assert snapshot.parent == settings.snapshot_dir("hi_dcca")
    assert snapshot.read_text(encoding="utf-8") == CLOUDFLARE_HTML
    assert not any(settings.raw_dir("hi_dcca").rglob("batch_*.html"))  # nothing cached
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "error"
        assert run.snapshot_path == stats.snapshot_path
        assert session.execute(select(License)).first() is None


def test_unrecognized_pages_with_no_hits_fail_the_run(settings, session_factory):
    fake = FakeBrowser(page_html=FORM_ONLY_HTML)
    stats = make_adapter(settings, fake, session_factory=session_factory).run()
    assert stats.status == "error"
    assert "parser probably needs repair" in stats.error
    assert stats.snapshot_path is not None
    assert len(fake.searches) == 6  # the whole DT-1..DT-60 window was walked (no hit to stop on)


# -- batch enumeration and stop rule ------------------------------------------------------------


def test_batches_are_enumerated_and_the_run_stops_after_empty_batches(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake)
    records = list(adapter.fetch())
    assert [r.key for r in records] == ["DT-3", "DT-25"]  # the hygienist DT-7 is dropped
    # DT-1..10 (hit), 11..20 (empty), 21..30 (hit), 31..40 and 41..50 (empty) -> stop
    assert [b[0] for b in fake.searches] == ["DT-1", "DT-11", "DT-21", "DT-31", "DT-41"]
    assert fake.searches[0] == [f"DT-{n}" for n in range(1, 11)]
    assert fake.details == ["DT-3", "DT-25"]
    assert fake.opened == 1 and fake.closed == 1
    assert adapter.stats.requests == 7  # 5 searches + 2 detail pages
    assert adapter.stats.cache_hits == 0
    assert any("stopped after 2 empty batches past DT-41" in n for n in adapter.stats.notes)
    payload = records[0].payload
    assert payload["source_batch"] == "DT-1..DT-10"
    assert payload["detail_fetched"] is True
    assert payload["status"] == "ACTIVE"
    assert records[0].from_cache is False


def test_rate_limit_sleeps_between_browser_actions(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake)
    list(adapter.fetch())
    sleeps = adapter.test_sleeps
    assert len(sleeps) == 6  # 7 actions, one sleep between each consecutive pair
    interval = 1.0 / CONFIG.rate_limit_per_sec
    assert all(interval - 0.1 <= s <= interval for s in sleeps)


def test_limit_stops_after_n_records_and_closes_the_browser(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake)
    records = list(adapter.fetch(limit=1))
    assert [r.key for r in records] == ["DT-3"]
    assert len(fake.searches) == 1
    assert fake.closed == 1


def test_other_state_yields_nothing_and_never_opens_the_browser(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake)
    assert list(adapter.fetch(state="WA")) == []
    assert fake.opened == 0 and fake.searches == []
    assert adapter.stats.notes == ["hi_dcca covers HI only; state WA skipped"]


def test_rows_without_detail_links_are_not_opened(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake, fetch_details=False)
    records = list(adapter.fetch())
    assert fake.details == []
    assert records[0].payload["detail_fetched"] is False
    assert records[0].payload["status"] is None


# -- cache and snapshots ---------------------------------------------------------------------------


def test_second_run_reads_the_file_cache_instead_of_the_browser(settings):
    first_fake = FakeBrowser()
    first = make_adapter(settings, first_fake)
    first_records = list(first.fetch())
    cache_dir = settings.raw_dir("hi_dcca") / RUN_DATE.isoformat()
    assert {p.name for p in cache_dir.iterdir()} == {
        "batch_DT-1_DT-10.html",
        "batch_DT-11_DT-20.html",
        "batch_DT-21_DT-30.html",
        "batch_DT-31_DT-40.html",
        "batch_DT-41_DT-50.html",
        "detail_DT-3.html",
        "detail_DT-25.html",
    }

    second_fake = FakeBrowser()
    second = make_adapter(settings, second_fake)
    second_records = list(second.fetch())
    assert second_fake.opened == 0 and second_fake.searches == [] and second_fake.details == []
    assert second.stats.requests == 0 and second.stats.cache_hits == 7
    assert [r.key for r in second_records] == [r.key for r in first_records]
    assert all(r.from_cache for r in second_records)
    assert second_records[0].payload == first_records[0].payload
    assert Path(second_records[0].cache_path) == cache_dir / "batch_DT-1_DT-10.html"

    forced_fake = FakeBrowser()
    forced = make_adapter(settings, forced_fake, force=True)
    list(forced.fetch())
    assert len(forced_fake.searches) == 5 and forced.stats.cache_hits == 0


def test_first_results_page_of_a_live_run_is_snapshotted(settings):
    fake = FakeBrowser()
    adapter = make_adapter(settings, fake)
    list(adapter.fetch())
    snapshots = sorted(settings.snapshot_dir("hi_dcca").glob(f"*{FIRST_RESULTS_SUFFIX}"))
    assert len(snapshots) == 1
    assert snapshots[0].read_text(encoding="utf-8") == render_results(fake.searches[0], LICENSEES)
    assert any(str(snapshots[0]) in note for note in adapter.stats.notes)

    cached = make_adapter(settings, FakeBrowser())
    list(cached.fetch())  # fully cached: not a live run, so no new snapshot
    assert len(list(settings.snapshot_dir("hi_dcca").glob(f"*{FIRST_RESULTS_SUFFIX}"))) == 1


# -- normalization ---------------------------------------------------------------------------------


def test_normalize_active_dentist(settings):
    adapter = make_adapter(settings, FakeBrowser())
    payload = {
        "name": "KAHALE, MALIA K DDS",
        "license_number": "DT 1",
        "license_type": "DENTIST",
        "location": "HONOLULU, HI",
        "detail_href": "/public-license-search/detail/DT-1",
        "status": "Active",
        "first_issue_date": "2010-06-15",
        "expiration_date": "2027-12-31",
        "detail_fetched": True,
        "source_batch": "DT-1..DT-10",
    }
    record = adapter.normalize(raw(payload, key="DT-1"))
    assert record.source == "hi_dcca"
    assert record.state == "HI"
    assert record.license_number == "DT-1"
    assert record.credential_type == "DENTIST"
    assert record.status == "Active"
    assert record.is_active_status is True  # active_statuses compared case-insensitively
    assert (record.first_name, record.middle_name, record.last_name) == ("MALIA", "K", "KAHALE")
    assert record.city == "HONOLULU"
    assert record.first_issue_date == date(2010, 6, 15)
    assert record.expiration_date == date(2027, 12, 31)
    assert record.last_issue_date is None and record.ce_due_date is None
    assert record.source_json == payload


def test_normalize_without_detail_leaves_unknowns_null(settings):
    adapter = make_adapter(settings, FakeBrowser())
    payload = {
        "name": "Noa Kealoha Akana",
        "license_number": "DT-2",
        "license_type": "DENTIST TEMP",
        "location": "HI",
        "detail_href": None,
        "status": None,
        "first_issue_date": None,
        "expiration_date": None,
        "detail_fetched": False,
        "source_batch": "DT-1..DT-10",
    }
    record = adapter.normalize(raw(payload, key="DT-2"))
    assert record.status is None
    assert record.is_active_status is False
    assert record.city is None
    assert (record.first_name, record.middle_name, record.last_name) == ("Noa", "Kealoha", "Akana")
    assert record.first_issue_date is None and record.expiration_date is None


def test_inactive_status_is_not_active(settings):
    adapter = make_adapter(settings, FakeBrowser())
    record = adapter.normalize(raw({"name": "LEE, SUSAN", "status": "EXPIRED"}, key="DT-9"))
    assert record.status == "EXPIRED" and record.is_active_status is False


# -- database ------------------------------------------------------------------------------------


def test_run_is_idempotent_and_records_source_runs(settings, session_factory):
    first = make_adapter(settings, FakeBrowser(), session_factory=session_factory).run()
    assert first.status == "ok"
    assert first.record_count == 2
    assert (first.new_count, first.updated_count, first.unchanged_count) == (2, 0, 0)
    assert first.requests == 7 and first.cache_hits == 0
    assert any("license matching" in note for note in first.notes)

    second = make_adapter(settings, FakeBrowser(), session_factory=session_factory).run()
    assert second.status == "ok"
    assert (second.new_count, second.updated_count, second.unchanged_count) == (0, 0, 2)
    assert second.requests == 0 and second.cache_hits == 7

    with session_factory() as session:
        licenses = session.execute(select(License).order_by(License.license_number)).scalars().all()
        assert [lic.license_number for lic in licenses] == ["DT-25", "DT-3"]
        assert {lic.source for lic in licenses} == {"hi_dcca"}
        assert {lic.state for lic in licenses} == {"HI"}
        assert all(lic.is_active_status for lic in licenses)  # synthetic detail says ACTIVE
        assert all(lic.last_seen >= lic.updated_at for lic in licenses)
        kahale = next(lic for lic in licenses if lic.license_number == "DT-3")
        assert (kahale.first_name, kahale.last_name, kahale.city) == ("MALIA", "KAHALE", "HONOLULU")
        assert kahale.expiration_date == date(2027, 12, 31)
        assert kahale.source_json["source_batch"] == "DT-1..DT-10"

        runs = session.execute(select(SourceRun).order_by(SourceRun.id)).scalars().all()
        assert [r.status for r in runs] == ["ok", "ok"]
        assert [r.record_count for r in runs] == [2, 2]
        assert [r.new_count for r in runs] == [2, 0]
        assert runs[1].notes["cache_hits"] == 7


def test_status_change_updates_the_row(settings, session_factory):
    make_adapter(settings, FakeBrowser(), session_factory=session_factory).run()
    expired = DETAIL_HTML.replace("<dd>ACTIVE</dd>", "<dd>EXPIRED</dd>")
    stats = make_adapter(
        settings, FakeBrowser(detail_html=expired), session_factory=session_factory, force=True
    ).run()
    assert (stats.new_count, stats.updated_count, stats.unchanged_count) == (0, 2, 0)
    with session_factory() as session:
        row = session.execute(select(License).where(License.license_number == "DT-3")).scalar_one()
        assert row.status == "EXPIRED"
        assert row.is_active_status is False
