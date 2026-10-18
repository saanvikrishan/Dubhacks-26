import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav, plainSpeech, speakReply, speechParts, stopSpeaking, transcribe, voiceHints} from '../src/adapters/voice.js';
import {createDemoState} from '../src/domain/state.js';

test('a recording becomes 16 kHz mono 16-bit WAV', async () => {
  const tone = Float32Array.from({length: 4800}, (_, i) => Math.sin(i / 10) * 0.5);   // 0.1 s at 48 kHz
  const wav = encodeWav([tone.subarray(0, 2400), tone.subarray(2400)], 48000);
  const view = new DataView(await wav.arrayBuffer());
  const text = (at) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
  assert.equal(wav.type, 'audio/wav');
  assert.deepEqual([text(0), text(8), text(36)], ['RIFF', 'WAVE', 'data']);
  assert.deepEqual([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)], [1, 16000, 16]);
  assert.equal(view.getUint32(40, true), 1600 * 2);
  assert.equal(wav.size, 44 + 1600 * 2);
});

test('replies are read without Markdown, first sentence first', () => {
  assert.equal(plainSpeech('**Done!** Tofu is on your list.\n- spinach\n- rice'), 'Done! Tofu is on your list. spinach rice');
  assert.deepEqual(speechParts('Done! Tofu and spinach are on your list. Want me to plan dinner too?'),
    ['Done! Tofu and spinach are on your list.', 'Want me to plan dinner too?']);
  assert.deepEqual(speechParts('Sure.'), ['Sure.']);
  assert.deepEqual(speechParts('   '), []);
});

test('the transcript request carries the audio and the names the user may say', async () => {
  let body;
  const words = await transcribe(new Blob([new Uint8Array([1, 2, 3, 250])], {type: 'audio/wav'}), {hints: ['Bio 101'],
    fetchImpl: async (url, options) => {body = {url, ...JSON.parse(options.body)}; return {ok: true, json: async () => ({text: ' add tofu '})};}});
  assert.equal(words, 'add tofu');
  assert.deepEqual(body, {url: '/api/assistant/transcribe', audio: 'AQID+g==', mime: 'audio/wav', hints: ['Bio 101']});
  await assert.rejects(transcribe(new Blob(['x']), {fetchImpl: async () => ({ok: false, json: async () => ({detail: 'Voice is paused: the Gemini account has no credits left.'})})}), /no credits/);
});

test('hints come from the calendar, lists and meals, without repeats', () => {
  const state = {...createDemoState(), events: [{title: 'Bio 101'}, {title: 'Bio 101'}], shoppingList: [{name: 'tofu'}], pantry: {tofu: 100}};
  const hints = voiceHints(state);
  assert.equal(hints.filter((h) => h === 'Bio 101').length, 1);
  assert.equal(hints.filter((h) => h === 'tofu').length, 1);
  assert.ok(hints.length <= 60);
});

test('both parts are requested at once and played in order; the browser voice covers a failure', async () => {
  const played = [], spokenByBrowser = [];
  globalThis.Audio = function FakeAudio(url) {
    this.play = async () => {played.push(url); setTimeout(() => this.onended(), 0);};
    this.pause = () => {};
  };
  globalThis.speechSynthesis = {speak: (u) => {spokenByBrowser.push(u.text); setTimeout(() => u.onend(), 0);}, cancel() {}};
  globalThis.SpeechSynthesisUtterance = function Utterance(text) {this.text = text;};
  const asked = [];
  const ok = async (url, options) => {asked.push(JSON.parse(options.body).text); return {ok: true, blob: async () => new Blob(['RIFF'])};};
  await speakReply('Done! Tofu and spinach are on your list. Anything else?', {fetchImpl: ok});
  assert.deepEqual(asked, ['Done! Tofu and spinach are on your list.', 'Anything else?']);
  assert.equal(played.length, 2);
  const failing = async () => ({ok: false});
  await speakReply('Here is your grocery list for the week.', {fetchImpl: failing});
  assert.deepEqual(spokenByBrowser, ['Here is your grocery list for the week.']);
  stopSpeaking();
  delete globalThis.Audio;
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});
