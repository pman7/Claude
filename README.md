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

## Layout

See CLAUDE.md section 4. Adapters live in `src/integra/sources/`, one file per source, each
with a fixture test under `tests/` and a `--limit 20` smoke mode. Raw responses are cached in
`data/raw/<source>/<date>/` and never re-fetched the same day unless `FORCE=1`.

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
