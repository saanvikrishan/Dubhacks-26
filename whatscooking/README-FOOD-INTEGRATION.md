> Latest main merge, nutrition, preference and calendar update: [README-MAIN-PREFERENCES-FIX.md](README-MAIN-PREFERENCES-FIX.md). Older counts and paths below are historical.

# Food decision integration — 2026-10-18

Implementation and live evidence are in `FOOD-INTEGRATION-VERIFICATION.json`. Historical prices/routes in that report are not current quotes. All code changes are in this repository; the deferred photo changes remain separate local work. No pushes or merges were performed for this implementation.

## What now reaches the existing cards

- A shared `/api/food/reference` response supplies 14 reviewed USDA ingredient identities/detail records and 13 exact product quotes at QFC University Village (`70500807`). Full USDA originals are retained in `src/data/food/usda-records.json`; the browser receives a compact subset. Review mappings are in the adjacent ingredient/pricing manifests.
- The client calculates nutrients from input grams and published per-100-g values. Missing nutrients stay null; explicitly published zeros stay zero. Foundation energy uses Atwater-specific 2048, then general 2047, then 1008, then kJ 1062. Other data types prefer 1008. Energy entries are never added together. Nutrient IDs and row IDs/nutrient numbers are distinct.
- Store-specific regular package prices become estimated ingredient-use costs. Full-package purchase estimates are separate; loose produce sold by weight uses the requested weight. Promotions are retained separately and are not automatically applied. Oil/shoyu volume and large-egg count conversions cite the corresponding USDA foodPortions; these are ingredient-specific mass estimates, not a universal cup-to-grams assumption.
- New selections use the existing saved-recipe snapshot field and existing choose/log/reload paths. A later price or source refresh creates a new candidate identity; previously selected/logged facts remain unchanged. Final cooked portion weight is not inferred from ingredient input weights.
- School cards use dated UW dishes through the existing engine. The primary card shows the dish, serving, published price/calories, station, and actual Google walking distance/time. Original menus, limitations and station details remain one click away. Venue browsing remains when a supported dish cannot be recommended.
- Google WALK matrices are retrieved automatically while school dining is open, cached server-side, and checked for freshness. Routes start at the UW HUB; they do not imply the user's current location, queue length, stock or future walking conditions.
- Backboard preference recall reads existing memories without creating assistants or writing test memories. Current explicit profile preferences and hard restrictions take precedence. Relevant recalled preferences break ties in the normal preference order; memories never create nutrient/price facts or relax a restriction. The live read succeeded but returned **zero usable preference records**, so current recommendations use the current profile.
- The Cook deck now respects the existing three-choice limit. Daily nutrition goals use confirmed intake as advisory progress/ranking information. A meal is not rejected merely because it cannot supply an entire daily minimum; incomplete logged nutrient totals do not become a complete daily total.

## Current supported coverage and honest gaps

Live checks produced complete ingredient-use prices for four of the nine curated recipes:

| Recipe | Ingredient-use estimate at verification |
| --- | ---: |
| Tofu & roasted vegetable bowl | $3.88 |
| Creamy Garlic Fried Rice | $3.47 |
| Tofu, cucumber & rice salad | $4.97 |
| Garlicky tomato rice | $3.26 |

Five recipes have complete calorie/protein calculations. The remaining nutrition gaps are generic `cheese`, `bread` and `yogurt` entries without a sufficiently specific variant. Explicit cheddar, whole-wheat bread and plain whole-milk yogurt matches are supported when those are the actual ingredients; they are not silently assigned to vague names.

Boiled unsalted chickpeas have a USDA nutrient match but no reviewed package quote with confirmed drained edible mass. A can's gross/net weight is not silently used as drained chickpea weight. Those costs stay incomplete. Unsupported generated ingredient names/forms also remain incomplete and can be reviewed using `/api/nutrition/candidates?q=...`; search results never automatically become matches.

UW coverage remains 832 nutrition listings, 151 reviewed scheduled menu rows, 113 priced menu rows, 24 certified menu/nutrition joins and 23 priced joined rows. These are scheduled rows, not 151 distinct meals. UW protein, unpublished allergens and unverified future menus remain unknown. Generic USDA ingredients do not replace official UW dish facts.

## Live verification and checks

- `/api/food/reference` returned HTTP 200 through both running site proxies; 13/13 reviewed product identities returned regular prices.
- USDA batch details returned HTTP 200 for all 14 reviewed IDs, including Foundation yogurt with both energy schemes.
- Backboard existing-memory read succeeded; zero usable preferences were found. No dummy writes or model calls were made for this check.
- Google returned verified walks: Local Point 918 m / 13 minutes; Center Table 544 m / 9 minutes; Husky Den 0 m / 0 minutes at the same HUB origin pin.
- Isolated browser checks showed three sourced Cook choices, a $3.88 / 552.7 kcal / 35.01 g protein tofu bowl, successful selection/reload, and a dated UW cheese slice at $3.49 / 380 kcal with the 918 m walk. External writes were blocked by the test-only proxy; the real pantry, plans, logs and database were not seeded with test records.
- 124 JavaScript tests and 31 backend tests pass. Full lint and production build pass. The pre-existing bundle-size warning remains; compacting USDA browser records avoids shipping full laboratory metadata.

The price issue reported during implementation was a running-backend mismatch: the old backend returned 404 for the new facts endpoint. Both running site ports now use an updated backend. While lookups are pending, the page says it is checking prices; a failed request offers retry rather than implying the user's food constraints are wrong.

## Reusable refresh and runtime

Run `backend/.venv/bin/python server/food-refresh.py` from `whatscooking.ai/` to refresh reviewed USDA IDs. The process batches at most 20 IDs, verifies descriptions/data types, and preserves previous files on failure or identity drift. It never promotes fuzzy search hits. API clients cache details/quotes, coalesce requests where appropriate, handle rate/error responses without exposing credentials, and never refresh a failed quote's retrieval timestamp.

The final server check retrieved all 14 USDA records live and 13 product prices after restarting the backend with the asyncio event loop. A prior failed refresh used the dated saved USDA reference; it did not generate replacement facts.

For the same runtime, start from `backend/` with `.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio`. Both existing site proxies use this backend.

Keep keys in `backend/.env`. Google Routes uses `GOOGLE_MAPS_API_KEY`; Google Calendar OAuth credentials are separate. Existing Gemini models, prompts and generation endpoints are unchanged. Plans, log operations, storage schema, calendar sync and timeline layout are unchanged; snapshots reuse the existing recipe collection. No Spectrum integration or additional paid service was introduced.

References: [USDA API guide](https://fdc.nal.usda.gov/api-guide/), [Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/), [Kroger API reference](https://developer.kroger.com/reference), [Google route matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix).
