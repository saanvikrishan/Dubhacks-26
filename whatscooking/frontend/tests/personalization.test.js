import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../src/data/catalog.js';
import {createDemoState,testPantry} from '../src/domain/state.js';
import {recommend,evaluate} from '../src/domain/engine.js';
import {comparePreferences,cuisineOf,learnedProfile,varied} from '../src/domain/preferences.js';
import {normalizeGeneratedMeal} from '../src/domain/generatedMeals.js';
import {feedbackEvent,recordMealFeedback,getUserId} from '../src/adapters/mealFeedback.js';
import {requestRecipeDrafts} from '../src/adapters/recipes.js';

const memoryStorage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};};
const state=()=>{const s=createDemoState();s.pantry={...testPantry};s.profile.diet='anything';s.profile.budget=20;return s;};
const learned=(extra)=>learnedProfile({events:3,likedCuisines:[],likedTastes:[],likedIngredients:[],avoidCuisines:[],repeatedlySkipped:[],...extra});

test('feedback events are explicit, labelled and idempotent across re-renders and refreshes',async()=>{
  const pasta=catalog.find(m=>m.id==='tomato-pasta');
  const event=feedbackEvent('chose',pasta,{date:'2026-10-18',start:'12:00'});
  assert.equal(event.eventId,'chose:tomato-pasta:2026-10-18:12:00');
  assert.deepEqual(event.cuisines,['Italian']);assert.equal(event.mode,'cook');
  assert.equal(feedbackEvent('opened',pasta),null);assert.equal(feedbackEvent('chose',null),null);
  const storage=memoryStorage();let calls=0;
  const fetchImpl=async(url,options)=>{calls++;assert.equal(url,'/api/food/feedback');const body=JSON.parse(options.body);assert.equal(body.user,getUserId(storage));return {ok:true,json:async()=>({status:'saved'})};};
  assert.equal(await recordMealFeedback('chose',pasta,{date:'2026-10-18',start:'12:00'},{fetchImpl,storage}),'saved');
  assert.equal(await recordMealFeedback('chose',pasta,{date:'2026-10-18',start:'12:00'},{fetchImpl,storage}),'duplicate');
  assert.equal(calls,1);
  assert.equal(getUserId(storage),getUserId(storage));
});

test('Backboard or network failures never throw into planning',async()=>{
  const pasta=catalog.find(m=>m.id==='tomato-pasta');
  const result=await recordMealFeedback('logged',pasta,{logId:'l1'},{fetchImpl:async()=>{throw new Error('offline');},storage:memoryStorage()});
  assert.equal(result,'unavailable');
});

test('avoided cuisines rank last and explicit preferences outrank learned history',()=>{
  const pasta=catalog.find(m=>m.id==='tomato-pasta'),rice=catalog.find(m=>m.id==='garlic-rice');
  assert.ok(comparePreferences(pasta,rice,{avoidCuisines:['Italian']})>0);
  const s=state();s.profile.preferred='';s.profile.cuisines=['Chinese'];
  const pair=catalog.filter(m=>['garlic-rice','tomato-pasta'].includes(m.id));
  const order=recommend(pair,s,{mode:'cook',preferences:learned({likedCuisines:['Italian']})}).cards.map(r=>cuisineOf(r.meal));
  assert.deepEqual(order,['chinese','italian']);
});

test('learned likes only reorder feasible meals and never promote an allergen (Scenario D)',()=>{
  const s=state();s.profile.exclusions=['wheat'];
  const cook=catalog.filter(m=>m.mode==='cook');
  const result=recommend(cook,s,{mode:'cook',preferences:learned({likedCuisines:['Italian'],likedIngredients:['dry pasta']})});
  assert.ok(result.cards.every(r=>r.feasible && !(r.meal.allergens??[]).includes('wheat')));
  assert.ok(!result.cards.some(r=>r.meal.id==='tomato-pasta'));
  assert.equal(evaluate(catalog.find(m=>m.id==='tomato-pasta'),s).feasible,false);
});

test('learned history can lift a feasible meal and explains why',()=>{
  const s=state();s.profile.preferred='';
  const cook=catalog.filter(m=>m.mode==='cook');
  const plain=recommend(cook,s,{mode:'cook'}).evaluations.filter(r=>r.feasible).map(r=>r.meal.id);
  assert.ok(plain.includes('tomato-pasta'));
  const lifted=recommend(cook,s,{mode:'cook',preferences:learned({likedCuisines:['Italian']})});
  assert.equal(lifted.cards[0].meal.id,'tomato-pasta');
  assert.match(lifted.cards[0].preferenceReason,/picked before/);
});

test('top picks stay varied: at most two of one cuisine in the first three',()=>{
  const meal=(id,cuisine)=>({meal:{id,name:id,cuisines:[cuisine]}});
  const ordered=varied([meal('a','Korean'),meal('b','Korean'),meal('c','Korean'),meal('d','Thai')]);
  assert.deepEqual(ordered.slice(0,3).map(r=>r.meal.id),['a','b','d']);
});

test('recipe requests carry the anonymous user id and avoided cuisines; drafts keep only valid labels',async()=>{
  const s=state();s.profile.avoidCuisines=['Thai','Martian'];
  let body;
  await requestRecipeDrafts({state:s,ingredients:['tofu'],fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({meals:[]})};}});
  assert.match(body.userId,/^[0-9a-f-]{36}$/);assert.deepEqual(body.avoidCuisines,['Thai']);
  const raw={id:'gemini-abc123',name:'Kimchi tofu stew',description:'Spicy stew.',mode:'cook',ingredients:[{name:'tofu',grams:150}],equipment:[],timing:{prep:5,cook:10,outbound:0},steps:['Simmer.'],photo:'tofu',nutrition:{basis:'per_serving'}};
  assert.deepEqual(normalizeGeneratedMeal({...raw,cuisines:['Korean'],tastes:['Spicy','Weird']}).cuisines,['Korean']);
  assert.deepEqual(normalizeGeneratedMeal({...raw,cuisines:['Korean'],tastes:['Spicy','Weird']}).tastes,['Spicy']);
  assert.deepEqual(normalizeGeneratedMeal({...raw,cuisines:['Martian']}).cuisines,[]);
});
