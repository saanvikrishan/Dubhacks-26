import { createGeminiIntentAdapter } from "../src/adapters/geminiIntent.js";
import { buildSourcedCatalog } from "../src/data/sourcedCatalog.js";
import { createDemoState } from "../src/domain/state.js";
// Deterministic contract example, not a live Gemini response and not a saved action.
const adapter = createGeminiIntentAdapter({
  transport: async () => ({
    action: "recommend",
    mode: "compare",
    sort: "protein",
    contextPatch: { available: 60 },
    profilePatch: { budget: 10 },
  }),
});
const result = await adapter.preview({
  text: "I have an hour and a $10 cap. Compare meals by protein.",
  state: createDemoState(),
  catalog: buildSourcedCatalog(),
});
console.log(
  JSON.stringify(
    {
      previewOnly: result.previewOnly,
      intentSource: "deterministic_mock",
      intent: result.intent,
      appliedChanges: result.appliedChanges,
      candidates: result.candidates.map((r) => r.meal.id),
      evaluations: result.evaluations.map((r) => ({
        id: r.meal.id,
        feasible: r.feasible,
        reasons: r.reasons,
        missingData: r.missingData,
        nutrition: r.nutrition,
        sourceLimitations: r.sourceLimitations,
      })),
    },
    null,
    2,
  ),
);
