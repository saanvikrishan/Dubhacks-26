import {useEffect,useRef} from 'react';
import {eventKind} from '../domain/calendar.js';
/** Re-read an already connected provider; never request authorization or write events. */
export async function readConnectedCalendar(state, fetchImpl = fetch) {
  const calendar=state?.calendar;
  const base=calendar?.source==='apple'?'/api/calendar/events':calendar?.provider==='google'?'/api/google-calendar/events':null;
  if (!calendar?.connected || !base || !calendar.range) return null;
  const {from,to}=calendar.range;
  const response=await fetchImpl(`${base}?${new URLSearchParams({[calendar.source==='apple'?'from':'from_']:from,to})}`,{signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if (!response.ok || data.authorized!==true || !Array.isArray(data.events)) throw new Error('Calendar refresh unavailable. Your last loaded events are kept.');
  return {type:'importCalendar',source:calendar.source,provider:calendar.provider,range:calendar.range,events:data.events.map(e=>({...e,kind:eventKind(e.title)}))};
}
export function useCalendarRefresh(stateRef,onImport,onError) {
  const callbacks=useRef(null);
  useEffect(()=>{callbacks.current={onImport,onError};});
  useEffect(()=>{
    let active=true,pending=false,lastAttempt=0;
    const refresh=async()=>{
      const state=stateRef.current;
      if(!state || pending || Date.now()-Math.max(Date.parse(state.calendar?.lastSync)||0,lastAttempt)<300000)return;
      pending=true;lastAttempt=Date.now();
      try {const action=await readConnectedCalendar(state);if(active && action)await callbacks.current.onImport(action);}
      catch(error){if(active)callbacks.current.onError(error.message);}
      finally{pending=false;}
    };
    const timer=setInterval(refresh,300000);
    window.addEventListener('focus',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[stateRef]);
}
