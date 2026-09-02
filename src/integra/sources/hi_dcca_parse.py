"""Pure HTML parsing for the Hawaii DCCA MyPVL public license search (no Playwright here).

The real DOM is unverified until the first live run captures it (see
tests/fixtures/hi_dcca/mypvl_search_page_notes.md). Everything below is therefore written
generically: the results table is found by its header text (Name | License | License Type |
Location), detail pages are read as label/value pairs, and anything not found stays None.
Nothing in this module invents data (hard rule 9).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from bs4 import BeautifulSoup
from bs4.element import Tag

from integra.normalize import CREDENTIAL_TOKENS, clean_text, parse_date

# Header text (lowercased, whitespace collapsed) -> row field. "license" alone is the number.
HEADER_FIELDS: dict[str, str] = {
    "name": "name",
    "licensee": "name",
    "licensee name": "name",
    "license": "license_number",
    "license number": "license_number",
    "license #": "license_number",
    "license no": "license_number",
    "license no.": "license_number",
    "license type": "license_type",
    "type": "license_type",
    "location": "location",
    "city": "location",
}
REQUIRED_FIELDS = ("name", "license_number", "license_type")

# Lowercase markers of a bot challenge or block page. Any hit means stop (hard rule 1).
CHALLENGE_MARKERS = (
    "verify you are human",
    "checking your browser",
    "just a moment",
    "attention required",
    "access denied",
    "captcha",
    "cf-challenge",
    "challenge-platform",
    "cf-turnstile",
    "cf-browser-verification",
    "please enable cookies",
)

# Lowercase markers of a legitimate empty result.
NO_RESULTS_MARKERS = (
    "no records",
    "no results",
    "no license",
    "no matching",
    "not found",
    "0 results",
    "0 records",
)

_LICENSE_RE = re.compile(r"^\s*([A-Za-z]+)\s*[-–—\s]?\s*0*(\d+)\s*$")


@dataclass
class ResultRow:
    name: str | None
    license_number: str | None
    license_type: str | None
    location: str | None
    detail_href: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _norm(text: str | None) -> str:
    return (clean_text(text) or "").lower()


# -- challenge / empty detection -------------------------------------------------------------


def looks_like_challenge(html: str) -> str | None:
    """Return the first challenge marker found in `html`, or None when the page looks normal."""
    lowered = html.lower()
    for marker in CHALLENGE_MARKERS:
        if marker in lowered:
            return marker
    return None


def looks_like_no_results(html: str) -> bool:
    lowered = html.lower()
    return any(marker in lowered for marker in NO_RESULTS_MARKERS)


# -- results table ----------------------------------------------------------------------------


def _header_cells(table: Tag) -> list[Tag]:
    """Header cells: <th> anywhere in the table, else the cells of the first row."""
    heads = table.find_all("th")
    if heads:
        return heads
    first = table.find("tr")
    return first.find_all(["td", "th"]) if first else []


def _column_map(table: Tag) -> dict[int, str] | None:
    columns: dict[int, str] = {}
    for index, cell in enumerate(_header_cells(table)):
        field = HEADER_FIELDS.get(_norm(cell.get_text(" ")))
        if field and field not in columns.values():
            columns[index] = field
    if all(field in columns.values() for field in REQUIRED_FIELDS):
        return columns
    return None


def find_results_table(soup: BeautifulSoup) -> tuple[Tag, dict[int, str]] | None:
    """The first table whose header cells cover Name, License and License Type."""
    for table in soup.find_all("table"):
        columns = _column_map(table)
        if columns:
            return table, columns
    return None


def _body_rows(table: Tag, header_row: Tag | None) -> list[Tag]:
    rows = [tr for tr in table.find_all("tr") if tr is not header_row and not tr.find("th")]
    return [tr for tr in rows if tr.find("td")]


def parse_results_table(html: str) -> list[ResultRow] | None:
    """Rows of the results table, or None when no results table is present at all."""
    soup = BeautifulSoup(html, "html.parser")
    found = find_results_table(soup)
    if found is None:
        return None
    table, columns = found
    header_row = table.find("th")
    header_row = header_row.find_parent("tr") if header_row else table.find("tr")
    rows: list[ResultRow] = []
    for tr in _body_rows(table, header_row):
        cells = tr.find_all("td")
        values: dict[str, str | None] = {}
        for index, field in columns.items():
            values[field] = clean_text(cells[index].get_text(" ")) if index < len(cells) else None
        if not values.get("license_number") and not values.get("name"):
            continue  # spacer or message row
        link = tr.find("a", href=True)
        rows.append(
            ResultRow(
                name=values.get("name"),
                license_number=values.get("license_number"),
                license_type=values.get("license_type"),
                location=values.get("location"),
                detail_href=str(link["href"]).strip() if link else None,
            )
        )
    return rows


def filter_license_types(rows: list[ResultRow], license_types: list[str]) -> list[ResultRow]:
    wanted = {_norm(t) for t in license_types}
    return [row for row in rows if _norm(row.license_type) in wanted]


# -- license numbers and names -------------------------------------------------------------------


def normalize_license_number(raw: str | None, prefix: str) -> str | None:
    """'DT1513', 'DT 939', 'dt-2878' -> 'DT-1513', 'DT-939', 'DT-2878'. Other shapes are kept."""
    text = clean_text(raw)
    if not text:
        return None
    match = _LICENSE_RE.match(text)
    if match and match.group(1).upper() == prefix.upper():
        return f"{prefix.upper()}-{int(match.group(2))}"
    return text.upper()


def _strip_credentials(tokens: list[str]) -> list[str]:
    while tokens and tokens[-1].lower().replace(".", "") in CREDENTIAL_TOKENS:
        tokens.pop()
    return tokens


def split_name(raw: str | None) -> tuple[str | None, str | None, str | None]:
    """(first, middle, last). 'Last, First M' or 'First M Last'; single tokens become last."""
    text = clean_text(raw)
    if not text:
        return None, None, None
    if "," in text:
        last_part, _, first_part = text.partition(",")
        last = clean_text(last_part)
        rest = _strip_credentials(first_part.split())
        first = rest[0] if rest else None
        middle = " ".join(rest[1:]) or None
        return first, middle, last
    tokens = _strip_credentials(text.split())
    if not tokens:
        return None, None, None
    if len(tokens) == 1:
        return None, None, tokens[0]
    return tokens[0], " ".join(tokens[1:-1]) or None, tokens[-1]


def city_from_location(location: str | None) -> str | None:
    """'HONOLULU, HI' -> 'HONOLULU'. A bare state code is not a city."""
    text = clean_text(location)
    if not text:
        return None
    city = clean_text(text.split(",", 1)[0])
    if not city or re.fullmatch(r"[A-Za-z]{2}", city):
        return None
    return city


# -- detail page --------------------------------------------------------------------------------


def _label_value_pairs(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """Candidate (label, value) pairs from dl, two-cell table rows, and 'Label:' + sibling."""
    pairs: list[tuple[str, str]] = []
    for dt in soup.find_all("dt"):
        dd = dt.find_next_sibling("dd")
        if dd:
            pairs.append((_norm(dt.get_text(" ")), clean_text(dd.get_text(" ")) or ""))
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) == 2:
            pairs.append((_norm(cells[0].get_text(" ")), clean_text(cells[1].get_text(" ")) or ""))
    for tag in soup.find_all(["label", "span", "strong", "b", "div", "p"]):
        own = clean_text(tag.get_text(" ")) or ""
        if not own.endswith(":") or len(own) > 60:
            continue
        sibling = tag.find_next_sibling()
        if sibling is None:
            continue
        pairs.append((_norm(own.rstrip(":")), clean_text(sibling.get_text(" ")) or ""))
    return pairs


def _first_value(
    pairs: list[tuple[str, str]], needle: str, *, exclude: tuple[str, ...] = ()
) -> str | None:
    for label, value in pairs:
        if needle in label and value and not any(x in label for x in exclude):
            return value
    return None


def _iso_date(raw: str | None) -> str | None:
    parsed = parse_date(raw) if raw else None
    return parsed.isoformat() if parsed else None


def parse_detail_page(html: str) -> dict[str, Any]:
    """Best-effort status / first_issue_date / expiration_date. Missing values stay None.

    Dates are returned as ISO strings (the payload is stored as JSON); normalize() re-parses.
    """
    pairs = _label_value_pairs(BeautifulSoup(html, "html.parser"))
    issued = _first_value(pairs, "original") or _first_value(pairs, "issue", exclude=("expir",))
    return {
        "status": clean_text(_first_value(pairs, "status")),
        "first_issue_date": _iso_date(issued),
        "expiration_date": _iso_date(_first_value(pairs, "expir")),
    }
