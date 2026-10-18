/** Positive indicators and absence coverage are different facts. */
export function knownPresentAllergens(meal) {
  return [...new Set([
    ...(Array.isArray(meal.allergens) ? meal.allergens : []),
    ...(meal.dietary?.knownPresent ?? []),
    ...(meal.provenance?.fields?.allergens?.knownPresent ?? []),
  ])];
}

export function hasAllergenAbsenceCoverage(meal) {
  // Only the pre-existing illustrative demo catalog treats its list as complete.
  // No generated/sourced import currently supplies verified absence evidence.
  return Array.isArray(meal.allergens) && !meal.provenance && !meal.suggestion &&
    !["unknown", "gemini_suggestion"].includes(meal.nutrition?.kind) &&
    !meal.dietary;
}
