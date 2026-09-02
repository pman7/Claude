"""Idempotent upserts. Running the same input twice changes only last_seen.

`updated_at` moves only when a compared column actually changed, so idempotency is measurable:
the returned counts split rows into inserted, updated and unchanged.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Table, case, false, func, literal_column, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

BATCH_SIZE = 500


@dataclass
class UpsertCounts:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0

    @property
    def total(self) -> int:
        return self.inserted + self.updated + self.unchanged

    def __iadd__(self, other: UpsertCounts) -> UpsertCounts:
        self.inserted += other.inserted
        self.updated += other.updated
        self.unchanged += other.unchanged
        return self


def upsert_rows(
    session: Session,
    table: Table,
    rows: Iterable[dict[str, Any]],
    *,
    conflict_columns: Sequence[str],
    compare_columns: Sequence[str],
    seen_columns: bool = True,
) -> UpsertCounts:
    """INSERT ... ON CONFLICT DO UPDATE for `rows`.

    compare_columns are the business columns; they are updated from the new row and drive
    updated_at. When seen_columns is true, last_seen is touched and is_active reset on every run.
    """
    counts = UpsertCounts()
    batch: list[dict[str, Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= BATCH_SIZE:
            counts += _upsert_batch(
                session, table, batch, conflict_columns, compare_columns, seen_columns
            )
            batch = []
    if batch:
        counts += _upsert_batch(
            session, table, batch, conflict_columns, compare_columns, seen_columns
        )
    return counts


def _upsert_batch(
    session: Session,
    table: Table,
    batch: list[dict[str, Any]],
    conflict_columns: Sequence[str],
    compare_columns: Sequence[str],
    seen_columns: bool,
) -> UpsertCounts:
    keys = {k for row in batch for k in row}
    normalized = [{k: row.get(k) for k in keys} for row in batch]
    stmt = insert(table).values(normalized)
    excluded = stmt.excluded
    compare = [c for c in compare_columns if c in keys]
    if compare:
        changed = tuple_(*[table.c[c] for c in compare]).is_distinct_from(
            tuple_(*[excluded[c] for c in compare])
        )
    else:
        changed = false()
    set_map: dict[str, Any] = {c: excluded[c] for c in compare}
    if "updated_at" in table.c:
        # Only bump updated_at when a business column actually changed.
        set_map["updated_at"] = case((changed, func.now()), else_=table.c.updated_at)
    if seen_columns and "last_seen" in table.c:
        set_map["last_seen"] = func.now()
    if seen_columns and "is_active" in table.c:
        set_map["is_active"] = True
        set_map["deactivated_at"] = None
    stmt = stmt.on_conflict_do_update(index_elements=list(conflict_columns), set_=set_map)
    returning = [literal_column("(xmax = 0)").label("inserted")]
    if "updated_at" in table.c:
        returning.append((table.c.updated_at == func.now()).label("touched"))
    else:
        returning.append(literal_column("true").label("touched"))
    result = session.execute(stmt.returning(*returning))
    counts = UpsertCounts()
    for inserted, touched in result:
        if inserted:
            counts.inserted += 1
        elif touched:
            counts.updated += 1
        else:
            counts.unchanged += 1
    return counts
