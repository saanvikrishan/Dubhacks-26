export type Nutrient =
  | "energy_kcal"
  | "protein_g"
  | "carbohydrate_g"
  | "fat_g"
  | "fiber_g"
  | "sodium_mg";
export type Nutrients = Record<Nutrient, number | null>;
export type MealMode = "cook" | "eatOut";
export type Goal = {
  nutrient: Nutrient;
  mode: "minimum" | "maximum" | "target_range";
  value: number;
  upper?: number;
};
export interface FoodRecord {
  id: string;
  name: string;
  mode: MealMode;
  description: string;
  diets: string[] | null;
  allergens: string[] | null;
  equipment: string[];
  ingredients: { name: string; grams: number }[];
  cost: number | null;
  portionGrams: number;
  portionLabel: string;
  nutrition: {
    basis: "per_serving" | "per_100g" | "per_recipe";
    yieldServings?: number;
    values: Nutrients;
    kind: "illustrative_demo" | "published" | "ingredient_estimate";
    source: string;
    checkedAt: string;
    preparation: string;
  };
  timing: { prep: number; cook: number; outbound: number };
  steps: string[];
  venue?: {
    name: string;
    location: string;
    opens: number | null;
    closes: number | null;
    hoursKind: string;
  };
}
export interface Profile {
  diet: "anything" | "vegetarian" | "vegan";
  exclusions: string[];
  preferred: string;
  budget: number;
  cooking: boolean;
  equipment: string[];
  goals: Goal[];
}
export interface Context {
  date: string;
  start: string;
  available: number;
  commitment: string;
  commitmentTime: string;
  location: string;
  eating: number;
  cleanup: number;
  onward: number;
  buffer: number;
  service: number | null;
}
export interface MealPlan {
  id: string;
  mealId: string;
  servings: number;
  date: string;
  start: string;
  duration: number;
}
export interface Consumption {
  id: string;
  mealId: string;
  servings: number;
  date: string;
  confirmedAt: string;
}
export interface AppState {
  version: 1;
  profile: Profile;
  context: Context;
  pantry: Record<string, number>;
  plan: MealPlan | null;
  previousPlan: MealPlan | null;
  mealPlans: MealPlan[];
  events: CalendarActivity[];
  calendar: CalendarConnection;
  planUndo: {
    slotId: string;
    before: MealPlan | null;
    after: MealPlan | null;
  } | null;
  logUndo: { id: string; before: Consumption | null } | null;
  logs: Consumption[];
  actions: object[];
}

export interface CalendarActivity {
  id: string;
  title: string;
  start: string; // ISO instant; rendered in America/Los_Angeles
  end: string; // exclusive, including all-day events
  kind: "event" | "class" | "meal" | "workout" | "task";
  source: "apple" | "ics" | "manual" | "daywell";
  allDay?: boolean;
  busy: boolean;
  readOnly: boolean;
  location?: string;
  calendar?: string;
  calendarId?: string;
  completed?: boolean;
  plan?: MealPlan;
}
export interface CalendarConnection {
  source: "manual" | "apple" | "ics";
  connected: boolean;
  lastSync: string | null;
  range?: { from: string; to: string } | null;
}
export interface DiningVenue {
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  description: string;
  menu: string; // official UW location/hours page
  weeklyMenu?: string;
  hours: ([number, number] | null)[]; // Sun–Sat, local minutes
  offers: { name: string; price: number }[];
  rating: number | null; // never inferred or fabricated
  checkedAt: string;
  photo: string; // representative illustration, not venue photography
}
