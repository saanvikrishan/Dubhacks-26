import {addDays, blocksMealPlanning, eventsForDay, localInstant, nextMealWindow, timeKey} from './calendar.js';
import {resolveIngredientName} from './ingredientNames.js';

/**
 * Proactive suggestions, computed from the user's own data (no model calls, so they cost nothing).
 * Each nudge is {id, text, prompt}: `text` is shown as a chip; tapping sends `prompt` to the assistant.
 * Ids are stable for the situation, so a dismissed nudge does not come back.
 */
const MEALTIMES = [['lunch', '12:30'], ['dinner', '18:30']];

function plannedNear(state, date, time, minutes = 120) {
  const t = Date.parse(localInstant(date, time));
  return (state.mealPlans ?? []).some((p) => p.date === date && Math.abs(Date.parse(localInstant(p.date, p.start)) - t) <= minutes * 60000);
}

export function computeNudges(state, {now = new Date(), today, meals = {}} = {}) {
  const out = [];
  const day = today ?? state.context?.date;
  if (!day) return out;

  // 1. Free time today with no meal planned in it.
  // Same "next meal" as Let's eat: from now until the next busy event (no limit when there is none).
  const free = nextMealWindow(state.events ?? [], day, now, 1440, '00:00');
  const until = free && free.commitment !== 'No further commitment' ? free.commitmentTime : null;
  if (free && !plannedNear(state, day, free.start, 90))
    out.push({id: `free:${day}:${free.start}`, text: `You're free from ${free.start}${until ? ` until ${until}` : ''} with nothing planned — plan a meal?`,
      prompt: `Plan a meal for today at ${free.start}${until ? `; I have until ${until} (${free.commitment})` : ''}.`});

  // 2. A busy commitment over a usual meal time, today or tomorrow, with no meal around it.
  for (const date of [day, addDays(day, 1)]) {
    for (const [label, time] of MEALTIMES) {
      const t = Date.parse(localInstant(date, time));
      const clash = eventsForDay(state.events ?? [], date).find((e) => blocksMealPlanning(e) && !e.completed && e.kind !== 'task'
        && Date.parse(e.start) <= t && Date.parse(e.end) > t);
      if (clash && !plannedNear(state, date, time))
        out.push({id: `clash:${date}:${label}:${clash.id}`,
          text: `${clash.title} runs over ${label}${date === day ? '' : ' tomorrow'} (${timeKey(clash.start)}–${timeKey(clash.end)}) — fit ${label} around it?`,
          prompt: `Plan ${label} on ${date} around my ${clash.title} (${timeKey(clash.start)}–${timeKey(clash.end)}).`});
    }
  }

  // 3. Tomorrow's planned recipes need groceries that are neither at home nor on the list.
  const tomorrow = addDays(day, 1);
  const listed = new Set((state.shoppingList ?? []).map((i) => resolveIngredientName(i.name).key ?? i.name.toLowerCase()));
  const pantry = state.pantry ?? {};
  for (const plan of (state.mealPlans ?? []).filter((p) => p.date === tomorrow && p.mealId)) {
    const meal = meals[plan.mealId];
    if (meal?.mode !== 'cook') continue;
    const missing = (meal.ingredients ?? []).filter((i) => {
      const key = resolveIngredientName(i.name).key ?? i.name.toLowerCase();
      return (pantry[key] ?? pantry[i.name] ?? 0) < (i.grams ?? 0) && !listed.has(key);
    }).map((i) => i.name);
    if (missing.length)
      out.push({id: `groceries:${tomorrow}:${plan.mealId}`, text: `Tomorrow's ${meal.name} needs ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''} — add to your grocery list?`,
        prompt: `Add the missing ingredients for tomorrow's ${meal.name} to my grocery list: ${missing.join(', ')}.`});
  }

  // 4. Nothing known about tastes yet.
  const p = state.profile ?? {};
  if (!(p.cuisines?.length) && !(p.tastes?.length) && !String(p.preferred ?? '').trim())
    out.push({id: 'profile:setup', text: 'Tell me what you like to eat — it takes 20 seconds.', prompt: 'Help me set up my food preferences.'});

  return out.slice(0, 3);
}

const DISMISSED_KEY = 'daywell-dismissed-nudges';
export function dismissedNudges(storage = globalThis.localStorage) {
  try {return new Set(JSON.parse(storage?.getItem(DISMISSED_KEY) || '[]'));} catch {return new Set();}
}
export function dismissNudge(id, storage = globalThis.localStorage) {
  const all = [...dismissedNudges(storage), id].slice(-200);
  try {storage?.setItem(DISMISSED_KEY, JSON.stringify(all));} catch { /* storage unavailable */ }
}
