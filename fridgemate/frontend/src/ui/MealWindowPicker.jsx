import {useRef, useState} from 'react';
import {dragWindow, contextForWindow} from '../domain/mealWindow.js';
import {addDays, eventsForDay, scheduledItems, timeKey} from '../domain/calendar.js';
import {byId} from '../data/suggestions.js';
import {today} from '../domain/state.js';
import {clockTime, minutes} from '../domain/engine.js';
import './mealWindow.css';

export function MealWindowPicker({state,value,onChange}) {
  const drag = useRef(null);
  const [preview,setPreview] = useState(null);
  const low=7*60, high=22*60;
  const point = event => low + Math.max(0,Math.min(1,(event.clientY-event.currentTarget.getBoundingClientRect().top)/event.currentTarget.clientHeight))*(high-low);
  const selected=preview ?? {start:value.start,end:clockTime(Math.min(1439,minutes(value.start)+Number(value.available)))};
  const start=minutes(selected.start),end=minutes(selected.end);
  const events=eventsForDay(scheduledItems(state,byId),value.date).filter(e=>e.busy&&!e.completed&&e.kind!=='task');
  const busy=events.filter(e=>!e.allDay);
  return <div className="meal-window-picker">
    <div className="meal-window-shortcuts"><button type="button" className="secondary" onClick={()=>onChange({...value,date:today()})}>Today</button><button type="button" className="secondary" onClick={()=>onChange({...value,date:addDays(today(),1)})}>Tomorrow</button><strong>{selected.start}–{selected.end}</strong></div>
    <p className="fine-print">Drag a free period below, or edit start and end. Busy times come from your loaded calendar.</p>
    {events.some(e=>e.allDay) && <p className="error">All-day busy: {events.filter(e=>e.allDay).map(e=>e.title).join(", ")}. Open the event in My Plan to change whether it blocks meals.</p>}
    <div className="meal-window-track" role="slider" tabIndex={0} aria-label="Meal time on timeline. Drag a period; arrow keys move by 15 minutes." aria-valuemin={low} aria-valuemax={high} aria-valuenow={Math.max(low,Math.min(high,start))} aria-valuetext={`${selected.start} to ${selected.end}`}
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current=point(e);setPreview(dragWindow(drag.current,drag.current,low,high));}}
      onPointerMove={e=>{if(drag.current!==null)setPreview(dragWindow(drag.current,point(e),low,high));}}
      onPointerUp={e=>{if(drag.current===null)return;const range=dragWindow(drag.current,point(e),low,high);drag.current=null;setPreview(null);onChange(contextForWindow(value,value.date,range.start,range.end));}}
      onPointerCancel={()=>{drag.current=null;setPreview(null);}}
      onKeyDown={e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const step=['ArrowUp','ArrowLeft'].includes(e.key)?-15:15;const duration=Number(value.available)||60;const next=Math.max(low,Math.min(high-duration,minutes(value.start)+step));onChange(contextForWindow(value,value.date,clockTime(next),clockTime(next+duration)));}}>
      {[7,10,13,16,19,22].map(h=><div className="meal-window-hour" style={{top:`${(h*60-low)/(high-low)*100}%`}} key={h}><span>{h>12?h-12:h}{h>=12?'p':'a'}</span></div>)}
      {busy.map(e=>{const a=Math.max(low,minutes(timeKey(e.start))),b=Math.min(high,minutes(timeKey(e.end)));return b>a?<div key={e.id} className="meal-window-busy" style={{top:`${(a-low)/(high-low)*100}%`,height:`${(b-a)/(high-low)*100}%`}}>{e.title}</div>:null;})}
      {end>low&&start<high&&<div className="meal-window-selection" style={{top:`${(Math.max(low,start)-low)/(high-low)*100}%`,height:`${(Math.min(high,end)-Math.max(low,start))/(high-low)*100}%`}}>Meal · {selected.start}–{selected.end}</div>}
    </div>
  </div>;
}
