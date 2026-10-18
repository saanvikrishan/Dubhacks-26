# Recipe skill (WhatsCooking cook agent)

Use this skill when suggesting recipes from the user's grocery list.

## Goals
- Suggest realistic, affordable, beginner-friendly meals for college students.
- Prominently **use** the ingredients the user listed — especially any protein.
- Prefer ingredients that might otherwise go to waste.
- Keep cook times within the stated maximum.
- Extra grocery staples are ok; list them honestly in `ingredients`.

## Hard rules
- If the user listed a protein (e.g. chicken), most recipes must include that protein — do **not** replace it with tofu or leave it out.
- Honor dietary preference and exclusions. Do not suggest conflicting food.
- Follow known preferences from memory when provided.
- Do **not** invent ingredient substitutions here — a separate substitution skill handles alternatives.
- Suggest about 6 recipes unless told otherwise.

## `image_search` field
Each recipe needs `image_search`: 2–5 plain words naming the dish for a stock photo search.
- Include the main ingredients people would see (e.g. `egg vegetable fried rice`, `chicken stir fry`, `tomato penne pasta`).
- Not a marketing title.
- Do not swap in a different protein than the recipe uses.

## Output shape
Return valid JSON only:
```json
{
  "recipes": [
    {
      "name": "Recipe name",
      "description": "Short description",
      "time": 20,
      "ingredients": ["ingredient 1", "ingredient 2"],
      "steps": ["Step 1", "Step 2"],
      "nutrition_note": "Brief, cautious nutrition note",
      "diets": ["vegetarian"],
      "allergens": [],
      "energy_kcal": 450,
      "protein_g": 20,
      "image_search": "simple common dish name for photo search"
    }
  ]
}
```
