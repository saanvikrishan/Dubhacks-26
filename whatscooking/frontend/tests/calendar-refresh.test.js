import test from 'node:test';
import assert from 'node:assert/strict';
import {readConnectedCalendar} from '../src/adapters/calendarRefresh.js';
const state={calendar:{source:'apple',connected:true,lastSync:'2026-10-18T00:00:00Z',range:{from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z'}}};
test('connected calendars refresh through read-only requests on detached data',async()=>{
 const before=structuredClone(state);let requested;
 const action=await readConnectedCalendar(state,async(url,options)=>{requested={url,options};return {ok:true,json:async()=>({authorized:true,events:[]})};});
 assert.match(requested.url,/^\/api\/calendar\/events\?/);assert.equal(requested.options.method,undefined);
 assert.equal(action.type,'importCalendar');assert.deepEqual(state,before);
});
test('failed or unconnected calendar refresh preserves previous events and timestamps',async()=>{
 const before=structuredClone(state);
 await assert.rejects(()=>readConnectedCalendar(state,async()=>({ok:false,json:async()=>({})})),/last loaded events are kept/);
 assert.deepEqual(state,before);
 assert.equal(await readConnectedCalendar({calendar:{source:'ics',connected:true}},()=>{throw Error('must not request');}),null);
});
