# Nutrition, preferences and calendar integration — 2026-10-18

The latest main (`c751607`) is incorporated locally, including its move to `fridgemate/frontend`, WhatsCooking.ai branding, notes, open meal slots, and Photon reminder code. The merge is uncommitted, no push was made, and the pre-merge local work remains in a backup stash. The working implementation is directly inside this repository.

## Nutrition and one serving

The all-unknown panel was not caused by missing grocery purchase weights. Recipes already specify ingredient grams for one serving; an unmatched ingredient or unpublished nutrient previously suppressed each entire nutrient total in the UI.

There are now 20 reviewed USDA ingredient records. All nine curated recipes calculate calories and protein for one serving. Exact simple aliases cover names such as cucumber/cucumbers. Generic recipe ingredients use explicit standard recipe choices: cheddar cheese, whole-wheat bread, plain whole-milk yogurt and green-leaf lettuce. These choices appear in the recipe details and are estimates for that recipe, not claims about the user's pantry brand. Specific alternative variants are never silently changed.

The panel displays available nutrient values. When a source omits one ingredient's nutrient, a clearly labeled subtotal shows the published values and names the missing ingredient. Complete intake totals remain incomplete internally, so dietary goals do not count a subtotal as a complete meal. Final cooked weight is not required for per-serving nutrition, and the confusing “Final portion weight unknown” message is removed.

Six of nine curated recipes have current QFC ingredient-cost estimates from 13 reviewed products. The remaining three need a confirmed drained package weight for chickpeas; nutrition is still shown. UW official dish facts and unpublished protein remain separate from Cook ingredient estimates.

## Food preferences and Backboard

Food preferences now include favorite cuisines, tastes (spicy, mild, savory, sweet, tangy and fresh), preferred foods and dislikes. They affect deterministic recommendation ordering and are passed as bounded inputs to the existing single-serving recipe generator. The Gemini models, provider, response schema, quotas and validation flow are preserved. Budget, allergens and dietary restrictions still determine eligibility.

Backboard saves structured food-preference snapshots through the existing `/preferences` endpoint. Calendar events, meal logs, pantry quantities and the entire application state are no longer copied into these new preference memories. The latest explicit snapshot takes precedence over old memories; clearing preferences is respected. Saving invalidates recall caches. Recalled soft preferences guide ordering after current explicit preferences; they never supply nutrition/prices or override hard restrictions.

Live memory reads succeeded but returned zero usable preferences during verification. New preferences are written when the user changes and saves the form. Automated write tests use mocks, and browser tests block external writes; no fake preference was written to the user's memory.

## Calendar and main compatibility

The local Apple Calendar helper now runs as a signed macOS app bundle through Launch Services with an AppKit run loop, so the permission prompt has a proper native app identity. The user approved the prompt and confirmed a successful connection; status reports `authorized`. Connecting requires the app consent checkbox before requesting EventKit permission. The UI distinguishes new permission, existing permission and denied/restricted access. A denied prompt requires System Settings → Privacy & Security → Calendars; the app does not reset system permissions.

A live read succeeded with 16 events in the verification range and 20 available calendars. No calendar event writes are implemented. Existing holiday treatment remains: 重阳节 is informational unless explicitly marked busy.

Merge reconciliation also preserved main's open meal slots in saved-state validation, applied normal eligibility when filling them, and fixed day-note state switching so one date's text cannot overwrite another date. No reminder message was sent during tests.

## Verification and runtime

129 JavaScript tests and 34 backend tests pass; lint and production build pass. The existing bundle-size advisory remains. Browser verification showed the one-serving pasta facts and changed the top recommendation from pasta to fried rice when the cuisine preference changed from Italian to Chinese. Full evidence and recipe coverage: `MAIN-PREFERENCES-VERIFICATION.json`.

Run the backend from `fridgemate/backend`:

```
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
```

Run the frontend from `fridgemate/frontend` with `npm run dev`. The live ports 5173 and 5185 both use this directory and backend. Refresh reviewed USDA records from `fridgemate/` with `backend/.venv/bin/python frontend/server/food-refresh.py`.

References: [Apple EventKit access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store), [Backboard memory API](https://docs.backboard.io/api-reference/memories/add), [USDA API guide](https://fdc.nal.usda.gov/api-guide/).
