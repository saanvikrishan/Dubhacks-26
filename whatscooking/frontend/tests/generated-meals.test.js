import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState as blankDemoState, testPantry, transition, validateState, today } from '../src/domain/state.js';
import { normalizeGeneratedMeal, mealsFor } from '../src/domain/generatedMeals.js';
import { evaluate, assertMealAction } from '../src/domain/engine.js';
import { discoverCookMeals } from '../src/domain/discovery.js';
import { portionNutrition, dailyNutrition } from '../src/domain/nutrition.js';
import { cookingMinutes, requestRecipeDrafts } from '../src/adapters/recipes.js';
import { clearSuggestions } from '../src/data/suggestions.js';
import { storageAdapter } from '../src/adapters/storage.js';
const raw = (id='gemini-regression') => ({id,name:'Chickpea cucumber salad',description:'Combine ready cooked unsalted chickpeas and raw cucumber.',mode:'cook',ingredients:[{name:'chickpeas',grams:150},{name:'cucumber',grams:100}],equipment:[],timing:{prep:5,cook:0,outbound:0},steps:['Dice cucumber and combine with already cooked chickpeas.'],photo:'chickpeas',review:{confirmed:true},cost:0,allergens:[],diets:['vegan'],nutrition:{values:{protein_g:999}}});
const review = {confirmed:true,cost:2,prep:5,cook:0,equipment:[],dietConfirmed:true,allergensConfirmed:true,allergens:[]};
function reviewed(initial=createDemoState()) {
  const draft=transition(initial,{type:'addGeneratedMeals',meals:[raw()]});
  return transition(draft,{type:'reviewGeneratedMeal',mealId:raw().id,review,pantry:{chickpeas:150,cucumber:100}});
}

test('generated drafts discard remote trust flags, invented costs and model nutrient claims',()=>{
  const m=normalizeGeneratedMeal(raw());assert.equal(m.cost,null);assert.equal(m.allergens,null);assert.equal(m.diets,null);assert.equal(m.review,null);
  assert.ok(Math.abs(portionNutrition(m).protein_g-13.94)<1e-9);
  const unknown=normalizeGeneratedMeal({...raw(),ingredients:[{name:'noodles',grams:100}]});
  assert.ok(Object.values(unknown.nutrition.values).every(v=>v===null));
  assert.throws(()=>normalizeGeneratedMeal({...raw(),ingredients:[{name:'tofu',grams:'100'}]}));
  assert.throws(()=>normalizeGeneratedMeal({...raw(),timing:{prep:-1,cook:2,outbound:0}}));
});
test('drafts are not feasible and review changes only explicitly confirmed stock',()=>{
  const base=createDemoState();const before=structuredClone(base);
  const state=transition(base,{type:'addGeneratedMeals',meals:[raw()]});
  assert.deepEqual(base,before);assert.deepEqual(state.pantry,base.pantry);assert.equal(state.logs.length,0);assert.equal(state.plan,null);
  assert.equal(evaluate(state.generatedMeals[0],state).feasible,false);
  assert.throws(()=>assertMealAction(state.generatedMeals[0],state),/Review/);
  const done=reviewed(); assert.equal(evaluate(done.generatedMeals[0],done).feasible,true);
  assert.deepEqual(done.generatedMeals[0].diets,['vegan','vegetarian']);
  assert.equal(done.generatedMeals[0].allergens,null);
  const peanut=structuredClone(done); peanut.profile.exclusions=['peanut']; peanut.generatedMeals[0].review.allergensConfirmed=false;
  assert.equal(evaluate(peanut.generatedMeals[0],peanut).feasible,false);
  assert.match(evaluate(peanut.generatedMeals[0],peanut).reasons.join(' '),/Allergen information is unknown/);
  const unknownDiet=transition(createDemoState(),{type:'addGeneratedMeals',meals:[{...raw('gemini-unknown-diet'),ingredients:[{name:'mystery sauce',grams:20},{name:'chickpeas',grams:100}]}]});
  // The user's OK settles an unknown diet (unless an ingredient clearly breaks it); without it the diet stays unknown.
  const okayed=transition(unknownDiet,{type:'reviewGeneratedMeal',mealId:'gemini-unknown-diet',review,pantry:{'mystery sauce':20,chickpeas:100}});
  assert.deepEqual(okayed.generatedMeals[0].diets,['vegetarian']);
  const checked=transition(unknownDiet,{type:'reviewGeneratedMeal',mealId:'gemini-unknown-diet',review:{...review,dietConfirmed:false,allergensConfirmed:false},pantry:{'mystery sauce':20,chickpeas:100}});
  assert.equal(checked.generatedMeals[0].diets,null);
  assert.equal(checked.generatedMeals[0].allergens,null);
  assert.equal(checked.generatedMeals[0].review.dietConfirmed,false);
  checked.profile.diet='vegetarian'; checked.profile.exclusions=['peanut'];
  const rejected=evaluate(checked.generatedMeals[0],checked);
  assert.equal(rejected.feasible,false);
  assert.match(rejected.reasons.join(' '),/Dietary suitability is unknown/);
  assert.match(rejected.reasons.join(' '),/Allergen information is unknown/);
  assert.equal(done.pantry.chickpeas,150);assert.equal(done.plan,null);
  assert.throws(()=>transition(state,{type:'reviewGeneratedMeal',mealId:raw().id,review,pantry:{'other food':500}}),/only the ingredients/);
});
test('the original soy + $100 + 135min bypass cannot select a meal',()=>{
  let state=reviewed();state.profile.diet='vegan';state.profile.exclusions=['soy'];state.profile.budget=1;state.context.available=1;
  const m={...state.generatedMeals[0],cost:100,allergens:['soy'],timing:{prep:5,cook:90,outbound:0}};
  state.generatedMeals=[m];
  const result=evaluate(m,state);assert.equal(result.feasible,false);assert.match(result.reasons.join(),/excluded soy/);assert.match(result.reasons.join(),/above/);assert.match(result.reasons.join(),/135 minutes/);
  assert.throws(()=>transition(state,{type:'choose',mealId:m.id}));assert.equal(state.plan,null);
});
test('reviewed generated meals enforce every hard rule and stale previews are rechecked',()=>{
  const start=reviewed();const m=start.generatedMeals[0];
  for(const change of [s=>s.pantry.chickpeas=149,s=>s.profile.budget=1,s=>s.profile.cooking=false,s=>s.context.available=1,s=>{s.generatedMeals[0].equipment=['stove'];s.profile.equipment=[];},s=>{s.generatedMeals[0].diets=['vegetarian'];s.profile.diet='vegan';},s=>{s.generatedMeals[0].allergens=null;s.generatedMeals[0].review.allergensConfirmed=false;s.profile.exclusions=['peanut'];},s=>s.events=[{id:'busy',title:'Class',start:`${today()}T12:00:00-07:00`,end:`${today()}T13:00:00-07:00`,busy:true,kind:'class'}]]) {
    const s=structuredClone(start);change(s);assert.equal(evaluate(s.generatedMeals[0],s).feasible,false);assert.throws(()=>transition(s,{type:'choose',mealId:m.id}));
  }
});
test('selection, replacement, logging, reload and a later generation preserve original recipe nutrition',()=>{
  let s=reviewed();s=transition(s,{type:'choose',mealId:raw().id});
  s=transition(s,{type:'log',id:'ate',mealId:raw().id,date:today(),servings:0.5});
  const total=dailyNutrition(s.logs,mealsFor(s),today()).protein_g.value;
  s=transition(s,{type:'addGeneratedMeals',meals:[raw('gemini-second')]});
  // Re-generating a known recipe must not reset its review or alter logged nutrition.
  s=transition(s,{type:'addGeneratedMeals',meals:[raw()]});assert.equal(s.generatedMeals.find(m=>m.id===raw().id).review.confirmed,true);
  clearSuggestions();s=validateState(JSON.parse(JSON.stringify(s)));assert.equal(dailyNutrition(s.logs,mealsFor(s),today()).protein_g.value,total);
  assert.equal(s.plan.mealId,raw().id);assert.ok(total>0);
  assert.throws(()=>transition(s,{type:'reviewGeneratedMeal',mealId:raw().id,review,pantry:{}}),/preserved/);
});
test('browser storage roundtrip works without an in-memory generated recipe registry',()=>{
  const records=new Map();const storage={getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
  const s=transition(reviewed(),{type:'choose',mealId:raw().id});storageAdapter.save(storage,s);clearSuggestions();
  const loaded=storageAdapter.load(storage);assert.equal(loaded.error,null);assert.equal(loaded.state.plan.mealId,raw().id);assert.equal(loaded.state.generatedMeals[0].cost,2);
});
test('discovery separates drafts from feasible cards and never falls back to rejected meals',()=>{
  let s=transition(createDemoState(),{type:'addGeneratedMeals',meals:[raw()]});
  let result=discoverCookMeals(s.generatedMeals,s);assert.equal(result.cards.length,0);assert.equal(result.drafts.length,1);assert.equal(result.display[0].feasible,false);
  s=reviewed();result=discoverCookMeals(s.generatedMeals,s);assert.equal(result.cards.length,1);assert.equal(result.drafts.length,0);
  s.context.available=1;result=discoverCookMeals(s.generatedMeals,s);assert.equal(result.display.length,0);assert.ok(result.evaluations[0].reasons.length);
});
test('priority and mood use the same engine for generated recipes, with unknown protein last',()=>{
  const s=reviewed(),a=s.generatedMeals[0];
  const b={...structuredClone(a),id:'gemini-fast',cost:4,timing:{prep:1,cook:0,outbound:0},nutrition:{...a.nutrition,values:{...a.nutrition.values,protein_g:null}}};
  assert.equal(discoverCookMeals([a,b],s,{sort:'cost'}).cards[0].meal.id,a.id);
  assert.equal(discoverCookMeals([a,b],s,{sort:'time'}).cards[0].meal.id,b.id);
  assert.equal(discoverCookMeals([b,a],s,{sort:'protein'}).cards[0].meal.id,a.id);
  assert.equal(discoverCookMeals([a,b],s,{mood:'hungry'}).cards.length,2);
  assert.equal(discoverCookMeals([a,b],s,{mood:'hungry'}).softened,true);
});
test('request cooking time excludes all overhead and unknown or invalid backend records fail closed',async()=>{
  const s=createDemoState();assert.equal(cookingMinutes(s),25);
  let payload;
  const response=await requestRecipeDrafts({state:s,ingredients:['chickpeas'],pantry:{chickpeas:150},fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({meals:[raw()]})};}});
  assert.equal(payload.time,25);assert.equal(payload.budget,s.profile.budget);assert.deepEqual(payload.equipment,s.profile.equipment);assert.equal(response[0].cost,null);
  await assert.rejects(()=>requestRecipeDrafts({state:s,ingredients:[],fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({meals:[{name:'broken'}]})})}));
  const short=structuredClone(s);short.context.available=5;let called=false;
  await assert.rejects(()=>requestRecipeDrafts({state:short,ingredients:[],fetchImpl:async()=>{called=true;}}),/No cooking time/);assert.equal(called,false);
});
test('infeasible generated meals can still be logged as actual consumption without being planned',()=>{
  let s=transition(createDemoState(),{type:'addGeneratedMeals',meals:[raw()]});s.context.available=1;
  s=transition(s,{type:'log',id:'actual',mealId:raw().id,date:today(),servings:1});
  assert.equal(s.logs.length,1);assert.equal(s.plan,null); // Consumption is history, not a recommendation.
  s=transition(s,{type:'removeLog',id:'actual'});s=transition(s,{type:'undoLog'});assert.equal(s.logs.length,1);
});

function createDemoState() { const s = blankDemoState(); s.pantry = {...testPantry}; s.context.onward=5; s.context.buffer=10; return s; }
