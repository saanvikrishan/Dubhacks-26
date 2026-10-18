import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState, transition, validateState} from '../src/domain/state.js';
import {addDays, blocksMealPlanning, dayKey} from '../src/domain/calendar.js';
import {askAgent, buildSnapshot, planTurn, restoreNote, writeNote} from '../src/adapters/agent.js';

const DAY = '2026-10-19';   // a Monday
const fresh = () => ({...createDemoState(), context: {...createDemoState().context, date: DAY}});
const apply = (state, actions) => actions.reduce((s, action) => transition(s, action), state);
const memoryStorage = () => {
  const data = {};
  return {getItem: (k) => data[k] ?? null, setItem: (k, v) => {data[k] = String(v);}};
};

test('one message can make several changes; they apply in order and Undo restores the exact state', () => {
  const before = fresh();
  const plan = planTurn(before, [
    {tool: 'update_preferences', args: {diet: 'vegan'}},
    {tool: 'update_grocery_list', args: {add: [{name: 'tofu'}, {name: 'spinach', qty: '1 bag'}]}},
    {tool: 'add_event', args: {title: 'Lab', date: DAY, start: '19:00', end: '21:00', kind: 'class'}},
  ]);
  assert.equal(plan.ok, true);
  assert.equal(plan.summaries.length, 3);
  assert.deepEqual(plan.confirm, []);
  const after = apply(before, plan.actions);
  assert.equal(after.profile.diet, 'vegan');
  assert.deepEqual(after.shoppingList.map((i) => [i.name, i.qty]), [['tofu', ''], ['spinach', '1 bag']]);
  assert.deepEqual(after.events.map((e) => [e.title, e.kind]), [['Lab', 'class']]);
  assert.deepEqual(after, plan.preview);
  // Undo puts every piece of user data back; the action log keeps a record of the undo itself.
  const restored = transition(after, {type: 'agentRestore', state: before});
  const original = validateState(structuredClone(before));
  assert.deepEqual({...restored, actions: original.actions}, original);
  assert.equal(restored.actions.at(-1).type, 'agentRestore');
});

test('a repeating class is added as class events that block meal planning', () => {
  const plan = planTurn(fresh(), [{tool: 'add_event', args: {title: 'Bio 101', date: DAY, start: '10:00', end: '11:00',
    kind: 'class', busy: true, repeat_weekdays: ['Tue', 'Thu'], repeat_until: addDays(DAY, 13)}}]);
  assert.equal(plan.ok, true);
  const events = apply(fresh(), plan.actions).events;
  assert.deepEqual(events.map((e) => dayKey(e.start)), ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
  assert.ok(events.every((e) => e.kind === 'class' && e.title === 'Bio 101' && blocksMealPlanning(e) && !e.readOnly));
  assert.match(plan.summaries[0], /Bio 101.*Tue\/Thu.*4 times/);
});

test('one invalid step blocks the whole turn and nothing changes', () => {
  const state = fresh();
  const plan = planTurn(state, [
    {tool: 'update_grocery_list', args: {add: [{name: 'eggs'}]}},
    {tool: 'plan_meal', args: {meal_id: 'tofu-bowl'}},   // no tofu at home: the app's own rule refuses it
  ]);
  assert.equal(plan.ok, false);
  assert.equal(plan.failedTool, 'plan_meal');
  assert.match(plan.error, /Not enough confirmed ingredients/);
  assert.equal(planTurn(state, [{tool: 'add_event', args: {title: 'Lab', date: DAY, start: '19:00', end: '18:00'}}]).ok, false);
  assert.equal(planTurn(state, [{tool: 'show_meal', args: {meal_id: 'made-up'}}]).ok, false);
  assert.equal(planTurn(state, [{tool: 'delete_everything', args: {}}]).ok, false);
  assert.deepEqual(state, fresh());
});

test('later steps build on earlier ones: stock the pantry, then plan the recipe', () => {
  const pantry = {tofu: 300, 'cooked brown rice': 300, 'frozen vegetables': 300, 'olive oil': 50};
  const plan = planTurn(fresh(), [
    {tool: 'update_pantry', args: {set: Object.entries(pantry).map(([name, grams]) => ({name, grams}))}},
    {tool: 'plan_meal', args: {meal_id: 'tofu-bowl', date: DAY, start: '18:30'}},
  ]);
  assert.equal(plan.ok, true, plan.error);
  const plans = plan.preview.mealPlans.filter((p) => p.mealId === 'tofu-bowl');
  assert.deepEqual(plans.map((p) => [p.date, p.start]), [[DAY, '18:30']]);
  // Time comes from the calendar: free until the evening lab, or no limit when nothing follows.
  assert.equal(plan.preview.context.commitment, 'No further commitment');
  const withLab = apply(fresh(), planTurn(fresh(), [{tool: 'add_event', args: {title: 'Lab', date: DAY, start: '19:00', end: '21:00', kind: 'class'}}]).actions);
  const moved = planTurn(withLab, [{tool: 'update_pantry', args: {set: Object.entries(pantry).map(([name, grams]) => ({name, grams}))}},
    {tool: 'plan_meal', args: {meal_id: 'tofu-bowl', date: DAY, start: '18:00'}}]);
  assert.deepEqual([moved.preview.context.start, moved.preview.context.commitmentTime, moved.preview.context.commitment], ['18:00', '19:00', 'Lab']);
  // The meal window can still be set: an explicit length is the user's own window; otherwise the calendar decides.
  const own = planTurn(fresh(), [{tool: 'set_meal_window', args: {date: DAY, start: '18:00', available_minutes: 30}}]).preview.context;
  assert.deepEqual([own.start, own.commitmentTime, own.manuallySet], ['18:00', '18:30', true]);
  const open = planTurn(withLab, [{tool: 'set_meal_window', args: {date: DAY, start: '17:00'}}]).preview.context;
  assert.deepEqual([open.commitmentTime, open.commitment], ['19:00', 'Lab']);
});

test('risky steps ask first: removing an allergy, deleting several events, emptying the list', () => {
  const state = {...fresh(), profile: {...fresh().profile, exclusions: ['peanut']},
    shoppingList: [{id: 'a', name: 'milk', qty: '', checked: false}, {id: 'b', name: 'eggs', qty: '', checked: false}]};
  assert.match(planTurn(state, [{tool: 'update_preferences', args: {allergies_remove: ['peanut']}}]).confirm[0], /peanut allergy/);
  assert.deepEqual(planTurn(state, [{tool: 'update_preferences', args: {allergies_add: ['sesame']}}]).confirm, []);
  assert.match(planTurn(state, [{tool: 'update_grocery_list', args: {remove: ['milk', 'eggs']}}]).confirm[0], /grocery list/);
  const withEvents = apply(state, planTurn(state, [{tool: 'add_event', args: {title: 'Gym', date: DAY, start: '07:00', end: '08:00',
    kind: 'workout', repeat_weekdays: ['Mon', 'Wed']}}]).actions);
  const ids = withEvents.events.slice(0, 2).map((e) => e.id);
  assert.deepEqual(planTurn(withEvents, [{tool: 'delete_event', args: {id: ids[0]}}]).confirm, []);
  assert.match(planTurn(withEvents, ids.map((id) => ({tool: 'delete_event', args: {id}}))).confirm[0], /delete 2 calendar events/);
});

test('preferences merge instead of replacing, and imported events stay read-only', () => {
  const state = {...fresh(), profile: {...fresh().profile, cuisines: ['Korean'], dislikes: 'olives'}};
  const plan = planTurn(state, [{tool: 'update_preferences', args: {cuisines_add: ['Thai'], dislikes_add: ['cilantro'], tastes_add: ['spicy']}},
    {tool: 'remember', args: {fact: 'Hates cilantro', saved: true}}]);
  const profile = plan.preview.profile;
  assert.deepEqual(profile.cuisines, ['Korean', 'Thai']);
  assert.equal(profile.dislikes, 'olives, cilantro');
  assert.deepEqual(profile.tastes, ['spicy']);
  assert.match(plan.summaries[1], /remember: Hates cilantro/);
  const imported = {...state, events: [{id: 'g1', title: 'Seminar', start: '2026-10-19T17:00:00.000Z', end: '2026-10-19T18:00:00.000Z',
    kind: 'event', source: 'google', busy: true, readOnly: true}]};
  const edit = planTurn(imported, [{tool: 'update_event', args: {id: 'g1', start: '09:00'}}]);
  assert.equal(edit.ok, false);
  assert.match(edit.error, /imported calendar/);
});

test('navigation, suggestions, notes and undo come back as effects for the app to run', () => {
  const plan = planTurn(fresh(), [
    {tool: 'go_to', args: {screen: 'lets_eat', mode: 'school'}},
    {tool: 'suggest_meals', args: {ingredients: ['tofu', 'kimchi']}},
    {tool: 'show_meal', args: {meal_id: 'tofu-bowl'}},
    {tool: 'add_note', args: {text: 'Buy rice', date: DAY}},
    {tool: 'undo_last', args: {}},
  ]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.effects.map((e) => e.type), ['go', 'suggest', 'show', 'note', 'undo']);
  assert.deepEqual(plan.effects[0], {type: 'go', tab: "Let's eat", mode: 'eatOut'});
  assert.deepEqual(plan.effects[1].ingredients, ['tofu', 'kimchi']);
  assert.equal(plan.effects[2].meal.id, 'tofu-bowl');
});

test('notes are added to the existing per-day notes and can be put back', () => {
  const storage = memoryStorage();
  assert.equal(writeNote(DAY, 'Buy rice', storage), '');
  const previous = writeNote(DAY, 'Call mom', storage);
  assert.equal(previous, 'Buy rice');
  assert.equal(JSON.parse(storage.getItem('whatscooking.ai.sidebar-notes.v1'))[DAY], 'Buy rice\nCall mom');
  restoreNote(DAY, previous, storage);
  assert.equal(JSON.parse(storage.getItem('whatscooking.ai.sidebar-notes.v1'))[DAY], 'Buy rice');
  restoreNote(DAY, '', storage);
  assert.deepEqual(JSON.parse(storage.getItem('whatscooking.ai.sidebar-notes.v1')), {});
});

test('the snapshot is compact and gives the model the ids it may use', () => {
  const state = apply(fresh(), planTurn(fresh(), [{tool: 'add_event', args: {title: 'Bio 101', date: DAY, start: '10:00', end: '11:00', kind: 'class'}}]).actions);
  const snap = buildSnapshot(state, {screen: 'Today', mode: 'cook'});
  assert.equal(snap.events[0].title, 'Bio 101');
  assert.equal(snap.events[0].editable, true);
  assert.ok(snap.events[0].id.startsWith('agent-'));
  assert.ok(snap.meals.length > 0 && snap.meals.length <= 40);
  assert.equal(snap.meals.find((m) => m.id === 'tofu-bowl').ready, false);
  assert.equal(snap.profile.diet, 'vegetarian');
  assert.ok(JSON.stringify(snap).length < 12000);
});

test('askAgent sends the message, recent history and snapshot, and surfaces server errors', async () => {
  let sent;
  const reply = await askAgent({message: 'add tofu', history: Array.from({length: 12}, (_, i) => ({role: 'user', text: `m${i}`})),
    state: fresh(), ui: {screen: 'Grocery list', mode: 'cook'}, preview: true,
    fetchImpl: async (url, options) => {sent = {url, body: JSON.parse(options.body)}; return {ok: true, json: async () => ({reply: 'Added.', actions: []})};}});
  assert.equal(reply.reply, 'Added.');
  assert.equal(sent.url, '/api/assistant/agent');
  assert.equal(sent.body.history.length, 8);
  assert.equal(sent.body.snapshot.screen, 'Grocery list');
  assert.equal(sent.body.preview, true);
  await assert.rejects(askAgent({message: 'x', state: fresh(),
    fetchImpl: async () => ({ok: false, json: async () => ({detail: 'The assistant is paused: the Gemini account has no credits left.'})})}), /no credits/);
});
