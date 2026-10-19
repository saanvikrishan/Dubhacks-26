# Latest session handoff (uncommitted work on `kevin/meal-decision-fixes`, based on main `b11dcb7`)

All changes below are **uncommitted**. App folder: `whatscooking/`. Backup of the old local `whatscooking.ai/` folder + pre-pull patch: `../local-backup-before-main-pull-1035/` (also `git stash@{0}`).

## Run
- Backend: `cd whatscooking/backend && MEAL_IMAGE_WARM=0 .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio`
- Frontend: `cd whatscooking/frontend && node_modules/.bin/vite --host 127.0.0.1 --port 5181 --strictPort`
- Checks: frontend `npm test` (175 pass), `npm run lint` (clean), `npx vite build`; backend `.venv/bin/python -m unittest discover -s tests` (93 pass).

## Done this session (all verified in the browser)
- **Memory:** Backboard rejects every memory save (HTTP 500, even with the new key; reads work, same account). `food_memory.py` / `agent.py` / `meal_images.py` now fall back to a private local store (`backend/.memory/<user>.json`, `generated-images/index.json`, gitignored) and read both. Backboard is retried automatically.
- **Speed:** `/recipes` no longer waits for the first photo; deck photo wait capped at 12 s; failing Backboard photo lookups paused 5 min. First card ≈13 s (was ≈60 s).
- **Recommendations always exist:** `discovery.js` shows closest safe recipes (never diet/allergy conflicts) when nothing fits; ✓ adds missing items to the grocery list (`needGroceries` in App). Campus shows "places for later" when nothing is open; no-kitchen Cook points to campus. Drinks excluded from campus cards.
- **Recipe generation:** backend `choose_drafts` keeps allergy/diet strict, time/equipment/repeats only order; empty results not cached; serving guidance in prompt; drafts estimated > 950 kcal listed last.
- **Grocery nutrition check:** realistic default amounts by type (`typicalGrams`), condiments excluded from food groups.
- **Onboarding/preferences:** voice removed from onboarding; shared `ui/BasicsChips.jsx` used in onboarding and at the top of Food preferences ("Your basics"). New users start blank (not vegetarian).
- **Voice input:** records until the user taps the mic again (no auto-stop, 5-min safety cap), then fills the text box; no hands-free re-listen. **Voice output noise fixed:** the TTS model returns a WAV file; `voice.py` now extracts the PCM (`pcm_from`) and fades ends.
- **Calendar:** event form has a Type (meal/class/workout/event/task); past days can't be auto-planned.
- **Nutrition data:** 131 USDA records verified identical to live USDA; built-in recipes use USDA-calculated values; UW items keep published saturated fat; "less than 1g" = 0.75 g. Guard test `tests/nutrition-accuracy.test.js`.
- **UI text/layout:** rounded numbers, friendly recipe card line, "Price not found", goal progress on Today, phone layout fixes, sticky swipe buttons solid, consistent "WhatsCooking.ai" name.

## Open items
- Backboard memory writes: account-side 500 — check Backboard billing/credits or support. Local memories are not uploaded to Backboard automatically when it recovers.
- `docs/ARCHITECTURE.md` has an "AI pipeline" diagram added by someone else (not from this session).
- Commit/push only with the user's OK.
