# Main feature audit — 2026-10-18

Compared the live checkout against freshly fetched `origin/main` commit `b4d8025`. The feature-branch integration preserves the main history. Real .env files are excluded; the earlier temporary stash remains as a recovery backup.

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

- Daywell AI chat, conversation history, constraint interpretation and phrasing endpoints. The latest main profile preference proposals, explicit accept/dismiss controls and cuisine preference persistence are preserved; their new endpoint has a preview proxy.
- Fridge-photo ingredient scanning, free-text groceries, editable quantities and used-up ingredient confirmation.
- Postgres pantry and saved-meal routes; saved-meal write on selection.
- Dynamic dish image matching and prefetch, nutrition detail/goal UI, and USDA lookup endpoint/module.
- Substitution module, endpoint and existing substitution display.
- Apple and Google Calendar connection interfaces, week/month calendar, activities and imported events.

Presence is not proof of provider connectivity. Provider contract tests use mocks; this audit does not claim live Gemini, Postgres, USDA or Google OAuth verification.

## Intentional differences requiring attention

The earlier requested accuracy work changed the recipe pipeline before the main merge: Cook opens local discovery; the visible grocery/photo button opens recipe generation. Generated recipes require review and cannot bypass diet, allergy, budget, pantry or calendar checks.

Main's automatic recipe-time Backboard memory retrieval, automatic live USDA macro enrichment and secondary AI-generated substitutions are **not wired into the bounded draft generator**. Their modules/endpoints have been preserved, but this is a remaining feature-parity gap, not a verified working integration. Restoring those calls requires reconciling the generation contract and source/portion matching; this audit did not alter Gemini or USDA matching to conceal the gap.

Logging no longer inserts extra planned-meal blocks. Empty/partial allergen lists do not establish absence. No fake/default official prices, nutrition or stock have been restored.

Calendar refresh is read-only, for already connected providers. Universal/two-way calendar sync is not implemented.

## Verification

The latest pricing/image checks run 117 JavaScript tests and 23 backend tests; all pass. Full lint and production build pass; the existing large-bundle warning remains. New regressions cover historical main snapshots, equipment choices, exact gram payloads, retained endpoints and separate assistant/draft requests. Earlier isolated browser checks verified drag selection, future-date preservation and clearable duration input.

## Holiday calendar correction

Informational all-day festivals, including 重阳节, remain visible but no longer block meal eligibility or free-window discovery. Timed events and genuine all-day commitments remain protected. Imported event details now offer a Daywell-only busy/free control, retained across refresh and reload; source calendars are unchanged. Browser verification with an isolated, stocked test pantry showed nine available Cook options on the festival day.

Runtime check: the active preview backend reports Gemini and Backboard configured, but database and USDA unavailable. These flags do not prove live provider calls. Postgres/USDA cannot be presented as connected in this environment.
