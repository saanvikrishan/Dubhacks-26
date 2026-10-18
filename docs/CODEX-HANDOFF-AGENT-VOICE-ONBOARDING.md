# WhatsCooking.ai — current agent handoff

Updated 2026-10-18 from source and passing tests. Use the [main README](../README.md), [architecture](ARCHITECTURE.md), and [verification](VERIFICATION.md) as the current reference. Older design documents are historical, not implementation instructions.

## Release and preservation

The final release is based on teammate main `64c8d17`, which renamed the active directory to `whatscooking/`. Keep that path; product copy is **WhatsCooking.ai**. Integration is in a separate worktree at `/tmp/whatscooking-final-release` on `codex/finalize-whatscooking-20261018`. The original dirty `kevin/meal-decision-fixes` checkout, its `whatscooking.ai/` directory, local reports/archive, and credential files were preserved. Do not reset that checkout or blindly stage its renamed tree. Local development servers from the earlier session still serve that original tree, not this release.

The user authorized finalization, commits and push to main, with an explicit pull before push. Use normal pushes, never force-push. Pull in the integration worktree after committing; stop for risky conflicts. Do not edit `.env`, disclose credentials, or run paid smoke tests repeatedly.

## Working implementation

- React/Vite browser state and validated transitions, Today/My Meal Plan/Let's eat, pantry and grocery sessions, meal slots and separate consumption logs.
- Deterministic eligibility/ranking, cuisine variety, 11 cuisines, 6 tastes, 6 onboarding goals, 131 reviewed USDA ingredient records, 13 reviewed QFC product mappings, and reviewed UW dining with optional walking estimates. Unknown facts remain null. Weighted scoring is disabled.
- Gemini recipe drafts (three by default), fridge vision, substitutions, bounded/cached images; recipe review preflight, replacement confirmation and snapshot persistence. Existing quick review can confirm stock/equipment and approximate cost; it is not independent verification.
- Gemini assistant uses schema-validated function calls mapped to existing transitions, with whole-turn preflight, confirmation and local Undo. Notes/navigation, voice transcription/TTS/browser fallback, and chip/spoken onboarding already work. Onboarding previews do not save browser state or remote memories before confirmation.
- Backboard records per-user chose/logged/skipped signals, bounded learned preferences, remembered facts, and photo indexes. Shared demo preference mirroring is separate. Anonymous IDs are not authentication.
- Local events/tasks/recurrences, ICS import, Apple EventKit bridge and read-only Google import. Automatic meal windows account for full meal duration. Separate Spectrum worker polls Postgres for enrolled-phone reminders; no messages were sent during finalization.
- Earlier integration fixes remain: task kind retention; review preflight; goal clearing/custom-target preservation; prepared recipe exclusions; dotenv load ordering; same-origin sync/nutrition calls; clean lint and bounded build chunks. Teammate flavor controls and grocery-session retention are preserved.

## Finalization fixes

- `AllergyPicker.jsx` supports standard checkboxes plus typed custom allergies and removal in onboarding/preferences. Bounded names and aliases normalize in state, recipe requests and assistant tools. Positive conflicts block recipe review and discovery; unknown custom absence is never inferred from a standard catalog list. Reviews record the exclusions checked so new restrictions cannot reuse old coverage.
- Budget chips deselect, preferences accept a blank budget, and explicit `null` persists through state, storage, recipe requests and agent actions. Numeric caps still enforce price checks. No-cap reviews preserve unknown price as null.
- Mood/flavor filters apply before card slicing. If none fit, one deterministic local pass clears only these soft filters and explains the fallback. Known diet/allergy-conflicting drafts remain hidden. Mandatory eligibility is rechecked before planning.
- The recipe prompt distinguishes soft cuisines/tastes/history/goals from hard restrictions and broadens preferences within one response. Backend filters custom allergy and diet conflicts from model output. Empty output causes no automatic paid retry; Cook already exposes local recipe browsing.
- Branding compatibility modules retain old browser keys, environment aliases and Backboard assistant names, including the teammate release's shared assistant identity. New storage keys remain stable. Native calendar display/bundle identity is updated; permission may need renewal.
- Runtime requirements now include the Google OAuth libraries already imported by the implementation. Main and supporting READMEs describe actual behavior and limitations instead of speculative migrations.

## Verification and next priorities

**171 frontend tests, 90 backend tests, full lint, production build, and 10 mocked production-browser flows pass.** See verification for evidence and limitations. No live provider calls or outbound messages were made by these tests. Native helper compilation/signing passed in the preceding rename audit; finalization changes its display capitalization only, and did not request calendar permissions.

Outstanding: intentional live Gemini/microphone/provider smoke checks; Google tokens remain memory-only with a localhost callback/primary-calendar/500-event limit; reminder deletion/Undo does not remove remote rows and sync failures are not transactional; broader verified food/allergy coverage; authenticated cross-device state and production deployment. These require follow-up, not a last-minute redesign.

Ownership: Kevin — food contracts/nutrition/validation/recommendations; Saurav — Python/Gemini/backend/memory/provider services; Saanvi/Mahika — frontend UX/dashboard/cards/chat/deployment. Coordinate broader shared-code changes. Preserve existing architecture and contributor work.
