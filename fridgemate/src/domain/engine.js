import { config, requireCapability } from "./config.js";
import { portionNutrition } from "./nutrition.js";
import { calendarConflicts } from "./calendar.js";

export const minutes = (value) =>
  /^\d{2}:\d{2}$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    : NaN;
export function clockTime(value) {
  if (!Number.isFinite(value)) return "Unknown";
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function timeParts(meal, context) {
  return meal.mode === "cook"
    ? {
        Preparation: meal.timing.prep,
        Cooking: meal.timing.cook,
        Eating: context.eating,
        Cleanup: context.cleanup,
        "Onward travel": context.onward,
        Buffer: context.buffer,
      }
    : {
        "Travel to venue": meal.timing.outbound,
        "Service allowance": context.service,
        Eating: context.eating,
        "Onward travel": context.onward,
        Buffer: context.buffer,
      };
}

/** Pure eligibility evaluation. No score, weight, model, or external call. */
export function evaluate(meal, state, c = config, options = {}) {
  const ignoreIngredients = options.ignoreIngredients === true;
  const { profile: p, context: ctx, pantry } = state;
  const reasons = [],
    gaps = [];
  if (!c.featureFlags[meal.mode]) reasons.push("This meal mode is disabled.");
  if (p.diet !== "anything" && !Array.isArray(meal.diets))
    reasons.push("Dietary suitability is unknown for your restriction.");
  else if (p.diet !== "anything" && !meal.diets.includes(p.diet))
    reasons.push(`Does not meet your ${p.diet} restriction.`);
  if (p.exclusions.length && !Array.isArray(meal.allergens))
    reasons.push("Allergen information is unknown for your exclusions.");
  for (const allergen of p.exclusions)
    if (meal.allergens?.includes(allergen))
      reasons.push(`Contains excluded ${allergen}.`);
  if (meal.allergens === null)
    gaps.push(
      "Allergen information is incomplete; suitability cannot be guaranteed.",
    );
  if (!Number.isFinite(meal.cost) || meal.cost < 0)
    reasons.push(
      "Cost is unknown or invalid, so the strict budget cannot be verified.",
    );
  else if (meal.cost > p.budget)
    reasons.push(
      `Costs $${meal.cost.toFixed(2)}, above your $${p.budget.toFixed(2)} cap.`,
    );
  if (meal.mode === "cook") {
    if (!p.cooking) reasons.push("Cooking access is off.");
    const gemini = meal.nutrition?.kind === "gemini_suggestion";
    if (!gemini) {
      const missingEquipment = meal.equipment.filter(
        (item) => !p.equipment.includes(item),
      );
      if (missingEquipment.length)
        reasons.push(`Needs equipment: ${missingEquipment.join(", ")}.`);
      const missing = meal.ingredients.filter(
        (item) => !(pantry[item.name] >= item.grams),
      );
      if (missing.length)
        reasons.push(
          `Not enough confirmed ingredients: ${missing.map((item) => `${item.name} (${item.grams} g needed)`).join(", ")}.`,
        );
    }
  }
  const parts = timeParts(meal, ctx);
  const unknownTime = Object.values(parts).some(
    (value) => value === null || !Number.isFinite(value) || value < 0,
  );
  const duration = unknownTime
    ? null
    : Object.values(parts).reduce((a, b) => a + b, 0);
  if (unknownTime) reasons.push("A required time allowance is missing.");
  for (const event of calendarConflicts(state, duration))
    reasons.push(`Overlaps ${event.title} on your calendar.`);
  const start = minutes(ctx.start),
    commitment = minutes(ctx.commitmentTime);
  const window = Math.min(ctx.available, commitment - start);
  if (!(window > 0))
    reasons.push(
      "The next commitment must follow the meal start on the same day.",
    );
  if (duration !== null && duration > window)
    reasons.push(
      `Needs ${duration} minutes; your window is ${Math.max(0, window)} ${window === 1 ? "minute" : "minutes"}.`,
    );
  if (meal.mode === "eatOut") {
    const v = meal.venue;
    if (v?.opens == null || v?.closes == null)
      reasons.push("Venue hours are unknown.");
    else if (
      start + meal.timing.outbound < v.opens ||
      start + meal.timing.outbound + (ctx.service ?? 0) + ctx.eating > v.closes
    )
      reasons.push("The meal falls outside the sample venue hours.");
    gaps.push(
      "Travel and service are planning allowances, not live estimates. Sample hours do not verify real availability.",
    );
  }
  return {
    mealId: meal.id,
    feasible: reasons.length === 0,
    reasons,
    duration,
    parts,
    window,
    score: null,
    assumptions: [
      "One stated portion",
      "All food, costs, hours, and nutrition are illustrative demo data",
    ],
    gaps,
  };
}

export function recommend(
  catalog,
  state,
  {
    mode = "compare",
    sort = "catalog",
    passed = [],
    ignoreIngredients = false,
  } = {},
  c = config,
) {
  const evaluations = catalog.map((meal) => ({
    meal,
    ...evaluate(meal, state, c, { ignoreIngredients }),
  }));
  let eligible = evaluations.filter(
    (result) =>
      result.feasible &&
      (mode === "compare" || result.meal.mode === mode) &&
      !passed.includes(result.meal.id),
  );
  if (sort === "time")
    eligible.sort(
      (a, b) => a.duration - b.duration || a.meal.cost - b.meal.cost,
    );
  if (sort === "cost")
    eligible.sort(
      (a, b) => a.meal.cost - b.meal.cost || a.duration - b.duration,
    );
  if (sort === "protein")
    eligible.sort(
      (a, b) =>
        (portionNutrition(b.meal).protein_g ?? -Infinity) -
        (portionNutrition(a.meal).protein_g ?? -Infinity),
    );
  if (sort === "catalog") {
    const preferred = state.profile.preferred.trim().toLowerCase();
    const matches = (meal) =>
      `${meal.name} ${meal.ingredients.map((i) => i.name).join(" ")}`
        .toLowerCase()
        .includes(preferred);
    if (preferred)
      eligible.sort(
        (a, b) => Number(matches(b.meal)) - Number(matches(a.meal)),
      );
  }
  // Comparison shows one available option per mode before filling the remaining slots.
  const diverse =
    mode === "compare"
      ? ["cook", "eatOut"]
          .map((m) => eligible.find((r) => r.meal.mode === m))
          .filter(Boolean)
      : [];
  const cards = [...diverse, ...eligible.filter((r) => !diverse.includes(r))]
    .slice(0, c.recommendation.maxCards)
    .sort((a, b) => eligible.indexOf(a) - eligible.indexOf(b));
  return {
    cards,
    evaluations,
    feasibleCount: eligible.length,
    strategy: "simple_comparison",
    score: null,
  };
}

export function validateInputs(profile, context, pantry) {
  const numeric = (value, label, min, max) => {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label} must be between ${min} and ${max}.`);
  };
  numeric(profile.budget, "Budget", 0, 1000);
  if (!["anything", "vegetarian", "vegan"].includes(profile.diet))
    throw new Error("Choose a supported diet.");
  if (
    !Array.isArray(profile.exclusions) ||
    !Array.isArray(profile.equipment) ||
    !Array.isArray(profile.goals) ||
    typeof profile.preferred !== "string" ||
    typeof profile.cooking !== "boolean"
  )
    throw new Error("Invalid profile.");
  if (
    profile.exclusions.some(
      (v) =>
        ![
          "soy",
          "egg",
          "milk",
          "wheat",
          "peanut",
          "tree nut",
          "sesame",
          "fish",
          "shellfish",
        ].includes(v),
    )
  )
    throw new Error(
      "Unsupported exclusion. Add verified catalog coverage before extending exclusions.",
    );
  numeric(context.available, "Available time", 1, 1440);
  for (const key of [
    "available",
    "eating",
    "cleanup",
    "onward",
    "buffer",
    "service",
  ]) {
    if (context[key] !== null && !Number.isInteger(context[key]))
      throw new Error("Time allowances must use whole minutes.");
  }
  for (const key of ["eating", "cleanup", "onward", "buffer"])
    numeric(context[key], key, 0, 240);
  if (context.service !== null)
    numeric(context.service, "Service allowance", 0, 240);
  if (
    !Number.isFinite(minutes(context.start)) ||
    !Number.isFinite(minutes(context.commitmentTime)) ||
    minutes(context.start) > 1439 ||
    minutes(context.commitmentTime) > 1439 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(context.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(context.commitmentTime)
  )
    throw new Error("Enter valid times.");
  if (minutes(context.commitmentTime) <= minutes(context.start))
    throw new Error(
      "Choose a commitment after the meal start on the same day.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(context.date) ||
    !Number.isFinite(Date.parse(context.date))
  )
    throw new Error("Enter a valid date.");
  for (const goal of profile.goals) {
    if (
      ![
        "energy_kcal",
        "protein_g",
        "carbohydrate_g",
        "fat_g",
        "fiber_g",
        "sodium_mg",
      ].includes(goal.nutrient) ||
      !["minimum", "maximum", "target_range"].includes(goal.mode)
    )
      throw new Error("Invalid nutrition goal.");
    numeric(goal.value, "Goal", 0, 100000);
    if (goal.mode === "target_range") {
      numeric(goal.upper, "Range upper bound", 0, 100000);
      if (goal.upper < goal.value)
        throw new Error("The upper bound must be at least the lower bound.");
    }
  }
  for (const grams of Object.values(pantry))
    numeric(grams, "Pantry grams", 0, 100000);
}

export function assertMealAction(meal, state, c = config, options) {
  requireCapability(meal.mode, c);
  if (meal.nutrition?.kind === "gemini_suggestion") {
    if (!state.profile.cooking)
      throw new Error("Cooking access is off.");
    const parts = timeParts(meal, state.context);
    const duration = Object.values(parts).reduce((a, b) => a + b, 0);
    return {
      mealId: meal.id,
      feasible: true,
      reasons: [],
      duration,
      parts,
      window: state.context.available,
      score: null,
      assumptions: ["Gemini suggestion · estimates only"],
      gaps: [
        "Nutrition, cost, and allergens are AI estimates—verify before cooking.",
      ],
    };
  }
  const result = evaluate(meal, state, c);
  if (!result.feasible) throw new Error(result.reasons.join(" "));
  return result;
}
