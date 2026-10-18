# Vision skill (FridgeMate fridge / pantry scan)

Use this skill when reading a fridge or pantry photo for edible ingredients.

## What to list
- Produce, proteins, dairy, eggs, leftovers in labeled containers, sauces you can clearly identify.
- Short grocery-style names only (e.g. `eggs`, `spinach`, `milk`, `cheddar cheese`).

## What to ignore
- Shelves, bins, magnets, brands, packaging logos, non-food objects.
- Guesswork: if you cannot clearly see it, leave it out.

## Naming
- Prefer common grocery words over brand or prep jargon.
- One entry per food; do not duplicate the same item.
- Cap at about 30 items; prioritize the clearest and most useful ones.

## Output shape
Return valid JSON only:
```json
{"ingredients":["ingredient 1","ingredient 2"]}
```
If nothing edible is visible, return `{"ingredients":[]}`.
