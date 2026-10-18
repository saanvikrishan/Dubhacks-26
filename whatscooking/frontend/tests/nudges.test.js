import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState} from '../src/domain/state.js';
import {localInstant} from '../src/domain/calendar.js';
import {computeNudges, dismissNudge, dismissedNudges} from '../src/domain/nudges.js';

const DAY = '2026-10-19', TOMORROW = '2026-10-20';
const now = new Date(localInstant(DAY, '11:00'));
const liked = (s) => ({...s, profile: {...s.profile, cuisines: ['Korean']}});
const base = () => liked(createDemoState());
const event = (id, title, date, start, end) => ({id, title, start: localInstant(date, start), end: localInstant(date, end),
  kind: 'class', source: 'manual', busy: true, readOnly: false});
const ids = (nudges) => nudges.map((n) => n.id.split(':')[0]);

test('a free gap with nothing planned becomes a nudge; a planned meal there silences it', () => {
  const nudges = computeNudges(base(), {now, today: DAY});
  assert.deepEqual(ids(nudges), ['free']);
  assert.match(nudges[0].text, /free from 11:00 with nothing planned/);
  assert.match(nudges[0].prompt, /Plan a meal for today at 11:00/);
  const planned = {...base(), mealPlans: [{id: 'p', date: DAY, start: '11:30', mealId: null, openSlot: true}]};
  assert.deepEqual(computeNudges(planned, {now, today: DAY}), []);
});

test('a class over lunch tomorrow suggests fitting lunch around it', () => {
  const state = {...base(), events: [event('bio', 'Bio 101', TOMORROW, '12:00', '13:30')],
    mealPlans: [{id: 'p', date: DAY, start: '11:30', mealId: null, openSlot: true}]};
  const [nudge] = computeNudges(state, {now, today: DAY});
  assert.equal(nudge.id, `clash:${TOMORROW}:lunch:bio`);
  assert.match(nudge.text, /Bio 101 runs over lunch tomorrow \(12:00–13:30\)/);
  const today = computeNudges({...base(), events: [event('lab', 'Lab', DAY, '13:00', '15:00')]}, {now, today: DAY})[0];
  assert.match(today.text, /free from 11:00 until 13:00/);
  assert.match(today.prompt, /until 13:00 \(Lab\)/);
});

test("tomorrow's recipe with missing groceries suggests adding them, unless they are already listed", () => {
  const meals = {soup: {id: 'soup', name: 'Miso soup', mode: 'cook', ingredients: [{name: 'tofu', grams: 100}, {name: 'miso', grams: 20}]}};
  const state = {...base(), pantry: {tofu: 200}, mealPlans: [{id: 'p', date: DAY, start: '11:30', mealId: null, openSlot: true},
    {id: 'q', date: TOMORROW, start: '18:00', mealId: 'soup'}]};
  const nudge = computeNudges(state, {now, today: DAY, meals}).find((n) => n.id.startsWith('groceries'));
  assert.match(nudge.text, /Miso soup needs miso/);
  const listed = {...state, shoppingList: [{id: 'm', name: 'miso', qty: '', checked: false}]};
  assert.equal(computeNudges(listed, {now, today: DAY, meals}).some((n) => n.id.startsWith('groceries')), false);
});

test('an empty taste profile offers the short setup; at most three nudges', () => {
  const state = {...createDemoState(), preferred: '', profile: {...createDemoState().profile, preferred: ''}};
  assert.ok(ids(computeNudges(state, {now, today: DAY})).includes('profile'));
  assert.equal(ids(computeNudges(base(), {now, today: DAY})).includes('profile'), false);
  const busy = {...state, events: [event('a', 'Lab', DAY, '12:00', '13:00'), event('b', 'Lab', DAY, '18:00', '19:00'),
    event('c', 'Lab', TOMORROW, '12:00', '13:00'), event('d', 'Lab', TOMORROW, '18:00', '19:00')]};
  assert.equal(computeNudges(busy, {now, today: DAY}).length, 3);
});

test('dismissed nudges are remembered', () => {
  const data = {};
  const storage = {getItem: (k) => data[k] ?? null, setItem: (k, v) => {data[k] = v;}};
  dismissNudge('free:2026-10-19:11:00', storage);
  assert.ok(dismissedNudges(storage).has('free:2026-10-19:11:00'));
  assert.equal(dismissedNudges({getItem: () => '{bad json'}).size, 0);
});
