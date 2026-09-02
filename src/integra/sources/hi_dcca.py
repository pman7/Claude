"""Hawaii DCCA professional licensing adapter (CLAUDE.md 6.4).

data.hawaii.gov has no bulk licensing dataset, so the source is the MyPVL public license
search, a JavaScript app whose "License Number" tab takes comma-separated numbers. Strategy:
enumerate DT-<n> from license_number_start to license_number_end in batches of batch_size,
one submission at a time on a single page, sleeping to honour rate_limit_per_sec, and stop
after stop_after_empty_batches consecutive empty batches once past the last hit.

Hard rules 1 and 3: a CAPTCHA / Cloudflare / access-denied page stops the run with a snapshot
and is never retried; every results page is cached as data/raw/hi_dcca/<date>/batch_<first>_
<last>.html (detail pages as detail_<license>.html) so same-day re-runs never touch the
browser unless --force; the first results page of every live run is also snapshotted to
data/snapshots/hi_dcca/<timestamp>_first_results.html as a real fixture for parser repair.

Playwright lives in hi_dcca_browser.py, HTML parsing in hi_dcca_parse.py. Unknown stays None.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, ClassVar

from integra.db.models import License
from integra.db.upsert import UpsertCounts, upsert_rows
from integra.http import HTTPFailure, write_snapshot
from integra.normalize import clean_text, parse_date
from integra.records import LicenseRecord, NormalizedRecord
from integra.sources.base import Adapter, RawRecord
from integra.sources.hi_dcca_browser import BrowserPageError, LicenseSearchBrowser, MyPvlBrowser
from integra.sources.hi_dcca_parse import (
    ResultRow,
    city_from_location,
    filter_license_types,
    looks_like_challenge,
    looks_like_no_results,
    normalize_license_number,
    parse_detail_page,
    parse_results_table,
    split_name,
)

STATE = "HI"
FIRST_RESULTS_SUFFIX = "_first_results.html"
EMPTY_DETAIL: dict[str, Any] = {"status": None, "first_issue_date": None, "expiration_date": None}

# Business columns compared on upsert: every LicenseRecord field except the conflict key.
# provider_npi / match_* belong to license matching and are never touched here.
COMPARE_COLUMNS = [f for f in LicenseRecord.model_fields if f not in ("source", "license_number")]

BrowserFactory = Callable[[], LicenseSearchBrowser]


class HiDccaFailure(HTTPFailure):
    """The portal blocked us or served an unrecognized page. Carries the snapshot path."""


class HiDccaAdapter(Adapter):
    name: ClassVar[str] = "hi_dcca"

    def __init__(
        self,
        *,
        browser_factory: BrowserFactory | None = None,
        sleep: Callable[[float], None] = time.sleep,
        run_date: date | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._browser_factory = browser_factory or self._default_browser_factory
        self._sleep = sleep
        self._browser: LicenseSearchBrowser | None = None
        self._last_action_at: float | None = None
        self._first_live_page_seen = False
        cfg = self.config
        self.prefix = str(cfg.get("license_prefix", "DT"))
        self.number_start = int(cfg.get("license_number_start", 1))
        self.number_end = int(cfg.get("license_number_end", 1))
        self.batch_size = max(1, int(cfg.get("batch_size", 20)))
        self.stop_after_empty = max(1, int(cfg.get("stop_after_empty_batches", 25)))
        self.license_types = [str(t) for t in cfg.get("license_types", [])]
        self.active_statuses = frozenset(str(s).upper() for s in cfg.get("active_statuses", []))
        self.fetch_details = bool(cfg.get("fetch_details", True))
        rate = float(cfg.rate_limit_per_sec)
        self.min_interval = 1.0 / rate if rate > 0 else 0.0
        run_day = run_date or datetime.now(UTC).date()
        self.cache_dir: Path = self.settings.raw_dir(self.name) / run_day.isoformat()
        if not self.license_types:
            raise ValueError("hi_dcca needs license_types in config/sources.yaml")
        if not cfg.base_url:
            raise ValueError("hi_dcca.base_url missing in config/sources.yaml")

    def _default_browser_factory(self) -> LicenseSearchBrowser:
        """Real Playwright browser: User-Agent and proxy from settings, headless from config."""
        return MyPvlBrowser(
            str(self.config.base_url),
            user_agent=self.settings.user_agent,
            proxy_url=self.settings.proxy_url,
            headless=bool(self.config.get("headless", True)),
            timeout_sec=self.config.timeout_sec,
        )

    # -- file cache (PoliteClient is HTTP-only, so browser results get their own) --------------
    def _cache_path(self, name: str) -> Path:
        return self.cache_dir / name

    def _read_cache(self, path: Path) -> str | None:
        if self.force or not self.config.cache or not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def _write_cache(self, path: Path, html: str) -> None:
        if self.config.cache:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")

    # -- browser ---------------------------------------------------------------------------------
    def _throttle(self) -> None:
        now = time.monotonic()
        if self._last_action_at is not None and self.min_interval > 0:
            wait = self.min_interval - (now - self._last_action_at)
            if wait > 0:
                self._sleep(wait)
        self._last_action_at = time.monotonic()

    def _live(self, action: Callable[[LicenseSearchBrowser], str | None], what: str) -> str | None:
        """Run one browser action: open lazily, throttle, then stop dead on any challenge."""
        try:
            if self._browser is None:
                self.log.info("browser.open", url=self.config.base_url)
                browser = self._browser_factory()
                browser.open()
                self._browser = browser
            self._throttle()
            html = action(self._browser)
        except BrowserPageError as exc:
            raise self._blocked(exc.html, f"{type(exc).__name__} during {what}: {exc}") from exc
        if html is None:
            return None
        self.stats.requests += 1
        marker = looks_like_challenge(html)
        if marker:
            raise self._blocked(html, f"challenge marker {marker!r} during {what}")
        return html

    def _blocked(self, html: str, reason: str) -> HiDccaFailure:
        snapshot = write_snapshot(self.settings, self.name, html)
        self.log.error("blocked", reason=reason, snapshot=str(snapshot))
        return HiDccaFailure(
            f"stopped: {reason}. Not retried (hard rule 1). Snapshot: {snapshot}",
            url=str(self.config.base_url),
            snapshot_path=snapshot,
        )

    def _close_browser(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            finally:
                self._browser = None

    # -- fetch -----------------------------------------------------------------------------------
    def _batches(self) -> Iterator[list[str]]:
        numbers = [f"{self.prefix}-{n}" for n in range(self.number_start, self.number_end + 1)]
        for start in range(0, len(numbers), self.batch_size):
            yield numbers[start : start + self.batch_size]

    def _batch_html(self, numbers: list[str]) -> tuple[str, bool, Path]:
        path = self._cache_path(f"batch_{numbers[0]}_{numbers[-1]}.html")
        cached = self._read_cache(path)
        if cached is not None:
            self.stats.cache_hits += 1
            return cached, True, path
        what = f"search {numbers[0]}..{numbers[-1]}"
        html = self._live(lambda browser: browser.search_license_numbers(list(numbers)), what)
        assert html is not None  # search_license_numbers always returns the page HTML
        if not self._first_live_page_seen:
            self._first_live_page_seen = True
            snapshot = write_snapshot(self.settings, self.name, html, FIRST_RESULTS_SUFFIX)
            self.stats.notes.append(f"first results page snapshot: {snapshot}")
        self._write_cache(path, html)
        return html, False, path

    def _detail(self, row: ResultRow, key: str) -> tuple[dict[str, Any], bool]:
        """(detail fields, fetched). Only rows with a detail link are opened."""
        if not self.fetch_details or not row.detail_href:
            return dict(EMPTY_DETAIL), False
        path = self._cache_path(f"detail_{key}.html")
        html = self._read_cache(path)
        if html is not None:
            self.stats.cache_hits += 1
        else:
            html = self._live(lambda browser: browser.open_detail(row.as_dict()), f"detail {key}")
            if html is None:
                return dict(EMPTY_DETAIL), False
            self._write_cache(path, html)
        return parse_detail_page(html), True

    def fetch(self, *, state: str | None = None, limit: int | None = None) -> Iterator[RawRecord]:
        if state not in (None, STATE):
            self.stats.notes.append(f"hi_dcca covers {STATE} only; state {state} skipped")
            return
        yielded = hits = empty_streak = 0
        unrecognized: str | None = None
        try:
            for numbers in self._batches():
                html, from_cache, path = self._batch_html(numbers)
                rows = parse_results_table(html)
                if rows is None and not looks_like_no_results(html):
                    unrecognized = html
                    self.log.warning("page.unrecognized", batch=numbers[0])
                dentists = filter_license_types(rows or [], self.license_types)
                batch = f"{numbers[0]}..{numbers[-1]}"
                self.log.info("batch", batch=batch, dentists=len(dentists), cached=from_cache)
                if not dentists:
                    empty_streak += 1
                    if hits and empty_streak >= self.stop_after_empty:
                        self.stats.notes.append(
                            f"stopped after {empty_streak} empty batches past {numbers[0]}"
                        )
                        break
                    continue
                empty_streak = 0
                hits += len(dentists)
                for row in dentists:
                    key = normalize_license_number(row.license_number, self.prefix)
                    if not key:
                        self.stats.notes.append(f"row without license number in {numbers[0]}")
                        continue
                    detail, fetched = self._detail(row, key)
                    payload = {**row.as_dict(), **detail}
                    payload.update(detail_fetched=fetched, source_batch=batch)
                    yield RawRecord(
                        source=self.name,
                        key=key,
                        payload=payload,
                        fetched_at=datetime.now(UTC),
                        from_cache=from_cache,
                        cache_path=str(path),
                    )
                    yielded += 1
                    if limit and yielded >= limit:
                        return
        finally:
            self._close_browser()
        if hits == 0 and unrecognized is not None:
            raise self._blocked(
                unrecognized,
                "no results table and no no-results message on any page; "
                "the parser probably needs repair against the snapshot",
            )

    # -- normalize -------------------------------------------------------------------------------
    def normalize(self, raw: RawRecord) -> NormalizedRecord | None:
        payload = raw.payload
        first, middle, last = split_name(payload.get("name"))
        status = clean_text(payload.get("status"))
        return LicenseRecord(
            source=self.name,
            state=STATE,
            license_number=raw.key,
            credential_type=clean_text(payload.get("license_type")),
            status=status,
            is_active_status=bool(status) and status.upper() in self.active_statuses,
            first_name=first,
            middle_name=middle,
            last_name=last,
            city=city_from_location(payload.get("location")),
            first_issue_date=parse_date(payload.get("first_issue_date")),
            expiration_date=parse_date(payload.get("expiration_date")),
            source_json=dict(payload),
        )

    # -- upsert ----------------------------------------------------------------------------------
    def upsert(self, records: Iterable[NormalizedRecord]) -> UpsertCounts:
        rows: dict[str, dict[str, Any]] = {}
        for record in records:
            if isinstance(record, LicenseRecord):
                rows[record.license_number] = record.model_dump()  # last row per key wins
        with self.session_factory() as session:
            counts = upsert_rows(
                session,
                License.__table__,
                rows.values(),
                conflict_columns=["source", "license_number"],
                compare_columns=COMPARE_COLUMNS,
            )
            session.commit()
        return counts

    def after_run(self) -> None:
        from integra.resolve.licenses import match_licenses

        stats = match_licenses(self.session_factory, source=self.name, settings=self.settings)
        self.stats.notes.append(stats.summary())
