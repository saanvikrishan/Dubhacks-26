import { config, requireCapability } from "./config.js";
import { assertMealAction, validateInputs, clockTime } from "./engine.js";
import { byId, rememberMeal, rememberSuggestions } from "../data/suggestions.js";

/** Keep a chosen Gemini meal in session state so plans still resolve after refresh. */
function withKnownMeal(state, meal) {
  if (!meal?.id) return state;
  rememberMeal(meal);
  const list = Array.isArray(state.geminiMeals) ? state.geminiMeals : [];
  if (list.some((m) => m?.id === meal.id)) return state;
  return { ...state, geminiMeals: [...list, meal] };
}
import { normalizeCalendarState, validateEvent, timeKey, dayKey, scheduleMealsForDay, localInstant } from "./calendar.js";

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: config.product.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
/** Stocked pantry for engine/unit tests only — UI starts empty. */
export const testPantry = {
  tofu: 300,
  "cooked brown rice": 500,
  "frozen vegetables": 300,
  "olive oil": 100,
  chickpeas: 400,
  yogurt: 150,
  cucumber: 200,
  eggs: 200,
  garlic: 50,
  "soy sauce": 100,
  "dry pasta": 200,
  tomatoes: 300,
  cheese: 100,
  bread: 160,
};

/** @returns {import('./contracts').AppState} */
export function createDemoState() {
  return {
    version: 1,
    profile: {
      diet: "vegetarian",
      exclusions: [],
      preferred: "tofu",
      budget: 10,
      cooking: true,
      equipment: ["stove", "pan", "pot"],
      goals: [],
      cuisines: [],
    },
    context: {
      date: today(),
      start: "12:00",
      available: 65,
      commitment: "Afternoon class",
      commitmentTime: "13:15",
      location: "Sample campus area",
      eating: config.timing.editableEatingAllowanceMinutes,
      cleanup: config.timing.editableCleanupAllowanceMinutes,
      service: 10,
    },
    pantry: {},
    plan: null,
    previousPlan: null,
    logs: [],
    actions: [],
    events: [],
    mealPlans: [],
    calendar: { source: "manual", connected: false, lastSync: null },
    planUndo: null,
    logUndo: null,
    geminiMeals: null,
    groceryList: [],
    shoppingList: [],
  };
}
function portion(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 10)
    throw new Error("Enter a portion above 0 and up to 10 servings.");
}
/** All mutation entry points, including Assistant, use this service boundary. */
function applyAction(state, action, c = config) {
  if (action.type === "saveEvent") {
    requireCapability("calendarView", c);
    // Manual entries are meal slots only — classes/workouts/tasks come from calendar import.
    const event = {
      ...action.event,
      kind: "meal",
      source: "manual",
      readOnly: false,
    };
    validateEvent(event);
    const existing = state.events.find((e) => e.id === event.id);
    if (existing?.readOnly || (existing && existing.source !== "manual"))
      throw new Error(
        "Imported events are read-only. Edit them in Apple Calendar, then refresh.",
      );
    return {
      ...state,
      events: [
        ...state.events.filter((e) => e.id !== event.id),
        event,
      ],
    };
  }
  if (action.type === "deleteEvent" || action.type === "toggleTask") {
    requireCapability("calendarView", c);
    const event = state.events.find((e) => e.id === action.id);
    if (!event || event.readOnly)
      throw new Error(
        "Imported events must be changed in their source calendar.",
      );
    if (action.type === "toggleTask" && event.kind !== "task")
      throw new Error("Only a task can be marked complete.");
    return {
      ...state,
      events:
        action.type === "deleteEvent"
          ? state.events.filter((e) => e.id !== action.id)
          : state.events.map((e) =>
              e.id === action.id ? { ...e, completed: !e.completed } : e,
            ),
    };
  }
  if (action.type === "importCalendar") {
    requireCapability("calendarImport", c);
    if (
      !["ics", "apple"].includes(action.source) ||
      !Array.isArray(action.events) ||
      action.events.length > 10000
    )
      throw new Error("Unsupported calendar import.");
    const events = action.events
      .map(validateEvent)
      .map((e) => ({ ...e, source: action.source, readOnly: true }));
    if (new Set(events.map((e) => e.id)).size !== events.length)
      throw new Error("Duplicate calendar event identifiers.");
    return {
      ...state,
      events: [...state.events.filter((e) => e.source === "manual"), ...events],
      calendar: {
        source: action.source,
        connected: true,
        lastSync: new Date().toISOString(),
        range: action.range ?? null,
      },
    };
  }
  if (action.type === "disconnectCalendar") {
    requireCapability("calendarImport", c);
    return {
      ...state,
      events: state.events.filter((e) => e.source === "manual"),
      calendar: { source: "manual", connected: false, lastSync: null },
    };
  }
  if (action.type === "removeMealPlan") {
    const before = state.mealPlans.find((p) => p.id === action.id);
    if (!before) throw new Error("This meal is no longer scheduled.");
    return {
      ...state,
      mealPlans: state.mealPlans.filter((p) => p.id !== action.id),
      plan: state.plan?.id === action.id ? null : state.plan,
      previousPlan: before,
      planUndo: { slotId: action.id, before, after: null },
    };
  }
  if (action.type === "undoLog") {
    requireCapability("mealLogging", c);
    if (!state.logUndo) throw new Error("There is no meal-log change to undo.");
    const { id, before, removedPlanId } = state.logUndo;
    return {
      ...state,
      logs: [
        ...state.logs.filter((l) => l.id !== id),
        ...(before ? [before] : []),
      ],
      // Remove the auto-created plan that was added when this log was created.
      mealPlans: removedPlanId
        ? state.mealPlans.filter((p) => p.id !== removedPlanId)
        : state.mealPlans,
      logUndo: null,
    };
  }
  if (action.type === "configure") {
    requireCapability("manualSchedule", c);
    if (
      JSON.stringify(action.profile.goals) !==
      JSON.stringify(state.profile.goals)
    )
      requireCapability("nutritionGoals", c);
    validateInputs(action.profile, action.context, state.pantry);
    return { ...state, profile: action.profile, context: action.context };
  }
  if (action.type === "updateContext") {
    requireCapability("manualSchedule", c);
    const context = { ...state.context, ...action.context };
    validateInputs(state.profile, context, state.pantry);
    return { ...state, context };
  }
  if (action.type === "updateProfile") {
    if (
      JSON.stringify(action.profile.goals) !==
      JSON.stringify(state.profile.goals)
    )
      requireCapability("nutritionGoals", c);
    validateInputs(action.profile, state.context, state.pantry);
    return { ...state, profile: action.profile };
  }
  if (action.type === "updatePantry") {
    requireCapability("manualPantry", c);
    validateInputs(state.profile, state.context, action.pantry);
    return { ...state, pantry: action.pantry };
  }
  if (action.type === "choose") {
    const meal = byId[action.mealId];
    if (!meal) throw new Error("This meal no longer exists.");
    const check = assertMealAction(meal, state, c);
    const plan = {
      id: `meal:${state.context.date}:${state.context.start}`,
      mealId: meal.id,
      servings: 1,
      date: state.context.date,
      start: state.context.start,
      // duration may be null if time info is incomplete — use available window as fallback
      duration: check.duration ?? state.context.available,
    };
    const before = state.mealPlans.find((p) => p.id === plan.id) ?? null;
    const next = withKnownMeal(state, meal);
    return {
      ...next,
      previousPlan: before,
      plan,
      mealPlans: [...next.mealPlans.filter((p) => p.id !== plan.id), plan],
      planUndo: { slotId: plan.id, before, after: plan },
    };
  }
  if (action.type === "undo") {
    if (state.planUndo) {
      const { slotId, before } = state.planUndo;
      // Always allow undo — no constraint check blocks restoring a previous choice
      return {
        ...state,
        plan: before,
        previousPlan: null,
        mealPlans: [
          ...state.mealPlans.filter((p) => p.id !== slotId),
          ...(before ? [before] : []),
        ],
        planUndo: null,
      };
    }
    return { ...state, plan: state.previousPlan, previousPlan: null };
  }
  if (action.type === "clearPlan")
    return {
      ...state,
      previousPlan: state.plan,
      planUndo: state.plan
        ? { slotId: state.plan.id, before: state.plan, after: null }
        : null,
      mealPlans: state.mealPlans.filter((p) => p.id !== state.plan?.id),
      plan: null,
    };
  if (action.type === "log" || action.type === "editLog") {
    requireCapability("mealLogging", c);
    portion(action.servings);
    if (
      !byId[action.mealId] ||
      !action.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(action.date) ||
      !Number.isFinite(Date.parse(action.date))
    )
      throw new Error("Invalid consumption record.");
    if (action.type === "log" && state.logs.some((log) => log.id === action.id))
      return state;
    if (
      action.type === "editLog" &&
      !state.logs.some((log) => log.id === action.id)
    )
      throw new Error("The log to edit no longer exists.");
    const log = {
      id: action.id,
      mealId: action.mealId,
      servings: action.servings,
      date: action.date,
      confirmedAt: action.confirmedAt || new Date().toISOString(),
    };
    // Derive a start time from confirmedAt so the meal appears on the timeline.
    const confirmedTs = new Date(log.confirmedAt);
    const logStart = timeKey(confirmedTs);
    const logPlanId = `log:${log.id}`;
    const meal = byId[action.mealId];
    const ctx = state.context;
    const duration =
      meal
        ? (meal.timing.prep ?? 0) +
          (meal.timing.cook ?? 0) +
          (ctx.eating ?? 20) +
          (meal.mode === "cook" ? (ctx.cleanup ?? 5) : (ctx.service ?? 10))
        : 30;
    // If a plan already covers this meal's date+start slot, leave mealPlans alone.
    const existingPlan = state.mealPlans.find(
      (p) => p.date === log.date && p.start === logStart,
    );
    const autoLogPlan =
      !existingPlan && meal
        ? {
            id: logPlanId,
            mealId: action.mealId,
            servings: action.servings,
            date: log.date,
            start: logStart,
            duration,
            fromLog: true,
          }
        : null;
    // For editLog, remove any previous auto-plan for this log id before re-adding.
    const filteredPlans = state.mealPlans.filter((p) => p.id !== logPlanId);
    return {
      ...state,
      logs: [...state.logs.filter((item) => item.id !== log.id), log],
      mealPlans: autoLogPlan
        ? [...filteredPlans, autoLogPlan]
        : filteredPlans.length !== state.mealPlans.length
          ? filteredPlans  // editLog: removed stale auto-plan, no new one needed (slot taken)
          : state.mealPlans,
      logUndo: {
        id: log.id,
        before: state.logs.find((l) => l.id === log.id) ?? null,
        removedPlanId: autoLogPlan ? logPlanId : null,
      },
    };
  }
  if (action.type === "removeLog") {
    requireCapability("mealLogging", c);
    if (!state.logs.some((log) => log.id === action.id))
      throw new Error("This log no longer exists.");
    // Also remove the auto-created plan for this log, if any.
    const autoPlanId = `log:${action.id}`;
    return {
      ...state,
      logs: state.logs.filter((log) => log.id !== action.id),
      mealPlans: state.mealPlans.filter((p) => p.id !== autoPlanId),
      logUndo: {
        id: action.id,
        before: state.logs.find((l) => l.id === action.id) ?? null,
      },
    };
  }
  if (action.type === "setGeminiMeals") {
    return {
      ...state,
      geminiMeals: Array.isArray(action.meals) ? action.meals : null,
      groceryList: Array.isArray(action.groceryList) ? action.groceryList : [],
    };
  }
  if (action.type === "clearGeminiMeals") {
    return { ...state, geminiMeals: null, groceryList: [] };
  }
  if (action.type === "updateShoppingList") {
    const list = Array.isArray(action.shoppingList)
      ? action.shoppingList
          .filter((item) => item && typeof item.name === "string" && item.name.trim())
          .map((item) => ({
            id:
              typeof item.id === "string" && item.id
                ? item.id
                : crypto.randomUUID(),
            name: item.name.trim().replace(/\s+/g, " ").slice(0, 80),
            qty:
              typeof item.qty === "string"
                ? item.qty.trim().slice(0, 40)
                : "",
            checked: Boolean(item.checked),
          }))
      : [];
    return { ...state, shoppingList: list };
  }
  if (action.type === "scheduleDayMeals") {
    // Auto-schedule breakfast / lunch / dinner slots for the given date,
    // respecting calendar busy events. Each slot gets a placeholder plan entry
    // so it appears in My Plan. The user still picks the actual meal in Food.
    const targetDate = action.date ?? state.context.date;
    // Include already-planned meals as busy blocks when finding free windows
    const mealBusyEvents = state.mealPlans
      .filter((p) => p.date === targetDate && !p.openSlot)
      .map((p) => {
        try {
          const s = Date.parse(localInstant(p.date, p.start));
          return {
            id: p.id, title: "Planned meal", busy: true, completed: false,
            kind: "meal",
            start: localInstant(p.date, p.start),
            end: new Date(s + p.duration * 60000).toISOString(),
          };
        } catch { return null; }
      })
      .filter(Boolean);
    const slots = scheduleMealsForDay(
      [...state.events, ...mealBusyEvents],
      targetDate,
    );
    if (!slots.length) return state; // no slots fit — no change
    const newPlans = slots
      .map((slot) => {
        const slotId = `slot:${targetDate}:${slot.start}:${slot.slot}`;
        // Don't overwrite an existing confirmed plan for this date+start
        if (state.mealPlans.some((p) => p.date === targetDate && p.start === slot.start)) return null;
        return {
          id: slotId,
          mealId: null,           // null = open slot, not yet chosen
          slotLabel: slot.slot,   // "breakfast" | "lunch" | "dinner"
          servings: 1,
          date: targetDate,
          start: slot.start,
          duration: slot.available,
          available: slot.available,
          commitment: slot.commitment,
          commitmentTime: slot.commitmentTime,
          openSlot: true,
        };
      })
      .filter(Boolean);
    if (!newPlans.length) return state;
    return {
      ...state,
      mealPlans: [...state.mealPlans, ...newPlans],
      scheduledSlots: {
        ...(state.scheduledSlots ?? {}),
        [targetDate]: slots.map((s) => s.slot),
      },
    };
  }
  if (action.type === "fillMealSlot") {
    // When a user picks a meal for an open slot (mealId: null),
    // replace it with a real plan entry.
    const { slotId, mealId } = action;
    const slot = state.mealPlans.find((p) => p.id === slotId && p.openSlot);
    if (!slot) throw new Error("This meal slot no longer exists.");
    const meal = byId[mealId];
    if (!meal) throw new Error("Meal not found.");
    const filledPlan = {
      ...slot,
      mealId,
      openSlot: false,
    };
    const next = withKnownMeal(state, meal);
    return {
      ...next,
      mealPlans: next.mealPlans.map((p) => (p.id === slotId ? filledPlan : p)),
    };
  }
  // No external operation is implemented. A flag cannot authorize one.
  requireCapability(action.type, c);
  throw new Error(`No action handler is implemented for ${action.type}.`);
}

export function transition(state, action, c = config) {
  state = normalizeCalendarState(state);
  const next = applyAction(state, action, c);
  if (next === state) return state;
  return {
    ...next,
    actions: [
      ...state.actions,
      {
        type: action.type,
        status: "completed_local",
        mealId: action.mealId ?? null,
        logId: action.id ?? null,
        beforePlan: state.plan,
        afterPlan: next.plan,
      },
    ].slice(-100),
  };
}

export function validateState(state) {
  state = normalizeCalendarState(state);

  // Hard structural check — genuinely corrupt data, cannot recover.
  if (
    state.version !== 1 ||
    !Array.isArray(state.logs) ||
    !Array.isArray(state.actions)
  )
    throw new Error("Unsupported saved data. Export or reset this demo.");

  const fresh = createDemoState();

  // ── Normalize 12-hour time strings to HH:MM ───────────────────────────────
  function normTime(value, fallback) {
    if (!value) return fallback;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
    const m = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return fallback;
    let h = parseInt(m[1]);
    const p = m[3].toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m[2]}`;
  }
  state = {
    ...state,
    context: {
      ...state.context,
      start: normTime(state.context.start, "12:00"),
      commitmentTime: normTime(state.context.commitmentTime, "23:59"),
    },
  };

  // ── Reset context if it's stale or invalid — preserve everything else ─────
  // (stale date, bad window, etc. should NOT wipe pantry/profile/logs/calendar)
  try {
    validateInputs(state.profile, state.context, state.pantry);
  } catch {
    state = { ...state, context: { ...fresh.context, date: today() } };
  }

  // ── Sanitize pantry: drop non-numeric / negative entries ─────────────────
  const cleanPantry = {};
  for (const [k, v] of Object.entries(state.pantry ?? {})) {
    const g = Number(v);
    if (Number.isFinite(g) && g >= 0) cleanPantry[k] = g;
  }
  state = { ...state, pantry: cleanPantry };

  // ── Ensure profile has all required arrays ────────────────────────────────
  state = {
    ...state,
    profile: {
      ...fresh.profile,
      ...state.profile,
      goals: Array.isArray(state.profile?.goals) ? state.profile.goals : [],
      exclusions: Array.isArray(state.profile?.exclusions) ? state.profile.exclusions : [],
      equipment: Array.isArray(state.profile?.equipment) ? state.profile.equipment : [],
      cuisines: Array.isArray(state.profile?.cuisines) ? state.profile.cuisines : [],
    },
  };

  // ── Carry through geminiMeals / groceryList (in-session, optional) ─────────
  if (!Array.isArray(state.groceryList)) state = { ...state, groceryList: [] };
  // geminiMeals can stay as-is (array or null); no deep validation needed

  if (!Array.isArray(state.shoppingList)) {
    state = { ...state, shoppingList: [] };
  } else {
    state = {
      ...state,
      shoppingList: state.shoppingList
        .filter((item) => item && typeof item.name === "string" && item.name.trim())
        .map((item) => ({
          id:
            typeof item.id === "string" && item.id
              ? item.id
              : crypto.randomUUID(),
          name: item.name.trim().replace(/\s+/g, " ").slice(0, 80),
          qty: typeof item.qty === "string" ? item.qty.trim().slice(0, 40) : "",
          checked: Boolean(item.checked),
        })),
    };
  }

  if (!Array.isArray(state.events) || !Array.isArray(state.mealPlans))
    throw new Error("Invalid saved calendar.");

  // Re-hydrate Gemini suggestion meals so plan.mealId resolves after reload.
  // Pin any meals already on the plan so a grocery refresh cannot wipe them.
  if (Array.isArray(state.geminiMeals) && state.geminiMeals.length) {
    rememberSuggestions(state.geminiMeals);
    const plannedIds = new Set(
      state.mealPlans.map((p) => p?.mealId).filter(Boolean),
    );
    for (const meal of state.geminiMeals) {
      if (meal?.id && plannedIds.has(meal.id)) rememberMeal(meal);
    }
  }

  // ── Filter bad meal plans instead of throwing ─────────────────────────────
  state = {
    ...state,
    mealPlans: state.mealPlans.filter((plan) => {
      if (!plan?.id) return false;
      if (typeof plan.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) return false;
      if (typeof plan.start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.start)) return false;
      // Open slots are placeholders (no meal yet) — keep them.
      if (plan.openSlot && !plan.mealId) {
        return Number.isFinite(plan.duration) && plan.duration > 0;
      }
      if (!byId[plan.mealId]) return false;
      if (!Number.isFinite(plan.duration) || plan.duration <= 0) return false;
      try { portion(plan.servings); return true; } catch { return false; }
    }),
  };

  // Deduplicate meal plans (keep last)
  const seenPlans = new Set();
  state = {
    ...state,
    mealPlans: [...state.mealPlans].reverse().filter((p) => {
      if (seenPlans.has(p.id)) return false;
      seenPlans.add(p.id);
      return true;
    }).reverse(),
  };

  // Drop plan/previousPlan if they reference a removed meal
  if (state.plan && !byId[state.plan?.mealId]) state = { ...state, plan: null };
  if (state.previousPlan && !byId[state.previousPlan?.mealId])
    state = { ...state, previousPlan: null };

  // ── Filter bad logs instead of throwing ──────────────────────────────────
  state = {
    ...state,
    logs: state.logs.filter((log) => {
      if (!byId[log.mealId] || typeof log.id !== "string") return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(log.date)) return false;
      try { portion(log.servings); return true; } catch { return false; }
    }),
  };

  // Deduplicate logs (keep last)
  const seenLogs = new Set();
  state = {
    ...state,
    logs: [...state.logs].reverse().filter((l) => {
      if (seenLogs.has(l.id)) return false;
      seenLogs.add(l.id);
      return true;
    }).reverse(),
  };

  // ── Drop invalid events instead of throwing ───────────────────────────────
  const goodEvents = [];
  for (const e of state.events) {
    try { goodEvents.push(validateEvent(e)); } catch { /* skip */ }
  }
  const seenEvents = new Set();
  state = {
    ...state,
    events: goodEvents.filter((e) => {
      if (seenEvents.has(e.id)) return false;
      seenEvents.add(e.id);
      return true;
    }),
  };

  return state;
}
