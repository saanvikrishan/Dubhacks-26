export const STANDARD_ALLERGENS = ['soy','egg','milk','wheat','peanut','tree nut','sesame','fish','shellfish'];
const ALIASES = {eggs:'egg', peanuts:'peanut', 'tree nuts':'tree nut', dairy:'milk', soya:'soy', soybeans:'soy'};
export function normalizeAllergy(value) {
  const name = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[name] ?? name;
}
export function normalizeAllergies(values) { return [...new Set(values.map(normalizeAllergy).filter(Boolean))]; }
export function validAllergies(values) {
  return Array.isArray(values) && values.length <= 30 && values.every(v => typeof v === 'string' && v.trim() && v.length <= 60);
}
/** Custom names are literal ingredient terms, not regexes or proof of absence. */
export function excludedInIngredients(ingredients, exclusions = []) {
  const standard = allergensInIngredients(ingredients);
  const text = names(ingredients);
  return normalizeAllergies(exclusions).filter(a => STANDARD_ALLERGENS.includes(a) ? standard.includes(a) :
    new RegExp(`(?:^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?:$|[^a-z0-9])`, 'i').test(text));
}

/** Positive indicators and absence coverage are different facts. */
export function knownPresentAllergens(meal) {
  return [...new Set([
    ...(Array.isArray(meal.allergens) ? meal.allergens : []),
    ...(meal.dietary?.knownPresent ?? []),
    ...(meal.provenance?.fields?.allergens?.knownPresent ?? []),
  ])];
}

export function hasAllergenAbsenceCoverage(meal, exclusions = []) {
  // A recipe the user confirmed after its ingredients were checked for their allergens counts as covered.
  if (meal.review?.confirmed === true && meal.review.allergensConfirmed === true)
    return exclusions.every(a => (meal.review.exclusionsChecked ?? STANDARD_ALLERGENS).includes(normalizeAllergy(a)));
  if (exclusions.some(a => !STANDARD_ALLERGENS.includes(normalizeAllergy(a)))) return false;
  // Only the pre-existing illustrative demo catalog treats its list as complete.
  // No generated/sourced import currently supplies verified absence evidence.
  return Array.isArray(meal.allergens) && !meal.provenance && !meal.suggestion &&
    !["unknown", "gemini_suggestion"].includes(meal.nutrition?.kind) &&
    !meal.dietary;
}

// A quick read of what a recipe's ingredient names contain (plant "milks" and nut butters are not dairy).
const NOT_DAIRY = /\b(?:peanut|almond|cashew|nut|apple|cocoa|shea|sunflower|soy) butter\b|\b(?:coconut|oat|soy|almond|rice|cashew) (?:milk|cream|yogurt)\b|\bcream of tartar\b/g;
const ALLERGEN_WORDS = {
  soy: /\b(?:soy|soya|tofu|tempeh|edamame|miso|tamari)\b/,
  egg: /\beggs?\b|\bmayo(?:nnaise)?\b|\bmeringue\b/,
  milk: /\b(?:milk|cheese|butter|cream|yogurt|yoghurt|ghee|whey|casein|parmesan|mozzarella|cheddar|feta|ricotta|paneer)\b/,
  wheat: /\b(?:wheat|flour|bread|pasta|spaghetti|noodles?|tortillas?|couscous|bulgur|seitan|breadcrumbs?|panko|udon|ramen|pita|bagels?|crackers?|soy sauce)\b/,
  peanut: /\bpeanuts?\b/,
  "tree nut": /\b(?:almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?)\b/,
  sesame: /\b(?:sesame|tahini)\b/,
  fish: /\b(?:fish|salmon|tuna|cod|tilapia|anchov\w*|sardines?|trout|halibut|mackerel)\b/,
  shellfish: /\b(?:shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|crawfish|crayfish)\b/,
};
const MEAT = /\b(?:chicken|beef|pork|bacon|ham|turkey|lamb|mutton|sausages?|salami|pepperoni|prosciutto|chorizo|veal|duck|goat|steak|meat|gelatin|lard|anchov\w*|fish|salmon|tuna|cod|tilapia|trout|sardines?|shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|squid|octopus)\b/;
const ANIMAL = /\b(?:eggs?|milk|cheese|butter|cream|yogurt|yoghurt|honey|ghee|whey|mayo(?:nnaise)?|parmesan|mozzarella|cheddar|feta|ricotta|paneer)\b/;
const names = (ingredients) => (ingredients ?? []).map((i) => String(i?.name ?? i).toLowerCase()).join(" | ");

export function allergensInIngredients(ingredients) {
  const text = names(ingredients);
  const forMilk = text.replace(NOT_DAIRY, " "), forWheat = text.replace(/\b(?:rice|glass|soba) noodles?\b/g, " ");
  return Object.entries(ALLERGEN_WORDS).filter(([name, words]) => words.test(name === "milk" ? forMilk : name === "wheat" ? forWheat : text)).map(([name]) => name);
}

/** The first ingredient that breaks a vegetarian or vegan diet, or null. */
export function dietConflict(ingredients, diet) {
  const text = names(ingredients);
  if (diet === "vegetarian" || diet === "vegan") {
    const meat = text.match(MEAT);
    if (meat) return meat[0];
  }
  if (diet === "vegan") {
    const animal = text.replace(NOT_DAIRY, " ").match(ANIMAL);
    if (animal) return animal[0];
  }
  return null;
}
