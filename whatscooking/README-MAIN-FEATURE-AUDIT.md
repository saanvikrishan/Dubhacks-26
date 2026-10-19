> Latest main merge, nutrition, preference and calendar update: [README-MAIN-PREFERENCES-FIX.md](README-MAIN-PREFERENCES-FIX.md). Older counts and paths below are historical.

# Main feature audit — 2026-10-18

The later food-data implementation and current service/test results are documented in [README-FOOD-INTEGRATION.md](README-FOOD-INTEGRATION.md).

Compared the live checkout against freshly fetched `origin/main` commit `bd66e44`. The feature-branch integration preserves the main history. Real .env files are excluded; the earlier temporary stash remains as a recovery backup.

## Compatibility fixes made in this audit

- Restored all 17 equipment choices, including air fryer, rice cooker and slow cooker, in preferences, recipe review and backend draft validation.
- Older `geminiMeals` snapshots now resolve saved plans and consumption after reload. Original historical values remain unchanged; old snapshots cannot silently qualify as newly verified meals. Saved current recipe drafts also reappear after reload.
- Reconnected the Postgres pantry save hook with entered gram quantities. Unknown quantities are never replaced with 500 g. Local saves still succeed when the database is unavailable.
- Reconnected the Backboard mirror's configuration check to the active proxied backend, rather than a different hardcoded server.
- Load backend environment settings before importing database configuration.
- Restored photo prefetch, a prominent grocery/photo entry button, optional location/commitment inputs, and main's behavior of hiding an eaten meal's Today hero without changing its saved plan.
- Preserved main's zero extra travel/buffer defaults. Explicit older allowances still count when present.

## Preserved teammate functionality

All main HTTP method/path combinations remain, including the new `/profile-patch` proposal endpoint. Additional routes provide walking results and read-only Kroger package quotes. No named UI components from main were removed.

- Latest main UI styles, prepared-dish backend matching, missing-ingredient alternatives and agent prompt files are included. Ambiguous image URLs still use the safe placeholder; the bounded recipe generator retains its documented contract.
- whatscooking.ai AI chat, conversation history, constraint interpretation and phrasing endpoints. The latest main profile preference proposals, explicit accept/dismiss controls and cuisine preference persistence are preserved; their new endpoint has a preview proxy.
- Fridge-photo ingredient scanning, free-text groceries, editable quantities and used-up ingredient confirmation.
- Postgres pantry and saved-meal routes; saved-meal write on selection.
- Nutrition detail/goal UI and USDA lookup endpoint/module. Automatic dish-photo matching was subsequently disabled after a user-reported mismatch; explicit bundled illustrations remain, and backend photo helper code is retained.
- Substitution module, endpoint and existing substitution display.
- Apple and Google Calendar connection interfaces, week/month calendar, activities and imported events.

Presence is not proof of provider connectivity. Provider contract tests use mocks; this audit does not claim live Gemini, Postgres, USDA or Google OAuth verification.

## Intentional differences requiring attention

The earlier requested accuracy work changed the recipe pipeline before the main merge: Cook opens local discovery; the visible grocery/photo button opens recipe generation. Generated recipes require review and cannot bypass diet, allergy, budget, pantry or calendar checks.

The later integration calculates sourced USDA nutrition and Kroger ingredient-use costs outside Gemini, and uses read-only Backboard recall for preference ordering. Main's automatic memory injection into the recipe-generation prompt and secondary AI-generated substitutions remain outside the bounded generator; those Gemini behaviors were not changed.

Logging no longer inserts extra planned-meal blocks. Empty/partial allergen lists do not establish absence. No fake/default official prices, nutrition or stock have been restored.

Calendar refresh is read-only, for already connected providers. Universal/two-way calendar sync is not implemented.

## Verification

The latest pricing/image checks run 117 JavaScript tests and 23 backend tests; all pass. Full lint and production build pass; the existing large-bundle warning remains. New regressions cover historical main snapshots, equipment choices, exact gram payloads, retained endpoints and separate assistant/draft requests. Earlier isolated browser checks verified drag selection, future-date preservation and clearable duration input.

## Holiday calendar correction

Informational all-day festivals, including 重阳节, remain visible but no longer block meal eligibility or free-window discovery. Timed events and genuine all-day commitments remain protected. Imported event details now offer a whatscooking.ai-only busy/free control, retained across refresh and reload; source calendars are unchanged. Browser verification with an isolated, stocked test pantry showed nine available Cook options on the festival day.

The earlier runtime check found USDA unconfigured. A key was subsequently supplied and live USDA batch retrieval passed; the current report distinguishes live USDA/Kroger/Google/Backboard reads from configuration-only flags. Database connectivity was not independently verified in this task.
