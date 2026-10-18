import {comparePreferences} from "./preferences.js";
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
export function discoverCookMeals(catalog,state,{sort='catalog',mood='any',passed=[],preferences=[]}={}) {
  const options={mode:'cook',sort,passed,preferences};
  const all=recommend(catalog.filter(m=>moodFits(m,mood)),state,options,config);
  const cards=all.cards;
  const drafts=catalog.filter(m=>m.mode==='cook' && m.suggestion && !m.review?.confirmed && !passed.includes(m.id) && moodFits(m,mood)).map(meal=>({meal,...evaluate(meal,state)}));
  if(sort==='catalog') drafts.sort((a,b)=>comparePreferences(a.meal,b.meal,state.profile));
  if(sort==='time') drafts.sort((a,b)=> (a.duration??Infinity)-(b.duration??Infinity));
  // Unknown price/protein is never treated as zero or a bargain/high-protein option.
  if(sort==='protein') drafts.sort((a,b)=>(portionNutrition(b.meal).protein_g??-1)-(portionNutrition(a.meal).protein_g??-1));
  return {...all,cards,drafts,display:[...cards,...drafts].slice(0,config.recommendation.maxCards)};
}
