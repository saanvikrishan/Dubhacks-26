import {useEffect, useRef, useState} from 'react';
import {Icon, Modal} from './Core';
import {CUISINES, GOALS, withGoal} from '../domain/preferences';
import {ALLERGENS} from '../domain/generatedMeals';
import {askAgent, planTurn} from '../adapters/agent';
import {listen, transcribe, voiceSupported} from '../adapters/voice';

const DIETS = [['anything', 'I eat everything'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan']];
const BUDGETS = [6, 10, 15];

function Chip({on, onClick, children}) {
  return <button type="button" className="assistant-chip" aria-pressed={on} onClick={onClick}
    style={on ? {background: '#2f5538', borderColor: '#2f5538', color: '#fff', fontSize: 13} : {fontSize: 13}}>{children}</button>;
}

/**
 * First-run setup in under a minute: tap a few chips, or tap the mic and say it in one sentence
 * ("I'm vegetarian, allergic to peanuts, trying to build muscle, I love Korean food").
 * Everything can be changed later in Food preferences.
 */
export function Onboarding({state, agent, onSave, onClose}) {
  const [p, setP] = useState(state.profile);
  const [goal, setGoal] = useState(state.profile.goal ?? '');
  const [voice, setVoice] = useState('idle'), [heard, setHeard] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const mic = useRef(null);
  useEffect(() => () => mic.current?.cancel(), []);
  const toggle = (key, item) => setP({...p, [key]: (p[key] ?? []).includes(item) ? p[key].filter((x) => x !== item) : [...(p[key] ?? []), item]});

  async function finish(skip = false) {
    setSaving(true);
    try {
      const profile = skip ? {...state.profile, onboarded: true} : {...withGoal(p, goal), onboarded: true};
      await onSave({type: 'updateProfile', profile});
      onClose();
    } catch (err) {setError(err.message);} finally {setSaving(false);}
  }

  // "Just tell me": the assistant turns one sentence into the same choices, which then show as selected chips.
  async function tellMe() {
    if (voice === 'listening') return mic.current?.stop();
    setError('');
    try {
      mic.current = await listen({waitMs: 10000, pauseMs: 1600});
      setVoice('listening');
      const wav = await mic.current.result;
      mic.current = null;
      if (!wav) return setVoice('idle');
      setVoice('working');
      const words = await transcribe(wav);
      setHeard(words);
      if (!words) throw new Error('I didn’t catch that. Tap the mic and try again.');
      const draft = {...agent.current(), profile: withGoal(p, goal)};
      const reply = await askAgent({message: `Preview my profile from this (diet, allergies, liked cuisines, main goal, budget, whether I can cook). Do not remember anything yet; I will save after reviewing: "${words}"`,
        state: draft, ui: agent.ui, preview: true});
      const profileTools = new Set(['update_preferences', 'set_nutrition_goal']);
      const plan = planTurn(draft, (reply.actions ?? []).filter((a) => profileTools.has(a.tool)));
      if (!plan.ok) throw new Error(plan.error);
      const now = plan.preview.profile;
      setP(now);
      setGoal(now.goal ?? '');
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Allow microphone access, or just tap your answers below.' : err.message);
    } finally {
      mic.current = null;
      setVoice('idle');
    }
  }

  const section = {margin: '18px 0 8px', fontSize: 15};
  const row = {display: 'flex', flexWrap: 'wrap', gap: 8};
  return <Modal title="Welcome to WhatsCooking.ai" subtitle="A few taps so meals fit you. Change anything later." onClose={() => finish(true)} wide>
    {voiceSupported() && <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
      <button type="button" className={voice === 'listening' ? 'primary' : 'secondary'} onClick={tellMe} disabled={voice === 'working'}
        style={voice === 'listening' ? {background: 'linear-gradient(145deg, #e8743b, #b9531f)'} : undefined}>
        <Icon name="mic" size={18} /> {voice === 'listening' ? 'Listening… tap when done' : voice === 'working' ? 'Setting things up…' : 'Just tell me'}
      </button>
      <span className="muted" style={{fontSize: 13}}>{heard ? `“${heard}”` : 'e.g. “I’m vegetarian, allergic to peanuts, trying to build muscle, and I love Korean food.”'}</span>
    </div>}
    <h3 style={section}>What’s your main goal?</h3>
    <div style={row}>{Object.entries(GOALS).map(([key, g]) => <Chip key={key} on={goal === key} onClick={() => setGoal(goal === key ? '' : key)}>{g.label}</Chip>)}</div>
    <h3 style={section}>How do you eat?</h3>
    <div style={row}>{DIETS.map(([key, label]) => <Chip key={key} on={p.diet === key} onClick={() => setP({...p, diet: key})}>{label}</Chip>)}</div>
    <h3 style={section}>Any allergies?</h3>
    <div style={row}>{ALLERGENS.map((a) => <Chip key={a} on={p.exclusions.includes(a)} onClick={() => toggle('exclusions', a)}>{a}</Chip>)}</div>
    <h3 style={section}>Food you love</h3>
    <div style={row}>{CUISINES.map((c) => <Chip key={c} on={(p.cuisines ?? []).includes(c)} onClick={() => toggle('cuisines', c)}>{c}</Chip>)}</div>
    <h3 style={section}>Kitchen and budget</h3>
    <div style={row}>
      <Chip on={p.cooking} onClick={() => setP({...p, cooking: true})}>I can cook</Chip>
      <Chip on={!p.cooking} onClick={() => setP({...p, cooking: false})}>No kitchen</Chip>
      {BUDGETS.map((b) => <Chip key={b} on={p.budget === b} onClick={() => setP({...p, budget: b})}>${b} a meal</Chip>)}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="dialog-actions sticky-actions">
      <button type="button" className="text-button" disabled={saving || voice !== 'idle'} onClick={() => finish(true)}>Skip for now</button>
      <button type="button" className="primary" disabled={saving || voice !== 'idle'} onClick={() => finish(false)}>Let’s go <Icon name="arrow" /></button>
    </div>
  </Modal>;
}
