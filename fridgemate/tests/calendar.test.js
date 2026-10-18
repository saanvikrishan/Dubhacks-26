import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  calendarConflicts,
  comingUp,
  dayKey,
  eventsForDay,
  importIcs,
  layoutDayEvents,
  localInstant,
  nextMealWindow,
  scheduledItems,
  timeKey,
} from "../src/domain/calendar.js";
import {
  createDemoState,
  transition,
  validateState,
} from "../src/domain/state.js";
import { evaluate } from "../src/domain/engine.js";
import { byId } from "../src/data/catalog.js";
import { calendarApi } from "../server/calendar-bridge.js";
import {
  distanceMeters,
  HUB,
  uwDining,
  venueHours,
  directionsUrl,
} from "../src/data/uwDining.js";

const date = "2026-10-17";
const activity = (id, start, end, extra = {}) => ({
  id,
  title: id,
  start: localInstant(date, start),
  end: localInstant(date, end),
  kind: "class",
  busy: true,
  source: "manual",
  readOnly: false,
  ...extra,
});
const demo = () => {
  const state = createDemoState();
  state.context = { ...state.context, date };
  return state;
};

test("calendar migration preserves legacy plan, consumption and preferences", () => {
  const state = demo();
  const plan = {
    mealId: "chickpea-bowl",
    date,
    start: "12:00",
    duration: 50,
    servings: 1,
  };
  state.plan = plan;
  state.logs = [{ id: "legacy", mealId: "chickpea-bowl", date, servings: 0.5 }];
  delete state.mealPlans;
  delete state.events;
  delete state.calendar;
  const migrated = validateState(state);
  assert.equal(migrated.mealPlans[0].id, `meal:${date}:12:00`);
  assert.deepEqual(migrated.logs, state.logs);
  assert.deepEqual(migrated.profile, state.profile);
  assert.equal(
    scheduledItems(migrated, byId)[0].title,
    byId["chickpea-bowl"].name,
  );
});

test("multiple meal slots survive selection, replacement, removal and undo", () => {
  let state = transition(demo(), { type: "choose", mealId: "chickpea-bowl" });
  state = transition(state, {
    type: "updateContext",
    context: { start: "18:00", commitmentTime: "19:30" },
  });
  state = transition(state, { type: "choose", mealId: "chickpea-toast" });
  assert.equal(state.mealPlans.length, 2);
  state = transition(state, { type: "choose", mealId: "chickpea-rice-salad" });
  assert.equal(state.mealPlans.length, 2);
  state = transition(state, { type: "undo" });
  assert.equal(
    state.mealPlans.find((p) => p.start === "18:00").mealId,
    "chickpea-toast",
  );
  const id = state.mealPlans.find((p) => p.start === "12:00").id;
  state = transition(state, { type: "removeMealPlan", id });
  assert.equal(state.mealPlans.length, 1);
  state = transition(state, { type: "undo" });
  assert.equal(state.mealPlans.length, 2);
  assert.equal(state.logs.length, 0);
});

test("undo consumption handles create, edit and delete without touching other records", () => {
  let state = transition(demo(), {
    type: "log",
    id: "first",
    mealId: "chickpea-bowl",
    date,
    servings: 0.5,
  });
  state = transition(state, {
    type: "log",
    id: "second",
    mealId: "tofu-bowl",
    date,
    servings: 1,
  });
  state = transition(state, { type: "undoLog" });
  assert.deepEqual(
    state.logs.map((l) => l.id),
    ["first"],
  );
  state = transition(state, {
    type: "editLog",
    id: "first",
    mealId: "chickpea-bowl",
    date,
    servings: 0.75,
  });
  state = transition(state, { type: "undoLog" });
  assert.equal(state.logs[0].servings, 0.5);
  const before = structuredClone(state.logs);
  state = transition(state, { type: "removeLog", id: "first" });
  assert.equal(state.logs.length, 0);
  state = transition(state, { type: "undoLog" });
  assert.deepEqual(state.logs, before);
  assert.throws(() => transition(state, { type: "undoLog" }), /no meal-log/);
  assert.throws(
    () => transition(state, { type: "removeLog", id: "missing" }),
    /no longer/,
  );
});

test("calendar snapshots replace imported copies, preserve local tasks, and reject writes", () => {
  let state = transition(demo(), {
    type: "saveEvent",
    event: activity("task", "10:00", "10:05", { kind: "task", busy: false }),
  });
  state = transition(state, {
    type: "importCalendar",
    source: "apple",
    events: [activity("remote", "11:00", "12:00")],
  });
  assert.equal(state.events.length, 2);
  assert.throws(
    () => transition(state, { type: "deleteEvent", id: "remote" }),
    /source calendar/,
  );
  assert.throws(
    () =>
      transition(state, {
        type: "saveEvent",
        event: { ...state.events[1], title: "changed" },
      }),
    /read-only/,
  );
  state = transition(state, {
    type: "importCalendar",
    source: "ics",
    events: [activity("replacement", "14:00", "15:00")],
  });
  assert.deepEqual(
    state.events.map((e) => e.id),
    ["task", "replacement"],
  );
  state = transition(state, { type: "toggleTask", id: "task" });
  assert.equal(state.events[0].completed, true);
  state = transition(state, { type: "disconnectCalendar" });
  assert.deepEqual(
    state.events.map((e) => e.id),
    ["task"],
  );
  assert.equal(state.calendar.connected, false);
});

test("calendar conflicts are hard constraints and adjacent boundaries remain free", () => {
  const state = demo();
  state.events = [activity("Lecture", "12:30", "13:30")];
  assert.equal(evaluate(byId["chickpea-bowl"], state).feasible, false);
  assert.match(
    evaluate(byId["chickpea-bowl"], state).reasons.join(),
    /Lecture/,
  );
  state.events = [activity("Lecture", "12:50", "13:30")];
  assert.equal(calendarConflicts(state, 50).length, 0);
  state.events.push(activity("Optional", "12:10", "12:20", { busy: false }));
  assert.equal(calendarConflicts(state, 50).length, 0);
  state.mealPlans = [
    {
      id: "other-slot",
      mealId: "tofu-bowl",
      date,
      start: "12:30",
      duration: 60,
      servings: 1,
    },
  ];
  assert.equal(calendarConflicts(state, 50).length, 1);
  state.mealPlans[0].start = "12:00";
  assert.equal(
    calendarConflicts(state, 50).length,
    0,
    "same slot can be replaced",
  );
});

test("free-window search skips merged busy times and returns a safe commitment", () => {
  const events = [
    activity("Class", "08:00", "09:00"),
    activity("Overlap", "08:30", "09:30"),
    activity("Next class", "10:15", "11:00"),
  ];
  const window = nextMealWindow(
    events,
    date,
    new Date(localInstant(date, "08:15")),
    60,
  );
  assert.equal(window.start, "09:30");
  assert.equal(window.available, 45);
  assert.equal(window.commitmentTime, "10:15");
  assert.equal(
    nextMealWindow(
      [activity("Busy", "08:00", "23:59")],
      date,
      new Date(localInstant(date, "08:00")),
    ),
    null,
  );
  assert.equal(
    comingUp(events, new Date(localInstant(date, "09:45"))).title,
    "Next class",
  );
});

test("month shifting clamps dates and all-day boundaries are exclusive", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-31", 1), "2027-01-31");
  assert.equal(addMonths("2026-10-17", -1), "2026-09-17");
  const allDay = {
    ...activity("All day", "00:00", "23:59"),
    end: localInstant(addDays(date, 1), "00:00"),
    allDay: true,
  };
  assert.equal(eventsForDay([allDay], date).length, 1);
  assert.equal(eventsForDay([allDay], addDays(date, 1)).length, 0);
});

test("overlap layout uses separate columns and resets after each cluster", () => {
  const events = [
    activity("a", "09:00", "10:00"),
    activity("b", "09:30", "10:30"),
    activity("c", "10:00", "11:00"),
    activity("d", "12:00", "13:00"),
  ];
  const layout = layoutDayEvents(events, date);
  assert.deepEqual(
    layout.map((e) => [e.event.id, e.column, e.columns]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ],
  );
});

const calendar = (body) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Daywell Tests//EN\r\n${body}\r\nEND:VCALENDAR`;
const range = { from: "2026-10-12T00:00:00Z", to: "2026-10-25T00:00:00Z" };
test("iCalendar recurrence, EXDATE, moved exception and IANA time zone import correctly", () => {
  const text = calendar(
    `BEGIN:VEVENT\r\nUID:class\r\nDTSTART;TZID=America/Los_Angeles:20261012T090000\r\nDTEND;TZID=America/Los_Angeles:20261012T100000\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE;TZID=America/Los_Angeles:20261013T090000\r\nSUMMARY:Morning lecture\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:class\r\nRECURRENCE-ID;TZID=America/Los_Angeles:20261014T090000\r\nDTSTART;TZID=America/Los_Angeles:20261014T110000\r\nDTEND;TZID=America/Los_Angeles:20261014T120000\r\nSUMMARY:Moved lecture\r\nEND:VEVENT`,
  );
  const result = importIcs(text, range);
  assert.equal(result.events.length, 3);
  assert.deepEqual(
    result.events.map((e) => [dayKey(e.start), timeKey(e.start)]),
    [
      ["2026-10-12", "09:00"],
      ["2026-10-14", "11:00"],
      ["2026-10-15", "09:00"],
    ],
  );
  assert.equal(result.events[1].title, "Moved lecture");
  assert.equal(result.events[0].start, "2026-10-12T16:00:00.000Z");
  assert.ok(result.events.every((e) => e.readOnly && e.source === "ics"));
});

test("iCalendar imports all-day events and dated tasks but skips cancellation", () => {
  const text = calendar(
    `BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261017\r\nDTEND;VALUE=DATE:20261018\r\nSUMMARY:Conference\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261017T190000Z\r\nDTEND:20261017T200000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled\r\nEND:VEVENT\r\nBEGIN:VTODO\r\nUID:task\r\nDUE;TZID=America/Los_Angeles:20261017T170000\r\nSUMMARY:Submit work\r\nSTATUS:COMPLETED\r\nEND:VTODO`,
  );
  const result = importIcs(text, range);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].allDay, true);
  assert.equal(dayKey(result.events[0].end), "2026-10-18");
  assert.equal(result.events[1].kind, "task");
  assert.equal(result.events[1].completed, true);
  assert.equal(result.events[1].busy, false);
  assert.throws(() => importIcs("not an ics"), /valid iCalendar/);
  assert.throws(
    () => importIcs(text, { from: "2026-10-20", to: "2026-10-12" }),
    /valid calendar date range/,
  );
});

test("local time conversion observes DST and rejects nonexistent spring-forward time", () => {
  assert.equal(localInstant("2026-10-17", "09:00"), "2026-10-17T16:00:00.000Z");
  assert.equal(localInstant("2026-12-17", "09:00"), "2026-12-17T17:00:00.000Z");
  assert.throws(() => localInstant("2026-03-08", "02:30"), /does not exist/);
});

test("local calendar API denies remote origins, writes, and unbounded date reads", async () => {
  let handler;
  calendarApi().configureServer({
    middlewares: {
      use: (fn) => {
        handler = fn;
      },
    },
  });
  async function request(
    url,
    method = "GET",
    headers = { host: "127.0.0.1:5173" },
  ) {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler(
      { url, method, headers, socket: { remoteAddress: "127.0.0.1" } },
      res,
      () => {
        throw new Error("Unexpected next");
      },
    );
    return res;
  }
  assert.equal(
    (await request("/api/calendar/status", "GET", { host: "evil.example:80" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request("/api/calendar/status", "GET", {
        host: "127.0.0.1:5173",
        origin: "https://evil.example",
      })
    ).statusCode,
    403,
  );
  assert.equal((await request("/api/calendar/connect")).statusCode, 405);
  assert.equal(
    (await request("/api/calendar/events?from=2026-01-01&to=2027-01-01"))
      .statusCode,
    400,
  );
  assert.equal((await request("/api/calendar/delete", "POST")).statusCode, 404);
});

test("UW distances derive from HUB pins; routes and hours stay separate from nutrition", () => {
  assert.equal(distanceMeters(HUB), 0);
  const center = uwDining.find((v) => v.id === "center-table");
  assert.ok(distanceMeters(center) >= 500 && distanceMeters(center) <= 550);
  const hub = uwDining.find((v) => v.id === "husky-den");
  assert.equal(venueHours(hub, "2026-10-17", "12:00").open, false);
  assert.equal(venueHours(hub, "2026-10-19", "12:00").open, true);
  assert.match(directionsUrl(hub), /travelmode=walking/);
  assert.ok(uwDining.every((v) => v.rating === null && !v.nutrition));
});
