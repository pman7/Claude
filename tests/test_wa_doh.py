"""WA DOH adapter tests. Everything runs from tests/fixtures/wa_doh via httpx.MockTransport."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from integra.config import source_config
from integra.db.models import License, SourceRun
from integra.sources.base import RawRecord
from integra.sources.wa_doh import FORBIDDEN_FIELDS, WaDohAdapter, soql_quote
from tests.conftest import load_fixture

METADATA = json.loads(load_fixture("wa_doh", "metadata_columns.json"))
SAMPLE = json.loads(load_fixture("wa_doh", "dentist_nonexpired_sample.json"))
CONFIG = source_config("wa_doh")
METADATA_PATH = httpx.URL(CONFIG.get("metadata_url")).path
ROWS_PATH = httpx.URL(CONFIG.base_url).path


class FakeSocrata:
    """Serves the metadata fixture and pages of `rows` the way the SoQL endpoint does."""

    def __init__(self, rows: list[dict], metadata: dict | None = None) -> None:
        self.rows = rows
        self.metadata = metadata or METADATA
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == METADATA_PATH:
            return httpx.Response(200, json=self.metadata)
        assert request.url.path == ROWS_PATH, request.url
        params = parse_qs(request.url.query.decode())
        limit = int(params["$limit"][0])
        offset = int(params.get("$offset", ["0"])[0])
        return httpx.Response(200, json=self.rows[offset : offset + limit])

    def row_params(self) -> list[dict[str, str]]:
        return [
            {k: v[0] for k, v in parse_qs(r.url.query.decode()).items()}
            for r in self.requests
            if r.url.path == ROWS_PATH
        ]


def make_adapter(settings, fake: FakeSocrata, *, page_size: int | None = None, **kw):
    config = CONFIG
    if page_size is not None:
        config = config.model_copy(update={"extra": {**CONFIG.extra, "page_size": page_size}})
    return WaDohAdapter(settings=settings, config=config, transport=fake.transport(), **kw)


class NoDb:
    """Stand-in session factory for pure fetch/normalize tests: any DB use is a bug."""

    def __call__(self):  # pragma: no cover - only reached on a wrong code path
        raise AssertionError("database must not be touched here")


def raw(row: dict) -> RawRecord:
    return RawRecord(
        source="wa_doh", key=row["credentialnumber"], payload=row, fetched_at=datetime.now(UTC)
    )


# -- request shape and hard rule 4 ------------------------------------------------------------


def test_soql_quote_doubles_single_quotes():
    assert soql_quote("O'Brien") == "'O''Brien'"


def test_select_and_where_come_from_config_and_never_request_birthyear(settings):
    fake = FakeSocrata(SAMPLE)
    adapter = make_adapter(settings, fake, session_factory=NoDb())
    records = list(adapter.fetch(state="WA", limit=None))
    assert len(records) == len(SAMPLE)
    assert adapter.stats.requests == 2  # metadata + one page
    assert fake.requests[0].url.path == METADATA_PATH  # metadata is checked first
    (params,) = fake.row_params()
    assert params["$select"].split(",") == CONFIG.get("business_fields")
    assert not FORBIDDEN_FIELDS & set(params["$select"].split(","))
    for credential_type in CONFIG.get("credential_types"):
        assert f"'{credential_type}'" in params["$where"]
    assert params["$where"].startswith("credentialtype in (")
    assert params["$order"] == "credentialnumber"
    assert params["$limit"] == str(CONFIG.get("page_size"))


def test_birthyear_returned_by_api_is_stripped_from_payload_cache_and_source_json(settings):
    leaky = [{**row, "birthyear": "1975"} for row in SAMPLE[:3]]
    fake = FakeSocrata(leaky)
    adapter = make_adapter(settings, fake, session_factory=NoDb())
    records = list(adapter.fetch())
    assert len(records) == 3
    for record in records:
        assert "birthyear" not in record.payload
        assert record.payload["credentialnumber"] == record.key
        normalized = adapter.normalize(record)
        assert "birthyear" not in normalized.source_json
        assert "birthyear" not in json.dumps(normalized.model_dump(mode="json"))
    assert records[0].cache_path is not None
    cached = json.loads(Path(records[0].cache_path).read_text(encoding="utf-8"))
    assert "birthyear" not in cached["body"]
    assert cached["scrubbed"] is True
    assert any("birthyear" in note for note in adapter.stats.notes)


def test_normalize_refuses_a_payload_with_a_non_business_field(settings):
    adapter = make_adapter(settings, FakeSocrata(SAMPLE), session_factory=NoDb())
    with pytest.raises(ValueError, match="birthyear"):
        adapter.normalize(raw({**SAMPLE[0], "birthyear": "1975"}))


def test_metadata_mismatch_fails_the_run_with_a_snapshot(settings, session_factory):
    mutated = {
        **METADATA,
        "columns": [c for c in METADATA["columns"] if c["fieldName"] != "actiontaken"],
    }
    fake = FakeSocrata(SAMPLE, metadata=mutated)
    adapter = make_adapter(settings, fake, session_factory=session_factory)
    stats = adapter.run()
    assert stats.status == "error"
    assert "actiontaken" in stats.error
    assert stats.snapshot_path is not None
    snapshot = json.loads(Path(stats.snapshot_path).read_text(encoding="utf-8"))
    assert snapshot["id"] == "qxh8-f4bd"
    assert not any(r.url.path == ROWS_PATH for r in fake.requests)  # no rows requested
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "error"
        assert run.snapshot_path == stats.snapshot_path
        assert "actiontaken" in run.error
        assert session.execute(select(License)).first() is None


def test_other_state_yields_nothing_and_makes_no_requests(settings):
    fake = FakeSocrata(SAMPLE)
    adapter = make_adapter(settings, fake, session_factory=NoDb())
    assert list(adapter.fetch(state="HI")) == []
    assert fake.requests == []
    assert adapter.stats.notes == ["wa_doh covers WA only; state HI skipped"]


# -- normalization ----------------------------------------------------------------------------


def by_number(number: str) -> dict:
    return next(r for r in SAMPLE if r["credentialnumber"] == number)


def test_normalize_active_row(settings):
    adapter = make_adapter(settings, FakeSocrata(SAMPLE), session_factory=NoDb())
    record = adapter.normalize(raw(by_number("DENT.DE.61307352")))
    assert record.source == "wa_doh"
    assert record.state == "WA"
    assert record.license_number == "DENT.DE.61307352"
    assert record.credential_type == "Dentist License"
    assert record.status == "Active"
    assert record.is_active_status is True
    assert (record.first_name, record.middle_name, record.last_name) == ("Ryan", "Garrett", "Gade")
    assert record.first_issue_date == date(2022, 5, 27)
    assert record.last_issue_date == date(2025, 9, 19)
    assert record.expiration_date == date(2026, 12, 4)
    assert record.ce_due_date == date(2028, 12, 4)
    assert record.action_taken == "No"
    assert record.city is None
    assert record.source_json == by_number("DENT.DE.61307352")
    assert set(record.source_json) <= set(CONFIG.get("business_fields"))


def test_normalize_closed_row_has_no_dates_and_blank_middle_name_is_null(settings):
    adapter = make_adapter(settings, FakeSocrata(SAMPLE), session_factory=NoDb())
    record = adapter.normalize(raw(by_number("DEFC.DF.61467617")))
    assert record.status == "Closed"
    assert record.is_active_status is False
    assert record.credential_type == "Dental Faculty License"
    assert record.last_name == "Lopez-Ibarra"
    assert record.middle_name is None
    assert (record.first_issue_date, record.last_issue_date) == (None, None)
    assert (record.expiration_date, record.ce_due_date) == (None, None)


def test_normalize_voluntary_surrender_row(settings):
    adapter = make_adapter(settings, FakeSocrata(SAMPLE), session_factory=NoDb())
    record = adapter.normalize(raw(by_number("DENT.DE.00001495")))
    assert record.status == "Voluntary Surrender"
    assert record.is_active_status is False
    assert record.action_taken == "Yes"
    assert record.first_issue_date == date(1947, 4, 21)
    assert record.expiration_date == date(2004, 4, 20)
    assert record.ce_due_date is None


def test_active_with_conditions_counts_as_active(settings):
    adapter = make_adapter(settings, FakeSocrata(SAMPLE), session_factory=NoDb())
    record = adapter.normalize(raw({**SAMPLE[0], "status": "Active With Conditions"}))
    assert record.is_active_status is True
    record = adapter.normalize(raw({**SAMPLE[0], "status": "Retired Active"}))
    assert record.is_active_status is False


# -- pagination -------------------------------------------------------------------------------


def test_pagination_walks_offsets_until_a_short_page(settings):
    fake = FakeSocrata(SAMPLE)  # 13 rows
    adapter = make_adapter(settings, fake, page_size=5, session_factory=NoDb())
    records = list(adapter.fetch())
    assert [r.key for r in records] == [r["credentialnumber"] for r in SAMPLE]
    pages = fake.row_params()
    assert [p["$offset"] for p in pages] == ["0", "5", "10"]
    assert all(p["$limit"] == "5" for p in pages)
    assert adapter.stats.requests == 4  # metadata + 3 pages
    assert adapter.stats.cache_hits == 0


def test_pagination_with_exact_multiple_fetches_one_empty_trailing_page(settings):
    fake = FakeSocrata(SAMPLE[:10])
    adapter = make_adapter(settings, fake, page_size=5, session_factory=NoDb())
    assert len(list(adapter.fetch())) == 10
    assert [p["$offset"] for p in fake.row_params()] == ["0", "5", "10"]


def test_limit_shrinks_the_page_size_for_smoke_runs(settings):
    fake = FakeSocrata(SAMPLE)
    adapter = make_adapter(settings, fake, session_factory=NoDb())
    records = []
    for record in adapter.fetch(limit=3):
        records.append(record)
        if len(records) == 3:
            break
    assert fake.row_params()[0]["$limit"] == "3"


# -- database ---------------------------------------------------------------------------------


def test_run_is_idempotent_and_records_source_runs(settings, session_factory):
    fake = FakeSocrata(SAMPLE)
    first = make_adapter(settings, fake, page_size=5, session_factory=session_factory).run()
    assert first.status == "ok"
    assert first.record_count == len(SAMPLE)
    assert (first.new_count, first.updated_count, first.unchanged_count) == (len(SAMPLE), 0, 0)
    assert first.requests == 4
    assert any("license matching" in note for note in first.notes)

    second = make_adapter(settings, fake, page_size=5, session_factory=session_factory).run()
    assert second.status == "ok"
    assert (second.new_count, second.updated_count, second.unchanged_count) == (0, 0, len(SAMPLE))
    assert second.requests == 0 and second.cache_hits == 4  # same day: served from raw cache

    with session_factory() as session:
        licenses = session.execute(select(License).order_by(License.license_number)).scalars().all()
        assert len(licenses) == len(SAMPLE)
        assert {lic.source for lic in licenses} == {"wa_doh"}
        assert {lic.state for lic in licenses} == {"WA"}
        active = [lic for lic in licenses if lic.is_active_status]
        assert len(active) == sum(r["status"] == "Active" for r in SAMPLE)
        assert all(lic.provider_npi is None and lic.match_method is None for lic in licenses)
        assert all(lic.last_seen >= lic.updated_at for lic in licenses)
        gade = next(lic for lic in licenses if lic.license_number == "DENT.DE.61307352")
        assert gade.expiration_date == date(2026, 12, 4)
        assert "birthyear" not in json.dumps(gade.source_json)

        runs = session.execute(select(SourceRun).order_by(SourceRun.id)).scalars().all()
        assert [r.status for r in runs] == ["ok", "ok"]
        assert [r.record_count for r in runs] == [len(SAMPLE)] * 2
        assert [r.new_count for r in runs] == [len(SAMPLE), 0]
        assert runs[0].finished_at is not None
        assert runs[1].notes["cache_hits"] == 4


def test_status_change_updates_the_row(settings, session_factory):
    make_adapter(settings, FakeSocrata(SAMPLE), session_factory=session_factory).run()
    changed = [dict(r) for r in SAMPLE]
    changed[0]["status"] = "Expired"
    stats = make_adapter(
        settings, FakeSocrata(changed), session_factory=session_factory, force=True
    ).run()
    assert (stats.new_count, stats.updated_count, stats.unchanged_count) == (0, 1, len(SAMPLE) - 1)
    with session_factory() as session:
        row = session.execute(
            select(License).where(License.license_number == SAMPLE[0]["credentialnumber"])
        ).scalar_one()
        assert row.status == "Expired"
        assert row.is_active_status is False


# -- app token --------------------------------------------------------------------------------


def test_app_token_header_sent_only_when_configured(settings):
    fake = FakeSocrata(SAMPLE)
    list(make_adapter(settings, fake, session_factory=NoDb()).fetch())
    assert all("x-app-token" not in r.headers for r in fake.requests)

    with_token = settings.model_copy(update={"socrata_app_token": SecretStr("test-token")})
    fake = FakeSocrata(SAMPLE)
    list(make_adapter(with_token, fake, session_factory=NoDb(), force=True).fetch())
    assert fake.requests and all(r.headers["x-app-token"] == "test-token" for r in fake.requests)
    assert all(r.headers["user-agent"].startswith("IntegraDentalBot") for r in fake.requests)
