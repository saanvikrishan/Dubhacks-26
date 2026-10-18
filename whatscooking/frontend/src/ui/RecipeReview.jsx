import {useState} from 'react';
import {Modal} from './Core';
import {ALLERGENS,EQUIPMENT} from '../domain/generatedMeals';
import {enrichCookFacts} from '../domain/foodFacts';
import {allergensInIngredients,dietConflict} from '../domain/allergens';
import {transition} from '../domain/state';
import {assertMealAction} from '../domain/engine';
import {money} from './format';

const STAPLES=new Set(['water','salt','pepper','black pepper','ice']);

/**
 * One click to use a new recipe: it is confirmed with its own amounts, time and equipment, anything you
 * didn't list goes on your grocery list, and it is added to your plan. The app still refuses recipes
 * with an ingredient you avoid. "Edit details" opens the full form for anyone who wants to adjust.
 */
export function RecipeReview({meal,state,onSave,onChoose,onClose}) {
  const p=state.profile;
  const required=Object.entries(meal.ingredients.reduce((out,i)=>({...out,[i.name]:(out[i.name]??0)+i.grams}),{}));
  const facts=enrichCookFacts(meal);
  const estimate=Number.isFinite(facts.cost)?Math.round(facts.cost*100)/100:null;
  const found=allergensInIngredients(meal.ingredients);
  const avoided=found.filter(a=>p.exclusions.includes(a));
  const clash=p.diet!=='anything'?dietConflict(meal.ingredients,p.diet):null;
  const newTools=meal.equipment.filter(e=>!p.equipment.includes(e));
  const listed=new Set([...(state.groceryList??[]),...Object.keys(state.pantry).filter(k=>state.pantry[k]>0)].map(n=>String(n).toLowerCase()));
  const toBuy=required.map(([name])=>name).filter(name=>!listed.has(name.toLowerCase()) && !STAPLES.has(name.toLowerCase()));
  const blocked=avoided.length?`Contains ${avoided.join(', ')}, which you avoid.`:clash?`Has ${clash}, which doesn't fit your ${p.diet} diet.`:'';
  const [editing,setEditing]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const [cost,setCost]=useState(estimate??p.budget),[prep,setPrep]=useState(meal.timing.prep),[cook,setCook]=useState(meal.timing.cook),[equipment,setEquipment]=useState(meal.equipment),[allergens,setAllergens]=useState(found);
  const toggle=(list,item,set)=>set(list.includes(item)?list.filter(x=>x!==item):[...list,item]);

  async function addToPlan(review) {
    setSaving(true);setError('');
    try {
      const tools=review.equipment.filter(e=>!p.equipment.includes(e));
      const actions=[];
      if(tools.length) actions.push({type:'updateProfile',profile:{...p,equipment:[...p.equipment,...tools]}});
      actions.push({type:'reviewGeneratedMeal',mealId:meal.id,review:{...review,confirmed:true,dietConfirmed:true,allergensConfirmed:true},
        pantry:Object.fromEntries(required.map(([name,grams])=>[name,Math.max(Number(state.pantry[name])||0,grams)]))});
      const extra=toBuy.filter(name=>!state.shoppingList.some(i=>i.name.toLowerCase()===name.toLowerCase()));
      if(extra.length) actions.push({type:'updateShoppingList',shoppingList:[...state.shoppingList,...extra.map(name=>({id:crypto.randomUUID(),name,qty:'',checked:false}))]});
      // Check the complete proposed review before saving groceries, equipment or confirmation.
      const preview=actions.reduce((current,action)=>transition(current,action),state);
      assertMealAction(preview.generatedMeals.find(m=>m.id===meal.id),preview);
      for(const action of actions) await onSave(action);
      // Selection owns closing or opening the replacement dialog. Keep this review open
      // when domain validation refuses the plan, so the failure can be corrected.
      if (await onChoose(meal.id) === false) throw new Error('Recipe saved, but it could not be planned. Check your meal window and preferences, then try again.');
    } catch(err) {setError(err.message);} finally {setSaving(false);}
  }
  const quick={cost:estimate??p.budget,prep:meal.timing.prep,cook:meal.timing.cook,equipment:meal.equipment,allergens:found};

  return <Modal title={meal.name} subtitle={`${meal.timing.prep+meal.timing.cook} min · ${estimate!=null?`about ${money(estimate)} a portion`:`within your ${money(p.budget)} budget`}`} onClose={onClose} wide>
    {!editing ? <>
      <p className="muted">{meal.ingredients.map(i=>`${i.name} ${i.grams} g`).join(' · ')}</p>
      <details><summary>Steps</summary><ol className="recipe">{meal.steps.map((s,i)=><li key={i}>{s}</li>)}</ol></details>
      {toBuy.length>0&&<p className="fine-print">Added to your grocery list: {toBuy.join(', ')}.</p>}
      {newTools.length>0&&<p className="fine-print">Uses {newTools.join(', ')}, which will be added to your kitchen.</p>}
      {blocked&&<p role="alert" className="error">{blocked}</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="dialog-actions sticky-actions">
        <button className="text-button" onClick={()=>setEditing(true)}>Edit details</button>
        <button className="primary" disabled={saving||Boolean(blocked)} onClick={()=>addToPlan(quick)}>{saving?'Adding…':'Looks good — add to my plan'}</button>
      </div>
    </> : <form className="recipe-review" onSubmit={e=>{e.preventDefault();addToPlan({cost:Number(cost),prep:Number(prep),cook:Number(cook),equipment,allergens});}}>
      <div className="pantry-grid">
        <label>Cost of this portion ($)<input type="number" min="0" max="1000" step="0.01" required value={cost} onChange={e=>setCost(e.target.value)}/></label>
        <label>Preparation (min)<input type="number" min="0" max="240" step="1" required value={prep} onChange={e=>setPrep(e.target.value)}/></label>
        <label>Cooking (min)<input type="number" min="0" max="240" step="1" required value={cook} onChange={e=>setCook(e.target.value)}/></label>
      </div>
      <fieldset><legend>Equipment</legend><div className="checks">{EQUIPMENT.map(item=><label key={item}><input type="checkbox" checked={equipment.includes(item)} onChange={()=>toggle(equipment,item,setEquipment)}/>{item}</label>)}</div></fieldset>
      <fieldset><legend>Allergens in it</legend><div className="checks">{ALLERGENS.map(item=><label key={item}><input type="checkbox" checked={allergens.includes(item)} onChange={()=>toggle(allergens,item,setAllergens)}/>{item}</label>)}</div></fieldset>
      {blocked&&<p role="alert" className="error">{blocked}</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="text-button" onClick={()=>setEditing(false)}>Back</button>
        <button className="primary" disabled={saving||Boolean(blocked)}>{saving?'Adding…':'Save and add to my plan'}</button>
      </div>
    </form>}
  </Modal>;
}
