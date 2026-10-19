# whatscooking.ai recommendation integration fix plan

Implementation results and remaining source-data gaps: [README-FOOD-INTEGRATION.md](README-FOOD-INTEGRATION.md).

Prepared 2026-10-18 against the current `kevin/meal-decision-fixes` checkout. This is a plan, not a claim that the integration is finished. Photo work remains deferred; existing local photo changes are left untouched.

## Intended result

Existing Food cards use sourced meal facts before the existing engine decides eligibility. For supported recipes, nutrient estimates and ingredient-use costs populate automatically. UW cards use actual dated dishes, exact published prices, station hours and fresh Google walking results. Show at most three recommendations, with a short reason for each. Unsupported facts remain explicitly incomplete rather than guessed.

## Evidence and immediate corrections

- The latest runtime check reports USDA unavailable; its lookup returns 503 because neither USDA_API_KEY nor FDC_API_KEY is configured. Four saved USDA ingredient records currently provide limited local calculations.
- Kroger OAuth/store/product requests and Google WALK route requests have live verification evidence in API-VERIFICATION.json. This does not establish complete meal pricing or universal provider health.
- Cook generation returns without Backboard recipe recall or live USDA enrichment. Client normalization also discards incoming nutrition/price facts, so a backend-only change will not finish the connection.
- Cook discovery overrides the configured three-card limit with 150.
- The UI defines nutrition goals as daily goals. UW currently compares each dish directly against the whole goal, which can reject suitable meals incorrectly.
- UW imports contain 832 nutrition listings and 151 reviewed menu rows: 113 menu rows have prices, but only 24 menu rows have certified nutrition matches, 23 of them priced. Protein is unpublished in all imported nutrition rows. These counts include repeated scheduled entries, not 151 unique dishes.

## Ordered implementation

1. **Correct the decision rules and preserve existing behavior.** Restore the existing three-card limit, deduplicate exact choices and keep unfinished drafts in their review path. Treat daily goals as progress against confirmed intake, not a minimum one meal must satisfy. Keep hard diet/allergen/budget/pantry/equipment/calendar checks and selection-time revalidation. Do not rewrite existing logs, plans or their saved values.
   - Main files: src/domain/discovery.js, src/domain/engine.js, src/domain/uwDining.js.

2. **Attach trustworthy facts at a single enrichment boundary.** Reuse current recipe request, adapter and record structures around generation. Keep model output separate from provider facts; validate fact identity against ingredient, form, grams and recipe yield. Preserve citations, original units, timestamps, source IDs and missing-data reasons through client normalization. Do not change Gemini models, prompts or generation behavior. Reuse existing snapshot boundaries so a later refresh cannot change historical intake.
   - Main files: backend/main.py, src/adapters/recipes.js, src/domain/generatedMeals.js; a small enrichment helper if needed.

3. **Finish USDA nutrient calculation.** Configure and verify the live endpoint, then expand reviewed ingredient matches to cover the ingredients actually used by the existing recipes, including oil, eggs, dairy and vegetables. Match by FDC identity and raw/cooked/product form; do not silently accept the first search hit. Fetch source detail records, scale published nutrients by edible input grams, and divide by explicit recipe yield. Preserve missing nutrients as null, never zero. Reuse saved reviewed records and cache requests. Update the client to retain validated source facts. Ingredient-based results remain labeled estimates, not exact UW dish nutrition.
   - Main files: backend/usda.py, src/adapters/usdaFood.js, src/data/sourcedCatalog.js, src/domain/generatedMeals.js.

4. **Finish Kroger recipe costing.** Reuse the existing store-scoped client. Add reviewed ingredient-to-product matches with product/store IDs and usable package weights. Calculate ingredient-use cost as package price × ingredient grams / usable package grams; sum per recipe portion. Keep consumption cost distinct from the cost of buying a full package. Do not infer grams for count-only packs or assume promotional eligibility. Unsupported units, drained-weight ambiguity and missing quotes stay incomplete. Attach valid cost facts before budget evaluation; stop requiring manual cost entry when sourced costing is complete.
   - Main files: backend/kroger.py, enrichment boundary, existing recipe record/review adapter.

5. **Make UW dishes and walking routes part of the shortlist.** Feed dated, reviewed dish records through the same decision engine and existing cards instead of relying on venue-only recommendations. Join menu/nutrition only for supported venue, station, portion and variant matches; exclude components/add-ons as complete meals. Automatically retrieve one cached Google WALK matrix when school dining is opened and refresh stale results while needed, without request loops. Use route duration in meal timing and show route distance with its origin. Respect station closures, conflicts and date coverage. Keep unmatched menus and nutrition listings available in details; they are not evidence of a complete current meal.
   - Main files: src/ui/FoodViews.jsx, src/ui/UwDining.jsx, src/adapters/uwWalking.js, src/domain/uwDining.js, existing UW adapters.

6. **Use Backboard for relevant preferences, then verify the full path.** Reuse existing memory endpoints/client for bounded, cached preference recall. Use recalled likes/dislikes as explainable soft preferences; explicit current profile settings take precedence. Memories cannot relax diet/allergen/budget/calendar constraints or invent food facts. Do not upload additional full-state snapshots or change persistence for this fix. Verify a read against the existing assistant without dummy writes; report any configuration/authentication/SDK failure accurately. Reuse the current priority sorting and explain the result without introducing an opaque AI score.
   - Main files: backend/main.py, existing recipe orchestration and assistant adapter; no memory-storage redesign.

Steps 3 and 4 share the enrichment boundary. UW source data and route wiring can be completed while waiting for a USDA key. No new paid services are needed.

## Verification and completion gates

- A supported, measured recipe including oil receives sourced nutrient estimates and store-specific portion cost automatically; citations and quantities survive API-to-card normalization.
- Changing grams, servings or store updates the correct derived facts. Raw/cooked mismatches, count-only packages, missing nutrients and expired quotes cannot appear as confirmed complete totals.
- Daily goals use confirmed intake only. They do not reject a meal merely because it supplies less than the entire daily minimum; incomplete intake is not treated as a complete daily total.
- An eligible reviewed UW dish has its own dated menu price, station hours and fresh HUB walking route. Nutrition-only rows, closed stations and unsupported dates do not become verified recommendations. Unpublished protein remains unpublished.
- At most three valid choices appear. Drafts, duplicate scheduled entries and excluded choices do not flood the recommendation deck. An empty result explains the specific constraint or data gap.
- Backboard recall influences relevant preferences when available; failure falls back to current profile settings without preventing meals or weakening restrictions.
- Focused adapter/enrichment/engine regressions, one supported Cook and one UW browser walkthrough, lint and production build pass. Existing plan/log/history invariants remain covered. Provider reports distinguish live calls from mocks and configuration flags.
- Record per-provider live results and supported/missing ingredient, price, route and menu coverage. Do not claim all APIs work from configuration alone.

## Needed from the user

- **Required for live USDA lookup:** place a valid USDA FoodData Central key in `whatscooking.ai/backend/.env` as `USDA_API_KEY` (or the supported `FDC_API_KEY`). Do not paste the secret into chat. Other work can proceed without it.
- **Proposed demo defaults, subject to user preference:** QFC University Village (`70500807`) for grocery quotes and UW HUB for walking origin. These are defaults for the demo, not the user's inferred location or store preference. Actual-location routing would require an explicitly selected origin and permission if using device location.
- Existing Google, Kroger and Backboard credentials can be reused, subject to live verification. No additional credentials are currently identified as necessary.

## Scope boundaries

Keep the existing card layout, Cook selection interaction, Gemini integration, plans, logs and persistence. Changes target input facts and recommendation evaluation. Do not fix timeline overlap, redesign the app, resume photo work, push main or overwrite teammates' changes. Preserve the already-present local photo edits separately from this planned work. If a data connection requires a persistence/schema change beyond existing snapshot fields, document that dependency before expanding scope.
