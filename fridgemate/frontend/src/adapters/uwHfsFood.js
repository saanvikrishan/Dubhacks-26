import { nutrientInfo } from "../domain/nutrition.js";
const ALLERGENS = {
  Coconut: "coconut",
  Eggs: "egg",
  Fish: "fish",
  Milk: "milk",
  Peanuts: "peanut",
  Sesame: "sesame",
  Shellfish: "shellfish",
  Soy: "soy",
  "Tree Nuts": "tree nut",
  Wheat: "wheat",
};
function published(text, unit) {
  if (typeof text !== "string" || !text.trim()) return null;
  const pattern =
    unit === "kcal"
      ? /^(\d+(?:\.\d+)?)(?:\s*kcal)?$/i
      : unit === "g"
        ? /^(\d+(?:\.\d+)?)\s*g$/i
        : /^(\d+(?:\.\d+)?)\s*mg$/i;
  const match = text.trim().match(pattern),
    value = match ? Number(match[1]) : null;
  return Number.isFinite(value) ? value : null;
}

/** Bounded, manually reviewed UW table rows. Blank allergen cells are not proof of absence. */
export function normalizeUwHfsRow(
  page,
  cells,
  { id, location, station = null, itemName },
) {
  if (
    !id ||
    !location ||
    !/^https:\/\/hfs\.washington\.edu\/nutrition\/location\/\d+\/$/.test(
      page.sourceUrl,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(page.checkedAt) ||
    !Array.isArray(page.headers) ||
    new Set(page.headers).size !== page.headers.length ||
    !Array.isArray(cells) ||
    cells.length !== page.headers.length
  )
    throw new Error(
      "A UW item needs a reviewed source URL, date, aligned headers and row.",
    );
  for (const header of [
    "Item name",
    "Vegan / Vegetarian",
    "Suggested Serving",
    "Calories",
    "Total Carbs",
    "Sodium",
  ])
    if (!page.headers.includes(header))
      throw new Error(
        "UW nutrition table headers changed; review the source before importing.",
      );
  const row = Object.fromEntries(
    page.headers.map((header, i) => [header, cells[i]]),
  );
  if (row["Item name"] !== itemName)
    throw new Error("UW item must match the exact reviewed menu-item name.");
  const mapping = {
      energy_kcal: "Calories",
      protein_g: "Protein",
      carbohydrate_g: "Total Carbs",
      fat_g: "Total Fat",
      fiber_g: "Fiber",
      sodium_mg: "Sodium",
    },
    values = {},
    fields = {};
  for (const [key, column] of Object.entries(mapping)) {
    const raw = row[column] ?? null;
    values[key] = published(raw, nutrientInfo[key][1]);
    fields[key] = {
      status: values[key] === null ? "unknown" : "uw_published_approximate",
      sourceUrl: page.sourceUrl,
      checkedAt: page.checkedAt,
      publishedColumn: column,
      originalValue: raw,
      unit: nutrientInfo[key][1],
    };
  }
  const knownPresent = [];
  for (const [column, allergen] of Object.entries(ALLERGENS)) {
    const flag = row[column]?.trim();
    if (!flag) continue;
    if (!/^(?:This allergen is present\s*)?X$/.test(flag))
      throw new Error(
        "Unknown UW allergen indicator; manual review is required.",
      );
    knownPresent.push(allergen);
  }
  const diet = row["Vegan / Vegetarian"].trim();
  if (diet && !["Vegan", "Vegetarian"].includes(diet))
    throw new Error("Unknown UW diet indicator; manual review is required.");
  const serving = row["Suggested Serving"] || null;
  return {
    id,
    name: itemName,
    description: `UW HFS nutrition listing at ${location}${station ? ` · ${station}` : ""}; serving availability unverified.`,
    mode: "eatOut",
    diets:
      diet === "Vegan"
        ? ["vegan", "vegetarian"]
        : diet === "Vegetarian"
          ? ["vegetarian"]
          : null,
    allergens: null,
    ingredients: [],
    equipment: [],
    cost: null,
    portionGrams: null,
    portionLabel: serving ?? "Published portion unavailable",
    timing: { prep: 0, cook: 0, outbound: null },
    steps: [],
    nutrition: {
      basis: "per_serving",
      values,
      kind: "published",
      source: `UW HFS approximate nutrition: ${page.sourceUrl}`,
      checkedAt: page.checkedAt,
      preparation:
        "Exact published item and suggested serving; recipe and final gram weight not supplied.",
    },
    venue: {
      name: location,
      location,
      station,
      opens: null,
      closes: null,
      hoursKind: "unknown_from_nutrition_source",
    },
    dietary: {
      knownPresent,
      allergenAbsence: "not_established",
      crossContact: "unknown",
      publishedDiet: diet || null,
    },
    published: {
      serving,
      saturatedFat_g: published(row["Sat. Fat"], "g"),
      originalRow: structuredClone(row),
    },
    availability: {
      status: "unverified",
      nutritionListed: true,
      menuDate: null,
      validFrom: null,
      validTo: null,
    },
    provenance: {
      sourceType: "uw_hfs_nutrition",
      sourceUrl: page.sourceUrl,
      checkedAt: page.checkedAt,
      responseSha256: page.responseSha256,
      fields: {
        nutrition: fields,
        cost: { status: "unknown" },
        allergens: { status: "partial_positive_indicators_only", knownPresent },
        portionGrams: { status: "not_published" },
        hours: { status: "not_provided_by_nutrition_table" },
        availability: { status: "unverified" },
      },
      assumptions: ["One exact UW published suggested serving."],
      limitations: [
        "UW HFS nutrient figures are approximate and vary with substitutions, preparation and serving size.",
        "Saturated fat is not total fat; protein, total fat and fiber remain null when unpublished.",
        "A nutrition listing does not confirm a current menu, stock, price or operating hours.",
        "Blank allergy fields do not establish allergen absence or cross-contact safety.",
      ],
    },
  };
}
