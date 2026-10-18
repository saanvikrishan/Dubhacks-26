import usda from "./sourced/usda-records.json" with { type: "json" };
import uw from "./sourced/uw-hfs-rows.json" with { type: "json" };
import { normalizeUsdaFood } from "../adapters/usdaFood.js";
import { normalizeUwHfsRow } from "../adapters/uwHfsFood.js";
import { buildSourcedRecipe } from "../domain/sourcedRecipes.js";
import { uwDining } from "./uwDining.js";

// Explicit matches, including cooked/raw form. Never use the first search result automatically.
export const ingredientMatches = [
  {
    key: "cooked brown rice",
    fdcId: 169704,
    expectedDescription:
      "Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)",
    expectedDataType: "SR Legacy",
    preparation: "cooked",
    weightBasis: "cooked_edible_weight",
    rationale:
      "Brown, long-grain rice weighed after cooking; dry/white rice is not interchangeable.",
  },
  {
    key: "tofu",
    fdcId: 172475,
    expectedDescription: "Tofu, raw, firm, prepared with calcium sulfate",
    expectedDataType: "SR Legacy",
    preparation: "raw",
    weightBasis: "raw_edible_weight",
    rationale:
      "Firm calcium-sulfate tofu as packaged; not fried, silken, dried or a different coagulant.",
  },
  {
    key: "cucumber",
    fdcId: 168409,
    expectedDescription: "Cucumber, with peel, raw",
    expectedDataType: "SR Legacy",
    preparation: "raw",
    weightBasis: "raw_edible_weight",
    rationale: "Raw cucumber weighed with edible peel; not peeled cucumber.",
  },
  {
    key: "chickpeas",
    fdcId: 173757,
    expectedDescription:
      "Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt",
    expectedDataType: "SR Legacy",
    preparation: "cooked",
    weightBasis: "cooked_edible_weight",
    rationale:
      "Boiled cooked chickpeas without added salt; not dry seeds or a canned/salted product.",
  },
];
export const sourcedIngredients = Object.fromEntries(
  ingredientMatches.map((match) => [
    match.key,
    normalizeUsdaFood(
      usda.records.find((r) => r.fdcId === match.fdcId),
      match,
    ),
  ]),
);
const ingredient = (key, grams) => ({
  key,
  grams,
  preparation: sourcedIngredients[key].preparation,
  weightBasis: sourcedIngredients[key].weightBasis,
});
export const sourcedRecipeDefinitions = [
  {
    id: "sourced-tofu-rice-bowl",
    name: "Tofu & brown rice bowl",
    description:
      "An authored recipe using explicitly matched USDA ingredients.",
    yieldServings: 2,
    diets: ["vegan", "vegetarian"],
    equipment: [],
    timing: { prep: 10, cook: 0, outbound: 0 },
    ingredients: [
      ingredient("tofu", 300),
      ingredient("cooked brown rice", 300),
      ingredient("cucumber", 200),
    ],
    preparation:
      "Already-cooked brown rice, raw-as-packaged firm tofu and raw cucumber input weights; no unlisted dressing or oil.",
    steps: [
      "Measure the confirmed edible ingredients in the specified forms.",
      "Dice ready-to-eat tofu and cucumber; combine with already-cooked rice. Divide into two equal recipe portions.",
    ],
  },
  {
    id: "sourced-chickpea-cucumber",
    name: "Chickpea & cucumber salad",
    description:
      "An authored two-portion recipe; nutrient totals derive from USDA ingredient averages.",
    yieldServings: 2,
    diets: ["vegan", "vegetarian"],
    equipment: [],
    timing: { prep: 8, cook: 0, outbound: 0 },
    ingredients: [ingredient("chickpeas", 300), ingredient("cucumber", 200)],
    preparation:
      "Boiled unsalted chickpeas weighed after cooking, raw cucumber with peel; no unlisted dressing.",
    steps: [
      "Measure already-cooked unsalted chickpeas and raw cucumber with peel.",
      "Dice cucumber and combine. Divide into two equal recipe portions.",
    ],
  },
  {
    id: "sourced-chickpea-rice",
    name: "Chickpea & brown rice bowl",
    description:
      "Simple authored recipe; price and final serving weight are unknown.",
    yieldServings: 2,
    diets: ["vegan", "vegetarian"],
    equipment: [],
    timing: { prep: 6, cook: 0, outbound: 0 },
    ingredients: [
      ingredient("chickpeas", 300),
      ingredient("cooked brown rice", 300),
      ingredient("cucumber", 100),
    ],
    preparation:
      "Both rice and chickpeas are already cooked and weighed as edible cooked food; cucumber is raw with peel.",
    steps: [
      "Confirm the ingredients match the reviewed cooked/raw forms.",
      "Combine measured ingredients and divide into two equal recipe portions.",
    ],
  },
];
const UW_META = {
  "https://hfs.washington.edu/nutrition/location/362/": {
    location: "Center Table",
    station: "Noodle",
    items: { "Herb Pasta": "uw-center-table-herb-pasta" },
  },
  "https://hfs.washington.edu/nutrition/location/385/": {
    location: "Local Point",
    station: "Pizza",
    items: { "Cheese Pizza": "uw-local-point-cheese-pizza" },
  },
  "https://hfs.washington.edu/nutrition/location/240/": {
    location: "District Market",
    station: null,
    items: {
      "CHANA MASALA": "uw-district-market-chana-masala",
      "MEDITERRANEAN BOWL": "uw-district-market-mediterranean-bowl",
      "PEANUT BUTTER & JAM SANDWICH": "uw-district-market-pb-jam",
    },
  },
};
export const sourcedUwItems = uw.pages.flatMap((page) =>
  page.rows.map((cells) => {
    const meta = UW_META[page.sourceUrl],
      itemName = cells[0];
    if (!meta?.items[itemName])
      throw new Error("UW row has no explicit reviewed item match.");
    const item = normalizeUwHfsRow(page, cells, {
      ...meta,
      id: meta.items[itemName],
      itemName,
    });
    const venue = uwDining.find((v) => v.name === meta.location);
    if (venue)
      item.provenance.locationReference = {
        source: "existing_reviewed_uw_venue_data",
        name: venue.name,
        location: venue.location,
        sourceUrl: venue.menu,
      };
    return item;
  }),
);

/** Separate opt-in catalog. Existing demo catalog and UI imports remain untouched. */
export function buildSourcedCatalog({ cookCostQuotes = {} } = {}) {
  return [
    ...sourcedRecipeDefinitions.map((recipe) =>
      buildSourcedRecipe(recipe, sourcedIngredients, {
        costQuote: cookCostQuotes[recipe.id],
      }),
    ),
    ...structuredClone(sourcedUwItems),
  ];
}

// Expanded UW dining catalog is separate from the existing Cook and legacy preview records.
export { buildUwDiningCatalog } from "../domain/uwDining.js";
