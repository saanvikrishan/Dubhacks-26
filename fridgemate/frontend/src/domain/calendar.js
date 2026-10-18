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
// Informational holidays stay visible without consuming the entire meal day.
const FESTIVALS = new Set(["重阳节","重陽節","春节","春節","元宵节","元宵節","清明节","清明節","端午节","端午節","中秋节","中秋節","七夕节","七夕節","冬至","除夕"]);
export function isHolidayEvent(event) {
  return event?.allDay === true && (event.isHoliday === true || FESTIVALS.has(event.title?.trim()) || /holidays|节假日|節假日|^节日$|^節日$/i.test(event.calendar ?? ""));
}
export function blocksMealPlanning(event) {
  if (typeof event?.mealBusyOverride === "boolean") return event.mealBusyOverride;
  return event?.busy === true && !isHolidayEvent(event);
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
  const plans = s.mealPlans.map((plan) => {
    const meal = meals[plan.mealId];
    return {
      id: plan.id,
      title: plan.openSlot
        ? `${plan.slotLabel ? plan.slotLabel.charAt(0).toUpperCase() + plan.slotLabel.slice(1) : "Meal"} slot — choose a meal`
        : (meal?.name ?? "Planned meal"),
      start: localInstant(plan.date, plan.start),
      end: new Date(
        Date.parse(localInstant(plan.date, plan.start)) + (plan.duration ?? 60) * 60000,
      ).toISOString(),
      kind: "meal",
      source: plan.openSlot ? "daywell" : "daywell",
      location: meal?.venue?.name ?? (plan.openSlot ? "" : "Cook at home"),
      busy: true,
      readOnly: false,
      openSlot: plan.openSlot ?? false,
      slotLabel: plan.slotLabel ?? null,
      plan,
    };
  });
  return [...s.events.map(e=>({...e,busy:blocksMealPlanning(e)})), ...plans].sort(
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
    events.find((e) => !e.completed && !isHolidayEvent(e) && Date.parse(e.end) > +now) ??
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
      blocksMealPlanning(e) &&
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
/** True while the selected dated window has not ended, including future dates. */
export function mealWindowStillOpen(context, now = new Date()) {
  if (!context) return false;
  if (!Number.isFinite(context.available) || context.available <= 0) return false;
  let start;
  try {
    start = Date.parse(localInstant(context.date, context.start));
  } catch {
    return false;
  }
  return Number.isFinite(start) && now.getTime() < start + context.available * 60000;
}

/**
 * Auto-schedule breakfast, lunch, and dinner for a given day, avoiding
 * calendar conflicts (class, workout, event — anything busy).
 *
 * Meal windows (all times in HH:MM, America/Los_Angeles):
 *   breakfast  07:00 – 11:00  (need at least 45 min gap)
 *   lunch      12:00 – 15:00
 *   dinner     17:00 – 21:00
 *
 * Returns an array of { slot: "breakfast"|"lunch"|"dinner", start, available, commitmentTime }
 * Skips a slot when no free window ≥ 45 min exists within the constraint.
 */
export function scheduleMealsForDay(events, date) {
  const MEAL_WINDOWS = [
    { slot: "breakfast", windowStart: "07:00", windowEnd: "11:00" },
    { slot: "lunch",     windowStart: "12:00", windowEnd: "15:00" },
    { slot: "dinner",    windowStart: "17:00", windowEnd: "21:00" },
  ];
  const MIN_WINDOW = 45; // minutes

  // Busy events for the day (class, workout, event, meal — anything with busy:true)
  const busy = eventsForDay(events, date)
    .filter((e) => blocksMealPlanning(e) && !e.completed && e.kind !== "task")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const result = [];

  for (const { slot, windowStart, windowEnd } of MEAL_WINDOWS) {
    const wStart = Date.parse(localInstant(date, windowStart));
    const wEnd   = Date.parse(localInstant(date, windowEnd));

    // Walk the busy events to find the first free gap of ≥ MIN_WINDOW minutes
    // within the constraint window.
    let cursor = wStart;
    let found = null;

    const sentinel = { start: new Date(wEnd).toISOString(), end: new Date(wEnd).toISOString(), title: "End of window" };
    for (const item of [...busy, sentinel]) {
      const itemStart = Date.parse(item.start);
      const itemEnd   = Date.parse(item.end);

      // Skip events that end before our cursor or start after the window
      if (itemEnd <= cursor) continue;
      if (itemStart >= wEnd) {
        // Gap from cursor to window end
        const gapMs = wEnd - cursor;
        if (gapMs >= MIN_WINDOW * 60000) {
          const available = Math.floor(gapMs / 60000);
          found = {
            slot,
            start: timeKey(cursor),
            available: Math.min(available, 90), // cap at 90 min for planning
            commitmentTime: windowEnd,
            commitment: "No further commitment",   // nothing on the calendar after it: no time limit
          };
        }
        break;
      }

      // Gap from cursor to this event
      const gapEnd = Math.min(wEnd, itemStart);
      const gapMs  = gapEnd - cursor;
      if (gapMs >= MIN_WINDOW * 60000) {
        const available = Math.floor(gapMs / 60000);
        found = {
          slot,
          start: timeKey(cursor),
          available: Math.min(available, 90),
          commitmentTime: timeKey(gapEnd),
          commitment: item.title ?? "Event",
        };
        break;
      }

      // Advance cursor past this busy event
      cursor = Math.max(cursor, itemEnd);
      if (cursor >= wEnd) break;
    }

    if (found) result.push(found);
  }

  return result;
}

/** The next meal: from now until the next busy calendar item, or with no time limit when nothing is scheduled. */
export function nextMealContext(state, meals, now = new Date()) {
  const busy = scheduledItems(state, meals), date = dayKey(now);
  const window = nextMealWindow(busy, date, now, 1440, "00:00") ?? nextMealWindow(busy, addDays(date, 1), now, 1440);
  return window && { ...window, manuallySet: false };
}

export function nextMealWindow(events, date, now = new Date(), desired = 60, earliest = "08:00") {
  const dayStart = Date.parse(localInstant(date, earliest)),
    dayEnd = Date.parse(localInstant(date, "23:59"));
  let cursor = Math.max(
    dayStart,
    dayKey(now) === date ? Math.ceil(+now / 300000) * 300000 : dayStart,
  );
  const busy = eventsForDay(events, date)
    .filter((e) => blocksMealPlanning(e) && !e.completed && e.kind !== "task")
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

// File imports stay local; recurrence identities remain stable when an instance moves.
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
    events = new Map(),
    warnings = [];
  const store = (event) => {
    events.set(event.id, validateEvent(event));
    if (events.size > 10000)
      throw new Error("Import fewer than 10,000 events at a time.");
  };
  const instant = (time, comp, property = "dtstart") => {
    if (time.isDate) return localInstant(time.toString().slice(0, 10), "00:00");
    const prop = comp.getFirstProperty(property);
    // A derived end (DURATION/default) inherits the start's time zone.
    const tzid =
      prop?.getParameter("tzid") ??
      (!prop && property === "dtend"
        ? comp.getFirstProperty("dtstart")?.getParameter("tzid")
        : undefined);
    if (time.zone?.tzid === "UTC" || (tzid && time.zone?.tzid !== "floating"))
      return time.toJSDate().toISOString();
    return new Date(
      Date.parse(
        localInstant(
          time.toString().slice(0, 10),
          time.toString().slice(11, 16),
          tzid || TIMEZONE,
        ),
      ) +
        time.second * 1000,
    ).toISOString();
  };
  const isCancelled = (component) =>
    component.getFirstPropertyValue("status") === "CANCELLED";
  let iterations = 0;
  for (const comp of components.filter(
    (c) => !c.hasProperty("recurrence-id"),
  )) {
    if (isCancelled(comp)) continue;
    // ICAL's default constructor relates every sibling exception, including other UIDs.
    const master = new ICAL.Event(comp, {
      exceptions: [],
      strictExceptions: true,
    });
    if (!master.startDate) {
      warnings.push("Skipped an event without a start.");
      continue;
    }
    const exceptions = components
      .filter(
        (c) =>
          c.hasProperty("recurrence-id") &&
          c.getFirstPropertyValue("uid") === master.uid,
      )
      .map((c) => new ICAL.Event(c));
    const cancelled = new Set(),
      ranges = [],
      directOverrides = new Set();
    let backwardShift = 0;
    for (const exception of exceptions) {
      let nominal;
      try {
        nominal = instant(exception.recurrenceId, comp);
        if (exception.modifiesFuture())
          ranges.push({
            start: Date.parse(nominal),
            cancelled: isCancelled(exception.component),
          });
        else if (!isCancelled(exception.component))
          directOverrides.add(nominal);
      } catch {
        warnings.push("Skipped an exception with an unsupported time zone.");
        continue;
      }
      if (isCancelled(exception.component)) {
        try {
          cancelled.add(nominal);
        } catch {
          warnings.push(
            "Skipped a cancellation with an unsupported time zone.",
          );
        }
        continue;
      }
      master.relateException(exception);
      if (exception.modifiesFuture()) {
        try {
          backwardShift = Math.max(
            backwardShift,
            Date.parse(instant(exception.recurrenceId, comp)) -
              Date.parse(instant(exception.startDate, exception.component)),
          );
        } catch {
          warnings.push("A shifted series has an unsupported time zone.");
        }
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const append = (occurrence) => {
      let data;
      try {
        const nominal = instant(occurrence, comp);
        const range = ranges
          .filter((item) => item.start <= Date.parse(nominal))
          .at(-1);
        if (
          cancelled.has(nominal) ||
          (range?.cancelled && !directOverrides.has(nominal))
        )
          return;
        const details = master.getOccurrenceDetails(occurrence),
          item = details.item,
          component = item.component;
        if (isCancelled(component)) return;
        const start = instant(details.startDate, component);
        let end;
        const duration = component.getFirstPropertyValue("duration");
        if (duration && !component.hasProperty("dtend")) {
          if (duration.isNegative) throw new Error("Negative event duration.");
          // Days/weeks follow the local calendar; hours/minutes/seconds are elapsed time.
          const localEnd = details.startDate.clone();
          localEnd.day += duration.weeks * 7 + duration.days;
          end = new Date(
            Date.parse(instant(localEnd, component)) +
              (duration.hours * 3600 +
                duration.minutes * 60 +
                duration.seconds) *
                1000,
          ).toISOString();
        } else end = instant(details.endDate, component, "dtend");
        if (Date.parse(end) <= Date.parse(start)) {
          if (component.hasProperty("dtend") || duration)
            throw new Error("Nonpositive event duration.");
          if (details.startDate.isDate) {
            const next = details.startDate.clone();
            next.day += 1;
            end = instant(next, component);
          } else {
            end = new Date(Date.parse(start) + 1800000).toISOString();
            warnings.push(
              `No end time for ${item.summary || "an event"}; using a 30-minute planning allowance.`,
            );
          }
        }
        if (Date.parse(start) >= rangeEnd || Date.parse(end) <= rangeStart)
          return;
        data = {
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
        };
      } catch {
        warnings.push(
          `Skipped an occurrence of ${master.summary || "an event"} with an invalid time zone or duration.`,
        );
        return;
      }
      store(data);
    };
    // Moved-in exceptions can have nominal recurrence dates outside the imported range.
    for (const exception of exceptions)
      if (!isCancelled(exception.component)) append(exception.recurrenceId);
    const iterator = master.iterator();
    let occurrence;
    // Include instances shifted back by THISANDFUTURE, with room for a DST transition.
    const cutoff =
      rangeEnd + backwardShift + (backwardShift > 0 ? 86400000 : 0);
    while ((occurrence = iterator.next())) {
      if (++iterations > 100000)
        throw new Error(
          "This calendar has too many recurrence instances. Export a smaller date range.",
        );
      try {
        if (Date.parse(instant(occurrence, comp)) >= cutoff) break;
      } catch {
        warnings.push(
          `Unsupported time zone for ${master.summary || "an event"}.`,
        );
        break;
      }
      append(occurrence);
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
    let start;
    try {
      start = instant(due, task, task.hasProperty("due") ? "due" : "dtstart");
    } catch {
      warnings.push("Skipped a task with an unsupported time zone.");
      continue;
    }
    if (Date.parse(start) < rangeStart || Date.parse(start) >= rangeEnd)
      continue;
    store({
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
    });
  }
  return {
    events: [...events.values()].sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start),
    ),
    warnings,
    range: {
      from: new Date(rangeStart).toISOString(),
      to: new Date(rangeEnd).toISOString(),
    },
  };
}
