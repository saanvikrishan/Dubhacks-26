import test from 'node:test';
import assert from 'node:assert/strict';
import {BRAND, storageKeys, readStored, backendTarget, diningTarget} from '../src/domain/branding.js';
import {storageAdapter} from '../src/adapters/storage.js';
import {createDemoState, testPantry, transition} from '../src/domain/state.js';
import {getUserId, feedbackEvent, recordMealFeedback} from '../src/adapters/mealFeedback.js';
import {writeNote} from '../src/adapters/agent.js';
import {byId} from '../src/data/catalog.js';

function memory(values = {}) {
  const data = new Map(Object.entries(values));
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)};
}

test('renamed storage preserves an existing profile, pantry, plan and confirmed meal log', () => {
  let original = createDemoState();
  original.pantry = {...testPantry};
  original.profile.onboarded = true;
  original = transition(original, {type:'choose', mealId:'tofu-bowl'});
  original = transition(original, {type:'log', id:'existing-log', mealId:'tofu-bowl', date:original.context.date, servings:0.5});
  const raw = JSON.stringify(original), storage = memory({'daywell.local-demo.v1':raw});
  const loaded = storageAdapter.load(storage);
  assert.equal(loaded.error, null);
  for (const field of ['profile','pantry','mealPlans','logs']) assert.deepEqual(loaded.state[field], original[field]);
  assert.equal(storage.getItem(storageKeys.state), raw);
  assert.equal(storage.getItem('daywell.local-demo.v1'), raw);
  storageAdapter.reset(storage);
  assert.equal(storage.getItem('daywell.local-demo.v1'), null);
  assert.equal(storageAdapter.load(storage).state.logs.length, 0);
});

test('existing notes, voice setting, dismissals and preparation markers are retained under the new name', () => {
  const storage = memory({
    'whatscooking.sidebar-notes.v1':JSON.stringify({'2026-10-18':'Keep this note'}),
    'daywell-voice-replies':'off', 'daywell-dismissed-nudges':'["seen"]', 'daywell-pantry-prepared':'already-prepared',
  });
  assert.equal(writeNote('2026-10-18', 'New note', storage), 'Keep this note');
  assert.equal(JSON.parse(storage.getItem(storageKeys.notes))['2026-10-18'], 'Keep this note\nNew note');
  assert.equal(readStored(storage, storageKeys.voice), 'off');
  assert.equal(readStored(storage, storageKeys.dismissed), '["seen"]');
  assert.equal(readStored(storage, storageKeys.prepared), 'already-prepared');
});

test('the same anonymous identity and feedback deduplication survive the rename without network writes', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const context = {date:'2026-10-18', start:'12:00'}, meal = byId['tofu-bowl'];
  const event = feedbackEvent('chose', meal, context);
  const storage = memory({'daywell-user-id':id, 'daywell-feedback-sent':JSON.stringify([event.eventId])});
  assert.equal(getUserId(storage), id);
  assert.equal(storage.getItem(storageKeys.user), id);
  assert.equal(await recordMealFeedback('chose', meal, context, {storage, fetchImpl:() => assert.fail('must not resend')}), 'duplicate');
});

test('canonical values win and read-only storage still exposes existing data', () => {
  assert.equal(BRAND, 'whatscooking.ai');
  const storage = memory({[storageKeys.voice]:'', 'daywell-voice-replies':'off'});
  assert.equal(readStored(storage, storageKeys.voice), '');
  const locked = {getItem:key => key === 'daywell-voice-replies' ? 'off' : null, setItem:() => {throw new Error('full');}};
  assert.equal(readStored(locked, storageKeys.voice), 'off');
});

test('new backend settings win while existing environment settings keep working', () => {
  assert.equal(backendTarget({WHATSCOOKING_BACKEND_URL:'new', DAYWELL_BACKEND_URL:'old'}), 'new');
  assert.equal(backendTarget({DAYWELL_BACKEND_URL:'old'}), 'old');
  assert.equal(diningTarget({WHATSCOOKING_DINING_BACKEND_URL:'maps', DAYWELL_DINING_BACKEND_URL:'old'}), 'maps');
  assert.equal(diningTarget({DAYWELL_DINING_BACKEND_URL:'old'}), 'old');
});
