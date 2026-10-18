import { config, validateConfig } from "./config.js";
import { recommend, validateInputs } from "./engine.js";
import { nutrientInfo, portionNutrition } from "./nutrition.js";

export const INTENT_SCHEMA_VERSION = 1;
const MODES = new Set(["cook", "eatOut", "compare"]);
const SORTS = new Set(["catalog", "time", "cost", "protein"]);

function object(value, allowed, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (
      !allowed.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
    )
      throw new Error(`${label} contains unsupported fields.`);
  }
  return value;
}
function number(value, min, max, label, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `${label} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`,
    );
  return value;
}

/** AI can propose two bounded numeric changes. It cannot provide food facts or actions. */
export function validateFoodIntent(raw) {
  let input = raw;
  if (typeof raw === "string") {
    if (raw.length > 16384) throw new Error("Intent JSON exceeds 16 KB.");
    try {
      input = JSON.parse(raw);
    } catch {
      throw new Error(
        "Intent must be valid JSON, without Markdown or surrounding text.",
      );
    }
  }
  object(
    input,
    ["action", "mode", "sort", "contextPatch", "profilePatch"],
    "Intent",
  );
  if (input.action !== "recommend")
    throw new Error("Only recommend is supported.");
  const mode = input.mode === undefined ? "compare" : input.mode;
  const sort = input.sort === undefined ? "catalog" : input.sort;
  if (!MODES.has(mode) || !SORTS.has(sort))
    throw new Error("Unsupported recommendation mode or sort.");
  const contextPatch = {},
    profilePatch = {};
  if (Object.hasOwn(input, "contextPatch")) {
    object(input.contextPatch, ["available"], "contextPatch");
    if (Object.hasOwn(input.contextPatch, "available"))
      contextPatch.available = number(
        input.contextPatch.available,
        1,
        1440,
        "Available time",
        true,
      );
  }
  if (Object.hasOwn(input, "profilePatch")) {
    object(input.profilePatch, ["budget"], "profilePatch");
    if (Object.hasOwn(input.profilePatch, "budget"))
      profilePatch.budget = number(
        input.profilePatch.budget,
        0,
        1000,
        "Budget",
      );
  }
  return { action: "recommend", mode, sort, contextPatch, profilePatch };
}

function candidateProblem(meal) {
  if (
    !meal ||
    typeof meal !== "object" ||
    typeof meal.id !== "string" ||
    !meal.id ||
    !["cook", "eatOut"].includes(meal.mode)
  )
    return "Candidate identity or mode is invalid.";
  if (meal.suggestion === true || meal.nutrition?.kind === "gemini_suggestion")
    return "AI-generated food facts must be independently verified before entering this bridge.";
  if (
    typeof meal.name !== "string" ||
    !Array.isArray(meal.ingredients) ||
    !Array.isArray(meal.equipment) ||
    !meal.timing ||
    !meal.nutrition?.values ||
    !["per_serving", "per_100g", "per_recipe"].includes(meal.nutrition.basis)
  )
    return "Candidate does not meet the existing FoodRecord contract.";
  if (meal.diets !== null && !Array.isArray(meal.diets))
    return "Dietary coverage is malformed; use null for unknown.";
  if (meal.allergens !== null && !Array.isArray(meal.allergens))
    return "Allergen coverage is malformed; use null for unknown.";
  if (
    meal.ingredients.some(
      (item) =>
        !item ||
        typeof item.name !== "string" ||
        !Number.isFinite(item.grams) ||
        item.grams <= 0,
    )
  )
    return "Ingredient quantities are unknown or malformed.";
  try {
    portionNutrition(meal);
  } catch {
    return "Nutrition basis or portion scale is invalid.";
  }
  return null;
}
function annotate(result) {
  const meal = result.meal;
  let nutrition = null;
  try {
    if (meal) nutrition = portionNutrition(meal);
  } catch {
    /* Invalid records remain rejected and have unknown nutrition. */
  }
  const sourced = !!meal?.provenance;
  const sourceLimitations = sourced
    ? [...(meal.provenance.limitations ?? [])]
    : [
        "Illustrative demo food record; not a verified nutrition or availability source.",
      ];
  return {
    ...result,
    assumptions: sourced
      ? ["One stated portion", ...(meal.provenance.assumptions ?? [])]
      : result.assumptions,
    missingData: [
      ...(nutrition
        ? Object.keys(nutrientInfo).filter((key) => nutrition[key] === null)
        : Object.keys(nutrientInfo)),
      ...(!Number.isFinite(meal?.cost) ? ["cost"] : []),
      ...(meal?.allergens === null ? ["allergen_absence"] : []),
      ...(meal?.portionGrams == null ? ["portionGrams"] : []),
      ...(meal?.mode === "eatOut" && !Number.isFinite(meal?.timing?.outbound)
        ? ["outbound_travel"]
        : []),
      ...(meal?.mode === "eatOut" &&
      (meal?.venue?.opens == null || meal?.venue?.closes == null)
        ? ["venue_hours"]
        : []),
    ],
    sourceLimitations,
    availability: meal?.availability ?? {
      status: meal?.mode === "eatOut" ? "unverified" : "not_applicable",
    },
    nutrition,
  };
}

/** Pure, detached preview. No persistence adapter, mutation service, or network is called. */
export function previewFoodIntent(raw, state, foods, c = config) {
  const intent = validateFoodIntent(raw);
  validateConfig(c);
  if (!Array.isArray(foods) || foods.length > 200)
    throw new Error("Provide a bounded catalog of at most 200 foods.");
  const previewState = structuredClone(state);
  previewState.context = { ...previewState.context, ...intent.contextPatch };
  previewState.profile = { ...previewState.profile, ...intent.profilePatch };
  validateInputs(
    previewState.profile,
    previewState.context,
    previewState.pantry,
  );
  const catalog = structuredClone(foods),
    valid = [],
    rejected = [];
  const ids = new Set();
  for (const meal of catalog) {
    const problem = candidateProblem(meal);
    if (problem) {
      rejected.push({
        meal,
        mealId: meal?.id ?? null,
        feasible: false,
        reasons: [problem],
        score: null,
        assumptions: [],
        gaps: [problem],
      });
      continue;
    }
    if (ids.has(meal.id))
      throw new Error("Candidate identifiers must be unique.");
    ids.add(meal.id);
    valid.push(meal);
  }
  const result = recommend(
    valid,
    previewState,
    { mode: intent.mode, sort: intent.sort },
    c,
  );
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    previewOnly: true,
    intent,
    previewState,
    appliedChanges: {
      context: Object.entries(intent.contextPatch).map(([field, to]) => ({
        field,
        from: state.context[field],
        to,
      })),
      profile: Object.entries(intent.profilePatch).map(([field, to]) => ({
        field,
        from: state.profile[field],
        to,
      })),
    },
    strategy: result.strategy,
    score: null,
    feasibleCount: result.feasibleCount,
    candidates: result.cards.map(annotate),
    evaluations: [...result.evaluations, ...rejected].map(annotate),
    limitations: [
      "Preview does not save preferences, plans, calendar, pantry or consumption.",
      "Feasible means fits the recorded constraints; it does not confirm live dish availability.",
    ],
  };
}
