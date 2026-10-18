import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState as blankDemoState, testPantry, transition, validateState} from '../src/domain/state.js';
import {byId} from '../src/data/catalog.js';
import {dailyNutrition, portionNutrition} from '../src/domain/nutrition.js';
import {storageAdapter} from '../src/adapters/storage.js';
import {evaluate} from '../src/domain/engine.js';
import {discoverCookMeals} from '../src/domain/discovery.js';
import {knownPresentAllergens} from '../src/domain/allergens.js';
import {buildSourcedCatalog} from '../src/data/sourcedCatalog.js';
import {withSourcedWalking, currentWalking} from '../src/domain/uwDining.js';
import {HUB, distanceMeters, uwDining} from '../src/data/uwDining.js';
import {createWalkingStore} from '../src/adapters/uwWalking.js';
const date='2026-10-17';
function demo() {const s=createDemoState();Object.assign(s.context,{date,start:'12:00',available:180,commitmentTime:'15:00'});return s;}
const planFields=s=>structuredClone({plan:s.plan,previousPlan:s.previousPlan,mealPlans:s.mealPlans,planUndo:s.planUndo});
function reload(s) {const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};storageAdapter.save(storage,s);const loaded=storageAdapter.load(storage);assert.equal(loaded.error,null);return loaded.state;}
const log={type:'log',id:'actual-half',mealId:'tofu-bowl',servings:0.5,date,confirmedAt:'2026-10-17T12:35:00-07:00'};

test('regression: confirmation at 12:35 and half portions never block a previously feasible 13:00 meal',()=>{
  let s=transition(demo(),{type:'choose',mealId:'tofu-bowl'});
  const plans=planFields(s);
  s=transition(s,{type:'updateContext',context:{start:'13:00',available:120}});
  assert.equal(evaluate(byId['chickpea-bowl'],s).feasible,true);
  s=transition(s,log);assert.deepEqual(planFields(s),plans);
  assert.equal(s.logs[0].servings,0.5);assert.equal(evaluate(byId['chickpea-bowl'],s).feasible,true);
  const intake=dailyNutrition(s.logs,byId,date).energy_kcal.value;
  assert.equal(intake,portionNutrition(byId['tofu-bowl'],0.5).energy_kcal);
  s=reload(s);assert.deepEqual(planFields(s),plans);assert.equal(evaluate(byId['chickpea-bowl'],s).feasible,true);
  assert.equal(dailyNutrition(s.logs,byId,date).energy_kcal.value,intake);
});

test('log edits, removals and undo preserve every plan and plan-undo field, including legacy records',()=>{
  let s=transition(demo(),{type:'choose',mealId:'tofu-bowl'});
  const legacy={...s.plan,id:'log:legacy',start:'16:00',fromLog:true};s.mealPlans.push(legacy);
  const plans=planFields(s);
  s=transition(s,log);
  for(const action of [
    {type:'editLog',id:log.id,mealId:log.mealId,date,servings:0.75,confirmedAt:'2026-10-17T12:50:00-07:00'},
    {type:'undoLog'}, {type:'removeLog',id:log.id}, {type:'undoLog'},
  ]) {s=transition(s,action);assert.deepEqual(planFields(s),plans);s=reload(s);assert.deepEqual(planFields(s),plans);}
  assert.equal(s.logs[0].servings,0.5);
  // Old persisted undo metadata must not delete/restore plans now.
  s.logUndo={id:log.id,before:null,removedPlanId:'log:legacy',beforePlan:legacy};
  s=transition(s,{type:'undoLog'});assert.deepEqual(planFields(s),plans);assert.equal(s.logs.length,0);
  assert.ok(validateState(s).mealPlans.some(p=>p.id==='log:legacy'));
});

const raw={id:'gemini-allergen-audit',name:'Chickpea salad',description:'Test fixture recipe draft.',ingredients:[{name:'chickpeas',grams:150},{name:'cucumber',grams:100}],equipment:[],timing:{prep:5,cook:0,outbound:0},steps:['Combine the measured ingredients.']};
function generated(list,confirmed) {
  let s=transition(demo(),{type:'addGeneratedMeals',meals:[raw]});
  s=transition(s,{type:'reviewGeneratedMeal',mealId:raw.id,pantry:{chickpeas:300,cucumber:200},review:{confirmed:true,cost:2,prep:5,cook:0,equipment:[],allergens:list,allergensConfirmed:confirmed,dietConfirmed:true}});
  return s;
}

test('null, empty and soy-present/peanut-unknown generated coverage cannot pass discovery or selection',()=>{
  // New restrictions require a fresh review; an earlier confirmation cannot cover newly added allergies.
  const ok=generated(['soy'],true);ok.profile.exclusions=['peanut'];
  assert.equal(evaluate(ok.generatedMeals[0],ok).feasible,false);
  assert.match(evaluate(ok.generatedMeals[0],ok).reasons.join(),/Allergen information is unknown/);
  const peanut=generated(['peanut'],true);peanut.profile.exclusions=['peanut'];
  assert.match(evaluate(peanut.generatedMeals[0],peanut).reasons.join(),/Contains excluded peanut/);
  for(const confirmed of [false]) for(const list of [[],['soy']]) {
    const s=generated(list,confirmed);s.profile.exclusions=['peanut'];
    const meal=s.generatedMeals[0];assert.equal(meal.allergens,null);assert.deepEqual(knownPresentAllergens(meal),list);
    assert.equal(evaluate(meal,s).feasible,false);assert.match(evaluate(meal,s).reasons.join(),/Allergen information is unknown/);
    assert.equal(discoverCookMeals(s.generatedMeals,s).cards.length,0);
    assert.throws(()=>transition(s,{type:'choose',mealId:meal.id}),/Allergen information is unknown/);
  }
  const legacy=generated(['soy'],false);legacy.generatedMeals[0].allergens=['soy'];legacy.profile.exclusions=['peanut'];
  assert.throws(()=>transition(reload(legacy),{type:'choose',mealId:raw.id}),/Allergen information is unknown/);
  legacy.profile.exclusions=['soy'];assert.match(evaluate(legacy.generatedMeals[0],legacy).reasons.join(),/Contains excluded soy/);
});

test('sourced partial/empty/null lists never prove peanut absence',()=>{
  const s=demo();s.profile.exclusions=['peanut'];
  const base=buildSourcedCatalog({cookCostQuotes:{'sourced-tofu-rice-bowl':{value:2,source:'test fixture',checkedAt:date}}})[0];
  for(const list of [null,[],['soy']]) {const meal={...base,allergens:list};assert.match(evaluate(meal,s).reasons.join(),/Allergen information is unknown/);assert.equal(discoverCookMeals([meal],s).cards.length,0);}
});

test('actual consumption remains loggable despite unknown allergy information and impossible future feasibility',()=>{
  let s=generated(['soy'],false);s.profile.exclusions=['peanut'];s.context.available=1;
  s=transition(s,{type:'log',id:'history',mealId:raw.id,servings:0.5,date,confirmedAt:log.confirmedAt});
  assert.equal(s.logs.length,1);assert.equal(s.plan,null);assert.deepEqual(s.mealPlans,[]);
  const roundtrip=reload(s);assert.equal(roundtrip.generatedMeals[0].id,raw.id);assert.equal(roundtrip.logs[0].servings,0.5);
});

const clock=Date.now();
const route=(venueId,seconds=90,at=clock)=>({venueId,status:'verified',durationSeconds:seconds,distanceMeters:123,travelMode:'WALK',origin:HUB,checkedAt:new Date(at).toISOString(),source:'Google Routes API'});
test('legacy sourced copies reuse only exact venue walking facts; cook, price, hours and district stay unchanged',()=>{
  const records=buildSourcedCatalog(),before=structuredClone(records),s=demo();
  const routes=[route('local-point',61),route('center-table',60)];
  for(const record of records) {
    const meal=withSourcedWalking(record,routes,clock);
    if(meal.mode==='cook') {assert.equal(meal.timing.outbound,0);continue;}
    if(meal.venue.name==='District Market') assert.equal(meal.timing.outbound,null);
    else {
      assert.equal(meal.timing.outbound,meal.venue.name==='Center Table'?1:2);
      assert.equal(meal.provenance.fields.walking.distanceMeters,123);
      assert.deepEqual(meal.provenance.fields.walking.origin,HUB);
      assert.equal(meal.provenance.fields.walking.checkedAt,new Date(clock).toISOString());
      const place=uwDining.find(v=>v.name===meal.venue.name);assert.notEqual(distanceMeters(place),123);
    }
    assert.equal(meal.cost,null);assert.equal(meal.venue.opens,null);assert.equal(meal.venue.closes,null);
    const result=evaluate(meal,s);assert.equal(result.feasible,false);assert.match(result.reasons.join(),/Cost is unknown/);assert.match(result.reasons.join(),/Venue hours are unknown/);
  }
  assert.deepEqual(records,before);
  const pizza=records.find(m=>m.venue?.name==='Local Point');
  assert.equal(withSourcedWalking(pizza,routes,clock+300001).timing.outbound,null);
});

test('fake walking transport: coalescing and failed refreshes preserve timestamps without extending expiry',async()=>{
  let calls=0;
  const fact=route('local-point');
  const store=createWalkingStore(async(url,options)=>{
    assert.equal(url,'/api/dining/walking');assert.equal(options.method,'POST');calls++;
    if(calls===1)return {ok:true,json:async()=>({status:'verified',routes:[fact],checkedAt:fact.checkedAt})};
    if(calls===2)return {ok:true,json:async()=>({status:'api_rejected',routes:[{venueId:'local-point',status:'unknown'}]})};
    throw new Error('test network failure');
  });
  await Promise.all([store.refresh(),store.refresh()]);assert.equal(calls,1);
  await store.refresh();assert.equal(store.getSnapshot().status,'unavailable');
  await store.refresh();assert.equal(store.getSnapshot().routes[0].checkedAt,fact.checkedAt);
  assert.equal(currentWalking(store.getSnapshot().routes[0],clock+300001),null);
  assert.equal(withSourcedWalking(buildSourcedCatalog().find(m=>m.venue?.name==='Local Point'),store.getSnapshot().routes,clock+300001).timing.outbound,null);
});

function createDemoState() { const s = blankDemoState(); s.pantry = {...testPantry}; s.context.onward=5; s.context.buffer=10; return s; }
