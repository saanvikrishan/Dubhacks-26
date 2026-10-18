import test from 'node:test';
import assert from 'node:assert/strict';
import saved from '../src/data/food/usda-browser.json' with {type:'json'};
import manifest from '../src/data/food/ingredient-matches.json' with {type:'json'};
import prices from '../src/data/food/pricing-matches.json' with {type:'json'};
import {normalizeUsdaFood,ingredientNutrition} from '../src/adapters/usdaFood.js';
import {normalizeFoodReference,installFoodReference,deriveCookNutrition,deriveCookPrice,packageGrams,sourcedCookCandidate} from '../src/domain/foodFacts.js';
import {catalog} from '../src/data/catalog.js';
import {createDemoState,testPantry,transition,validateState} from '../src/domain/state.js';
import {mealsFor} from '../src/domain/generatedMeals.js';
import {dailyNutrition,portionNutrition} from '../src/domain/nutrition.js';
import {recommend,evaluate,dailyGoalFit} from '../src/domain/engine.js';
import {discoverCookMeals} from '../src/domain/discovery.js';
import {createFoodReferenceStore} from '../src/adapters/foodReference.js';
function fixture(price=2,now=Date.now()) {
 return {version:1,nutrition:{status:'retrieved',records:structuredClone(saved.records)},pricing:{store:prices.defaultStore,ingredients:prices.matches.map(m=>({key:m.key,status:'retrieved',quote:{productId:m.productId,description:m.expectedDescription,packageSize:m.expectedSize,regularPrice:price,promotionalPrice:0,locationId:prices.defaultStore.locationId,originalPrice:{regular:price,promo:0},checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),sourceUrl:'https://api.kroger.com/v1/products/'+m.productId}}))}};
}
function state(){const s=createDemoState();s.pantry={...testPantry};s.profile.budget=20;s.context.available=180;s.context.commitmentTime='15:00';return s;}

test('Foundation energy selects Atwater specific once, falls back correctly and retains missing nutrients',()=>{
 const raw=structuredClone(saved.records.find(r=>r.fdcId===2259793));const match=manifest.matches.find(m=>m.fdcId===raw.fdcId);
 const specific=raw.foodNutrients.find(r=>r.nutrient.id===2048).amount;
 let normalized=normalizeUsdaFood(raw,match);assert.equal(normalized.values.energy_kcal,specific);
 raw.foodNutrients=raw.foodNutrients.filter(r=>r.nutrient.id!==2048);
 normalized=normalizeUsdaFood(raw,match);assert.equal(normalized.values.energy_kcal,raw.foodNutrients.find(r=>r.nutrient.id===2047).amount);
 raw.foodNutrients=raw.foodNutrients.filter(r=>r.nutrient.id!==1003);
 assert.equal(normalizeUsdaFood(raw,match).values.protein_g,null);
});
test('full-detail nutrient IDs, units and measured grams drive calculations, never row IDs or defaults',()=>{
 const match=manifest.matches.find(m=>m.key==='tofu'),raw=structuredClone(saved.records.find(r=>r.fdcId===match.fdcId));
 raw.foodNutrients.find(r=>r.nutrient.id===1003).amount=20;
 const protein=raw.foodNutrients.find(r=>r.nutrient.id===1003);protein.id=999999;protein.nutrient.unitName='mg';
 const food=normalizeUsdaFood(raw,match);assert.equal(food.values.protein_g,.02);
 assert.equal(ingredientNutrition(food,{grams:150,preparation:'raw',weightBasis:'raw_edible_weight'}).protein_g,.03);
 assert.throws(()=>ingredientNutrition(food,{grams:150,preparation:'cooked',weightBasis:'cooked_edible_weight'}),/does not match/);
 const reference=normalizeFoodReference(fixture());
 const full=deriveCookNutrition([{name:'tofu',grams:150},{name:'olive oil',grams:5}],reference);
 assert.ok(Math.abs(full.values.energy_kcal-(144*1.5+884*.05))<1e-8);
 const unknown=deriveCookNutrition([{name:'rice',grams:100},{name:'tofu',grams:150}],reference);
 assert.equal(unknown.values.energy_kcal,null);assert.equal(unknown.coverage.energy_kcal.known,1);
 assert.equal(unknown.matches[0].fdcId,null);
});
test('Kroger portion costs use actual package mass; promotions and checkout totals remain separate',()=>{
 const reference=normalizeFoodReference(fixture());
 const quote=reference.pricing.tofu;
 assert.equal(packageGrams('tofu',quote,reference).grams,14*28.349523125);
 const estimate=deriveCookPrice([{name:'tofu',grams:150}],reference);
 assert.equal(estimate.value,Math.round(2*150/(14*28.349523125)*100)/100);
 assert.equal(estimate.purchaseTotal,2);assert.notEqual(estimate.value,0);
 assert.equal(packageGrams('tofu',{...quote,packageSize:'2 ct'},reference),null);
 assert.equal(packageGrams('tofu',{...quote,packageSize:'0 oz'},reference),null);
 assert.equal(packageGrams('olive oil',reference.pricing['olive oil'],reference).fdcId,171413);
 assert.equal(packageGrams('eggs',reference.pricing.eggs,reference).grams,600);
 assert.equal(deriveCookPrice([{name:'chickpeas',grams:150}],reference).value,null);
});
test('wrong products, missing prices, expired quotes and missing gram bases do not become priced meals',()=>{
 const raw=fixture();raw.pricing.ingredients.find(r=>r.key==='tofu').quote.productId='wrong';
 let reference=normalizeFoodReference(raw);assert.equal(deriveCookPrice([{name:'tofu',grams:150}],reference).value,null);
 reference=normalizeFoodReference(fixture());const expired=Date.parse(reference.pricing.tofu.expiresAt)+1;
 assert.equal(deriveCookPrice([{name:'tofu',grams:150}],reference,expired).value,null);
 raw.pricing.ingredients.find(r=>r.key==='tofu').quote=null;
 assert.equal(normalizeFoodReference(raw).pricing.tofu,undefined);
});
test('sourced selection, half-serving intake and reload preserve the selected snapshot after a price refresh',()=>{
 installFoodReference(fixture());let s=state();
 const candidate=sourcedCookCandidate(catalog.find(m=>m.id==='tofu-bowl'));
 const before=structuredClone(s);s=transition(s,{type:'captureSourcedMeal',meal:candidate});
 assert.deepEqual(s.logs,before.logs);assert.deepEqual(s.mealPlans,before.mealPlans);
 assert.equal(evaluate(candidate,s).feasible,true);
 s=transition(s,{type:'choose',mealId:candidate.id});
 s=transition(s,{type:'log',id:'sourced-half',mealId:candidate.id,date:s.context.date,servings:.5});
 const energy=dailyNutrition(s.logs,mealsFor(s),s.context.date).energy_kcal.value;
 assert.equal(energy,portionNutrition(candidate).energy_kcal*.5);
 installFoodReference(fixture(4));const updated=sourcedCookCandidate(catalog.find(m=>m.id==='tofu-bowl'));
 assert.notEqual(updated.id,candidate.id);assert.ok(updated.cost>candidate.cost);
 s=validateState(JSON.parse(JSON.stringify(s)));
 assert.equal(mealsFor(s)[candidate.id].cost,candidate.cost);
 assert.equal(dailyNutrition(s.logs,mealsFor(s),s.context.date).energy_kcal.value,energy);
 assert.equal(s.plan.mealId,candidate.id);
 assert.throws(()=>transition(state(),{type:'captureSourcedMeal',meal:{...updated,nutrition:{...updated.nutrition,values:{energy_kcal:1}}}}),/facts changed/);
});
test('Backboard preferences break ties only after current preferences and cannot weaken a budget or allergy',()=>{
 installFoodReference(fixture());const s=state();s.profile.preferred='';
 const candidates=catalog.filter(m=>m.mode==='cook').map(m=>sourcedCookCandidate(m));
 const result=recommend(candidates,s,{mode:'cook',preferences:[{preferred:'tomatoes',cuisines:[]}]});
 assert.ok(result.cards.length<=3);assert.ok(result.cards[0].preferenceReason.includes('picked before'));
 s.profile.budget=0;assert.equal(recommend(candidates,s,{mode:'cook',preferences:[{preferred:'tofu'}]}).cards.length,0);
 s.profile.budget=20;s.profile.exclusions=['soy'];assert.ok(recommend(candidates,s,{mode:'cook',preferences:[{preferred:'tofu'}]}).cards.every(r=>!r.meal.ingredients.some(i=>i.name==='tofu')));
});
test('Cook respects the three-card cap and daily minima never require one meal to supply the whole day',()=>{
 installFoodReference(fixture());const s=state();s.profile.goals=[{nutrient:'protein_g',mode:'minimum',value:150}];
 const candidates=catalog.filter(m=>m.mode==='cook').map(m=>sourcedCookCandidate(m));
 assert.equal(discoverCookMeals(candidates,s).cards.length,3);
 const candidate=candidates.find(m=>m.sourceRecipeId==='tofu-bowl');assert.equal(evaluate(candidate,s).feasible,true);
 assert.equal(dailyGoalFit(candidate,s)[0].remaining,150);
 s.logs=[{id:'unknown',mealId:'not-known',date:s.context.date,servings:1}];
 assert.equal(dailyGoalFit(candidate,s)[0].remaining,null);
});
test('source loading coalesces requests and a working response replaces missing prices without paid generation',async()=>{
 let calls=0;const store=createFoodReferenceStore(async()=>{calls++;return {ok:true,json:async()=>fixture()};});
 const a=store.refresh(),b=store.refresh();assert.equal(a,b);await a;
 assert.equal(store.getSnapshot().status,'ready');assert.ok(sourcedCookCandidate(catalog.find(m=>m.id==='tofu-bowl')).cost>0);
 await store.refresh();assert.equal(calls,1);
});
