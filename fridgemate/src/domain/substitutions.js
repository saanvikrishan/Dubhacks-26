/** Client-side coverage checks aligned with backend substitution skill. */

const COMPOUND_TAILS = new Set([
  "vinegar",
  "sauce",
  "oil",
  "powder",
  "extract",
  "juice",
  "broth",
  "stock",
  "seasoning",
  "paste",
  "flakes",
]);

const STOP = new Set([
  "fresh",
  "dried",
  "frozen",
  "chopped",
  "minced",
  "sliced",
  "raw",
  "cooked",
  "boneless",
  "skinless",
  "organic",
  "large",
  "small",
  "of",
  "and",
  "or",
  "the",
  "a",
  "an",
]);

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return new Set(
    norm(text)
      .split(" ")
      .filter((t) => t && !STOP.has(t) && t.length > 1),
  );
}

export function pantryCovers(needed, pantry) {
  const n = norm(needed);
  if (!n) return true;
  const nParts = n.split(" ");
  const nToks = tokens(n);
  const names = Array.isArray(pantry) ? pantry : Object.keys(pantry || {});

  return names.some((raw) => {
    const a = norm(raw);
    if (!a) return false;
    const aParts = a.split(" ");
    const aToks = tokens(a);
    if (n === a) return true;

    if (a.includes(n) || n.includes(a)) {
      if (
        aParts.length === 1 &&
        nParts.length > 1 &&
        COMPOUND_TAILS.has(nParts[nParts.length - 1]) &&
        nParts[0] === aParts[0]
      )
        return false;
      if (
        nParts.length === 1 &&
        aParts.length > 1 &&
        COMPOUND_TAILS.has(aParts[aParts.length - 1]) &&
        aParts[0] === nParts[0]
      )
        return false;
      if (
        a.length >= 3 &&
        (` ${n} `.includes(` ${a} `) ||
          n.startsWith(`${a} `) ||
          n.endsWith(` ${a}`))
      )
        return true;
      if (
        n.length >= 3 &&
        (` ${a} `.includes(` ${n} `) ||
          a.startsWith(`${n} `) ||
          a.endsWith(` ${n}`))
      )
        return true;
    }

    for (const t of nToks) {
      if (t.length >= 4 && aToks.has(t)) return true;
    }
    return false;
  });
}

export function mealSubstitutions(meal, pantry) {
  const list = Array.isArray(meal?.substitutions) ? meal.substitutions : [];
  if (!list.length) return [];
  return list.filter((s) => s?.missing && !pantryCovers(s.missing, pantry));
}

export function substitutionLine(swap) {
  if (!swap) return "";
  if (swap.useInstead && swap.fromPantry)
    return `${swap.missing} → ${swap.useInstead} (you have this)`;
  if (swap.useInstead) return `${swap.missing} → try ${swap.useInstead}`;
  if (swap.canOmit) return `${swap.missing} → optional / can skip`;
  return swap.note || swap.missing;
}
