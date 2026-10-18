import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../src/data/food/ingredient-matches.json' with {type:'json'};
import fixture from './fixtures/ingredient-names.json' with {type:'json'};
import {resolveIngredientName} from '../src/domain/ingredientNames.js';
import {getFoodReference,deriveCookNutrition} from '../src/domain/foodFacts.js';

test('shared name cases resolve the same way as the backend', () => {
  for (const [name, key, assumes] of fixture.cases) {
    const resolved = resolveIngredientName(name);
    assert.equal(resolved.key, key, name);
    assert.equal(Boolean(resolved.assumption), assumes, name);
  }
  assert.equal(resolveIngredientName('rice', {allowDefaults:false}).key, null);
  assert.equal(resolveIngredientName('broth').hint, 'Say chicken broth or vegetable broth.');
});

test('every reviewed food loads in the app with core nutrients', () => {
  const foods = getFoodReference().ingredients;
  assert.equal(Object.keys(foods).length, manifest.matches.length);
  for (const match of manifest.matches) {
    const food = foods[match.key];
    assert.ok(food, match.key);
    for (const nutrient of ['energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'sodium_mg'])
      assert.notEqual(food.values[nutrient], null, `${match.key} ${nutrient}`);
    assert.equal(food.provenance.labelBrandOwner, match.labelSource ? match.brandOwner : null);
  }
});

test('a typical generated recipe gets complete totals with visible assumptions', () => {
  const recipe = [
    {name: 'chicken breast', grams: 150}, {name: 'rice', grams: 75}, {name: 'broccoli', grams: 100},
    {name: 'soy sauce', grams: 15}, {name: 'sesame oil', grams: 5}, {name: 'garlic', grams: 6},
    {name: 'salt', grams: 1}, {name: 'water', grams: 120},
  ];
  const nutrition = deriveCookNutrition(recipe);
  for (const nutrient of ['energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'fiber_g', 'sodium_mg'])
    assert.notEqual(nutrition.values[nutrient], null, nutrient);
  assert.deepEqual(nutrition.assumptions, ['For this recipe, rice means uncooked white rice.']);
  const partial = deriveCookNutrition([...recipe, {name: 'mystery spice', grams: 2}]);
  assert.equal(partial.values.energy_kcal, null);
  assert.deepEqual(partial.coverage.energy_kcal.missingIngredients, ['mystery spice']);
});
