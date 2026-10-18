import test from 'node:test';
import assert from 'node:assert/strict';
import {MEAL_IMAGE_PLACEHOLDER,mealImage,resolveMealImage,prefetchMealImages} from '../src/ui/format.js';
import {catalog} from '../src/data/catalog.js';
import {createDemoState,testPantry} from '../src/domain/state.js';
import {evaluate,recommend} from '../src/domain/engine.js';
import {uwCatalog} from '../src/domain/uwDining.js';
const salad={id:'gemini-test-salad',name:'Crunchy Garden Salad',suggestion:true,ingredients:[{name:'lettuce',grams:50}]};
test('reported tofu salad and unassigned recipes never use keyword matches or remote photos',async t=>{
 const search=t.mock.method(globalThis,'fetch',async()=>{throw Error('Image searches must not run');});
 const tofuSalad=catalog.find(m=>m.id==='tofu-cucumber');
 const unrelated={...tofuSalad,imageUrl:'https://example.com/tofu-salad.jpg',photo:'tofu',imageSearch:'tofu rice salad'};
 for(const meal of [unrelated,salad,{...salad,name:'Crunchy Garden Salad',imageUrl:'https://example.com/salad.jpg'}]) {
  assert.equal(mealImage(meal),MEAL_IMAGE_PLACEHOLDER);
  assert.equal(await resolveMealImage(meal),MEAL_IMAGE_PLACEHOLDER);
 }
 prefetchMealImages([unrelated,salad]);
 assert.equal(search.mock.callCount(),0);
});
test('assigned illustrations stay consistent across repeated resolutions and variants',async()=>{
 const tofu=catalog.find(m=>m.id==='tofu-bowl');
 for(let i=0;i<3;i++) assert.equal(await resolveMealImage(tofu),'/food/tofu.png');
 assert.equal(mealImage({...tofu,name:'Tofu cucumber salad'}),MEAL_IMAGE_PLACEHOLDER);
 assert.equal(mealImage({...tofu,suggestion:true}),MEAL_IMAGE_PLACEHOLDER);
 for(const meal of catalog) assert.equal(await resolveMealImage(meal),mealImage(meal));
});
test('unknown, invalid and over-budget prices cannot enter the strict shortlist',()=>{
 const state=createDemoState();state.pantry={...testPantry};state.profile.budget=3.49;
 const meal=structuredClone(catalog.find(m=>m.id==='tofu-bowl'));
 for(const cost of [null,undefined,NaN,-1,3.50]){meal.cost=cost;assert.equal(evaluate(meal,state).feasible,false);assert.equal(recommend([meal],state,{mode:'cook'}).cards.length,0);}
 meal.cost=3.49;assert.equal(evaluate(meal,state).feasible,true);
 assert.equal(uwCatalog.report.matchedPrices,23);
 for(const row of uwCatalog.menu){assert.equal(row.cost,row.provenance.menu.price);assert.equal(row.provenance.fields.cost.originalValue,row.provenance.menu.originalValues.price);}
});
