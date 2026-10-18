import test from "node:test";
import assert from "node:assert/strict";
import { validateFoodIntent, previewFoodIntent } from "../src/domain/intent.js";
import {
  createGeminiIntentAdapter,
  createIntentHttpTransport,
} from "../src/adapters/geminiIntent.js";
import { createDemoState, transition } from "../src/domain/state.js";
import { catalog } from "../src/data/catalog.js";
import { config } from "../src/domain/config.js";

const example = {
  action: "recommend",
  mode: "compare",
  sort: "protein",
  contextPatch: { available: 50 },
  profilePatch: { budget: 9 },
};
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

test("intent: validates a strict object or JSON without coercing numeric constraints", () => {
  assert.deepEqual(validateFoodIntent(JSON.stringify(example)), example);
  assert.deepEqual(validateFoodIntent({ action: "recommend" }), {
    action: "recommend",
    mode: "compare",
    sort: "catalog",
    contextPatch: {},
    profilePatch: {},
  });
  for (const raw of [
    null,
    [],
    42,
    "{}",
    "```json\n{}\n```",
    "{bad",
    { action: "log" },
    { action: "recommend", mode: "delivery" },
    { action: "recommend", sort: "score" },
    { ...example, recipes: [] },
    { ...example, contextPatch: { available: "30" } },
    { ...example, contextPatch: { available: 0 } },
    { ...example, contextPatch: { available: 1.5 } },
    { ...example, contextPatch: { available: 1441 } },
    { ...example, profilePatch: { budget: NaN } },
    { ...example, profilePatch: { budget: Infinity } },
    { ...example, profilePatch: { budget: -1 } },
    { ...example, profilePatch: { budget: 1001 } },
    { ...example, contextPatch: null },
  ])
    assert.throws(() => validateFoodIntent(raw));
});

test("intent: cannot modify restrictions, events, logs, pantry, equipment, or prototypes", () => {
  for (const patch of [
    { profilePatch: { diet: "anything" } },
    { profilePatch: { exclusions: [] } },
    { profilePatch: { equipment: ["stove"] } },
    { contextPatch: { events: [] } },
    { contextPatch: { start: "10:00" } },
    { logs: [] },
    { pantry: {} },
    { action: "order" },
    { contextPatch: { available: { value: 30 } } },
  ])
    assert.throws(() => validateFoodIntent({ ...example, ...patch }));
  assert.throws(() =>
    validateFoodIntent('{"action":"recommend","__proto__":{}}'),
  );
  assert.throws(() =>
    validateFoodIntent(Object.create({ action: "recommend" })),
  );
  const accessor = { action: "recommend" };
  Object.defineProperty(accessor, "mode", {
    enumerable: true,
    get() {
      throw new Error("Getter must not run");
    },
  });
  assert.throws(() => validateFoodIntent(accessor), /unsupported fields/);
});

test("intent: cook, eatOut, compare and protein sort reuse deterministic engine", () => {
  const state = createDemoState();
  for (const mode of ["cook", "eatOut", "compare"]) {
    const result = previewFoodIntent(
      { action: "recommend", mode, sort: "protein" },
      state,
      catalog,
    );
    assert.ok(result.candidates.length);
    assert.equal(result.strategy, "simple_comparison");
    assert.equal(result.score, null);
    assert.ok(
      result.candidates.every(
        (r) => r.feasible && (mode === "compare" || r.meal.mode === mode),
      ),
    );
    const proteins = result.candidates.map(
      (r) => r.nutrition.protein_g ?? -Infinity,
    );
    assert.deepEqual(
      proteins,
      [...proteins].sort((a, b) => b - a),
    );
  }
});

test("intent: numeric patches apply only to a detached preview, preserving plans and state", () => {
  const original = transition(createDemoState(), {
    type: "choose",
    mealId: "tofu-bowl",
  });
  original.logs = [
    {
      id: "original",
      mealId: "tofu-bowl",
      date: original.context.date,
      servings: 0.5,
    },
  ];
  const before = structuredClone(original);
  freeze(original);
  const result = previewFoodIntent(example, original, catalog);
  assert.equal(result.previewState.context.available, 50);
  assert.equal(result.previewState.profile.budget, 9);
  assert.deepEqual(original, before);
  assert.deepEqual(result.previewState.plan, before.plan);
  assert.deepEqual(result.previewState.logs, before.logs);
  assert.deepEqual(result.previewState.mealPlans, before.mealPlans);
  result.previewState.logs[0].servings = 5;
  assert.deepEqual(original, before);
  assert.equal(result.appliedChanges.context[0].from, 65);
  const empty = previewFoodIntent(
    { ...example, profilePatch: { budget: 0 }, contextPatch: { available: 1 } },
    original,
    catalog,
  );
  assert.equal(empty.candidates.length, 0);
  assert.ok(empty.evaluations.some((r) => !r.feasible && r.reasons.length));
});

test("intent: hard restrictions remain enforced and AI food estimates never enter candidates", () => {
  const state = createDemoState();
  state.profile.exclusions = ["soy"];
  const generated = {
    ...structuredClone(catalog[0]),
    id: "ai",
    nutrition: { ...catalog[0].nutrition, kind: "gemini_suggestion" },
  };
  const result = previewFoodIntent(example, state, [
    ...catalog,
    generated,
    { id: "broken" },
  ]);
  assert.ok(result.candidates.every((r) => !r.meal.allergens?.includes("soy")));
  assert.match(
    result.evaluations.find((r) => r.mealId === "ai").reasons.join(),
    /independently verified/,
  );
  assert.equal(
    result.evaluations.find((r) => r.mealId === "broken").feasible,
    false,
  );
  const weighted = structuredClone(config);
  weighted.recommendation.weightedScoringEnabled = true;
  assert.throws(
    () => previewFoodIntent(example, state, catalog, weighted),
    /unvalidated/,
  );
});

test("intent transport: valid response, API failure, explicit deterministic fallback, and timeout", async () => {
  const state = createDemoState(),
    snapshot = structuredClone(state);
  const input = { text: "30 minutes and $9 please", state, catalog };
  const success = await createGeminiIntentAdapter({
    transport: async ({ text }) => {
      assert.equal(text, input.text);
      return example;
    },
  }).preview(input);
  assert.equal(success.source, "structured_intent");
  assert.equal(success.previewOnly, true);
  const down = createGeminiIntentAdapter({
    transport: async () => {
      throw new Error("private server error");
    },
  });
  const failure = await down.preview(input);
  assert.equal(failure.ok, false);
  assert.equal(failure.error, "transport_unavailable");
  assert.ok(!JSON.stringify(failure).includes("private server error"));
  const fallback = await down.preview({
    ...input,
    fallbackIntent: { action: "recommend", mode: "cook" },
  });
  assert.equal(fallback.source, "explicit_fallback");
  assert.deepEqual(fallback.previewState, state);
  const malformed = await createGeminiIntentAdapter({
    transport: async () => ({ action: "log" }),
  }).preview(input);
  assert.equal(malformed.error, "invalid_intent");
  const timeout = await createGeminiIntentAdapter({
    transport: () => new Promise(() => {}),
    timeoutMs: 5,
  }).preview(input);
  assert.equal(timeout.error, "transport_unavailable");
  assert.deepEqual(state, snapshot);
});

test("intent HTTP transport: same-origin text-only contract and safe failure handling", async () => {
  let request;
  const transport = createIntentHttpTransport({
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify(example),
      };
    },
  });
  assert.deepEqual(
    await transport({ text: "test", signal: new AbortController().signal }),
    example,
  );
  assert.equal(request.url, "/api/interpret-food");
  assert.deepEqual(JSON.parse(request.body), { text: "test" });
  assert.equal(request.redirect, "error");
  assert.throws(
    () =>
      createIntentHttpTransport({ endpoint: "https://third-party.example/" }),
    /same-origin/,
  );
  await assert.rejects(
    () =>
      createIntentHttpTransport({ fetchImpl: async () => ({ ok: false }) })({
        text: "test",
      }),
    /unavailable/,
  );
});
