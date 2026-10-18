# Substitution skill (FridgeMate cook agent)

Use this skill when annotating recipes with ingredient alternatives.

## When to suggest a substitution
- Only if the recipe needs an ingredient the user does **not** already have.
- Treat related names as the **same food** (e.g. user has `chicken` → covers `chicken breast`, `chicken thigh`, `shredded chicken`).
- Do **not** suggest a swap away from a food the user selected just to make the dish vegetarian or “lighter.”

## When not to suggest
- User already has that ingredient or a clear cut/form of it.
- Staples they can skip without a named swap (salt, pepper, water) — omit from the list.
- Never invent “without chicken” / “tofu instead of chicken” if chicken is on their list.

## How to choose the swap
1. Prefer something already on the user’s grocery list that cooks in a similar role.
2. Otherwise suggest one common store alternative with a one-line reason.
3. Mark `canOmit: true` only when the ingredient is optional garnish/seasoning.

## Output shape
```json
{
  "missing": "heavy cream",
  "use_instead": "greek yogurt",
  "from_pantry": true,
  "note": "Use greek yogurt from their list for richness.",
  "can_omit": false
}
```
