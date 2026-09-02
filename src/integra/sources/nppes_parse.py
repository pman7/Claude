"""Parse NPPES API v2.1 result objects into normalized records.

Every field name used here was confirmed against live responses saved under
tests/fixtures/nppes/ on 2026-09-02 (hard rule 10). Nothing is invented: a missing or
placeholder value ("--") becomes None.
"""

from __future__ import annotations

from typing import Any

from integra.normalize import (
    address_key,
    clean_text,
    normalize_credential_text,
    normalize_phone,
    parse_date,
    zip5,
    zip9,
)
from integra.records import OrganizationRecord, ProviderRecord
from integra.specialty import derive_specialty

NONE_MARKER = "--"  # NPPES uses "--" for "no value" in name_prefix / name_suffix
PURPOSE_LOCATION = "LOCATION"
PURPOSE_MAILING = "MAILING"
ENTITY_INDIVIDUAL = "NPI-1"
ENTITY_ORGANIZATION = "NPI-2"


def text_field(mapping: dict[str, Any], key: str) -> str | None:
    """Trimmed string value, or None when missing, blank, or the "--" placeholder."""
    value = mapping.get(key)
    if value is None:
        return None
    text = clean_text(str(value))
    if text is None or text == NONE_MARKER:
        return None
    return text


def yes_no(value: Any) -> bool | None:
    if value is None:
        return None
    text = str(value).strip().upper()
    if text == "YES":
        return True
    if text == "NO":
        return False
    return None


def address_by_purpose(result: dict[str, Any], purpose: str) -> dict[str, Any]:
    """The first entry in addresses[] with the given address_purpose, else an empty dict."""
    for address in result.get("addresses") or []:
        if str(address.get("address_purpose") or "").upper() == purpose:
            return address
    return {}


def location_state(result: dict[str, Any]) -> str | None:
    state = text_field(address_by_purpose(result, PURPOSE_LOCATION), "state")
    return state.upper() if state else None


def one_line_address(address: dict[str, Any]) -> str | None:
    """Human readable single line: '715 S KING ST STE 425, HONOLULU, HI 96813-3021'."""
    parts = [
        text_field(address, "address_1"),
        text_field(address, "address_2"),
        text_field(address, "city"),
    ]
    state = text_field(address, "state")
    postal = zip9(text_field(address, "postal_code"))
    tail = " ".join(p for p in (state, postal) if p)
    if tail:
        parts.append(tail)
    line = ", ".join(p for p in parts if p)
    return line or None


def taxonomy_codes(result: dict[str, Any]) -> list[str]:
    """All taxonomy codes in API order. A code listed twice (two state licenses) appears once."""
    codes: list[str] = []
    for taxonomy in result.get("taxonomies") or []:
        code = text_field(taxonomy, "code")
        if code and code not in codes:
            codes.append(code)
    return codes


def has_dentist_code(result: dict[str, Any], prefix: str) -> bool:
    return any(code.startswith(prefix) for code in taxonomy_codes(result))


def primary_taxonomy(result: dict[str, Any], prefix: str) -> str | None:
    """The code flagged primary, else the first dentist code, else None."""
    for taxonomy in result.get("taxonomies") or []:
        code = text_field(taxonomy, "code")
        if code and str(taxonomy.get("primary")).lower() == "true":
            return code
    for code in taxonomy_codes(result):
        if code.startswith(prefix):
            return code
    return None


def _state_code(address: dict[str, Any]) -> str | None:
    state = text_field(address, "state")
    return state.upper() if state else None


def parse_provider(result: dict[str, Any], dentist_prefix: str) -> ProviderRecord:
    """NPI-1 result -> ProviderRecord. Caller has already applied the state and taxonomy filters."""
    basic = result.get("basic") or {}
    location = address_by_purpose(result, PURPOSE_LOCATION)
    mailing = address_by_purpose(result, PURPOSE_MAILING)
    codes = taxonomy_codes(result)
    primary = primary_taxonomy(result, dentist_prefix)
    line1 = text_field(location, "address_1")
    location_zip = text_field(location, "postal_code")
    return ProviderRecord(
        npi=str(result["number"]),
        first_name=text_field(basic, "first_name"),
        last_name=text_field(basic, "last_name"),
        middle_name=text_field(basic, "middle_name"),
        name_prefix=text_field(basic, "name_prefix"),
        name_suffix=text_field(basic, "name_suffix"),
        credential_text=normalize_credential_text(text_field(basic, "credential")),
        taxonomy_codes=codes,
        primary_taxonomy=primary,
        specialty=derive_specialty(primary, codes),
        enumeration_date=parse_date(text_field(basic, "enumeration_date")),
        last_update_date=parse_date(text_field(basic, "last_updated")),
        deactivation_date=parse_date(text_field(basic, "deactivation_date")),
        nppes_status=text_field(basic, "status"),
        sole_proprietor=yes_no(basic.get("sole_proprietor")),
        practice_phone_raw=text_field(location, "telephone_number"),
        practice_phone_e164=normalize_phone(text_field(location, "telephone_number")),
        practice_fax_e164=normalize_phone(text_field(location, "fax_number")),
        practice_address_raw=one_line_address(location),
        practice_address_line1=line1,
        practice_address_line2=text_field(location, "address_2"),
        practice_city=text_field(location, "city"),
        practice_state=_state_code(location),
        practice_zip=zip5(location_zip),
        practice_zip9=zip9(location_zip),
        practice_address_key=address_key(line1, location_zip),
        mailing_address_raw=one_line_address(mailing),
        mailing_city=text_field(mailing, "city"),
        mailing_state=_state_code(mailing),
        mailing_zip=zip9(text_field(mailing, "postal_code")),
        source_json=result,
    )


def _other_names(result: dict[str, Any]) -> list[str]:
    """Organization aliases from other_names[]. The live samples all carry an empty list, so the
    element key (organization_name, per the NPPES API documentation) is read defensively."""
    names: list[str] = []
    for entry in result.get("other_names") or []:
        if not isinstance(entry, dict):
            continue
        name = text_field(entry, "organization_name")
        if name and name not in names:
            names.append(name)
    return names


def parse_organization(result: dict[str, Any], dentist_prefix: str) -> OrganizationRecord:
    """NPI-2 result -> OrganizationRecord (candidate practice anchor)."""
    basic = result.get("basic") or {}
    location = address_by_purpose(result, PURPOSE_LOCATION)
    codes = taxonomy_codes(result)
    primary = primary_taxonomy(result, dentist_prefix)
    line1 = text_field(location, "address_1")
    location_zip = text_field(location, "postal_code")
    return OrganizationRecord(
        npi=str(result["number"]),
        name=text_field(basic, "organization_name"),
        other_names=_other_names(result),
        taxonomy_codes=codes,
        primary_taxonomy=primary,
        address_line1=line1,
        address_line2=text_field(location, "address_2"),
        city=text_field(location, "city"),
        state=_state_code(location),
        postal_code=zip5(location_zip),
        postal_code9=zip9(location_zip),
        address_key=address_key(line1, location_zip),
        phone_raw=text_field(location, "telephone_number"),
        phone_e164=normalize_phone(text_field(location, "telephone_number")),
        fax_e164=normalize_phone(text_field(location, "fax_number")),
        authorized_official_first_name=text_field(basic, "authorized_official_first_name"),
        authorized_official_last_name=text_field(basic, "authorized_official_last_name"),
        authorized_official_credential=normalize_credential_text(
            text_field(basic, "authorized_official_credential")
        ),
        authorized_official_title=text_field(basic, "authorized_official_title_or_position"),
        organizational_subpart=yes_no(basic.get("organizational_subpart")),
        enumeration_date=parse_date(text_field(basic, "enumeration_date")),
        last_update_date=parse_date(text_field(basic, "last_updated")),
        deactivation_date=parse_date(text_field(basic, "deactivation_date")),
        nppes_status=text_field(basic, "status"),
        source_json=result,
    )
