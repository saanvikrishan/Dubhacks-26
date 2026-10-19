import {useState} from 'react';
import {STANDARD_ALLERGENS, normalizeAllergies} from '../domain/allergens.js';

export function AllergyPicker({value, onChange}) {
  const [draft, setDraft] = useState('');
  const selected = normalizeAllergies(value);
  const toggle = name => onChange(selected.includes(name) ? selected.filter(a => a !== name) : [...selected, name]);
  function add() {
    const next = normalizeAllergies([...selected, ...draft.split(/[,;]+/)]);
    if (next.length > 30 || next.some(a => a.length > 60)) return;
    onChange(next); setDraft('');
  }
  return <>
    <div className="checks">{STANDARD_ALLERGENS.map(a => <label key={a}><input type="checkbox" checked={selected.includes(a)} onChange={() => toggle(a)}/>{a}</label>)}</div>
    <div style={{display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '12px 0 4px'}}>
      <label>Custom allergy<input value={draft} maxLength={60} placeholder="e.g. kiwi" onChange={e => setDraft(e.target.value)} onKeyDown={e => {if(e.key === 'Enter') {e.preventDefault(); add();}}}/></label>
      <button type="button" className="secondary" disabled={!draft.trim() || selected.length >= 30} onClick={add}>Add allergy</button>
    </div>
    <div className="checks">{selected.filter(a => !STANDARD_ALLERGENS.includes(a)).map(a => <button key={a} type="button" className="assistant-chip" aria-label={`Remove allergy ${a}`} onClick={() => toggle(a)}>{a} ×</button>)}</div>
    <p className="fine-print">Restrictions stay mandatory. Ingredient checks cannot verify unlisted ingredients or cross-contact.</p>
  </>;
}
