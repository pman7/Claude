# Dentist Outbound Engine: Owned Lead Database + Cold Email Plan (Sept 2026)

Tags: Project Management, Guides
Company: Integra Dental (Nova Dental LLC)

## Source and premise

Adapted from Levi Munneke's X post (x.com/levikmunneke/status/2062312236513915351): build your own lead database from public regulatory data (state licensing boards, business registries, industry directories) instead of renting Apollo or ZoomInfo lists, use Claude Code to write and continuously repair the scrapers, run it on a cheap VPS, then run cold email on top with CAN-SPAM compliance. His core claim: government-verified records (license number, active status) are more specific than anything the list vendors sell, and nobody else is emailing those lists. He names four source buckets: regulatory (licensing boards, business registries), institutional (associations, faculty, nonprofit boards), industry platforms built so the listed party can be found, and public presence (speakers, exhibitors). His own case study is private clinics: state board + Healthgrades-style directory + business registry, which is exactly the join below. Crossover where building beats renting is about 50k leads; we are under that, so the argument here is not cost, it is specificity and inbox competition.

**Why this fits Integra better than most businesses:** every dentist is a licensed, NPI-registered professional with a public practice address and phone. The population is fully enumerated. The edge is not 400M records, it is the intersection of NPI + active state license + Google Maps + practice website tech signals. That list does not exist for sale.

The Claude Code build spec (CLAUDE.md) was delivered separately on Sept 1, 2026 and lives in the integra-outbound repo.

## Target segments (Integra Lab division first)

1. General dentists, King / Snohomish / Pierce counties. Core crown and bridge, zirconia, local pickup and delivery.
2. Prosthodontists, oral surgeons, periodontists, implant-heavy GPs, WA statewide. Full-arch and implant restorations (slow-cooldown sintering protocol is the proof point).
3. Hawaii (Oahu and Maui). Trial case initiated before the Sept 25 to Oct 6 trip so in-person meetings become case reviews.
4. Intraoral scanner users (TRIOS, iTero, Medit) flagged from practice websites. Best-fit digital clients.
5. Newly licensed dentists and newly formed practice entities (weekly trigger list). Highest conversion: they have no lab yet.

Later expansions: other dental labs for Integra Milling (Google Maps, NADL directory, state business registries) and CEREC / Planmeca practices and DSOs for Integra Equipment (Arum).

## Data sources

**Tier 1, government bulk data (free, public domain)**
- NPPES NPI Registry: monthly full dissemination file or the free API. Filter taxonomy 1223* (dentist and specialties). Fields: NPI, name, credential, practice address, phone, fax, taxonomy, enumeration date. This is the spine and the dedupe key.
- WA DOH Health Care Provider Credential Data on data.wa.gov (dataset qxh8-f4bd). CSV download and Socrata API, refreshed daily, public domain. Filter credential type Dentist License, status Active. Gives first issue date (new grads) and expiration.
- Hawaii DCCA Professional and Vocational Licensing (check data.hawaii.gov for a bulk export first; otherwise scrape the MyPVL license search).
- Oregon Board of Dentistry and Idaho DOPL license verification (phase 2).
- WA Secretary of State Corporations and Charities: the PLLC behind each practice, governors, formation date. New formations = new practices.

**Tier 2, enrichment and segmentation**
- Google Maps Places: practice name, website, rating, review count, hours.
- Practice website crawl: emails on contact page and footer, doctor bios, technology keywords (CEREC, same-day crowns, TRIOS, iTero, Medit, All-on-4, implants, Invisalign). Respect robots.txt and skip any site with a no-harvest notice.
- ADA Find-a-Dentist, WSDA and Hawaii Dental Association directories for cross-reference.

**Tier 3, intent sources (the post's institutional, platform, and public-presence buckets applied to dentistry)**
- Vendor doctor locators: CEREC (confirms in-house milling), Invisalign (provider tier is a volume proxy), Nobel Biocare, Straumann, Zimmer Biomet (confirms implant work). The practice opted in to be found, and the listing tells you what they own.
- Insurance directories: Delta Dental of Washington and Hawaii Dental Service find-a-dentist. Practice-level, by ZIP, catches stale NPPES addresses. HDS is high value for the Hawaii list.
- Study clubs and societies: Kois Center graduates, Spear dentists, Seattle Study Club affiliates, WSDA, Seattle-King County Dental Society, Hawaii Dental Association. CE-motivated, restoration-heavy dentists are the best lab buyers.
- UW School of Dentistry affiliate faculty (practicing dentists).
- Events: Pacific Northwest Dental Conference speakers and exhibitors, HDA convention.
- Firmographic appends: domain registration age (new practices), website vendor and booking widget, Indeed job posts naming a scanner or CEREC brand (tech stack plus growth signal).
- Cross-source matching: NPI first, then phone + ZIP, then normalized name + city with fuzzy matching, then practice name + street number, then email domain. Anything under 0.8 confidence goes to a review file rather than being force-linked. A list that is half duplicates is half the list.

## The build (Claude Code stack)

- Runtime: the Mac already running OpenClaw, or a $6 to $12/mo Hetzner or DigitalOcean VPS for cron reliability. Levi's $40 VPS is overkill at this scale.
- Python, Postgres (SQLite to start is fine), httpx for APIs and CSVs, Playwright for JS-heavy license portals.
- One adapter per source: sources/nppes.py, wa_doh.py, hi_dcca.py, or_bod.py, wa_sos.py, gmaps.py, site_crawl.py. Common schema: providers (keyed by NPI), practices (keyed by normalized phone + address), signals (tech tags, scanner, CEREC, implant focus), contacts (emails with source and verification status).
- ICP score per practice: specialty, scanner signal, no CEREC, review count, distance from Bellevue, new practice flag.
- Maintenance loop (the actual point of the post): nightly cron runs every adapter. If an adapter errors or its record count drops more than 30%, log it and hand the traceback to Claude Code to repair. Weekly diff produces the trigger list: new licenses, new NPIs, new practice entities, address changes.
- Proxies: only for Google Maps and site crawling at volume. A small residential plan ($20 to $50) or just rate limit. Government portals: low concurrency, polite, respect terms.
- Scale reality: roughly 5,000 to 6,000 active WA dentists, about 1,000 in HI, about 3,000 in OR. Phase 1 is about 10k providers and 4k to 5k practices. Six to eight sources, not eighty.

## Email enrichment waterfall

1. Practice website crawl (mailto links, contact page, footer). Front-desk inboxes at dental offices are actually monitored, and the office manager usually co-decides on labs.
2. Pattern guess on the practice domain (drfirst@, first@, first.last@) verified with MillionVerifier or ZeroBounce.
3. Findymail, Prospeo, Anymail Finder, Hunter waterfall on doctor name + domain.
4. Fallback channels: NPPES practice phone for calls, NPPES practice mailing address for direct mail. No SMS (TCPA risk).

Target: 70% or more of Phase 1 practices with a verified email, bounce rate under 3%.

## Sending infrastructure (scaled down from Levi's agency stack)

- Never send cold from integra.dental. Buy 6 to 8 lookalike domains (integradentallab.com, integralab.co, integramilling.net, etc.), set SPF, DKIM, DMARC, forward to integra.dental.
- 3 inboxes per domain, 20 to 25 total, via Google Workspace or a bulk inbox provider. Warm up 14 to 21 days. Start this on day one, it is the long pole.
- Sequencer: Instantly or Smartlead (EmailBison if you want Levi's exact stack). Cap 20 to 30 sends per inbox per day.
- Throttle to lab capacity: start at 100 to 200 sends per day and cap new trial cases at 4 to 6 per week until production and onboarding are smooth. Hitting 5,000 practices once a quarter with sharp copy beats blasting.

## Offer and copy

Dentists are cold-emailed by labs constantly. What cuts through: locality, specific proof, and a no-risk first case.

- Lead offer: send us one case you would normally send elsewhere. If it does not seat, you do not pay. (Alternatively, first crown free or first three units at a flat intro price.)
- Proof points to rotate: Bellevue lab with in-house Arum 5-axis milling and Dekema sintering; slow-cooldown protocol that solved full-arch connector cracking; 3Shape design with manual QC (the AI vs. manual deviation study showing systematic over-contouring is a great talking point); cross-polarized shade photography; Eastside and Seattle pickup and delivery; digital impressions accepted directly from TRIOS, iTero, Medit.
- Segment copy: single-unit zirconia turnaround for GPs; implant and full-arch for prosth, OS, perio; scanner users get the digital-workflow angle; Hawaii gets shipping both ways covered on the first case plus in-person review on Maui Sept 25 to Oct 6.
- Sequence: 3 to 4 touches over 14 days. Email 1 plain text, one proof point, trial offer, no images, no links except unsubscribe. Email 2 a short case story with a photo. Email 3 the AI over-contour finding. Email 4 breakup.
- Sender: Phillip, CEO. Reply-to a monitored inbox.

## Multichannel layer

- Phone: 20 calls a day to practices that opened but did not reply, ask for the office manager, offer the trial case.
- Direct mail: physical trial-case kit (prepaid FedEx label, lab slip, shade card) to the top 100 Eastside practices by ICP score. NPPES mailing address is exact.
- In person: Bellevue and Seattle drop-ins; Maui and Oahu during the trip.
- LinkedIn and Instagram connects by doctor name after email 1.

## Compliance

- CAN-SPAM: honest from and subject, physical address in every email (35 148th Ave SE, Suite 10, Bellevue, WA), working unsubscribe honored within 10 days, global suppression list. Avoid harvesting addresses from sites that post a no-harvest notice.
- Washington CEMA (RCW 19.190): no misleading subject or sender info on email to or from WA addresses. Straight copy is fine.
- Data: public records only, no logins bypassed, no paywalls, low request rates on government portals. Use only business fields from the WA DOH file. No HIPAA exposure (no patient data).

## Timeline

**Week 1 (Sept 1 to 7)**
- Buy domains and inboxes, set DNS, start warmup.
- Claude Code: NPPES pull for WA and HI, WA DOH pull, dedupe into Postgres, ICP scoring v1.
- Manual Hawaii push: hand-picked 30 to 50 Oahu and Maui practices, one-to-one emails from integra.dental (no warmup needed), trial case + in-person offer.

**Week 2 (Sept 8 to 14)**
- Google Maps and website crawl adapters, tech-signal tagging, email waterfall, verification.
- Copy and sequences built in the sequencer. Hawaii list complete (about 1,000 dentists, about 500 practices).

**Week 3 (Sept 15 to 21)**
- First inboxes finish warmup. Launch Hawaii sequence at 50 to 100 a day. Launch WA Eastside batch. Mail the first 100 trial kits.

**Week 4 (Sept 22 to 28)**
- Iterate copy on reply data. Book Maui and Oahu meetings. Add OR and ID sources.

**Ongoing**
- Nightly refresh, weekly new-practice trigger campaign, monthly review of reply rate by segment and copy variant.

## Budget (monthly unless noted)

- Domains: about $100 per year for 8
- Inboxes: $75 to $170
- Sequencer: $37 to $97
- Email verification: $20 to $50
- Email finder credits: $50 to $100
- Google Places API: $0 to $50 (free credit covers most of it)
- Proxies: $0 to $30
- VPS: $0 to $12
- Direct mail kits: $500 to $800 one-time for 100

Roughly $250 to $500 per month plus about $700 setup. Claude Code time is the real cost.

## Targets and math (estimates, dental is a heavily emailed vertical)

- List: 4,500 to 5,500 practices in WA and HI, 70%+ with verified email.
- Deliverability: bounce under 3%, spam complaints under 0.1%.
- Replies: 2 to 5% total, 1 to 2% positive.
- 5,000 practices emailed over 6 weeks: 50 to 100 positive replies, 15 to 30 trial cases, 5 to 10 recurring accounts.
- Five new recurring GP accounts at $3k to $5k a month each materially changes the lab's economics. This is also a cheap, fast, decisive test that produces real data for the keep-or-pivot question within 60 days.

## Open decisions

- Trial offer: free first crown vs. no-seat-no-pay vs. flat intro price.
- Sequencer choice: Instantly vs. Smartlead vs. EmailBison.
- Who handles reply triage and phone follow-up (Phillip vs. Edward or Soyoung).
- Weekly trial-case cap while production ramps.

## Week 1 tasks (for Business Tasks)

- Buy 6 to 8 lookalike domains, set SPF/DKIM/DMARC, provision 20 to 25 inboxes, start warmup. Due Sept 3.
- Decide sequencer (Instantly vs. Smartlead) and sign up. Due Sept 3.
- Claude Code Phase 0 and Phase 1: repo scaffold, NPPES WA+HI, WA DOH, Hawaii DCCA, practice resolution. Due Sept 7.
- Hand-pick 30 to 50 Oahu and Maui practices and send one-to-one trial case emails from integra.dental. Due Sept 7.
- Confirm client suppression list (Jung, DreamWorks) and competitor list. Due Sept 5.
- Decide trial offer wording. Due Sept 5.
