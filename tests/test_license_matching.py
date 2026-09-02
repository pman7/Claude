"""License matching tests (CLAUDE.md 6.3, 6.4, 6.9). Rows are added through the ORM."""

from __future__ import annotations

import csv
from datetime import date

from sqlalchemy import select

from integra.db.models import License, Provider
from integra.resolve.licenses import match_licenses
from integra.resolve.matching import (
    Candidate,
    LicenseView,
    ProviderIndex,
    ProviderView,
    choose,
    license_digits,
    match_license,
    taxonomy_license_keys,
)


def _taxonomies(*licenses: tuple[str, str]) -> dict:
    return {
        "taxonomies": [
            {"code": "122300000X", "license": number, "state": state, "primary": True}
            for number, state in licenses
        ]
    }


def _provider(npi: str, first: str, last: str, state: str = "WA", **overrides) -> Provider:
    fields = {
        "first_name": first,
        "last_name": last,
        "practice_state": state,
        "source_json": {"number": npi, "taxonomies": []},
    }
    fields.update(overrides)
    return Provider(npi=npi, **fields)


def _license(number: str, first: str, last: str, **overrides) -> License:
    fields = {
        "source": "wa_doh",
        "state": "WA",
        "credential_type": "Dentist License",
        "status": "Active",
        "is_active_status": True,
        "first_issue_date": date(2015, 6, 1),
        "expiration_date": date(2027, 6, 1),
    }
    fields.update(overrides)
    return License(license_number=number, first_name=first, last_name=last, **fields)


def _add(session_factory, *rows) -> None:
    with session_factory() as session:
        session.add_all(rows)
        session.commit()


def _licenses(session_factory) -> dict[str, License]:
    with session_factory() as session:
        return {lic.license_number: lic for lic in session.execute(select(License)).scalars()}


def _review_rows(path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


# -- pure helpers ----------------------------------------------------------------------------


def test_license_digits_and_taxonomy_keys():
    assert license_digits("DT-2878") == "2878"
    assert license_digits("DE00012345") == "12345"
    assert license_digits("DT 939") == "939"
    assert license_digits("ABC") is None
    assert license_digits(None) is None
    keys = taxonomy_license_keys(_taxonomies(("DT-2878", "HI"), ("13010", "tn")))
    assert keys == frozenset({("2878", "HI"), ("13010", "TN")})
    assert taxonomy_license_keys(None) == frozenset()


def test_choose_breaks_ties_by_state_or_declares_ambiguous():
    a = Candidate("1", 0.95, "name_exact_state", "WA")
    b = Candidate("2", 0.85, "name_exact", "OR")
    assert choose([a, b], "WA")[0] is a
    assert choose([b, Candidate("3", 0.85, "name_exact", "OR")], "WA") == (None, "ambiguous")
    assert choose([Candidate("4", 0.5, "x", "WA")], "WA") == (None, "low_confidence")
    assert choose([], "WA") == (None, "no_candidates")


def test_index_tiers_in_order():
    index = ProviderIndex(
        [
            ProviderView("1", "John", "Smith", "WA", frozenset({("12345", "WA")})),
            ProviderView("2", "John", "Smith", "WA"),
            ProviderView("3", "William", "Jones", "OR"),
        ]
    )
    by_number = match_license(index, LicenseView("DE00012345", "JOHN", "SMITH", "WA"))
    assert by_number.chosen is not None
    assert (by_number.chosen.npi, by_number.chosen.method) == ("1", "license_number")
    other_state = match_license(index, LicenseView("DE99", "BILL", "JONES", "WA"))
    assert other_state.chosen is not None
    assert (other_state.chosen.method, other_state.chosen.confidence) == ("name_exact", 0.85)


# -- database --------------------------------------------------------------------------------


def test_license_number_match_beats_names(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "JOHN", "SMITH", source_json=_taxonomies(("DE 12345", "WA"))),
        _provider("1000000002", "JOHN", "SMITH"),
        _license("DE00012345", "JOHN", "SMITH"),
    )
    stats = match_licenses(session_factory, source="wa_doh", settings=settings)
    lic = _licenses(session_factory)["DE00012345"]
    assert lic.provider_npi == "1000000001"
    assert lic.match_method == "license_number"
    assert float(lic.match_confidence) == 0.99
    assert lic.matched_at is not None
    assert stats.by_method == {"license_number": 1}
    assert (stats.considered, stats.matched, stats.ambiguous, stats.unmatched) == (1, 1, 0, 0)


def test_exact_name_prefers_provider_in_license_state(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "Robert", "Jones", state="OR"),
        _provider("1000000002", "ROBERT", "JONES, D.D.S.", state="WA"),
        _license("DE1", "ROBERT", "JONES"),
    )
    stats = match_licenses(session_factory, source="wa_doh", settings=settings)
    lic = _licenses(session_factory)["DE1"]
    assert lic.provider_npi == "1000000002"
    assert lic.match_method == "name_exact_state"
    assert float(lic.match_confidence) == 0.95
    assert stats.matched == 1


def test_nickname_expansion_matches_bill_to_william(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "WILLIAM", "WILLIAMS"),
        _license("DE2", "BILL", "WILLIAMS"),
    )
    match_licenses(session_factory, source="wa_doh", settings=settings)
    lic = _licenses(session_factory)["DE2"]
    assert lic.provider_npi == "1000000001"
    assert lic.match_method == "name_exact_state"


def test_fuzzy_match_same_state(session_factory, settings):
    # "jon" expands to "jonathan", so the exact key misses; token_set_ratio("jon smith",
    # "john smith") is 94.7. Only WA providers are fuzzy candidates, so the OR twin is ignored.
    _add(
        session_factory,
        _provider("1000000001", "JOHN", "SMITH"),
        _provider("1000000002", "JOHN", "SMITH", state="OR"),
        _license("DE3", "JON", "SMITH"),
    )
    match_licenses(session_factory, source="wa_doh", settings=settings)
    lic = _licenses(session_factory)["DE3"]
    assert lic.provider_npi == "1000000001"
    assert lic.match_method == "name_fuzzy_state"
    assert float(lic.match_confidence) == 0.8


def test_ambiguous_twins_and_unmatched_go_to_review_csv(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "JAMES", "LEE"),
        _provider("1000000002", "JAMES", "LEE"),
        _license("DE4", "JAMES", "LEE"),
        _license("DE5", "QUINTUS", "ZZYZX", status="Expired", is_active_status=False),
    )
    stats = match_licenses(session_factory, source="wa_doh", settings=settings)
    licenses = _licenses(session_factory)
    assert licenses["DE4"].provider_npi is None
    assert licenses["DE4"].match_method is None  # unlinked rows stay untouched
    assert licenses["DE5"].provider_npi is None
    assert licenses["DE5"].match_method is None
    assert (stats.matched, stats.ambiguous, stats.unmatched) == (0, 1, 1)

    assert stats.review_path == settings.review_dir / "unmatched_wa_doh.csv"
    rows = _review_rows(stats.review_path)
    assert [r["license_number"] for r in rows] == ["DE4", "DE5"]
    assert list(rows[0]) == [
        "license_number",
        "last_name",
        "first_name",
        "status",
        "best_candidate_npi",
        "best_confidence",
        "reason",
    ]
    assert rows[0]["reason"] == "ambiguous"
    assert rows[0]["best_candidate_npi"] in {"1000000001", "1000000002"}
    assert rows[0]["best_confidence"] == "0.95"
    assert rows[1] == {
        "license_number": "DE5",
        "last_name": "ZZYZX",
        "first_name": "QUINTUS",
        "status": "Expired",
        "best_candidate_npi": "",
        "best_confidence": "",
        "reason": "no_candidates",
    }
    assert "1 ambiguous, 1 unmatched" in stats.summary()


def test_matched_license_is_propagated_to_provider_columns(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "ANNA", "PARK"),
        _license(
            "DE6",
            "ANNA",
            "PARK",
            status="Expired",
            is_active_status=False,
            first_issue_date=date(2001, 1, 1),
            expiration_date=date(2010, 1, 1),
        ),
        _license(
            "DE7",
            "ANNA",
            "PARK",
            first_issue_date=date(2011, 2, 2),
            expiration_date=date(2027, 2, 2),
        ),
    )
    match_licenses(session_factory, source="wa_doh", settings=settings)
    with session_factory() as session:
        provider = session.get(Provider, "1000000001")
    assert provider.wa_license_number == "DE7"  # active status wins over the expired one
    assert provider.wa_license_status == "Active"
    assert provider.wa_first_issue_date == date(2011, 2, 2)
    assert provider.wa_expiration_date == date(2027, 2, 2)
    assert provider.hi_license_number is None


def test_hawaii_source_propagates_to_hi_columns(session_factory, settings):
    _add(
        session_factory,
        _provider(
            "1000000001", "DANA", "ADACHI", state="HI", source_json=_taxonomies(("DT-2878", "HI"))
        ),
        _license("DT 2878", "DANA", "ADACHI", source="hi_dcca", state="HI", status="ACTIVE"),
    )
    stats = match_licenses(session_factory, source="hi_dcca", settings=settings)
    assert stats.by_method == {"license_number": 1}
    with session_factory() as session:
        provider = session.get(Provider, "1000000001")
    assert provider.hi_license_number == "DT 2878"
    assert provider.hi_license_status == "ACTIVE"
    assert provider.wa_license_number is None
    assert stats.review_path.exists()
    assert _review_rows(stats.review_path) == []


def test_second_run_does_not_duplicate_or_relink(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "JOHN", "SMITH"),
        _provider("1000000002", "JAMES", "LEE"),
        _provider("1000000003", "JAMES", "LEE"),
        _license("DE8", "JOHN", "SMITH"),
        _license("DE9", "JAMES", "LEE"),
    )
    first = match_licenses(session_factory, source="wa_doh", settings=settings)
    matched_at = _licenses(session_factory)["DE8"].matched_at
    second = match_licenses(session_factory, source="wa_doh", settings=settings)

    assert (first.considered, first.matched, first.ambiguous) == (2, 1, 1)
    assert (second.considered, second.matched, second.ambiguous) == (1, 0, 1)  # only DE9 again
    licenses = _licenses(session_factory)
    assert len(licenses) == 2
    assert licenses["DE8"].provider_npi == "1000000001"
    assert licenses["DE8"].matched_at == matched_at
    assert [r["license_number"] for r in _review_rows(second.review_path)] == ["DE9"]

    # A twin deactivating its NPPES record does not change anything; a new provider does.
    _add(session_factory, _provider("1000000004", "JAMES", "LEE", state="OR"))
    third = match_licenses(session_factory, source="wa_doh", settings=settings)
    assert third.ambiguous == 1  # the two WA twins still tie; the OR record is not a tiebreaker
