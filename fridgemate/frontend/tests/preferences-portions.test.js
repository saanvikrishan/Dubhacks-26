import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../src/data/catalog.js';
import {enrichCookFacts,deriveCookNutrition} from '../src/domain/foodFacts.js';
import {nutritionDisplayRows,portionNutrition} from '../src/domain/nutrition.js';
import {comparePreferences,foodPreferences} from '../src/domain/preferences.js';
import {createDemoState,testPantry,transition,validateState} from '../src/domain/state.js';
import {requestRecipeDrafts} from '../src/adapters/recipes.js';

test('all curated recipes have a one-serving USDA calorie and protein estimate without purchased grocery weights',()=>{
  for(const meal of catalog.filter(m=>m.mode==='cook')) {
    const enriched=enrichCookFacts(meal);
    assert.equal(enriched.portionLabel,'1 serving');
    assert.equal(enriched.portionGrams,null);
    const values=portionNutrition(enriched);
    assert.ok(values.energy_kcal>0,meal.name);
    assert.ok(values.protein_g>0,meal.name);
  }
  const pasta=enrichCookFacts(catalog.find(m=>m.id==='tomato-pasta'));
  assert.ok(pasta.nutrition.assumptions.includes('For this recipe, cheese means cheddar cheese.'));
});
test('common vegetable names resolve to reviewed records; partial display never invents a full intake total',()=>{
  const nutrition=deriveCookNutrition([{name:'cucumbers',grams:100},{name:'radishes',grams:50},{name:'red cabbage',grams:80},{name:'lettuce',grams:50}]);
  assert.ok(nutrition.values.energy_kcal>0);
  assert.equal(nutrition.matches.filter(m=>m.fdcId).length,4);
  const partial={nutrition:deriveCookNutrition([{name:'tofu',grams:150},{name:'unmatched food',grams:100}])};
  assert.equal(portionNutrition(partial).energy_kcal,null);
  const rows=nutritionDisplayRows(partial,1,['energy_kcal']);
  assert.equal(rows[0].partial,true);assert.ok(rows[0].value>0);assert.equal(rows[0].known,1);assert.equal(rows[0].total,2);
});
test('food, cuisine, taste and dislikes affect ordering without replacing dietary facts',()=>{
  const rice=catalog.find(m=>m.id==='garlic-rice'),pasta=catalog.find(m=>m.id==='tomato-pasta');
  assert.ok(comparePreferences(pasta,rice,{cuisines:['Italian']})<0);
  assert.ok(comparePreferences(rice,pasta,{cuisines:['Chinese'],tastes:['Savory']})<0);
  assert.ok(comparePreferences(pasta,rice,{cuisines:['Italian'],dislikes:'pasta'})>0);
  const remembered=foodPreferences({...createDemoState().profile,cuisines:['Italian'],tastes:['Spicy'],dislikes:'olives',events:[{title:'private'}]});
  assert.deepEqual(Object.keys(remembered).sort(),['avoidCuisines','cuisines','dislikes','preferred','tastes']);
});
test('recipe requests carry soft preferences and still use the existing bounded recipe service',async()=>{
  const state=createDemoState();state.profile={...state.profile,cuisines:['Italian'],tastes:['Mild'],dislikes:'olives'};
  let body;
  await requestRecipeDrafts({state,ingredients:['tomatoes'],fetchImpl:async(url,options)=>{assert.equal(url,'/api/recipes');body=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({meals:[]})};}});
  assert.deepEqual(body.cuisines,['Italian']);assert.deepEqual(body.tastes,['Mild']);assert.equal(body.dislikes,'olives');assert.equal(body.diet,'vegetarian');
});
test('main open meal slots survive reload, holidays do not block them, and filling a slot enforces eligibility',()=>{
  let state=createDemoState();state.pantry={...testPantry};state.context.date='2026-10-18';
  state.events=[{id:'holiday',title:'重阳节',start:'2026-10-18T07:00:00.000Z',end:'2026-10-19T07:00:00.000Z',allDay:true,busy:true,kind:'event',source:'apple',readOnly:true}];
  state=transition(state,{type:'scheduleDayMeals',date:state.context.date});
  assert.equal(state.mealPlans.length,3);
  state=validateState(JSON.parse(JSON.stringify(state)));
  const slot=state.mealPlans[0];
  assert.throws(()=>transition({...state,profile:{...state.profile,budget:0}},{type:'fillMealSlot',slotId:slot.id,mealId:'tofu-bowl'}),/budget|Costs/i);
  state=transition(state,{type:'fillMealSlot',slotId:slot.id,mealId:'tofu-bowl'});
  assert.equal(state.mealPlans[0].openSlot,false);assert.equal(validateState(state).mealPlans.length,3);
});
