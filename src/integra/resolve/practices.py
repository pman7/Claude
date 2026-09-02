"""Practice resolution: group providers and organizations into physical offices (CLAUDE.md 5, 7).

Deterministic and idempotent. Keys and row building live in resolve/practice_rows.py.
One practice per resolution key, upserted on practices.resolution_key, so running twice creates
nothing new and keeps the same practice ids. Nothing is hard deleted: a practice whose members
all disappeared is flagged is_active = false and comes back when they reappear.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Table, bindparam, select, update
from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings, get_settings
from integra.db.models import Organization, Practice, Provider
from integra.db.session import get_session_factory
from integra.db.upsert import upsert_rows
from integra.logging import get_logger
from integra.resolve.practice_rows import (
    Member,
    build_practice_row,
    load_members,
    resolution_key,
)
from integra.specialty import derive_specialty

log = get_logger(component="resolve")

PRACTICE_COMPARE = [
    "name",
    "org_npi",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "county",
    "address_key",
    "phone_e164",
    "fax_e164",
    "provider_count",
    "resolution_method",
]


@dataclass
class ResolveStats:
    practices_created: int = 0
    practices_updated: int = 0
    practices_unchanged: int = 0
    practices_deactivated: int = 0
    providers_linked: int = 0
    providers_relinked: int = 0
    organizations_linked: int = 0
    organizations_relinked: int = 0
    solo_practices: int = 0
    specialties_derived: int = 0
    elapsed_seconds: float = 0.0

    @property
    def practices_total(self) -> int:
        return self.practices_created + self.practices_updated + self.practices_unchanged

    def summary(self) -> str:
        return (
            f"resolve: {self.practices_total:,} practices ({self.practices_created:,} created, "
            f"{self.practices_updated:,} updated, {self.practices_unchanged:,} unchanged, "
            f"{self.practices_deactivated:,} deactivated), {self.solo_practices:,} solo. "
            f"{self.providers_linked:,} providers linked ({self.providers_relinked:,} changed), "
            f"{self.organizations_linked:,} organizations linked "
            f"({self.organizations_relinked:,} changed), "
            f"{self.specialties_derived:,} specialties derived. "
            f"Elapsed {self.elapsed_seconds:.1f}s."
        )


def _link(session: Session, table: Table, pairs: list[tuple[str, uuid.UUID]]) -> None:
    """Core (not ORM) bulk update, so no session synchronization is attempted."""
    if not pairs:
        return
    stmt = (
        update(table)
        .where(table.c.npi == bindparam("b_npi"))
        .values(practice_id=bindparam("b_pid"))
    )
    session.execute(stmt, [{"b_npi": npi, "b_pid": pid} for npi, pid in pairs])


def _derive_missing_specialties(session: Session) -> int:
    rows = session.execute(
        select(Provider.npi, Provider.primary_taxonomy, Provider.taxonomy_codes).where(
            Provider.specialty.is_(None)
        )
    ).all()
    updates = []
    for npi, primary, codes in rows:
        specialty = derive_specialty(primary, list(codes or []))
        if specialty is not None:
            updates.append({"b_npi": npi, "b_specialty": specialty})
    if updates:
        stmt = (
            update(Provider.__table__)
            .where(Provider.__table__.c.npi == bindparam("b_npi"))
            .values(specialty=bindparam("b_specialty"))
        )
        session.execute(stmt, updates)
    return len(updates)


def _deactivate_orphans(session: Session, live_keys: set[str]) -> int:
    orphans = (
        session.execute(
            select(Practice).where(
                Practice.resolution_key.is_not(None), Practice.is_active.is_(True)
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    count = 0
    for practice in orphans:
        if practice.resolution_key not in live_keys:
            practice.is_active = False
            practice.deactivated_at = now
            count += 1
    return count


def run_resolve(
    settings: Settings | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> ResolveStats:
    """Group providers and organizations into practices, link them, derive missing specialty."""
    settings = settings or get_settings()
    session_factory = session_factory or get_session_factory(settings.database_url)
    start = time.monotonic()
    stats = ResolveStats()
    with session_factory() as session:
        members = load_members(session)
        groups: dict[str, list[Member]] = {}
        methods: dict[str, str] = {}
        for member in members:
            key, method = resolution_key(member.phone, member.address_key, member.npi)
            groups.setdefault(key, []).append(member)
            methods[key] = method
        existing = {
            p.resolution_key: p
            for p in session.execute(
                select(Practice).where(Practice.resolution_key.is_not(None))
            ).scalars()
        }
        rows = [
            build_practice_row(key, methods[key], group, existing.get(key))
            for key, group in sorted(groups.items())
        ]
        stats.solo_practices = sum(1 for r in rows if r["resolution_method"] == "npi_solo")
        counts = upsert_rows(
            session,
            Practice.__table__,
            rows,
            conflict_columns=["resolution_key"],
            compare_columns=PRACTICE_COMPARE,
        )
        stats.practices_created = counts.inserted
        stats.practices_updated = counts.updated
        stats.practices_unchanged = counts.unchanged
        practice_ids: dict[str, uuid.UUID] = {r["resolution_key"]: r["id"] for r in rows}
        provider_pairs: list[tuple[str, uuid.UUID]] = []
        org_pairs: list[tuple[str, uuid.UUID]] = []
        for key, group in groups.items():
            pid = practice_ids[key]
            for member in group:
                if member.is_org:
                    stats.organizations_linked += 1
                    if member.practice_id != pid:
                        org_pairs.append((member.npi, pid))
                else:
                    stats.providers_linked += 1
                    if member.practice_id != pid:
                        provider_pairs.append((member.npi, pid))
        _link(session, Provider.__table__, provider_pairs)
        _link(session, Organization.__table__, org_pairs)
        stats.providers_relinked = len(provider_pairs)
        stats.organizations_relinked = len(org_pairs)
        stats.specialties_derived = _derive_missing_specialties(session)
        stats.practices_deactivated = _deactivate_orphans(session, set(groups))
        session.commit()
    stats.elapsed_seconds = time.monotonic() - start
    log.info(
        "resolve.finish",
        practices=stats.practices_total,
        created=stats.practices_created,
        updated=stats.practices_updated,
        deactivated=stats.practices_deactivated,
        providers=stats.providers_linked,
        organizations=stats.organizations_linked,
        solo=stats.solo_practices,
        elapsed=round(stats.elapsed_seconds, 1),
    )
    return stats
