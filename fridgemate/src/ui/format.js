import { minutes } from "../domain/engine.js";
export const money = (n) => (n == null ? "Unknown price" : `$${n.toFixed(2)}`);
export const num = (n) =>
  n == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
export const niceTime = (t) => {
  const m = minutes(t);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
};

/** Tiny inline placeholder — paints instantly while CDN photo resolves. */
export const MEAL_IMAGE_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#e7efe6"/><stop offset="1" stop-color="#d5e4d3"/>
      </linearGradient></defs>
      <rect width="768" height="768" fill="url(#g)"/>
    </svg>`,
  );

const thumbCache = new Map();

function searchQueries(name) {
  const base = String(name || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = base.split(/[\s/]+/).filter(Boolean);
  const list = [base, parts.slice(0, 3).join(" "), parts.slice(0, 2).join(" ")];
  if (parts[0]) list.push(parts[0]);
  const out = [];
  const seen = new Set();
  for (const q of list) {
    const t = q.trim().slice(0, 60);
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Fast TheMealDB lookup (existing CDN photos, not AI generation). */
export async function resolveMealImage(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (thumbCache.has(key)) return thumbCache.get(key);

  for (const q of searchQueries(name)) {
    try {
      const res = await fetch(
        `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`,
      );
      if (!res.ok) continue;
      const data = await res.json();
      const thumb = data?.meals?.[0]?.strMealThumb;
      if (thumb) {
        thumbCache.set(key, thumb);
        return thumb;
      }
    } catch {
      // try next query
    }
  }
  thumbCache.set(key, null);
  return null;
}

/**
 * Sync URL for <img src>. Prefers backend imageUrl; catalog stock keys stay local.
 * Never hits a slow generative image API.
 */
export function mealImage(meal) {
  if (!meal) return MEAL_IMAGE_PLACEHOLDER;
  if (typeof meal.imageUrl === "string" && /^https?:\/\//.test(meal.imageUrl))
    return meal.imageUrl;
  if (typeof meal.photo === "string" && /^https?:\/\//.test(meal.photo))
    return meal.photo;

  const isAiSuggestion =
    meal.suggestion ||
    meal.nutrition?.kind === "gemini_suggestion" ||
    meal.nutrition?.kind === "usda_estimated";

  if (
    !isAiSuggestion &&
    (meal.photo === "pasta" ||
      meal.photo === "chickpeas" ||
      meal.photo === "tofu")
  ) {
    return `/food/${meal.photo}.png`;
  }

  const cached = thumbCache.get(
    String(meal.name || "")
      .trim()
      .toLowerCase(),
  );
  if (cached) return cached;
  return MEAL_IMAGE_PLACEHOLDER;
}

/** @deprecated use mealImage */
export const photoFor = (meal) => mealImage(meal);
