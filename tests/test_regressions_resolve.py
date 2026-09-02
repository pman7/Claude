"""Regression tests for the 2026-09-02 review fixes in integra.resolve (see CHANGELOG.md).

Covers license-number keys taken from dentist taxonomies only, the rank used when several
matched licenses propagate to one provider, one practice per office when NPPES splits the
suite across address_1 / address_2, and the license-number tier end to end from a real NPPES
fixture record. The NPPES adapter and fixtures come from tests/test_nppes.py; no network.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select

from integra.db.models import License, Practice, Provider
from integra.resolve.licenses import _license_rank, match_licenses
from integra.resolve.matching import taxonomy_license_keys
from integra.resolve.practices import run_resolve
from tests.test_nppes import _adapter, _fixture_pages, _fixture_record, _raw

# Dana Adachi (STE in address_1) and Gerald Adachi (SUITE in address_2), same phone and office.
ADACHI_NPIS = ("1245799642", "1609082221")
KING_STREET_KEY = "715 S KING ST STE 425|96813"


def test_taxonomy_license_keys_ignore_non_dentist_entries() -> None:
    source_json = {
        "taxonomies": [
            {"code": "204E00000X", "license": "MD-5678", "state": "HI"},
            {"code": "1223G0001X", "license": "DT-1234", "state": "HI"},
        ]
    }
    assert taxonomy_license_keys(source_json) == frozenset({("1234", "HI")})


def _license(number: str, credential_type: str, *, active: bool, expires: date) -> License:
    return License(
        source="wa_doh",
        state="WA",
        license_number=number,
        credential_type=credential_type,
        status="Active" if active else "Expired",
        is_active_status=active,
        expiration_date=expires,
    )


def test_active_dentist_license_outranks_a_longer_lived_faculty_license() -> None:
    dentist = _license("DE1", "Dentist License", active=True, expires=date(2027, 1, 1))
    faculty = _license("DF1", "Dental Faculty License", active=True, expires=date(2029, 1, 1))
    assert _license_rank(dentist) < _license_rank(faculty)
    assert sorted([faculty, dentist], key=_license_rank)[0] is dentist


def test_expired_dentist_license_ranks_after_an_active_faculty_license() -> None:
    expired = _license("DE2", "Dentist License", active=False, expires=date(2030, 1, 1))
    faculty = _license("DF2", "Dental Faculty License", active=True, expires=date(2027, 1, 1))
    assert _license_rank(faculty) < _license_rank(expired)
    assert sorted([expired, faculty], key=_license_rank)[0] is faculty


def test_adachi_office_resolves_to_one_practice(settings, session_factory) -> None:
    adapter = _adapter(settings, _fixture_pages, session_factory=session_factory)
    records = [adapter.normalize(_raw(_fixture_record(npi))) for npi in ADACHI_NPIS]
    assert [r.practice_address_key for r in records] == [KING_STREET_KEY, KING_STREET_KEY]
    adapter.upsert(records)

    stats = run_resolve(settings=settings, session_factory=session_factory)

    with session_factory() as session:
        practices = session.execute(select(Practice)).scalars().all()
        providers = {p.npi: p for p in session.execute(select(Provider)).scalars()}
    assert len(practices) == 1
    practice = practices[0]
    assert practice.address_key == KING_STREET_KEY
    assert practice.address_line1 == "715 S KING ST STE 425"
    assert practice.phone_e164 == "+18085214421"
    assert practice.provider_count == 2
    assert practice.resolution_method == "address_phone"
    assert practice.name == "Dr. Adachi"
    assert practice.county == "Honolulu"
    assert {providers[npi].practice_id for npi in ADACHI_NPIS} == {practice.id}
    assert stats.practices_created == 1

    # resolve re-runs the license linker for every source and refreshes the review files.
    assert "license matching" in stats.summary()
    assert (settings.review_dir / "unmatched_wa_doh.csv").exists()
    assert (settings.review_dir / "unmatched_hi_dcca.csv").exists()


def test_license_number_tier_links_a_real_nppes_record(settings, session_factory) -> None:
    """Robert Long (NPI 1588877500) lists Hawaii license 'DT 939' in his NPPES taxonomy; the
    DCCA row DT-939 must link on the number alone with confidence 0.99."""
    stats = _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    assert stats.status == "ok", stats.error
    with session_factory() as session:
        session.add(
            License(
                source="hi_dcca",
                state="HI",
                license_number="DT-939",
                first_name="ROBERT",
                last_name="LONG",
                status="ACTIVE",
                is_active_status=True,
            )
        )
        session.commit()

    match = match_licenses(session_factory, source="hi_dcca", settings=settings)

    assert match.by_method == {"license_number": 1}
    with session_factory() as session:
        lic = session.execute(
            select(License).where(License.license_number == "DT-939")
        ).scalar_one()
        provider = session.get(Provider, "1588877500")
    assert lic.provider_npi == "1588877500"
    assert lic.match_method == "license_number"
    assert float(lic.match_confidence) == 0.99
    assert provider.hi_license_number == "DT-939"
    assert provider.hi_license_status == "ACTIVE"
    assert provider.wa_license_number is None
