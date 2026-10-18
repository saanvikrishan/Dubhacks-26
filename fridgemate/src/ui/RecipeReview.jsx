import {useState} from 'react';
import {Modal} from './Core';
import {ALLERGENS,EQUIPMENT} from '../domain/generatedMeals';

export function RecipeReview({meal,state,onSave,onClose}) {
  const [cost,setCost]=useState(''),[prep,setPrep]=useState(meal.timing.prep),[cook,setCook]=useState(meal.timing.cook),[equipment,setEquipment]=useState(meal.equipment),[pantry,setPantry]=useState(Object.fromEntries(meal.ingredients.map(i=>[i.name,state.pantry[i.name]??'']))),[allergens,setAllergens]=useState([]),[dietConfirmed,setDietConfirmed]=useState(false),[allergensConfirmed,setAllergensConfirmed]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const toggle=(list,item,set)=>set(list.includes(item)?list.filter(x=>x!==item):[...list,item]);
  const required=Object.entries(meal.ingredients.reduce((out,i)=>({...out,[i.name]:(out[i.name]??0)+i.grams}),{}));
  return <Modal title="Review this recipe" onClose={onClose} wide>
    <h3>{meal.name}</h3>
    <p>Check one portion before planning it. Ingredient weights are recipe inputs; cooked and dry foods are different. Nothing is added to your meal plan by this review.</p>
    <ol className="recipe">{meal.steps.map((s,i)=><li key={i}>{s}</li>)}</ol>
    <form className="recipe-review" onSubmit={async e=>{e.preventDefault();setSaving(true);try{await onSave({type:'reviewGeneratedMeal',mealId:meal.id,review:{cost:Number(cost),prep:Number(prep),cook:Number(cook),equipment,confirmed,dietConfirmed,allergensConfirmed,allergens},pantry:Object.fromEntries(Object.entries(pantry).map(([name,n])=>[name,Number(n)]))});onClose();}catch(err){setError(err.message);}finally{setSaving(false);}}}>
      <h3>Confirm your available quantities</h3>
      <div className="pantry-grid">{required.map(([name,grams])=><label key={name}>{name} · {grams} g needed<input type="number" min="0" max="100000" step="any" required aria-label={`Available grams of ${name}`} value={pantry[name]} onChange={e=>setPantry({...pantry,[name]:e.target.value})}/><small>grams on hand</small></label>)}</div>
      <div className="pantry-grid">
        <label>Cost of this portion ($)<input aria-label="Confirmed portion cost" type="number" min="0" max="1000" step="0.01" required value={cost} onChange={e=>setCost(e.target.value)}/></label>
        <label>Preparation (min)<input aria-label="Reviewed preparation minutes" type="number" min="0" max="240" step="1" required value={prep} onChange={e=>setPrep(e.target.value)}/></label>
        <label>Cooking (min)<input aria-label="Reviewed cooking minutes" type="number" min="0" max="240" step="1" required value={cook} onChange={e=>setCook(e.target.value)}/></label>
      </div>
      <fieldset><legend>Equipment this recipe needs</legend><div className="checks">{EQUIPMENT.map(item=><label key={item}><input type="checkbox" checked={equipment.includes(item)} onChange={()=>toggle(equipment,item,setEquipment)}/>{item}</label>)}</div></fieldset>
      {state.profile.diet!=='anything'&&<label className="check-label"><input type="checkbox" checked={dietConfirmed} onChange={e=>setDietConfirmed(e.target.checked)}/>Note that I looked at my {state.profile.diet} diet. This note does not mark the recipe as verified.</label>}
      <fieldset><legend>Allergens present in the actual ingredients</legend><div className="checks">{ALLERGENS.map(item=><label key={item}><input type="checkbox" checked={allergens.includes(item)} onChange={()=>toggle(allergens,item,setAllergens)}/>{item}</label>)}</div><p className="fine-print">Check an allergen only when it is present. Empty or partial lists record known allergens only. Other allergens remain unknown and cannot pass an exclusion.</p></fieldset>
      <label className="check-label"><input type="checkbox" checked={allergensConfirmed} onChange={e=>setAllergensConfirmed(e.target.checked)}/>I looked at ingredient labels. {state.profile.exclusions.length?`My exclusions: ${state.profile.exclusions.join(', ')}.`:'Leave unchecked if allergen information is unknown.'} This note does not certify safety.</label>
      <label className="check-label"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the recipe, required amounts, cost, time and equipment.</label>
      <p className="fine-print">Your review records what you checked. It does not certify allergen safety or turn estimates into measured nutrition. Eating, cleanup, onward travel and buffer are added by Daywell.</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={saving}>{saving?'Saving…':'Confirm recipe details'}</button>
    </form>
  </Modal>;
}
