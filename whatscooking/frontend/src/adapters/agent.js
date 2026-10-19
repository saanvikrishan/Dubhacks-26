import {transition, today} from '../domain/state.js';
import {mealsFor} from '../domain/generatedMeals.js';
import {foodPreferences, withGoal} from '../domain/preferences.js';
import {addDays, blocksMealPlanning, dayKey, eventsForDay, localInstant, timeKey} from '../domain/calendar.js';
import {contextForWindow} from '../domain/mealWindow.js';
import {NO_COMMITMENT, openEnded} from '../domain/engine.js';
import {getUserId} from './mealFeedback.js';
import {storageKeys, readStored} from '../domain/branding.js';

/**
 * The assistant agent's browser side. The backend returns tool calls; here each one becomes the same
 * actions the app's own buttons dispatch, checked step by step on a copy of the state (transition),
 * so invalid or unsafe changes never land. Nothing here bypasses domain validation.
 */

const WEEKDAY = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
const SCREENS = {today: 'Today', meal_plan: 'My Meal Plan', lets_eat: "Let's eat", grocery_list: 'Grocery list'};
const NOTES_KEY = storageKeys.notes;
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const clock = (iso) => timeKey(iso);
const lower = (s) => String(s).trim().toLowerCase();
const listOf = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nice = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});
const and = (list) => list.join(', ');
const GOAL_WORDS = {muscle: 'build muscle', lean: 'lose weight', healthy: 'eat healthier', energy: 'fuel workouts', budget: 'save money', easy: 'just feed me'};
// How each preference change reads in the chat's list of what changed.
const PREFERENCE_WORDS = {
  diet: (v) => `diet set to ${v}`, goal: (v) => `goal: ${GOAL_WORDS[v] ?? v}`, favorite_food: (v) => `favorite food: ${v}`, budget: (v) => v === null ? "no budget limit" : `budget $${v} per meal`,
  cooking: (v) => (v ? 'can cook' : 'no kitchen'),
  allergies_add: (v) => `added ${and(v)} allerg${v.length > 1 ? 'ies' : 'y'}`, allergies_remove: (v) => `removed ${and(v)} allerg${v.length > 1 ? 'ies' : 'y'}`,
  cuisines_add: (v) => `likes ${and(v)} food`, cuisines_remove: (v) => `no longer prefers ${and(v)} food`,
  avoid_cuisines_add: (v) => `avoids ${and(v)} food`, avoid_cuisines_remove: (v) => `no longer avoids ${and(v)} food`,
  tastes_add: (v) => `likes ${and(v)} flavors`, tastes_remove: (v) => `no longer prefers ${and(v)} flavors`,
  dislikes_add: (v) => `won't get ${and(v)}`, dislikes_remove: (v) => `${and(v)} allowed again`,
  equipment_add: (v) => `has ${and(v)}`, equipment_remove: (v) => `no ${and(v)}`,
};

/** Compact, bounded view of the app for the model: what it needs to act, with ids it may use. */
export function buildSnapshot(state, {screen = 'Today', mode = 'cook', days = 7} = {}) {
  const start = state.context?.date ?? today();
  const until = addDays(start, days);
  const meals = mealsFor(state);
  const inRange = (iso) => dayKey(iso) >= start && dayKey(iso) <= until;
  return {
    screen, mode,
    profile: {...foodPreferences(state.profile), diet: state.profile.diet, allergies: state.profile.exclusions,
      budget: state.profile.budget, cooking: state.profile.cooking, equipment: state.profile.equipment, goals: state.profile.goals},
    nextMeal: {date: state.context.date, start: state.context.start,
      freeUntil: openEnded(state.context) ? null : {time: state.context.commitmentTime, event: state.context.commitment}},
    events: (state.events ?? []).filter((e) => inRange(e.start)).slice(0, 60).map((e) => ({id: e.id, title: e.title,
      date: dayKey(e.start), start: clock(e.start), end: clock(e.end), kind: e.kind, busy: e.busy,
      blocksMeals: e.mealBusyOverride ?? null, editable: !e.readOnly})),
    plannedMeals: (state.mealPlans ?? []).filter((p) => p.date >= start && p.date <= until).slice(0, 40).map((p) => ({id: p.id,
      date: p.date, start: p.start, meal: p.mealId ? meals[p.mealId]?.name ?? p.mealId : 'open slot'})),
    groceryList: (state.shoppingList ?? []).map((i) => ({name: i.name, qty: i.qty, checked: i.checked})),
    pantryGrams: state.pantry,
    recentLogs: (state.logs ?? []).slice(-6).map((l) => ({date: l.date, meal: meals[l.mealId]?.name ?? l.mealId, servings: l.servings})),
    // Sample demo venues are not real dishes, so the assistant never plans or logs them.
    meals: Object.values(meals).filter((m) => m?.id && !m.legacyHistory && m.nutrition?.kind !== 'illustrative_demo').slice(0, 40).map((m) => ({id: m.id, name: m.name, mode: m.mode,
      ...(m.mode === 'cook' ? {ready: (m.ingredients ?? []).every((i) => (state.pantry?.[lower(i.name)] ?? 0) >= (i.grams ?? 0))} : {})})),
  };
}

export async function askAgent({message, history = [], state, ui, preview = false, fetchImpl = globalThis.fetch, signal}) {
  const now = new Date();
  const response = await fetchImpl('/api/assistant/agent', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
    body: JSON.stringify({message, history: history.slice(-8), snapshot: buildSnapshot(state, ui), user: getUserId(), preview,
      now: `${today()}T${now.toTimeString().slice(0, 5)} ${now.toLocaleDateString('en-US', {weekday: 'long'})}`})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The assistant could not answer right now.');
  return data;
}

function occurrences(args) {
  if (!args.repeat_weekdays?.length) return [args.date];
  const days = new Set(args.repeat_weekdays.map((d) => WEEKDAY[d]));
  const last = args.repeat_until ?? addDays(args.date, 55);
  const out = [];
  for (let d = args.date; d <= last && out.length < 40; d = addDays(d, 1))
    if (days.has(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d);
  return out;
}

function mergeProfile(profile, a) {
  if (a.goal) profile = withGoal(profile, a.goal);
  const edit = (list, add = [], remove = []) => [...new Set([...(list ?? []).filter((x) => !remove.includes(x)), ...add])];
  const dislikes = listOf(profile.dislikes).filter((d) => !(a.dislikes_remove ?? []).map(lower).includes(lower(d)));
  return {...profile,
    ...(a.diet ? {diet: a.diet} : {}),
    exclusions: edit(profile.exclusions, a.allergies_add, a.allergies_remove),
    cuisines: edit(profile.cuisines, a.cuisines_add, a.cuisines_remove),
    avoidCuisines: edit(profile.avoidCuisines, a.avoid_cuisines_add, a.avoid_cuisines_remove),
    tastes: edit(profile.tastes, a.tastes_add, a.tastes_remove),
    equipment: edit(profile.equipment, a.equipment_add, a.equipment_remove),
    ...(a.favorite_food !== undefined ? {preferred: a.favorite_food} : {}),
    dislikes: [...new Set([...dislikes, ...(a.dislikes_add ?? [])])].join(', ').slice(0, 160),
    ...(a.budget !== undefined ? {budget: a.budget} : {}),
    ...(a.cooking !== undefined ? {cooking: a.cooking} : {})};
}

/** A meal at `start`: free until the next busy event that day, or with no time limit when nothing follows. */
function mealAt(s, date, start) {
  const from = Date.parse(localInstant(date, start));
  const next = eventsForDay(s.events ?? [], date).find((e) => blocksMealPlanning(e) && !e.completed && e.kind !== 'task' && Date.parse(e.start) > from);
  const until = next ? timeKey(next.start) : '23:59';
  return {...contextForWindow(s.context, date, start, until), commitment: next ? next.title : NO_COMMITMENT, manuallySet: false};
}

function changedList(list, a) {
  const named = (names) => new Set((names ?? []).map(lower));
  const remove = named(a.remove), check = named(a.check), uncheck = named(a.uncheck);
  const kept = (list ?? []).filter((i) => !remove.has(lower(i.name))).map((i) => ({...i,
    checked: check.has(lower(i.name)) ? true : uncheck.has(lower(i.name)) ? false : i.checked}));
  for (const item of a.add ?? []) if (!kept.some((i) => lower(i.name) === lower(item.name))) kept.push({id: uid(), name: item.name, qty: item.qty ?? '', checked: false});
  return kept;
}

/** One tool call -> {actions, effects, summary, confirm}. Reads the running state so steps build on each other. */
function translate(tool, a, s) {
  const meals = mealsFor(s);
  switch (tool) {
    case 'add_event': {
      const dates = occurrences(a);
      return {actions: dates.map((date) => ({type: 'saveEvent', event: {id: `agent-${uid()}`, title: a.title, start: localInstant(date, a.start),
        end: localInstant(date, a.end), kind: a.kind ?? 'event', location: a.location ?? '', source: 'manual', busy: a.busy ?? true, readOnly: false, origin: 'assistant'}})),
        summary: `Added ${a.title} (${a.repeat_weekdays?.length ? `${a.repeat_weekdays.join('/')} ` : `${nice(a.date)}, `}${a.start}–${a.end}${dates.length > 1 ? `, ${dates.length} times` : ''})`};
    }
    case 'update_event': {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) throw new Error("That event isn't on your calendar.");
      if (e.readOnly) throw new Error(`"${e.title}" comes from your imported calendar; change it there.`);
      const date = a.date ?? dayKey(e.start);
      return {actions: [{type: 'saveEvent', event: {...e, title: a.title ?? e.title, start: localInstant(date, a.start ?? clock(e.start)),
        end: localInstant(date, a.end ?? clock(e.end)), busy: a.busy ?? e.busy, origin: 'assistant'}}], summary: `Updated ${a.title ?? e.title}`};
    }
    case 'delete_event': {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) throw new Error("That event isn't on your calendar.");
      return {actions: [{type: 'deleteEvent', id: a.id}], summary: `Removed ${e.title} (${nice(dayKey(e.start))})`, deletes: 1};
    }
    case 'set_event_blocks_meals': {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) throw new Error("That event isn't on your calendar.");
      return {actions: [{type: 'setEventMealAvailability', id: a.id, busy: a.blocks_meals}],
        summary: `${e.title} ${a.blocks_meals ? 'now blocks' : 'no longer blocks'} meal planning`};
    }
    case 'update_preferences': {
      const profile = mergeProfile(s.profile, a);
      const parts = Object.entries(a).filter(([k, v]) => PREFERENCE_WORDS[k] && v !== undefined && v !== null && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => PREFERENCE_WORDS[k](v));
      return {actions: [{type: 'updateProfile', profile}], summary: `Preferences: ${parts.join('; ') || 'saved'}`,
        confirm: a.allergies_remove?.length ? `remove the ${a.allergies_remove.join(', ')} allerg${a.allergies_remove.length > 1 ? 'ies' : 'y'}` : null};
    }
    case 'set_nutrition_goal': {
      const goal = {nutrient: a.nutrient, mode: a.mode, value: a.value, ...(a.mode === 'target_range' ? {upper: a.upper} : {})};
      return {actions: [{type: 'updateProfile', profile: {...s.profile, goals: [...(s.profile.goals ?? []).filter((g) => g.nutrient !== a.nutrient), goal]}}],
        summary: `Set a daily ${a.nutrient.replace(/_(g|mg|mcg|kcal)$/, '')} goal`};
    }
    case 'remove_nutrition_goal':
      return {actions: [{type: 'updateProfile', profile: {...s.profile, goals: (s.profile.goals ?? []).filter((g) => g.nutrient !== a.nutrient)}}],
        summary: `Removed the ${a.nutrient.replace(/_(g|mg|mcg|kcal)$/, '')} goal`};
    case 'set_meal_window': {
      // An explicit end or length is the user's own window; otherwise only the calendar limits it.
      const date = a.date ?? s.context.date, start = a.start ?? s.context.start;
      const end = a.commitment_time ?? (a.available_minutes ? timeKey(Date.parse(localInstant(date, start)) + a.available_minutes * 60000) : null);
      const context = end ? contextForWindow(s.context, date, start, end) : mealAt(s, date, start);
      return {actions: [{type: 'updateContext', context}],
        summary: `Meal window set to ${nice(context.date)}, ${context.start}${openEnded(context) ? ' (no time limit)' : `–${context.commitmentTime}`}`};
    }
    case 'update_pantry': {
      const pantry = {...s.pantry};
      for (const name of a.remove ?? []) delete pantry[lower(name)];
      for (const item of a.set ?? []) pantry[lower(item.name)] = item.grams;
      const emptied = Object.keys(s.pantry ?? {}).length > 0 && Object.keys(pantry).length === 0;
      return {actions: [{type: 'updatePantry', pantry}], summary: 'Updated your groceries at home', confirm: emptied ? 'empty your saved groceries' : null};
    }
    case 'update_grocery_list': {
      const shoppingList = changedList(s.shoppingList, a);
      const bits = [a.add?.length && `added ${a.add.map((i) => i.name).join(', ')}`, a.remove?.length && `removed ${a.remove.join(', ')}`,
        a.check?.length && `checked off ${a.check.join(', ')}`].filter(Boolean);
      const emptied = (s.shoppingList ?? []).length > 1 && shoppingList.length === 0;
      return {actions: [{type: 'updateShoppingList', shoppingList}], summary: `Grocery list: ${bits.join('; ') || 'updated'}`,
        confirm: emptied ? 'clear your whole grocery list' : null};
    }
    case 'plan_meal': {
      const meal = meals[a.meal_id];
      if (!meal) throw new Error("I couldn't find that meal.");
      const move = a.date || a.start ? [{type: 'updateContext', context: mealAt(s, a.date ?? s.context.date, a.start ?? s.context.start)}] : [];
      return {actions: [...move, {type: 'choose', mealId: meal.id}], summary: `Planned ${meal.name} for ${nice(a.date ?? s.context.date)}, ${a.start ?? s.context.start}`};
    }
    case 'remove_meal_plan': {
      const plan = s.mealPlans.find((p) => p.id === a.id);
      if (!plan) throw new Error("That meal isn't in your plan.");
      return {actions: [{type: 'removeMealPlan', id: a.id}], summary: `Removed ${meals[plan.mealId]?.name ?? 'the meal'} from ${nice(plan.date)}`};
    }
    case 'schedule_day_meals':
      return {actions: [{type: 'scheduleDayMeals', date: a.date}], summary: `Planned meal slots around your schedule on ${nice(a.date)}`};
    case 'log_meal': {
      const meal = meals[a.meal_id];
      if (!meal) throw new Error("I couldn't find that meal.");
      return {actions: [{type: 'log', id: uid(), mealId: meal.id, servings: a.servings ?? 1, date: a.date ?? today(), confirmedAt: new Date().toISOString()}],
        summary: `Logged ${a.servings ?? 1} × ${meal.name}`};
    }
    case 'add_note':
      return {actions: [], effects: [{type: 'note', date: a.date ?? s.context.date, text: a.text}], summary: `Added a note for ${nice(a.date ?? s.context.date)}: “${a.text}”`};
    case 'remember':
      return {actions: [], summary: a.saved ? `I'll remember: ${a.fact}` : `Noted for now: ${a.fact}`};
    case 'go_to':
      return {actions: [], effects: [{type: 'go', tab: SCREENS[a.screen], mode: a.mode === 'school' ? 'eatOut' : a.mode}], summary: `Opened ${SCREENS[a.screen]}`};
    case 'suggest_meals':
      return {actions: [], effects: [{type: 'suggest', ingredients: a.ingredients ?? []}], summary: 'Finding meal ideas…'};
    case 'show_meal': {
      const meal = meals[a.meal_id];
      if (!meal) throw new Error("I couldn't find that meal.");
      return {actions: [], effects: [{type: 'show', meal}], summary: `Opened ${meal.name}`};
    }
    case 'undo_last':
      return {actions: [], effects: [{type: 'undo'}], summary: 'Undid my last changes'};
    default:
      throw new Error(`I can't do "${tool}" yet.`);
  }
}

/**
 * Turn the agent's tool calls into a checked plan. Every action is applied to a running copy with the
 * app's own `transition`; the first invalid step stops the whole turn and nothing is changed.
 */
export function planTurn(state, toolCalls) {
  let draft = state;
  const actions = [], effects = [], summaries = [], confirm = [];
  let deletes = 0;
  for (const {tool, args} of toolCalls ?? []) {
    let step;
    try {
      step = translate(tool, args ?? {}, draft);
      for (const action of step.actions) draft = transition(draft, action);
    } catch (error) {
      return {ok: false, error: error.message, failedTool: tool, summaries};
    }
    actions.push(...step.actions);
    effects.push(...(step.effects ?? []));
    summaries.push(step.summary);
    if (step.confirm) confirm.push(step.confirm);
    deletes += step.deletes ?? 0;
  }
  if (deletes >= 2) confirm.push(`delete ${deletes} calendar events`);
  return {ok: true, actions, effects, summaries, confirm, preview: draft};
}

/** Notes live in the existing per-day notes store; returns the previous text for Undo. */
export function writeNote(date, text, storage = globalThis.localStorage) {
  let map = {};
  try {map = JSON.parse(readStored(storage, NOTES_KEY) || '{}') || {};} catch { /* start fresh */ }
  const before = map[date] ?? '';
  map[date] = before ? `${before}\n${text}` : text;
  try {storage?.setItem(NOTES_KEY, JSON.stringify(map));} catch { /* storage unavailable */ }
  globalThis.dispatchEvent?.(new CustomEvent('whatscooking.ai-notes-changed', {detail: {date}}));
  return before;
}

export function restoreNote(date, text, storage = globalThis.localStorage) {
  let map = {};
  try {map = JSON.parse(readStored(storage, NOTES_KEY) || '{}') || {};} catch { /* start fresh */ }
  if (text) map[date] = text; else delete map[date];
  try {storage?.setItem(NOTES_KEY, JSON.stringify(map));} catch { /* storage unavailable */ }
  globalThis.dispatchEvent?.(new CustomEvent('whatscooking.ai-notes-changed', {detail: {date}}));
}
