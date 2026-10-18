import {foodPreferences} from "../domain/preferences.js";
import {getUserId} from './mealFeedback.js';
import {minutes} from '../domain/engine.js';
import {normalizeGeneratedMeal} from '../domain/generatedMeals.js';
import {photoRequestFor} from '../ui/format.js';
export function cookingMinutes(state) {
  const c=state.context;
  return Math.max(0,Math.min(c.available,minutes(c.commitmentTime)-minutes(c.start))-c.eating-c.cleanup-c.onward-c.buffer);
}

function recipeBody({state,ingredients,pantry={},exclude=[]}) {
  const time=cookingMinutes(state);
  if (time<1) throw new Error('No cooking time remains after eating, cleanup, travel and buffer. Adjust your meal window first.');
  return {...foodPreferences(state.profile),userId:getUserId(),exclude:[...new Set(exclude)].slice(-40),ingredients,pantry,diet:state.profile.diet,time,budget:state.profile.budget,equipment:state.profile.equipment,exclusions:state.profile.exclusions};
}

async function sendRecipeRequest(body,fetchImpl,signal) {
  const response=await fetchImpl('/api/recipes',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(body)});
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

// Batches requested ahead of time (the server also pre-draws their photos). A later request with
// the same inputs uses the prepared batch once instead of waiting. The exclude list is not part of
// the key: a batch prepared a moment earlier already avoids everything shown at that time.
const prepared=new Map();
const PREPARED_FOR_MS=10*60*1000;
const preparedKey=body=>JSON.stringify({...body,exclude:undefined,prepare:undefined});

// A prepared batch has no photos yet (to save cost); start all of them the moment it is opened.
function predrawPhotos(meals,fetchImpl) {
  const requests=meals.map(photoRequestFor).filter(Boolean).slice(0,8);
  if(requests.length) fetchImpl('/api/food/image/predraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})}).catch(()=>{});
}

export function prepareRecipeDrafts(args,{fetchImpl=globalThis.fetch}={}) {
  let body;
  try {body=recipeBody(args);} catch {return false;}
  const key=preparedKey(body),existing=prepared.get(key);
  if(existing && Date.now()-existing.at<PREPARED_FOR_MS) return false;
  const promise=sendRecipeRequest({...body,prepare:true},fetchImpl,AbortSignal.timeout(60000));
  promise.catch(()=>prepared.delete(key));
  prepared.set(key,{promise,at:Date.now()});
  return true;
}

/** Two cards before the end: start the prepared batch's photos so "More ideas" opens on loaded photos. */
export function startPreparedPhotos(args,{fetchImpl=globalThis.fetch}={}) {
  let body;
  try {body=recipeBody(args);} catch {return false;}
  const ready=prepared.get(preparedKey(body));
  if(!ready || ready.photosStarted) return false;
  ready.photosStarted=true;
  ready.promise.then(meals=>predrawPhotos(meals,fetchImpl),()=>{});
  return true;
}

/** exclude: names already suggested, so a "more ideas" request returns new recipes. */
export async function requestRecipeDrafts({state,ingredients,pantry={},exclude=[],fetchImpl=globalThis.fetch,signal}) {
  const body=recipeBody({state,ingredients,pantry,exclude});
  const key=preparedKey(body),ready=prepared.get(key);
  if(ready && Date.now()-ready.at<PREPARED_FOR_MS) {
    prepared.delete(key);
    try {
      const meals=await ready.promise;
      if(meals.length) {predrawPhotos(meals,fetchImpl);return meals;}
    } catch { /* the prepared request failed; ask again below */ }
  }
  return sendRecipeRequest(body,fetchImpl,signal);
}

/**
 * Work done when the Cook screen opens, before anything is clicked:
 * - the server draws photos of everyday dishes this user is likely to get (ordered by Backboard memory);
 * - a returning user with Backboard history gets a batch from their saved pantry prepared, so
 *   "Suggest from my saved pantry" is instant (same inputs as that button).
 */
let warmedFor=null;
export async function prepareCook(state,{fetchImpl=globalThis.fetch}={}) {
  const user=getUserId();
  if(warmedFor!==user) {
    warmedFor=user;
    fetchImpl('/api/food/image/warm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,cuisines:state.profile.cuisines??[]})}).catch(()=>{});
  }
  const names=Object.keys(state.pantry??{}).filter(k=>state.pantry[k]>0).slice(0,30);
  if(!names.length) return false;
  // At most once a day for the same pantry: recipes only, so a reload never repeats the cost.
  const today=new Date().toISOString().slice(0,10),mark=`${today}:${JSON.stringify(names.map(n=>[n,state.pantry[n]]))}`;
  try {if(globalThis.localStorage?.getItem('daywell-pantry-prepared')===mark) return false;} catch { /* storage unavailable */ }
  try {
    const response=await fetchImpl(`/api/food/preferences?user=${user}`,{signal:AbortSignal.timeout(8000)});
    const data=await response.json();
    if(!response.ok || (data.learned?.events??0)<3) return false;
  } catch {return false;}
  try {globalThis.localStorage?.setItem('daywell-pantry-prepared',mark);} catch { /* storage unavailable */ }
  return prepareRecipeDrafts({state,ingredients:names,pantry:Object.fromEntries(names.map(n=>[n,state.pantry[n]]))},{fetchImpl});
}
