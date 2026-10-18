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

/** Neutral "Photo unavailable" card art — dish photos are only shown when explicitly verified. */
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

export function isMealPlaceholder(url) {
  return (
    !url ||
    url === MEAL_IMAGE_PLACEHOLDER ||
    (typeof url === "string" && url.startsWith("data:image/svg"))
  );
}

// Only explicitly assigned bundled illustrations may appear on meal cards.
// Search titles, generated search phrases and remote image URLs do not verify a dish.
const MEAL_ILLUSTRATIONS = Object.freeze({
  "tofu-bowl": { name: "Tofu & roasted vegetable bowl", src: "/food/tofu.png" },
  "tomato-pasta": { name: "Cheesy Tomato Pasta", src: "/food/pasta.png" },
  "chickpea-bowl": { name: "Crispy Chickpea Bowl", src: "/food/chickpeas.png" },
});

export function mealImage(meal) {
  const assigned = MEAL_ILLUSTRATIONS[meal?.id];
  return assigned && assigned.name === meal.name && !meal.suggestion &&
    meal.nutrition?.kind === "illustrative_demo"
    ? assigned.src
    : MEAL_IMAGE_PLACEHOLDER;
}

// Keep existing callers compatible without performing remote image searches.
export async function resolveMealImage(meal) { return mealImage(meal); }
export function prefetchMealImages(meals) { return (meals || []).map(mealImage); }
export function taggedMealImage() { return MEAL_IMAGE_PLACEHOLDER; }
export const photoFor = mealImage;
