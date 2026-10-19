import {useState} from 'react';
import {Icon, Modal} from './Core';
import {Basics} from './BasicsChips';

// A brand-new user starts from a blank slate, not the demo's sample tastes (vegetarian, "tofu").
const blank = (profile) => profile.onboarded ? profile
  : {...profile, diet: 'anything', preferred: '', cuisines: [], tastes: [], dislikes: '', avoidCuisines: []};

/**
 * First-run setup in under a minute: tap a few chips. Every choice can be changed later under
 * "Your basics" in Food preferences (the same controls).
 */
export function Onboarding({state, onSave, onClose}) {
  const [p, setP] = useState(() => blank(state.profile));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);

  async function finish(skip = false) {
    setSaving(true);
    try {
      await onSave({type: 'updateProfile', profile: {...(skip ? blank(state.profile) : p), onboarded: true}});
      onClose();
    } catch (err) {setError(err.message);} finally {setSaving(false);}
  }

  return <Modal title="Welcome to WhatsCooking.ai" subtitle="A few taps so meals fit you. Change anything later in Food preferences." onClose={() => finish(true)} wide>
    <Basics profile={p} onChange={setP}/>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="dialog-actions sticky-actions">
      <button type="button" className="text-button" disabled={saving} onClick={() => finish(true)}>Skip for now</button>
      <button type="button" className="primary" disabled={saving} onClick={() => finish(false)}>Let’s go <Icon name="arrow" /></button>
    </div>
  </Modal>;
}
