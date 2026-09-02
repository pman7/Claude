"""Deterministic normalization helpers shared by every adapter and by resolution.

Nothing here invents data: every function returns None when the input cannot be normalized.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from functools import lru_cache

import phonenumbers

from integra.config import load_yaml

CREDENTIAL_TOKENS = frozenset(
    {
        "dds",
        "dmd",
        "md",
        "do",
        "phd",
        "ms",
        "msd",
        "mph",
        "mba",
        "bds",
        "bdsc",
        "facd",
        "facs",
        "faacd",
        "fagd",
        "magd",
        "dr",
        "jr",
        "sr",
        "ii",
        "iii",
        "iv",
        "pc",
        "ps",
        "pllc",
        "llc",
        "inc",
        "esq",
        "dsc",
        "mscd",
        "mds",
        "ma",
        "ba",
        "bs",
        "ficoi",
        "dabp",
        "ficd",
        "facp",
    }
)

_ADDRESS_SUFFIXES = {
    "STREET": "ST",
    "AVENUE": "AVE",
    "AV": "AVE",
    "ROAD": "RD",
    "BOULEVARD": "BLVD",
    "BLV": "BLVD",
    "DRIVE": "DR",
    "LANE": "LN",
    "COURT": "CT",
    "PLACE": "PL",
    "HIGHWAY": "HWY",
    "PARKWAY": "PKWY",
    "CIRCLE": "CIR",
    "TERRACE": "TER",
    "TRAIL": "TRL",
    "WAY": "WAY",
    # One office, one key: a suite written as "Suite", "Ste", "Unit", "#" or "No." is the same
    # suite, so every unit designator collapses to STE (see address_key).
    "SUITE": "STE",
    "SUITES": "STE",
    "UNIT": "STE",
    "#": "STE",
    "APARTMENT": "APT",
    "BUILDING": "BLDG",
    "FLOOR": "FL",
    "ROOM": "RM",
    "NORTH": "N",
    "SOUTH": "S",
    "EAST": "E",
    "WEST": "W",
    "NORTHEAST": "NE",
    "NORTHWEST": "NW",
    "SOUTHEAST": "SE",
    "SOUTHWEST": "SW",
    "NUMBER": "STE",
    "NO": "STE",
    "POB": "PO BOX",
    "PO": "PO",
    "BOX": "BOX",
}
_NON_ALNUM = re.compile(r"[^A-Za-z0-9#&' ]+")
_SPACES = re.compile(r"\s+")


def normalize_phone(raw: str | None, region: str = "US") -> str | None:
    """Return an E.164 phone number or None when the input is not a valid US number."""
    if not raw:
        return None
    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def zip5(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 5:
        return None
    return digits[:5]


def zip9(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    return zip5(digits)


def clean_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = _SPACES.sub(" ", str(raw)).strip()
    return text or None


def normalize_credential_text(raw: str | None) -> str | None:
    """'D.D.S.' -> 'DDS', 'DMD, MS' -> 'DMD MS'."""
    if not raw:
        return None
    text = raw.upper().replace(".", "")
    text = re.sub(r"[,\s]+", " ", text).strip()
    return text or None


def clean_person_name(raw: str | None) -> str:
    """Lowercase, strip punctuation, drop credential and suffix tokens."""
    if not raw:
        return ""
    text = re.sub(r"[^a-z0-9 ]+", " ", raw.lower().replace(".", ""))
    tokens = text.split()
    kept = [t for t in tokens if t not in CREDENTIAL_TOKENS]
    # Surnames such as Do, Ma, Ba or Sr are also credential/suffix tokens: never empty a name.
    return " ".join(kept or tokens)


@lru_cache
def _nicknames() -> dict[str, str]:
    doc = load_yaml("nicknames.yaml") or {}
    return {str(k).lower(): str(v).lower() for k, v in doc.items()}


def canonical_first_name(raw: str | None) -> str:
    """First token of the cleaned first name, with common nicknames expanded."""
    cleaned = clean_person_name(raw)
    if not cleaned:
        return ""
    first = cleaned.split()[0]
    return _nicknames().get(first, first)


def normalized_last_name(raw: str | None) -> str:
    return clean_person_name(raw)


def name_key(first: str | None, last: str | None) -> str:
    """Stable key for exact name matching: canonical first token + cleaned last name."""
    return f"{canonical_first_name(first)}|{normalized_last_name(last)}"


def full_name(first: str | None, last: str | None) -> str:
    return " ".join(p for p in (clean_person_name(first), clean_person_name(last)) if p)


def normalize_address_line(raw: str | None) -> str | None:
    """Uppercase, standard USPS abbreviations, punctuation and repeated spaces removed."""
    if not raw:
        return None
    text = _NON_ALNUM.sub(" ", raw.upper().replace(".", "").replace("#", " # "))
    tokens = [_ADDRESS_SUFFIXES.get(t, t) for t in text.split()]
    out = _SPACES.sub(" ", " ".join(tokens)).strip()
    return out or None


def street_number(line1: str | None) -> str | None:
    if not line1:
        return None
    match = re.match(r"\s*(\d+[A-Za-z]?(?:-\d+)?)", line1)
    return match.group(1).upper() if match else None


def address_key(line1: str | None, postal_code: str | None, line2: str | None = None) -> str | None:
    """Dedupe key: normalized street line(s) + ZIP5. Suite tokens are kept: one suite, one practice.

    line2 is folded in because NPPES puts the suite in address_1 for some records and in
    address_2 for others ("715 S KING ST STE 425" vs "715 S KING ST" + "SUITE 425"), and
    "#425", "UNIT 425" and "Suite 425" all become "STE 425" so they land on the same key.
    """
    line = normalize_address_line(" ".join(part for part in (line1, line2) if part))
    zipcode = zip5(postal_code)
    if not line or not zipcode:
        return None
    return f"{line}|{zipcode}"


def parse_date(raw: str | None) -> date | None:
    """Accepts YYYY-MM-DD, MM/DD/YYYY and ISO timestamps. Returns None otherwise."""
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text[: len(fmt) + 6 if "%f" in fmt else len(text)], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def domain_of(url_or_email: str | None) -> str | None:
    if not url_or_email:
        return None
    text = url_or_email.strip().lower()
    if "@" in text:
        text = text.rsplit("@", 1)[1]
    text = re.sub(r"^[a-z]+://", "", text)
    text = text.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0]
    if text.startswith("www."):
        text = text[4:]
    return text or None
