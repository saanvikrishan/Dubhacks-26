import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksMealPlanning,isHolidayEvent,calendarConflicts,nextMealWindow,scheduledItems,localInstant} from '../src/domain/calendar.js';
import {createDemoState,testPantry,transition,validateState} from '../src/domain/state.js';
import {byId} from '../src/data/catalog.js';
import {evaluate} from '../src/domain/engine.js';
const date='2026-10-18';
const holiday={id:'holiday',title:'重阳节',start:localInstant(date,'00:00'),end:localInstant('2026-10-19','00:00'),allDay:true,busy:true,kind:'event',calendar:'中国节假日',source:'apple',readOnly:true};
function fixture(){const s=createDemoState();Object.assign(s.context,{date,start:'12:00',available:90,commitmentTime:'13:30'});s.pantry={...testPantry};s.events=[structuredClone(holiday)];return s;}
test('重阳节 remains visible but does not block any meal window',()=>{
 const s=fixture(),before=structuredClone(s.events);
 assert.equal(isHolidayEvent(holiday),true);assert.equal(blocksMealPlanning(holiday),false);
 assert.deepEqual(calendarConflicts(s,45),[]);assert.equal(evaluate(byId['tofu-bowl'],s).feasible,true);
 const items=scheduledItems(s,byId);assert.equal(items[0].title,'重阳节');assert.equal(items[0].busy,false);
 assert.equal(nextMealWindow(items,date,new Date(localInstant(date,'08:00')),60).start,'08:00');
 const chosen=transition(s,{type:'choose',mealId:'tofu-bowl'});assert.equal(chosen.plan.start,'12:00');assert.deepEqual(chosen.events,before);
});
test('genuine all-day commitments and timed festival activities remain busy',()=>{
 const conference={...holiday,title:'Work conference',calendar:'Work'};assert.equal(blocksMealPlanning(conference),true);
 const meetup={...holiday,title:'重阳节',allDay:false};assert.equal(blocksMealPlanning(meetup),true);
 assert.equal(blocksMealPlanning({...holiday,mealBusyOverride:true}),true);
 assert.equal(blocksMealPlanning({...conference,mealBusyOverride:false}),false);
});
test('the user can change local meal availability without changing source events, plans or logs',()=>{
 const s=fixture(),before=structuredClone(s);
 const busy=transition(s,{type:'setEventMealAvailability',id:'holiday',busy:true});assert.equal(calendarConflicts(busy,45).length,1);
 assert.deepEqual(busy.mealPlans,before.mealPlans);assert.deepEqual(busy.logs,before.logs);
 const {mealBusyOverride,...sourceEvent}=busy.events[0];assert.equal(mealBusyOverride,true);assert.deepEqual(sourceEvent,before.events[0]);
 const automatic=transition(busy,{type:'setEventMealAvailability',id:'holiday',busy:null});assert.equal(blocksMealPlanning(automatic.events[0]),false);
});
test('local busy/free choices survive calendar refresh and reload',()=>{
 let s=transition(fixture(),{type:'setEventMealAvailability',id:'holiday',busy:true});
 s=transition(s,{type:'importCalendar',source:'apple',events:[structuredClone(holiday)]});
 s=validateState(JSON.parse(JSON.stringify(s)));assert.equal(blocksMealPlanning(s.events[0]),true);assert.equal(s.events[0].mealBusyOverride,true);
});
test('informational holiday calendars are free by default without relaxing timed events',()=>{
 assert.equal(blocksMealPlanning({...holiday,title:'Public holiday',calendar:'US Holidays'}),false);
 assert.equal(blocksMealPlanning({...holiday,title:'Public holiday',calendar:'US Holidays',allDay:false}),true);
 const s=fixture();assert.throws(()=>transition(s,{type:'setEventMealAvailability',id:'missing',busy:false}));
});
