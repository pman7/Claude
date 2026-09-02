"""Regression tests for the 2026-09-02 NPPES fixes (see CHANGELOG.md): a complete pull flags
records NPPES no longer returns (and status D records) inactive without deleting them, a
--limit or single-state pull never deactivates anything outside its scope, and secondary
practice locations are reported in the run notes.

The mock API and fixtures come from tests/test_nppes.py; no network.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from integra.db.models import Organization, Provider
from tests.test_nppes import PageFn, _adapter, _fixture_pages, _fixture_results

DANA_ADACHI = "1245799642"
GERALD_ADACHI = "1609082221"


def _pages_without(npi: str) -> PageFn:
    """The fixture API minus one record, as if NPPES had dropped it."""

    def pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
        return [r for r in _fixture_pages(prefix, entity_type, skip, limit) if r["number"] != npi]

    return pages


def _pages_with_status_d(npi: str) -> PageFn:
    """The fixture API with one record's basic.status flipped to D (deactivated)."""

    def pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
        out = []
        for result in _fixture_pages(prefix, entity_type, skip, limit):
            if result["number"] == npi:
                result = {**result, "basic": {**result["basic"], "status": "D"}}
            out.append(result)
        return out

    return pages


def _wa_pages(prefix: str, entity_type: str, skip: int, limit: int) -> list[dict[str, Any]]:
    if skip or (prefix, entity_type) != ("981", "NPI-1"):
        return []
    return _fixture_results("wa_oms_limit2.json")[:limit]


def _providers(session_factory) -> dict[str, Provider]:
    with session_factory() as session:
        return {p.npi: p for p in session.execute(select(Provider)).scalars()}


def test_complete_rerun_flags_a_vanished_provider_inactive(settings, session_factory) -> None:
    first = _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    assert first.status == "ok", first.error
    assert _providers(session_factory)[DANA_ADACHI].is_active is True

    second = _adapter(
        settings, _pages_without(DANA_ADACHI), session_factory=session_factory, force=True
    ).run(state="HI")
    assert second.status == "ok", second.error
    assert second.record_count == first.record_count - 1
    assert any("1 records not returned this run" in note for note in second.notes)

    providers = _providers(session_factory)
    dana, gerald = providers[DANA_ADACHI], providers[GERALD_ADACHI]
    assert dana.is_active is False
    assert dana.deactivated_at is not None
    assert dana.last_name == "ADACHI"  # flagged, never deleted (hard rule 8)
    assert gerald.is_active is True and gerald.deactivated_at is None
    assert sum(not p.is_active for p in providers.values()) == 1


def test_limited_run_never_deactivates(settings, session_factory) -> None:
    _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    limited = _adapter(
        settings, _pages_without(DANA_ADACHI), session_factory=session_factory, force=True
    ).run(state="HI", limit=1)
    assert limited.status == "ok", limited.error
    assert limited.record_count == 1
    assert not any("not returned this run" in note for note in limited.notes)
    providers = _providers(session_factory)
    assert providers[DANA_ADACHI].is_active is True
    assert all(p.is_active and p.deactivated_at is None for p in providers.values())


def test_state_scoped_run_leaves_other_states_alone(settings, session_factory) -> None:
    with session_factory() as session:
        session.add_all(
            [
                Provider(npi="1000000001", last_name="STALE-WA", practice_state="WA"),
                Provider(npi="1000000002", last_name="STALE-HI", practice_state="HI"),
                Organization(npi="1200000001", name="STALE WA ORG", state="WA"),
            ]
        )
        session.commit()
    stats = _adapter(settings, _fixture_pages, session_factory=session_factory).run(state="HI")
    assert stats.status == "ok", stats.error
    assert any("1 records not returned this run" in note for note in stats.notes)
    providers = _providers(session_factory)
    assert providers["1000000001"].is_active is True
    assert providers["1000000001"].deactivated_at is None
    assert providers["1000000002"].is_active is False  # HI was pulled completely: it is gone
    with session_factory() as session:
        org = session.get(Organization, "1200000001")
    assert org.is_active is True and org.deactivated_at is None


def test_nppes_status_d_flags_the_provider_inactive(settings, session_factory) -> None:
    stats = _adapter(
        settings, _pages_with_status_d(DANA_ADACHI), session_factory=session_factory
    ).run(state="HI")
    assert stats.status == "ok", stats.error
    assert any("1 NPPES-deactivated records flagged inactive" in note for note in stats.notes)
    providers = _providers(session_factory)
    dana = providers[DANA_ADACHI]
    assert dana.nppes_status == "D"
    assert dana.is_active is False
    assert dana.deactivated_at is not None
    assert providers[GERALD_ADACHI].is_active is True


def test_secondary_practice_location_is_reported_in_notes(settings, session_factory) -> None:
    """Alvarez Suarez (1437501079) practices in Florida but lists a Seattle office in
    practiceLocations; the run must say how many records were kept through such an office."""
    stats = _adapter(settings, _wa_pages, session_factory=session_factory).run(state="WA")
    assert stats.status == "ok", stats.error
    assert stats.record_count == 2
    assert stats.skipped_count == 1  # Alumbaugh carries no 1223 taxonomy code
    assert any("1 records use a secondary practice location" in note for note in stats.notes)
    alvarez = _providers(session_factory)["1437501079"]
    assert alvarez.practice_state == "WA"
    assert alvarez.practice_zip == "98195"
