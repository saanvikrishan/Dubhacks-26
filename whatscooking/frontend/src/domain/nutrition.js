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

/** Rough adult reference values for grocery-basket coverage checks. */
export const GENERAL_DAILY_TARGETS = {
  energy_kcal: { label: "Energy", unit: "kcal", target: 2000, mode: "around" },
  protein_g: { label: "Protein", unit: "g", target: 50, mode: "minimum" },
  fiber_g: { label: "Fiber", unit: "g", target: 28, mode: "minimum" },
  carbohydrate_g: {
    label: "Carbohydrate",
    unit: "g",
    target: 275,
    mode: "around",
  },
  fat_g: { label: "Fat", unit: "g", target: 70, mode: "around" },
  sodium_mg: { label: "Sodium", unit: "mg", target: 2300, mode: "maximum" },
};

const FOOD_GROUP_PATTERNS = [
  {
    id: "produce",
    label: "Fruits & vegetables",
    tip: "Add leafy greens, fruit, or other produce.",
    pattern:
      /spinach|lettuce|kale|broccoli|carrot|tomato|pepper|onion|garlic|cucumber|apple|banana|berry|berries|orange|fruit|vegetable|avocado|celery|zucchini|mushroom|potato|sweet potato|cabbage|bean sprouts|herbs|cilantro|parsley|lemon|lime|mango|grape/i,
  },
  {
    id: "protein",
    label: "Protein foods",
    tip: "Add eggs, beans, tofu, fish, chicken, or other protein.",
    pattern:
      /chicken|beef|pork|turkey|fish|salmon|tuna|shrimp|tofu|tempeh|egg|eggs|bean|beans|lentil|chickpea|meat|yogurt|cottage cheese|protein/i,
  },
  {
    id: "grains",
    label: "Grains & starches",
    tip: "Add rice, pasta, bread, oats, or tortillas.",
    pattern:
      /rice|pasta|bread|oat|oats|quinoa|tortilla|cereal|flour|noodle|wheat|bagel|couscous|barley|corn|potato/i,
  },
  {
    id: "dairy",
    label: "Dairy or alternatives",
    tip: "Add milk, yogurt, cheese, or a fortified alt-milk.",
    pattern:
      /milk|yogurt|cheese|butter|dairy|oat milk|almond milk|soy milk|kefir/i,
  },
  {
    id: "fats",
    label: "Healthy fats",
    tip: "Add olive oil, nuts, seeds, or nut butter.",
    pattern:
      /olive oil|oil|nuts|almond|walnut|peanut|cashew|seed|seeds|avocado|tahini|butter/i,
  },
];

// Condiments, oils and spices are used by the spoonful, so they never stand in for a food group.
const CONDIMENT = /\b(?:oil|sauce|vinegar|broth|stock|bouillon|seasoning|powder|spices?|flakes|syrup|ketchup|mayo|mayonnaise|mustard|dressing|paste|sriracha|gochujang|extract|salt|black pepper|white pepper)\b/i;
/** Typical amount bought or used when the list gives none: a spoonful for condiments, a portion for foods. */
export function typicalGrams(name) {
  const n = String(name || "").toLowerCase();
  if (/\b(?:salt|black pepper|white pepper|powder|spices?|flakes|seasoning|cumin|paprika|cinnamon|oregano|turmeric|extract)\b/.test(n)) return 2;
  if (/\b(?:broth|stock)\b/.test(n)) return 240;
  if (/\b(?:peanut|almond|nut|cashew) butter\b|\btahini\b/.test(n)) return 32;
  if (/\b(?:oil|butter|ghee)\b/.test(n)) return 14;
  if (CONDIMENT.test(n) || /\b(?:honey|jam)\b/.test(n)) return 15;
  if (/\b(?:garlic|ginger|cilantro|basil|parsley|mint|herbs?|chili|jalape)/.test(n)) return 10;
  return 150;
}

/** Parse a free-text qty into estimated grams (default 150 g per item). */
export function estimateGrams(qty, fallback = 150) {
  const text = String(qty || "").trim().toLowerCase();
  if (!text) return fallback;
  const grams = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams)\b/);
  if (grams) return Math.min(5000, Math.max(10, Number(grams[1])));
  const kg = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo)/);
  if (kg) return Math.min(5000, Math.max(10, Number(kg[1]) * 1000));
  const oz = text.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce)/);
  if (oz) return Math.min(5000, Math.max(10, Number(oz[1]) * 28.35));
  const lb = text.match(/(\d+(?:\.\d+)?)\s*(?:lb|pound)/);
  if (lb) return Math.min(5000, Math.max(10, Number(lb[1]) * 453.6));
  const count = text.match(/^(\d+(?:\.\d+)?)\s*(?:x|pcs?|pieces?|bags?|cans?|bunches?)?$/);
  if (count) return Math.min(5000, Math.max(10, Number(count[1]) * fallback));
  const leading = text.match(/^(\d+(?:\.\d+)?)/);
  if (leading) return Math.min(5000, Math.max(10, Number(leading[1]) * fallback));
  return fallback;
}

export function foodGroupCoverage(itemNames) {
  const names = (itemNames || []).map((n) => String(n || ""));
  return FOOD_GROUP_PATTERNS.map((group) => {
    // A condiment counts only as a healthy fat when it is an oil (fish sauce is not a protein food).
    const hits = names.filter((n) => group.pattern.test(n) && (!CONDIMENT.test(n) || (group.id === "fats" && /\boil\b/i.test(n))));
    return {
      id: group.id,
      label: group.label,
      tip: group.tip,
      met: hits.length > 0,
      examples: hits.slice(0, 3),
    };
  });
}

/**
 * Compare estimated grocery-basket nutrition to general daily targets.
 * `totals` keys match GENERAL_DAILY_TARGETS (absolute amounts for the basket).
 */
export function assessGroceryNutrition(totals, itemNames = []) {
  const nutrients = Object.entries(GENERAL_DAILY_TARGETS).map(([key, meta]) => {
    const value = Number(totals?.[key]) || 0;
    const ratio = meta.target > 0 ? value / meta.target : 0;
    let status;
    let detail;
    if (meta.mode === "minimum") {
      status = value >= meta.target ? "met" : "gap";
      detail =
        status === "met"
          ? "Daily minimum covered"
          : `${Math.ceil(meta.target - value)} ${meta.unit} short of a typical day`;
    } else if (meta.mode === "maximum") {
      status = value <= meta.target ? "ok" : "high";
      detail =
        status === "ok"
          ? "Under the daily limit"
          : `${Math.ceil(value - meta.target)} ${meta.unit} over a typical daily limit`;
    } else {
      status = ratio >= 0.7 && ratio <= 1.35 ? "met" : ratio < 0.7 ? "gap" : "high";
      detail =
        status === "met"
          ? "In a reasonable daily range"
          : status === "gap"
            ? `Low vs ~${meta.target} ${meta.unit}/day`
            : `High vs ~${meta.target} ${meta.unit}/day`;
    }
    return {
      key,
      ...meta,
      value,
      pct: Math.round(ratio * 100),
      status,
      detail,
    };
  });
  const groups = foodGroupCoverage(itemNames);
  const gaps = [
    ...nutrients.filter((n) => n.status === "gap").map((n) => n.label),
    ...groups.filter((g) => !g.met).map((g) => g.label),
  ];
  const metCount =
    nutrients.filter((n) => n.status === "met" || n.status === "ok").length +
    groups.filter((g) => g.met).length;
  const totalChecks = nutrients.length + groups.length;
  return {
    nutrients,
    groups,
    gaps,
    score: totalChecks ? Math.round((metCount / totalChecks) * 100) : 0,
    summary:
      gaps.length === 0
        ? "This list looks balanced against general daily nutrient needs."
        : `Gaps to watch: ${gaps.slice(0, 4).join(", ")}${gaps.length > 4 ? "…" : ""}.`,
  };
}
