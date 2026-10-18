import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {uwCatalog, prepareUwDiningMeal} from "../src/domain/uwDining.js";
import {evaluate, recommend} from "../src/domain/engine.js";
import {createDemoState as blankDemoState, testPantry} from "../src/domain/state.js";
import {HUB} from "../src/data/uwDining.js";
import {buildUwSnapshot} from "../src/adapters/uwCatalog.js";
import {catalog} from "../src/data/catalog.js";
function fixture() {
  const state=createDemoState();
  Object.assign(state.context,{date:"2026-10-17",start:"12:00",commitmentTime:"14:00",available:120,service:10,eating:20});
  state.events=[];state.mealPlans=[];state.profile.goals=[];state.profile.exclusions=[];
  const raw=structuredClone(uwCatalog.menu.find(m=>m.name==="Cheese" && m.provenance.menu.page===30));
  const route={venueId:"local-point",status:"verified",durationSeconds:90,distanceMeters:123,travelMode:"WALK",origin:HUB,checkedAt:new Date().toISOString()};
  return {state,meal:prepareUwDiningMeal(raw,state,[route]).meal};
}
test("UW treats daily nutrition goals as progress and keeps unpublished protein unknown",()=>{
  const {state,meal}=fixture();
  state.profile.goals=[{nutrient:"carbohydrate_g",mode:"minimum",value:300},{nutrient:"sodium_mg",mode:"maximum",value:500},{nutrient:"protein_g",mode:"minimum",value:100}];
  const result=evaluate(meal,state);
  assert.equal(result.feasible,true);
  assert.equal(result.dailyGoals[0].remaining,300);
  assert.equal(result.dailyGoals[0].supportsMinimum,true);
  assert.equal(result.dailyGoals[1].withinRemainingCap,false);
  assert.equal(result.dailyGoals[2].mealValue,null);
  assert.equal(result.dailyGoals[2].supportsMinimum,null);
});

test("UW import rejects venue/source mismatches without changing real import counts",()=>{
  const dir=new URL("../src/data/uw/",import.meta.url);
  const snapshot=JSON.parse(readFileSync(new URL("snapshot.json",dir))),review=JSON.parse(readFileSync(new URL("reviewed.json",dir)));
  assert.equal(buildUwSnapshot(snapshot,review).nutrition.length,832);
  review.menuEntries[0].venueId="center-table";
  assert.throws(()=>buildUwSnapshot(snapshot,review),/venue does not match/);
});
test("UW engine caps exact-duplicate choices and keeps prepared facts and audit rows",()=>{
  const {state,meal}=fixture(), before=structuredClone(meal);
  const duplicate={...structuredClone(meal),id:"test-only-duplicate"};
  const result=recommend([meal,duplicate],state,{mode:"eatOut"});
  assert.equal(result.cards.length,1);assert.equal(result.feasibleCount,1);assert.equal(result.evaluations.length,2);
  assert.equal(result.cards[0].meal.timing.outbound,2);assert.equal(result.cards[0].meal.dining.route.distanceMeters,123);
  assert.deepEqual(meal,before);
  const choices=Array.from({length:5},(_,i)=>({...structuredClone(meal),id:`test-only-${i}`,cost:3+i}));
  assert.equal(recommend(choices,state,{mode:"eatOut"}).cards.length,3);
  assert.equal(recommend(choices,state,{mode:"eatOut"}).feasibleCount,5);
});
test("UW-specific deduplication leaves Cook recommendation choices unchanged",()=>{
  const {state}=fixture();
  const result=recommend(catalog,state,{mode:"cook"});
  assert.ok(result.cards.every(r=>r.meal.mode==="cook"));
  assert.ok(result.cards.length>0 && result.cards.length<=3);
  assert.equal(result.feasibleCount,result.evaluations.filter(r=>r.feasible&&r.meal.mode==="cook").length);
});

function createDemoState() { const s = blankDemoState(); s.pantry = {...testPantry}; s.context.onward=5; s.context.buffer=10; return s; }
