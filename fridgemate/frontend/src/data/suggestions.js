import { byId as catalogById } from "./catalog.js";

const extras = Object.create(null);
const pinned = new Set();

/** Keep Gemini (or other) suggestion meals resolvable for plan/choose.
 *  Pinned meals (chosen into My Plan) survive suggestion refreshes. */
export function rememberSuggestions(meals) {
  for (const key of Object.keys(extras)) {
    if (!pinned.has(key)) delete extras[key];
  }
  for (const meal of meals || []) {
    if (meal?.id) extras[meal.id] = meal;
  }
}

/** Pin a single chosen meal so plan banners keep working after choose. */
export function rememberMeal(meal) {
  if (!meal?.id) return;
  extras[meal.id] = meal;
  pinned.add(meal.id);
}

export function clearSuggestions({ keepPinned = false } = {}) {
  for (const key of Object.keys(extras)) {
    if (keepPinned && pinned.has(key)) continue;
    delete extras[key];
  }
  if (!keepPinned) pinned.clear();
}

export function mealById(id) {
  return catalogById[id] ?? extras[id] ?? null;
}

export function suggestedMeals() {
  return Object.values(extras);
}

/** Same bracket access as catalog byId, plus live Gemini suggestions. */
export const byId = new Proxy(catalogById, {
  get(target, prop, receiver) {
    if (typeof prop === "symbol" || prop in target)
      return Reflect.get(target, prop, receiver);
    return extras[prop];
  },
  has(target, prop) {
    return prop in target || Object.prototype.hasOwnProperty.call(extras, prop);
  },
});
