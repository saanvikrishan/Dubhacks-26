import { pantryItems } from "../data/catalog.js";

const STOCKED = 5000;
const STOP = new Set(["and", "with", "some", "the", "for", "plus"]);

const normalize = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Loose match so "rice" or "eggs" lines up with catalog ingredient names. */
export function ingredientMatches(entry, name) {
  const typed = normalize(entry);
  const ingredient = normalize(name);
  if (typed.length < 3 || STOP.has(typed)) return false;
  if (
    typed === ingredient ||
    ingredient.includes(typed) ||
    typed.includes(ingredient)
  )
    return true;
  const ingredientWords = ingredient.split(" ");
  const typedWords = typed
    .split(" ")
    .filter((word) => word.length >= 3 && !STOP.has(word));
  if (
    ingredientWords.some((word) => word === typed || word.startsWith(typed))
  )
    return true;
  return ingredientWords.some(
    (word) =>
      word.length >= 4 &&
      typedWords.some(
        (typedWord) => word.startsWith(typedWord) || typedWord.startsWith(word),
      ),
  );
}

function remember(list, name) {
  if (!list.some((item) => item.toLowerCase() === name.toLowerCase()))
    list.push(name);
}

export function addGroceryNames(current, raw, items = pantryItems) {
  const parts = String(raw)
    .split(/[,;\n]/)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 2);
  const next = [...current];
  for (const part of parts) {
    const hits = items.filter((item) => ingredientMatches(part, item));
    const words = part
      .split(" ")
      .filter((word) => word.length >= 3 && !STOP.has(word));
    const unmatchedWords = words.filter(
      (word) => !items.some((item) => ingredientMatches(word, item)),
    );
    if (hits.length) for (const name of hits) remember(next, name);
    if (!hits.length) remember(next, part);
    else if (unmatchedWords.length) remember(next, unmatchedWords.join(" "));
  }
  return next;
}

/** Selected groceries become a pantry: listed staples are stocked, the rest are empty. */
export function pantryFromGroceries(entries, items = pantryItems) {
  const pantry = Object.fromEntries(items.map((item) => [item, 0]));
  const matched = [];
  const unmatched = [];
  for (const entry of entries) {
    const hits = items.filter((item) => ingredientMatches(entry, item));
    if (!hits.length) {
      if (!unmatched.some((item) => item.toLowerCase() === String(entry).toLowerCase()))
        unmatched.push(entry);
      continue;
    }
    for (const hit of hits) {
      pantry[hit] = STOCKED;
      if (!matched.includes(hit)) matched.push(hit);
    }
  }
  return { pantry, matched, unmatched };
}
