import { nutrientInfo } from "../domain/nutrition.js";
const IDS = {
  energy_kcal: 1008,
  protein_g: 1003,
  carbohydrate_g: 1005,
  fat_g: 1004,
  fiber_g: 1079,
  sodium_mg: 1093,
};
const mass = { g: 1, mg: 0.001, ug: 0.000001, mcg: 0.000001 };
const unit = (value) =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/[µμ]/g, "u")
    : "";
function amount(row, target) {
  const value = row.amount,
    source = unit(row.nutrient?.unitName);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  let result = null;
  if (target === "kcal")
    result = source === "kcal" ? value : source === "kj" ? value / 4.184 : null;
  else if (mass[source]) result = (value * mass[source]) / mass[target];
  return Number.isFinite(result) ? result : null;
}

/** Full USDA detail rows, per 100 g. Search hits and label-per-serving objects are not accepted. */
export function normalizeUsdaFood(raw, match) {
  if (
    !raw ||
    !match ||
    !Number.isInteger(raw.fdcId) ||
    typeof raw.description !== "string" ||
    !raw.description.trim() ||
    typeof match.rationale !== "string" ||
    !match.rationale.trim() ||
    raw.fdcId !== match.fdcId ||
    raw.description !== match.expectedDescription ||
    raw.dataType !== match.expectedDataType
  )
    throw new Error(
      "USDA food must exactly match the reviewed FDC ID, description and data type.",
    );
  if (
    !["SR Legacy", "Foundation", "Survey (FNDDS)"].includes(raw.dataType) ||
    !Array.isArray(raw.foodNutrients) ||
    !raw.foodNutrients.some((r) => Number.isInteger(r.nutrient?.id))
  )
    throw new Error(
      "Unsupported USDA data type or full-detail nutrient structure.",
    );
  if (
    !["raw", "cooked"].includes(match.preparation) ||
    !["raw_edible_weight", "cooked_edible_weight"].includes(
      match.weightBasis,
    ) ||
    !match.key ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.retrievedAt ?? "")
  )
    throw new Error(
      "Explicit preparation, weight basis, key and retrieval date are required.",
    );
  if (
    (match.preparation === "raw") !==
    (match.weightBasis === "raw_edible_weight")
  )
    throw new Error("Preparation and quantity basis disagree.");
  const values = {},
    fields = {},
    warnings = [];
  for (const [key, id] of Object.entries(IDS)) {
    let rows = raw.foodNutrients.filter((r) => r.nutrient?.id === id);
    if (key === "energy_kcal" && !rows.length)
      rows = raw.foodNutrients.filter((r) => r.nutrient?.id === 1062);
    const target = nutrientInfo[key][1],
      converted = rows.map((r) => amount(r, target));
    const unique = [...new Set(converted)];
    values[key] =
      rows.length && unique.length === 1 && unique[0] !== null
        ? unique[0]
        : null;
    fields[key] = {
      status: values[key] === null ? "unknown" : "usda_published_normalized",
      fdcId: raw.fdcId,
      nutrientId: rows[0]?.nutrient?.id ?? id,
      originalRows: structuredClone(rows),
      unit: target,
    };
    if (values[key] === null)
      warnings.push(
        `${key}: missing, invalid, unsupported units, or conflicting source rows.`,
      );
  }
  return {
    key: match.key,
    fdcId: raw.fdcId,
    description: raw.description,
    dataType: raw.dataType,
    preparation: match.preparation,
    weightBasis: match.weightBasis,
    basis: "per_100g",
    values,
    provenance: {
      sourceType: "usda_fdc",
      sourceUrl: `https://fdc.nal.usda.gov/food-details/${raw.fdcId}/nutrients`,
      retrievalUrl: raw.retrievalUrl,
      checkedAt: raw.retrievedAt,
      matchingRationale: match.rationale,
      fields,
      limitations: [
        "Ingredient averages; not exact nutrition for a UW dish.",
        "Brand, preparation and cooked/raw form must match the reviewed record.",
        "Allergen absence and cross-contact are not established by this nutrient record.",
      ],
      warnings,
    },
  };
}

export function ingredientNutrition(
  ingredient,
  { grams, preparation, weightBasis },
) {
  if (
    typeof grams !== "number" ||
    !Number.isFinite(grams) ||
    grams <= 0 ||
    grams > 100000
  )
    throw new Error(
      "Ingredient weight must be above 0 and at most 100,000 edible grams.",
    );
  if (
    preparation !== ingredient.preparation ||
    weightBasis !== ingredient.weightBasis
  )
    throw new Error(
      "Raw/cooked preparation or edible-weight basis does not match the reviewed USDA food.",
    );
  return Object.fromEntries(
    Object.keys(nutrientInfo).map((key) => {
      const value = ingredient.values[key];
      const scaled = value === null ? null : (value * grams) / 100;
      return [key, Number.isFinite(scaled) ? scaled : null];
    }),
  );
}
