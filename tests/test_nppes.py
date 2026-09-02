"""NPPES adapter tests. Everything runs from fixtures through httpx.MockTransport: no network."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text

from integra.config import Settings, SourceConfig, source_config
from integra.db.models import Organization, Provider, SourceRun
from integra.records import OrganizationRecord, ProviderRecord
from integra.sources import RawRecord, get_adapter
from integra.sources.base import get_adapter_class
from integra.sources.nppes import NppesAdapter
from tests.conftest import load_fixture

PageFn = Callable[[str, str, int, int], list[dict[str, Any]]]

FIXTURE_FILES = [
    "hi_npi1_dentist_limit3.json",
    "hi_npi2_dentist_limit2.json",
    "hi_968_prosthodontics_limit3.json",
    "hi_dentist_skip1200.json",
    "wa_oms_limit2.json",
    "wa_periodontics_limit2.json",
]

# Which fixture results the mock API returns for each (ZIP3 prefix, enumeration type).
FIXTURE_ROUTES: dict[tuple[str, str], list[str]] = {
    ("968", "NPI-1"): ["hi_npi1_dentist_limit3.json", "hi_968_prosthodontics_limit3.json"],
    ("968", "NPI-2"): ["hi_npi2_dentist_limit2.json"],
    ("967", "NPI-1"): ["hi_dentist_skip1200.json"],
}


def _fixture_results(name: str) -> list[dict[str, Any]]:
    return json.loads(load_fixture("nppes", name))["results"]


def _fixture_record(npi: str) -> dict[str, Any]:
    for name in FIXTURE_FILES:
        for result in _fixture_results(name):
            if result["number"] == npi:
                return result
    raise KeyError(npi)


def _raw(result: dict[str, Any]) -> RawRecord:
    return RawRecord(
        source="nppes", key=result["number"], payload=result, fetched_at=datetime.now(UTC)
    )


def _config(**extra: Any) -> SourceConfig:
    """Real config/sources.yaml block, no rate-limit sleeps, quick retries, optional overrides."""
    base = source_config("nppes")
    return SourceConfig(
        name="nppes",
        base_url=base.base_url,
        rate_limit_per_sec=0,
        timeout_sec=base.timeout_sec,
        max_attempts=2,
        extra={**base.extra, **extra},
    )


def _handler(pages: PageFn) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        assert request.url.host == "npiregistry.cms.hhs.gov"
        assert request.headers["user-agent"].startswith("IntegraDentalBot")
        assert params["version"] == "2.1"
        assert params["taxonomy_description"] == "Dentist"
        assert params["address_purpose"] == "LOCATION"
        assert params["postal_code"].endswith("*")
        prefix = params["postal_code"][:-1]
        results = pages(
            prefix, params["enumeration_type"], int(params["skip"]), int(params["limit"])
        )
        return httpx.Response(200, json={"result_count": len(results), "results": results})

    return handler


def _fixture_pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
    if skip:
        return []
    results: list[dict[str, Any]] = []
    for name in FIXTURE_ROUTES.get((prefix, entity_type), []):
        results.extend(_fixture_results(name))
    return results[:limit]


def _synthetic(npi: str, zip_code: str) -> dict[str, Any]:
    """Minimal NPI-1 result in the live response shape, for pagination tests."""
    return {
        "number": npi,
        "enumeration_type": "NPI-1",
        "basic": {"first_name": "TEST", "last_name": f"DENTIST{npi}", "status": "A"},
        "addresses": [
            {
                "address_purpose": "LOCATION",
                "address_1": f"{npi[-3:]} MAIN ST",
                "city": "HONOLULU",
                "state": "HI",
                "postal_code": zip_code,
                "telephone_number": "808-555-0100",
            }
        ],
        "taxonomies": [
            {"code": "1223G0001X", "desc": "Dentist, General Practice", "primary": True}
        ],
    }


def _synthetic_pages(dataset: list[dict[str, Any]]) -> PageFn:
    def pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
        matching = [
            r
            for r in dataset
            if r["enumeration_type"] == entity_type
            and r["addresses"][0]["postal_code"].startswith(prefix)
        ]
        return matching[skip : skip + limit]

    return pages


def _adapter(settings: Settings, pages: PageFn, config: SourceConfig | None = None, **kw: Any):
    return NppesAdapter(
        settings=settings,
        config=config or _config(),
        transport=httpx.MockTransport(_handler(pages)),
        sleep=lambda _: None,
        **kw,
    )


# -- registry ---------------------------------------------------------------------------------


def test_registry_resolves_nppes_adapter():
    assert get_adapter_class("nppes") is NppesAdapter
    assert NppesAdapter.name == "nppes"


# -- normalization from real fixture records --------------------------------------------------


def test_normalize_dana_adachi_general_practice(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1245799642")))
    assert isinstance(record, ProviderRecord)
    assert record.first_name == "DANA"
    assert record.last_name == "ADACHI"
    assert record.name_prefix == "Dr."
    assert record.name_suffix is None  # absent in the payload
    assert record.credential_text == "DDS"
    assert record.taxonomy_codes == ["390200000X", "1223G0001X"]
    assert record.primary_taxonomy == "1223G0001X"
    assert record.specialty == "gp"
    assert record.enumeration_date == date(2019, 3, 15)
    assert record.last_update_date == date(2021, 3, 22)
    assert record.deactivation_date is None
    assert record.nppes_status == "A"
    assert record.sole_proprietor is False
    assert record.practice_state == "HI"
    assert record.practice_city == "HONOLULU"
    assert record.practice_zip == "96813"
    assert record.practice_zip9 == "96813-3021"
    assert record.practice_address_line1 == "715 S KING ST STE 425"
    assert record.practice_address_raw == "715 S KING ST STE 425, HONOLULU, HI 96813-3021"
    assert record.practice_address_key == "715 S KING ST STE 425|96813"
    assert record.practice_phone_raw == "808-521-4421"
    assert record.practice_phone_e164 == "+18085214421"
    assert record.practice_fax_e164 is None
    assert record.mailing_state == "HI"
    assert record.mailing_zip == "96813-3021"
    assert record.source_json["number"] == "1245799642"


def test_normalize_skips_mailing_only_hawaii_match(settings):
    """Nura Abujbara has a Hawaii mailing address but practices in Florida."""
    adapter = _adapter(settings, _fixture_pages)
    list(adapter.fetch(state="HI", limit=1))  # narrows target_states to HI
    assert adapter.normalize(_raw(_fixture_record("1760113096"))) is None


def test_normalize_shane_byun_military_clinic(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1811413610")))
    assert isinstance(record, ProviderRecord)
    assert record.practice_zip == "96860"
    assert record.practice_zip9 == "96860"
    assert record.practice_state == "HI"
    assert record.practice_address_line1 == "NAVAL HEALTH CLINIC HAWAII"
    assert record.practice_address_line2 == "480 CENTRAL AVE"
    assert record.primary_taxonomy == "122300000X"
    assert record.specialty == "gp"
    assert record.credential_text == "DMD MS"
    assert record.name_prefix is None
    assert record.mailing_state == "AE"
    assert record.mailing_zip is None  # military address carries no postal code; never invented


def test_normalize_miriam_amjadi_prosthodontist(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1194941385")))
    assert isinstance(record, ProviderRecord)
    assert record.specialty == "prosth"
    assert record.primary_taxonomy == "1223P0700X"
    assert record.name_suffix is None  # "--" placeholder
    assert record.middle_name == "MORIA"
    assert record.sole_proprietor is True
    assert record.practice_fax_e164 == "+18089491522"


def test_normalize_secondary_prosth_code_still_uses_primary_flag(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1730315615")))
    assert isinstance(record, ProviderRecord)
    assert record.taxonomy_codes == ["122300000X", "1223G0001X", "1223P0700X"]
    assert record.primary_taxonomy == "1223P0700X"
    assert record.specialty == "prosth"


def test_normalize_skips_non_dentist_taxonomy(settings):
    """Alumbaugh carries 204E (physician OMS) and a student code, no 1223 code."""
    adapter = _adapter(settings, _fixture_pages)
    assert adapter.normalize(_raw(_fixture_record("1326656216"))) is None


def test_normalize_skips_out_of_state_location_even_with_dentist_code(settings):
    """Alvarez Suarez has 1223S0112X but practices in Florida (WA is a secondary location)."""
    adapter = _adapter(settings, _fixture_pages)
    assert adapter.normalize(_raw(_fixture_record("1437501079"))) is None


def test_normalize_missing_credential_stays_null(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1588877500")))
    assert isinstance(record, ProviderRecord)
    assert record.credential_text is None
    assert record.practice_zip == "96766"
    assert record.practice_address_line2 == "#104"


def test_normalize_organization(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1164750246")))
    assert isinstance(record, OrganizationRecord)
    assert record.name == "12TH AVENUE DENTAL CENTRE LLC"
    assert record.other_names == []
    assert record.phone_raw == "808-737-3311"
    assert record.phone_e164 == "+18087373311"
    assert record.fax_e164 == "+18087373331"
    assert record.address_key == "1144 12TH AVE|96816"
    assert record.postal_code == "96816"
    assert record.postal_code9 == "96816-3712"
    assert record.city == "HONOLULU"
    assert record.state == "HI"
    assert record.taxonomy_codes == ["1223G0001X"]
    assert record.primary_taxonomy == "1223G0001X"
    assert record.authorized_official_first_name == "PATRICK"
    assert record.authorized_official_last_name == "HAYASHI"
    assert record.authorized_official_credential == "DDS"
    assert record.authorized_official_title == "Dentist"
    assert record.organizational_subpart is False
    assert record.enumeration_date == date(2009, 11, 30)
    assert record.nppes_status == "A"


def test_normalize_wa_organization_without_license_fields(settings):
    adapter = _adapter(settings, _fixture_pages)
    record = adapter.normalize(_raw(_fixture_record("1093654758")))
    assert isinstance(record, OrganizationRecord)
    assert record.state == "WA"
    assert record.postal_code == "99336"
    assert record.authorized_official_credential is None
    assert record.fax_e164 is None
    assert record.primary_taxonomy == "1223P0300X"


# -- fetch: partitioning, pagination, subdivision -----------------------------------------------


def _small_config(page_size: int, max_skip: int) -> SourceConfig:
    return _config(
        page_size=page_size, max_skip=max_skip, enumeration_types=["NPI-1"], states={"HI": ["968"]}
    )


def test_fetch_pages_until_short_page(settings):
    dataset = [_synthetic(f"10000000{i:02d}", "96813") for i in range(5)]
    adapter = _adapter(settings, _synthetic_pages(dataset), config=_small_config(2, 4))
    records = list(adapter.fetch(state="HI"))
    assert [r.key for r in records] == [r["number"] for r in dataset]
    assert adapter.stats.requests == 3  # skip 0, 2 (full pages) then 4 (one result, stop)
    assert adapter.stats.cache_hits == 0
    assert adapter.stats.notes == []
    assert all(r.source == "nppes" and r.cache_path for r in records)


def test_fetch_subdivides_prefix_when_skip_would_exceed_max_skip(settings):
    # nine ZIPs spread across sub-prefixes 9680..9688, so one level of subdivision suffices
    dataset = [_synthetic(f"20000000{d}0", f"968{d}0") for d in range(9)]
    adapter = _adapter(settings, _synthetic_pages(dataset), config=_small_config(2, 4))
    records = list(adapter.fetch(state="HI"))
    keys = [r.key for r in records]
    assert sorted(keys) == sorted(r["number"] for r in dataset)
    assert len(keys) == len(set(keys))  # coarse pages and subdivided pages overlap; deduped
    assert any("subdivided into 9680*..9689*" in n for n in adapter.stats.notes)
    # 3 coarse pages (skip 0, 2, 4) + one page per sub-prefix 9680..9689
    assert adapter.stats.requests == 13


def test_fetch_respects_limit_and_dedupes(settings):
    dataset = [_synthetic(f"30000000{i:02d}", "96813") for i in range(5)]
    dataset.append(dict(dataset[0]))  # the API can repeat a record across pages
    adapter = _adapter(settings, _synthetic_pages(dataset), config=_small_config(10, 100))
    assert [r.key for r in adapter.fetch(state="HI", limit=2)] == ["3000000000", "3000000001"]
    adapter = _adapter(settings, _synthetic_pages(dataset), config=_small_config(10, 100))
    assert len(list(adapter.fetch(state="HI"))) == 5


def test_fetch_all_configured_states_and_entity_types(settings):
    seen: list[tuple[str, str]] = []

    def pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
        seen.append((prefix, entity_type))
        return []

    adapter = _adapter(settings, pages)
    assert list(adapter.fetch()) == []
    cfg = source_config("nppes")
    expected = [
        (prefix, entity)
        for state in cfg.get("states")
        for prefix in cfg.get("states")[state]
        for entity in cfg.get("enumeration_types")
    ]
    assert seen == expected
    assert adapter.target_states == {"WA", "HI"}


def test_fetch_unknown_state_is_rejected(settings):
    adapter = _adapter(settings, _fixture_pages)
    with pytest.raises(ValueError, match="not configured"):
        list(adapter.fetch(state="OR"))


def test_fetch_error_payload_is_snapshotted(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"Errors": [{"description": "bad parameter"}]})

    adapter = NppesAdapter(
        settings=settings,
        config=_config(),
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )
    with pytest.raises(Exception, match="unexpected NPPES response shape") as info:
        list(adapter.fetch(state="HI"))
    assert info.value.snapshot_path is not None
    assert "bad parameter" in Path(info.value.snapshot_path).read_text()


# -- database round trips ------------------------------------------------------------------------


def test_run_is_idempotent_and_records_source_runs(settings, session_factory):
    first = _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    assert first.status == "ok", first.error
    assert first.record_count == 9  # 6 + 2 from 968, 1 from 967
    assert first.skipped_count == 1  # Nura Abujbara, LOCATION in FL
    assert (first.new_count, first.updated_count, first.unchanged_count) == (8, 0, 0)
    assert first.requests == 4 and first.cache_hits == 0

    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Provider)) == 6
        assert session.scalar(select(func.count()).select_from(Organization)) == 2
        assert session.get(Provider, "1760113096") is None
        dana = session.get(Provider, "1245799642")
        assert dana.specialty == "gp" and dana.practice_phone_e164 == "+18085214421"
        org = session.get(Organization, "1164750246")
        assert org.address_key == "1144 12TH AVE|96816"
        session.execute(text("UPDATE providers SET last_seen = now() - interval '1 day'"))
        session.execute(text("UPDATE organizations SET last_seen = now() - interval '1 day'"))
        session.commit()

    second = _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    assert second.status == "ok", second.error
    assert (second.new_count, second.updated_count, second.unchanged_count) == (0, 0, 8)
    assert second.requests == 0 and second.cache_hits == 4  # same day: served from raw cache

    with session_factory() as session:
        for row in session.execute(select(Provider)).scalars():
            assert row.last_seen > row.updated_at
        runs = session.execute(select(SourceRun).order_by(SourceRun.id)).scalars().all()
        assert [r.status for r in runs] == ["ok", "ok"]
        assert [r.record_count for r in runs] == [9, 9]
        assert [r.new_count for r in runs] == [8, 0]
        assert runs[0].finished_at is not None
        assert runs[1].notes["cache_hits"] == 4


def test_run_stops_at_limit(settings, session_factory):
    stats = _adapter(settings, _fixture_pages, session_factory=session_factory).run(
        state="HI", limit=2
    )
    assert stats.status == "ok", stats.error
    assert stats.record_count == 2
    assert stats.requests == 3  # 967 NPI-1 (1 record), 967 NPI-2 (none), 968 NPI-1 then stop
    assert any("stopped at --limit 2" in n for n in stats.notes)
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Provider)) <= 2
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "ok" and run.record_count == 2


def test_run_http_500_storm_is_recorded_as_error(settings, session_factory):
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(503, text="<html>NPPES is down</html>")

    adapter = NppesAdapter(
        settings=settings,
        config=_config(),
        session_factory=session_factory,
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )
    stats = adapter.run(state="HI")
    assert stats.status == "error"
    assert attempts["n"] == 2  # max_attempts from the config, then give up
    assert stats.error and "503" in stats.error
    assert stats.snapshot_path is not None
    assert Path(stats.snapshot_path).parent == settings.snapshot_dir("nppes")
    assert "NPPES is down" in Path(stats.snapshot_path).read_text()
    with session_factory() as session:
        run = session.execute(select(SourceRun)).scalar_one()
        assert run.status == "error"
        assert run.snapshot_path == stats.snapshot_path
        assert run.traceback and "HTTPFailure" in run.traceback
        assert session.scalar(select(func.count()).select_from(Provider)) == 0


def test_get_adapter_builds_nppes_with_session_factory(settings, session_factory):
    adapter = get_adapter("nppes", settings=settings, session_factory=session_factory)
    assert isinstance(adapter, NppesAdapter)
    assert adapter.page_size == 200
    assert adapter.max_skip == 1000
