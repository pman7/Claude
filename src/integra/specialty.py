"""Specialty derivation from NUCC taxonomy codes (CLAUDE.md section 7).

Codes verified against live NPPES responses on 2026-09-02 (tests/fixtures/nppes).
"""

from __future__ import annotations

DENTIST_TAXONOMY_PREFIX = "1223"

TAXONOMY_TO_SPECIALTY: dict[str, str] = {
    "122300000X": "gp",  # Dentist
    "1223G0001X": "gp",  # Dentist, General Practice
    "1223P0700X": "prosth",  # Dentist, Prosthodontics
    "1223S0112X": "os",  # Dentist, Oral and Maxillofacial Surgery
    "1223P0300X": "perio",  # Dentist, Periodontics
    "1223E0200X": "endo",  # Dentist, Endodontics
    "1223X0400X": "ortho",  # Dentist, Orthodontics and Dentofacial Orthopedics
    "1223P0221X": "pedo",  # Dentist, Pediatric Dentistry
    "1223D0001X": "other",  # Dental Public Health
    "1223P0106X": "other",  # Oral and Maxillofacial Pathology
    "1223X0008X": "other",  # Oral and Maxillofacial Radiology
    "1223X2210X": "other",  # Orofacial Pain
    "1223D0004X": "other",  # Dentist Anesthesiologist
}

# Lab-relevance rank used when a provider carries several dentist codes and none is primary.
_SPECIALTY_RANK = {
    "prosth": 0,
    "os": 1,
    "perio": 2,
    "gp": 3,
    "endo": 4,
    "other": 5,
    "ortho": 6,
    "pedo": 7,
}


def is_dentist_code(code: str | None) -> bool:
    return bool(code) and code.startswith(DENTIST_TAXONOMY_PREFIX)


def specialty_for_code(code: str | None) -> str | None:
    if not code:
        return None
    if code in TAXONOMY_TO_SPECIALTY:
        return TAXONOMY_TO_SPECIALTY[code]
    if is_dentist_code(code):
        return "other"
    return None


def derive_specialty(primary_code: str | None, all_codes: list[str] | None = None) -> str | None:
    """Primary dentist taxonomy wins; otherwise the most lab-relevant dentist code present."""
    primary = specialty_for_code(primary_code)
    if primary is not None:
        return primary
    candidates = [s for s in (specialty_for_code(c) for c in all_codes or []) if s is not None]
    if not candidates:
        return None
    return min(candidates, key=lambda s: _SPECIALTY_RANK.get(s, 99))
