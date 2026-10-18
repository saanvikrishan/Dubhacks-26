const minute = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)) : NaN;
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
/** Pointer positions select a same-day range in 15-minute increments. */
export function dragWindow(anchor, head, min = 0, max = 1439) {
  if (![anchor,head,min,max].every(Number.isFinite) || max-min < 15) throw new Error('Invalid timeline position.');
  const snap = n => Math.max(min,Math.min(max,Math.floor(n/15)*15));
  const start = Math.min(max-15,snap(anchor),snap(head));
  const end = Math.min(max,Math.max(start+15,snap(anchor),snap(head)));
  return {start:clock(start),end:clock(end),available:end-start};
}
export function contextForWindow(context, date, start, end) {
  const available = minute(end)-minute(start);
  if (!Number.isInteger(available) || available <= 0) throw new Error('Choose an end after the start on the same day.');
  return {...context,date,start,available,commitmentTime:end,commitment:'End of selected window',manuallySet:true};
}
