import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalog} from '../src/data/catalog.js';
import {deriveCookNutrition} from '../src/domain/foodFacts.js';
import {normalizeUsdaFood} from '../src/adapters/usdaFood.js';
import {buildUwDiningCatalog} from '../src/domain/uwDining.js';
import {buildSnapshot} from '../src/adapters/agent.js';
import {createDemoState} from '../src/domain/state.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const records = read('../src/data/food/usda-browser.json').records;
const matches = read('../src/data/food/ingredient-matches.json').matches;

test('built-in recipes show exactly what their USDA ingredient records add up to', () => {
  for (const meal of catalog.filter((m) => m.mode === 'cook')) {
    const calculated = deriveCookNutrition(meal.ingredients).values;
    for (const [key, value] of Object.entries(meal.nutrition.values))
      assert.ok(Math.abs(Math.round(calculated[key]) - value) <= 0, `${meal.id} ${key}: ${value} vs USDA ${calculated[key]}`);
  }
});

test('every USDA ingredient record is physically consistent', () => {
  const byId = new Map(records.map((r) => [r.fdcId, r]));
  assert.equal(matches.length, 131);
  for (const match of matches) {
    const v = normalizeUsdaFood(byId.get(match.fdcId), match).values;
    for (const key of ['energy_kcal', 'protein_g', 'carbohydrate_g', 'fat_g']) assert.ok(v[key] != null && v[key] >= 0, `${match.key} ${key}`);
    assert.ok(v.protein_g + v.carbohydrate_g + v.fat_g <= 101, `${match.key}: more than 100 g per 100 g`);
    if (v.sugar_g != null) assert.ok(v.sugar_g <= v.carbohydrate_g + 0.5, `${match.key}: sugar > carbs`);
    if (v.fiber_g != null) assert.ok(v.fiber_g <= v.carbohydrate_g + 0.5, `${match.key}: fiber > carbs`);
    if (v.saturated_fat_g != null) assert.ok(v.saturated_fat_g <= v.fat_g + 0.5, `${match.key}: saturated > total fat`);
    // Calories agree with Atwater factors (protein 4, carbs 4, fat 9 kcal/g; fiber about 2 kcal/g).
    const fiber = Math.min(v.fiber_g ?? 0, v.carbohydrate_g);
    const atwater = 4 * v.protein_g + 4 * (v.carbohydrate_g - fiber) + 2 * fiber + 9 * v.fat_g;
    assert.ok(Math.abs(v.energy_kcal - atwater) <= Math.max(20, 0.2 * v.energy_kcal), `${match.key}: ${v.energy_kcal} kcal vs ${atwater}`);
  }
});

test('UW dining items keep the published saturated fat, and "less than 1g" is not lost', () => {
  const items = buildUwDiningCatalog().filter((m) => m.dining?.recordType === 'nutrition');
  assert.ok(items.length > 800);
  assert.ok(items.every((m) => Number.isFinite(m.nutrition.values.saturated_fat_g)));
  assert.equal(items.every((m) => m.nutrition.values.fat_g === null && m.nutrition.values.protein_g === null), true);   // UW doesn't publish these
  const tiny = items.find((m) => m.provenance.fields.nutrition.carbohydrate_g.status === 'uw_published_less_than_1');
  assert.equal(tiny.nutrition.values.carbohydrate_g, 0.75);
});

test('the assistant never sees the made-up sample venues', () => {
  const names = buildSnapshot(createDemoState()).meals.map((m) => m.id);
  const demo = catalog.filter((m) => m.nutrition.kind === 'illustrative_demo').map((m) => m.id);
  assert.ok(demo.length > 0);
  assert.deepEqual(names.filter((id) => demo.includes(id)), []);
});
