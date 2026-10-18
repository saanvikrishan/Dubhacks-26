import { nutrientInfo } from "./nutrition.js";
import { ingredientNutrition } from "../adapters/usdaFood.js";

/** Authored recipe quantities + matched USDA ingredients, not AI-generated nutrition. */
export function buildSourcedRecipe(recipe, ingredients, { costQuote } = {}) {
  if (
    !recipe?.id ||
    !recipe.name ||
    !Number.isInteger(recipe.yieldServings) ||
    recipe.yieldServings < 1 ||
    recipe.yieldServings > 100 ||
    !Array.isArray(recipe.ingredients) ||
    !recipe.ingredients.length
  )
    throw new Error(
      "A sourced recipe needs an ID, name, ingredients and explicit positive whole recipe yield.",
    );
  if (
    !recipe.timing ||
    ["prep", "cook", "outbound"].some(
      (k) => !Number.isInteger(recipe.timing[k]) || recipe.timing[k] < 0,
    )
  )
    throw new Error("Recipe time must be explicit planning minutes.");
  if (
    costQuote &&
    (typeof costQuote.value !== "number" ||
      !Number.isFinite(costQuote.value) ||
      costQuote.value < 0 ||
      !costQuote.source ||
      !costQuote.checkedAt)
  )
    throw new Error(
      "A cost quote needs a nonnegative per-portion value, source and checked date.",
    );
  const rows = recipe.ingredients.map((row) => {
    const matched = ingredients[row.key];
    if (!matched) throw new Error(`No reviewed USDA match for ${row.key}.`);
    return { ...row, matched, values: ingredientNutrition(matched, row) };
  });
  const coverage = {},
    values = {};
  for (const key of Object.keys(nutrientInfo)) {
    const known = rows.map((r) => r.values[key]).filter((v) => v !== null),
      sum = known.reduce((a, b) => a + b, 0);
    coverage[key] = {
      known: known.length,
      total: rows.length,
      knownSubtotal: Number.isFinite(sum) && known.length ? sum : null,
    };
    values[key] =
      known.length === rows.length && Number.isFinite(sum) ? sum : null;
  }
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    mode: "cook",
    diets: recipe.diets ?? null,
    allergens: null,
    equipment: [...recipe.equipment],
    ingredients: rows.map((row) => ({
      name: row.key,
      grams: row.grams / recipe.yieldServings,
    })),
    cost: costQuote?.value ?? null,
    portionGrams: null,
    portionLabel: `1 of ${recipe.yieldServings} recipe portions; final serving weight not measured`,
    timing: { ...recipe.timing },
    steps: [...recipe.steps],
    nutrition: {
      basis: "per_recipe",
      yieldServings: recipe.yieldServings,
      values,
      coverage,
      kind: "ingredient_estimate",
      source:
        "USDA FoodData Central ingredient aggregation; authored recipe quantities.",
      checkedAt: rows.map((r) => r.matched.provenance.checkedAt).sort()[0],
      preparation: recipe.preparation,
    },
    provenance: {
      sourceType: "recipe_with_usda_ingredients",
      fields: {
        nutrition: {
          status: "derived_from_usda",
          ingredients: rows.map((r) => ({
            key: r.key,
            fdcId: r.matched.fdcId,
            sourceUrl: r.matched.provenance.sourceUrl,
            checkedAt: r.matched.provenance.checkedAt,
            grams: r.grams,
            preparation: r.preparation,
            weightBasis: r.weightBasis,
          })),
        },
        cost: costQuote
          ? { status: "provided_quote", ...costQuote }
          : { status: "unknown" },
        timing: { status: "authored_planning_estimate" },
        diet: { status: "recipe_composition_assessment" },
        allergens: { status: "unknown" },
        portionGrams: { status: "not_measured" },
      },
      assumptions: [
        recipe.preparation,
        "Recipe nutrient values scale ingredient input weights; unlisted oil, salt, toppings and cooking losses are not included.",
        "Timing is a planning estimate, not a measured preparation time.",
      ],
      limitations: [
        "USDA ingredient averages do not make the entire recipe fully verified.",
        "No final cooked yield weight or cross-contact assurance.",
        "Strict allergen exclusions require additional source review.",
        ...(costQuote
          ? []
          : [
              "No verified price; strict-budget feasibility cannot be confirmed.",
            ]),
      ],
    },
    availability: { status: "not_applicable" },
  };
}
