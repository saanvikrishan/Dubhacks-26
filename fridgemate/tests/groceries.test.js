import test from "node:test";
import assert from "node:assert/strict";
import {
  addGroceryNames,
  ingredientMatches,
  pantryFromGroceries,
} from "../src/domain/groceries.js";

test("grocery phrases match catalog ingredients and keep unknown foods", () => {
  assert.equal(ingredientMatches("rice", "cooked brown rice"), true);
  assert.equal(ingredientMatches("egg", "eggs"), true);
  assert.equal(ingredientMatches("tomato", "tomatoes"), true);
  assert.equal(ingredientMatches("to", "tofu"), false);
  assert.equal(ingredientMatches("chicken", "tofu"), false);
  const named = addGroceryNames([], "eggs, rice and chicken");
  assert.ok(named.includes("eggs"));
  assert.ok(named.includes("cooked brown rice"));
  assert.ok(named.includes("chicken"));
  const { pantry, matched, unmatched } = pantryFromGroceries(named);
  assert.ok(pantry.eggs > 0);
  assert.ok(pantry["cooked brown rice"] > 0);
  assert.equal(pantry.tofu, 0);
  assert.deepEqual(matched.sort(), ["cooked brown rice", "eggs"]);
  assert.deepEqual(unmatched, ["chicken"]);
});
