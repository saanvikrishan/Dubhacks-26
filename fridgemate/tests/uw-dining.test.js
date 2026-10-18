import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {buildUwSnapshot} from "../server/uw-build.js";
import {uwCatalog, prepareUwDiningMeal, stationHours, currentWalking} from "../src/domain/uwDining.js";
import {createDemoState} from "../src/domain/state.js";
import {evaluate} from "../src/domain/engine.js";
import {HUB, venueHours, uwDining} from "../src/data/uwDining.js";
const snapshot = JSON.parse(readFileSync(new URL("../src/data/uw/snapshot.json", import.meta.url)));
const reviews = JSON.parse(readFileSync(new URL("../src/data/uw/reviewed.json", import.meta.url)));
const checkedAt = new Date().toISOString();
const route = {venueId:"local-point", status:"verified", durationSeconds:90,distanceMeters:120,travelMode:"WALK",origin:HUB,checkedAt};
const pizza = () => structuredClone(uwCatalog.menu.find(m=>m.name==="Cheese" && m.provenance.menu.page===30));
function state() {const s=createDemoState();s.context.date="2026-10-17";s.context.start="12:00";s.context.commitmentTime="14:00";s.context.available=120;s.context.service=10;s.context.eating=20;s.events=[];s.mealPlans=[];s.profile.goals=[];s.profile.exclusions=[];return s;}

test("UW full source snapshot: counts, checksums and normalized serving facts",()=>{
 assert.equal(uwCatalog.nutrition.length,832);assert.equal(uwCatalog.menu.length,151);assert.equal(uwCatalog.deals.length,14);
 for(const source of snapshot.sources) {
  const bytes=readFileSync(new URL(`../src/data/uw/${source.file}`,import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),source.responseSha256);
 }
 assert.ok(uwCatalog.nutrition.every(m=>m.nutrition.values.protein_g===null && m.cost===null && m.allergens===null));
 const item=pizza();assert.equal(item.cost,3.49);assert.equal(item.nutrition.values.energy_kcal,380);assert.equal(item.nutrition.values.carbohydrate_g,45);assert.equal(item.nutrition.values.sodium_mg,770);assert.equal(item.published.saturatedFat_g,7);assert.equal(item.portionLabel,"Slice");assert.deepEqual(item.dietary.knownPresent,["milk","wheat"]);
 assert.equal(uwCatalog.report.matchedPrices,23);
});
test("UW explicit joins: station, serving, variant and calories must still agree",()=>{
 for(const field of ["station","portion","match","calories"]) {
  const r=structuredClone(reviews);const entry=r.menuEntries.find(e=>e.match);entry[field]=field==="calories"?999:"different";
  assert.throws(()=>buildUwSnapshot(snapshot,r),/no longer holds/);
 }
 assert.equal(uwCatalog.menu.find(m=>m.name==="BBQ Chicken").dining.matchStatus,"unmatched");
 assert.equal(uwCatalog.menu.find(m=>m.name==="Meat Lovers").nutrition.values.carbohydrate_g,null);
 assert.equal(uwCatalog.menu.find(m=>m.name==="Cheese" && m.provenance.menu.page===27).cost,null);
 const bad=structuredClone(reviews);bad.menuEntries[0].price=-1;assert.throws(()=>buildUwSnapshot(snapshot,bad),/Invalid reviewed/);
 const herb=uwCatalog.menu.find(m=>m.name==="Herb Pasta");assert.equal(herb.cost,null);
 assert.equal(uwCatalog.menu.find(m=>m.name==="Base Bowl").nutrition.values.energy_kcal,null);
 assert.equal(uwCatalog.menu.find(m=>m.dining.kind==="plate_choice").nutrition.values.energy_kcal,null);
});
test("UW source revisions invalidate manual reviews without silently certifying new facts",()=>{
 const changed=structuredClone(snapshot);changed.menus[0].responseSha256="new";changed.venues[0].hoursSha256="new";
 const result=buildUwSnapshot(changed,reviews);assert.ok(result.report.staleMenuReviews>0);assert.equal(result.report.staleHoursReviews,1);assert.ok(!result.menu.some(m=>m.dining.venueId==="local-point"));
});
test("UW station service windows respect dates, special hours, closure and conflicting Friday hours",()=>{
 assert.equal(stationHours("local-point","Dawg House Pizza","2026-10-17",1320,1350).status,"published");
 assert.equal(venueHours(uwDining.find(v=>v.id==="local-point"),"2026-10-17","22:30").open,true);
 assert.equal(stationHours("local-point","Plate","2026-10-17",720).status,"unknown");
 assert.equal(stationHours("local-point","Dawg House Pizza","2026-10-26",720).status,"unknown");
 assert.equal(stationHours("husky-den","Firecracker","2026-10-16",910).status,"closed");
 assert.equal(stationHours("husky-den","Dawg House Pizza","2026-10-16",910).status,"conflict");
 assert.equal(stationHours("husky-den","Dawg House Pizza","2026-10-17",720).status,"closed");
});
test("UW eligibility reads route, station and dated menu facts on copies; restrictions stay strict",()=>{
 const s=state(),before=structuredClone(s),raw=pizza(),original=structuredClone(raw);
 const prepared=prepareUwDiningMeal(raw,s,[route]).meal;
 assert.equal(prepared.timing.outbound,2);assert.equal(prepared.dining.route.distanceMeters,120);assert.equal(evaluate(prepared,s).feasible,true);
 assert.deepEqual(raw,original);assert.deepEqual(s,before);
 s.profile.exclusions=["milk"];assert.ok(evaluate(prepared,s).reasons.some(r=>r.includes("Contains excluded milk")));
 s.profile.exclusions=["peanut"];assert.ok(evaluate(prepared,s).reasons.some(r=>r.includes("Allergen information is unknown")));
 s.profile.exclusions=[];s.profile.goals=[{nutrient:"protein_g",mode:"minimum",value:20}];assert.ok(evaluate(prepared,s).reasons.some(r=>r.includes("Protein is unknown")));
 s.profile.goals=[];s.context.date="2026-10-19";assert.ok(evaluate(prepared,s).reasons.some(r=>r.includes("current menu entry")));
});
test("UW unknowns and expired or wrong-origin routes cannot become eligible",()=>{
 const s=state(),fresh=pizza();assert.equal(evaluate(fresh,s).feasible,false);
 fresh.dining.route={...route,venueId:"center-table"};assert.equal(prepareUwDiningMeal(fresh,s).meal.timing.outbound,null);
 for(const invalid of [{...route,durationSeconds:null},{...route,checkedAt:"2000-01-01T00:00:00Z"},{...route,origin:{lat:0,lng:0}},{...route,travelMode:"DRIVE"}])assert.equal(currentWalking(invalid),null);
 const nutrition=uwCatalog.nutrition.find(m=>m.dining.venueId==="husky-den");const result=evaluate(prepareUwDiningMeal(nutrition,s,[route]).meal,s);
 assert.ok(result.reasons.some(r=>r.includes("Cost is unknown")));assert.ok(result.reasons.some(r=>r.includes("current menu entry")));
});
