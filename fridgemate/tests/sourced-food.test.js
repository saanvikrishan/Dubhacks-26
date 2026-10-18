import test from "node:test";
import assert from "node:assert/strict";
import rawUsda from "../src/data/sourced/usda-records.json" with { type: "json" };
import rawUw from "../src/data/sourced/uw-hfs-rows.json" with { type: "json" };
import {
  normalizeUsdaFood,
  ingredientNutrition,
} from "../src/adapters/usdaFood.js";
import { normalizeUwHfsRow } from "../src/adapters/uwHfsFood.js";
import { buildSourcedRecipe } from "../src/domain/sourcedRecipes.js";
import {
  buildSourcedCatalog,
  ingredientMatches,
  sourcedIngredients,
  sourcedRecipeDefinitions,
  sourcedUwItems,
} from "../src/data/sourcedCatalog.js";
import { portionNutrition } from "../src/domain/nutrition.js";
import { createDemoState } from "../src/domain/state.js";
import { evaluate } from "../src/domain/engine.js";
import { previewFoodIntent } from "../src/domain/intent.js";
import { createUsdaClient } from "../server/usda-client.js";
import { catalog } from "../src/data/catalog.js";
const tofuRaw = () =>
  structuredClone(rawUsda.records.find((r) => r.fdcId === 172475));
const tofuMatch = ingredientMatches.find((m) => m.fdcId === 172475);
const row = (raw, id) => raw.foodNutrients.find((n) => n.nutrient.id === id);
const quote = {
  value: 2,
  source: "Explicit test-only user budget quote; not a published retail price.",
  checkedAt: "2026-10-17",
};

test("USDA: four explicitly matched actual detail records retain six nutrients and provenance", () => {
  assert.equal(Object.keys(sourcedIngredients).length, 4);
  const tofu = sourcedIngredients.tofu;
  assert.equal(tofu.fdcId, 172475);
  assert.equal(tofu.dataType, "SR Legacy");
  assert.equal(tofu.values.energy_kcal, 144);
  assert.equal(tofu.values.protein_g, 17.27);
  assert.equal(
    tofu.provenance.fields.sodium_mg.originalRows[0].nutrient.unitName,
    "mg",
  );
  assert.match(tofu.provenance.sourceUrl, /172475/);
  assert.equal(tofu.provenance.checkedAt, "2026-10-17");
  assert.throws(
    () => normalizeUsdaFood(tofuRaw(), { ...tofuMatch, fdcId: 172476 }),
    /exactly match/,
  );
  assert.throws(
    () =>
      normalizeUsdaFood(tofuRaw(), {
        ...tofuMatch,
        expectedDescription: "Tofu, fried",
      }),
    /exactly match/,
  );
  assert.throws(
    () =>
      normalizeUsdaFood(
        { ...tofuRaw(), dataType: "Branded" },
        { ...tofuMatch, expectedDataType: "Branded" },
      ),
    /Unsupported/,
  );
});

test("USDA: g/mg/micrograms and kJ are converted by explicit source units", () => {
  const raw = tofuRaw();
  row(raw, 1003).amount = 17270;
  row(raw, 1003).nutrient.unitName = "mg";
  row(raw, 1093).amount = 0.014;
  row(raw, 1093).nutrient.unitName = "g";
  row(raw, 1008).amount = 602.496;
  row(raw, 1008).nutrient.unitName = "kJ";
  const normalized = normalizeUsdaFood(raw, tofuMatch);
  assert.equal(normalized.values.protein_g, 17.27);
  assert.ok(Math.abs(normalized.values.sodium_mg - 14) < 1e-10);
  assert.ok(Math.abs(normalized.values.energy_kcal - 144) < 1e-10);
  row(raw, 1093).amount = 14000;
  row(raw, 1093).nutrient.unitName = "µg";
  assert.ok(
    Math.abs(normalizeUsdaFood(raw, tofuMatch).values.sodium_mg - 14) < 1e-10,
  );
});

test("USDA: missing, invalid, conflicting and unsupported values stay null; zero stays known", () => {
  const raw = tofuRaw();
  raw.foodNutrients = raw.foodNutrients.filter((r) => r.nutrient.id !== 1003);
  row(raw, 1004).amount = -1;
  row(raw, 1079).nutrient.unitName = "IU";
  row(raw, 1093).amount = 0;
  const result = normalizeUsdaFood(raw, tofuMatch);
  assert.equal(result.values.protein_g, null);
  assert.equal(result.values.fat_g, null);
  assert.equal(result.values.fiber_g, null);
  assert.equal(result.values.sodium_mg, 0);
  const duplicate = tofuRaw();
  duplicate.foodNutrients.push({
    ...structuredClone(row(duplicate, 1008)),
    amount: 999,
  });
  assert.equal(
    normalizeUsdaFood(duplicate, tofuMatch).values.energy_kcal,
    null,
  );
  row(raw, 1008).amount = "144";
  assert.equal(normalizeUsdaFood(raw, tofuMatch).values.energy_kcal, null);
});

test("USDA: quantities distinguish raw/cooked forms and scale per-100g correctly", () => {
  const input = {
    grams: 150,
    preparation: "raw",
    weightBasis: "raw_edible_weight",
  };
  const result = ingredientNutrition(sourcedIngredients.tofu, input);
  assert.equal(result.energy_kcal, 216);
  assert.equal(result.protein_g, 25.905);
  assert.throws(
    () => ingredientNutrition(sourcedIngredients["cooked brown rice"], input),
    /Raw\/cooked/,
  );
  assert.throws(
    () =>
      ingredientNutrition(sourcedIngredients.tofu, { ...input, grams: "150" }),
    /weight/,
  );
  assert.throws(
    () => ingredientNutrition(sourcedIngredients.tofu, { ...input, grams: 0 }),
    /weight/,
  );
});

test("recipe: per-recipe totals, yield, per-portion pantry grams and half portions stay aligned", () => {
  const recipe = buildSourcedRecipe(
    sourcedRecipeDefinitions[0],
    sourcedIngredients,
    { costQuote: quote },
  );
  assert.equal(recipe.nutrition.basis, "per_recipe");
  assert.equal(recipe.nutrition.yieldServings, 2);
  assert.equal(recipe.nutrition.values.energy_kcal, 831);
  assert.equal(portionNutrition(recipe).energy_kcal, 415.5);
  assert.equal(portionNutrition(recipe, 0.5).energy_kcal, 207.75);
  assert.equal(recipe.ingredients.find((i) => i.name === "tofu").grams, 150);
  assert.equal(recipe.portionGrams, null);
  assert.equal(recipe.cost, 2);
  assert.equal(recipe.provenance.fields.cost.status, "provided_quote");
  assert.notEqual(recipe.nutrition.kind, "published");
  assert.throws(
    () =>
      buildSourcedRecipe(
        { ...sourcedRecipeDefinitions[0], yieldServings: 0 },
        sourcedIngredients,
      ),
    /yield/,
  );
});

test("recipe: a missing ingredient nutrient leaves the whole recipe nutrient unknown", () => {
  const ingredients = structuredClone(sourcedIngredients);
  ingredients.tofu.values.protein_g = null;
  const result = buildSourcedRecipe(sourcedRecipeDefinitions[0], ingredients);
  assert.equal(result.nutrition.values.protein_g, null);
  assert.equal(result.nutrition.coverage.protein_g.known, 2);
  assert.ok(result.nutrition.coverage.protein_g.knownSubtotal > 0);
  assert.equal(portionNutrition(result).protein_g, null);
});

test("UW: five exact actual menu rows preserve published serving and approximate values", () => {
  assert.equal(sourcedUwItems.length, 5);
  const pasta = sourcedUwItems.find((m) => m.name === "Herb Pasta");
  assert.equal(pasta.venue.name, "Center Table");
  assert.equal(pasta.venue.station, "Noodle");
  assert.equal(pasta.portionLabel, "12 fl oz");
  assert.equal(pasta.nutrition.values.energy_kcal, 330);
  assert.equal(pasta.nutrition.values.carbohydrate_g, 52);
  assert.equal(pasta.nutrition.values.sodium_mg, 480);
  assert.equal(pasta.nutrition.values.protein_g, null);
  assert.equal(pasta.nutrition.values.fat_g, null);
  assert.equal(pasta.published.saturatedFat_g, 1);
  assert.equal(pasta.nutrition.values.fiber_g, null);
  assert.equal(pasta.cost, null);
  assert.equal(pasta.portionGrams, null);
  assert.equal(pasta.availability.status, "unverified");
  assert.equal(pasta.availability.validFrom, null);
  assert.match(pasta.provenance.responseSha256, /^[a-f0-9]{64}$/);
  assert.match(pasta.provenance.sourceUrl, /location\/362/);
});

test("UW: positive allergy indicators survive, blank cells never mean verified absence", () => {
  const pizza = sourcedUwItems.find((m) => m.name === "Cheese Pizza"),
    chana = sourcedUwItems.find((m) => m.name === "CHANA MASALA");
  assert.deepEqual(pizza.dietary.knownPresent, ["milk", "wheat"]);
  assert.equal(pizza.allergens, null);
  assert.deepEqual(chana.dietary.knownPresent, []);
  assert.equal(chana.allergens, null);
  const state = createDemoState();
  state.profile.exclusions = ["milk"];
  assert.match(
    evaluate(chana, state).reasons.join(),
    /Allergen information is unknown/,
  );
  const page = rawUw.pages[0];
  assert.throws(
    () =>
      normalizeUwHfsRow(page, page.rows[0], {
        id: "a",
        location: "Center Table",
        itemName: "Similar pasta",
      }),
    /exact/,
  );
  assert.throws(
    () =>
      normalizeUwHfsRow({ ...page, headers: ["new-format"] }, page.rows[0], {
        id: "a",
        location: "Center Table",
        itemName: "Herb Pasta",
      }),
    /aligned/,
  );
});

test("sourced catalog: engine evaluates both modes honestly without inventing missing hard facts", () => {
  const state = createDemoState(),
    sourced = buildSourcedCatalog(),
    before = structuredClone(catalog);
  assert.equal(sourced.length, 8);
  assert.ok(sourced.every((m) => m.cost === null));
  const result = previewFoodIntent({ action: "recommend" }, state, sourced);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.evaluations.length, 8);
  assert.ok(
    result.evaluations.every((r) =>
      r.reasons.some((reason) => reason.includes("Cost is unknown")),
    ),
  );
  const dining = result.evaluations.find((r) => r.meal.mode === "eatOut");
  assert.ok(dining.missingData.includes("venue_hours"));
  assert.ok(dining.missingData.includes("protein_g"));
  assert.ok(dining.sourceLimitations.length);
  const quoted = buildSourcedCatalog({
    cookCostQuotes: { "sourced-tofu-rice-bowl": quote },
  });
  const preview = previewFoodIntent(
    { action: "recommend", mode: "cook" },
    state,
    quoted,
  );
  assert.equal(preview.candidates[0].meal.id, "sourced-tofu-rice-bowl");
  assert.equal(preview.candidates[0].nutrition.energy_kcal, 415.5);
  assert.ok(
    !preview.candidates[0].assumptions.some((a) =>
      a.includes("All food, costs, hours"),
    ),
  );
  assert.deepEqual(catalog, before);
});

function response(value, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(value),
  };
}
test("USDA client: caches/coalesces details, returns detached data and requires explicit selection", async () => {
  let calls = 0,
    time = 100;
  const client = createUsdaClient({
    apiKey: "test-only-key",
    now: () => time,
    ttlMs: 100,
    fetchImpl: async (url) => {
      calls++;
      return response(
        url.includes("/foods/search")
          ? {
              foods: [
                { fdcId: 2, description: "Wrong form", dataType: "SR Legacy" },
                {
                  fdcId: 172475,
                  description: tofuRaw().description,
                  dataType: "SR Legacy",
                },
              ],
            }
          : tofuRaw(),
      );
    },
  });
  const [a, b] = await Promise.all([
    client.detail(172475),
    client.detail(172475),
  ]);
  assert.equal(calls, 1);
  a.description = "changed";
  assert.notEqual(b.description, "changed");
  assert.notEqual((await client.detail(172475)).description, "changed");
  assert.equal(calls, 1);
  time = 201;
  await client.detail(172475);
  assert.equal(calls, 2);
  const search = await client.search("firm tofu");
  assert.equal(search.selectionRequired, true);
  assert.equal(search.matches.length, 2);
  assert.equal(search.selected, undefined);
});

test("USDA client: missing keys, API failures, bad IDs and redirects never leak keys or fabricate food", async () => {
  assert.throws(() => createUsdaClient({ apiKey: "" }), /missing_api_key/);
  const key = "sensitive-test-key";
  const unavailable = createUsdaClient({
    apiKey: key,
    fetchImpl: async () => response({}, false, 429),
  });
  await assert.rejects(
    () => unavailable.detail(172475),
    (error) => error.code === "rate_limited" && !error.message.includes(key),
  );
  const failed = createUsdaClient({
    apiKey: key,
    fetchImpl: async () => {
      throw new Error(`network ${key}`);
    },
  });
  await assert.rejects(
    () => failed.detail(172475),
    (error) =>
      error.code === "network_or_timeout" &&
      !JSON.stringify(error).includes(key),
  );
  await assert.rejects(() => failed.detail("172475"), /invalid_fdc_id/);
  await assert.rejects(
    () =>
      createUsdaClient({
        apiKey: key,
        fetchImpl: async () => response({ fdcId: 123, foodNutrients: [] }),
      }).detail(172475),
    /invalid_response/,
  );
  await assert.rejects(
    () =>
      createUsdaClient({
        apiKey: key,
        fetchImpl: async (url, options) => {
          assert.equal(options.redirect, "error");
          assert.ok(url.startsWith("https://api.nal.usda.gov/"));
          return {
            ok: true,
            headers: { get: () => null },
            text: async () => "{bad",
          };
        },
      }).detail(172475),
    /invalid_response/,
  );
});
