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
const inflight = new Map();
const usedThumbs = new Set();

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "with",
  "in",
  "of",
  "style",
  "homemade",
  "easy",
  "quick",
  "bowl",
  "plate",
  "dish",
  "recipe",
  "meal",
  "fresh",
  "zesty",
  "spicy",
  "simple",
  "classic",
  "best",
  "loaded",
  "healthy",
]);

/** Strong food signals — if the photo has these and the dish doesn't, reject. */
const CONFLICT_FOODS = new Set([
  "shrimp",
  "prawn",
  "prawns",
  "chicken",
  "beef",
  "pork",
  "lamb",
  "fish",
  "salmon",
  "tuna",
  "bacon",
  "sausage",
  "crab",
  "lobster",
  "turkey",
  "duck",
  "steak",
  "pepperoni",
  "anchovy",
  "clam",
  "mussel",
  "tofu",
]);

const SYNONYM = {
  veggie: "vegetable",
  veggies: "vegetable",
  veg: "vegetable",
  eggs: "egg",
  tomatoes: "tomato",
  peppers: "pepper",
  noodles: "noodle",
};

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return norm(text)
    .split(" ")
    .map((t) => SYNONYM[t] || t)
    .filter((t) => t && !STOP.has(t) && t.length > 2);
}

function hashPick(seed, size) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return size > 0 ? h % size : 0;
}

function providedUrl(mealOrName) {
  if (!mealOrName || typeof mealOrName !== "object") return null;
  for (const key of ["imageUrl", "photo"]) {
    const v = mealOrName[key];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

/** Prefer the full recipe title so "egg veggie fried rice" isn't shortened away. */
function photoQuery(mealOrName) {
  if (mealOrName && typeof mealOrName === "object") {
    const name = String(mealOrName.name || "").trim();
    const search = String(mealOrName.imageSearch || "").trim();
    // Prefer Gemini's short imageSearch when it is specific enough
    if (search && tokens(search).length >= 2) return search.slice(0, 100);
    const primary =
      name.length >= search.length ? name || search : search || name;
    return primary.slice(0, 100) || "homemade meal";
  }
  return String(mealOrName || "homemade meal").trim().slice(0, 100);
}

function searchQuery(mealOrName) {
  const q = photoQuery(mealOrName);
  const toks = tokens(q);
  const core = toks.slice(0, 6).join(" ");
  return `${core || q} food`.trim();
}

/** Soft placeholder tagged with dish words (only when no real photo exists). */
export function taggedMealImage(name) {
  const tags = tokens(name).slice(0, 5);
  const ordered = [...tags].sort((a, b) => {
    const rank = (t) =>
      CONFLICT_FOODS.has(t) || t === "egg" || t === "vegetable" || t === "tofu"
        ? 0
        : t === "rice" || t === "pasta" || t === "noodle"
          ? 2
          : 1;
    return rank(a) - rank(b);
  });
  const tagStr = (ordered.length ? ordered : ["food"]).concat("food").join(",");
  const lock = hashPick(name, 999999);
  return `https://loremflickr.com/768/768/${encodeURIComponent(tagStr)}/all?lock=${lock}`;
}

/**
 * Score a candidate photo against the dish.
 * Shared ingredients help; conflicting proteins hurt a lot.
 */
function scoreCandidate(query, title, tagText = "") {
  const want = new Set(tokens(query));
  const blob = `${title} ${tagText}`;
  const gotList = tokens(blob);
  const got = new Set(gotList);
  if (!want.size) return -999;

  let shared = 0;
  for (const t of want) if (got.has(t)) shared += 1;

  if (shared === 0) return -400;
  // One shared token is only OK for short dish names ("pad thai")
  if (want.size >= 3 && shared < 2) return -200;

  let score = shared * 120;
  // Coverage bonus: matching most of the dish name
  score += Math.round((180 * shared) / Math.max(1, want.size));

  for (const t of want) {
    if (got.has(t) && t !== "fried" && t !== "rice" && t !== "food") score += 80;
  }

  for (const t of got) {
    if (CONFLICT_FOODS.has(t) && !want.has(t)) score -= 500;
  }

  const extras = gotList.filter((t) => !want.has(t) && t !== "food").length;
  score -= Math.min(80, extras * 10);

  return score;
}

async function searchOpenverse(query, signal) {
  const res = await fetch(
    `/api/openverse/images/?q=${encodeURIComponent(query)}&page_size=20`,
    { signal },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.results) ? data.results : [];
}

function pickOpenverseUrl(dishQuery, results) {
  if (!results?.length) return null;
  const ranked = results
    .map((r, index) => {
      const tagText = Array.isArray(r.tags)
        ? r.tags.map((t) => (typeof t === "string" ? t : t?.name || "")).join(" ")
        : "";
      return {
        url: r.url || r.thumbnail,
        score: scoreCandidate(dishQuery, r.title || "", tagText),
        index,
        title: r.title || "",
      };
    })
    .filter((r) => r.url && /^https?:\/\//.test(r.url))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!ranked.length) return null;

  // Require a real shared-token match (score >= 100 ≈ one shared token)
  const good = ranked.filter((r) => r.score >= 140);
  if (!good.length) return null;

  const fresh = good.filter((r) => !usedThumbs.has(r.url));
  const choices = fresh.length ? fresh : good;
  const top = choices[0].score;
  const band = choices.filter((r) => r.score >= top - 60);
  const chosen = band[hashPick(dishQuery, band.length)] || choices[0];
  usedThumbs.add(chosen.url);
  return chosen.url;
}

/**
 * Resolve a photo that matches the dish name.
 * Prefers Openverse when confident; otherwise keeps a provided CDN URL;
 * only uses LoremFlickr as a last resort.
 */
export async function resolveMealImage(nameOrMeal) {
  const dish = photoQuery(nameOrMeal);
  const key = dish.toLowerCase();
  if (!key) return MEAL_IMAGE_PLACEHOLDER;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const fallback = providedUrl(nameOrMeal);

  const job = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const q = searchQuery(nameOrMeal);
      const results = await searchOpenverse(q, controller.signal);
      const url = pickOpenverseUrl(dish, results);
      // Prefer a confident Openverse hit; otherwise keep backend TheMealDB URL
      const finalUrl = url || fallback || taggedMealImage(dish);
      thumbCache.set(key, finalUrl);
      return finalUrl;
    } catch {
      const finalUrl = fallback || taggedMealImage(dish);
      thumbCache.set(key, finalUrl);
      return finalUrl;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

export function prefetchMealImages(meals) {
  usedThumbs.clear();
  for (const meal of meals || []) {
    if (!meal?.name && !meal?.imageSearch) continue;
    const key = photoQuery(meal).toLowerCase();
    if (key) thumbCache.delete(key);
    void resolveMealImage(meal);
  }
}

export function mealImage(meal) {
  if (!meal) return MEAL_IMAGE_PLACEHOLDER;

  const isAiSuggestion =
    meal.suggestion ||
    meal.nutrition?.kind === "gemini_suggestion" ||
    meal.nutrition?.kind === "usda_estimated";

  // Local catalog assets for known venues / catalog meals
  if (
    !isAiSuggestion &&
    (meal.photo === "pasta" ||
      meal.photo === "chickpeas" ||
      meal.photo === "tofu")
  ) {
    return `/food/${meal.photo}.png`;
  }

  const key = photoQuery(meal).toLowerCase();
  const cached = thumbCache.get(key);
  if (cached) return cached;

  // Backend TheMealDB URL (only when scoring accepted it)
  const url = providedUrl(meal);
  if (url) return url;

  return MEAL_IMAGE_PLACEHOLDER;
}

export const photoFor = (meal) => mealImage(meal);
