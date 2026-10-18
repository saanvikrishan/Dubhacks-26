import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../src/data/catalog.js';
import {createDemoState,testPantry} from '../src/domain/state.js';
import {evaluate,recommend} from '../src/domain/engine.js';
import {uwCatalog} from '../src/domain/uwDining.js';
test('unknown, invalid and over-budget prices cannot enter the strict shortlist',()=>{
 const state=createDemoState();state.pantry={...testPantry};state.profile.budget=3.49;
 const meal=structuredClone(catalog.find(m=>m.id==='tofu-bowl'));
 for(const cost of [null,undefined,NaN,-1,3.50]){meal.cost=cost;assert.equal(evaluate(meal,state).feasible,false);assert.equal(recommend([meal],state,{mode:'cook'}).cards.length,0);}
 meal.cost=3.49;assert.equal(evaluate(meal,state).feasible,true);
 assert.equal(uwCatalog.report.matchedPrices,23);
 for(const row of uwCatalog.menu){assert.equal(row.cost,row.provenance.menu.price);assert.equal(row.provenance.fields.cost.originalValue,row.provenance.menu.originalValues.price);}
});
