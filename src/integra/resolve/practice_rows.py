"""Building practice rows from providers and organizations. Used by resolve/practices.py.

Resolution key per record (deterministic, every record gets one):

    pa:<phone>|<address_key>   phone and address both known   (method phone_address)
    a:<address_key>            address only                   (method address)
    p:<phone>                  phone only                     (method phone)
    npi:<npi>                  neither: a solo practice       (method npi_solo)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from integra.db.models import Organization, Practice, Provider
from integra.geo import county_for_zip
from integra.normalize import zip5


@dataclass(frozen=True)
class Member:
    """A provider or organization as resolution sees it."""

    kind: str  # "provider" or "organization"
    npi: str
    last_name: str | None
    org_name: str | None
    phone: str | None
    fax: str | None
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    postal_code: str | None
    address_key: str | None
    practice_id: uuid.UUID | None

    @property
    def is_org(self) -> bool:
        return self.kind == "organization"


def resolution_key(phone: str | None, address_key: str | None, npi: str) -> tuple[str, str]:
    """(key, method). Falls back to the NPI so every record lands in some practice."""
    if phone and address_key:
        return f"pa:{phone}|{address_key}", "phone_address"
    if address_key:
        return f"a:{address_key}", "address"
    if phone:
        return f"p:{phone}", "phone"
    return f"npi:{npi}", "npi_solo"


def fallback_name(providers: list[Member]) -> str | None:
    """'Dr. <Last Name>' of the first provider by last name, until Google Maps supplies a name."""
    for member in providers:
        last = (member.last_name or "").strip()
        if last:
            return f"Dr. {last.title() if last.isupper() else last}"
    return None


def build_practice_row(
    key: str, method: str, members: list[Member], existing: Practice | None
) -> dict[str, Any]:
    orgs = sorted(
        (m for m in members if m.is_org),
        key=lambda m: (m.org_name is None, -len(m.org_name or ""), m.npi),
    )
    providers = sorted(
        (m for m in members if not m.is_org),
        key=lambda m: ((m.last_name or "").lower(), m.npi),
    )
    anchor = orgs[0] if orgs else providers[0]
    org_name = orgs[0].org_name if orgs else None
    if existing is not None and existing.google_place_id and existing.name:
        name = existing.name  # Google Maps name wins (CLAUDE.md section 5)
    elif org_name:
        name = org_name
    elif existing is not None and existing.name:
        name = existing.name  # never overwrite a name resolution did not set
    else:
        name = fallback_name(providers)
    postal = zip5(anchor.postal_code)
    state = anchor.state.upper() if anchor.state else None
    return {
        "id": existing.id if existing is not None else uuid.uuid4(),
        "resolution_key": key,
        "resolution_method": method,
        "name": name,
        "org_npi": orgs[0].npi if orgs else None,
        "address_line1": anchor.address_line1,
        "address_line2": anchor.address_line2,
        "city": anchor.city,
        "state": state,
        "postal_code": postal,
        "county": county_for_zip(state, postal),
        "address_key": anchor.address_key,
        "phone_e164": anchor.phone,
        "fax_e164": anchor.fax,
        "provider_count": len(providers),
    }


def load_members(session: Session) -> list[Member]:
    members: list[Member] = []
    providers = session.execute(
        select(
            Provider.npi,
            Provider.last_name,
            Provider.practice_phone_e164,
            Provider.practice_fax_e164,
            Provider.practice_address_line1,
            Provider.practice_address_line2,
            Provider.practice_city,
            Provider.practice_state,
            Provider.practice_zip,
            Provider.practice_address_key,
            Provider.practice_id,
        ).where(Provider.is_active.is_(True))
    )
    for npi, last, phone, fax, l1, l2, city, state, zipc, akey, pid in providers:
        members.append(
            Member("provider", npi, last, None, phone, fax, l1, l2, city, state, zipc, akey, pid)
        )
    organizations = session.execute(
        select(
            Organization.npi,
            Organization.name,
            Organization.phone_e164,
            Organization.fax_e164,
            Organization.address_line1,
            Organization.address_line2,
            Organization.city,
            Organization.state,
            Organization.postal_code,
            Organization.address_key,
            Organization.practice_id,
        ).where(Organization.is_active.is_(True))
    )
    for npi, name, phone, fax, l1, l2, city, state, zipc, akey, pid in organizations:
        members.append(
            Member(
                "organization", npi, None, name, phone, fax, l1, l2, city, state, zipc, akey, pid
            )
        )
    return members
