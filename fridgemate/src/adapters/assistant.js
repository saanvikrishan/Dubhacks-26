import { config, requireCapability } from "../domain/config.js";
import { recommend } from "../domain/engine.js";
import { dailyNutrition } from "../domain/nutrition.js";
import { today } from "../domain/state.js";
import { uwDining, distanceMeters } from "../data/uwDining.js";
// Deliberately bounded commands; future AI interpreters return the same proposals.
// This adapter never mutates state or confirms eating on the user's behalf.
export function interpretFoodRequest(text, state, catalog, c = config) {
  requireCapability("foodAssistant", c);
  const q = text.trim().toLowerCase();
  const time = q.match(/^(?:i have\s+)?(\d+)\s*(?:minutes?|mins?)$/);
  if (time)
    return {
      message: `Apply a ${time[1]} minute window? Your selected meal stays until you choose a replacement.`,
      proposal: {
        type: "updateContext",
        context: { available: Number(time[1]) },
      },
    };
  const budget = q.match(
    /^(?:budget(?:\s+under)?|under|cap)\s+\$?(\d+(?:\.\d+)?)$/,
  );
  if (budget)
    return {
      message: `Set your strict per-meal cap to $${Number(budget[1]).toFixed(2)}?`,
      proposal: {
        type: "updateProfile",
        profile: { ...state.profile, budget: Number(budget[1]) },
      },
    };
  if (/nutrition|intake|eaten/.test(q)) {
    const summary = dailyNutrition(
      state.logs,
      Object.fromEntries(catalog.map((m) => [m.id, m])),
      today(),
    );
    return {
      message: summary.energy_kcal.total
        ? `Confirmed today: ${summary.energy_kcal.value ?? "unknown"} kcal from ${summary.energy_kcal.known}/${summary.energy_kcal.total} entries. Demo nutrition; planned meals are excluded.`
        : "No confirmed meals today. Use Log eaten on a meal and confirm the portion to add intake.",
    };
  }
  if (/plan|selected/.test(q))
    return {
      message: state.plan
        ? `Your selected meal is ${catalog.find((m) => m.id === state.plan.mealId)?.name}, at ${state.plan.start} on ${state.plan.date}. Selection is separate from consumption.`
        : "You have no selected meal. Open Food and choose one to save it.",
    };
  if (/eat out|school|restaurant|uw\b/.test(q))
    return {
      message: `Explore UW dining from the HUB: ${[...uwDining]
        .sort((a, b) => distanceMeters(a) - distanceMeters(b))
        .map((v) => `${v.name} (~${distanceMeters(v)} m straight-line)`)
        .join(
          "; ",
        )}. Open Food → Eat at school for official menus, hours and Maps. Exact dish nutrition and allergen suitability are not verified.`,
    };
  if (/^(?:compare meals|compare|cook|meals|meal|recommend|options)$/.test(q)) {
    const result = recommend(catalog, state, { mode: "cook" }, c);
    return {
      message: result.cards.length
        ? `These Cook recipes fit your current constraints: ${result.cards.map((r) => `${r.meal.name} (${r.duration} min, $${r.meal.cost.toFixed(2)})`).join("; ")}. Open Food to inspect and choose.`
        : "Nothing fits the current constraints. Open Food to see the reasons and adjust your inputs.",
    };
  }
  return {
    unrecognized: true,
    message:
      "I support simple food commands: “compare meals”, “I have 45 minutes”, “budget under $8”, “my plan”, or “nutrition today”. AI interpretation is not connected.",
  };
}

function changedNote(notes) {
  return notes.length ? ` ${notes.join(" ")}` : "";
}

/** Apply a Gemini constraint patch to a copy of state and describe recommend(). */
export function replyFromPatch(patch, state, catalog, c = config) {
  const merged = structuredClone(state);
  const profile = patch?.profile ?? {};
  const notes = [];
  if (profile.diet != null) {
    merged.profile.diet = profile.diet;
    notes.push(`Used ${profile.diet} for this reply only.`);
  }
  if (Array.isArray(profile.exclusions)) {
    merged.profile.exclusions = profile.exclusions;
    notes.push(
      `Excluded ${profile.exclusions.join(", ") || "nothing"} for this reply only.`,
    );
  }
  if (typeof profile.preferred === "string") {
    merged.profile.preferred = profile.preferred;
    notes.push(
      `Preferred ${profile.preferred || "no particular food"} for this reply only.`,
    );
  }
  if (typeof profile.budget === "number") {
    merged.profile.budget = profile.budget;
    notes.push(`Used a $${profile.budget} cap for this reply only.`);
  }
  if (typeof profile.cooking === "boolean") {
    merged.profile.cooking = profile.cooking;
    notes.push(
      profile.cooking
        ? "Cooking access on for this reply only."
        : "Cooking access off for this reply only.",
    );
  }
  if (Array.isArray(profile.equipment)) {
    merged.profile.equipment = profile.equipment;
    notes.push(
      `Used equipment ${profile.equipment.join(", ") || "none"} for this reply only.`,
    );
  }
  const available = patch?.context?.available;
  if (typeof available === "number") {
    merged.context.available = available;
    notes.push(`Used a ${available} minute window for this reply only.`);
  }
  if (patch?.pantry && typeof patch.pantry === "object") {
    const names = Object.keys(patch.pantry);
    if (names.length) {
      merged.pantry = { ...merged.pantry, ...patch.pantry };
      notes.push(`Used ${names.join(" and ")} for this reply only.`);
    }
  }
  const mode = patch?.mode || "cook";
  const result = recommend(
    catalog,
    merged,
    {
      mode,
      sort: patch?.sort || "catalog",
      passed: Array.isArray(patch?.passed) ? patch.passed : [],
    },
    c,
  );
  const label =
    mode === "cook"
      ? "Cook recipes"
      : mode === "eatOut"
        ? "eat-out options"
        : "meals";
  let message = result.cards.length
    ? `These ${label} fit your current constraints: ${result.cards
        .map(
          (r) =>
            `${r.meal.name} (${r.duration} min, $${r.meal.cost.toFixed(2)})`,
        )
        .join("; ")}. Open Food to inspect and choose.`
    : `Nothing fits the current constraints. ${result.evaluations
        .filter((r) => r.meal.mode === "cook" && !r.feasible)
        .map((r) => `${r.meal.name}: ${r.reasons.join(" ")}`)
        .join(" ")}`.trim();
  const unparsed = Array.isArray(patch?.unparsed) ? patch.unparsed : [];
  if (unparsed.length)
    message += ` Not in the catalog: ${unparsed.join(", ")}.`;
  message += changedNote(notes);
  return { message };
}
