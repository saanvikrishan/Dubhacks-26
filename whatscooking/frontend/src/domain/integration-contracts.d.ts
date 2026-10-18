import type { AppState, FoodRecord, Nutrients, MealMode } from "./contracts";
export interface FoodIntent {
  action: "recommend";
  mode?: MealMode | "compare";
  sort?: "catalog" | "time" | "cost" | "protein";
  contextPatch?: { available?: number };
  profilePatch?: { budget?: number };
}
export interface NormalizedIngredient {
  key: string;
  fdcId: number;
  description: string;
  dataType: "SR Legacy" | "Foundation" | "Survey (FNDDS)";
  preparation: "raw" | "cooked";
  weightBasis: "raw_edible_weight" | "cooked_edible_weight";
  basis: "per_100g";
  values: Nutrients;
  provenance: {
    sourceType: "usda_fdc";
    sourceUrl: string;
    checkedAt: string;
    fields: Record<string, unknown>;
    limitations: string[];
  };
}
export type SourcedFoodRecord = Omit<FoodRecord, "portionGrams"> & {
  // Per-serving or per-recipe nutrition does not imply a known gram weight.
  portionGrams: number | null;
  provenance: {
    sourceType: string;
    fields: Record<string, unknown>;
    assumptions: string[];
    limitations: string[];
    sourceUrl?: string;
    checkedAt?: string;
  };
  availability: {
    status: "unverified" | "not_applicable";
    validFrom?: string | null;
    validTo?: string | null;
  };
};
export interface PreviewEvaluation {
  meal: FoodRecord | SourcedFoodRecord;
  mealId: string;
  feasible: boolean;
  reasons: string[];
  assumptions: string[];
  gaps: string[];
  score: null;
  missingData: string[];
  sourceLimitations: string[];
  nutrition: Nutrients | null;
}
export interface FoodIntentPreview {
  schemaVersion: 1;
  previewOnly: true;
  intent: Required<FoodIntent>;
  previewState: AppState; // detached copy; never persist this whole object
  candidates: PreviewEvaluation[];
  evaluations: PreviewEvaluation[];
  appliedChanges: {
    context: { field: string; from: number; to: number }[];
    profile: { field: string; from: number; to: number }[];
  };
  score: null;
  strategy: "simple_comparison";
  limitations: string[];
}
export type IntentTransport = (input: {
  text: string;
  signal: AbortSignal;
}) => Promise<FoodIntent | string>;
