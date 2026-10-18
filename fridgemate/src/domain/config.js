import team from "../data/team-config.json" with { type: "json" };

// The original team settings remain in team-config.json. Direct human decisions
// override requested ranking and integration scope here. No weight is evaluated.
export const config = {
  ...team,
  featureFlags: {
    ...team.featureFlags,
    calendarView: true,
    calendarImport: true,
  },
  scope: { ...team.scope, stopAfterCore: true },
  recommendation: {
    ...team.recommendation,
    strategy: "simple_comparison",
    weightedScoringEnabled: false,
  },
  runtime: {
    database: "browser-local-demo",
    ai: "deterministic-command-parser",
    catalog: "illustrative-demo",
  },
};

export function validateConfig(c) {
  if (c.schemaVersion !== 1)
    throw new Error("Unsupported configuration version.");
  for (const [name, value] of Object.entries(c.featureFlags)) {
    if (typeof value !== "boolean")
      throw new Error(`${name} must be a boolean.`);
  }
  if (!c.featureFlags.cook && !c.featureFlags.eatOut)
    throw new Error("Enable at least one meal mode.");
  if (
    c.recommendation.weightedScoringEnabled ||
    c.recommendation.strategy !== "simple_comparison"
  ) {
    throw new Error(
      "Weighted scoring is unvalidated and cannot be activated in this build.",
    );
  }
  const dependencies = {
    calendarImport: ["calendarView"],
    dailyNutritionSummary: ["nutritionDetails", "mealLogging"],
    nutritionGoals: ["nutritionDetails"],
    calendarWrite: ["calendarRead", "authentication"],
    messaging: ["authentication"],
    reminders: ["backgroundJobs", "messaging"],
    automaticMealRescheduling: ["calendarWrite"],
    pantryVision: ["manualPantry"],
  };
  for (const [flag, required] of Object.entries(dependencies)) {
    if (c.featureFlags[flag] && required.some((key) => !c.featureFlags[key]))
      throw new Error(`${flag} requires ${required.join(", ")}.`);
  }
  for (const n of Object.values(c.timing).filter(
    (v) => typeof v === "number",
  )) {
    if (!Number.isInteger(n) || n < 0)
      throw new Error("Timing allowances must be nonnegative whole minutes.");
  }
  if (
    !Number.isInteger(c.recommendation.maxCards) ||
    c.recommendation.maxCards < 2
  )
    throw new Error("Comparison needs at least two cards.");
  const nutrients = [
    "energy_kcal",
    "protein_g",
    "carbohydrate_g",
    "fat_g",
    "fiber_g",
    "sodium_mg",
  ];
  if (
    !Array.isArray(c.nutrition.displayNutrients) ||
    c.nutrition.displayNutrients.some((key) => !nutrients.includes(key))
  )
    throw new Error("Unsupported visible nutrient.");
  return c;
}
validateConfig(config);

const implemented = new Set([
  "calendarView",
  "calendarImport",
  "cook",
  "eatOut",
  "nutritionDetails",
  "nutritionGoals",
  "mealLogging",
  "dailyNutritionSummary",
  "manualPantry",
  "manualSchedule",
  "foodAssistant",
]);
export function capabilities(c = config) {
  return Object.fromEntries(
    Object.entries(c.featureFlags).map(([key, requested]) => [
      key,
      {
        requested,
        implemented: implemented.has(key),
        configured: implemented.has(key),
        authorized: implemented.has(key),
        healthy: implemented.has(key),
        available: requested && implemented.has(key),
        limitation: implemented.has(key)
          ? "Local demonstration only"
          : "Not implemented; no provider calls or account access",
      },
    ]),
  );
}
export function requireCapability(name, c = config) {
  if (!capabilities(c)[name]?.available)
    throw new Error(`${name} is disabled or unavailable.`);
}
