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
  return {...all,softened:false,cards,drafts:ordered,display:[...cards,...ordered].slice(0,config.recommendation.maxCards)};
}
