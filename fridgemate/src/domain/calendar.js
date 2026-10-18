import ICAL from "ical.js";

export const TIMEZONE = "America/Los_Angeles";
export const dayKey = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const timeKey = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
export const addDays = (date, count) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000)
    .toISOString()
    .slice(0, 10);
export function addMonths(date, count) {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + count);
  const last = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(Number(date.slice(-2)), last));
  return value.toISOString().slice(0, 10);
}
export const prettyDate = (date, options = {}) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
export function localInstant(date, time, zone = TIMEZONE) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("Enter a valid calendar date and time.");
  const [year, month, day] = date.split("-").map(Number),
    [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let value = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(value))
        .map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
    );
    const delta = target - represented;
    if (!delta) return new Date(value).toISOString();
    value += delta;
  }
  throw new Error(
    "This local time does not exist because of a daylight-saving change.",
  );
}
export function eventKind(title = "") {
  if (/class|lecture|seminar|lab\b|course/i.test(title)) return "class";
  if (/workout|gym|run\b|yoga|strength|exercise/i.test(title)) return "workout";
  if (/lunch|dinner|breakfast|meal/i.test(title)) return "meal";
  return "event";
}
export function validateEvent(event) {
  if (
    typeof event.id !== "string" ||
    !event.id ||
    typeof event.title !== "string" ||
    !event.title.trim() ||
    !Number.isFinite(Date.parse(event.start)) ||
    !Number.isFinite(Date.parse(event.end)) ||
    Date.parse(event.end) <= Date.parse(event.start)
  )
    throw new Error("An event needs a title and an end after its start.");
  if (typeof event.busy !== "boolean")
    throw new Error("An event needs an explicit busy/free value.");
  if (!["event", "class", "workout", "task", "meal"].includes(event.kind))
    throw new Error("Unsupported activity type.");
  return event;
}
export function normalizeCalendarState(state) {
  const plan = state.plan
    ? {
        ...state.plan,
        id: state.plan.id ?? `meal:${state.plan.date}:${state.plan.start}`,
      }
    : null;
  return {
    ...state,
    plan,
    mealPlans: state.mealPlans ?? (plan ? [plan] : []),
    events: state.events ?? [],
    calendar: state.calendar ?? {
      source: "manual",
      connected: false,
      lastSync: null,
    },
    planUndo: state.planUndo ?? null,
    logUndo: state.logUndo ?? null,
  };
}
export function scheduledItems(state, meals) {
  const s = normalizeCalendarState(state);
  const plans = s.mealPlans.map((plan) => ({
    id: plan.id,
    title: meals[plan.mealId]?.name ?? "Planned meal",
    start: localInstant(plan.date, plan.start),
    end: new Date(
      Date.parse(localInstant(plan.date, plan.start)) + plan.duration * 60000,
    ).toISOString(),
    kind: "meal",
    source: "daywell",
    location: meals[plan.mealId]?.venue?.name ?? "Cook at home",
    busy: true,
    readOnly: false,
    plan,
  }));
  return [...s.events, ...plans].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
}
export function eventsForDay(events, date) {
  const start = Date.parse(localInstant(date, "00:00")),
    end = Date.parse(localInstant(addDays(date, 1), "00:00"));
  return events
    .filter((e) => Date.parse(e.start) < end && Date.parse(e.end) > start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
export function comingUp(events, now = new Date()) {
  return (
    events.find((e) => !e.completed && Date.parse(e.end) > +now && !e.allDay) ??
    events.find((e) => !e.completed && Date.parse(e.end) > +now) ??
    null
  );
}
export function calendarConflicts(state, duration) {
  if (!duration) return [];
  const start = Date.parse(
      localInstant(state.context.date, state.context.start),
    ),
    end = start + duration * 60000;
  const plans = (state.mealPlans ?? [])
    .filter(
      (p) => p.date !== state.context.date || p.start !== state.context.start,
    )
    .map((p) => ({
      title: "another planned meal",
      start: localInstant(p.date, p.start),
      end: new Date(
        Date.parse(localInstant(p.date, p.start)) + p.duration * 60000,
      ).toISOString(),
      busy: true,
      kind: "meal",
    }));
  return [...(state.events ?? []), ...plans].filter(
    (e) =>
      e.busy &&
      !e.completed &&
      e.kind !== "task" &&
      Date.parse(e.start) < end &&
      Date.parse(e.end) > start,
  );
}
// Partition intersecting timed events into columns, retaining every event button.
export function layoutDayEvents(events, date) {
  const midnight = Date.parse(localInstant(date, "00:00")),
    next = Date.parse(localInstant(addDays(date, 1), "00:00"));
  const timed = eventsForDay(events, date)
    .filter((e) => !e.allDay)
    .map((event) => ({
      event,
      start: Math.max(midnight, Date.parse(event.start)),
      end: Math.min(next, Date.parse(event.end)),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  let cluster = [],
    clusterEnd = -Infinity;
  const flush = () => {
    const ends = [];
    for (const item of cluster) {
      let column = ends.findIndex((end) => end <= item.start);
      if (column < 0) column = ends.length;
      ends[column] = item.end;
      item.column = column;
    }
    result.push(...cluster.map((item) => ({ ...item, columns: ends.length })));
    cluster = [];
  };
  for (const item of timed) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = item.end;
    } else clusterEnd = Math.max(clusterEnd, item.end);
    cluster.push(item);
  }
  flush();
  return result;
}
export function nextMealWindow(events, date, now = new Date(), desired = 60) {
  const dayStart = Date.parse(localInstant(date, "08:00")),
    dayEnd = Date.parse(localInstant(date, "23:59"));
  let cursor = Math.max(
    dayStart,
    dayKey(now) === date ? Math.ceil(+now / 300000) * 300000 : dayStart,
  );
  const busy = eventsForDay(events, date)
    .filter((e) => e.busy && !e.completed && e.kind !== "task")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const item of [
    ...busy,
    {
      start: new Date(dayEnd).toISOString(),
      end: new Date(dayEnd).toISOString(),
      title: "No further commitment",
    },
  ]) {
    const gapEnd = Math.min(dayEnd, Date.parse(item.start)),
      available = Math.floor((gapEnd - cursor) / 60000);
    if (available >= 35)
      return {
        date,
        start: timeKey(cursor),
        available: Math.min(desired, available),
        commitment: item.title,
        commitmentTime: timeKey(gapEnd),
      };
    cursor = Math.max(cursor, Date.parse(item.end));
  }
  return null;
}

// File imports stay local. ICAL.js handles recurrence/exceptions and embedded zones;
// IANA TZID values without VTIMEZONE use Intl instead of silently becoming UTC.
export function importIcs(text, { from, to } = {}) {
  if (typeof text !== "string" || text.length > 1500000)
    throw new Error("Choose an .ics file smaller than 1.5 MB.");
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error("This file is not a valid iCalendar export.");
  }
  if (root.name !== "vcalendar")
    throw new Error("Choose a VCALENDAR (.ics) export.");
  for (const zone of root.getAllSubcomponents("vtimezone"))
    ICAL.TimezoneService.register(new ICAL.Timezone(zone));
  const rangeStart = Date.parse(
    from ?? `${addDays(dayKey(new Date()), -40)}T00:00:00Z`,
  );
  const rangeEnd = Date.parse(
    to ?? `${addDays(dayKey(new Date()), 400)}T00:00:00Z`,
  );
  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart
  )
    throw new Error("Choose a valid calendar date range.");
  const components = root.getAllSubcomponents("vevent"),
    events = [],
    warnings = [];
  const masters = components.filter(
    (comp) => !comp.hasProperty("recurrence-id"),
  );
  const instant = (time, comp, property = "dtstart") => {
    if (time.isDate) return localInstant(time.toString().slice(0, 10), "00:00");
    const tzid = comp.getFirstProperty(property)?.getParameter("tzid");
    if (time.zone?.tzid === "UTC") return time.toJSDate().toISOString();
    if (tzid && time.zone?.tzid !== "floating")
      return time.toJSDate().toISOString();
    return localInstant(
      time.toString().slice(0, 10),
      time.toString().slice(11, 16),
      tzid || TIMEZONE,
    );
  };
  let iterations = 0;
  for (const comp of masters) {
    const master = new ICAL.Event(comp);
    if (!master.startDate) {
      warnings.push("Skipped an event without a start.");
      continue;
    }
    const exceptions = components.filter(
      (c) =>
        c.hasProperty("recurrence-id") &&
        c.getFirstPropertyValue("uid") === master.uid,
    );
    for (const exception of exceptions)
      master.relateException(new ICAL.Event(exception));
    const iterator = master.iterator();
    let occurrence;
    while ((occurrence = iterator.next())) {
      if (++iterations > 100000)
        throw new Error(
          "This calendar has too many recurrence instances. Export a smaller date range.",
        );
      const details = master.getOccurrenceDetails(occurrence),
        item = details.item,
        component = item.component;
      let start, end;
      try {
        start = instant(details.startDate, component);
        end = instant(details.endDate, component, "dtend");
      } catch {
        warnings.push(
          `Unsupported time zone for ${item.summary || "an event"}.`,
        );
        continue;
      }
      if (Date.parse(start) >= rangeEnd) break;
      if (
        Date.parse(end) <= rangeStart ||
        component.getFirstPropertyValue("status") === "CANCELLED"
      )
        continue;
      if (Date.parse(end) <= Date.parse(start))
        end = new Date(
          Date.parse(start) + (details.startDate.isDate ? 86400000 : 1800000),
        ).toISOString();
      events.push(
        validateEvent({
          id: `ics:${master.uid}:${occurrence.toString()}`,
          title: item.summary || "Untitled event",
          start,
          end,
          allDay: details.startDate.isDate,
          location: component.getFirstPropertyValue("location") || "",
          calendar:
            root.getFirstPropertyValue("x-wr-calname") || "Imported calendar",
          kind: eventKind(item.summary),
          busy: component.getFirstPropertyValue("transp") !== "TRANSPARENT",
          source: "ics",
          readOnly: true,
        }),
      );
      if (events.length > 10000)
        throw new Error("Import fewer than 10,000 events at a time.");
      if (!master.isRecurring()) break;
    }
  }
  for (const task of root.getAllSubcomponents("vtodo")) {
    const due =
      task.getFirstPropertyValue("due") ??
      task.getFirstPropertyValue("dtstart");
    if (!due) {
      warnings.push("Skipped a task without a date.");
      continue;
    }
    const start = instant(
      due,
      task,
      task.hasProperty("due") ? "due" : "dtstart",
    );
    if (Date.parse(start) < rangeStart || Date.parse(start) >= rangeEnd)
      continue;
    events.push(
      validateEvent({
        id: `ics-task:${task.getFirstPropertyValue("uid")}`,
        title: task.getFirstPropertyValue("summary") || "Task",
        start,
        end: new Date(Date.parse(start) + 60000).toISOString(),
        allDay: due.isDate,
        busy: false,
        kind: "task",
        source: "ics",
        readOnly: true,
        completed: task.getFirstPropertyValue("status") === "COMPLETED",
        location: "",
      }),
    );
  }
  return {
    events: [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start),
    ),
    warnings,
    range: {
      from: new Date(rangeStart).toISOString(),
      to: new Date(rangeEnd).toISOString(),
    },
  };
}
