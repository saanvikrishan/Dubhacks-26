# Gemini intent and sourced food-data handoff

Implemented on `kevin/gemini-food-data-integration`, based on `origin/main` at
`6d96e30`. This is independently usable domain/data work. It is deliberately
not wired into the live UI or Python backend. No dependencies were added.

## Repository safety

- Original checkout: `/Users/jiaqian.zhang/Downloads/Dubhacks2026/Dubhacks-26`.
- Isolated checkout: `outputs/Daywell-gemini-food-data` in this Codex workspace.
- Original checkout's branch, uncommitted README, untracked files, `.env` and
  running app were left alone. Private environment values were not read.
- Kevin's `90419ed` fixes were cherry-picked as `574e1ff`. One engine conflict
  was resolved by retaining main's Gemini wrapper and adding Kevin's combined
  ingredient checks inside its existing non-Gemini branch. All 17 Kevin tests pass.
- Apart from those preserved fixes (`calendar.js`, `engine.js`, `nutrition.js`,
  `tests/kevin-logic.test.js`), implementation files are new. `App.jsx`, `state.js`,
  storage, shared UI/config/contracts, package files and Python backend are unchanged.
- No main merge, force push, calendar write, meal logging, pantry mutation,
  purchasing or background job is performed by these modules.

## Phase 1: structured intent preview

`src/domain/intent.js` exports `validateFoodIntent` and `previewFoodIntent`.
`src/adapters/geminiIntent.js` exports an injected async transport adapter and an
optional same-origin HTTP transport. The backend-facing JSON schema is
[`food-intent.schema.json`](food-intent.schema.json); supplemental TypeScript
interfaces are in `src/domain/integration-contracts.d.ts`.

Accepted response (direct JSON object, not an envelope or Markdown):

```json
{
  "action": "recommend",
  "mode": "compare",
  "sort": "protein",
  "contextPatch": { "available": 30 },
  "profilePatch": { "budget": 10 }
}
```

- Required action: `recommend`. Modes: `cook`, `eatOut`, `compare` (default).
  Sorts: `catalog` (default), `time`, `cost`, `protein`.
- Available minutes: integer 1–1440. Budget: finite number 0–1000, per meal in
  the existing app's dollar units. Numeric strings are rejected.
- Only those two patch fields are allowed. Restrictions, allergens, pantry,
  equipment, calendar, logs, external actions and unknown fields are rejected.
- Preview clones state and catalog, validates existing constraints, then calls
  the existing deterministic `recommend`. Weighted scoring remains disabled.
- Output includes normalized intent, detached preview state, numeric changes,
  candidates, all evaluated rejection reasons, nutrition, missing facts and
  field-source limitations. Preview state must never be persisted wholesale.
- Transport has an 8-second default deadline. Failure returns a sanitized
  unavailable result unless the caller supplied an explicit validated fallback.
  A fallback is labeled; it never silently changes restrictions.
- Generated food records marked `gemini_suggestion` or `suggestion: true` are
  rejected before reaching the engine. Gemini may supply intent, not food facts.
- The optional HTTP helper sends only `{ "text": "..." }`, up to 4,000
  characters, to `/api/interpret-food`. It does not send app state or calendars.

Run from `fridgemate/` with a current Node runtime (tested with Node 24):

```sh
node examples/food-intent-preview.js
node --test tests/intent.test.js tests/sourced-food.test.js tests/kevin-logic.test.js
```

The example uses a deterministic mock transport and the separate sourced
catalog. It honestly returns zero feasible candidates with current missing
prices/travel/hours and prints the reasons; no live Gemini call or saved action
occurs. Existing illustrative catalog mode/sort compatibility is tested too.

## Phase 2: sources and actual coverage

Official references:
[USDA API guide](https://fdc.nal.usda.gov/api-guide/) and
[UW HFS nutrition](https://hfs.washington.edu/nutrition/).
Source snapshots were retrieved directly on **2026-10-17** (local date).

### USDA ingredients and recipes

`src/data/sourced/usda-records.json` retains the selected original full-detail
nutrient rows, source identifiers, original units, type and check date:

| FDC ID | Exact matched form | Type |
| --- | --- | --- |
| 169704 | Brown long-grain rice, cooked | SR Legacy |
| 172475 | Firm tofu, raw, calcium sulfate | SR Legacy |
| 168409 | Cucumber with peel, raw | SR Legacy |
| 173757 | Chickpeas, cooked, boiled, without salt | SR Legacy |

All four include energy, protein, carbohydrate, total fat, fiber and sodium.
`src/adapters/usdaFood.js` requires explicit ID/description/type/form matching,
normalizes per-100-g values and scales edible gram quantities. It distinguishes
raw from cooked weights. Missing, invalid, conflicting or unsupported values stay
null; known zeros stay zero. Search results are never automatically selected.

`src/domain/sourcedRecipes.js` derives these authored recipes (each yields two):

| Recipe | Entire recipe quantities | Per portion kcal / protein |
| --- | --- | --- |
| Tofu & brown rice bowl | 300 g tofu, 300 g cooked rice, 200 g cucumber | 415.5 / 30.665 g |
| Chickpea & cucumber salad | 300 g cooked chickpeas, 200 g cucumber | 261 / 13.94 g |
| Chickpea & brown rice bowl | 300 g cooked chickpeas, 300 g cooked rice, 100 g cucumber | 438 / 17.725 g |

Cooked ingredients are already prepared; assembly timings are authored estimates.
Unlisted oils, salt and toppings are excluded. These are ingredient-based estimates,
not independently measured finished meals. Missing ingredient nutrients make the
entire corresponding recipe nutrient null; known subtotals are separately labeled.
Pantry requirements divide by recipe yield. Finished portion gram weight, allergen
absence and prices remain unknown. Optional per-portion `cookCostQuotes` must
include value, source and check date; the tests use a synthetic quote explicitly.

### UW HFS published menu rows

`src/data/sourced/uw-hfs-rows.json` retains exact selected table rows, headers,
source URLs, check date and response SHA-256. `src/adapters/uwHfsFood.js` checks
reviewed names and table alignment. These are nutrition listings, not live menus:

| Location / station | Exact item | Published serving | kcal / carbohydrate / sodium |
| --- | --- | --- | --- |
| [Center Table / Noodle](https://hfs.washington.edu/nutrition/location/362/) | Herb Pasta | 12 fl oz | 330 / 52 g / 480 mg |
| [Local Point / Pizza](https://hfs.washington.edu/nutrition/location/385/) | Cheese Pizza | Slice | 380 / 45 g / 770 mg |
| [District Market](https://hfs.washington.edu/nutrition/location/240/) | CHANA MASALA | Box | 440 / 76 g / 610 mg |
| District Market | MEDITERRANEAN BOWL | Bowl | 350 / 58 g / 1250 mg |
| District Market | PEANUT BUTTER & JAM SANDWICH | Sandwich | 660 / 76 g / 550 mg |

UW values are published approximations. Protein, total fat and fiber were not
published in these rows and remain null. Saturated fat is retained separately,
never used as total fat. Positive allergen indicators and vegan/vegetarian labels
are retained; blanks do not establish allergen absence or cross-contact safety.
`allergens` therefore remains null, so strict allergy exclusions fail safely.
Prices, exact gram portions, travel, opening hours, current stock and menu validity
are unknown. Existing UW location references are reused without claiming dish
availability. No USDA substitution is used for an exact UW dish.

`src/data/sourcedCatalog.js` exposes `buildSourcedCatalog()` separately from the
working illustrative demo catalog. Both modes are evaluated through the existing
engine in tests. Unknown hard facts cause rejection; no restrictions are relaxed
to produce a shortlist. A Cook record with an explicitly provided test quote and
confirmed matching pantry stock demonstrates successful sourced feasibility.

### Live import setup

`server/usda-client.js` is server-only. Configure `USDA_FDC_API_KEY` in the local
backend environment; never prefix it with `VITE_` or commit it. No shared `.env`
file was edited. The explicit CLI, run from `fridgemate/`, supports:

```sh
node --env-file=backend/.env server/usda-import.js search "chickpeas cooked"
node --env-file=backend/.env server/usda-import.js detail 173757
```

Review matches manually before selecting an ID. The CLI prints the public food
response, never the key, and does not modify a catalog. To curate a returned detail,
add its actual retrieval date and key-free retrieval URL, then explicitly record
the matching description/type/preparation and rationale before normalization.

The client uses fixed official URLs, no redirects, request deadlines, sanitized
errors, a 24-hour bounded memory cache and coalescing of concurrent duplicate
requests. No retries, background traffic or backend route is activated. Curated
snapshots work offline. Actual USDA requests and a client+normalizer detail roundtrip
for FDC 172475 were verified with USDA's documented public demo credential; this
does not claim that a private team API key or live Gemini connection was tested.

## Actual validation results

- New focused tests: **18/18 pass** (7 intent, 11 food-data/client).
- New tests plus Kevin regression suite: **35/35 pass**.
- Full `npm test`: **69/70 pass**. The sole failure is pre-existing:
  `storage roundtrip and damaged data preservation` in `tests/core.test.js:346`.
  It reads the newly async storage adapter synchronously. Baseline before these
  modules was **51/52 pass**, with this same failure. Storage and its test were
  left for their owner.
- `npm run build`: **passes**. These modules are intentionally not imported into
  the shared UI, so the build verifies preservation of the existing app.
- Focused ESLint on every new JavaScript file: **passes**.
- Full `npm run lint`: **7 pre-existing errors**, unchanged: four in `src/App.jsx`
  (unused bindings and missing error cause), three in `src/adapters/storage.js`
  (unused bindings and an empty catch). Neither file was changed.
- Mock preview example executed successfully; no credentials needed.

## Exact owner handoff and next small task

**Saurav:** expose `POST /interpret-food` accepting `{text}` and returning the
schema above directly. Keep keys and Gemini calls in the backend. Validate against
the schema server-side as well; JS still validates on receipt. Add the corresponding
same-origin `/api/interpret-food` proxy with the frontend/config owner. Existing
`/recipes` is not this contract and was not rewritten.

The inspected main backend also has an existing startup import problem:
`from datetime import dateackboardClient`, while it references `date`, `Path` and
`BackboardClient` without their imports. This was observed in source, not executed
with private credentials. Saurav should repair those imports before live endpoint
verification. Also coordinate the existing async-storage test/lint issues with
their owners.

**Frontend:** after the endpoint exists, inject `createIntentHttpTransport()` into
`createGeminiIntentAdapter()` and call `.preview({text, state, catalog})`. Present
candidate nutrition, rejection reasons and unknown facts. Confirm selections through
existing action APIs, revalidating against current state; do not persist the preview
state or automatically log consumption. Keep the sourced catalog opt-in until
missing feasibility data are provided and reviewed.

**Important existing limitation:** main's legacy Gemini recipe path bypasses pantry/
equipment checks for `gemini_suggestion` records and has an early action-validation
return. It was retained to protect the current UI/backend flow. This new bridge
rejects those generated food facts; its guarantees do not cover the old `/recipes`
path until its owners adopt this validated intent flow.

**Kevin's next task:** obtain an explicit sourced or user-confirmed per-portion price
for one recipe and validate a real confirmed pantry example. Coordinate one
end-to-end preview through Saurav's endpoint and frontend before expanding coverage.
Do not infer current UW availability from nutrition pages. Further sources, ranking,
off-campus discovery and integrations are deferred. No next phase was started.
