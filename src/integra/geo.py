"""Geography helpers. Phase 1 needs Hawaii counties (Oahu == Honolulu County, Maui County)."""

from __future__ import annotations

from functools import lru_cache

from integra.config import load_yaml
from integra.normalize import zip5


@lru_cache
def _hi_zip_to_county() -> dict[str, str]:
    doc = load_yaml("hi_zip_county.yaml") or {}
    out: dict[str, str] = {}
    for county, zips in doc.items():
        for z in zips or []:
            out[str(z).zfill(5)] = str(county)
    return out


def county_for_zip(state: str | None, postal_code: str | None) -> str | None:
    """County name for a ZIP. Only Hawaii is mapped in Phase 1; other states return None."""
    if not state or not postal_code:
        return None
    if state.upper() != "HI":
        return None
    return _hi_zip_to_county().get(zip5(postal_code) or "")
