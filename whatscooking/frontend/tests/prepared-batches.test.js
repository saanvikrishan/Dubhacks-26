import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState} from '../src/domain/state.js';

// A stable anonymous user id, as in the browser.
const store = new Map();
globalThis.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const {prepareRecipeDrafts, requestRecipeDrafts, prepareCook} = await import('../src/adapters/recipes.js');

const draft = (name) => ({id: `gemini-${name}`, name, description: 'A dish.', mode: 'cook', ingredients: [{name: 'tofu', grams: 100}],
  equipment: [], timing: {prep: 5, cook: 5, outbound: 0}, steps: ['Cook.'], photo: 'tofu', dishType: 'tofu stir-fry',
  nutrition: {basis: 'per_serving'}});
function recipeServer(names) {
  const calls = [], predraws = [];
  const fetchImpl = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (url === '/api/food/image/predraw') {predraws.push(body); return {ok: true, json: async () => ({keys: []})};}
    calls.push({url, body});
    return {ok: true, text: async () => JSON.stringify({meals: names.shift().map(draft)})};
  };
  return {calls, predraws, fetchImpl};
}
const state = () => {const s = createDemoState(); s.profile.cuisines = ['Korean']; return s;};

test('a prepared batch is used once by the matching request, even with a newer exclude list', async () => {
  const {calls, predraws, fetchImpl} = recipeServer([['a1', 'a2'], ['b1']]);
  const s = state();
  assert.equal(prepareRecipeDrafts({state: s, ingredients: ['tofu'], exclude: ['old']}, {fetchImpl}), true);
  assert.equal(prepareRecipeDrafts({state: s, ingredients: ['tofu'], exclude: ['old']}, {fetchImpl}), false);   // not requested twice
  const meals = await requestRecipeDrafts({state: s, ingredients: ['tofu'], exclude: ['old', 'newer'], fetchImpl});
  assert.deepEqual(meals.map(m => m.name), ['a1', 'a2']);
  assert.equal(meals[0].dishType, 'tofu stir-fry');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.prepare, true);          // prepared ahead: the server skips its photos...
  assert.equal(predraws.length, 1);                   // ...until the batch is actually opened
  assert.deepEqual(predraws[0].requests.map(r => r.name), ['a1', 'a2']);
  const next = await requestRecipeDrafts({state: s, ingredients: ['tofu'], fetchImpl});   // used up: asks again
  assert.deepEqual(next.map(m => m.name), ['b1']);
  assert.equal(calls.length, 2);
});

test('different inputs never use a prepared batch, and a failed preparation is retried', async () => {
  const {calls, fetchImpl} = recipeServer([['c1'], ['d1']]);
  const s = state();
  prepareRecipeDrafts({state: s, ingredients: ['tofu']}, {fetchImpl});
  const other = await requestRecipeDrafts({state: s, ingredients: ['eggs'], fetchImpl});
  assert.deepEqual(other.map(m => m.name), ['d1']);
  assert.equal(calls.length, 2);

  let attempts = 0;
  const flaky = async () => {attempts++; if (attempts === 1) throw new Error('offline'); return {ok: true, text: async () => JSON.stringify({meals: [draft('e1')]})};};
  prepareRecipeDrafts({state: s, ingredients: ['rice']}, {fetchImpl: flaky});
  const meals = await requestRecipeDrafts({state: s, ingredients: ['rice'], fetchImpl: flaky});
  assert.deepEqual(meals.map(m => m.name), ['e1']);
  assert.equal(attempts, 2);
});

test('newly excluded recipes are removed from a prepared batch; a fully repeated batch requests fresh ideas', async () => {
  const {calls,predraws,fetchImpl}=recipeServer([['already-shown','fresh-idea']]);
  const s=state();
  prepareRecipeDrafts({state:s,ingredients:['spinach']},{fetchImpl});
  const meals=await requestRecipeDrafts({state:s,ingredients:['spinach'],exclude:['Already-Shown'],fetchImpl});
  assert.deepEqual(meals.map(m=>m.name),['fresh-idea']);
  assert.deepEqual(predraws[0].requests.map(r=>r.name),['fresh-idea']);
  assert.equal(calls.length,1);

  const repeated=recipeServer([['repeat'],['new-recipe']]);
  prepareRecipeDrafts({state:s,ingredients:['oats']},{fetchImpl:repeated.fetchImpl});
  const next=await requestRecipeDrafts({state:s,ingredients:['oats'],exclude:['repeat'],fetchImpl:repeated.fetchImpl});
  assert.deepEqual(next.map(m=>m.name),['new-recipe']);
  assert.equal(repeated.calls.length,2);
  assert.deepEqual(repeated.calls[1].body.exclude,['repeat']);
});

test('opening Cook warms photos once, and prepares a saved-pantry batch only for users with history', async () => {
  const calls = [];
  let events = 1;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === '/api/food/image/warm') return {ok: true, json: async () => ({started: 3})};
    if (url.startsWith('/api/food/preferences')) return {ok: true, json: async () => ({status: 'retrieved', learned: {events}})};
    return {ok: true, text: async () => JSON.stringify({meals: [draft('p1')]})};
  };
  const s = state();
  s.pantry = {tofu: 300, eggs: 100};
  assert.equal(await prepareCook(s, {fetchImpl}), false);   // too little history
  assert.equal(calls.filter(u => u === '/api/recipes').length, 0);
  events = 5;
  assert.equal(await prepareCook(s, {fetchImpl}), true);
  assert.equal(calls.filter(u => u === '/api/food/image/warm').length, 1);
  // Same inputs as "Suggest from my saved pantry": instant, no new request.
  const meals = await requestRecipeDrafts({state: s, ingredients: ['tofu', 'eggs'], pantry: {tofu: 300, eggs: 100}, fetchImpl});
  assert.deepEqual(meals.map(m => m.name), ['p1']);
  assert.equal(calls.filter(u => u === '/api/recipes').length, 1);
});
