import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState, transition} from '../src/domain/state.js';
import {storageAdapter} from '../src/adapters/storage.js';
import {evaluate} from '../src/domain/engine.js';
import {normalizeGeneratedMeal} from '../src/domain/generatedMeals.js';
import {excludedInIngredients} from '../src/domain/allergens.js';
import {discoverCookMeals} from '../src/domain/discovery.js';
import {requestRecipeDrafts} from '../src/adapters/recipes.js';
import {planTurn} from '../src/adapters/agent.js';

const raw=(name='cucumber')=>({id:'gemini-final-'+name.replace(/[^a-z]/g,''),name:'Simple salad',description:'A measured salad.',ingredients:[{name,grams:100}],equipment:[],timing:{prep:5,cook:0,outbound:0},steps:['Slice and serve.'],tastes:['Fresh']});
const review={confirmed:true,cost:null,prep:5,cook:0,equipment:[],dietConfirmed:true,allergensConfirmed:true,allergens:[]};
function state(){const s=createDemoState();s.profile={...s.profile,diet:'anything',budget:null,exclusions:['kiwi']};return s;}

test('custom allergies and an explicitly cleared budget survive save, reload and removal',()=>{
 let s=state();s=transition(s,{type:'updateProfile',profile:{...s.profile,exclusions:[' Kiwi ','Peanuts','kiwi']}});
 assert.deepEqual(s.profile.exclusions,['kiwi','peanut']);
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 storageAdapter.save(storage,s);s=storageAdapter.load(storage).state;
 assert.equal(s.profile.budget,null);assert.deepEqual(s.profile.exclusions,['kiwi','peanut']);
 s=transition(s,{type:'updateProfile',profile:{...s.profile,exclusions:[]}});storageAdapter.save(storage,s);
 assert.deepEqual(storageAdapter.load(storage).state.profile.exclusions,[]);
});
test('custom positive allergies cannot be reviewed or recommended; unknown absence stays blocked',()=>{
 let s=transition(state(),{type:'addGeneratedMeals',meals:[raw('kiwi')]});
 assert.throws(()=>transition(s,{type:'reviewGeneratedMeal',mealId:s.generatedMeals[0].id,review,pantry:{kiwi:100}}),/excluded kiwi/);
 assert.equal(discoverCookMeals(s.generatedMeals,s,{mood:'comfort',flavor:'Spicy'}).display.length,0);
 const known={...normalizeGeneratedMeal(raw()),review:null,suggestion:false,nutrition:{kind:'demo'},allergens:[],provenance:undefined,dietary:undefined};
 assert.match(evaluate(known,s).reasons.join(' '),/Allergen information is unknown/);
 assert.deepEqual(excludedInIngredients([{name:'kiwis'}],['kiwi']),['kiwi']);
 assert.deepEqual(excludedInIngredients([{name:'eggplant'}],['egg']),[]);
 assert.deepEqual(excludedInIngredients([{name:'apple'}],['.*']),[]);
});
test('no budget limit permits unknown price without inventing one, while a numeric cap still blocks',()=>{
 let s=transition(state(),{type:'addGeneratedMeals',meals:[raw()]});
 s=transition(s,{type:'reviewGeneratedMeal',mealId:s.generatedMeals[0].id,review,pantry:{cucumber:100}});
 assert.equal(s.generatedMeals[0].cost,null);assert.equal(evaluate(s.generatedMeals[0],s).feasible,true);
 s.profile.budget=10;assert.equal(evaluate(s.generatedMeals[0],s).feasible,false);
 s.profile.budget=null;s.profile.exclusions.push('celery');assert.equal(evaluate(s.generatedMeals[0],s).feasible,false);
});
test('soft filters broaden locally but never bypass mandatory eligibility',()=>{
 let s=transition(state(),{type:'addGeneratedMeals',meals:[raw()]});
 s=transition(s,{type:'reviewGeneratedMeal',mealId:s.generatedMeals[0].id,review,pantry:{cucumber:100}});
 const result=discoverCookMeals(s.generatedMeals,s,{mood:'comfort',flavor:'Spicy'});
 assert.equal(result.softened,true);assert.equal(result.cards.length,1);
 s.context.available=1;assert.equal(discoverCookMeals(s.generatedMeals,s,{mood:'comfort',flavor:'Spicy'}).display.length,0);
});
test('custom restrictions and null budget reach the recipe API once, with no paid empty-result retry',async()=>{
 let calls=0,body;
 assert.deepEqual(await requestRecipeDrafts({state:state(),ingredients:['cucumber'],fetchImpl:async(url,opt)=>{calls++;body=JSON.parse(opt.body);return {ok:true,text:async()=>'{"meals":[]}'};}}),[]);
 assert.equal(calls,1);assert.equal(body.budget,null);assert.deepEqual(body.exclusions,['kiwi']);
});
test('assistant can clear the budget and add or remove a custom allergy through the state machine',()=>{
 const s=createDemoState();const plan=planTurn(s,[{tool:'update_preferences',args:{budget:null,allergies_add:[' Kiwi ']}}]);
 assert.equal(plan.ok,true);assert.equal(plan.preview.profile.budget,null);assert.deepEqual(plan.preview.profile.exclusions,['kiwi']);
 const removed=planTurn(plan.preview,[{tool:'update_preferences',args:{allergies_remove:['kiwi']}}]);
 assert.equal(removed.ok,true);assert.deepEqual(removed.preview.profile.exclusions,[]);
});
