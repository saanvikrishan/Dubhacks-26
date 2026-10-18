import test from 'node:test';
import assert from 'node:assert/strict';
import {dragWindow,contextForWindow} from '../src/domain/mealWindow.js';
import {mealWindowStillOpen,localInstant} from '../src/domain/calendar.js';
import {createDemoState,testPantry,transition} from '../src/domain/state.js';
const today='2026-10-17',tomorrow='2026-10-18';
test('a future meal window is retained when opening Food from Today',()=>{
 const now=new Date(localInstant(today,'23:00'));
 assert.equal(mealWindowStillOpen({date:tomorrow,start:'12:00',available:60},now),true);
 assert.equal(mealWindowStillOpen({date:today,start:'12:00',available:60},now),false);
});
test('forward and reverse timeline drags select the same 15-minute interval',()=>{
 assert.deepEqual(dragWindow(722,789),{start:'12:00',end:'13:00',available:60});
 assert.deepEqual(dragWindow(789,722),dragWindow(722,789));
 assert.equal(dragWindow(720,720).available,15);
 assert.equal(dragWindow(1320,1320,420,1320).available,15);
 assert.throws(()=>dragWindow(NaN,720));
});
test('dragged future window reuses normal eligibility and preserves plans and intake',()=>{
 let s=createDemoState();s.pantry={...testPantry};
 const before=structuredClone(s);
 const context=contextForWindow(s.context,tomorrow,'18:00','19:30');
 s=transition(s,{type:'updateContext',context});
 assert.deepEqual(s.mealPlans,before.mealPlans);assert.deepEqual(s.logs,before.logs);
 s=transition(s,{type:'choose',mealId:'tofu-bowl'});
 assert.equal(s.plan.date,tomorrow);assert.equal(s.plan.start,'18:00');
 assert.equal(s.logs.length,0);
});
test('invalid or empty ranges cannot bypass required window validation',()=>{
 const s=createDemoState();
 assert.throws(()=>contextForWindow(s.context,tomorrow,'18:00','17:00'));
 assert.throws(()=>contextForWindow(s.context,tomorrow,'','19:00'));
 assert.throws(()=>transition(s,{type:'updateContext',context:{available:''}}));
});
