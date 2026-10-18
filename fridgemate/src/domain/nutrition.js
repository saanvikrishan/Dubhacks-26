export const nutrientInfo = {
  energy_kcal: ["Energy", "kcal"],
  protein_g: ["Protein", "g"],
  carbohydrate_g: ["Carbohydrate", "g"],
  fat_g: ["Fat", "g"],
  fiber_g: ["Fiber", "g"],
  sodium_mg: ["Sodium", "mg"],
};
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
