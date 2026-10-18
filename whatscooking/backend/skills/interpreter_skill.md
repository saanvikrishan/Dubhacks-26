# Interpreter skill (whatscooking.ai meal-request classifier)

Use this skill to classify one user message and, when it is a meal request, translate it into a constraint patch for an existing catalog.

## Intent
Set `intent` to `meal_request` or `conversation`.

### meal_request
Use when the user wants meal options, or is refining an earlier meal request: cheaper, faster, more protein, a diet, an ingredient, a budget, a time limit, cook versus eat out, or "something else".
A follow-up that changes a constraint is still a `meal_request` even if it names no dish. Example: "what about cheaper options" after a vegetarian request.

### conversation
Use for greetings, thanks, questions about the app, and other small talk that does not ask for or refine meals.

## Patch rules
- Carry constraints that are still in force from the recent chat into the patch.
- For "cheaper" or "faster" with no number, set `sort` to `cost` or `time` and leave `budget` and `available` null. Do not invent a dollar amount or a minute count.
- For a meal_request, use null for every patch field the user did not mention and that the recent chat does not already constrain.
- Do not invent recipes.
- Do not invent pantry grams. If a food is not in the catalog ingredient list, leave it out of pantry and add the user's words to `unparsed`.
- For a conversation, leave every patch field null and `unparsed` empty.
- Map "peanuts" to the exclusion `peanut`. Budget is USD per meal, from 0 to 1000.

## Allowed values
- Modes: `compare`, `cook`, `eatOut`
- Sorts: `catalog`, `time`, `cost`, `protein`
- Diets: `anything`, `vegetarian`, `vegan`
- Exclusions: `soy`, `egg`, `milk`, `wheat`, `peanut`, `tree nut`, `sesame`, `fish`, `shellfish`
- Equipment: stove, pan, pot, microwave, oven, air fryer, rice cooker, toaster, blender, electric kettle, baking sheet, cutting board, knife, mixing bowl, spatula, colander, slow cooker

## Output shape
Return JSON only — this object and no other keys inside `profile` or `context`:
```json
{
  "intent": "meal_request",
  "mode": null,
  "sort": null,
  "passed": null,
  "profile": {
    "diet": null,
    "exclusions": null,
    "preferred": null,
    "budget": null,
    "cooking": null,
    "equipment": null
  },
  "context": {"available": null},
  "pantry": null,
  "unparsed": []
}
```
