"""Match state license records to providers (CLAUDE.md 6.3, 6.4, 6.9).

Adapters call `match_licenses` from their `after_run` hook. Every licenses row of the source
that has no provider yet (including rows that were ambiguous or unmatched last time) is
reconsidered against all providers, so a provider that arrives later still gets linked.

Links are written to licenses.provider_npi with match_method / match_confidence / matched_at.
Rows that cannot be linked with confidence >= 0.8 go to data/review/unmatched_<source>.csv
for Phillip; the file is rewritten on every run. Matched licenses are then propagated to the
provider's <state>_license_* columns.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings, get_settings
from integra.db.models import License, Provider
from integra.logging import get_logger
from integra.resolve.matching import (
    LicenseView,
    MatchOutcome,
    ProviderIndex,
    ProviderView,
    match_license,
    taxonomy_license_keys,
)

log = get_logger(component="license_matching")

SOURCE_STATES: dict[str, str] = {"wa_doh": "WA", "hi_dcca": "HI"}
REVIEW_COLUMNS = [
    "license_number",
    "last_name",
    "first_name",
    "status",
    "best_candidate_npi",
    "best_confidence",
    "reason",
]
PROPAGATED_FIELDS = ("license_number", "license_status", "first_issue_date", "expiration_date")


@dataclass
class MatchStats:
    source: str
    considered: int = 0
    matched: int = 0
    unmatched: int = 0
    ambiguous: int = 0
    review_path: Path | None = None
    by_method: dict[str, int] = field(default_factory=dict)

    def summary(self) -> str:
        methods = ", ".join(f"{k}={v}" for k, v in sorted(self.by_method.items())) or "none"
        review = f" Review file: {self.review_path}." if self.review_path else ""
        return (
            f"{self.source} license matching: {self.considered:,} considered, "
            f"{self.matched:,} matched ({methods}), {self.ambiguous:,} ambiguous, "
            f"{self.unmatched:,} unmatched.{review}"
        )


def load_provider_index(session: Session) -> ProviderIndex:
    rows = session.execute(
        select(
            Provider.npi,
            Provider.first_name,
            Provider.last_name,
            Provider.practice_state,
            Provider.source_json,
        )
    )
    return ProviderIndex(
        ProviderView(npi, first, last, state, taxonomy_license_keys(source_json))
        for npi, first, last, state, source_json in rows
    )


def _review_row(lic: License, outcome: MatchOutcome) -> dict[str, Any]:
    best = outcome.best
    return {
        "license_number": lic.license_number,
        "last_name": lic.last_name or "",
        "first_name": lic.first_name or "",
        "status": lic.status or "",
        "best_candidate_npi": best.npi if best else "",
        "best_confidence": f"{best.confidence:.2f}" if best else "",
        "reason": outcome.reason,
    }


def write_review(path: Path, rows: Iterable[dict[str, Any]]) -> Path:
    """Overwrite the review CSV. Written even when empty so a stale file never lingers."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=REVIEW_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return path


def _license_rank(lic: License) -> tuple[int, int, str]:
    """Best license first: active status, then latest expiration, then number for stability."""
    expiration = lic.expiration_date
    return (
        0 if lic.is_active_status else 1,
        # date.max sorts a missing expiration after every real one.
        -(expiration.toordinal()) if expiration else 0,
        lic.license_number,
    )


def propagate_to_providers(session: Session, source: str, state: str) -> int:
    """Copy each provider's best matched license of `state` onto its <state>_license_* columns."""
    prefix = state.lower()
    columns = {f: f"{prefix}_{f}" for f in PROPAGATED_FIELDS}
    if not all(hasattr(Provider, c) for c in columns.values()):
        log.warning("propagate.skipped", source=source, state=state, reason="no provider columns")
        return 0
    matched = (
        session.execute(
            select(License).where(
                License.source == source,
                License.state == state,
                License.provider_npi.is_not(None),
            )
        )
        .scalars()
        .all()
    )
    by_provider: dict[str, list[License]] = {}
    for lic in matched:
        by_provider.setdefault(str(lic.provider_npi), []).append(lic)
    if not by_provider:
        return 0
    providers = session.execute(
        select(Provider).where(Provider.npi.in_(list(by_provider)))
    ).scalars()
    changed = 0
    for provider in providers:
        best = sorted(by_provider[provider.npi], key=_license_rank)[0]
        values = {
            columns["license_number"]: best.license_number,
            columns["license_status"]: best.status,
            columns["first_issue_date"]: best.first_issue_date,
            columns["expiration_date"]: best.expiration_date,
        }
        touched = False
        for column, value in values.items():
            if getattr(provider, column) != value:
                setattr(provider, column, value)
                touched = True
        changed += touched
    return changed


def match_licenses(
    session_factory: sessionmaker[Session],
    *,
    source: str,
    settings: Settings | None = None,
) -> MatchStats:
    """Link licenses.provider_npi for unmatched rows of `source`; write review CSV for the rest."""
    settings = settings or get_settings()
    stats = MatchStats(source=source)
    review_rows: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    with session_factory() as session:
        index = load_provider_index(session)
        pending = (
            session.execute(
                select(License)
                .where(License.source == source, License.provider_npi.is_(None))
                .order_by(License.id)
            )
            .scalars()
            .all()
        )
        stats.considered = len(pending)
        states: set[str] = set()
        for lic in pending:
            states.add(lic.state.upper())
            view = LicenseView(lic.license_number, lic.first_name, lic.last_name, lic.state)
            outcome = match_license(index, view)
            if outcome.chosen is not None:
                lic.provider_npi = outcome.chosen.npi
                lic.match_method = outcome.chosen.method
                lic.match_confidence = outcome.chosen.confidence
                lic.matched_at = now
                stats.matched += 1
                method = outcome.chosen.method
                stats.by_method[method] = stats.by_method.get(method, 0) + 1
                continue
            # Unlinked rows are left untouched in the database (provider_npi stays NULL, so they
            # are reconsidered next run); the reason goes to the review CSV instead.
            if outcome.reason == "ambiguous":
                stats.ambiguous += 1
            else:
                stats.unmatched += 1
            review_rows.append(_review_row(lic, outcome))
        session.flush()
        propagate_states = states | ({SOURCE_STATES[source]} if source in SOURCE_STATES else set())
        propagated = sum(
            propagate_to_providers(session, source, s) for s in sorted(propagate_states)
        )
        session.commit()
    stats.review_path = write_review(settings.review_dir / f"unmatched_{source}.csv", review_rows)
    log.info(
        "match.finish",
        source=source,
        providers_indexed=len(index),
        considered=stats.considered,
        matched=stats.matched,
        ambiguous=stats.ambiguous,
        unmatched=stats.unmatched,
        providers_updated=propagated,
        by_method=dict(stats.by_method),
    )
    return stats
