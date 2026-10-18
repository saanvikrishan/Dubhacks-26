import { byId as catalogById } from "./catalog.js";

const extras = Object.create(null);

/** UI lookup cache only. The state service uses its persisted recipe snapshots. */
export function rememberSuggestions(meals) {
  for (const meal of meals || []) {
    if (meal?.id) extras[meal.id] = meal;
  }
}

export function restoreSuggestions(meals) {
  clearSuggestions();
  rememberSuggestions(meals);
}

export function clearSuggestions() {
  for (const key of Object.keys(extras)) delete extras[key];
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
