import {CUISINES, GOALS, withGoal} from '../domain/preferences';
import {AllergyPicker} from './AllergyPicker';

const DIETS = [['anything', 'I eat everything'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan']];
const BUDGETS = [6, 10, 15];
const section = {margin: '18px 0 8px', fontSize: 15};
const row = {display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center'};

export function Chip({on, onClick, children}) {
  return <button type="button" className="assistant-chip chip-choice" aria-pressed={on} onClick={onClick}>{children}</button>;
}

/**
 * The basics chosen in onboarding (goal, diet, allergies, favourite cuisines, kitchen, budget).
 * The same controls sit at the top of Food preferences, so every onboarding choice can be changed later.
 */
export function Basics({profile: p, onChange}) {
  const toggle = (key, item) => onChange({...p, [key]: (p[key] ?? []).includes(item) ? p[key].filter((x) => x !== item) : [...(p[key] ?? []), item]});
  const otherBudget = p.budget != null && !BUDGETS.includes(p.budget);
  return <>
    <h3 style={section}>What’s your main goal?</h3>
    <div style={row}>{Object.entries(GOALS).map(([key, g]) => <Chip key={key} on={p.goal === key} onClick={() => onChange(withGoal(p, p.goal === key ? '' : key))}>{g.label}</Chip>)}</div>
    <h3 style={section}>How do you eat?</h3>
    <div style={row}>{DIETS.map(([key, label]) => <Chip key={key} on={p.diet === key} onClick={() => onChange({...p, diet: p.diet === key ? 'anything' : key})}>{label}</Chip>)}</div>
    <h3 style={section}>Any allergies?</h3>
    <AllergyPicker value={p.exclusions} onChange={(exclusions) => onChange({...p, exclusions})}/>
    <h3 style={section}>Food you love</h3>
    <div style={row}>{CUISINES.map((c) => <Chip key={c} on={(p.cuisines ?? []).includes(c)} onClick={() => toggle('cuisines', c)}>{c}</Chip>)}</div>
    <h3 style={section}>Kitchen and budget</h3>
    <div style={row}>
      <Chip on={p.cooking} onClick={() => onChange({...p, cooking: true})}>I can cook</Chip>
      <Chip on={!p.cooking} onClick={() => onChange({...p, cooking: false})}>No kitchen</Chip>
      <Chip on={p.budget === null} onClick={() => onChange({...p, budget: null})}>No budget limit</Chip>
      {BUDGETS.map((b) => <Chip key={b} on={p.budget === b} onClick={() => onChange({...p, budget: p.budget === b ? null : b})}>${b} a meal</Chip>)}
      <label style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 13}}>
        Other $
        <input type="number" min="0" max="1000" step="0.5" style={{width: 80}} aria-label="Other meal budget"
          value={otherBudget ? p.budget : ''} placeholder="12"
          onChange={(e) => onChange({...p, budget: e.target.value === '' ? null : Number(e.target.value)})}/>
      </label>
    </div>
  </>;
}
