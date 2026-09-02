# integra-outbound

Owned lead database of dentists for Integra Dental (Nova Dental LLC), built from public
regulatory data (NPPES, Washington DOH, Hawaii DCCA), enriched with practice and technology
signals, scored against an ideal customer profile, and exported to a cold email sequencer.

`CLAUDE.md` is the full project brief and working agreement. `docs/Dentist_Outbound_Plan.md`
is the business plan it implements.

## Quick start

```
cp .env.example .env          # fill in keys as you get them; missing keys degrade gracefully
make db-up                    # Postgres 16 in docker (or point DATABASE_URL at your own)
make setup                    # uv venv, deps, playwright chromium, migrations
make test
make pull SOURCE=nppes STATE=HI LIMIT=20      # smoke pull, 20 records, cached under data/raw/
make pull SOURCE=wa_doh
make pull SOURCE=hi_dcca LIMIT=20
make resolve
```

Every command ends with a one-paragraph summary: rows touched, new rows, errors, elapsed time.

## Commands (Phase 1)

| Command | What it does | Exit code |
| --- | --- | --- |
| `make migrate` | apply alembic migrations to `DATABASE_URL` | 0 |
| `make pull SOURCE=nppes STATE=WA\|HI LIMIT=0 FORCE=0` | fetch, normalize, upsert one source; then link licenses | 1 when the run failed (row in `source_runs`, snapshot under `data/snapshots/`), 2 for an unknown source |
| `make pull SOURCE=wa_doh` | Washington DOH credentials, all statuses, business fields only | as above |
| `make pull SOURCE=hi_dcca` | Hawaii MyPVL license search via Playwright | as above |
| `make resolve` | group providers and organizations into practices, derive specialty | 0 |
| `make run_all` | every enabled adapter in order, then resolve; one failure never aborts the run | 1 if any step failed |
| `make test`, `make lint`, `make fmt` | pytest against `TEST_DATABASE_URL`, ruff | |

`signals`, `score`, `enrich`, `verify`, `export`, `health`, `diff` exist as stubs and exit 2
until their phase lands.

Same-day re-runs read from `data/raw/<source>/<date>/` and never touch the network unless
`FORCE=1`. Every run, success or failure, writes a `source_runs` row; the summary line shows
`N requests` (live HTTP requests or browser actions) and `M served from cache`.

## What only a first live run can confirm

The adapters were built and tested against saved fixtures in a sandbox with no route to
npiregistry.cms.hhs.gov, data.wa.gov or mypvl.dcca.hawaii.gov. Watch the first real run of each:

1. `make pull SOURCE=nppes STATE=HI LIMIT=20`, then `STATE=WA`. Expect `status ok` and a note
   only if a ZIP3 partition had to be subdivided. The NPI-2 `other_names[]` element key
   (`organization_name`) has never been seen non-empty in a sample.
2. `make pull SOURCE=wa_doh LIMIT=20`. The run starts with a metadata check; a
   `SchemaDriftError` with a snapshot means data.wa.gov renamed a column and
   `config/sources.yaml` `wa_doh.business_fields` needs updating. The credential-type list was
   confirmed against a 2026-09-02 sample, not re-verified live.
3. `make pull SOURCE=hi_dcca LIMIT=20`. The Playwright selectors in
   `src/integra/sources/hi_dcca_browser.py` are best guesses from the rendered text of the
   search page (`tests/fixtures/hi_dcca/mypvl_search_page_notes.md`). The first live run writes
   `data/snapshots/hi_dcca/<timestamp>_first_results.html`; use it to fix a selector method
   and to replace the two `SYNTHETIC_*.html` fixtures with real captures. Also confirm the
   license-number input format (`DT-12`), the status vocabulary (`active_statuses`), and whether
   detail pages open via a link (needed for status and dates). A Cloudflare challenge stops the
   run with a snapshot and is never retried.
4. After the pulls: `make resolve`, then read `data/review/unmatched_wa_doh.csv` and
   `unmatched_hi_dcca.csv` (licenses that could not be linked to an NPI with confidence >= 0.8).
5. Phase 1 acceptance checks from CLAUDE.md section 17: no duplicate NPIs; WA active dentist
   count within 10 percent of WA providers with an active license; every provider has a
   `practice_id`; HI has at least 800 providers; a second `make pull` changes only `last_seen`.

## Layout

See CLAUDE.md section 4. Adapters live in `src/integra/sources/`, one file per source (parsers
and the Playwright driver are sibling modules), each with a fixture test under `tests/` and a
`--limit 20` smoke mode. Practice resolution and license matching live in `src/integra/resolve/`.

## Data source notes (verified 2026-09-02)

- NPPES API 2.1: `taxonomy_description=Dentist` matches every `Dentist, <specialty>` description
  (the whole 1223 taxonomy family). `address_purpose=LOCATION` restricts matches to the practice
  location address. `postal_code` accepts a trailing wildcard (`968*`, `9674*`). `skip` is
  documented as capped at 1000, so pulls are partitioned by 3-digit ZIP prefix and entity type.
- WA DOH `qxh8-f4bd`: columns are `credentialnumber, lastname, firstname, middlename,
  credentialtype, status, birthyear, ceduedate, firstissuedate, lastissuedate, expirationdate,
  actiontaken`. `birthyear` is never requested or stored. Dentist credential types are listed in
  `config/sources.yaml`.
- Hawaii DCCA: no bulk dataset exists on data.hawaii.gov. The MyPVL public license search
  (`mypvl.dcca.hawaii.gov/public-license-search/`) is a JavaScript app that accepts
  comma-separated license numbers; the adapter drives it with Playwright, one page at a time.

## Testing notes

DB tests share one `TEST_DATABASE_URL` database and truncate it per test, so two pytest
processes at once will race. Run one suite at a time, or point a second process at another
database name (conftest creates it on demand).
