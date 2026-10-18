import { sourcedCookCandidate, sameSourceCandidate } from "./foodFacts.js";
import { config, requireCapability } from "./config.js";
import { assertMealAction, validateInputs } from "./engine.js";
import { mealsFor, addGeneratedMeals, reviewGeneratedMeal, validateGeneratedMeal } from "./generatedMeals.js";
import { rememberMeal, rememberSuggestions } from "../data/suggestions.js";
import { normalizeCalendarState, validateEvent, scheduleMealsForDay, localInstant } from "./calendar.js";

/** Pin a chosen meal in the UI lookup cache so plan banners keep resolving.
 *  Persistence comes from the reviewed recipe snapshots in state.generatedMeals. */
function withKnownMeal(state, meal) {
  if (meal?.id) rememberMeal(meal);
  return state;
}

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
      tastes: [],
      dislikes: "",
      phone: "",
      reminderFrom: "",
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
      onward: 0,
      buffer: 0,
      service: 10,
    },
    pantry: {},
    plan: null,
    previousPlan: null,
    generatedMeals: [],
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
  const byId = mealsFor(state);
  if (action.type === "captureSourcedMeal") {
    const base=byId[action.meal?.sourceRecipeId];
    if(!base) throw new Error("The recipe source is no longer available.");
    const snapshot=sourcedCookCandidate(base);
    if(!sameSourceCandidate(action.meal,snapshot)) throw new Error("Meal facts changed. Refresh and choose again.");
    validateGeneratedMeal(snapshot);
    if((state.generatedMeals??[]).some(m=>m.id===snapshot.id)) return state;
    if((state.generatedMeals??[]).length>=150) throw new Error("Export your saved recipes before adding more.");
    return {...state,generatedMeals:[...(state.generatedMeals??[]),snapshot]};
  }
  if (action.type === "addGeneratedMeals") {
    const pantry={...state.pantry,...action.pantry};
    validateInputs(state.profile,state.context,pantry);
    return {...state,pantry,groceryList:Array.isArray(action.groceryList)?action.groceryList:state.groceryList,generatedMeals:addGeneratedMeals(state,action.meals)};
  }
  if (action.type === "reviewGeneratedMeal") {
    const draft=(state.generatedMeals??[]).find(m=>m.id===action.mealId);
    if (!draft) throw new Error("This recipe draft no longer exists.");
    const meal=reviewGeneratedMeal(draft,action.review,state.profile);
    const pantry={...state.pantry};
    if (!action.pantry || typeof action.pantry!=='object' || Array.isArray(action.pantry) || Object.keys(action.pantry).some(k=>!meal.ingredients.some(i=>i.name===k))) throw new Error("Confirm only the ingredients in this recipe.");
    Object.assign(pantry,action.pantry);
    validateInputs(state.profile,state.context,pantry);
    return {...state,pantry,generatedMeals:state.generatedMeals.map(m=>m.id===meal.id?meal:m)};
  }
  if (action.type === "saveEvent") {
    requireCapability("calendarView", c);
    // Manual entries default to meal slots — classes/workouts come from calendar import.
    // Existing local tasks keep their kind so they can still be checked off.
    const event = {
      ...action.event,
      kind: action.event?.kind === "task" ? "task" : "meal",
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
  if (action.type === "setEventMealAvailability") {
    requireCapability("calendarView", c);
    if (!state.events.some(e=>e.id===action.id) || (action.busy!==null && typeof action.busy!=="boolean")) throw new Error("Choose an existing event and its meal-planning availability.");
    return {...state,events:state.events.map(event=>{
      if(event.id!==action.id)return event;
      const updated={...event};
      if(action.busy===null)delete updated.mealBusyOverride;
      else updated.mealBusyOverride=action.busy;
      return updated;
    })};
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
      .map((e) => {
        const previous=state.events.find(old=>old.id===e.id && old.source===action.source);
        return {...e,source:action.source,readOnly:true,...(typeof previous?.mealBusyOverride==="boolean"?{mealBusyOverride:previous.mealBusyOverride}:{})};
      });
    if (new Set(events.map((e) => e.id)).size !== events.length)
      throw new Error("Duplicate calendar event identifiers.");
    return {
      ...state,
      events: [...state.events.filter((e) => e.source === "manual"), ...events],
      calendar: {
        source: action.source,
        ...(action.provider ? {provider:action.provider} : {}),
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
    const { id, before } = state.logUndo;
    return {
      ...state,
      logs: [
        ...state.logs.filter((l) => l.id !== id),
        ...(before ? [before] : []),
      ],
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
      confirmedAt: action.confirmedAt || state.logs.find(l=>l.id===action.id)?.confirmedAt || new Date().toISOString(),
    };
    return {
      ...state,
      logs: [...state.logs.filter((item) => item.id !== log.id), log],
      logUndo: {
        id: log.id,
        before: state.logs.find((l) => l.id === log.id) ?? null,
      },
    };
  }
  if (action.type === "removeLog") {
    requireCapability("mealLogging", c);
    if (!state.logs.some((log) => log.id === action.id))
      throw new Error("This log no longer exists.");
    return {
      ...state,
      logs: state.logs.filter((log) => log.id !== action.id),
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
    const check=assertMealAction(meal,{...state,context:{...state.context,date:slot.date,start:slot.start,available:slot.available??slot.duration,commitmentTime:slot.commitmentTime??state.context.commitmentTime}},c);
    const filledPlan = {
      ...slot,
      mealId,
      duration:check.duration,
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
  state.context = {onward:0, buffer:0, ...state.context};
  state.generatedMeals ??= [];
  if (!Array.isArray(state.generatedMeals) || state.generatedMeals.length>150) throw new Error("Invalid saved recipe data.");
  state.generatedMeals.forEach(validateGeneratedMeal);
  if (new Set(state.generatedMeals.map(m=>m.id)).size!==state.generatedMeals.length) throw new Error("Duplicate saved recipe identifiers.");
  const byId=mealsFor(state);
  if (
    state.version !== 1 ||
    !Array.isArray(state.logs) ||
    !Array.isArray(state.actions)
  )
    throw new Error("Unsupported saved data. Export or reset this demo.");
  
  // Normalize time format in context
  if (state.context.start && !/^\d{2}:\d{2}$/.test(state.context.start)) {
    const match = state.context.start.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2];
      const period = match[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      state.context.start = `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
  }
  if (state.context.commitmentTime && !/^\d{2}:\d{2}$/.test(state.context.commitmentTime)) {
    const match = state.context.commitmentTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2];
      const period = match[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      state.context.commitmentTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
  }
  state = {
    ...state,
    profile: {
      ...state.profile,
      cuisines: Array.isArray(state.profile?.cuisines) ? state.profile.cuisines : [],
    },
  };
  validateInputs(state.profile, state.context, state.pantry);

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
  if (state.plan && !state.plan.openSlot && !byId[state.plan.mealId]) state = { ...state, plan: null };
  if (state.previousPlan && !state.previousPlan.openSlot && !byId[state.previousPlan.mealId])
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
