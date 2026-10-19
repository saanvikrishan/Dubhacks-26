import {excludedInIngredients,dietConflict} from './allergens.js';
import {comparePreferences,memoryProfile,varied,preferenceFit} from "./preferences.js";
import { recommend, evaluate } from './engine.js';
import { config } from './config.js';
import { portionNutrition } from './nutrition.js';

function moodFits(meal,mood) {
  const prep=meal.timing.prep+meal.timing.cook;
  if(mood==='quick') return prep<=10;
  if(mood==='hungry') return (portionNutrition(meal).energy_kcal ?? -1)>=550;
  if(mood==='fancy') return prep>=15;
  if(mood==='comfort') return /warm|cook|bake|toast|simmer|heat|roast|fry/i.test(meal.steps.join(' '));
  return true;
}
// Never relaxed for a closest match: diet, allergens and cooking access.
const SAFETY = /Does not meet your|Dietary suitability is unknown|Contains excluded|Allergen information is unknown|Cooking access is off|no longer exists|invalid mode|retained for history/i;
/** Ingredients this recipe still needs (not enough at home). */
export function missingIngredients(meal, state) {
  return (meal.ingredients ?? []).filter((i) => !(Number(state.pantry?.[i.name]) >= i.grams)).map((i) => i.name);
}

/** Reviewable drafts are shown separately from feasible recommendations. No UI override. */
export function discoverCookMeals(catalog,state,{sort='catalog',mood='any',flavor='any',passed=[],preferences=[]}={}) {
  const options={mode:'cook',sort,passed,preferences};
  const fits = m => moodFits(m,mood) && (flavor === 'any' || preferenceFit(m,{tastes:[flavor]}).taste);
  const all=recommend(catalog.filter(fits),state,options,config);
  const cards=all.cards;
  const drafts=catalog.filter(m=>m.mode==='cook' && m.suggestion && !m.review?.confirmed && !passed.includes(m.id) && fits(m) && !excludedInIngredients(m.ingredients,state.profile.exclusions).length && !dietConflict(m.ingredients,state.profile.diet)).map(meal=>({meal,...evaluate(meal,state)}));
  if(sort==='catalog') {
    const memory=memoryProfile(preferences);
    drafts.sort((a,b)=>comparePreferences(a.meal,b.meal,state.profile)||comparePreferences(a.meal,b.meal,memory));
  }
  if(sort==='time') drafts.sort((a,b)=> (a.duration??Infinity)-(b.duration??Infinity));
  // Unknown price/protein is never treated as zero or a bargain/high-protein option.
  if(sort==='protein') drafts.sort((a,b)=>(portionNutrition(b.meal).protein_g??-1)-(portionNutrition(a.meal).protein_g??-1));
  // Feasible cards always come before drafts that still need review; variety applies within each.
  const ordered=sort==='catalog'?varied(drafts):drafts;
  if (!cards.length && !ordered.length && (mood !== 'any' || flavor !== 'any')) {
    const fallback = discoverCookMeals(catalog,state,{sort,passed,preferences});
    return {...fallback, softened: fallback.display.length > 0};
  }
  // There is always something to eat: when nothing fits yet, show the closest safe recipes
  // (fewest groceries missing), each marked as a near miss with what it still needs.
  if (!cards.length && !ordered.length) {
    const near = all.evaluations
      .filter((r) => r.meal.mode === 'cook' && !passed.includes(r.meal.id) && !(r.meal.suggestion && !r.meal.review?.confirmed) && !r.reasons.some((x) => SAFETY.test(x)))
      .sort((a, b) => missingIngredients(a.meal, state).length - missingIngredients(b.meal, state).length || comparePreferences(a.meal, b.meal, state.profile))
      .slice(0, config.recommendation.maxCards)
      .map((r) => ({...r, nearMiss: true, missing: missingIngredients(r.meal, state)}));
    if (near.length) return {...all, softened: false, nearMiss: true, cards, drafts: ordered, display: near};
  }
  return {...all,softened:false,cards,drafts:ordered,display:[...cards,...ordered].slice(0,config.recommendation.maxCards)};
}
