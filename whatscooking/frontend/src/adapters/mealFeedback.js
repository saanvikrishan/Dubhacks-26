import {CUISINES,TASTES,cuisineOf,preferenceFit} from '../domain/preferences.js';
import {mealsFor} from '../domain/generatedMeals.js';
import {byId} from '../data/suggestions.js';
import {storageKeys, readStored} from '../domain/branding.js';

const USER_KEY=storageKeys.user;
const SENT_KEY=storageKeys.feedback;
const browserStorage=()=>{try{return globalThis.localStorage??null;}catch{return null;}};

/** Anonymous per-browser id. It scopes Backboard memory but is not an authenticated identity. */
export function getUserId(storage=browserStorage()) {
  try {
    const saved=readStored(storage, USER_KEY);
    if(saved && /^[0-9a-f-]{36}$/.test(saved)) return saved;
    const id=crypto.randomUUID();
    storage?.setItem(USER_KEY,id);
    return id;
  } catch {return null;}
}

/** Explicit chose/logged/skipped event. The event id makes refreshes and re-renders idempotent. */
export function feedbackEvent(kind,meal,{date='',start='',logId=''}={}) {
  if(!meal?.id || !['chose','logged','skipped'].includes(kind)) return null;
  const label=list=>list.find(v=>v.toLowerCase()===cuisineOf(meal));
  const cuisines=(meal.cuisines?.length?meal.cuisines:[label(CUISINES)]).filter(c=>CUISINES.includes(c)).slice(0,2);
  const tastes=(meal.tastes?.length?meal.tastes:TASTES.filter(t=>preferenceFit(meal,{tastes:[t]}).taste)).filter(t=>TASTES.includes(t)).slice(0,3);
  const mainIngredients=[...(meal.ingredients??[])].sort((a,b)=>(b.grams??0)-(a.grams??0)).slice(0,3).map(i=>String(i.name).slice(0,60));
  return {
    kind, eventId:`${kind}:${meal.id}:${logId||`${date}:${start}`}`.slice(0,200),
    mealId:String(meal.id).slice(0,120), name:String(meal.name??'Meal').slice(0,80),
    mode:meal.mode==='eatOut'?'eatOut':'cook', cuisines, tastes, mainIngredients, at:new Date().toISOString(),
  };
}

/** Fire-and-forget. A Backboard failure never blocks planning or logging. */
export async function recordMealFeedback(kind,meal,context={},{fetchImpl=globalThis.fetch,storage=browserStorage()}={}) {
  const event=feedbackEvent(kind,meal,context),user=getUserId(storage);
  if(!event || !user) return 'skipped';
  let sent=[];
  try {sent=JSON.parse(readStored(storage, SENT_KEY)??'[]');} catch { /* start a fresh list */ }
  if(!Array.isArray(sent)) sent=[];
  if(sent.includes(event.eventId)) return 'duplicate';
  try {
    const response=await fetchImpl('/api/food/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,...event}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok || !['saved','duplicate'].includes(result.status)) return result.status??'unavailable';
    try {storage?.setItem(SENT_KEY,JSON.stringify([...sent,event.eventId].slice(-300)));} catch { /* dedupe is best effort */ }
    globalThis.dispatchEvent?.(new CustomEvent('whatscooking.ai-feedback-saved'));
    return 'saved';
  } catch {return 'unavailable';}
}

/** Called after a successful state action: choose / fillMealSlot = chose, log = logged. */
export function recordActionFeedback(action,state) {
  const kind={choose:'chose',fillMealSlot:'chose',log:'logged'}[action?.type];
  if(!kind || !state) return;
  const meal=mealsFor(state)[action.mealId]??byId[action.mealId];
  const slot=action.type==='fillMealSlot'?state.mealPlans?.find(p=>p.id===action.slotId):null;
  const context=kind==='logged'?{logId:action.id}:{date:slot?.date??state.context?.date,start:slot?.start??state.context?.start};
  void recordMealFeedback(kind,meal,context);
}

/** A swipe-left on a meal card. Venue cards (no meal) are ignored. */
export function recordSkip(meal,context={}) {
  if(meal?.id) void recordMealFeedback('skipped',meal,{date:context.date,start:context.start});
}
