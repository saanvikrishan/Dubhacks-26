# Continue whatscooking.ai at final quality

This is final-quality work for the DubHacks submission, not a prototype and
not a rough pass to clean up later. Ship the two behaviors below as if a
student will rely on them tonight: correct under the stated rules, honest
about every unknown, covered by tests, and safe with the API key.

A finished result is not a screen where every meal looks feasible. The
finished result is a decision path that uses a real retrieved fact when one
exists and refuses to invent the rest. Placeholder prices, guessed hours,
copied demo nutrition, and unlabeled estimates are defects.

You are continuing Kevin's food-decision work in the existing whatscooking.ai app.
The app already runs. Do not rebuild it.

Repository checkout:

`/Users/jiaqian.zhang/Downloads/Dubhacks2026/Dubhacks-26`

App directory: `whatscooking.ai/`

Branch: `kevin/meal-decision-fixes`

Current commit: `bff0cc4`

The working tree is dirty on purpose. Keep every uncommitted and untracked
change. Do not revert, stash, reset, delete, commit, or push. Do not switch
branches. Do not update git config.

## What this task is

Bring these two behaviors to final quality.

1. Sourced walking durations from Google, using the backend environment
   variable `GOOGLE_MAPS_API_KEY`.
2. Consumption logging that never creates, replaces, or deletes a meal plan.

That key can supply only a retrieved walking duration and a route distance.
It cannot supply price, hours, nutrition, allergens, stock, or a student's
pantry. After this task, the five UW sourced meals must still be not feasible.
Show the new walking fact beside the existing straight-line meters. Leave
every other unknown field null.

## Quality bar

Treat a shortcut that only looks done as a failed task.

- Every number on screen has a source the code can name. A Google duration
  shows its retrieval time and is labeled as one walk from the HUB. The
  existing straight-line figure stays labeled straight-line meters.
- Unknown stays null. A failed request, a denied key, a missing coordinate,
  and an unpublished nutrient do not become zero or a plausible guess.
- Feasibility still fails closed. Walking minutes alone must not make a
  sourced meal selectable. Price and hours are still unknown.
- The API key never reaches the browser, a response, a log, a test fixture,
  or git. The browser sends venue ids only.
- New logic is pure where it parses and decides, and the network boundary is
  thin. Tests drive the parser and the decision with a fake transport.
- Do not weaken an existing test, skip a failing check, or special-case the
  demo clock to hide a conflict.
- Match the current React and FastAPI code. Do not add a framework, a state
  library, or a new meal model.
- Leave the dirty work of other teammates in place. Your diff should contain
  only this task.

## Already done — do not redo

These behaviors are already in the dirty tree. Preserve them.

- Cook opens the local discovery deck (`cookPhase` starts as `"discover"`).
  Ingredient entry and Gemini stay behind "Change groceries." If recipe
  generation fails, stay on the local deck and show the error. Do not call
  Gemini from the normal Cook path.
- `mealWindowStillOpen` in `whatscooking.ai/src/domain/calendar.js` keeps a window
  that is still today and has not reached its end. `goFood` calls
  `nextMealWindow` only when that helper returns false.
- `reviewGeneratedMeal` does not copy the user's diet onto a generated meal.
  `dietsFromIngredients` may label a meal only when every ingredient name is
  in the maintained list. An empty allergen list stays null.
- Today still shows the chosen plan after a consumption log. Confirmed intake
  is the log total, not the plan.
- `storageAdapter.status.synchronized` is `false`. `load()` reads only
  `localStorage`. A Backboard mirror runs only when `GET /` reports
  `backboard: true`, and a failed mirror does not roll back the local save.
- The Food page has a "Sourced" section. It evaluates `buildSourcedCatalog()`
  through the existing `evaluate` function and shows each rejection reason.
- Weighted scoring stays off: `simple_comparison`,
  `weightedScoringEnabled: false`. Do not edit that config.
- Do not add a Gemini client, `/api/interpret-food`, off-campus search, or a
  UI redesign. Do not replace `catalog.js` or `uwDining.js` wholesale.
- The nine illustrative cook recipes remain the swipe deck. Do not move the
  sourced catalog into that deck.

## Files you may edit

- New: `whatscooking.ai/backend/travel.py`
- New: `whatscooking.ai/backend/tests/test_travel.py`
- `whatscooking.ai/backend/main.py`: add one route and its import only. Do not
  rewrite recipe generation, vision, Backboard, or model fallbacks.
- `whatscooking.ai/vite.config.js`: proxy `/api/travel` to `127.0.0.1:8000` the
  same way `/api/recipes` is proxied.
- `whatscooking.ai/backend/.env.example`: add an empty `GOOGLE_MAPS_API_KEY=`.
  Do not create or modify a real `.env`. Do not print any key.
- `whatscooking.ai/src/ui/FoodViews.jsx`: show retrieved walking time in the
  Sourced section and on the venue detail.
- `whatscooking.ai/src/domain/state.js`: stop creating a plan from a log.
- Tests next to the behavior you change.

Do not edit `engine.js` unless a test proves the existing time rule cannot
read an integer `timing.outbound`. It already treats null outbound as missing
and a finite outbound as minutes.

## Task 1 — walking duration

### Key and network

Read `GOOGLE_MAPS_API_KEY` on the server with the same dotenv loading already
used by `backend/main.py` (`backend/.env`, then `whatscooking.ai/.env`).

The key stays on the server. Do not prefix it with `VITE_`. Do not send it to
the browser, put it in a response, log it, or commit it. The frontend sends
only venue ids.

If the variable is missing, the endpoint returns a clear unavailable status
and no durations. The UI keeps "Travel time unknown." Do not invent a number
and do not fail server startup.

### Which Google API

Use the Routes API first:

`POST https://routes.googleapis.com/directions/v2:computeRoutes`

Headers:

- `Content-Type: application/json`
- `X-Goog-Api-Key: <GOOGLE_MAPS_API_KEY>`
- `X-Goog-FieldMask: routes.duration,routes.distanceMeters`

Body: `travelMode` is `WALK`. Origin and destination are
`location.latLng` latitude/longitude. Do not set a driving traffic preference.
Do not request steps, polylines, or place details.

If Google rejects that call because this key is enabled for the legacy
Distance Matrix API instead, one fallback is allowed:

`https://maps.googleapis.com/maps/api/distancematrix/json`

Use `mode=walking`, one origin, and one destination. Accept an element only
when its status is `OK`. Use `duration.value` as seconds and `distance.value`
as route meters.

Do not call Places, Geocoding, or the Maps JavaScript API. Do not use Google
place opening hours.

### Coordinates

Origin is the existing HUB pin in `whatscooking.ai/src/data/uwDining.js`:

latitude `47.655318`, longitude `-122.30519045767`.

Destinations are the `lat` and `lng` already stored on `uwDining` venues.
The client may request only those known venue ids. Reject every other id.
Do not accept a raw address from the browser.

These sourced meals can use a venue pin that already exists:

- Center Table
- Local Point

District Market is not in `uwDining`. Leave its three meals with travel
unknown. Do not geocode "District Market." Add a pin only if you fetch
`https://www.washington.edu/maps/?json=campusmap.get_locations` and find one
feature whose name is exactly District Market. Record that feature's name,
coordinates, source URL, and retrieval date. If the match is ambiguous, add
nothing.

Husky Den, By George, and Cultivate already have pins. You may return walking
facts for them, but their illustrative sample dishes are not sourced meals.
Do not rewrite those dishes.

### How to store the fact

Return, per venue:

- `venueId`
- `durationSeconds` (integer, from Google)
- `walkingMinutes` = `ceil(durationSeconds / 60)`
- `routeMeters` (integer, from Google; this is not the straight-line value)
- `retrievedAt` (ISO time of this response)
- `api` (`google_routes` or `google_distance_matrix`)
- `origin` and `destination` coordinates

A missing, nonnumeric, or negative duration stays null. Do not coerce it to 0.
Zero seconds may become 0 minutes. Round only by the ceiling rule above.

Cache successful results in process memory for 15 minutes. A failed Google
call does not overwrite a cached success with null.

For `evaluate`, set `timing.outbound` to `walkingMinutes` only on a copy of a
sourced eat-out meal when a successful result exists for its venue. Record
provenance on that copy:

- status `retrieved_route`
- the seconds, route meters, retrieved time, and API name
- limitation: this is one retrieved walk from the HUB, not a live closure,
  wait, or campus shuttle

Keep `distanceMeters` unchanged. Keep rendering it as straight-line meters.
Cook meals keep `timing.outbound` at 0. That 0 means no trip to a venue.

Do not write the Google response into a source file during the run. Tests use
a fake transport. A hand-written minute value must not enter `sourcedCatalog`.

### UI

In the Sourced section, when a result exists, show both:

- `N min walking from the HUB, retrieved <time>`
- the existing straight-line meters

When it does not, keep `Travel time unknown` and the straight-line meters.
Do not relabel straight-line meters as walking time.

On the venue detail, add the same walking sentence when a result exists. Keep
the current Google Maps link from `directionsUrl`. That link does not use the
API key.

The section's explanation stays true: these records stay out of the swipe deck
until price and hours are also known. Service remains the user's planning
allowance in context. Do not fetch a service time.

### Tests for travel

Use a fake HTTP transport. No test calls Google and no test needs the real key.
A skipped live test is not a substitute. Assert the full decision, not only
that a function returns.

Cover:

- 90 seconds becomes 2 walking minutes, with route meters preserved separately
  from `distanceMeters`.
- 60 seconds becomes 1 minute. 61 seconds becomes 2 minutes.
- A missing, blank, or negative duration leaves outbound null and does not
  throw past the endpoint.
- An unknown venue id is rejected and does not trigger a Google call.
- A Routes permission failure may try Distance Matrix once. Any other failure
  tries nothing else and leaves travel unknown.
- A sourced UW meal with a walking result is still not feasible because cost
  is null and venue hours are null. Its rejection text still says so.
- A cook sourced recipe is not given a walking request, and its outbound
  stays 0.
- The server omits the key from every response body and from error text.
- A stale cached success survives a later failed refresh.

## Task 2 — logging must not create a plan

In `whatscooking.ai/src/domain/state.js`, `log` and `editLog` currently insert
`log:${id}` into `mealPlans` when the confirmation clock differs from an
existing plan start. That block then makes other meals look like calendar
conflicts, and it can become the latest plan shown on Today.

Change the behavior:

- A log writes only the consumption record.
- It does not add, replace, or remove a meal plan.
- `removeLog` removes only the log. It does not delete the user's selected plan.
- Undo restores the previous log state and does not invent a plan.

Update the existing log tests to this rule. Do not weaken a test to keep the
old extra block. Add a regression that logs a meal at a different clock time
from the planned start, then evaluates another meal: the new log must not be
the reason that meal overlaps a plan.

## Still unknown — leave null

Do not fill any of these from memory, from the illustrative catalog, from
Husky Deal prices, or from Google:

- Per-portion price for the three USDA recipes and five UW rows.
- Venue `opens`, `closes`, and current menu validity on a sourced UW meal.
  The hours already shown for illustrative venues are a separate reviewed
  location record. Do not copy them onto sourced dish rows in this task.
- Unpublished UW protein, total fat, and fiber.
- Allergens. Positive labels already retained elsewhere do not prove absence.
- Finished serving weight.
- Pantry quantities the user has not entered.
- Measured prep time. Authored prep and cook minutes may stay labeled as
  planning estimates.

Do not make a sourced meal feasible by adding a placeholder price, a zero
price, or guessed hours. Doing so fails this task even if the tests you
added would pass.

## Verification

From `whatscooking.ai/`:

- `npm test`
- `npm run lint`
- `npm run build`

If the backend is already running, restart is the user's choice. Do not kill
an unrelated process. A new travel route needs the running API process to load
it; say so if you could not reload it.

Browser check at the existing Vite origin, preferably `http://127.0.0.1:5173/`:

- Cook still opens the local deck and does not request `/api/recipes`.
- Sourced still lists all eight records as not feasible.
- Center Table and Local Point show a walking duration only when the travel
  endpoint returned one. District Market still says travel unknown unless an
  exact campus-map pin was added.
- Straight-line meters are still labeled straight-line.
- Logging half a portion does not add a second block on the day timeline.
  The selected plan remains, and the intake total includes only the log.
- Reload keeps that result.

If `GOOGLE_MAPS_API_KEY` is absent or Google denies it, verify the failure
path instead: travel stays unknown, the key is not visible in the page or
logs, and the rest of the checks still pass.

## Report and stop

The task is complete only when the automated checks pass and the browser
checks match the rules above. If a check could not be run, say exactly which
one and why. Do not describe that gap as done.

Report the files changed, the API that actually answered, the walking minutes
retrieved, and any venue left unknown. Quote the rejection reasons still shown
for the eight sourced records. Do not commit or push.
