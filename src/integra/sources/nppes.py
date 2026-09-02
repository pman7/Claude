"""NPPES (federal NPI registry) adapter, API mode (CLAUDE.md 6.2). Spine of the database.

Query shape (confirmed live 2026-09-02, samples in tests/fixtures/nppes/):
    GET {base_url}?version=2.1&taxonomy_description=Dentist&postal_code=968*
        &address_purpose=LOCATION&enumeration_type=NPI-1&limit=200&skip=0
`taxonomy_description` is a substring match, so "Dentist" covers the whole 1223 family.
`address_purpose=LOCATION` restricts the ZIP match to the practice address; without it the API
also returns dentists whose *mailing* address is in the state, so normalize() re-checks the
LOCATION state as a guard. `skip` is capped (config max_skip), so each state is partitioned by
ZIP3 prefix and any partition that would need a deeper page is subdivided by appending digits.

Bulk-file mode (monthly NPPES Data Dissemination full file plus weekly incrementals, streamed
row by row, filtered on the 15 taxonomy columns starting with 1223) is Phase 5 and is not
implemented here.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Iterator
from typing import Any, ClassVar

import httpx
from sqlalchemy import func, update

from integra.db.models import Organization, Provider
from integra.db.upsert import UpsertCounts, upsert_rows
from integra.http import FetchResult, HTTPFailure, PoliteClient, write_snapshot
from integra.records import NormalizedRecord, OrganizationRecord, ProviderRecord
from integra.resolve.licenses import SOURCE_STATES, match_licenses
from integra.sources.base import Adapter, RawRecord
from integra.sources.nppes_parse import (
    ENTITY_INDIVIDUAL,
    ENTITY_ORGANIZATION,
    address_state,
    has_dentist_code,
    is_secondary_location,
    parse_organization,
    parse_provider,
    select_location,
)

MAX_PREFIX_DIGITS = 5  # a full ZIP5; there is nothing finer to subdivide by

# Business columns: everything the records carry except the key. first_seen / last_seen /
# updated_at / is_active / practice_id are managed by upsert_rows and resolution, not here.
PROVIDER_COMPARE = [f for f in ProviderRecord.model_fields if f != "npi"]
ORGANIZATION_COMPARE = [f for f in OrganizationRecord.model_fields if f != "npi"]


class NppesAdapter(Adapter):
    name: ClassVar[str] = "nppes"

    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._transport = transport
        self._sleep = sleep
        self.page_size = int(self.config.get("page_size", 200))
        self.max_skip = int(self.config.get("max_skip", 1000))
        self.dentist_prefix = str(self.config.get("dentist_taxonomy_prefix", "1223"))
        self.enumeration_types: list[str] = list(self.config.get("enumeration_types") or [])
        self.states_config: dict[str, list[str]] = {
            str(k).upper(): [str(p) for p in v]
            for k, v in (self.config.get("states") or {}).items()
        }
        # normalize() rejects records outside these; fetch() narrows them to the requested state.
        self.target_states: set[str] = set(self.states_config)
        self._run_states: list[str] = []
        self._run_limit: int | None = None
        self._secondary_locations = 0

    # -- fetch -------------------------------------------------------------------------------
    def _client(self) -> PoliteClient:
        return PoliteClient(
            self.name,
            settings=self.settings,
            rate_limit_per_sec=self.config.rate_limit_per_sec,
            timeout_sec=self.config.timeout_sec,
            max_attempts=self.config.max_attempts,
            cache=self.config.cache,
            force=self.force,
            transport=self._transport,
            sleep=self._sleep,
        )

    def _states_for(self, state: str | None) -> list[str]:
        if state is None:
            return list(self.states_config)
        wanted = state.upper()
        if wanted not in self.states_config:
            raise ValueError(
                f"state {wanted!r} is not configured for nppes; known: {sorted(self.states_config)}"
            )
        return [wanted]

    def fetch(self, *, state: str | None = None, limit: int | None = None) -> Iterator[RawRecord]:
        states = self._states_for(state)
        self.target_states = set(states)
        self._run_states = states
        self._run_limit = limit
        seen: set[str] = set()
        yielded = 0
        with self._client() as client:
            for st in states:
                for prefix in self.states_config[st]:
                    for entity_type in self.enumeration_types:
                        for result, fetched in self._iter_partition(client, prefix, entity_type):
                            npi = str(result.get("number") or "").strip()
                            if not npi or npi in seen:
                                continue
                            seen.add(npi)
                            yield RawRecord(
                                source=self.name,
                                key=npi,
                                payload=result,
                                fetched_at=fetched.fetched_at,
                                from_cache=fetched.from_cache,
                                cache_path=str(fetched.cache_path) if fetched.cache_path else None,
                            )
                            yielded += 1
                            if limit and yielded >= limit:
                                return

    def _iter_partition(
        self, client: PoliteClient, prefix: str, entity_type: str
    ) -> Iterator[tuple[dict[str, Any], FetchResult]]:
        """Page one (ZIP prefix, entity type) partition; subdivide when skip would exceed max_skip.

        A subdivided partition re-fetches the records its coarse pages already returned; fetch()
        dedupes them by NPI, and the cache keeps the coarse pages from being re-downloaded.
        """
        skip = 0
        while True:
            results, fetched = self._page(client, prefix, entity_type, skip)
            for result in results:
                yield result, fetched
            if len(results) < self.page_size:
                return
            skip += self.page_size
            if skip <= self.max_skip:
                continue
            if len(prefix) >= MAX_PREFIX_DIGITS:
                note = (
                    f"{entity_type} postal_code {prefix}* still full at skip {skip} and cannot be"
                    f" subdivided further; records beyond max_skip {self.max_skip} were not fetched"
                )
                self.stats.notes.append(note)
                self.log.warning("fetch.partition_truncated", prefix=prefix, entity=entity_type)
                return
            self.stats.notes.append(
                f"{entity_type} postal_code {prefix}* needs skip {skip} > max_skip"
                f" {self.max_skip}; subdivided into {prefix}0*..{prefix}9*"
            )
            self.log.info("fetch.subdivide", prefix=prefix, entity=entity_type, skip=skip)
            for digit in "0123456789":
                yield from self._iter_partition(client, prefix + digit, entity_type)
            return

    def _page(
        self, client: PoliteClient, prefix: str, entity_type: str, skip: int
    ) -> tuple[list[dict[str, Any]], FetchResult]:
        params = {
            "version": str(self.config.get("version", "2.1")),
            "taxonomy_description": str(self.config.get("taxonomy_description", "Dentist")),
            "postal_code": f"{prefix}*",
            "address_purpose": str(self.config.get("address_purpose", "LOCATION")),
            "enumeration_type": entity_type,
            "limit": self.page_size,
            "skip": skip,
        }
        body, fetched = client.get_json(str(self.config.base_url), params)
        if fetched.from_cache:
            self.stats.cache_hits += 1
        else:
            self.stats.requests += 1
        results = body.get("results") if isinstance(body, dict) else None
        if not isinstance(results, list):
            # The API answers {"Errors": [...]} for a rejected query. Snapshot it for repair.
            snapshot = write_snapshot(self.settings, self.name, fetched.text, ".json")
            raise HTTPFailure(
                f"unexpected NPPES response shape for postal_code {prefix}* {entity_type}",
                url=fetched.url,
                status_code=fetched.status_code,
                snapshot_path=snapshot,
            )
        self.log.debug(
            "fetch.page",
            prefix=prefix,
            entity=entity_type,
            skip=skip,
            count=len(results),
            cached=fetched.from_cache,
        )
        return [r for r in results if isinstance(r, dict)], fetched

    # -- normalize ---------------------------------------------------------------------------
    def normalize(self, raw: RawRecord) -> NormalizedRecord | None:
        result = raw.payload
        location = select_location(result, self.target_states)
        state = address_state(location)
        if state not in self.target_states:
            self.log.debug("normalize.skip_state", npi=raw.key, state=state)
            return None
        if not has_dentist_code(result, self.dentist_prefix):
            self.log.debug("normalize.skip_taxonomy", npi=raw.key)
            return None
        if is_secondary_location(result, location):
            self._secondary_locations += 1
            self.log.debug("normalize.secondary_location", npi=raw.key, state=state)
        entity_type = str(result.get("enumeration_type") or "")
        if entity_type == ENTITY_INDIVIDUAL:
            return parse_provider(result, self.dentist_prefix, location)
        if entity_type == ENTITY_ORGANIZATION:
            return parse_organization(result, self.dentist_prefix, location)
        self.log.warning("normalize.unknown_entity_type", npi=raw.key, entity_type=entity_type)
        return None

    # -- upsert ------------------------------------------------------------------------------
    def upsert(self, records: Iterable[NormalizedRecord]) -> UpsertCounts:
        providers: list[dict[str, Any]] = []
        organizations: list[dict[str, Any]] = []
        for record in records:
            if isinstance(record, ProviderRecord):
                providers.append(record.model_dump())
            elif isinstance(record, OrganizationRecord):
                organizations.append(record.model_dump())
        counts = UpsertCounts()
        with self.session_factory() as session:
            if providers:
                counts += upsert_rows(
                    session,
                    Provider.__table__,
                    providers,
                    conflict_columns=["npi"],
                    compare_columns=PROVIDER_COMPARE,
                )
            if organizations:
                counts += upsert_rows(
                    session,
                    Organization.__table__,
                    organizations,
                    conflict_columns=["npi"],
                    compare_columns=ORGANIZATION_COMPARE,
                )
            session.commit()
        self.log.info(
            "upsert.batch",
            providers=len(providers),
            organizations=len(organizations),
            inserted=counts.inserted,
            updated=counts.updated,
            unchanged=counts.unchanged,
        )
        return counts

    def after_run(self) -> None:
        """Flag records that vanished or were deactivated, then re-run the license linker."""
        if self._secondary_locations:
            self.stats.notes.append(
                f"{self._secondary_locations} records use a secondary practice location in state"
            )
        if self._run_limit is None and self._run_states:
            self._deactivate_unseen()
        for source in SOURCE_STATES:
            stats = match_licenses(self.session_factory, source=source, settings=self.settings)
            if stats.considered:
                self.stats.notes.append(stats.summary())

    def _deactivate_unseen(self) -> None:
        """After a complete pull (no --limit) flag records NPPES no longer returns for the pulled
        states, plus records NPPES itself marks deactivated. Never deletes (hard rule 8)."""
        started = self.stats.started_at
        states = list(self._run_states)
        unseen = deactivated = 0
        with self.session_factory() as session:
            for table, state_column in (
                (Provider.__table__, "practice_state"),
                (Organization.__table__, "state"),
            ):
                gone = (
                    update(table)
                    .where(
                        table.c.is_active.is_(True),
                        table.c[state_column].in_(states),
                        table.c.last_seen < started,
                    )
                    .values(is_active=False, deactivated_at=func.now())
                )
                unseen += session.execute(gone).rowcount or 0
                flagged = (
                    update(table)
                    .where(table.c.is_active.is_(True), table.c.nppes_status == "D")
                    .values(is_active=False, deactivated_at=func.now())
                )
                deactivated += session.execute(flagged).rowcount or 0
            session.commit()
        if unseen or deactivated:
            self.stats.notes.append(
                f"{unseen} records not returned this run and {deactivated} NPPES-deactivated"
                f" records flagged inactive for {', '.join(states)}"
            )
        self.log.info("deactivate", unseen=unseen, nppes_deactivated=deactivated, states=states)
