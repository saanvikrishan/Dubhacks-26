// Self-authored fixtures. These numbers are deliberately NOT real venue/menu data.
// Field-level nulls exercise incomplete nutrition. Replace through the catalog adapter.
// Cook recipes: per-serving values calculated from the USDA ingredient records (tests/nutrition-accuracy).
// Venues below remain self-authored demo fixtures.
const nutrients = (
  energy_kcal,
  protein_g,
  carbohydrate_g,
  fat_g,
  fiber_g,
  sodium_mg,
) => ({ energy_kcal, protein_g, carbohydrate_g, fat_g, fiber_g, sodium_mg });
const ingredient = (name, grams) => ({ name, grams });
const nutrition = (values, basis = "per_serving", yieldServings = 1, calculated = false) => ({
  values,
  basis,
  yieldServings,
  kind: calculated ? "ingredient_estimate" : "illustrative_demo",
  source: calculated
    ? "Calculated from USDA FoodData Central records for the listed ingredient amounts (no unlisted salt or toppings)."
    : "WhatsCooking.ai self-authored demo fixture v1; not a nutrition database or verified menu.",
  checkedAt: "2026-10-17",
  preparation: "Cooked, edible weight; no unlisted toppings.",
});
const cook = (
  id,
  name,
  description,
  ingredients,
  cost,
  portionGrams,
  values,
  timing,
  diets,
  allergens,
  equipment,
  steps,
) => ({
  id,
  name,
  description,
  ingredients,
  cost,
  portionGrams,
  portionLabel:
    id === "chickpea-toast"
      ? "2 topped slices"
      : id === "tomato-pasta"
        ? "1 plate"
        : "1 bowl",
  nutrition: nutrition(values, "per_serving", 1, true),
  timing: { prep: timing[0], cook: timing[1], outbound: 0 },
  diets,
  allergens,
  equipment,
  steps,
  mode: "cook",
});
const venue = (
  id,
  name,
  description,
  cost,
  portionGrams,
  values,
  diets,
  allergens,
  opens = 600,
  closes = 1200,
) => ({
  id,
  name,
  description,
  cost,
  portionGrams,
  portionLabel: "1 meal",
  nutrition: nutrition(values),
  diets,
  allergens,
  mode: "eatOut",
  ingredients: [],
  equipment: [],
  timing: { prep: 0, cook: 0, outbound: 5 },
  venue: {
    name: "Sample Campus Kitchen",
    location: "Fictional campus venue · demo only",
    opens,
    closes,
    hoursKind: "illustrative_demo",
  },
  steps: [
    "This venue is fictional. No real directions, stock, menu, queue, or ordering information is available.",
  ],
});

/** @type {import('../domain/contracts').FoodRecord[]} */
export const catalog = [
  cook(
    "tofu-bowl",
    "Tofu & roasted vegetable bowl",
    "A warm bowl of crisp tofu, brown rice, and colorful vegetables.",
    [
      ingredient("tofu", 150),
      ingredient("cooked brown rice", 150),
      ingredient("frozen vegetables", 150),
      ingredient("olive oil", 5),
    ],
    4.8,
    455,
    nutrients(553, 35, 63, 20, 12, 98),
    [5, 15],
    ["vegetarian", "vegan"],
    ["soy"],
    ["stove", "pan"],
    [
      "Cut tofu into cubes. Heat the oil in a pan.",
      "Cook tofu for 8 minutes, turning until golden. Add frozen vegetables and cook for 7 minutes.",
      "Heat already-cooked rice during the final vegetable cooking step. Serve together.",
    ],
  ),
  cook(
    "garlic-rice",
    "Creamy Garlic Fried Rice",
    "The team’s original comfort-food idea, with a complete meal window.",
    [
      ingredient("cooked brown rice", 180),
      ingredient("eggs", 100),
      ingredient("garlic", 5),
      ingredient("soy sauce", 10),
      ingredient("olive oil", 5),
    ],
    3.6,
    300,
    nutrients(421, 19, 49, 16, 3, 699),
    [5, 10],
    ["vegetarian"],
    ["egg", "soy", "wheat"],
    ["stove", "pan"],
    [
      "Chop garlic and beat the eggs.",
      "Warm oil, scramble eggs until cooked, then add garlic.",
      "Add rice and soy sauce. Stir until thoroughly hot, about 5 minutes.",
    ],
  ),
  cook(
    "chickpea-bowl",
    "Crispy Chickpea Bowl",
    "Fresh cucumber, chickpeas, and yogurt. Simple, satisfying, and quick.",
    [
      ingredient("chickpeas", 150),
      ingredient("yogurt", 75),
      ingredient("cucumber", 100),
      ingredient("cooked brown rice", 100),
    ],
    4.2,
    425,
    nutrients(430, 19, 74, 7, 14, 51),
    [5, 5],
    ["vegetarian"],
    ["milk"],
    ["stove", "pan"],
    [
      "Drain and rinse already-cooked chickpeas. Warm in a pan for 5 minutes.",
      "Dice cucumber while chickpeas warm.",
      "Serve with already-cooked rice and yogurt.",
    ],
  ),
  cook(
    "tomato-pasta",
    "Cheesy Tomato Pasta",
    "The team’s cozy pasta idea, with ingredients measured for one portion.",
    [
      ingredient("dry pasta", 90),
      ingredient("tomatoes", 150),
      ingredient("cheese", 30),
      ingredient("garlic", 5),
      ingredient("olive oil", 5),
    ],
    3.9,
    400,
    nutrients(533, 20, 76, 17, 5, 210),
    [5, 18],
    ["vegetarian"],
    ["wheat", "milk"],
    ["stove", "pot"],
    [
      "Boil pasta according to its package, about 10–13 minutes.",
      "After draining, warm pre-chopped tomatoes with garlic and oil in the pot for 5 minutes. This is counted after the pasta cooking time.",
      "Toss pasta in tomatoes, add cheese, and serve.",
    ],
  ),
  cook(
    "chickpea-toast",
    "Chickpea & cucumber toast",
    "A no-cook option for the days that get away from you.",
    [
      ingredient("bread", 80),
      ingredient("chickpeas", 120),
      ingredient("cucumber", 80),
      ingredient("olive oil", 5),
    ],
    2.8,
    285,
    nutrients(455, 21, 70, 11, 14, 374),
    [5, 0],
    ["vegetarian", "vegan"],
    ["wheat"],
    [],
    [
      "Drain and rinse already-cooked chickpeas, then mash with olive oil.",
      "Slice cucumber.",
      "Spoon chickpeas and cucumber onto ready-to-eat bread.",
    ],
  ),
  cook("tofu-cucumber", "Tofu, cucumber & rice salad", "Fresh, no-cook tofu and rice with crisp cucumber.", [ingredient("tofu",150),ingredient("cooked brown rice",150),ingredient("cucumber",100),ingredient("olive oil",5)],4.4,405,nutrients(460, 31, 46, 20, 6, 29),[5,0],["vegetarian","vegan"],["soy"],[],["Use ready-to-eat tofu and already-cooked rice.","Dice tofu and cucumber. Toss with olive oil and rice."]),
  cook("tomato-rice", "Garlicky tomato rice", "A warm, comforting bowl using rice, tomatoes and garlic.",[ingredient("cooked brown rice",200),ingredient("tomatoes",150),ingredient("garlic",5),ingredient("olive oil",5)],2.9,360,nutrients(325, 7, 59, 7, 5, 16),[5,5],["vegetarian","vegan"],[],["stove","pan"],["Chop tomatoes and garlic.","Warm oil and garlic, then add tomatoes. Stir in already-cooked rice until thoroughly hot, about 5 minutes."]),
  cook("chickpea-rice-salad", "Chickpea rice picnic bowl", "A fresh, no-cook mix of chickpeas, rice and cucumber.",[ingredient("chickpeas",150),ingredient("cooked brown rice",150),ingredient("cucumber",100),ingredient("olive oil",5)],3.8,405,nutrients(490, 18, 83, 10, 14, 19),[5,0],["vegetarian","vegan"],[],[],["Drain and rinse already-cooked chickpeas.","Dice cucumber and toss with cooked rice, chickpeas and olive oil."]),
  cook("egg-toast", "Egg & tomato toast", "A quick, comforting egg toast for a smaller meal window.",[ingredient("eggs",100),ingredient("bread",80),ingredient("tomatoes",100),ingredient("olive oil",5)],3.2,285,nutrients(407, 23, 39, 18, 6, 511),[3,5],["vegetarian"],["egg","wheat"],["stove","pan"],["Slice tomatoes and warm a pan with oil.","Scramble eggs until fully cooked, about 5 minutes. Serve on ready-to-eat bread with tomato."]),
  venue(
    "campus-bowl",
    "Campus tofu grain bowl",
    "A sample eat-out comparison with an explicit service allowance.",
    8.5,
    480,
    nutrients(590, 25, 78, 20, 10, 920),
    ["vegetarian", "vegan"],
    ["soy", "wheat"],
  ),
  venue(
    "lentil-soup",
    "Lentil soup & bread",
    "A sample lighter-price meal; sodium has not been supplied.",
    6.5,
    450,
    nutrients(430, 19, 67, 9, 14, null),
    ["vegetarian", "vegan"],
    ["wheat"],
  ),
  venue(
    "chicken-wrap",
    "Chicken & greens wrap",
    "A sample chicken meal for comparing protein, time, and price.",
    9.5,
    360,
    nutrients(610, 36, 59, 24, 6, 1080),
    [],
    ["wheat", "milk"],
  ),
  venue(
    "market-salad",
    "Market chickpea salad",
    "A sample menu with incomplete allergen information.",
    7.5,
    350,
    nutrients(390, 15, 42, 18, null, null),
    ["vegetarian", "vegan"],
    null,
  ),
];
export const byId = Object.fromEntries(catalog.map((meal) => [meal.id, meal]));
export const pantryItems = [
  ...new Set(catalog.flatMap((meal) => meal.ingredients.map((i) => i.name))),
];

export const catalogAdapter = {
  list: () => catalog,
  get: (id) => byId[id] ?? null,
  status: { kind: "illustrative_demo", live: false },
};
