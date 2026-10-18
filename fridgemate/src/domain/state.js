import { config, requireCapability } from "./config.js";
import { assertMealAction, validateInputs } from "./engine.js";
import { byId } from "../data/suggestions.js";
import { normalizeCalendarState, validateEvent } from "./calendar.js";

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: config.product.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
      onward: 5,
      buffer: config.timing.defaultBufferMinutes,
      service: 10,
    },
    pantry: {
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
    },
    plan: null,
    previousPlan: null,
    logs: [],
    actions: [],
    events: [],
    mealPlans: [],
    calendar: { source: "manual", connected: false, lastSync: null },
    planUndo: null,
    logUndo: null,
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
    validateEvent(action.event);
    const existing = state.events.find((e) => e.id === action.event.id);
    if (existing?.readOnly || action.event.source !== "manual")
      throw new Error(
        "Imported events are read-only. Edit them in Apple Calendar, then refresh.",
      );
    return {
      ...state,
      events: [
        ...state.events.filter((e) => e.id !== action.event.id),
        { ...action.event, readOnly: false },
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
      duration: check.duration,
    };
    const before = state.mealPlans.find((p) => p.id === plan.id) ?? null;
    return {
      ...state,
      previousPlan: before,
      plan,
      mealPlans: [...state.mealPlans.filter((p) => p.id !== plan.id), plan],
      planUndo: { slotId: plan.id, before, after: plan },
    };
  }
  if (action.type === "undo") {
    if (state.planUndo) {
      const { slotId, before } = state.planUndo;
      if (before) assertMealAction(byId[before.mealId], state, c);
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
    if (state.previousPlan)
      assertMealAction(byId[state.previousPlan.mealId], state, c);
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
  
  validateInputs(state.profile, state.context, state.pantry);
  if (!Array.isArray(state.events) || !Array.isArray(state.mealPlans))
    throw new Error("Invalid saved calendar.");
  for (const plan of [
    state.plan,
    state.previousPlan,
    ...state.mealPlans,
  ].filter(Boolean)) {
    if (
      !byId[plan.mealId] ||
      !Number.isFinite(plan.duration) ||
      plan.duration < 0 ||
      typeof plan.date !== "string" ||
      typeof plan.start !== "string"
    )
      throw new Error("Invalid saved meal plan.");
    portion(plan.servings);
  }
  for (const log of state.logs) {
    if (
      !byId[log.mealId] ||
      typeof log.id !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(log.date)
    )
      throw new Error("Invalid saved meal log.");
    portion(log.servings);
  }
  if (new Set(state.logs.map((log) => log.id)).size !== state.logs.length)
    throw new Error("Duplicate saved meal records.");
  state.events.forEach(validateEvent);
  if (
    new Set(state.events.map((e) => e.id)).size !== state.events.length ||
    new Set(state.mealPlans.map((p) => p.id)).size !== state.mealPlans.length
  )
    throw new Error("Duplicate scheduled activity identifiers.");
  for (const plan of state.mealPlans)
    if (
      !byId[plan.mealId] ||
      !plan.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.start) ||
      !Number.isFinite(plan.duration) ||
      plan.duration <= 0
    )
      throw new Error("Invalid scheduled meal.");
  return state;
}
