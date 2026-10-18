import test from 'node:test';
import assert from 'node:assert/strict';
import {MEAL_IMAGE_PLACEHOLDER, mealImage, resolveMealImage, prefetchMealImages, taggedMealImage, photoState, trackMealPhotos} from '../src/ui/format.js';
import {requestRecipeDrafts} from '../src/adapters/recipes.js';
import {createDemoState} from '../src/domain/state.js';

const KEY = (c) => c.repeat(32);
const meal = (name, extra = {}) => ({id: `gemini-${name.toLowerCase().replace(/\W+/g, '-')}`, name, mode: 'cook',
  ingredients: [{name: 'tofu', grams: 150}, {name: 'kimchi', grams: 80}, {name: 'white rice', grams: 75}], cuisines: ['Korean'], ...extra});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake photo server: status answers come from `states`, predraw hands out keys. */
function photoServer(t, states, predrawKeys = []) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    calls.push({url, body});
    if (url.startsWith('/api/food/image-status')) {
      const keys = new URL(url, 'http://x').searchParams.get('keys').split(',');
      return {ok: true, json: async () => Object.fromEntries(keys.map((k) => [k, states[k] ?? {status: 'drawing'}]))};
    }
    if (url === '/api/food/image/predraw') return {ok: true, json: async () => ({keys: predrawKeys.splice(0, body.requests.length)})};
    if (url === '/api/food/image') return {ok: true, json: async () => ({status: 'generated', url: `/api/food/image/${KEY('d')}.jpg`})};
    return {ok: false, json: async () => ({})};
  });
  return calls;
}

test('a recipe with a server photo key is only polled: no drawing request, ready when the file exists', async (t) => {
  const states = {};
  const calls = photoServer(t, states);
  const dish = meal('Kimchi Tofu Rice', {photoKey: KEY('a')});
  const done = resolveMealImage(dish);
  assert.equal(photoState(dish), 'pending');
  await wait(300);
  states[KEY('a')] = {status: 'ready', url: `/api/food/image/${KEY('a')}.jpg`};
  assert.equal(await done, `/api/food/image/${KEY('a')}.jpg`);
  assert.equal(photoState(dish), 'ready');
  assert.equal(mealImage(dish), `/api/food/image/${KEY('a')}.jpg`);
  assert.ok(calls.every((c) => c.url.startsWith('/api/food/image-status')));
});

test('a campus dish is pre-drawn as a campus photo with its station, then polled', async (t) => {
  const calls = photoServer(t, {[KEY('b')]: {status: 'ready', url: `/api/food/image/${KEY('b')}.jpg`}}, [KEY('b')]);
  const uw = {id: 'uw-1', name: 'Cheese', mode: 'eatOut', dining: {venueId: 'local-point'}, venue: {station: 'Dawg House Pizza'}, portionLabel: 'Slice', ingredients: []};
  assert.equal(await resolveMealImage(uw), `/api/food/image/${KEY('b')}.jpg`);
  const predraw = calls.find((c) => c.url === '/api/food/image/predraw');
  assert.deepEqual(predraw.body.requests[0], {name: 'Cheese', ingredients: [], setting: 'campus', place: 'Dawg House Pizza, Slice'});
  assert.equal(taggedMealImage('anything'), MEAL_IMAGE_PLACEHOLDER);
});

test('a failed photo settles once; a photo the server never started is drawn on demand', async (t) => {
  const calls = photoServer(t, {[KEY('c')]: {status: 'failed'}, [KEY('e')]: {status: 'none'}});
  const failed = meal('Spicy Tofu Stew', {photoKey: KEY('c')});
  assert.equal(await resolveMealImage(failed), MEAL_IMAGE_PLACEHOLDER);
  assert.equal(photoState(failed), 'failed');
  const lost = meal('Lost After Restart', {photoKey: KEY('e')});
  assert.equal(await resolveMealImage(lost), `/api/food/image/${KEY('d')}.jpg`);
  assert.equal(calls.filter((c) => c.url === '/api/food/image').length, 1);
});

test('prefetching a batch of recipes only polls; nothing new is drawn', async (t) => {
  const calls = photoServer(t, {});
  prefetchMealImages(['One', 'Two', 'Three', 'Four'].map((n, i) => meal(`Prefetch ${n}`, {photoKey: String(i + 1).repeat(32)})));
  trackMealPhotos([meal('Prefetch One', {photoKey: '1'.repeat(32)})]);   // tracking twice is harmless
  await wait(300);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((c) => c.url.startsWith('/api/food/image-status')));
});

test('"more ideas" sends the recipes already suggested', async () => {
  let body;
  await requestRecipeDrafts({state: createDemoState(), ingredients: ['tofu'], exclude: ['Dish A', 'Dish A', 'Dish B'],
    fetchImpl: async (url, options) => {body = JSON.parse(options.body); return {ok: true, text: async () => JSON.stringify({meals: []})};}});
  assert.deepEqual(body.exclude, ['Dish A', 'Dish B']);
});
