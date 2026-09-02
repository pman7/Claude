"""Config YAML contracts (CLAUDE.md sections 6.9, 7, 8 and 9).

These files are edited by hand; the code relies on their shape, so drift must fail loudly.
"""

from __future__ import annotations

import re

from integra.config import load_yaml

SECTION_8_SIGNALS = (
    "scanner",
    "cerec",
    "implants",
    "ortho_clear",
    "cosmetic",
    "sedation",
    "dso_brand",
    "no_harvest",
    "site_tech",
)
SECTION_7_SPECIALTIES = {"gp", "prosth", "os", "perio", "endo", "ortho", "pedo", "other"}
# Short forms shared by several legal names, pruned from config/nicknames.yaml on 2026-09-02.
PRUNED_NICKNAMES = {"pat", "chris", "sam", "alex", "terry", "jerry", "steven"}


def test_every_keyword_regex_compiles_case_insensitively() -> None:
    keywords = load_yaml("keywords.yaml")
    for signal, patterns in keywords.items():
        assert isinstance(patterns, list) and patterns, f"{signal} has no patterns"
        for pattern in patterns:
            compiled = re.compile(pattern, re.IGNORECASE)
            assert compiled.flags & re.IGNORECASE, f"{signal}: {pattern}"


def test_section_8_signal_names_are_present() -> None:
    assert set(SECTION_8_SIGNALS) <= set(load_yaml("keywords.yaml"))


def test_keyword_regexes_match_page_text_regardless_of_case() -> None:
    keywords = load_yaml("keywords.yaml")
    samples = {
        "scanner": "We scan every case with an ITERO element.",
        "cerec": "Same-Day Crowns milled in house with cerec.",
        "no_harvest": "Do Not Solicit our staff by email.",
    }
    for signal, text in samples.items():
        assert any(re.search(p, text, re.IGNORECASE) for p in keywords[signal]), signal


def test_scoring_rubric_covers_every_specialty_and_clamps_to_0_100() -> None:
    scoring = load_yaml("scoring.yaml")
    assert set(scoring["specialty"]) >= SECTION_7_SPECIALTIES
    assert all(isinstance(points, int) for points in scoring["specialty"].values())
    assert scoring["clamp"] == [0, 100]


def test_each_hawaii_zip_belongs_to_exactly_one_county() -> None:
    counties = load_yaml("hi_zip_county.yaml")
    owner: dict[str, str] = {}
    for county, zips in counties.items():
        for raw in zips:
            zipcode = str(raw).zfill(5)
            assert zipcode not in owner, f"{zipcode} listed under {owner[zipcode]} and {county}"
            owner[zipcode] = county
    assert {"Honolulu", "Maui"} <= set(counties)  # hi_oahu / hi_maui segments depend on them


def test_nicknames_map_to_lowercase_canonical_names_without_chains() -> None:
    nicknames = load_yaml("nicknames.yaml")
    for nick, canonical in nicknames.items():
        assert nick == str(nick).lower(), nick
        assert canonical == str(canonical).lower(), f"{nick}: {canonical}"
        assert canonical not in nicknames, f"{nick} -> {canonical}, which is itself a nickname"
    assert not PRUNED_NICKNAMES & set(nicknames)
