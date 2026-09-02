"""Normalized record types: the boundary between adapters and the database."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NormalizedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProviderRecord(NormalizedRecord):
    """An individual dentist (NPPES entity type 1)."""

    npi: str
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    name_prefix: str | None = None
    name_suffix: str | None = None
    credential_text: str | None = None
    taxonomy_codes: list[str] = Field(default_factory=list)
    primary_taxonomy: str | None = None
    specialty: str | None = None
    enumeration_date: date | None = None
    last_update_date: date | None = None
    deactivation_date: date | None = None
    nppes_status: str | None = None
    sole_proprietor: bool | None = None
    practice_phone_raw: str | None = None
    practice_phone_e164: str | None = None
    practice_fax_e164: str | None = None
    practice_address_raw: str | None = None
    practice_address_line1: str | None = None
    practice_address_line2: str | None = None
    practice_city: str | None = None
    practice_state: str | None = None
    practice_zip: str | None = None
    practice_zip9: str | None = None
    practice_address_key: str | None = None
    mailing_address_raw: str | None = None
    mailing_city: str | None = None
    mailing_state: str | None = None
    mailing_zip: str | None = None
    source_json: dict[str, Any] | None = None


class OrganizationRecord(NormalizedRecord):
    """An NPPES entity type 2 organization: candidate practice anchor."""

    npi: str
    name: str | None = None
    other_names: list[str] = Field(default_factory=list)
    taxonomy_codes: list[str] = Field(default_factory=list)
    primary_taxonomy: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    postal_code9: str | None = None
    address_key: str | None = None
    phone_raw: str | None = None
    phone_e164: str | None = None
    fax_e164: str | None = None
    authorized_official_first_name: str | None = None
    authorized_official_last_name: str | None = None
    authorized_official_credential: str | None = None
    authorized_official_title: str | None = None
    organizational_subpart: bool | None = None
    enumeration_date: date | None = None
    last_update_date: date | None = None
    deactivation_date: date | None = None
    nppes_status: str | None = None
    source_json: dict[str, Any] | None = None


class LicenseRecord(NormalizedRecord):
    """A state license record. Business fields only (hard rule 4)."""

    source: str
    state: str
    license_number: str
    credential_type: str | None = None
    status: str | None = None
    is_active_status: bool = False
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    city: str | None = None
    first_issue_date: date | None = None
    last_issue_date: date | None = None
    expiration_date: date | None = None
    ce_due_date: date | None = None
    action_taken: str | None = None
    source_json: dict[str, Any] | None = None
