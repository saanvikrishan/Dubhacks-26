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
      <rect width="768" height="768" fill="url(#g)"/><circle cx="384" cy="338" r="68" fill="none" stroke="#8ba58b" stroke-width="7"/><path d="M275 270v55c0 28 38 28 38 0v-55m-19 0v150m198 0V270c-45 22-45 88 0 88" fill="none" stroke="#8ba58b" stroke-width="7" stroke-linecap="round"/><text x="384" y="495" text-anchor="middle" fill="#547254" font-family="sans-serif" font-size="25">Photo unavailable</text>
    </svg>`,
  );

const thumbCache = new Map();
const inflight = new Map();

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

/** Immediate preview tagged with the dish's own words (not random stock). */
export function taggedMealImage() { return MEAL_IMAGE_PLACEHOLDER; }

/** Reject ingredient closeups and conflicting dishes; metadata is still only illustrative. */
export function preparedDishMatch(nameOrMeal, result) {
  const name = norm(photoQuery(nameOrMeal));
  const title = norm(result?.title);
  const forms = ['salad','soup','pasta','sandwich','toast','bowl','curry','omelet','omelette','noodle','pizza','wrap','risotto','stew','burrito','taco','stir fry','fried rice'];
  const dishForms = forms.filter(form=>name.includes(form));
  if (!dishForms.length || !dishForms.some(form=>title.includes(form))) return false;
  if (/seed|seedling|garden bed|growing|planting|close up|macro photo|botanical/.test(title)) return false;
  const wanted = new Set(tokens(photoQuery(nameOrMeal)));
  const actual = new Set(tokens(title));
  for (const food of CONFLICT_FOODS) if (actual.has(food) && !wanted.has(food)) return false;
  const shared = [...wanted].filter(t=>actual.has(t));
  return shared.length >= 2;
}

function imageKey(meal) {
  return JSON.stringify([photoQuery(meal).toLowerCase(), typeof meal==='object' ? (meal?.ingredients??[]).map(i=>i.name).sort() : []]);
}
function curatedImage(meal) {
  const pictures={'tofu-bowl':'tofu','tomato-pasta':'pasta','chickpea-bowl':'chickpeas'};
  const photo=pictures[meal?.id];
  return photo && !meal.suggestion && meal.nutrition?.kind==='illustrative_demo' ? `/food/${photo}.png` : null;
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

async function searchOpenverse(query, signal, fetchImpl) {
  const res = await fetchImpl(
    `/api/openverse/images/?q=${encodeURIComponent(query)}&page_size=20`,
    { signal },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.results) ? data.results : [];
}

function pickOpenverseUrl(nameOrMeal, results) {
  if (!results?.length) return null;
  const dishQuery = photoQuery(nameOrMeal);
  const ranked = results.filter(r=>preparedDishMatch(nameOrMeal,r))
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

  return good[0].url;
}

/**
 * Resolve a photo that matches the dish name.
 * Uses a confident prepared-dish match; otherwise keeps a neutral placeholder.
 */
export async function resolveMealImage(nameOrMeal, {fetchImpl=fetch} = {}) {
  const curated=curatedImage(nameOrMeal);
  if(curated)return curated;
  const key = imageKey(nameOrMeal);
  if (!key) return taggedMealImage("food");
  const hit = thumbCache.get(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);


  const job = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const q = searchQuery(nameOrMeal);
      const results = await searchOpenverse(q, controller.signal, fetchImpl);
      const url = pickOpenverseUrl(nameOrMeal, results);
      const finalUrl = url || MEAL_IMAGE_PLACEHOLDER;
      thumbCache.set(key, finalUrl);
      return finalUrl;
    } catch {
      return MEAL_IMAGE_PLACEHOLDER;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

export function prefetchMealImages(meals) {
  for (const meal of meals || []) {
    if (!meal?.name && !meal?.imageSearch) continue;
    const key = imageKey(meal);
    if (key) thumbCache.delete(key);
    void resolveMealImage(meal);
  }
}

export function mealImage(meal) {
  if (!meal) return MEAL_IMAGE_PLACEHOLDER;
  return curatedImage(meal) || thumbCache.get(imageKey(meal)) || MEAL_IMAGE_PLACEHOLDER;
}

export const photoFor = (meal) => mealImage(meal);
