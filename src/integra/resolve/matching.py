"""Name and license-number matching helpers (CLAUDE.md 6.9).

Pure functions and an in-memory index over providers. No database access here, so every rule
can be unit tested with plain dataclasses.

Match order for one license row:
1. license number digits + taxonomy state found in the provider's NPPES taxonomies -> 0.99
2. exact name key (canonical first + normalized last); same practice state 0.95, else 0.85
3. rapidfuzz token_set_ratio >= 90 on the full name, same practice state only -> 0.80

Anything under LINK_THRESHOLD, or a tie that cannot be broken by practice state, is not
linked: it goes to the review CSV instead of being force-linked (hard rule 9).
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz, process

from integra.normalize import full_name, name_key, normalized_last_name

LINK_THRESHOLD = 0.8
FUZZY_CUTOFF = 90.0

CONF_LICENSE_NUMBER = 0.99
CONF_NAME_EXACT_STATE = 0.95
CONF_NAME_EXACT = 0.85
CONF_NAME_FUZZY_STATE = 0.80

_DIGITS = re.compile(r"\D+")


def license_digits(raw: str | None) -> str | None:
    """'DT-2878' -> '2878', 'DE00012345' -> '12345'. None when there are no digits."""
    if not raw:
        return None
    digits = _DIGITS.sub("", str(raw)).lstrip("0")
    return digits or None


def taxonomy_license_keys(source_json: dict[str, Any] | None) -> frozenset[tuple[str, str]]:
    """(license digits, state) pairs from an NPPES record's taxonomies[] list."""
    keys: set[tuple[str, str]] = set()
    if not source_json:
        return frozenset()
    for taxonomy in source_json.get("taxonomies") or []:
        if not isinstance(taxonomy, dict):
            continue
        digits = license_digits(taxonomy.get("license"))
        state = str(taxonomy.get("state") or "").strip().upper()
        if digits and state:
            keys.add((digits, state))
    return frozenset(keys)


@dataclass(frozen=True)
class ProviderView:
    npi: str
    first_name: str | None
    last_name: str | None
    practice_state: str | None
    license_keys: frozenset[tuple[str, str]] = field(default_factory=frozenset)


@dataclass(frozen=True)
class LicenseView:
    license_number: str
    first_name: str | None
    last_name: str | None
    state: str


@dataclass(frozen=True)
class Candidate:
    npi: str
    confidence: float
    method: str
    practice_state: str | None
    score: float | None = None  # fuzzy score when method is name_fuzzy_state


@dataclass
class MatchOutcome:
    candidates: list[Candidate]
    chosen: Candidate | None
    reason: str  # "linked", "ambiguous", "low_confidence" or "no_candidates"

    @property
    def best(self) -> Candidate | None:
        if not self.candidates:
            return None
        return max(self.candidates, key=lambda c: (c.confidence, c.score or 0.0, c.npi))


class ProviderIndex:
    """Providers indexed once per run: by (license digits, state), by name key, by state."""

    def __init__(self, providers: Iterable[ProviderView]) -> None:
        self.by_npi: dict[str, ProviderView] = {}
        self.by_license: dict[tuple[str, str], list[str]] = defaultdict(list)
        self.by_name_key: dict[str, list[str]] = defaultdict(list)
        self.names_by_state: dict[str, dict[str, str]] = defaultdict(dict)
        for p in providers:
            self.by_npi[p.npi] = p
            for key in p.license_keys:
                self.by_license[key].append(p.npi)
            if normalized_last_name(p.last_name):
                self.by_name_key[name_key(p.first_name, p.last_name)].append(p.npi)
                name = full_name(p.first_name, p.last_name)
                if p.practice_state and name:
                    self.names_by_state[p.practice_state.upper()][p.npi] = name

    def __len__(self) -> int:
        return len(self.by_npi)

    def _candidate(
        self, npi: str, confidence: float, method: str, score: float | None = None
    ) -> Candidate:
        provider = self.by_npi[npi]
        return Candidate(npi, confidence, method, provider.practice_state, score)

    def candidates(self, lic: LicenseView) -> list[Candidate]:
        """Candidates from the first matching tier only, in the documented order."""
        state = lic.state.upper()
        digits = license_digits(lic.license_number)
        if digits:
            hits = self.by_license.get((digits, state)) or []
            if hits:
                return [self._candidate(n, CONF_LICENSE_NUMBER, "license_number") for n in hits]
        if not normalized_last_name(lic.last_name):
            return []
        exact = self.by_name_key.get(name_key(lic.first_name, lic.last_name)) or []
        if exact:
            out: list[Candidate] = []
            for npi in exact:
                same_state = (self.by_npi[npi].practice_state or "").upper() == state
                if same_state:
                    out.append(self._candidate(npi, CONF_NAME_EXACT_STATE, "name_exact_state"))
                else:
                    out.append(self._candidate(npi, CONF_NAME_EXACT, "name_exact"))
            return out
        query = full_name(lic.first_name, lic.last_name)
        choices = self.names_by_state.get(state) or {}
        if not query or not choices:
            return []
        hits = process.extract(
            query, choices, scorer=fuzz.token_set_ratio, score_cutoff=FUZZY_CUTOFF, limit=None
        )
        return [
            self._candidate(npi, CONF_NAME_FUZZY_STATE, "name_fuzzy_state", float(score))
            for _name, score, npi in hits
        ]


def choose(candidates: list[Candidate], license_state: str) -> tuple[Candidate | None, str]:
    """Pick the single best candidate, or explain why none is linked."""
    if not candidates:
        return None, "no_candidates"
    best = max(c.confidence for c in candidates)
    top = [c for c in candidates if c.confidence == best]
    if len(top) > 1:
        same_state = [c for c in top if (c.practice_state or "").upper() == license_state.upper()]
        if len(same_state) != 1:
            return None, "ambiguous"
        top = same_state
    if best < LINK_THRESHOLD:
        return None, "low_confidence"
    return top[0], "linked"


def match_license(index: ProviderIndex, lic: LicenseView) -> MatchOutcome:
    candidates = index.candidates(lic)
    chosen, reason = choose(candidates, lic.state)
    return MatchOutcome(candidates=candidates, chosen=chosen, reason=reason)
