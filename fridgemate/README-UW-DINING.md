# UW dining integration

This extends the existing Daywell application. Cook discovery, Gemini recipes, meal plans, logging, persistence and the timeline are unchanged.

## Run

The existing Python backend loads `GOOGLE_MAPS_API_KEY` from `backend/.env`, then the application `.env`. No browser variable or client key is used.

Start the backend as usual from `backend/` with `uvicorn main:app --host 127.0.0.1 --port 8000`, and run `npm run dev` from `fridgemate/frontend/`. Restart an already-running backend to load the new route. The new button in Food → Eat at school explicitly requests `POST /api/dining/walking`; Vite forwards that to `POST /dining/walking` on FastAPI. Production hosting must proxy that path to the running Python backend. A static `dist/` alone cannot supply walking results. `DAYWELL_DINING_BACKEND_URL` optionally overrides the development backend proxy targets.

The endpoint uses Google Routes **Compute Route Matrix**, `travelMode: WALK`, a fixed UW HUB origin and the existing three venue pins. It sends the API key only in Google's request header. No Places, Geocoding, legacy matrix fallback or additional paid service is introduced. Successful and partial matrices are cached in process memory for five minutes; no Google results enter persisted application state. Missing keys, rejected requests, invalid elements and expired results leave walking values unknown. A Maps directions link is available independently of API success. The HUB/Husky Den identical pin is a zero route, not an indoor directions or entrance-distance measurement.

## Reusable ingestion

Use Python 3.11+ with `pip install -r server/uw-requirements.txt` and the existing Node environment.

1. `python3 server/uw_ingest.py --ocr` downloads public official pages, discovers the station links from the nutrition index and weekly PDFs from the venue pages, extracts aligned HTML nutrition tables and PDF text, and runs local Apple Vision OCR for image-based menus. `--ocr` requires macOS/Swift; omit it on other platforms and review the saved PDFs manually. It never logs in or follows authentication links. No cookies, credentialed scraping or access-control bypass is used.
2. Review the PDF page renderings and update `src/data/uw/reviewed.json`. OCR evidence is never automatically promoted to a verified menu entry. Preserve price scopes, component/plate distinctions, printed dates, weekdays, variants and portion evidence. Record a nutrition match only with a specific name, venue, station, portion and matching calories; no fuzzy matching.
3. `npm run dining:build` checks each original source's SHA-256, applies only reviews for the exact PDF revision and semantic hours text, normalizes the catalog and writes `catalog.json` plus the compact browser input `browser.json`. Changed reviewed nutrition matches fail; new PDF or hours revisions lose reviewed status until reviewed again. The standalone catalog is usable without any UW or Google API.
4. `python3 server/uw_ingest.py --offline` rebuilds the extraction from the cached public files. It retains the original retrieval date rather than claiming a new verification. Run `npm run dining:build` afterwards.

Artifacts under `src/data/uw/`:

- `sources/` (local ingest cache, not committed): original HTML/PDF files, checksums in the snapshot, original retrieval-date sidecars, deterministic PDF text and local OCR with page coordinates/confidence.
- `snapshot.json`: all extracted station rows, discovered links, source URLs, hashes, original hours text and PDF evidence.
- `reviewed.json`: explicitly reviewed menu records, match decisions, price scopes, dates, weekday applicability, original values, station hours and conflicts; separate Husky Deals.
- `catalog.json` (generated, not committed): full normalized local catalog and import report. Nutrition listings remain distinct from dated menu entries and value deals.
- `browser.json`: compact source/review input; the browser uses the same pure normalization as the local builder.

Nutrition figures are UW-published approximations, not measured guarantees. Blank allergen cells never establish absence. Protein, total fat, fiber and final serving weights remain null when unpublished. Full-plate calories are not inferred from a protein choice, and a build-your-own bowl price is not transferred to a pasta component. A published menu establishes a schedule, not stock. Exact special-closure information was not published; station service windows are enforced only within the reviewed date period.

## Coverage and remaining work

The October 17 snapshot contains all 832 public nutrition rows for the three priority locations, 151 visually reviewed menu rows (including daily repeats), and 14 separately scoped value deals. There are 24 explicit menu-to-nutrition matches, 23 with a price. Four weekly PDFs covering October 12–18 and October 19–25, 2026 contain 115 pages, all retained with OCR evidence. Eleven content pages in the October 12–18 PDFs were promoted to structured verified menu records. The remaining pages, including the following week's menus, require review; this is not an exhaustive verified weekly menu.

Husky Den has 182 nutrition rows and four deals. Its retrieved venue page publishes no weekly PDF link, so no dated menu is certified there. Tero and Select have no published nutrition tables. Station hours for most Local Point/Center Table stations are not published separately; those remain unknown. Hours are conservatively applied only to October 12–18, 2026 in America/Los_Angeles. Do not extend that window merely because a future menu exists.

Source conflicts are retained, including pizza calorie mismatches, Wednesday clipped prices, Tuesday soda values, and Husky Den Friday pizza hours conflicting with the building widget. Read the detailed import report delivered alongside the repository for counts and live verification.

## Validation

- `npm test`
- `npm run lint`
- `npm run build`
- `python -m unittest discover -s backend/tests -v` with the existing backend environment

Tests use fake route transport and require no paid requests or API key. A separate live verification was performed with the user's existing key and the actual endpoint was exercised through an isolated Vite preview. Nothing was committed or pushed.
