export const nutrientInfo = {
  // ── Macronutrients & Energy ────────────────────────────────────────────────
  energy_kcal:        ["Energy",              "kcal"],
  protein_g:          ["Protein",             "g"],
  carbohydrate_g:     ["Total Carbohydrate",  "g"],
  fiber_g:            ["Dietary Fiber",       "g"],
  sugar_g:            ["Total Sugars",        "g"],
  added_sugar_g:      ["Added Sugars",        "g"],
  // ── Lipids ────────────────────────────────────────────────────────────────
  fat_g:              ["Total Fat",           "g"],
  saturated_fat_g:    ["Saturated Fat",       "g"],
  trans_fat_g:        ["Trans Fat",           "g"],
  mono_fat_g:         ["Monounsaturated Fat", "g"],
  poly_fat_g:         ["Polyunsaturated Fat", "g"],
  cholesterol_mg:     ["Cholesterol",         "mg"],
  // ── Vitamins ──────────────────────────────────────────────────────────────
  vitamin_a_mcg:      ["Vitamin A",           "µg"],
  vitamin_c_mg:       ["Vitamin C",           "mg"],
  vitamin_d_mcg:      ["Vitamin D",           "µg"],
  vitamin_e_mg:       ["Vitamin E",           "mg"],
  vitamin_k_mcg:      ["Vitamin K",           "µg"],
  thiamin_mg:         ["Thiamin (B1)",        "mg"],
  riboflavin_mg:      ["Riboflavin (B2)",     "mg"],
  niacin_mg:          ["Niacin (B3)",         "mg"],
  pantothenic_mg:     ["Pantothenic Acid (B5)","mg"],
  vitamin_b6_mg:      ["Vitamin B6",          "mg"],
  folate_mcg:         ["Folate / Folic Acid (B9)", "µg"],
  vitamin_b12_mcg:    ["Vitamin B12",         "µg"],
  choline_mg:         ["Choline",             "mg"],
  // ── Minerals ──────────────────────────────────────────────────────────────
  calcium_mg:         ["Calcium",             "mg"],
  iron_mg:            ["Iron",                "mg"],
  magnesium_mg:       ["Magnesium",           "mg"],
  phosphorus_mg:      ["Phosphorus",          "mg"],
  potassium_mg:       ["Potassium",           "mg"],
  sodium_mg:          ["Sodium",              "mg"],
  zinc_mg:            ["Zinc",                "mg"],
  copper_mg:          ["Copper",              "mg"],
  manganese_mg:       ["Manganese",           "mg"],
  selenium_mcg:       ["Selenium",            "µg"],
};

/** Short copy for USDA match-rate confidence on recipe cards and details. */
export function usdaConfidenceExplain(nutrition) {
  const level = nutrition?.confidence || "medium";
  const matched = nutrition?.usda_matched?.length;
  const total =
    (nutrition?.usda_matched?.length || 0) +
    (nutrition?.usda_unmatched?.length || 0);
  const matchBit =
    Number.isFinite(matched) && total > 0
      ? `${matched} of ${total} ingredients matched USDA. `
      : "";
  const meaning =
    level === "high"
      ? "High means most ingredients were found in USDA FoodData Central."
      : level === "low"
        ? "Low means only a few ingredients matched, so macros are incomplete."
        : "Medium means about half the ingredients matched; unmatched items are left out of the totals.";
  return `${matchBit}${meaning}`;
}
export function portionNutrition(meal, servings = 1) {
  if (!Number.isFinite(servings) || servings <= 0)
    throw new Error("Portion must be greater than zero.");
  const { basis, yieldServings, values } = meal.nutrition;
  let factor;
  if (basis === "per_serving") factor = servings;
  else if (
    basis === "per_100g" &&
    Number.isFinite(meal.portionGrams) &&
    meal.portionGrams > 0
  )
    factor = (meal.portionGrams * servings) / 100;
  else if (
    basis === "per_recipe" &&
    Number.isFinite(yieldServings) &&
    yieldServings > 0
  )
    factor = servings / yieldServings;
  else throw new Error("Unknown nutrition basis or recipe yield.");
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("Invalid nutrition scale.");
  return Object.fromEntries(
    Object.keys(nutrientInfo).map((key) => {
      const value = values[key];
      const scaled =
        Number.isFinite(value) && value >= 0 ? value * factor : null;
      return [key, Number.isFinite(scaled) ? scaled : null];
    }),
  );
}
export function dailyNutrition(logs, meals, date) {
  const entries = logs.filter((log) => log.date === date);
  return Object.fromEntries(
    Object.keys(nutrientInfo).map((key) => {
      const known = entries
        .map((log) =>
          meals[log.mealId]
            ? portionNutrition(meals[log.mealId], log.servings)[key]
            : null,
        )
        .filter((v) => v != null);
      const sum = known.reduce((a, b) => a + b, 0);
      const hasTotal = known.length > 0 && Number.isFinite(sum);
      return [
        key,
        {
          value: hasTotal ? sum : null,
          known: known.length,
          total: entries.length,
          complete: hasTotal && known.length === entries.length,
        },
      ];
    }),
  );
}
export function goalStatus(summary, goal) {
  if (!summary.complete)
    return "Partial subtotal — goal comparison unavailable";
  const value = summary.value;
  if (goal.mode === "minimum")
    return value >= goal.value
      ? "Minimum reached"
      : `${Math.ceil(goal.value - value)} to your minimum`;
  if (goal.mode === "maximum")
    return value <= goal.value
      ? `${Math.floor(goal.value - value)} below your maximum`
      : "Above your maximum";
  return value < goal.value
    ? "Below your range"
    : value > goal.upper
      ? "Above your range"
      : "Within your range";
}

/** Display confirmed ingredient subtotals without turning incomplete totals into intake facts. */
export function nutritionDisplayRows(meal, servings=1, keys=Object.keys(nutrientInfo)) {
  const values=portionNutrition(meal,servings);
  return keys.flatMap(key=>{
    if(values[key]!=null)return [{key,value:values[key],partial:false}];
    const coverage=meal.nutrition.coverage?.[key];
    if(meal.nutrition.basis==='per_serving' && Number.isFinite(coverage?.knownSubtotal))
      return [{key,value:coverage.knownSubtotal*servings,partial:true,known:coverage.known,total:coverage.total,missingIngredients:coverage.missingIngredients??[]}];
    return [];
  });
}
