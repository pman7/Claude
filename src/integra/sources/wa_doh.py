"""Washington DOH credential adapter (CLAUDE.md 6.3).

Source: Socrata dataset qxh8-f4bd on data.wa.gov (Health Care Provider Credential Data,
public domain, refreshed daily), read through the SoQL row endpoint.

Hard rule 4 (business fields only, never birth year) is enforced in three places:
1. fetch() first reads the dataset metadata and confirms every configured business field
   exists (hard rule 10); a mismatch raises SchemaDriftError with a metadata snapshot.
2. $select is built from config business_fields only, so birthyear is never requested.
3. Any non-business field that still arrives is stripped before it reaches the raw payload,
   the on-disk cache, or the database. normalize() raises if one slips through anyway.

Every status is kept (raw cache and licenses table); only active statuses feed scoring via
is_active_status. Matching licenses to providers is owned by integra.resolve.licenses.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session, sessionmaker

from integra.config import Settings, SourceConfig
from integra.db.models import License
from integra.db.upsert import UpsertCounts, upsert_rows
from integra.http import FetchResult, HTTPFailure, PoliteClient, write_snapshot
from integra.normalize import clean_text, parse_date
from integra.records import LicenseRecord, NormalizedRecord
from integra.sources.base import Adapter, RawRecord

STATE = "WA"

# Dataset fieldNames, confirmed against tests/fixtures/wa_doh/metadata_columns.json and
# re-verified against the live metadata on every run (see _check_metadata). __init__ asserts
# that each one is listed in config/sources.yaml business_fields, so code and config cannot drift.
KEY_FIELD = "credentialnumber"
TYPE_FIELD = "credentialtype"
FIELD_MAP: dict[str, str] = {
    "credential_type": TYPE_FIELD,
    "status": "status",
    "first_name": "firstname",
    "last_name": "lastname",
    "middle_name": "middlename",
    "first_issue_date": "firstissuedate",
    "last_issue_date": "lastissuedate",
    "expiration_date": "expirationdate",
    "ce_due_date": "ceduedate",
    "action_taken": "actiontaken",
}
DATE_FIELDS = ("first_issue_date", "last_issue_date", "expiration_date", "ce_due_date")

# Personal fields the dataset carries that must never be requested, cached or stored.
FORBIDDEN_FIELDS = frozenset({"birthyear"})

# Business columns compared on upsert. provider_npi / match_* belong to license matching.
COMPARE_COLUMNS = [
    "state",
    "credential_type",
    "status",
    "is_active_status",
    "first_name",
    "last_name",
    "middle_name",
    "city",
    "first_issue_date",
    "last_issue_date",
    "expiration_date",
    "ce_due_date",
    "action_taken",
    "source_json",
]


class SchemaDriftError(HTTPFailure):
    """The remote dataset no longer matches config/sources.yaml. Carries a snapshot path."""


def soql_quote(value: str) -> str:
    """Quote a SoQL string literal; single quotes are escaped by doubling."""
    return "'" + value.replace("'", "''") + "'"


class WaDohAdapter(Adapter):
    name = "wa_doh"

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        config: SourceConfig | None = None,
        session_factory: sessionmaker[Session] | None = None,
        force: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        super().__init__(
            settings=settings, config=config, session_factory=session_factory, force=force
        )
        self.transport = transport
        self.business_fields: list[str] = [str(f) for f in self.config.get("business_fields", [])]
        self.credential_types: list[str] = [str(t) for t in self.config.get("credential_types", [])]
        self.active_statuses: frozenset[str] = frozenset(
            str(s) for s in self.config.get("active_statuses", [])
        )
        self.page_size = int(self.config.get("page_size", 1000))
        self._dropped_fields: set[str] = set()
        if not self.business_fields or not self.credential_types:
            raise ValueError("wa_doh needs business_fields and credential_types in sources.yaml")
        forbidden = FORBIDDEN_FIELDS & set(self.business_fields)
        if forbidden:
            raise ValueError(f"{sorted(forbidden)} listed as business fields; hard rule 4")
        self._guard_business_fields([KEY_FIELD, *FIELD_MAP.values()], "FIELD_MAP")

    # -- guards ------------------------------------------------------------------------------
    def _guard_business_fields(self, fields: Iterable[str], where: str) -> None:
        """Raise if a field outside config business_fields (such as birthyear) reaches `where`."""
        extra = set(fields) - set(self.business_fields)
        if extra:
            raise ValueError(f"non-business field(s) {sorted(extra)} in {where}; hard rule 4")

    # -- http ----------------------------------------------------------------------------------
    def _client(self) -> PoliteClient:
        headers: dict[str, str] = {}
        token = self.settings.secret("socrata_app_token")
        if token:
            headers["X-App-Token"] = token
        self.log.info("client", app_token=bool(token), rate=self.config.rate_limit_per_sec)
        return PoliteClient(
            self.name,
            settings=self.settings,
            rate_limit_per_sec=self.config.rate_limit_per_sec,
            timeout_sec=self.config.timeout_sec,
            max_attempts=self.config.max_attempts,
            headers=headers,
            cache=self.config.cache,
            force=self.force,
            transport=self.transport,
        )

    def _get_json(
        self, client: PoliteClient, url: str, params: dict[str, Any] | None
    ) -> tuple[Any, FetchResult]:
        body, result = client.get_json(url, params)
        if result.from_cache:
            self.stats.cache_hits += 1
        else:
            self.stats.requests += 1
        return body, result

    def _check_metadata(self, client: PoliteClient) -> None:
        """Hard rule 10: confirm every business field exists in the live dataset metadata."""
        url = self.config.get("metadata_url")
        if not url:
            raise ValueError("wa_doh.metadata_url missing in config/sources.yaml")
        body, result = self._get_json(client, url, None)
        columns = body.get("columns") if isinstance(body, dict) else None
        present = {c.get("fieldName") for c in columns or [] if isinstance(c, dict)}
        missing = [f for f in self.business_fields if f not in present]
        if missing:
            snapshot = write_snapshot(self.settings, self.name, result.text, ".json")
            raise SchemaDriftError(
                f"dataset metadata lacks business field(s) {missing}; "
                f"columns present: {sorted(f for f in present if f)}. "
                "Compare the snapshot with config/sources.yaml wa_doh.business_fields.",
                url=result.url,
                snapshot_path=snapshot,
            )
        self.log.info(
            "metadata.ok", columns=len(present), business_fields=len(self.business_fields)
        )

    # -- fetch ---------------------------------------------------------------------------------
    def _where_clause(self) -> str:
        types = ",".join(soql_quote(t) for t in self.credential_types)
        return f"{TYPE_FIELD} in ({types})"

    def fetch(self, *, state: str | None = None, limit: int | None = None) -> Iterator[RawRecord]:
        if state not in (None, STATE):
            self.stats.notes.append(f"wa_doh covers {STATE} only; state {state} skipped")
            return
        select_fields = list(self.business_fields)
        self._guard_business_fields(select_fields, "$select")
        page_size = min(self.page_size, limit) if limit else self.page_size
        params: dict[str, Any] = {
            "$select": ",".join(select_fields),
            "$where": self._where_clause(),
            "$order": KEY_FIELD,
            "$limit": page_size,
        }
        base_url = self.config.base_url
        if not base_url:
            raise ValueError("wa_doh.base_url missing in config/sources.yaml")
        with self._client() as client:
            self._check_metadata(client)
            offset = 0
            while True:
                body, result = self._get_json(client, base_url, {**params, "$offset": offset})
                rows = self._business_rows(body, result)
                self.log.info("page", offset=offset, rows=len(rows), cached=result.from_cache)
                for row in rows:
                    key = clean_text(row.get(KEY_FIELD))
                    if not key:
                        self.stats.notes.append(f"row without {KEY_FIELD} at offset {offset}")
                        continue
                    yield RawRecord(
                        source=self.name,
                        key=key,
                        payload=row,
                        fetched_at=result.fetched_at,
                        from_cache=result.from_cache,
                        cache_path=str(result.cache_path) if result.cache_path else None,
                    )
                if len(rows) < page_size:
                    break
                offset += page_size
        if self._dropped_fields:
            self.stats.notes.append(
                f"stripped non-business field(s) {sorted(self._dropped_fields)} from rows"
            )

    def _business_rows(self, body: Any, result: FetchResult) -> list[dict[str, Any]]:
        """Keep business fields only. Anything else is dropped from the payload and the cache."""
        if not isinstance(body, list) or not all(isinstance(r, dict) for r in body):
            snapshot = write_snapshot(self.settings, self.name, result.text, ".json")
            raise SchemaDriftError(
                "expected a JSON array of row objects", url=result.url, snapshot_path=snapshot
            )
        dropped: set[str] = set()
        rows: list[dict[str, Any]] = []
        for row in body:
            dropped |= set(row) - set(self.business_fields)
            rows.append({f: row[f] for f in self.business_fields if f in row})
        if dropped:
            self.log.warning("non_business_fields_stripped", fields=sorted(dropped))
            self._dropped_fields |= dropped
            self._scrub_cache(result, rows)
        return rows

    @staticmethod
    def _scrub_cache(result: FetchResult, rows: list[dict[str, Any]]) -> None:
        """Rewrite the cached response body with business fields only (hard rule 4)."""
        if result.cache_path is None:
            return
        path = Path(result.cache_path)
        envelope = json.loads(path.read_text(encoding="utf-8"))
        envelope["body"] = json.dumps(rows)
        envelope["scrubbed"] = True
        path.write_text(json.dumps(envelope), encoding="utf-8")

    # -- normalize -----------------------------------------------------------------------------
    def normalize(self, raw: RawRecord) -> NormalizedRecord | None:
        self._guard_business_fields(raw.payload, "raw payload")
        row = raw.payload
        text = {attr: clean_text(row.get(field)) for attr, field in FIELD_MAP.items()}
        dates = {attr: parse_date(text.pop(attr)) for attr in DATE_FIELDS}
        return LicenseRecord(
            source=self.name,
            state=STATE,
            license_number=raw.key,
            is_active_status=text["status"] in self.active_statuses,
            source_json=dict(row),
            **text,
            **dates,
        )

    # -- upsert --------------------------------------------------------------------------------
    def upsert(self, records: Iterable[NormalizedRecord]) -> UpsertCounts:
        rows: dict[str, dict[str, Any]] = {}
        for record in records:
            if isinstance(record, LicenseRecord):
                rows[record.license_number] = record.model_dump()  # last row per key wins
        with self.session_factory() as session:
            counts = upsert_rows(
                session,
                License.__table__,
                rows.values(),
                conflict_columns=["source", "license_number"],
                compare_columns=COMPARE_COLUMNS,
            )
            session.commit()
        return counts

    def after_run(self) -> None:
        from integra.resolve.licenses import match_licenses

        stats = match_licenses(self.session_factory, source=self.name, settings=self.settings)
        self.stats.notes.append(stats.summary())
