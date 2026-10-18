import { byId as catalogById } from '../data/catalog.js';
import { nutrientInfo } from './nutrition.js';
import { CUISINES, TASTES } from './preferences.js';
import { deriveCookNutrition, enrichCookFacts } from './foodFacts.js';

export const ALLERGENS = ['soy','egg','milk','wheat','peanut','tree nut','sesame','fish','shellfish'];
export const EQUIPMENT = ['stove', 'pan', 'pot', 'microwave', 'oven', 'air fryer', 'rice cooker', 'toaster', 'blender', 'electric kettle', 'baking sheet', 'cutting board', 'knife', 'mixing bowl', 'spatula', 'colander', 'slow cooker'];
/** Exact names only. An unmatched ingredient leaves dietary suitability unknown. */
const VEGAN_INGREDIENTS = new Set(['chickpeas','cucumber','tofu','cooked brown rice','frozen vegetables','olive oil','garlic','soy sauce','tomatoes','spinach','banana','oats','berries']);
const VEGETARIAN_INGREDIENTS = new Set([...VEGAN_INGREDIENTS,'eggs','yogurt','cheese','bread']);
export function dietsFromIngredients(ingredients) {
  const names = (ingredients ?? []).map((item) => item.name);
  if (!names.length) return null;
  if (names.every((name) => VEGAN_INGREDIENTS.has(name))) return ['vegan','vegetarian'];
  if (names.every((name) => VEGETARIAN_INGREDIENTS.has(name))) return ['vegetarian'];
  return null;
}
const text = (s, max=500) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const numeric = (n,min,max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const strings = (a,max=20) => Array.isArray(a) && a.length <= max && a.every(s => text(s));
export const isGeneratedMeal = meal => meal?.suggestion === true || ['gemini_suggestion','unknown'].includes(meal?.nutrition?.kind);
export function validateGeneratedMeal(meal) {
  if (!meal || !/^(?:gemini|sourced)-[a-z0-9-]{1,100}$/.test(meal.id) || !text(meal.name,80) || !text(meal.description,240) || meal.mode !== 'cook' || !strings(meal.steps,12) || !meal.steps.length || !strings(meal.equipment,32) || meal.equipment.some(e => !EQUIPMENT.includes(e)) || !Array.isArray(meal.ingredients) || !meal.ingredients.length || meal.ingredients.length > 16 || meal.ingredients.some(i => !text(i.name,60) || !numeric(i.grams,0.001,2000)) || !['prep','cook'].every(k=> Number.isInteger(meal.timing?.[k]) && numeric(meal.timing[k],0,240)) || meal.timing.outbound !== 0 || meal.nutrition?.basis !== 'per_serving')
    throw new Error('Recipe response is incomplete or malformed. Generate a new recipe.');
  if (meal.cost !== null && !numeric(meal.cost,0,1000)) throw new Error('Invalid recipe price.');
  if (meal.diets !== null && (!strings(meal.diets) || meal.diets.some(d=>!['anything','vegan','vegetarian'].includes(d)))) throw new Error('Invalid recipe dietary information.');
  if (meal.allergens !== null && (!strings(meal.allergens) || meal.allergens.some(a=>!ALLERGENS.includes(a)))) throw new Error('Invalid recipe allergens.');
  if (!meal.nutrition.values || Object.keys(nutrientInfo).some(k=>meal.nutrition.values[k] !== null && !numeric(meal.nutrition.values[k],0,1000000))) throw new Error('Invalid recipe nutrition.');
  return meal;
}

/** Exact names/forms only. Never match vague "rice" to a cooked USDA ingredient. */

/** Boundary for all network responses: discard supplied trust flags, defaults and model nutrient facts. */
export function normalizeGeneratedMeal(raw) {
  const meal = {
    id:raw?.id, name:raw?.name, description:raw?.description,mode:'cook',
    ingredients:raw?.ingredients?.map(i=>({name:typeof i.name==='string'?i.name.trim().toLowerCase():i.name,grams:i.grams})),
    equipment:raw?.equipment?.map(e=>typeof e==='string'?e.toLowerCase():e),timing:raw?.timing,steps:raw?.steps,
    photo:['tofu','pasta','chickpeas'].includes(raw?.photo)?raw.photo:'tofu',
    // AI-tagged labels for preference matching and variety only; unknown labels are dropped.
    cuisines:(Array.isArray(raw?.cuisines)?raw.cuisines:[]).filter(c=>CUISINES.includes(c)).slice(0,1),
    tastes:(Array.isArray(raw?.tastes)?raw.tastes:[]).filter(t=>TASTES.includes(t)).slice(0,3),
    // Short generic dish name; identical dishes share one photo.
    dishType:typeof raw?.dishType==='string'&&raw.dishType.trim()?raw.dishType.trim().toLowerCase().slice(0,40):null,
    cost:null,portionGrams:null,portionLabel:'1 recipe portion',diets:null,allergens:null,suggestion:true,review:null,
    nutrition:{basis:'per_serving',values:Object.fromEntries(Object.keys(nutrientInfo).map(k=>[k,null])),kind:'unknown'},
  };
  validateGeneratedMeal(meal);
  const enriched=enrichCookFacts(meal);
  meal.nutrition=deriveCookNutrition(meal.ingredients);
  meal.cost=enriched.cost;meal.pricing=enriched.pricing;meal.provenance=enriched.provenance;
  return structuredClone(meal);
}

export function reviewGeneratedMeal(draft, review, profile) {
  validateGeneratedMeal(draft);
  if (draft.review?.confirmed) throw new Error('Confirmed recipes are preserved. Generate another version to change the recipe.');
  if (review?.confirmed !== true || !numeric(review.cost,0,1000) || !Number.isInteger(review.prep) || !numeric(review.prep,0,240) || !Number.isInteger(review.cook) || !numeric(review.cook,0,240) || !strings(review.equipment,32) || review.equipment.some(e=>!EQUIPMENT.includes(e)))
    throw new Error('Confirm a per-portion cost, preparation time, cooking time and required equipment.');
  if (!Array.isArray(review.allergens) || review.allergens.some(a=>!ALLERGENS.includes(a))) throw new Error('Choose supported allergens.');
  const sourced=enrichCookFacts(draft);
  const priced=Number.isFinite(sourced.cost) && review.cost===sourced.cost;
  draft={...draft,nutrition:sourced.nutrition,...(priced?{pricing:sourced.pricing}:{pricing:null})};
  const listed=[...new Set(review.allergens)];
  const diets=dietsFromIngredients(draft.ingredients);
  return {...structuredClone(draft),cost:review.cost,timing:{prep:review.prep,cook:review.cook,outbound:0},equipment:[...new Set(review.equipment)],diets,allergens:null,
    dietary:{knownPresent:listed,allergenAbsence:"not_established",crossContact:"unknown"},
    review:{confirmed:true,checkedAt:new Date().toISOString(),source:'user_confirmed',diet:profile.diet,dietConfirmed:review.dietConfirmed===true,allergensConfirmed:review.allergensConfirmed===true},
    provenance:{sourceType:'gemini_recipe_with_user_review',assumptions:['Input amounts and time are recipe planning estimates reviewed by the user.'],limitations:['A diet checkbox does not verify ingredients.','Empty or partial allergen lists record positive indicators only; absence remains unknown.','User confirmation does not independently certify nutrition or cross-contact safety.'],fields:{cost:priced?sourced.provenance.fields.cost:{status:'user_confirmed'},nutrition:sourced.provenance.fields.nutrition,diets:{status:diets?'ingredient_list':'unknown'},allergens:{status:listed.length?'user_listed_present':'unknown',knownPresent:listed,allergenAbsence:'not_established'}}}};
}

/** Retain main's historical recipe snapshots without certifying them for a new plan. */
export function recipeSnapshots(state) {
  const historical=(Array.isArray(state.geminiMeals)?state.geminiMeals:[]).filter(m=>m && typeof m.id==='string' && /^gemini-[a-z0-9-]{1,80}$/.test(m.id) && typeof m.name==='string' && m.mode==='cook' && Array.isArray(m.ingredients) && Array.isArray(m.steps) && m.timing && m.nutrition?.values && m.nutrition.basis==='per_serving').map(m=>({...m,legacyHistory:true}));
  const map=new Map(historical.map(m=>[m.id,m]));
  for(const meal of state.generatedMeals??[])map.set(meal.id,meal);
  return [...map.values()];
}
export function mealsFor(state) { return {...catalogById,...Object.fromEntries(recipeSnapshots(state).map(m=>[m.id,m]))}; }

/** Preserve reviewed/used records when a later generation returns the same draft. */
export function addGeneratedMeals(state, incoming) {
  if (!Array.isArray(incoming) || incoming.length>8 || !incoming.length) throw new Error('No recipe drafts were returned.');
  const map = new Map((state.generatedMeals??[]).map(m=>[m.id,m]));
  for (const raw of incoming) {const m=normalizeGeneratedMeal(raw);if(!map.has(m.id)) map.set(m.id,m);}
  const used=new Set([...state.logs,...state.mealPlans,state.plan,state.previousPlan,state.planUndo?.before,state.logUndo?.before].filter(Boolean).map(v=>v.mealId));
  const all=[...map.values()];
  const kept=all.filter(m=>used.has(m.id));
  if(kept.length>150) throw new Error('Too many saved recipes. Export your meal history before adding more.');
  const remaining=150-kept.length;
  return [...kept,...(remaining?all.filter(m=>!used.has(m.id)).slice(-remaining):[])];
}
