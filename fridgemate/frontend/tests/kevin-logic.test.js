// Kevin-owned regression cases; existing shared test files remain untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, validateInputs } from "../src/domain/engine.js";
import {
  dailyNutrition,
  goalStatus,
  portionNutrition,
} from "../src/domain/nutrition.js";
import { importIcs } from "../src/domain/calendar.js";
import { createDemoState as blankDemoState, testPantry } from "../src/domain/state.js";
import { byId } from "../src/data/catalog.js";

const bowl = () => structuredClone(byId["tofu-bowl"]);
const state = () => {
  const s = createDemoState();
  s.context.date = "2026-10-17";
  return s;
};
const ics = (...components) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daywell Kevin regression//EN",
    ...components,
    "END:VCALENDAR",
  ].join("\r\n");
const event = (...properties) =>
  ["BEGIN:VEVENT", ...properties, "END:VEVENT"].join("\r\n");
const range = { from: "2026-10-17T00:00:00Z", to: "2026-10-21T00:00:00Z" };
const master = event(
  "UID:series",
  "DTSTART:20261017T160000Z",
  "DTEND:20261017T170000Z",
  "RRULE:FREQ=DAILY;COUNT=7",
  "SUMMARY:Lecture",
);

test("Kevin: repeated ingredient rows consume the combined pantry quantity", () => {
  const meal = bowl(),
    s = state();
  meal.ingredients = [
    { name: "tofu", grams: 200 },
    { name: "tofu", grams: 200 },
  ];
  assert.equal(evaluate(meal, s).feasible, false);
  assert.match(evaluate(meal, s).reasons.join(), /tofu.*400 g needed/);
  s.pantry.tofu = 400;
  assert.equal(evaluate(meal, s).feasible, true);
});

test("Kevin: unknown, negative and nonnumeric ingredient quantities fail feasibility", () => {
  for (const grams of [null, undefined, -1, 0, NaN, Infinity, "150"]) {
    const meal = bowl();
    meal.ingredients = [{ name: "tofu", grams }];
    assert.equal(
      evaluate(meal, state()).feasible,
      false,
      `quantity ${String(grams)}`,
    );
  }
  const s = state();
  s.pantry.tofu = "300";
  assert.equal(
    evaluate(bowl(), s).feasible,
    false,
    "coerced stock is not a confirmed numeric quantity",
  );
});

test("Kevin: invalid dates and nonexistent local meal times are rejected at input validation", () => {
  const s = state();
  s.context.date = "2026-02-31";
  assert.throws(
    () => validateInputs(s.profile, s.context, s.pantry),
    /valid.*date|calendar date/i,
  );
  s.context = {
    ...s.context,
    date: "2026-03-08",
    start: "02:30",
    commitmentTime: "04:00",
  };
  assert.throws(
    () => validateInputs(s.profile, s.context, s.pantry),
    /does not exist/,
  );
  s.context = {
    ...s.context,
    date: "2028-02-29",
    start: "12:00",
    commitmentTime: "13:15",
  };
  assert.doesNotThrow(() => validateInputs(s.profile, s.context, s.pantry));
});

test("Kevin: invalid nutrients remain unknown while zero stays known", () => {
  for (const value of [-1, NaN, Infinity, "27", null, undefined]) {
    const meal = bowl();
    meal.nutrition.values.protein_g = value;
    assert.equal(
      portionNutrition(meal).protein_g,
      null,
      `protein ${String(value)}`,
    );
  }
  const meal = bowl();
  meal.nutrition.values.protein_g = 0;
  assert.equal(portionNutrition(meal, 0.5).protein_g, 0);
});

test("Kevin: invalid source nutrients do not corrupt a partial daily subtotal or goal", () => {
  const meal = bowl();
  meal.nutrition.values.protein_g = NaN;
  const summary = dailyNutrition(
    [
      { mealId: "valid", date: "2026-10-17", servings: 0.5 },
      { mealId: "invalid", date: "2026-10-17", servings: 1 },
    ],
    { valid: byId["tofu-bowl"], invalid: meal },
    "2026-10-17",
  );
  assert.deepEqual(summary.protein_g, {
    value: 13.5,
    known: 1,
    total: 2,
    complete: false,
  });
  assert.match(
    goalStatus(summary.protein_g, { mode: "minimum", value: 20 }),
    /unavailable/,
  );
});

test("Kevin: nonfinite or coerced nutrition denominators cannot create fake totals", () => {
  for (const basis of ["per_100g", "per_recipe"])
    for (const value of [0, -1, Infinity, NaN, "2"]) {
      const meal = bowl();
      meal.nutrition.basis = basis;
      if (basis === "per_100g") meal.portionGrams = value;
      else meal.nutrition.yieldServings = value;
      assert.throws(() => portionNutrition(meal), /basis|yield|scale/);
    }
});

test("Kevin: DURATION inherits DTSTART time zone when DTEND is absent", () => {
  const result = importIcs(
    ics(
      event(
        "UID:ny",
        "DTSTART;TZID=America/New_York:20261017T090000",
        "DURATION:PT1H",
        "SUMMARY:NY lecture",
      ),
    ),
    range,
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, "2026-10-17T13:00:00.000Z");
  assert.equal(result.events[0].end, "2026-10-17T14:00:00.000Z");
});

test("Kevin: exact-hour and calendar-day durations retain DST semantics", () => {
  const dstRange = { from: "2026-10-30T00:00:00Z", to: "2026-11-03T00:00:00Z" };
  const result = importIcs(
    ics(
      event(
        "UID:hour",
        "DTSTART;TZID=America/New_York:20261101T013000",
        "DURATION:PT1H",
        "SUMMARY:Exact hour",
      ),
      event(
        "UID:day",
        "DTSTART;TZID=America/New_York:20261031T120000",
        "DURATION:P1D",
        "SUMMARY:Calendar day",
      ),
    ),
    dstRange,
  );
  const hour = result.events.find((e) => e.title === "Exact hour"),
    day = result.events.find((e) => e.title === "Calendar day");
  assert.equal(hour.end, "2026-11-01T06:30:00.000Z");
  assert.equal((Date.parse(hour.end) - Date.parse(hour.start)) / 60000, 60);
  assert.equal((Date.parse(day.end) - Date.parse(day.start)) / 3600000, 25);
});

test("Kevin: ICS second precision survives local time-zone conversion", () => {
  const result = importIcs(
    ics(
      event(
        "UID:seconds",
        "DTSTART;TZID=America/New_York:20261017T090015",
        "DURATION:PT30S",
        "SUMMARY:Short task",
      ),
    ),
    range,
  );
  assert.equal(result.events[0].start, "2026-10-17T13:00:15.000Z");
  assert.equal(result.events[0].end, "2026-10-17T13:00:45.000Z");
});

test("Kevin: moving the first recurrence out of range does not hide following classes", () => {
  const moved = event(
    "UID:series",
    "RECURRENCE-ID:20261017T160000Z",
    "DTSTART:20261103T160000Z",
    "DTEND:20261103T170000Z",
    "SUMMARY:Moved lecture",
  );
  const result = importIcs(ics(master, moved), range);
  assert.deepEqual(
    result.events.map((e) => e.start),
    [
      "2026-10-18T16:00:00.000Z",
      "2026-10-19T16:00:00.000Z",
      "2026-10-20T16:00:00.000Z",
    ],
  );
});

test("Kevin: an exception moved into range is included even when its original date is later", () => {
  const moved = event(
    "UID:series",
    "RECURRENCE-ID:20261023T160000Z",
    "DTSTART:20261018T180000Z",
    "DTEND:20261018T190000Z",
    "SUMMARY:Moved inside",
  );
  const result = importIcs(ics(master, moved), range);
  assert.equal(result.events.length, 5);
  assert.equal(
    result.events.find((e) => e.title === "Moved inside").start,
    "2026-10-18T18:00:00.000Z",
  );
  assert.equal(new Set(result.events.map((e) => e.id)).size, 5);
});

test("Kevin: a cancellation without DTSTART removes only its recurrence slot", () => {
  const cancelled = event(
    "UID:series",
    "RECURRENCE-ID:20261018T160000Z",
    "STATUS:CANCELLED",
  );
  const result = importIcs(ics(master, cancelled), range);
  assert.deepEqual(
    result.events.map((e) => e.start),
    [
      "2026-10-17T16:00:00.000Z",
      "2026-10-19T16:00:00.000Z",
      "2026-10-20T16:00:00.000Z",
    ],
  );
});

test("Kevin: THISANDFUTURE shifts retain all occurrences moved into the range", () => {
  const moved = event(
    "UID:series",
    "RECURRENCE-ID;RANGE=THISANDFUTURE:20261020T160000Z",
    "DTSTART:20261018T160000Z",
    "DTEND:20261018T170000Z",
    "SUMMARY:Shifted series",
  );
  const result = importIcs(ics(master, moved), range);
  assert.equal(result.events.length, 6);
  assert.ok(
    result.events.every((e) => Date.parse(e.start) < Date.parse(range.to)),
  );
});

test("Kevin: a start-only event at the import boundary is retained with a stated planning allowance", () => {
  const result = importIcs(
    ics(
      event("UID:boundary", "DTSTART:20261017T000000Z", "SUMMARY:Start only"),
    ),
    range,
  );
  assert.equal(result.events.length, 1);
  assert.equal(
    (Date.parse(result.events[0].end) - Date.parse(result.events[0].start)) /
      60000,
    30,
  );
  assert.match(result.warnings.join(), /30.minute|duration|end time/i);
});

test("Kevin: an exception from one UID cannot modify a different calendar series", () => {
  const other = event(
    "UID:other",
    "DTSTART:20261017T160000Z",
    "DTEND:20261017T170000Z",
    "RRULE:FREQ=DAILY;COUNT=2",
    "SUMMARY:Other course",
  );
  const moved = event(
    "UID:series",
    "RECURRENCE-ID:20261017T160000Z",
    "DTSTART:20261017T180000Z",
    "DTEND:20261017T190000Z",
    "SUMMARY:Moved first course",
  );
  const result = importIcs(ics(master, other, moved), range);
  const otherEvents = result.events.filter((e) =>
    e.id.startsWith("ics:other:"),
  );
  assert.deepEqual(
    otherEvents.map((e) => [e.title, e.start]),
    [
      ["Other course", "2026-10-17T16:00:00.000Z"],
      ["Other course", "2026-10-18T16:00:00.000Z"],
    ],
  );
});

test("Kevin: a THISANDFUTURE cancellation does not leave future busy slots behind", () => {
  const cancelled = event(
    "UID:series",
    "RECURRENCE-ID;RANGE=THISANDFUTURE:20261018T160000Z",
    "STATUS:CANCELLED",
  );
  const result = importIcs(ics(master, cancelled), range);
  assert.deepEqual(
    result.events.map((e) => e.start),
    ["2026-10-17T16:00:00.000Z"],
  );
});

test("Kevin: a direct confirmed exception can override a cancelled future series", () => {
  const cancelled = event(
    "UID:series",
    "RECURRENCE-ID;RANGE=THISANDFUTURE:20261018T160000Z",
    "STATUS:CANCELLED",
  );
  const restored = event(
    "UID:series",
    "RECURRENCE-ID:20261019T160000Z",
    "DTSTART:20261019T180000Z",
    "DTEND:20261019T190000Z",
    "SUMMARY:Confirmed exception",
  );
  const result = importIcs(ics(master, cancelled, restored), range);
  assert.deepEqual(
    result.events.map((e) => e.start),
    ["2026-10-17T16:00:00.000Z", "2026-10-19T18:00:00.000Z"],
  );
});

function createDemoState() { const s = blankDemoState(); s.pantry = {...testPantry}; s.context.onward=5; s.context.buffer=10; return s; }
