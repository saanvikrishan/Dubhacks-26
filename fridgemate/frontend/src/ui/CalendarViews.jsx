import {dragWindow} from "../domain/mealWindow.js";
import { useEffect, useRef, useState } from "react";
import { Icon, Modal } from "./Core";
import {
  blocksMealPlanning,
  isHolidayEvent,
  addDays,
  addMonths,
  layoutDayEvents,
  comingUp,
  dayKey,
  eventKind,
  eventsForDay,
  localInstant,
  prettyDate,
  timeKey,
} from "../domain/calendar";
import { byId } from "../data/suggestions";

const timeLabel = (value) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const activityIcon = (kind) =>
  ({
    meal: "fork",
    class: "calendar",
    workout: "spark",
    task: "check",
    event: "calendar",
  })[kind] || "calendar";

const NOTES_KEY = "whatscooking.sidebar-notes.v1";

function loadNotesMap() {
  try {
    return JSON.parse(window.localStorage.getItem(NOTES_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function SidebarNotes({date}) {
  return <SidebarNotesForDate key={dayKey(date)} date={date}/>;
}
function SidebarNotesForDate({ date }) {
  const key = dayKey(date);
  const [text, setText] = useState(() => loadNotesMap()[key] || "");
  const [expanded, setExpanded] = useState(false);
  const lastY = useRef(
    typeof window !== "undefined" ? window.scrollY || 0 : 0,
  );


  useEffect(() => {
    const map = loadNotesMap();
    if (text.trim()) map[key] = text;
    else delete map[key];
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(map));
  }, [key, text]);

  // The assistant can add notes too; show them right away.
  useEffect(() => {
    const reload = () => setText(loadNotesMap()[key] || "");
    window.addEventListener("daywell-notes-changed", reload);
    return () => window.removeEventListener("daywell-notes-changed", reload);
  }, [key]);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        const delta = y - lastY.current;
        if (y <= 24) setExpanded(false);
        else if (delta > 6) setExpanded(true);
        else if (delta < -6) setExpanded(false);
        lastY.current = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      className={`notes-panel${expanded ? " is-expanded" : ""}`}
      aria-expanded={expanded}
    >
      <div className="panel-title">
        <h2>Notes</h2>
      </div>
      <p className="subtle">Ideas, leftovers, or reminders for the day</p>
      <textarea
        className="notes-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Jot something down…"
        rows={4}
        aria-label="Day notes"
      />
    </section>
  );
}

export function Agenda({
  items,
  date,
  onOpen,
  onAdd,
  onCalendar,
  now,
  connected,
  compact = false,
}) {
  const events = eventsForDay(items, date);
  return (
    <section className={`agenda-panel ${compact ? "compact" : ""}`}>
      <div className="panel-title">
        <h2>Your schedule</h2>
        <button
          className="icon-button"
          onClick={() => onAdd(date)}
          aria-label="Schedule a meal"
        >
          +
        </button>
      </div>
      <p className="subtle">
        {prettyDate(date, { weekday: "long" })} · {events.length} scheduled
      </p>
      <div className="agenda-list">
        {events.length ? (
          events.map((item) => (
            <button
              className={`agenda-item ${Date.parse(item.end) < now ? "past" : ""} ${item.completed ? "complete" : ""}`}
              key={item.id}
              onClick={() => onOpen(item)}
            >
              <span className="agenda-time">
                {item.allDay ? "All day" : timeLabel(item.start)}
              </span>
              <span className={`activity-dot ${item.kind}`} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.kind === "task"
                    ? "Task"
                    : item.allDay
                      ? `${item.calendar || "Calendar"}${!blocksMealPlanning(item)?" · Does not block meals":""}`
                      : `${timeLabel(item.start)}–${timeLabel(item.end)}`}
                  {item.location ? ` · ${item.location}` : ""}
                </small>
              </span>
            </button>
          ))
        ) : (
          <div className="agenda-empty">
            <Icon name="calendar" size={28} />
            <p>Nothing scheduled for this day.</p>
            <small>
              {connected
                ? "Your calendar is loaded. Schedule a meal here — other events come from your calendar."
                : "Schedule a meal here, or import classes and events from your calendar."}
            </small>
          </div>
        )}
      </div>
      {onCalendar && (
        <button className="agenda-all text-button" onClick={onCalendar}>
          Open full calendar <Icon name="arrow" size={16} />
        </button>
      )}
    </section>
  );
}

export function ComingUp({
  items,
  date,
  onOpen,
  onAdd,
  now,
  connected,
}) {
  const event = comingUp(eventsForDay(items, date), new Date(now));
  const ongoing = event && Date.parse(event.start) <= now;
  return (
    <section className={`coming-up ${event?.kind || ""}`}>
      <div className="coming-label">
        <span className="live-dot" />
        {ongoing ? "HAPPENING NOW" : "COMING UP"}
        <span>
          {event
            ? event.allDay
              ? "All day"
              : timeLabel(event.start)
            : "Today"}
        </span>
      </div>
      {event ? (
        <>
          <div className="coming-main">
            <span className="coming-icon">
              <Icon name={activityIcon(event.kind)} size={28} />
            </span>
            <div>
              <p className="activity-kind">
                {event.kind === "event" ? "Calendar event" : event.kind}
              </p>
              <h2>{event.title}</h2>
              <p>
                {event.allDay
                  ? "All day"
                  : `${timeLabel(event.start)}–${timeLabel(event.end)}`}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </div>
          </div>
          <div className="coming-actions">
            <button className="primary" onClick={() => onOpen(event)}>
              {event.kind === "meal" ? "View meal" : "View event"}{" "}
              <Icon name="arrow" size={16} />
            </button>
            <span>
              {event.source === "daywell"
                ? "Planned in WhatsCooking.ai"
                : event.source === "apple"
                  ? "Apple Calendar"
                  : event.source === "ics"
                    ? "Imported calendar"
                    : "Added in WhatsCooking.ai"}
            </span>
          </div>
        </>
      ) : (
        <>
          <h2>
            {connected ? "You’re all caught up." : "Your day, in one place."}
          </h2>
          <p>
            {connected
              ? "No more calendar events today. Schedule a meal when you’re ready to eat."
              : "Schedule a meal here. Classes, workouts, and other events come from your calendar."}
          </p>
          <div className="coming-actions">
            <button className="primary" onClick={() => onAdd(date)}>
              Schedule a meal <Icon name="arrow" size={16} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function CalendarConnect({ state, onSave, onClose, date }) {
  const [consent,setConsent]=useState(false);
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [gcalBusy, setGcalBusy] = useState(false),
    [gcalConnected, setGcalConnected] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const appleConnected=state.calendar.connected && state.calendar.source==='apple' && status?.authorized===true;
  useEffect(() => {
    let active = true;
    fetch("/api/calendar/status")
      .then(async (r) => {
        const result = await r.json();
        if (active) setStatus({...result,bridgeAvailable:r.ok});
      })
      .catch(() => {
        if (active) setStatus({ supported: false });
      });
    fetch("/api/google-calendar/status")
      .then(async (r) => { if (r.ok && active) setGcalConnected((await r.json()).connected); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  async function connectGoogle() {
    setGcalBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/google-calendar/auth-url");
      if (!r.ok) throw new Error((await r.json()).detail || "Could not start Google sign-in.");
      const { url } = await r.json();
      const popup = window.open(url, "gcal-oauth", "width=520,height=640");
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Sign-in timed out.")), 120000);
        const onMsg = (e) => {
          if (e.data?.type === "gcal-connected") { clearTimeout(t); window.removeEventListener("message", onMsg); resolve(); }
        };
        window.addEventListener("message", onMsg);
        const poll = setInterval(() => { if (popup?.closed) { clearInterval(poll); clearTimeout(t); window.removeEventListener("message", onMsg); resolve(); } }, 500);
      });
      setMessage("Loading Google Calendar events…");
      const from = `${addDays(date, -35)}T00:00:00Z`, to = `${addDays(date, 55)}T00:00:00Z`;
      const ev = await fetch(`/api/google-calendar/events?from_=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const evData = await ev.json();
      if (!ev.ok) throw new Error(evData.detail || "Could not fetch events.");
      await onSave({ type: "importCalendar", source: "ics", provider: "google", events: evData.events.map((e) => ({ ...e, kind: eventKind(e.title) })), range: { from, to } });
      setGcalConnected(true);
      setMessage(`${evData.events.length} events loaded from Google Calendar.`);
    } catch (err) {
      setError(err.message);
      setMessage("");
    } finally {
      setGcalBusy(false);
    }
  }
  async function connect() {
    if(!appleConnected&&!consent){setError("Allow calendar reading below before connecting.");return;}
    setBusy(true);
    setError("");
    setMessage(status?.authorized?"Using your existing macOS permission…":"Approve the macOS Calendar permission prompt to continue…");
    try {
      const response = await fetch("/api/calendar/connect", { method: "POST",signal:AbortSignal.timeout(95000) }),
        access = await response.json();
      setStatus(access);
      if (!response.ok || !access.authorized)
        throw new Error(
          access.error ||
            "Approve the macOS Calendar permission prompt to connect.",
        );
      setStatus(access);
      setMessage("Reading your selected date range…");
      const from = `${addDays(date, -35)}T00:00:00Z`,
        to = `${addDays(date, 55)}T00:00:00Z`;
      const read = await fetch(
          `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
        data = await read.json();
      if (!read.ok || !data.authorized)
        throw new Error(data.error || "Calendar read failed.");
      await onSave({
        type: "importCalendar",
        source: "apple",
        events: data.events.map((e) => ({ ...e, kind: eventKind(e.title) })),
        range: { from, to },
      });
      setMessage(
        `${data.events.length} events loaded from Apple Calendar. Your Today and My Meal Plan views are updated.`,
      );
    } catch (err) {
      setError(err.message);
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Connect your calendar" onClose={onClose}>
      <div className="connection-choice">
        <span className="connection-icon">
          <Icon name="calendar" size={28} />
        </span>
        <div>
          <h3>Integrate Calendar</h3>
          <p>
            Load events from calendars connected to Apple Calendar, or connect Google Calendar. Connected calendars refresh every five minutes while Daywell is open and when you return. No
            calendar events are changed.
          </p>
        </div>
      </div>
      <p className="fine-print">
        Apple asks for “full access” to read events. WhatsCooking.ai’s local bridge only
        reads; it has no create, edit or delete endpoint. Your events stay on
        this Mac and in this browser.
      </p>
      {!appleConnected && <label className="check-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Allow WhatsCooking.ai to read Apple Calendar events for meal scheduling on this Mac.</label>}
      {status?.authorized && !appleConnected && <p className="fine-print">macOS permission is already granted. Connecting below gives this app permission to import events; macOS will not show the system prompt again.</p>}
      {status?.needsSettings && <p className="error">Calendar permission was denied or restricted. Allow access in System Settings → Privacy & Security → Calendars, then retry.</p>}
      <button
        className="primary wide-button"
        disabled={busy || status?.supported === false || (!appleConnected&&!consent)}
        onClick={connect}
      >
        {busy
          ? "Connecting…"
          : appleConnected
            ? "Refresh Apple Calendar"
            : "Connect Apple Calendar"}
      </button>
      {status?.supported === false && (
        <p className="error">
          Start the local WhatsCooking.ai server on your Mac to use Apple Calendar.
        </p>
      )}
      <button
        className="secondary wide-button"
        disabled={gcalBusy}
        onClick={connectGoogle}
        style={{ marginTop: 8 }}
      >
        {gcalBusy ? "Connecting…" : gcalConnected ? "Refresh Google Calendar" : "Connect Google Calendar"}
      </button>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state.calendar.connected && (
        <div className="dialog-actions">
          <button
            className="text-button"
            onClick={async () => {
              await onSave({ type: "disconnectCalendar" });
              setConsent(false);
              setMessage(
                "Imported events removed from WhatsCooking.ai. Apple Calendar is unchanged.",
              );
            }}
          >
            Disconnect & remove imported events
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

export function EventDialog({
  event,
  date,
  onSave,
  onClose,
  onMeal,
  onRemoveMeal,
  onRevise,
}) {
  const [title, setTitle] = useState(event?.title ?? ""),
    [eventDate, setEventDate] = useState(event ? dayKey(event.start) : date),
    [start, setStart] = useState(event ? timeKey(event.start) : "12:00"),
    [end, setEnd] = useState(event ? timeKey(event.end) : "12:45"),
    [location, setLocation] = useState(event?.location ?? ""),
    [busy, setBusy] = useState(event ? blocksMealPlanning(event) : true),
    [error, setError] = useState("");
  if (event?.plan)
    return (
      <Modal title="Planned meal" onClose={onClose}>
        <h3>{event.title}</h3>
        <p>
          {prettyDate(dayKey(event.start))} · {timeLabel(event.start)}–
          {timeLabel(event.end)}
        </p>
        <p className="muted">
          One portion · {event.plan.duration} minutes (prep + cook).
        </p>
        <div className="dialog-actions">
          <button className="primary" onClick={() => onRevise(event.plan)}>
            Change this meal
          </button>
          <button
            className="secondary"
            onClick={() => {
              const meal = byId[event.plan.mealId];
              if (meal) onMeal(meal);
            }}
            disabled={!byId[event.plan.mealId]}
          >
            Recipe & nutrition
          </button>
          <button
            className="text-button"
            onClick={() => {
              onRemoveMeal(event.plan.id);
              onClose();
            }}
          >
            Remove from plan
          </button>
        </div>
      </Modal>
    );
  if (event?.readOnly)
    return (
      <Modal title={event.title} onClose={onClose}>
        <div className="event-readout">
          <p>
            <Icon name="calendar" />{" "}
            {prettyDate(dayKey(event.start), { weekday: "long" })}
          </p>
          <p>
            <Icon name="clock" />{" "}
            {event.allDay
              ? "All day"
              : `${timeLabel(event.start)}–${timeLabel(event.end)}`}
          </p>
          {event.location && <p>{event.location}</p>}
          <p className="fine-print">
            {event.calendar || "Imported calendar"} ·{" "}
            {event.source === "apple" ? "Apple Calendar" : "iCalendar file"}
          </p>
        </div>
        {isHolidayEvent(event) && <p className="success">Informational holiday · does not block meals unless you choose to mark it busy.</p>}
        <label className="check-label"><input type="checkbox" checked={busy} onChange={async e=>{const next=e.target.checked;try{await onSave({type:"setEventMealAvailability",id:event.id,busy:next});setBusy(next);setError("");}catch(err){setError(err.message);}}}/>Block meal planning during this event</label>
        <p className="fine-print">This setting only affects Daywell. The original calendar event stays unchanged.</p>
        <button className="text-button" onClick={async()=>{try{await onSave({type:"setEventMealAvailability",id:event.id,busy:null});setBusy(blocksMealPlanning({...event,mealBusyOverride:undefined}));setError("");}catch(err){setError(err.message);}}}>Use automatic setting</button>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="muted">Edit the event’s title and times in its source calendar.</p>
      </Modal>
    );
  return (
    <Modal
      title={event && !event.draft ? "Edit meal" : "Schedule a meal"}
      onClose={onClose}
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        You can only schedule meals here. Classes, workouts, and other events
        should come from your connected calendar.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({
              type: "saveEvent",
              event: {
                id: event?.id ?? crypto.randomUUID(),
                title: title.trim() || "Meal",
                start: localInstant(eventDate, start),
                end: localInstant(eventDate, end),
                kind: "meal",
                location,
                busy,
                source: "manual",
                readOnly: false,
              },
            });
            onClose();
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <label>
          Meal title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lunch · tofu stir-fry"
          />
        </label>
        <div className="form-grid">
          <label>
            Date
            <input
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </label>
          <label>
            Type
            <input type="text" value="Meal" disabled readOnly />
          </label>
          <label>
            Starts
            <input
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Ends
            <input
              type="time"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="spaced-label">
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="check-label spaced-label">
          <input
            type="checkbox"
            checked={busy}
            onChange={(e) => setBusy(e.target.checked)}
          />
          Treat this as busy time
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {event && !event.draft && (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                await onSave({ type: "deleteEvent", id: event.id });
                onClose();
              }}
            >
              Remove meal
            </button>
          )}
          <button className="primary" type="submit">
            Save meal
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PlanCalendar({
  onAddRange,
  items,
  date,
  onDate,
  onOpen,
  onAdd,
  onConnect,
  now,
  connected,
}) {
  const [view, setView] = useState("week");
  const [selection,setSelection] = useState(null);
  const dragRef = useRef(null);
  const dragPoint = e => 420+(e.clientY-e.currentTarget.getBoundingClientRect().top)/52*60;

  const weekRef = useRef(null);
  useEffect(() => {
    const reveal = () => {
      const el = weekRef.current,
        selected = el?.querySelector(".week-head .active");
      if (!selected) return;
      const offset =
        selected.getBoundingClientRect().left -
        el.getBoundingClientRect().left +
        el.scrollLeft;
      el.scrollLeft = Math.max(
        0,
        offset - el.clientWidth / 2 + selected.clientWidth / 2,
      );
    };
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [date, view]);
  const current = new Date(`${date}T12:00:00Z`),
    weekStart = addDays(date, -((current.getUTCDay() + 6) % 7)),
    days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const first = `${date.slice(0, 7)}-01`,
    monthStart = addDays(
      first,
      -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7),
    ),
    monthDays = Array.from({ length: 42 }, (_, i) => addDays(monthStart, i));
  return (
    <div className="plan-layout">
      <section className="calendar-board">
        <div className="calendar-toolbar">
          <div className="calendar-range">
            <button
              className="icon-button"
              aria-label="Previous calendar period"
              onClick={() =>
                onDate(
                  view === "week" ? addDays(date, -7) : addMonths(date, -1),
                )
              }
            >
              ‹
            </button>
            <h2>
              {prettyDate(date, {
                month: "long",
                year: "numeric",
                day: undefined,
              })}
            </h2>
            <button
              className="icon-button"
              aria-label="Next calendar period"
              onClick={() =>
                onDate(view === "week" ? addDays(date, 7) : addMonths(date, 1))
              }
            >
              ›
            </button>
          </div>
          <div className="calendar-views">
            <button
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Week
            </button>
            <button
              aria-pressed={view === "month"}
              onClick={() => setView("month")}
            >
              Month
            </button>
          </div>
        </div>
        {view === "month" ? (
          <div className="month-grid">
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
              <span className="weekday" key={d}>
                {d}
              </span>
            ))}
            {monthDays.map((day) => (
              <div
                className={`month-day ${day.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""} ${day === date ? "active" : ""}`}
                key={day}
              >
                <button className="day-number" onClick={() => onDate(day)}>
                  {Number(day.slice(-2))}
                </button>
                {eventsForDay(items, day)
                  .slice(0, 3)
                  .map((e) => (
                    <button
                      className={`calendar-chip ${e.kind}${e.openSlot ? " open-slot" : ""}`}
                      key={e.id}
                      onClick={() => {
                        onDate(day);
                        onOpen(e);
                      }}
                    >
                      {e.title}
                    </button>
                  ))}
                {eventsForDay(items, day).length > 3 && (
                  <button className="more-events" onClick={() => onDate(day)}>
                    +{eventsForDay(items, day).length - 3} more
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="calendar-week" ref={weekRef}>
            <div className="week-head">
              <span />
              {days.map((day) => (
                <button
                  key={day}
                  className={day === date ? "active" : ""}
                  onClick={() => onDate(day)}
                >
                  <small>
                    {prettyDate(day, {
                      weekday: "short",
                      month: undefined,
                      day: undefined,
                    })}
                  </small>
                  <strong>{Number(day.slice(-2))}</strong>
                </button>
              ))}
            </div>
            <div className="all-day-row">
              <span>All day</span>
              {days.map((day) => (
                <div key={day}>
                  {eventsForDay(items, day)
                    .filter((e) => e.allDay)
                    .map((e) => (
                      <button
                        className={`calendar-chip ${e.kind}`}
                        key={e.id}
                        onClick={() => onOpen(e)}
                      >
                        {e.title}
                      </button>
                    ))}
                </div>
              ))}
            </div>
            <div className="week-scroll">
              <div className="week-grid">
                <div className="time-axis">
                  {Array.from({ length: 15 }, (_, i) => (
                    <span key={i} style={{ top: i * 52 }}>
                      {i + 7 > 12 ? i + 7 - 12 : i + 7}
                      {i + 7 >= 12 ? "p" : "a"}
                    </span>
                  ))}
                </div>
                {days.map((day) => (
                  <div
                    className={`week-day ${day === date ? "active" : ""}`}
                    key={day}
                    onDoubleClick={() => onAdd(day)}
                    onPointerDown={e=>{if(e.button!==0||e.target.closest('button'))return;e.currentTarget.setPointerCapture(e.pointerId);dragRef.current={day,anchor:dragPoint(e)};setSelection({day,...dragWindow(dragPoint(e),dragPoint(e),420,1320)});}}
                    onPointerMove={e=>{if(dragRef.current)setSelection({day,...dragWindow(dragRef.current.anchor,dragPoint(e),420,1320)});}}
                    onPointerUp={e=>{if(!dragRef.current)return;const range=dragWindow(dragRef.current.anchor,dragPoint(e),420,1320);dragRef.current=null;setSelection(null);onDate(day);onAddRange?.(day,range);}}
                    onPointerCancel={()=>{dragRef.current=null;setSelection(null);}}
                  >
                    {Array.from({ length: 15 }, (_, i) => (
                      <div className="hour-line" key={i} />
                    ))}
                    {selection?.day===day && <div className="calendar-drag-range" style={{top:(Number(selection.start.slice(0,2))*60+Number(selection.start.slice(3))-420)/60*52,height:selection.available/60*52}}>{selection.start}–{selection.end}</div>}
                    {layoutDayEvents(items, day).map(
                      ({
                        event: e,
                        start: clippedStart,
                        end: clippedEnd,
                        column,
                        columns,
                      }) => {
                        const start = Math.max(
                            7,
                            Number(timeKey(clippedStart).slice(0, 2)) +
                              Number(timeKey(clippedStart).slice(3)) / 60,
                          ),
                          end =
                            dayKey(clippedEnd) !== day
                              ? 22
                              : Number(timeKey(clippedEnd).slice(0, 2)) +
                                Number(timeKey(clippedEnd).slice(3)) / 60;
                        if (end <= 7 || start >= 22) return null;
                        return (
                          <button
                            key={e.id}
                            className={`week-event ${e.kind}${e.openSlot ? " open-slot" : ""}`}
                            style={{
                              top: (start - 7) * 52,
                              height: Math.max(
                                22,
                                (Math.min(22, end) - start) * 52,
                              ),
                              left: `calc(${(column * 100) / columns}% + 2px)`,
                              width: `calc(${100 / columns}% - 4px)`,
                              right: "auto",
                            }}
                            onClick={() => onOpen(e)}
                            title={`${e.title} · ${timeLabel(e.start)}`}
                          >
                            <strong>{e.title}</strong>
                            <small>{timeLabel(e.start)}</small>
                          </button>
                        );
                      },
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="calendar-legend">
          <span className="activity-dot class" />
          Classes & events
          <span className="activity-dot meal" />
          Meals
          <span className="activity-dot workout" />
          Movement
          <span className="activity-dot task" />
          Tasks
        </div>
        <p className="fine-print calendar-local-note">
          Drag an empty period to add an activity. Imported events are read-only. Meals and activities you add here stay
          in Daywell. Week shows 7 AM–10 PM; the day list includes all times.
        </p>
      </section>
      <div className="calendar-right">
        <Agenda
          items={items}
          date={date}
          now={now}
          connected={connected}
          onOpen={onOpen}
          onAdd={onAdd}
        />
        <SidebarNotes date={date} />
        <button className="secondary wide-button" onClick={onConnect}>
          <Icon name="calendar" />
          Calendar connection
        </button>
      </div>
    </div>
  );
}
