import {comparePreferences,memoryProfile,preferenceFit,varied} from "./preferences.js";
import { knownPresentAllergens, hasAllergenAbsenceCoverage } from "./allergens.js";
import { prepareUwDiningMeal } from "./uwDining.js";
import { isGeneratedMeal, validateGeneratedMeal } from "./generatedMeals.js";
import { byId as catalogById } from "../data/catalog.js";
import { config, requireCapability } from "./config.js";
import { portionNutrition, dailyNutrition } from "./nutrition.js";
import { calendarConflicts, localInstant } from "./calendar.js";

export const minutes = (value) =>
  /^\d{2}:\d{2}$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    : NaN;
export function clockTime(value) {
  if (!Number.isFinite(value)) return "Unknown";
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function timeParts(meal, context) {
  return meal?.mode === "cook"
    ? {
        Preparation: meal.timing?.prep,
        Cooking: meal.timing?.cook,
        Eating: context.eating,
        Cleanup: context.cleanup,
        "Onward travel": context.onward,
        Buffer: context.buffer,
      }
    : {
        "Travel to venue": meal.timing?.outbound,
        "Service allowance": context.service,
        Eating: context.eating,
        "Onward travel": context.onward,
        Buffer: context.buffer,
      };
}

/** Pure eligibility evaluation. No score, weight, model, or external call. */
export function dailyGoalFit(meal,state) {
  if(!state.profile.goals?.length)return [];
  const records={...catalogById,...Object.fromEntries([...(state.geminiMeals??[]),...(state.generatedMeals??[])].filter(m=>m?.id).map(m=>[m.id,m]))};
  const totals=dailyNutrition(state.logs??[],records,state.context.date);
  const nutrients=portionNutrition(meal);
  return (state.profile.goals??[]).map(goal=>{
    const total=totals[goal.nutrient];
    const known=total.total===0 || total.complete;
    const consumed=known?(total.value??0):null,value=nutrients[goal.nutrient];
    const cap=goal.mode==='maximum'?goal.value:goal.mode==='target_range'?goal.upper:null;
    return {nutrient:goal.nutrient,mode:goal.mode,consumed,remaining:known?Math.max(0,(cap??goal.value)-consumed):null,mealValue:value,
      withinRemainingCap:cap!==null && known && value!==null ? consumed+value<=cap : null,
      supportsMinimum:goal.mode!=='maximum' && known && consumed<goal.value && value!==null ? value>0 : null};
  });
}

/** With nothing on the calendar after the meal, time never rules a meal out. */
export const NO_COMMITMENT = "No further commitment";
export const openEnded = (context) => context?.commitment === NO_COMMITMENT;

export function evaluate(meal, state, c = config) {
  const { profile: p, context: ctx, pantry } = state;
  const reasons = [],
    gaps = [];
  if (!meal?.id || !["cook", "eatOut"].includes(meal.mode)) return {mealId:meal?.id??null,feasible:false,reasons:["This meal no longer exists or has an invalid mode."],duration:null,parts:{},window:ctx.available,score:null,assumptions:[],gaps:[]};
  if (meal.pricing?.status==='complete' && Date.parse(meal.pricing.expiresAt)<=Date.now()) reasons.push("The grocery quote expired. Refresh meal facts before choosing.");
  if (meal.legacyHistory) reasons.push("This older recipe is retained for history. Generate and review a new version before planning it.");
  if (isGeneratedMeal(meal) && !meal.legacyHistory) {
    try { validateGeneratedMeal(meal); } catch (error) { return {mealId:meal.id,feasible:false,reasons:[error.message],duration:null,parts:{},window:ctx.available,score:null,assumptions:[],gaps:[]}; }
    if (!meal.review?.confirmed) reasons.push("Review this recipe's amounts, cost, dietary details and equipment before choosing.");
    gaps.push("Generated recipe instructions and time are planning estimates. Unknown nutrients are excluded from totals.");
  }
  if (meal.dining) {
    const prepared = prepareUwDiningMeal(meal, state);
    meal = prepared.meal;
    reasons.push(...prepared.reasons);
  }
  if (!c.featureFlags[meal.mode]) reasons.push("This meal mode is disabled.");
  if (p.diet !== "anything" && !Array.isArray(meal.diets))
    reasons.push("Dietary suitability is unknown for your restriction.");
  else if (p.diet !== "anything" && !meal.diets?.includes(p.diet))
    reasons.push(`Does not meet your ${p.diet} restriction.`);
  const presentAllergens = knownPresentAllergens(meal);
  const absenceKnown = hasAllergenAbsenceCoverage(meal);
  if (!absenceKnown && p.exclusions.some(allergen => !presentAllergens.includes(allergen)))
    reasons.push("Allergen information is unknown for your exclusions.");
  for (const allergen of p.exclusions)
    if (presentAllergens.includes(allergen))
      reasons.push(`Contains excluded ${allergen}.`);
  if (!absenceKnown)
    gaps.push("Allergen information is incomplete; suitability cannot be guaranteed.");
  if (!Number.isFinite(meal.cost) || meal.cost < 0)
    reasons.push(
      meal.pricing?.rows?.some(r=>r.status!=="priced") ? `Price unavailable for ${meal.pricing.rows.filter(r=>r.status!=="priced").map(r=>r.name).join(", ")}; the strict budget cannot be verified.` : "Cost is unknown or invalid, so the strict budget cannot be verified.",
    );
  else if (meal.cost > p.budget)
    reasons.push(
      `Costs $${meal.cost.toFixed(2)}, above your $${p.budget.toFixed(2)} cap.`,
    );
  if (meal.mode === "cook") {
    if (!p.cooking) reasons.push("Cooking access is off.");
    {
      const missingEquipment = (meal.equipment ?? []).filter(
        (item) => !p.equipment.includes(item),
      );
      if (missingEquipment.length)
        reasons.push(`Needs equipment: ${missingEquipment.join(", ")}.`);
      // Repeated rows use the same stock, so check their combined requirement.
      const required = new Map();
      for (const item of meal.ingredients ?? []) {
        if (
          typeof item.name !== "string" ||
          !item.name.trim() ||
          !Number.isFinite(item.grams) ||
          item.grams <= 0
        ) {
          reasons.push("Ingredient quantities are unknown or invalid.");
          continue;
        }
        const grams = (required.get(item.name) ?? 0) + item.grams;
        if (!Number.isFinite(grams))
          reasons.push("Ingredient quantities are unknown or invalid.");
        required.set(item.name, grams);
      }
      const missing = [...required]
        .map(([name, grams]) => ({ name, grams }))
        .filter(
          (item) =>
            !Number.isFinite(pantry[item.name]) || pantry[item.name] < item.grams,
        );
      if (missing.length)
        reasons.push(
          `Not enough confirmed ingredients: ${missing.map((item) => `${item.name} (${item.grams} g needed)`).join(", ")}.`,
        );
    }
  }
  const parts = timeParts(meal, ctx);
  const unknownTime = Object.values(parts).some(
    (value) => value === null || !Number.isFinite(value) || value < 0,
  );
  const duration = unknownTime
    ? null
    : Object.values(parts).reduce((a, b) => a + b, 0);
  if (unknownTime) reasons.push("A required time allowance is missing.");
  for (const event of calendarConflicts(state, duration))
    reasons.push(`Overlaps ${event.title} on your calendar.`);
  const start = minutes(ctx.start),
    commitment = minutes(ctx.commitmentTime);
  const window = Math.min(ctx.available, commitment - start);
  if (!(window > 0))
    reasons.push(
      "The next commitment must follow the meal start on the same day.",
    );
  if (duration !== null && duration > window && !openEnded(ctx))
    reasons.push(
      `Needs ${duration} minutes; you have ${Math.max(0, window)} ${window === 1 ? "minute" : "minutes"} before ${ctx.commitment || "your next event"}.`,
    );
  if (meal.mode === "eatOut") {
    const v = meal.venue;
    if (v?.opens == null || v?.closes == null) {
      if (!meal.dining || meal.dining.hours.status === "unknown") reasons.push("Venue hours are unknown.");
    }
    else if (
      start + meal.timing?.outbound < v.opens ||
      start + meal.timing?.outbound + (ctx.service ?? 0) + ctx.eating > v.closes
    )
      reasons.push("The meal falls outside the sample venue hours.");
    gaps.push(
      meal.dining
        ? "Walking time is a retrieved Google estimate from the HUB when available. Service is your planning allowance. Published menus do not confirm stock or unexpected closures."
        : "Travel and service are planning allowances, not live estimates. Sample hours do not verify real availability.",
    );
  }
  return {
    mealId: meal.id,
    feasible: reasons.length === 0,
    reasons,
    duration,
    parts,
    window,
    score: null,
    dailyGoals: dailyGoalFit(meal,state),
    assumptions: [
      "One stated portion",
      ...(isGeneratedMeal(meal) ? ["Generated recipe; cost and dietary details require user confirmation"] : meal.provenance ? (meal.provenance.assumptions ?? []) : ["All food, costs, hours, and nutrition are illustrative demo data"]),
    ],
    gaps,
  };
}

function proteinOrder(a,b) {
  const x=portionNutrition(a).protein_g,y=portionNutrition(b).protein_g;
  return x===null ? (y===null?0:1) : y===null ? -1 : y-x;
}

export function recommend(
  catalog,
  state,
  { mode = "compare", sort = "catalog", passed = [], preferences = [] } = {},
  c = config,
) {
  const evaluations = catalog.map((record) => {
    // Keep verified walking/station facts on the same detached UW record shown by the shortlist.
    const meal = record.dining ? prepareUwDiningMeal(record, state).meal : record;
    return {meal, ...evaluate(meal, state, c)};
  });
  let eligible = evaluations.filter(
    (result) =>
      result.feasible &&
      (mode === "compare" || result.meal.mode === mode) &&
      !passed.includes(result.meal.id),
  );
  if (sort === "time")
    eligible.sort(
      (a, b) => a.duration - b.duration || a.meal.cost - b.meal.cost,
    );
  if (sort === "cost")
    eligible.sort(
      (a, b) => a.meal.cost - b.meal.cost || a.duration - b.duration,
    );
  if (sort === "protein")
    eligible.sort(
      (a, b) =>
        proteinOrder(a.meal,b.meal),
    );
  if (sort === "catalog") {
    const memory=memoryProfile(preferences);
    const goalOrder=result=>result.dailyGoals.some(g=>g.withinRemainingCap===false)?-1:result.dailyGoals.some(g=>g.supportsMinimum)?1:0;
    // Only feasible meals are reordered: explicit preferences, then goals, then learned history, then variety.
    eligible.sort((a,b)=>comparePreferences(a.meal,b.meal,state.profile)||goalOrder(b)-goalOrder(a)||comparePreferences(a.meal,b.meal,memory));
    eligible=varied(eligible);
    for(const result of eligible) {
      const direct=preferenceFit(result.meal,state.profile),recalled=preferenceFit(result.meal,memory);
      if(direct.food||direct.cuisine||direct.taste) result.preferenceReason='Matches your food, cuisine or taste preferences.';
      else if(!direct.disliked&&!direct.avoided&&(recalled.food||recalled.cuisine||recalled.taste)) result.preferenceReason="Similar to meals you've picked before.";
    }
  }
  // Collapse exact duplicate UW choices only. Different stations, portions, variants,
  // prices or nutrient/allergen facts remain separate. Audit evaluations retain every row.
  const seenUw = new Set();
  eligible = eligible.filter(({meal}) => {
    if (!meal.dining) return true;
    const key = JSON.stringify([meal.dining.venueId, meal.venue.station, meal.name,
      meal.portionLabel, meal.cost, meal.nutrition.values, meal.diets, meal.dietary]);
    if (seenUw.has(key)) return false;
    seenUw.add(key);
    return true;
  });
  // Comparison shows one available option per mode before filling the remaining slots.
  const diverse =
    mode === "compare"
      ? ["cook", "eatOut"]
          .map((m) => eligible.find((r) => r.meal.mode === m))
          .filter(Boolean)
      : [];
  const cards = [...diverse, ...eligible.filter((r) => !diverse.includes(r))]
    .slice(0, c.recommendation.maxCards)
    .sort((a, b) => eligible.indexOf(a) - eligible.indexOf(b));
  return {
    cards,
    evaluations,
    feasibleCount: eligible.length,
    strategy: "simple_comparison",
    score: null,
  };
}

export function validateInputs(profile, context, pantry) {
  const numeric = (value, label, min, max) => {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label} must be between ${min} and ${max}.`);
  };
  numeric(profile.budget, "Budget", 0, 1000);
  for(const key of ["cuisines","tastes","avoidCuisines"]) if(profile[key]!==undefined && (!Array.isArray(profile[key])||profile[key].length>20||profile[key].some(v=>typeof v!=="string"||v.length>60))) throw new Error("Invalid food preferences.");
  if(profile.dislikes!==undefined&&(typeof profile.dislikes!=="string"||profile.dislikes.length>160)) throw new Error("Keep disliked foods under 160 characters.");
  if (!["anything", "vegetarian", "vegan"].includes(profile.diet))
    throw new Error("Choose a supported diet.");
  if (
    !Array.isArray(profile.exclusions) ||
    !Array.isArray(profile.equipment) ||
    !Array.isArray(profile.goals) ||
    typeof profile.preferred !== "string" ||
    typeof profile.cooking !== "boolean"
  )
    throw new Error("Invalid profile.");
  const phone = profile.phone == null ? "" : profile.phone;
  if (typeof phone !== "string") throw new Error("Invalid profile.");
  if (phone.trim() && !/^\+[1-9]\d{6,14}$/.test(phone.trim()))
    throw new Error(
      "Use international format, starting with + and the country code.",
    );
  if (
    profile.exclusions.some(
      (v) =>
        ![
          "soy",
          "egg",
          "milk",
          "wheat",
          "peanut",
          "tree nut",
          "sesame",
          "fish",
          "shellfish",
        ].includes(v),
    )
  )
    throw new Error(
      "Unsupported exclusion. Add verified catalog coverage before extending exclusions.",
    );
  numeric(context.available, "Available time", 1, 1440);
  for (const key of [
    "available",
    "eating",
    "cleanup",
    "onward",
    "buffer",
    "service",
  ]) {
    if (context[key] !== null && !Number.isInteger(context[key]))
      throw new Error("Time allowances must use whole minutes.");
  }
  for (const key of ["eating", "cleanup", "onward", "buffer"])
    numeric(context[key], key, 0, 240);
  if (context.service !== null)
    numeric(context.service, "Service allowance", 0, 240);
  if (
    !Number.isFinite(minutes(context.start)) ||
    !Number.isFinite(minutes(context.commitmentTime)) ||
    minutes(context.start) > 1439 ||
    minutes(context.commitmentTime) > 1439 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(context.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(context.commitmentTime)
  )
    throw new Error("Enter valid times.");
  if (minutes(context.commitmentTime) <= minutes(context.start))
    throw new Error(
      "Choose a commitment after the meal start on the same day.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(context.date) ||
    !Number.isFinite(Date.parse(context.date))
  )
    throw new Error("Enter a valid date.");
  // Reject normalized impossible dates and meal starts in a DST clock gap.
  localInstant(context.date, context.start);
  localInstant(context.date, context.commitmentTime);
  for (const goal of profile.goals) {
    if (
      ![
        "energy_kcal",
        "protein_g",
        "carbohydrate_g",
        "fiber_g",
        "sugar_g",
        "added_sugar_g",
        "fat_g",
        "saturated_fat_g",
        "trans_fat_g",
        "mono_fat_g",
        "poly_fat_g",
        "cholesterol_mg",
        "vitamin_a_mcg",
        "vitamin_c_mg",
        "vitamin_d_mcg",
        "vitamin_e_mg",
        "vitamin_k_mcg",
        "thiamin_mg",
        "riboflavin_mg",
        "niacin_mg",
        "pantothenic_mg",
        "vitamin_b6_mg",
        "folate_mcg",
        "vitamin_b12_mcg",
        "choline_mg",
        "calcium_mg",
        "iron_mg",
        "magnesium_mg",
        "phosphorus_mg",
        "potassium_mg",
        "sodium_mg",
        "zinc_mg",
        "copper_mg",
        "manganese_mg",
        "selenium_mcg",
      ].includes(goal.nutrient) ||
      !["minimum", "maximum", "target_range"].includes(goal.mode)
    )
      throw new Error("Invalid nutrition goal.");
    numeric(goal.value, "Goal", 0, 100000);
    if (goal.mode === "target_range") {
      numeric(goal.upper, "Range upper bound", 0, 100000);
      if (goal.upper < goal.value)
        throw new Error("The upper bound must be at least the lower bound.");
    }
  }
  for (const grams of Object.values(pantry))
    numeric(grams, "Pantry grams", 0, 100000);
}

export function assertMealAction(meal, state, c = config) {
  if (!meal?.id) throw new Error("This meal no longer exists.");
  requireCapability(meal.mode, c);
  validateInputs(state.profile, state.context, state.pantry);
  const result = evaluate(meal, state, c);
  if (!result.feasible) throw new Error(result.reasons.join(" "));
  return result;
}
