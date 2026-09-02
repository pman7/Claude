"""Practice resolution tests (CLAUDE.md sections 5 and 7). Rows are added through the ORM."""

from __future__ import annotations

from sqlalchemy import select

from integra.db.models import Organization, Practice, Provider
from integra.normalize import address_key, normalize_phone, zip5
from integra.resolve.practice_rows import resolution_key
from integra.resolve.practices import run_resolve

PHONE = "(425) 555-0100"
LINE1 = "35 148th Ave SE Ste 10"


def _provider(npi: str, first: str, last: str, **overrides) -> Provider:
    fields = {
        "first_name": first,
        "last_name": last,
        "practice_phone_raw": PHONE,
        "practice_phone_e164": normalize_phone(PHONE),
        "practice_address_line1": LINE1,
        "practice_city": "Bellevue",
        "practice_state": "WA",
        "practice_zip": "98007",
        "practice_address_key": address_key(LINE1, "98007"),
        "primary_taxonomy": "122300000X",
        "taxonomy_codes": ["122300000X"],
        "specialty": "gp",
    }
    fields.update(overrides)
    return Provider(npi=npi, **fields)


def _organization(npi: str, name: str, **overrides) -> Organization:
    fields = {
        "name": name,
        "phone_e164": normalize_phone(PHONE),
        "address_line1": LINE1,
        "city": "Bellevue",
        "state": "WA",
        "postal_code": zip5("98007"),
        "address_key": address_key(LINE1, "98007"),
    }
    fields.update(overrides)
    return Organization(npi=npi, **fields)


def _add(session_factory, *rows) -> None:
    with session_factory() as session:
        session.add_all(rows)
        session.commit()


def _practices(session_factory) -> list[Practice]:
    with session_factory() as session:
        return session.execute(select(Practice).order_by(Practice.resolution_key)).scalars().all()


def _provider_rows(session_factory) -> dict[str, Provider]:
    with session_factory() as session:
        return {p.npi: p for p in session.execute(select(Provider)).scalars()}


def test_resolution_key_prefers_phone_and_address_then_falls_back_to_npi():
    assert resolution_key("+14255550100", "35 148TH AVE SE STE 10|98007", "1") == (
        "pa:+14255550100|35 148TH AVE SE STE 10|98007",
        "phone_address",
    )
    assert resolution_key(None, "X|98007", "1") == ("a:X|98007", "address")
    assert resolution_key("+14255550100", None, "1") == ("p:+14255550100", "phone")
    assert resolution_key(None, None, "1234567890") == ("npi:1234567890", "npi_solo")


def test_two_providers_sharing_phone_and_address_form_one_practice(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "DANA", "ADACHI"),
        _provider("1000000002", "GERALD", "BAKER"),
    )
    stats = run_resolve(settings=settings, session_factory=session_factory)

    practices = _practices(session_factory)
    assert len(practices) == 1
    practice = practices[0]
    assert practice.resolution_method == "phone_address"
    assert practice.provider_count == 2
    assert practice.name == "Dr. Adachi"  # first provider by last name, until Google Maps
    assert practice.phone_e164 == "+14255550100"
    assert practice.postal_code == "98007"
    assert practice.state == "WA"
    assert practice.county is None  # only Hawaii is mapped in Phase 1
    assert practice.org_npi is None
    assert practice.is_active is True

    providers = _provider_rows(session_factory)
    assert {p.practice_id for p in providers.values()} == {practice.id}
    assert stats.practices_created == 1
    assert stats.providers_linked == 2
    assert stats.providers_relinked == 2
    assert "1 practices" in stats.summary()


def test_organization_at_same_key_names_the_practice(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "DANA", "ADACHI"),
        _organization("1200000001", "ADACHI FAMILY DENTISTRY PLLC"),
        _organization("1200000002", "ADACHI DDS"),
    )
    stats = run_resolve(settings=settings, session_factory=session_factory)

    practices = _practices(session_factory)
    assert len(practices) == 1
    assert practices[0].name == "ADACHI FAMILY DENTISTRY PLLC"  # the most specific org name
    assert practices[0].org_npi == "1200000001"
    assert practices[0].provider_count == 1
    with session_factory() as session:
        orgs = session.execute(select(Organization)).scalars().all()
    assert {o.practice_id for o in orgs} == {practices[0].id}
    assert stats.organizations_linked == 2


def test_provider_without_phone_or_address_gets_a_solo_practice(session_factory, settings):
    _add(
        session_factory,
        _provider(
            "1000000003",
            "LEE",
            "WONG",
            practice_phone_raw=None,
            practice_phone_e164=None,
            practice_address_line1=None,
            practice_address_key=None,
            practice_zip=None,
        ),
    )
    stats = run_resolve(settings=settings, session_factory=session_factory)

    practices = _practices(session_factory)
    assert len(practices) == 1
    assert practices[0].resolution_key == "npi:1000000003"
    assert practices[0].resolution_method == "npi_solo"
    assert practices[0].name == "Dr. Wong"
    assert _provider_rows(session_factory)["1000000003"].practice_id == practices[0].id
    assert stats.solo_practices == 1


def test_hawaii_practice_gets_county(session_factory, settings):
    line1 = "715 S King St Ste 425"
    _add(
        session_factory,
        _provider(
            "1000000004",
            "KEN",
            "NAKAMURA",
            practice_phone_raw="(808) 555-0123",
            practice_phone_e164=normalize_phone("(808) 555-0123"),
            practice_address_line1=line1,
            practice_city="Honolulu",
            practice_state="HI",
            practice_zip="96813",
            practice_address_key=address_key(line1, "96813-3021"),
        ),
    )
    run_resolve(settings=settings, session_factory=session_factory)
    practice = _practices(session_factory)[0]
    assert practice.state == "HI"
    assert practice.county == "Honolulu"


def test_second_run_creates_nothing_and_keeps_ids(session_factory, settings):
    _add(
        session_factory,
        _provider("1000000001", "DANA", "ADACHI"),
        _provider("1000000002", "GERALD", "BAKER"),
        _provider("1000000003", "LEE", "WONG", practice_phone_e164=None, practice_address_key=None),
        _organization("1200000001", "ADACHI FAMILY DENTISTRY PLLC"),
    )
    first = run_resolve(settings=settings, session_factory=session_factory)
    ids_before = {p.resolution_key: p.id for p in _practices(session_factory)}
    second = run_resolve(settings=settings, session_factory=session_factory)
    ids_after = {p.resolution_key: p.id for p in _practices(session_factory)}

    assert first.practices_created == 2
    assert second.practices_created == 0
    assert second.practices_updated == 0
    assert second.practices_unchanged == 2
    assert second.providers_relinked == 0
    assert second.organizations_relinked == 0
    assert ids_before == ids_after
    assert len(ids_after) == 2


def test_preset_name_is_not_overwritten(session_factory, settings):
    _add(session_factory, _provider("1000000001", "DANA", "ADACHI"))
    run_resolve(settings=settings, session_factory=session_factory)
    with session_factory() as session:
        practice = session.execute(select(Practice)).scalar_one()
        practice.name = "Bellevue Smile Studio"
        practice.google_place_id = "ChIJ-example"
        session.commit()

    # An organization arriving later must not displace a Google Maps name.
    _add(session_factory, _organization("1200000001", "ADACHI FAMILY DENTISTRY PLLC"))
    run_resolve(settings=settings, session_factory=session_factory)
    practice = _practices(session_factory)[0]
    assert practice.name == "Bellevue Smile Studio"
    assert practice.org_npi == "1200000001"


def test_manually_set_name_is_kept_when_no_org_name(session_factory, settings):
    _add(session_factory, _provider("1000000001", "DANA", "ADACHI"))
    run_resolve(settings=settings, session_factory=session_factory)
    with session_factory() as session:
        practice = session.execute(select(Practice)).scalar_one()
        practice.name = "Adachi Dental"
        session.commit()
    run_resolve(settings=settings, session_factory=session_factory)
    assert _practices(session_factory)[0].name == "Adachi Dental"


def test_specialty_is_derived_when_null(session_factory, settings):
    _add(
        session_factory,
        _provider(
            "1000000005",
            "AMY",
            "CHEN",
            specialty=None,
            primary_taxonomy="1223P0700X",
            taxonomy_codes=["122300000X", "1223P0700X"],
        ),
        _provider(
            "1000000006",
            "BOB",
            "DIAZ",
            specialty=None,
            primary_taxonomy=None,
            taxonomy_codes=["390200000X", "1223X0400X"],
        ),
    )
    stats = run_resolve(settings=settings, session_factory=session_factory)
    providers = _provider_rows(session_factory)
    assert providers["1000000005"].specialty == "prosth"
    assert providers["1000000006"].specialty == "ortho"
    assert stats.specialties_derived == 2


def test_practice_without_members_is_deactivated_not_deleted(session_factory, settings):
    _add(session_factory, _provider("1000000001", "DANA", "ADACHI"))
    run_resolve(settings=settings, session_factory=session_factory)
    with session_factory() as session:
        provider = session.get(Provider, "1000000001")
        provider.is_active = False
        session.commit()
    stats = run_resolve(settings=settings, session_factory=session_factory)
    practice = _practices(session_factory)[0]
    assert stats.practices_deactivated == 1
    assert practice.is_active is False
    assert practice.deactivated_at is not None

    with session_factory() as session:
        provider = session.get(Provider, "1000000001")
        provider.is_active = True
        session.commit()
    run_resolve(settings=settings, session_factory=session_factory)
    practice = _practices(session_factory)[0]
    assert practice.is_active is True
    assert practice.deactivated_at is None
