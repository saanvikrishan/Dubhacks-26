import {minutes} from '../domain/engine.js';
import {normalizeGeneratedMeal} from '../domain/generatedMeals.js';
export function cookingMinutes(state) {
  const c=state.context;
  return Math.max(0,Math.min(c.available,minutes(c.commitmentTime)-minutes(c.start))-c.eating-c.cleanup-c.onward-c.buffer);
}
export async function requestRecipeDrafts({state,ingredients,pantry={},fetchImpl=globalThis.fetch,signal}) {
  const time=cookingMinutes(state);
  if (time<1) throw new Error('No cooking time remains after eating, cleanup, travel and buffer. Adjust your meal window first.');
  const response=await fetchImpl('/api/recipes',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({ingredients,pantry,diet:state.profile.diet,time,budget:state.profile.budget,equipment:state.profile.equipment,exclusions:state.profile.exclusions})});
  const raw=await response.text();
  if(raw.length>64000) throw new Error('Recipe response was too large. Try again.');
  let data;
  try{data=JSON.parse(raw);}catch{throw new Error('Recipe service did not return JSON. Check that the backend is running on port 8000.');}
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:response.status===422?'Recipe inputs were rejected. Check your groceries and meal window.':'Recipe service unavailable. Try the local recipe options.');
  const meals=data.meals;
  if(!Array.isArray(meals)||meals.length>8) throw new Error('Recipe service returned invalid meals.');
  const normalized=meals.map(normalizeGeneratedMeal);
  if(new Set(normalized.map(m=>m.id)).size!==normalized.length) throw new Error('Recipe identifiers were duplicated. Generate another set.');
  return normalized;
}
