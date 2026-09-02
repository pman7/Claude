# Changelog

One line per meaningful change, newest first.

- 2026-09-02 integration: request/cache counters mean the same thing in every adapter (live requests vs cache hits), `integra pull <unknown>` prints one line instead of a traceback, CLI contract tests, README first-live-run checklist.
- 2026-09-02 resolve: practice resolution by phone + address key (fallback address, phone, solo NPI), org name > existing name > "Dr. Last", Hawaii county from ZIP, orphaned practices deactivated not deleted; license matching (license number in NPPES taxonomies > exact name with state tiebreak > rapidfuzz >= 90 same state), links under 0.8 or ambiguous go to data/review/unmatched_<source>.csv, matched licenses propagated to providers.wa_/hi_ columns.
- 2026-09-02 hi_dcca: MyPVL license-number enumeration adapter (Playwright, one page, 0.5 req/s), file cache under data/raw/hi_dcca/<date>/, Cloudflare/CAPTCHA stop with snapshot and no retry, first results page snapshotted; DOM selectors and synthetic fixtures unverified until the first live run.
- 2026-09-02 wa_doh: Socrata qxh8-f4bd adapter; metadata checked before every pull, $select limited to config business_fields (birthyear never requested, stripped from payload and cache if it ever arrives), all statuses kept with is_active_status, app token header only when SOCRATA_APP_TOKEN is set.
- 2026-09-02 nppes: API-mode adapter for WA and HI, partitioned by ZIP3 prefix and entity type with automatic subdivision past max_skip, both NPI-1 (providers) and NPI-2 (organizations), LOCATION-state and 1223 taxonomy guards in normalize().
- 2026-09-02 Phase 0 scaffold: uv project, Postgres models and migrations, polite HTTP client with disk cache, config YAMLs, fixtures captured from live NPPES and WA DOH.
