import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState,validateState,transition} from '../src/domain/state.js';
import {EQUIPMENT,mealsFor,recipeSnapshots} from '../src/domain/generatedMeals.js';
import {dailyNutrition} from '../src/domain/nutrition.js';
import {evaluate} from '../src/domain/engine.js';
import {savePantryItems} from '../src/adapters/database.js';
import {storageAdapter,STORAGE_KEY} from '../src/adapters/storage.js';
function legacy() {
 const state=createDemoState();delete state.context.onward;delete state.context.buffer;delete state.generatedMeals;
 const meal={id:'gemini-legacy-0',name:'Saved main recipe',description:'Older saved snapshot',mode:'cook',suggestion:true,ingredients:[{name:'tofu',grams:100}],equipment:['air fryer'],steps:['Cook the tofu.'],timing:{prep:5,cook:15,outbound:0},photo:null,portionGrams:400,portionLabel:'1 serving',cost:4.5,diets:['vegetarian'],allergens:['soy'],nutrition:{kind:'gemini_suggestion',basis:'per_serving',values:{energy_kcal:450,protein_g:18}}};
 state.geminiMeals=[meal];state.profile.equipment=EQUIPMENT.slice();state.plan={id:'saved-main',mealId:meal.id,date:state.context.date,start:'12:00',duration:45,servings:1};state.mealPlans=[state.plan];state.logs=[{id:'old-log',mealId:meal.id,date:state.context.date,servings:.5}];
 return state;
}
test('main saved recipes, plans, intake and all equipment reload without deletion',()=>{
 const state=legacy(),original=structuredClone(state);const map=new Map([[STORAGE_KEY,JSON.stringify(state)]]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const result=storageAdapter.load(storage);assert.equal(result.error,null);
 assert.deepEqual(result.state.geminiMeals,original.geminiMeals);assert.deepEqual(result.state.mealPlans,original.mealPlans);assert.deepEqual(result.state.logs,original.logs);
 assert.equal(dailyNutrition(result.state.logs,mealsFor(result.state),state.context.date).energy_kcal.value,225);
 assert.equal(recipeSnapshots(result.state)[0].legacyHistory,true);
 storageAdapter.save(storage,result.state);assert.equal(storageAdapter.load(storage).error,null);
});
test('historical main facts remain available for logging but cannot bypass new-review eligibility',()=>{
 const state=validateState(legacy()),meal=mealsFor(state)['gemini-legacy-0'];
 assert.equal(evaluate(meal,state).feasible,false);assert.throws(()=>transition(state,{type:'choose',mealId:meal.id}));
 const logged=transition(state,{type:'log',id:'actual-later',mealId:meal.id,date:state.context.date,servings:.5});
 assert.equal(logged.logs.length,2);assert.deepEqual(logged.mealPlans,state.mealPlans);
});
test('Postgres pantry mirror sends entered quantities and never invents 500 grams',async()=>{
 let sent;const transport=async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({status:'ok'})};};
 assert.equal((await savePantryItems({spinach:73,tofu:200},undefined,transport)).ok,true);
 assert.deepEqual(sent.body.items,[{name:'spinach',grams:73},{name:'tofu',grams:200}]);
 let called=false;const result=await savePantryItems(['spinach'],undefined,async()=>{called=true;});
 assert.equal(called,false);assert.equal(result.status,'quantities_required');
 assert.equal(EQUIPMENT.includes('air fryer'),true);assert.equal(EQUIPMENT.includes('rice cooker'),true);assert.equal(EQUIPMENT.includes('slow cooker'),true);
});
