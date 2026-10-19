import {mealsFor} from '../domain/generatedMeals.js';

/**
 * Voice for the assistant. The mic records 16 kHz WAV in the browser (every browser can, and Gemini
 * reads WAV) and stops by itself once you pause; the backend turns it into text for the agent.
 * Replies are read aloud in a Gemini voice, first sentence first, so speech starts quickly; if the
 * voice service is unavailable the browser's own voice is used instead.
 */

const TARGET_RATE = 16000;

export const voiceSupported = () => Boolean(globalThis.navigator?.mediaDevices?.getUserMedia
  && (globalThis.AudioContext || globalThis.webkitAudioContext));

/** Mono Float32 chunks at `inputRate` -> 16-bit PCM WAV at 16 kHz (averaging, which also smooths). */
export function encodeWav(chunks, inputRate, targetRate = TARGET_RATE) {
  const rate = Math.min(targetRate, inputRate);
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {joined.set(chunk, offset); offset += chunk.length;}
  const ratio = inputRate / rate, samples = Math.floor(length / ratio);
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (at, s) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += joined[j] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], {type: 'audio/wav'});
}

/**
 * Starts the mic. Resolves `result` with a WAV Blob after you speak and pause, or null if nobody
 * spoke within `waitMs`. `stop()` ends now and keeps what was said; `cancel()` discards it.
 */
export async function listen({onLevel, onSpeech, waitMs = 8000, pauseMs = 1300, maxMs, autoStop = true} = {}) {
  // autoStop: false records until stop() is called (only a 5-minute safety limit ends it).
  maxMs ??= autoStop ? 30000 : 300000;
  const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const context = new Context();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;   // the processor must reach the speakers to run; nothing is heard
  source.connect(processor); processor.connect(silent); silent.connect(context.destination);
  const chunks = [], started = performance.now();
  let spoke = false, loud = 0, lastVoice = 0, floor = 0.008, ended = false, resolve;
  const result = new Promise((r) => {resolve = r;});
  const end = (keep) => {
    if (ended) return;
    ended = true;
    processor.onaudioprocess = null;
    processor.disconnect(); source.disconnect(); silent.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    context.close().catch(() => {});
    resolve(keep && chunks.length > 4 ? encodeWav(chunks, context.sampleRate) : null);
  };
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length), now = performance.now();
    onLevel?.(Math.min(1, rms * 10));
    // Speech is clearly louder than the room; the room level is learned from quiet moments.
    if (rms > Math.max(0.015, floor * 3)) {
      loud += 1;
      if (loud >= 2) {
        if (!spoke) {spoke = true; onSpeech?.();}
        lastVoice = now;
      }
    } else {
      loud = 0;
      floor = floor * 0.9 + rms * 0.1;
    }
    if (autoStop && spoke && now - lastVoice > pauseMs) end(true);
    else if (autoStop && !spoke && now - started > waitMs) end(false);
    else if (now - started > maxMs) end(true);
  };
  return {result, stop: () => end(true), cancel: () => end(false)};
}

/** Names the user may say (events, foods), so the transcript spells them the app's way. */
export function voiceHints(state) {
  const names = [
    ...(state.events ?? []).map((e) => e.title),
    ...(state.shoppingList ?? []).map((i) => i.name),
    ...Object.keys(state.pantry ?? {}),
    ...Object.values(mealsFor(state)).map((m) => m?.name),
  ];
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 60)))].slice(0, 60);
}

export async function transcribe(wav, {hints = [], fetchImpl = globalThis.fetch, signal} = {}) {
  const bytes = new Uint8Array(await wav.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const response = await fetchImpl('/api/assistant/transcribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
    body: JSON.stringify({audio: btoa(binary), mime: 'audio/wav', hints})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'I could not hear that. Try again.');
  return String(data.text ?? '').trim();
}

/** What is read aloud: no Markdown symbols or bullets. */
export function plainSpeech(text) {
  return String(text ?? '').replace(/[*_`#]+/g, '').replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

/** The first sentence alone (so it starts fast), then the rest together. */
export function speechParts(text) {
  const words = plainSpeech(text);
  const match = words.match(/^(.{20,}?[.!?])\s+(.+)$/);
  return match ? [match[1], match[2]] : words ? [words] : [];
}

let current = null;

export function stopSpeaking() {
  if (!current) return;
  current.stopped = true;
  current.stop?.();
  current = null;
}

function play(blob, token) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), audio = new Audio(url);
    const done = () => {URL.revokeObjectURL(url); resolve();};
    token.stop = () => {audio.pause(); done();};
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

function browserVoice(text, token) {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onend = utterance.onerror = () => resolve();
    token.stop = () => {synth.cancel(); resolve();};
    synth.speak(utterance);
  });
}

/** Reads a reply aloud; resolves when it has finished (or was stopped). */
export async function speakReply(text, {fetchImpl = globalThis.fetch} = {}) {
  stopSpeaking();
  const parts = speechParts(text);
  if (!parts.length) return;
  const token = {stopped: false};
  current = token;
  // Both parts are requested at once and played in order.
  const clips = parts.map((part) => fetchImpl('/api/assistant/speak', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text: part})}).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('voice unavailable')))));
  clips.forEach((clip) => clip.catch(() => {}));
  for (let i = 0; i < parts.length; i++) {
    let blob = null;
    try {blob = await clips[i];} catch { /* fall back below */ }
    if (token.stopped) return;
    if (blob) await play(blob, token);
    else {await browserVoice(parts.slice(i).join(' '), token); break;}
    if (token.stopped) return;
  }
  if (current === token) current = null;
}
