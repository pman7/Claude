# CLAUDE.md, Integra Dentist Outbound Engine

This file is the project brief and working agreement for Claude Code. Read it fully at the start of every session before touching code. If anything here conflicts with what Phillip says in the session, Phillip wins, then update this file.

Repo name: `integra-outbound`
Owner: Phillip Manchik, CEO, Integra Dental (Nova Dental LLC), Bellevue, WA
Lab address for compliance footers: 35 148th Ave SE, Suite 10, Bellevue, WA 98007

---

## 1. What we are building

An owned lead database of dentists, built from public regulatory data, enriched with practice and technology signals, scored against an ideal customer profile, and exported to a cold email sequencer. The system refreshes itself nightly and flags broken scrapers for you to repair.

The idea comes from a public playbook: instead of renting Apollo or ZoomInfo lists, scrape government licensing boards and registries, keep the scrapers alive with Claude Code, and email lists nobody else is emailing. Dentists are an ideal fit because every one of them is licensed by a state board and registered in the federal NPI registry with a public practice address and phone.

The edge is not volume. Phase 1 is roughly 10,000 providers across Washington and Hawaii. The edge is the join: NPI record + active state license + Google Maps listing + practice website technology signals + verified email. That dataset does not exist for sale.

### Business context you need

- Integra Dental is a digital dental lab. Dentists send cases (crowns, bridges, implant restorations, full-arch prosthetics). The lab designs in 3Shape, mills zirconia on Arum 5-axis mills, sinters in a Dekema furnace, and ships or delivers the finished restoration.
- A "case" starts with a digital impression from an intraoral scanner (3Shape TRIOS, iTero, Medit) or a physical impression. Practices that already own a scanner are the best-fit clients because the workflow is fully digital.
- CEREC (and similar in-office milling like Planmeca PlanMill, E4D) means the practice mills its own single crowns in-house. Those practices send fewer single units to a lab, so they score lower for the lab segment but higher for a future equipment segment (Integra sells Arum mills).
- DSO means dental service organization: a corporate group owning many practices. Long sales cycle, different buyer. Flag and route to a separate list.
- Specialties that send lab work: general dentists (GP), prosthodontists, oral surgeons, periodontists (implant restorations). Orthodontists, pediatric dentists, endodontists send little or no crown and bridge work.
- Existing clients must never be cold emailed. See suppression.
- Hard deadline: Phillip is in Hawaii (Oahu and Maui) September 25 to October 6, 2026. The Hawaii export must be ready by September 14 so trial cases can be initiated before the trip.

---

## 2. Hard rules (never violate these)

1. Public records only. Never bypass a login, CAPTCHA, paywall, or rate limit. Never scrape LinkedIn, Facebook, or any site that requires an account.
2. Respect robots.txt on every non-government site. If a practice website posts a notice against harvesting email addresses or unsolicited email, record `no_harvest = true` on that practice and never export its emails.
3. Government portals: max 1 request per second per host, single concurrency, identify yourself with a descriptive User-Agent, cache every raw response so you never re-fetch what you already have.
4. From the Washington DOH credential file, store only business fields (name, credential number, credential type, status, dates). Do not store birth year or any other personal field the file may carry.
5. No patient data anywhere. No PHI. This project only touches provider and business records.
6. No SMS to anyone. Phone numbers are for manual calls only.
7. Never send email from this codebase. This system produces exports. Sending happens in the sequencer, from lookalike domains, never from integra.dental.
8. Never hard delete rows. Use `is_active`, `deactivated_at`, and `suppressed` flags.
9. Never invent data. If a field is unknown, leave it null. Do not guess emails without marking them `email_type = 'pattern'` and verifying them.
10. Do not hardcode column names from a remote dataset without first fetching its metadata or a sample and confirming the names.
11. Secrets live in `.env` only. Never commit keys. Never print keys in logs.
12. The database is Integra's internal asset. Never build an export intended for sale, sharing, or upload to any third party other than the sequencer and verifier services. Do not sell or share PII we do not own.

---

## 3. Architecture

```
sources (adapters)  →  raw cache on disk  →  normalize  →  Postgres
                                                              │
        practices resolved (dedupe) ← providers keyed by NPI  │
                                                              ▼
   gmaps + site_crawl  →  signals  →  icp_score  →  email waterfall  →  verify
                                                              │
                             suppression filter  →  exports (CSV / Instantly)
                                                              │
                   nightly run_all → healthcheck → REPAIR_NEEDED.md → you fix it
                   weekly diff → triggers export (new practices, new licenses)
```

Runtime target: Phillip's Mac (already runs a self-hosted agent) or a small Linux VPS. Everything must run headless from a cron or launchd job.

Stack:
- Python 3.12, managed with `uv`
- Postgres 16 (SQLite acceptable for the first day of development; migrate to Postgres before Phase 2)
- `httpx` for HTTP, `playwright` only where a portal is JavaScript-rendered
- `pydantic` models for every record type
- `sqlalchemy` + `alembic` for schema and migrations
- `tenacity` for retries, `structlog` for logging
- `pytest` with recorded fixtures (real HTML and JSON samples saved under `tests/fixtures/<source>/`)
- `ruff` for lint and format

---

## 4. Repository layout

```
integra-outbound/
  CLAUDE.md                 this file
  README.md                 short human readme
  Makefile                  all entry points (see section 14)
  pyproject.toml
  .env.example
  config/
    sources.yaml            per-source rate limits, base URLs, enabled flags
    keywords.yaml           tech signal regexes (section 8)
    scoring.yaml            ICP rubric weights (section 9)
    segments.yaml           segment definitions and export columns
  src/integra/
    db/                     models.py, session.py, migrations/
    sources/
      base.py               Adapter base class and contract
      nppes.py
      wa_doh.py
      hi_dcca.py
      wa_sos.py             phase 2
      or_bod.py             phase 2
      id_dopl.py            phase 2
      gmaps.py
      site_crawl.py
    resolve/                practice resolution and dedupe
    signals/                keyword tagging
    scoring/                ICP scoring
    enrich/
      waterfall.py
      finders/              findymail.py, prospeo.py, anymailfinder.py, hunter.py
      verify.py             millionverifier or zerobounce
    suppression/
    export/
      instantly.py
      csv_export.py
    ops/
      run_all.py
      healthcheck.py
      diff_weekly.py
  data/
    raw/<source>/<date>/    cached raw responses (gitignored)
    snapshots/<source>/     HTML snapshots saved on failure (gitignored)
    suppression/            clients.csv, competitors.csv, manual_dnc.csv
  exports/                  dated CSVs (gitignored)
  tests/
  REPAIR_NEEDED.md          written by healthcheck when something breaks (gitignored)
  CHANGELOG.md              one line per meaningful change, you maintain it
```

---

## 5. Data model

Use these tables. Add columns freely, but do not rename these keys.

**providers** (one row per individual dentist, keyed by NPI)
- `npi` text primary key
- `first_name`, `last_name`, `middle_name`, `credential_text` (DDS, DMD)
- `taxonomy_codes` text[] , `primary_taxonomy` text, `specialty` text (derived, see section 7)
- `enumeration_date` date, `last_update_date` date, `deactivation_date` date
- `practice_id` foreign key to practices, nullable until resolved
- `practice_phone_raw`, `practice_phone_e164`, `practice_address_raw`, `practice_city`, `practice_state`, `practice_zip`
- `wa_license_number`, `wa_license_status`, `wa_first_issue_date`, `wa_expiration_date`
- `hi_license_number`, `hi_license_status`, `hi_first_issue_date`, `hi_expiration_date`
- `or_license_number`, `or_license_status` (phase 2), `id_license_number`, `id_license_status` (phase 2)
- `source_json` jsonb (last raw NPPES record)
- `first_seen`, `last_seen`, `is_active` boolean, `updated_at`

**practices** (one row per physical office)
- `id` uuid primary key
- `name` (best available: Google Maps name, else NPPES org name, else "Dr. Last Name")
- `org_npi` text nullable (NPPES entity type 2 record if matched)
- `address_line1`, `city`, `state`, `postal_code`, `county`
- `phone_e164` (dedupe key with address), `fax_e164`
- `website` text, `website_domain` text
- `google_place_id`, `rating` numeric, `review_count` int, `business_status`
- `lat`, `lng`, `distance_miles_home` numeric
- `sos_ubi`, `sos_entity_name`, `sos_formation_date` (phase 2)
- `is_dso` boolean, `dso_brand` text
- `no_harvest` boolean default false
- `icp_score` int, `segment` text, `score_reasons` jsonb
- `provider_count` int
- `first_seen`, `last_seen`, `is_active`, `updated_at`

**signals**
- `id`, `practice_id`, `signal_type` (scanner, cerec, implants, ortho_clear, cosmetic, dso, new_practice, no_harvest), `value` text, `source` text (site_crawl, gmaps, nppes, wa_doh), `evidence` text (matched snippet, max 200 chars), `detected_at`

**contacts**
- `id`, `practice_id`, `provider_npi` nullable
- `email` text, `email_domain` text
- `email_type` (personal, generic, pattern)
- `source` (site_crawl, pattern, findymail, prospeo, anymailfinder, hunter, manual)
- `verification_status` (unverified, ok, catch_all, unknown, invalid, disposable, role)
- `verified_at`, `confidence` numeric 0 to 1
- `suppressed` boolean, `suppression_reason`
- unique on (`practice_id`, `email`)

**source_runs**
- `id`, `source`, `started_at`, `finished_at`, `status` (ok, error, partial), `record_count` int, `new_count` int, `error` text, `traceback` text, `snapshot_path` text

**suppression**
- `id`, `kind` (email, domain, npi, practice_id, phone), `value` text, `reason` (client, competitor, unsubscribe, bounce, complaint, manual, no_harvest), `added_at`

**outreach_log** (minimal; the sequencer is the source of truth)
- `id`, `contact_id`, `campaign`, `exported_at`, `export_file`

---

## 6. Source adapters

### 6.1 Adapter contract (`src/integra/sources/base.py`)

Every adapter implements:

```python
class Adapter:
    name: str                      # "nppes", "wa_doh", ...
    def fetch(self, *, state: str | None, limit: int | None) -> Iterator[RawRecord]
    def normalize(self, raw: RawRecord) -> ProviderRecord | PracticeRecord | LicenseRecord
    def upsert(self, records) -> RunStats
```

Rules for all adapters:
- Write every raw response to `data/raw/<source>/<YYYY-MM-DD>/` before parsing. Re-runs on the same day read from cache unless `--force`.
- Record a `source_runs` row on every invocation, success or failure. On failure, save the offending HTML or JSON to `data/snapshots/<source>/<timestamp>.html` and put the path in `snapshot_path`.
- Upserts are idempotent. Running twice produces no duplicates and no changes except `last_seen`.
- Rate limit and concurrency come from `config/sources.yaml`, never hardcoded.
- Each adapter has tests against a saved fixture and a `--limit 20` smoke mode.

### 6.2 `nppes` (federal NPI registry). Spine of the whole database.

- Two modes. API mode for Phase 1 (WA and HI, a few thousand records). Bulk file mode when expanding nationally.
- API: `https://npiregistry.cms.hhs.gov/api/?version=2.1`. Parameters include `taxonomy_description`, `state`, `city`, `postal_code` (supports trailing wildcard), `limit` (max 200), `skip` (max 1000). Because `skip` caps at 1000, partition queries by 3-digit ZIP prefix (WA: 980 to 994, HI: 967 and 968) and by taxonomy description ("Dentist", "Prosthodontics", "Oral & Maxillofacial Surgery", "Periodontics", "General Practice"). Confirm exact accepted taxonomy_description strings against the API before assuming.
- Bulk file: NPPES Data Dissemination monthly full file plus weekly incremental files from the CMS download page. Stream the CSV; do not load it into memory. Filter rows where any of the 15 taxonomy code columns starts with `1223`.
- Keep both entity types. Type 1 = individual dentist → providers. Type 2 = organization → candidate practice anchor (legal business name, practice address, phone).
- Fields to capture: NPI, entity type, names, credential text, practice location address fields, practice phone and fax, all taxonomy codes and the primary flag, enumeration date, last update date, deactivation date.
- Verify the dentist taxonomy family against the NUCC taxonomy CSV. Working list, prefix 1223:
  - 122300000X Dentist (general)
  - 1223G0001X General Practice
  - 1223P0700X Prosthodontics
  - 1223S0112X Oral and Maxillofacial Surgery
  - 1223P0300X Periodontics
  - 1223E0200X Endodontics
  - 1223X0400X Orthodontics
  - 1223P0221X Pediatric Dentistry
  - 1223D0001X Dental Public Health
  - 1223P0106X Oral and Maxillofacial Pathology
  - 1223X0008X Oral and Maxillofacial Radiology
  - 1223X2210X Orofacial Pain
  - 1223D0004X Dentist Anesthesiologist

### 6.3 `wa_doh` (Washington Department of Health credential data)

- Dataset: Health Care Provider Credential Data on data.wa.gov, id `qxh8-f4bd`. Public domain, refreshed daily.
- Access via the Socrata API (`https://data.wa.gov/resource/qxh8-f4bd.json`) with `$where` filters, or the CSV download endpoint. First call the dataset metadata (`https://data.wa.gov/api/views/qxh8-f4bd.json`) to read the real column names, then build the query. Expect columns along the lines of credential number, last name, first name, middle name, credential type, status, first issue date, last issue date, expiration date, action taken.
- Filter credential type containing "Dentist" (confirm the exact values present, there may be several dentist credential types) and status Active. Also keep other statuses in the raw cache; only Active feeds scoring.
- Store business fields only (hard rule 4).
- Match to providers by normalized last name + first name; where multiple matches exist, prefer the one whose NPPES practice state is WA. Store `wa_license_*` fields on the provider. Unmatched licensees become `providers` rows with a synthetic key only if you cannot find an NPI; flag them `npi IS NULL` and revisit.
- Use `SOCRATA_APP_TOKEN` if present for higher rate limits.

### 6.4 `hi_dcca` (Hawaii professional licensing)

- First check the Hawaii open data portal (data.hawaii.gov) for a professional and vocational licensing dataset that includes license type and status. If it exists, use the Socrata API exactly as in 6.3.
- Otherwise, scrape the DCCA MyPVL public license search (Playwright). Filter license type Dentist. Capture license number, name, status, issue and expiration dates, and city if shown.
- Same matching rules as 6.3, preferring NPPES practice state HI.

### 6.5 `gmaps` (Google Places API, New)

- Endpoint: Places Text Search, `POST https://places.googleapis.com/v1/places:searchText`, headers `X-Goog-Api-Key` and a strict `X-Goog-FieldMask` limited to: `places.id, places.displayName, places.formattedAddress, places.nationalPhoneNumber, places.websiteUri, places.rating, places.userRatingCount, places.location, places.businessStatus`.
- Query per practice: `"<practice or doctor name> dentist <city> <state>"`. Match candidates by normalized phone first, then by street number + ZIP. Store `google_place_id`, website, rating, review count, coordinates.
- Cache every response. Budget: stay inside the free monthly credit; log estimated spend per run.
- Compute `distance_miles_home` from the geocoded lab address (`HOME_ADDRESS` in `.env`, geocode once and cache).

### 6.6 `site_crawl` (practice websites)

- Input: practices with a website. Fetch `robots.txt` first and obey it.
- Pages to try, stop at 8 per site: `/`, `/contact`, `/contact-us`, `/about`, `/about-us`, `/team`, `/our-team`, `/meet-the-doctor`, `/doctors`, `/technology`, `/services`.
- Limits: 1 request per second per domain, 10 second timeout, 2 retries, User-Agent `IntegraDentalBot/1.0 (+https://integra.dental)`.
- Extract:
  - Emails from `mailto:` links and a conservative regex. Classify: `generic` (info@, frontdesk@, office@, hello@, contact@, smile@), `personal` (matches a provider name or dr prefix), `role` (noreply@, billing@, hr@) which is never exported.
  - Doctor names from bio pages, matched to providers by last name to strengthen practice resolution.
  - Technology and service signals using `config/keywords.yaml` (section 8). Save a 200 character evidence snippet.
  - A no-harvest or no-solicitation notice → set `practices.no_harvest = true` and add a suppression row for the domain.
  - Location count. If the site lists more than 3 locations or matches a DSO brand list, set `is_dso = true`.
- Never follow links off the practice domain.

### 6.7 Phase 2 sources

- `wa_sos`: Washington Secretary of State Corporations and Charities. Find the practice's legal entity, UBI, governors, formation date. Prefer any official bulk data product over scraping the search UI. Formation within the last 60 days is a `new_practice` signal.
- `or_bod`: Oregon Board of Dentistry license verification.
- `id_dopl`: Idaho Division of Occupational and Professional Licenses.
- For each: look for a bulk export first, then a JSON endpoint behind the search UI, then Playwright as a last resort.

### 6.8 Intent sources (Phase 2b if time allows, otherwise Phase 5)

The original playbook splits sources into four buckets: regulatory, institutional (associations, societies, faculty, nonprofit boards), industry platforms built so the listed party can be found, and public-presence (speakers, exhibitors, podcast guests). Sections 6.2 to 6.7 cover the regulatory bucket. These cover the other three for dentistry. Each one adds a signal to an existing practice; none of them creates new providers on their own.

Vendor "find a doctor" locators (the practice opted in to be found, and the listing reveals what they own):
- `loc_cerec`: Dentsply Sirona CEREC dentist locator. Confirms in-house milling. Signal `cerec` with `source = 'loc_cerec'`.
- `loc_invisalign`: Align Technology Invisalign doctor locator. Provider tier (Bronze through Diamond Plus) is a volume proxy. Signal `ortho_clear` with the tier as `value`.
- `loc_implant`: Nobel Biocare, Straumann, and Zimmer Biomet dentist locators. Signal `implants` with the brand as `value`.
- Search these by ZIP or city for WA and HI. They are built for patients, so use Playwright at one page at a time, cache everything, and stop if the site presents a CAPTCHA. A few hundred results per state is all we need; if automation is blocked, a manual export is acceptable.

Insurance provider directories (public, practice-level, list every in-network dentist by ZIP):
- `dir_delta_wa`: Delta Dental of Washington find-a-dentist.
- `dir_hds`: Hawaii Dental Service find-a-dentist. High value for the Hawaii list.
- Use these to confirm practice name, address, and specialty, and to catch practices NPPES lists under a stale address.

Societies, study clubs, and faculty (restoration-heavy, CE-motivated dentists, the best lab buyers):
- `soc_wsda`: Washington State Dental Association member directory; `soc_skcds`: Seattle-King County Dental Society; `soc_hda`: Hawaii Dental Association.
- `club_kois`: Kois Center graduate listing; `club_spear`: Spear dentist listing; `club_ssc`: Seattle Study Club affiliate clubs and their member rosters where public.
- `fac_uwsod`: University of Washington School of Dentistry faculty and affiliate faculty pages (affiliate faculty are practicing dentists).
- Signal `study_club` or `society` with the org as `value`.

Public presence and events:
- `evt_pndc`: Pacific Northwest Dental Conference speakers and exhibitor list. `evt_hda`: Hawaii Dental Association convention.
- Dentists posting cases on Instagram or YouTube. Do not scrape these platforms. Phillip flags them manually into `data/suppression/../manual_signals.csv` and they load as `signal_type = 'public_presence'`.

Firmographic appends (cheap, all public):
- `domain_age`: RDAP lookup on `website_domain`. Registration within 12 months feeds `new_practice`.
- `site_tech`: from the site crawl, detect the website vendor and booking widget (ProSites, PBHS, Roadside, NexHealth, LocalMed, Dentrix Ascend, Curve). Store as signal `site_tech`. Useful later for sizing and for the equipment segment.
- `hiring`: Indeed public job listings by practice name and city. A dental assistant posting that mentions a scanner or CEREC brand reveals the tech stack and signals a growing practice. Signal `hiring` with the extracted brand list as `value`. Public search pages only, respect robots.txt.

### 6.9 Cross-source matching rules

The playbook's warning applies here: the same dentist shows up across five sources with five spellings, and a database that is half duplicates is half the size it claims. Match order for every non-NPPES record:
1. NPI if the source publishes it (insurance directories sometimes do).
2. Normalized phone (E.164) + ZIP.
3. Normalized last name + first name (strip DDS, DMD, Dr., middle initials; expand common nicknames from a small table) + city or ZIP, with a `rapidfuzz` token ratio of 90 or higher on the full name.
4. Practice name + street number + ZIP.
5. Email domain, when both sides have one.
Record every match with `match_method` and a confidence. Anything under 0.8 goes to `data/review/unmatched_<source>.csv` for Phillip instead of being force-linked.

---

## 7. Specialty derivation

`providers.specialty` from the primary taxonomy, falling back to any taxonomy code:
- `gp` for 122300000X and 1223G0001X
- `prosth` 1223P0700X
- `os` 1223S0112X
- `perio` 1223P0300X
- `endo` 1223E0200X
- `ortho` 1223X0400X
- `pedo` 1223P0221X
- `other` for the rest

---

## 8. Signals and tech tagging (`config/keywords.yaml`)

Case-insensitive regexes. Start with these and extend as you see real pages.

- `scanner`: `\bTRIOS\b`, `\biTero\b`, `\bMedit\b`, `\bPrimescan\b`, `\bOmnicam\b`, `intraoral scanner`, `digital impression`
- `cerec`: `\bCEREC\b`, `same[\s-]?day crown`, `one[\s-]?visit crown`, `\bE4D\b`, `PlanMill`, `in[\s-]?house milling`, `chairside milling`
- `implants`: `\bimplant`, `All[\s-]?on[\s-]?[4X6]`, `full[\s-]?arch`, `teeth in a day`
- `ortho_clear`: `Invisalign`, `ClearCorrect`, `clear aligner`
- `cosmetic`: `veneer`, `smile makeover`
- `sedation`: `sedation`, `sleep dentistry`
- `dso_brand`: Aspen Dental, Pacific Dental Services, Heartland Dental, Smile Brands, Bright Now, Willamette Dental, Gentle Dental, Western Dental, Sonrava, Dental Care Alliance, Kool Smiles, Great Expressions. Extend the list; when in doubt ask Phillip.
- `no_harvest`: `do not (send|solicit)`, `no unsolicited`, `harvest`, `spam`
- `site_tech` (vendor and booking widgets): `ProSites`, `PBHS`, `Roadside`, `NexHealth`, `LocalMed`, `Dentrix Ascend`, `Curve Dental`, `Weave`
- `study_club` and `society` come from section 6.8 sources, not from regex.

One `signals` row per (practice, signal_type, value). Signals are additive and never deleted; re-crawls update `detected_at`. The same signal type from two sources (for example `cerec` from both `site_crawl` and `loc_cerec`) is stored twice and counts once in scoring.

---

## 9. ICP scoring (`config/scoring.yaml`)

Score every practice 0 to 100. Weights live in YAML so Phillip can tune them without code. Starting rubric:

- Base: 20 if at least one provider has an active license and a matching NPI.
- Specialty of the highest-value provider at the practice: prosth +20, os +15, perio +10, gp +10, endo 0, ortho −20, pedo −20, other 0.
- `scanner` signal +15
- `cerec` signal −15 (lab segment). Keep the raw signal; the equipment segment will invert this later.
- `implants` signal +10
- Review count: 50 or more +5, 200 or more +10
- Distance from home: within 10 miles +15, within 25 miles +10, within 50 miles +5. Hawaii practices on Oahu or Maui +10 regardless of distance.
- `new_practice` (NPI enumeration, first license issue, entity formation, or domain registration within the last 12 months) +15
- `study_club` (Kois, Spear, Seattle Study Club) +10; `society` membership +3
- `implants` confirmed by a vendor locator (Nobel, Straumann, Zimmer) +5 on top of the site signal
- `ortho_clear` with Invisalign tier Gold or higher +5 (volume proxy, not a lab signal by itself)
- `hiring` signal +5
- `is_dso` −10 and route to segment `dso`
- At least one contact with `verification_status = 'ok'` and `email_type = 'personal'` +5
- `no_harvest` → score forced to 0 and segment `excluded`

Clamp to 0..100. Write the contributing reasons into `score_reasons` so exports can explain themselves.

Segments (`config/segments.yaml`):
- `wa_eastside_gp`: WA, gp, within 25 miles, not dso
- `wa_implant`: WA, prosth or os or perio, or gp with implants signal
- `wa_scanner`: WA, scanner signal, not cerec
- `hi_oahu`, `hi_maui`: HI by county
- `new_practice`: any state, new_practice signal
- `dso`: is_dso true
- `equipment_cerec` (later): cerec signal, for Arum outreach
- `excluded`: no_harvest, ortho, pedo, score under 20

A practice can belong to more than one segment. Exports pick one primary campaign per practice using priority order in the YAML so nobody is emailed twice in the same week.

---

## 10. Email enrichment waterfall (`src/integra/enrich/waterfall.py`)

Run per practice, stop as soon as a verified `ok` personal email exists. Always keep a generic email if one was found.

1. `site_crawl` results (already in `contacts`).
2. Pattern guess on `website_domain`, only if the practice has a domain and no personal email yet. If any personal email exists on that domain, infer the pattern and apply it to the other doctors. Otherwise try, in order: `drlast@`, `dr.last@`, `first@`, `first.last@`, `flast@`, `last@`. Mark `email_type = 'pattern'`, `source = 'pattern'`, `confidence = 0.4`. Verify before anything else.
3. Finder APIs, each behind a common `Finder` interface in `enrich/finders/`, called in the order configured in `sources.yaml`, stop at first hit: Findymail, Prospeo, Anymail Finder, Hunter. Input: first name, last name, domain. Skip any finder whose key is missing. Log credits used.
4. Verification for every new email via MillionVerifier (or ZeroBounce if that key is present instead). Statuses map to `verification_status`. Only `ok` emails are exported by default. `catch_all` emails export only to high-score practices (score 60 or more) in a separate low-volume campaign flagged in the CSV.
5. Practices with no exportable email get `contact_channel = 'phone_or_mail'` in the export so they land on the manual call and direct mail lists. NPPES phone and mailing address are exact.

Targets: 70 percent or more of Phase 1 practices with at least one `ok` email; bounce rate under 3 percent once live.

---

## 11. Suppression

Load on every export from `data/suppression/*.csv` and the `suppression` table:
- `clients.csv`: existing Integra clients (Phillip maintains; includes Dr. Jung and DreamWorks Laboratories). Match by domain, phone, and NPI.
- `competitors.csv`: dental labs and Argen affiliated contacts.
- `manual_dnc.csv`: anything Phillip adds by hand.
- Unsubscribes, bounces, and complaints pulled from the sequencer (Instantly API) at least daily once campaigns run.
- Any `no_harvest` domain.

A suppressed email, domain, phone, NPI, or practice never appears in any export. Write a count of suppressed rows to the export log so Phillip can see it working.

---

## 12. Exports

CSV to `exports/<YYYY-MM-DD>_<segment>.csv`, one row per practice (primary contact), columns:

`email, first_name, last_name, practice_name, city, state, specialty, segment, icp_score, proof_point, personalization_line, verification_status, email_type, npi, practice_id, phone_e164, contact_channel`

- `proof_point` is chosen from a per-segment list in `segments.yaml` (implant and full-arch story for `wa_implant`, digital workflow for `wa_scanner`, local pickup for `wa_eastside_gp`, shipping covered plus in-person review for Hawaii).
- `personalization_line` is deterministic from data (city, specialty, one detected signal). Do not use an LLM to write outbound copy without Phillip reviewing samples first.
- Optional push to Instantly via API when `INSTANTLY_API_KEY` is set: create or reuse a lead list per segment, upload leads with the same custom variables. Never trigger a campaign send from code.
- Log every export to `outreach_log` and print counts by segment, verification status, and suppression.

---

## 13. Maintenance loop, healthcheck, and repair

This is the part that makes the system worth building.

- `ops/run_all.py`: runs adapters in order (nppes → wa_doh → hi_dcca → phase 2 sources → gmaps → site_crawl → resolve → signals → score → enrich → verify), each in its own try block, never aborting the whole run because one source failed.
- `ops/healthcheck.py` runs after `run_all`. A source is unhealthy if its latest run has `status = 'error'`, or its `record_count` is below 70 percent of the median of its last 7 successful runs, or it has not run in 48 hours.
- When unhealthy, write `REPAIR_NEEDED.md` at the repo root containing: source name, timestamp, the error and full traceback, the snapshot path, the exact command to reproduce (`make pull SOURCE=<name> LIMIT=20 FORCE=1`), and the last 3 healthy run counts.
- Schedule: 02:30 local daily (launchd plist on the Mac, crontab on a VPS). `ops/diff_weekly.py` runs Sundays.

### Repair workflow (you, Claude Code)

When Phillip says "repair", or when `REPAIR_NEEDED.md` exists at session start:
1. Read `REPAIR_NEEDED.md` and the snapshot file.
2. Reproduce with the listed command.
3. Fix the adapter. If the remote HTML or API changed, update the parser and save the new response as a fresh test fixture.
4. Run `make test` and the smoke command again.
5. Re-run `make health`. When clean, delete `REPAIR_NEEDED.md` and add a line to `CHANGELOG.md`.
6. Tell Phillip what changed at the source and whether the record count is back to normal.

### Weekly diff (`ops/diff_weekly.py`)

Produce `exports/triggers_<date>.csv` with `trigger_type` in: `new_npi` (enumeration within 30 days), `new_license` (first issue within 60 days), `new_entity` (formation within 60 days, phase 2), `address_change`, `newly_active_license`. These practices get the `new_practice` segment and top priority.

---

## 14. Commands (Makefile)

```
make setup                      create venv, install, copy .env.example, run migrations
make migrate
make pull SOURCE=nppes STATE=WA LIMIT=0 FORCE=0
make pull SOURCE=wa_doh
make pull SOURCE=hi_dcca
make pull SOURCE=gmaps LIMIT=200
make pull SOURCE=site_crawl LIMIT=200
make resolve                    practice resolution and dedupe
make signals
make score
make enrich STAGE=all           or STAGE=pattern | finders
make verify
make export SEGMENT=hi_oahu     writes exports/<date>_hi_oahu.csv
make export SEGMENT=all
make health
make diff
make run_all
make test
make lint
```

Every command prints a one-paragraph summary at the end: rows touched, new rows, errors, elapsed time.

---

## 15. Environment variables (`.env.example`)

```
DATABASE_URL=postgresql+psycopg://integra:integra@localhost:5432/integra
HOME_ADDRESS=35 148th Ave SE, Bellevue, WA 98007
GOOGLE_PLACES_API_KEY=
SOCRATA_APP_TOKEN=
MILLIONVERIFIER_API_KEY=
ZEROBOUNCE_API_KEY=
FINDYMAIL_API_KEY=
PROSPEO_API_KEY=
ANYMAILFINDER_API_KEY=
HUNTER_API_KEY=
INSTANTLY_API_KEY=
PROXY_URL=                      optional, only used by gmaps and site_crawl
USER_AGENT=IntegraDentalBot/1.0 (+https://integra.dental)
```

Ask Phillip which finder and verifier keys he actually has before writing code that depends on them. Missing keys must degrade gracefully, never crash.

---

## 16. Coding conventions

- Small modules, one responsibility each. Adapters under 300 lines; split parsers out if they grow.
- Type hints everywhere. Pydantic models at every boundary (raw → normalized → DB).
- Retries: exponential backoff, max 5 attempts, honor `Retry-After`. Never retry a 4xx other than 429.
- Log with structlog: source, phase, counts, elapsed. No secrets in logs.
- Tests: every adapter has a fixture test and a normalization test. Every scoring rule has a unit test. Run `make test` before telling Phillip something works.
- Commit small, message format `source: what changed`. Update `CHANGELOG.md` for anything Phillip would want to know.
- When you are unsure about a data source's shape, fetch one page, save it as a fixture, and inspect it before writing a parser. Do not guess at column names or HTML structure.
- Prefer boring, readable code over clever code. Phillip will read this.

---

## 17. Build phases and acceptance criteria

Work through these in order. Do not start a phase until the previous one passes its checks. Report the checks explicitly.

**Phase 0, scaffold (day 1)**
- Repo layout from section 4, `pyproject.toml`, Makefile, `.env.example`, Postgres via docker compose or a local install, migrations for all tables in section 5, structlog, ruff, pytest passing on an empty suite.
- Check: `make setup && make test && make migrate` succeed from a clean clone.

**Phase 1, spine (days 1 to 3)**
- `nppes` API mode for WA and HI, `wa_doh`, `hi_dcca`, practice resolution, specialty derivation.
- Checks: no duplicate NPIs; WA active dentist count from `wa_doh` within 10 percent of the count of WA providers with an active license match; every provider has a `practice_id`; HI has at least 800 providers; `make pull` twice in a row changes only `last_seen`.

**Phase 2, practice intelligence (days 3 to 7)**
- `gmaps`, `site_crawl`, signals, ICP scoring, segments.
- Checks: 85 percent or more of practices have a resolved website or a confirmed absence; at least 60 percent of practices with a website have at least one signal; scoring is fully reproducible from YAML; `hi_oahu` and `hi_maui` segments populated.

**Phase 2b, first intent sources (only if Phase 2 passes by day 6)**
- `dir_hds` (Hawaii Dental Service directory), `loc_cerec`, `domain_age`, and the cross-source matching rules from 6.9. These three sharpen the Hawaii list and the CEREC exclusion before the first export.
- Checks: every `dir_hds` row matched or written to the review file; no forced links under 0.8 confidence.

**Phase 3, contacts and exports (days 7 to 12, Hawaii export due September 14)**
- Waterfall, verification, suppression, CSV export, Instantly push.
- Checks: 70 percent or more of Phase 1 practices have an `ok` email; zero suppressed rows in any export (assert it); sample of 25 exported rows manually spot checked with Phillip; `hi_oahu` and `hi_maui` exports delivered.

**Phase 4, self-maintenance (days 12 to 16)**
- `run_all`, `healthcheck`, `REPAIR_NEEDED.md`, scheduler, weekly diff and triggers export, sequencer unsubscribe sync.
- Checks: simulate a broken adapter (point it at a bad URL) and confirm `REPAIR_NEEDED.md` is written with a reproducible command; scheduled run completes end to end unattended.

**Phase 5, expansion (after the Hawaii trip)**
- `wa_sos`, `or_bod`, `id_dopl`, NPPES bulk file mode, `dso` and `equipment_cerec` segments, lab segment for Integra Milling (Google Maps "dental laboratory", NADL directory).
- Remaining section 6.8 sources: `dir_delta_wa`, `loc_invisalign`, `loc_implant`, societies and study clubs, `fac_uwsod`, `evt_pndc`, `site_tech`, `hiring`.

---

## 18. Things not to do

- Do not add sources beyond the phase you are in without asking.
- Do not build a UI. CSVs and the sequencer are the interface.
- Do not send email, SMS, or make calls from code.
- Do not use an LLM to generate the outbound copy or personalization lines by default.
- Do not scrape or store anything about patients.
- Do not scrape LinkedIn, Facebook, Instagram, Yelp reviews text, or any site behind a login.
- Do not load the NPPES bulk file into memory. Stream it.
- Do not run Playwright against government portals at more than one concurrent page.

---

## 19. Questions to ask Phillip before Phase 1

1. Postgres locally on the Mac, or a VPS from day one?
2. Which finder and verifier API keys exist today?
3. Instantly, Smartlead, or EmailBison for the sequencer?
4. Confirm the client suppression list (at minimum Dr. Jung's practice and DreamWorks Laboratories) and the competitor list.
5. Trial offer wording for `proof_point` templates (first case free, no seat no pay, or flat intro price).
6. Weekly cap on new trial cases so exports can be sized to lab capacity.
