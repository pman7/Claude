"""SQLAlchemy models for every table in CLAUDE.md section 5.

Design notes:
- providers is keyed by NPI. Licensees that cannot be matched to an NPI are kept in `licenses`
  with provider_npi NULL (and in data/review/unmatched_<source>.csv) instead of synthetic
  provider rows, so the NPI spine stays clean.
- organizations holds NPPES entity type 2 records: candidate practice anchors.
- Nothing is hard deleted (hard rule 8): is_active / deactivated_at flags only.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONB, list[str]: ARRAY(Text)}


class SeenMixin:
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"), nullable=False)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Practice(SeenMixin, Base):
    __tablename__ = "practices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(Text)
    org_npi: Mapped[str | None] = mapped_column(String(10))
    address_line1: Mapped[str | None] = mapped_column(Text)
    address_line2: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(String(2))
    postal_code: Mapped[str | None] = mapped_column(String(10))
    county: Mapped[str | None] = mapped_column(Text)
    address_key: Mapped[str | None] = mapped_column(Text)
    phone_e164: Mapped[str | None] = mapped_column(String(20))
    fax_e164: Mapped[str | None] = mapped_column(String(20))
    website: Mapped[str | None] = mapped_column(Text)
    website_domain: Mapped[str | None] = mapped_column(Text)
    google_place_id: Mapped[str | None] = mapped_column(Text)
    rating: Mapped[float | None] = mapped_column(Numeric(3, 2))
    review_count: Mapped[int | None] = mapped_column(Integer)
    business_status: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Numeric(9, 6))
    lng: Mapped[float | None] = mapped_column(Numeric(9, 6))
    distance_miles_home: Mapped[float | None] = mapped_column(Numeric(7, 2))
    sos_ubi: Mapped[str | None] = mapped_column(Text)
    sos_entity_name: Mapped[str | None] = mapped_column(Text)
    sos_formation_date: Mapped[date | None] = mapped_column(Date)
    is_dso: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
    dso_brand: Mapped[str | None] = mapped_column(Text)
    no_harvest: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
    icp_score: Mapped[int | None] = mapped_column(Integer)
    segment: Mapped[str | None] = mapped_column(Text)
    score_reasons: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    provider_count: Mapped[int | None] = mapped_column(Integer)
    resolution_method: Mapped[str | None] = mapped_column(Text)
    resolution_key: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_practices_phone_address", "phone_e164", "address_key"),
        Index("ix_practices_address_key", "address_key"),
        Index("ix_practices_state_county", "state", "county"),
        Index("ix_practices_resolution_key", "resolution_key", unique=True),
    )


class Provider(SeenMixin, Base):
    __tablename__ = "providers"

    npi: Mapped[str] = mapped_column(String(10), primary_key=True)
    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    middle_name: Mapped[str | None] = mapped_column(Text)
    name_prefix: Mapped[str | None] = mapped_column(Text)
    name_suffix: Mapped[str | None] = mapped_column(Text)
    credential_text: Mapped[str | None] = mapped_column(Text)
    taxonomy_codes: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    primary_taxonomy: Mapped[str | None] = mapped_column(String(10))
    specialty: Mapped[str | None] = mapped_column(Text)
    enumeration_date: Mapped[date | None] = mapped_column(Date)
    last_update_date: Mapped[date | None] = mapped_column(Date)
    deactivation_date: Mapped[date | None] = mapped_column(Date)
    nppes_status: Mapped[str | None] = mapped_column(String(1))
    sole_proprietor: Mapped[bool | None] = mapped_column(Boolean)
    practice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("practices.id", ondelete="SET NULL")
    )
    practice_phone_raw: Mapped[str | None] = mapped_column(Text)
    practice_phone_e164: Mapped[str | None] = mapped_column(String(20))
    practice_fax_e164: Mapped[str | None] = mapped_column(String(20))
    practice_address_raw: Mapped[str | None] = mapped_column(Text)
    practice_address_line1: Mapped[str | None] = mapped_column(Text)
    practice_address_line2: Mapped[str | None] = mapped_column(Text)
    practice_city: Mapped[str | None] = mapped_column(Text)
    practice_state: Mapped[str | None] = mapped_column(String(2))
    practice_zip: Mapped[str | None] = mapped_column(String(5))
    practice_zip9: Mapped[str | None] = mapped_column(String(10))
    practice_address_key: Mapped[str | None] = mapped_column(Text)
    mailing_address_raw: Mapped[str | None] = mapped_column(Text)
    mailing_city: Mapped[str | None] = mapped_column(Text)
    mailing_state: Mapped[str | None] = mapped_column(String(2))
    mailing_zip: Mapped[str | None] = mapped_column(String(10))
    wa_license_number: Mapped[str | None] = mapped_column(Text)
    wa_license_status: Mapped[str | None] = mapped_column(Text)
    wa_first_issue_date: Mapped[date | None] = mapped_column(Date)
    wa_expiration_date: Mapped[date | None] = mapped_column(Date)
    hi_license_number: Mapped[str | None] = mapped_column(Text)
    hi_license_status: Mapped[str | None] = mapped_column(Text)
    hi_first_issue_date: Mapped[date | None] = mapped_column(Date)
    hi_expiration_date: Mapped[date | None] = mapped_column(Date)
    or_license_number: Mapped[str | None] = mapped_column(Text)
    or_license_status: Mapped[str | None] = mapped_column(Text)
    id_license_number: Mapped[str | None] = mapped_column(Text)
    id_license_status: Mapped[str | None] = mapped_column(Text)
    source_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    __table_args__ = (
        Index("ix_providers_practice_id", "practice_id"),
        Index("ix_providers_state_zip", "practice_state", "practice_zip"),
        Index("ix_providers_phone", "practice_phone_e164"),
        Index("ix_providers_last_name", "last_name"),
    )


class Organization(SeenMixin, Base):
    """NPPES entity type 2 records: legal business name, practice address, phone."""

    __tablename__ = "organizations"

    npi: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str | None] = mapped_column(Text)
    other_names: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    taxonomy_codes: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    primary_taxonomy: Mapped[str | None] = mapped_column(String(10))
    address_line1: Mapped[str | None] = mapped_column(Text)
    address_line2: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(String(2))
    postal_code: Mapped[str | None] = mapped_column(String(5))
    postal_code9: Mapped[str | None] = mapped_column(String(10))
    address_key: Mapped[str | None] = mapped_column(Text)
    phone_raw: Mapped[str | None] = mapped_column(Text)
    phone_e164: Mapped[str | None] = mapped_column(String(20))
    fax_e164: Mapped[str | None] = mapped_column(String(20))
    authorized_official_first_name: Mapped[str | None] = mapped_column(Text)
    authorized_official_last_name: Mapped[str | None] = mapped_column(Text)
    authorized_official_credential: Mapped[str | None] = mapped_column(Text)
    authorized_official_title: Mapped[str | None] = mapped_column(Text)
    organizational_subpart: Mapped[bool | None] = mapped_column(Boolean)
    enumeration_date: Mapped[date | None] = mapped_column(Date)
    last_update_date: Mapped[date | None] = mapped_column(Date)
    deactivation_date: Mapped[date | None] = mapped_column(Date)
    nppes_status: Mapped[str | None] = mapped_column(String(1))
    practice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("practices.id", ondelete="SET NULL")
    )
    source_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    __table_args__ = (
        Index("ix_organizations_phone", "phone_e164"),
        Index("ix_organizations_address_key", "address_key"),
    )


class License(SeenMixin, Base):
    """One row per state license record, business fields only. Linked to a provider when matched."""

    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    license_number: Mapped[str] = mapped_column(Text, nullable=False)
    credential_type: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    is_active_status: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )
    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    middle_name: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    first_issue_date: Mapped[date | None] = mapped_column(Date)
    last_issue_date: Mapped[date | None] = mapped_column(Date)
    expiration_date: Mapped[date | None] = mapped_column(Date)
    ce_due_date: Mapped[date | None] = mapped_column(Date)
    action_taken: Mapped[str | None] = mapped_column(Text)
    provider_npi: Mapped[str | None] = mapped_column(
        String(10), ForeignKey("providers.npi", ondelete="SET NULL")
    )
    match_method: Mapped[str | None] = mapped_column(Text)
    match_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint("source", "license_number", name="uq_licenses_source_number"),
        Index("ix_licenses_provider", "provider_npi"),
        Index("ix_licenses_name", "last_name", "first_name"),
        Index("ix_licenses_state_status", "state", "is_active_status"),
    )


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    practice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("practices.id"), nullable=False
    )
    signal_type: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str | None] = mapped_column(String(200))
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "practice_id",
            "signal_type",
            "value",
            "source",
            name="uq_signals_practice_type_value",
            postgresql_nulls_not_distinct=True,  # a NULL value is one signal, not infinitely many
        ),
        Index("ix_signals_practice", "practice_id"),
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    practice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("practices.id"), nullable=False
    )
    provider_npi: Mapped[str | None] = mapped_column(String(10), ForeignKey("providers.npi"))
    email: Mapped[str] = mapped_column(Text, nullable=False)
    email_domain: Mapped[str | None] = mapped_column(Text)
    email_type: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    verification_status: Mapped[str] = mapped_column(
        Text, server_default=text("'unverified'"), nullable=False
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confidence: Mapped[float | None] = mapped_column(Numeric(3, 2))
    suppressed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
    suppression_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("practice_id", "email", name="uq_contacts_practice_email"),
        Index("ix_contacts_email_domain", "email_domain"),
    )


class SourceRun(Base):
    __tablename__ = "source_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, server_default=text("'running'"), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    new_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    updated_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    traceback: Mapped[str | None] = mapped_column(Text)
    snapshot_path: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    notes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    __table_args__ = (Index("ix_source_runs_source_started", "source", "started_at"),)


class Suppression(Base):
    __tablename__ = "suppression"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("kind", "value", "reason", name="uq_suppression"),)


class OutreachLog(Base):
    __tablename__ = "outreach_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(Integer, ForeignKey("contacts.id"), nullable=False)
    campaign: Mapped[str] = mapped_column(Text, nullable=False)
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    export_file: Mapped[str | None] = mapped_column(Text)
