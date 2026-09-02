"""Building practice rows from providers and organizations. Used by resolve/practices.py.

One practice per physical office (CLAUDE.md section 5). Members are grouped with union-find:
two records belong to the same office when they share a normalized address key (street line
plus suite plus ZIP5) OR the same phone number within the same ZIP (6.9 rules 2 and 4). NPPES
is inconsistent about suite placement and about which phone a dentist lists, so neither key
alone is enough. A record with neither address nor phone becomes a solo practice keyed by NPI.

Group key (stable across runs): an existing practice's key when one of the group's keys already
names a practice, else the smallest address key, else the smallest phone key, else npi:<npi>.
Methods: address_phone (both kinds of key present), address, phone, npi_solo.
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


def member_keys(member: Member) -> tuple[str | None, str | None]:
    """(address key, phone key) for grouping. Either may be None."""
    address = f"a:{member.address_key}" if member.address_key else None
    zipcode = zip5(member.postal_code)
    if member.phone and zipcode:
        phone = f"pz:{member.phone}|{zipcode}"
    elif member.phone:
        phone = f"p:{member.phone}"
    else:
        phone = None
    return address, phone


def group_members(
    members: list[Member], existing_keys: set[str]
) -> dict[str, tuple[str, list[Member]]]:
    """Group members into offices. Returns {group key: (method, members)}, deterministic."""
    parent = list(range(len(members)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)

    first_seen: dict[str, int] = {}
    for index, member in enumerate(members):
        for key in member_keys(member):
            if key is None:
                continue
            if key in first_seen:
                union(index, first_seen[key])
            else:
                first_seen[key] = index

    grouped: dict[int, list[Member]] = {}
    for index, member in enumerate(members):
        grouped.setdefault(find(index), []).append(member)

    out: dict[str, tuple[str, list[Member]]] = {}
    for group in grouped.values():
        keys = [member_keys(m) for m in group]
        address_keys = sorted({a for a, _ in keys if a})
        phone_keys = sorted({p for _, p in keys if p})
        candidates = address_keys + phone_keys
        if not candidates:
            out[f"npi:{group[0].npi}"] = ("npi_solo", group)
            continue
        reused = sorted(k for k in candidates if k in existing_keys)
        key = reused[0] if reused else candidates[0]
        if address_keys and phone_keys:
            method = "address_phone"
        elif address_keys:
            method = "address"
        else:
            method = "phone"
        out[key] = (method, group)
    return out


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
        key=lambda m: (m.address_key is None, (m.last_name or "").lower(), m.npi),
    )
    anchor = orgs[0] if orgs else providers[0]
    ordered = [*orgs, *providers]
    phone = next((m.phone for m in ordered if m.phone), None)
    fax = next((m.fax for m in ordered if m.fax), None)
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
        "phone_e164": phone,
        "fax_e164": fax,
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
