"""Match state license records to providers (CLAUDE.md 6.3, 6.4, 6.9).

Placeholder contract; the implementation is filled in by the resolution work. Adapters call
`match_licenses` from their `after_run` hook, so the signature here is the interface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings, get_settings


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


def match_licenses(
    session_factory: sessionmaker[Session],
    *,
    source: str,
    settings: Settings | None = None,
) -> MatchStats:
    """Link licenses.provider_npi for unmatched rows of `source`; write review CSV for the rest."""
    settings = settings or get_settings()
    return MatchStats(source=source)
