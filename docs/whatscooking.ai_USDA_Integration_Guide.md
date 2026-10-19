# whatscooking.ai — USDA FoodData Central integration guide (for Codex)

**Goal:** Make ingredient nutrition for the existing **Cook** flow accurate, traceable, and robust. USDA is **not** a recipe provider, retail price source, UW dining menu, or complete allergen database.

## Responsibilities / architecture

- **Cook recipes:** whatscooking.ai's curated, structured recipes (ingredients, quantities, units, raw/cooked state, servings, time).
- **Nutrition:** USDA FoodData Central (FDC) per-ingredient nutrient records; total via deterministic portion scaling.
- **Cook prices:** Kroger Products API at a specified `filter.locationId`; keep package checkout cost distinct from amount-consumed cost. Unknown prices stay unknown.
- **Campus/Order:** UW HFS published menus and nutrition; do **not** substitute generic USDA values as official UW values.
- **Travel:** Google Routes API walking times/distance; USDA supplies no locations or travel times.
- **Decision engine:** Existing deterministic validators/ranking enforce constraints. Gemini may explain or parse intent but must not create unverified nutrition or bypass constraints.

## Use these FDC data types

- **Foundation**: preferred for well-matched basic ingredients, when available (note: not all nutrients are present).
- **SR Legacy**: fallback for generic ingredients; last released in 2018 (historical data).
- **Survey (FNDDS)**: useful for certain prepared foods and provided portion weights, but **not** a substitute for the actual whatscooking.ai recipe.
- **Branded**: only for an exact packaged product/UPC. Manufacturer-supplied labels and `ingredients` are not universal allergen-clearance evidence.

Never accept the first fuzzy search hit blindly. Match ingredient name, preparation (**raw vs cooked**), edible part, and product type. Curate a short `ingredient -> fdcId` mapping, and preserve overrides/review status.

## FDC endpoints and auth

Base: `https://api.nal.usda.gov/fdc/v1`

| Endpoint | Purpose |
|---|---|
| `POST /foods/search` | Search candidates; JSON `{"query":"firm tofu", "dataType":["Foundation","SR Legacy"], "pageSize":10}` |
| `GET /food/{fdcId}` | Full nutrient details for a chosen record |
| `POST /foods` | Batch fetch full details for up to **20** IDs per request: `{"fdcIds":[...],"format":"full"}` |
| `/foods/list` | Catalog browsing; not needed for normal recipe calculation |

Pass a private `USDA_API_KEY` in the `api_key` query parameter **from server-side code only**; do not commit it. `DEMO_KEY` is only for exploration: **30 requests/hour and 50/day per IP**. Normal registered-key default: **1,000 requests/hour per IP**; HTTP `429` if exceeded, potentially a temporary one-hour block. Read `X-RateLimit-Remaining`. Cache detail records by `fdcId`; do not search on every render, swipe, or keystroke.

## Correct nutrient parsing (critical)

USDA response shapes differ:

- **Search results:** `foodNutrients[]` can contain `{ nutrientId, nutrientName, unitName, value }`.
- **Full food detail:** `foodNutrients[]` can contain `{ nutrient: { id, name, unitName }, amount }`.
- For full records, identify by **`foodNutrient.nutrient.id`**, not the food-nutrient row's own `id`.
- **Nutrient IDs** (not nutrient *numbers* used in some API filters): protein `1003` g; total fat `1004` g; carbohydrate `1005` g; energy `1008` kcal for many non-Foundation records; fiber `1079` g; sodium `1093` mg.
- **Foundation energy:** check `2047` (Atwater general factor) and `2048` (Atwater specific factor) in kcal. Do not treat absence of `1008` as zero calories. Do not sum multiple energy records. Define and document a deterministic priority within the same data type; avoid mixed energy schemes across a recipe when practicable.
- Validate `unitName`, especially **kcal vs kJ**, and **mg vs g**. Missing data is `null`, **never 0** unless explicitly reported as 0. Do not use a `nutrients` ID filter until verified against official spec; some filters take **nutrient numbers**, not nutrient IDs (e.g., number `203` vs ID `1003`).

## Quantity and portion calculations

FDC nutrient values for generic foods are commonly expressed per **100 g**. Confirm the interpretation from the record's data type/fields; some branded `labelNutrients` values are per labeled serving and must not be treated as per-100-g values.

`ingredient_nutrient = nutrient_per_100g * ingredient_edible_grams / 100`

`recipe_total = sum(ingredient_nutrient)`; `per_serving = recipe_total / servings`; `logged_amount = per_serving * servings_consumed`.

- Normalize measured quantities to **grams** using trusted, ingredient-specific weights/USDA `foodPortions[].gramWeight`, when applicable. **Do not** assume 1 cup = 240 g for every food.
- Track raw/cooked state and avoid mixing dry rice weights with cooked-rice nutrient records.
- Ensure oil, sauces, and other calorie-containing ingredients are counted if the recipe includes them.
- If ingredient or quantity cannot be mapped, expose **incomplete/estimated**, not falsely precise complete totals.

## Minimal normalized contract (adapt to existing models)

```json
{
  "ingredient_key": "firm_tofu",
  "source": "USDA_FDC",
  "fdc_id": null,
  "usda_data_type": "Foundation",
  "source_description": null,
  "matched_preparation": "raw",
  "match_status": "needs_review",
  "per_100g": {"kcal": null, "protein_g": null, "fat_g": null, "carbs_g": null},
  "quantity_g": null,
  "retrieved_at": null
}
```

`null` means unknown/unpopulated (not a confirmed zero). Keep original units, source, FDC ID, publication date when available, and a note about unmatched nutrients/ingredients.

## Known whatscooking.ai failure modes to investigate

1. **Missing/wrong calories:** parser reads only `1008` and misses Foundation `2047`/`2048`; mixes nutrient IDs and numbers; reads `value` when actual field is `amount`, or vice versa.
2. **Nonsense macros:** incorrect raw/cooked match; treating per 100 g as per serving; wrong cup-to-grams conversion; branded `labelNutrients` misinterpreted.
3. **Empty/bad candidates:** fuzzy search returns unrelated branded products; no manual review/pinned `fdcId`; app tries to query USDA for the name of a whole recipe instead of ingredients.
4. **429/empty network data:** using `DEMO_KEY`, repeated live lookups, no caching/timeouts/retry policy; never silently substitute demo nutrition.
5. **All meals 'infeasible':** USDA has **no price, store hours, campus walking time, or reliable universal allergen clearance**. Keep these separate. Unknown price should not imply over-budget when no budget is specified. Unknown allergens must not be treated as allergy-safe.
6. **UI changes unexpectedly:** existing Cook deck, logging, swap/replace, and persistence should remain intact; USDA enrichment should only update validated nutrition fields through existing contracts.

## Implementation order and STOP boundary

1. **Inspect current files** for FDC client, nutrient parser, recipe ingredients, and tests. Report the concrete bug(s) and affected files before editing.
2. **Add/fix a small FDC adapter**: search candidates, choose/pin verified `fdcId`, fetch detail/batch, normalize nutrients and units, cache, handle 429/other errors.
3. **Enrich existing curated Cook recipes**, not USDA search-result menus. Make recipe nutrition deterministic; keep `unknown` separate from `0`; attach provenance + match/estimate status.
4. **Add tests** for search/detail response differences; Foundation `2047`/`2048`; correct protein `1003`; 100 g -> 150 g scaling; half-serving logging; mg/g; raw vs cooked; unmatched ingredient; 429; no false allergen or price certification.
5. **Run existing tests/lint/build**, report exact results and any remaining blockers.

**STOP AFTER STEP 5.** No frontend/UI/UX changes, Gemini integration, backend rewrite, off-campus restaurant work, weighted ranking, unrelated teammates' files, or auto-merge to `main`. Do not overwrite working Cook/Order flows. If changes would cross ownership boundaries, report a suggested patch instead.

## Official references

- API guide: https://fdc.nal.usda.gov/api-guide/
- API JSON schema: https://api.nal.usda.gov/fdc/v1/json-spec?api_key=DEMO_KEY
- Data types: https://fdc.nal.usda.gov/data-documentation/
- Foundation Foods doc (energy IDs 2047/2048): https://fdc.nal.usda.gov/Foundation_Foods_Documentation/
- Portion FAQ: https://fdc.nal.usda.gov/faq/
