import test from 'node:test';
import assert from 'node:assert/strict';
import {MEAL_IMAGE_PLACEHOLDER,mealImage,preparedDishMatch,resolveMealImage} from '../src/ui/format.js';
import {catalog} from '../src/data/catalog.js';
import {createDemoState,testPantry} from '../src/domain/state.js';
import {evaluate,recommend} from '../src/domain/engine.js';
import {uwCatalog} from '../src/domain/uwDining.js';
const salad={id:'gemini-test-salad',name:'Crunchy Garden Salad',suggestion:true,ingredients:[{name:'lettuce',grams:50}]};
test('raw ingredient and conflicting protein photos are rejected; prepared dishes can match',()=>{
 assert.equal(preparedDishMatch(salad,{title:'Lettuce growing in a garden'}),false);
 assert.equal(preparedDishMatch(salad,{title:'Garden salad - macro photo of lettuce seeds'}),false);
 assert.equal(preparedDishMatch(salad,{title:'Crunchy garden shrimp salad'}),false);
 assert.equal(preparedDishMatch(salad,{title:'Crunchy Garden Salad in a bowl'}),true);
});
test('failed or unrelated image lookups use a stable local placeholder, never random food',async()=>{
 assert.equal(mealImage({...salad,imageUrl:'https://example.com/random-food.jpg'}),MEAL_IMAGE_PLACEHOLDER);
 assert.equal(await resolveMealImage(salad,{fetchImpl:async()=>({ok:true,json:async()=>({results:[{title:'Lettuce plant',url:'https://example.com/lettuce.jpg'}]})})}),MEAL_IMAGE_PLACEHOLDER);
 assert.equal(await resolveMealImage({...salad,name:'Another Garden Salad'},{fetchImpl:async()=>{throw Error('offline');}}),MEAL_IMAGE_PLACEHOLDER);
});
test('verified local meal illustrations do not make image API calls',async()=>{
 let calls=0;
 assert.equal(await resolveMealImage(catalog.find(m=>m.id==='tofu-bowl'),{fetchImpl:async()=>{calls++;}}),'/food/tofu.png');
 assert.equal(calls,0);
});
test('unknown, invalid and over-budget prices cannot enter the strict shortlist',()=>{
 const state=createDemoState();state.pantry={...testPantry};state.profile.budget=3.49;
 const meal=structuredClone(catalog.find(m=>m.id==='tofu-bowl'));
 for(const cost of [null,undefined,NaN,-1,3.50]){meal.cost=cost;assert.equal(evaluate(meal,state).feasible,false);assert.equal(recommend([meal],state,{mode:'cook'}).cards.length,0);}
 meal.cost=3.49;assert.equal(evaluate(meal,state).feasible,true);
 assert.equal(uwCatalog.report.matchedPrices,23);
 for(const row of uwCatalog.menu){assert.equal(row.cost,row.provenance.menu.price);assert.equal(row.provenance.fields.cost.originalValue,row.provenance.menu.originalValues.price);}
});
