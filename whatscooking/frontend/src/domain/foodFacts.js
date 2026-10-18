import manifest from '../data/food/ingredient-matches.json' with {type:'json'};
import priceManifest from '../data/food/pricing-matches.json' with {type:'json'};
import saved from '../data/food/usda-browser.json' with {type:'json'};
import {normalizeUsdaFood,ingredientNutrition} from '../adapters/usdaFood.js';
import {nutrientInfo} from './nutrition.js';
import {resolveIngredientName} from './ingredientNames.js';

const finite = n=>typeof n==='number' && Number.isFinite(n) && n>=0;
const same = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
function nutritionRows(records) {
  return Object.fromEntries(manifest.matches.flatMap(match=>{
    const raw=records.find(r=>r.fdcId===match.fdcId);
    if(!raw) return [];
    try {return [[match.key,{...normalizeUsdaFood(raw,match),portions:raw.foodPortions??[]}]];} catch {return [];}
  }));
}
export function normalizeFoodReference(raw) {
  if(raw?.version!==1 || !Array.isArray(raw.nutrition?.records) || !Array.isArray(raw.pricing?.ingredients) || !/^\d{8}$/.test(raw.pricing?.store?.locationId??'')) throw Error('Invalid food source response.');
  const pricing={};
  for(const match of priceManifest.matches) {
    const row=raw.pricing.ingredients.find(r=>r.key===match.key),q=row?.quote;
    if(q && q.productId===match.productId && q.description===match.expectedDescription && q.packageSize===match.expectedSize && q.locationId===raw.pricing.store.locationId && finite(q.regularPrice) && q.originalPrice?.regular===q.regularPrice && Number.isFinite(Date.parse(q.checkedAt)) && Number.isFinite(Date.parse(q.expiresAt))) pricing[match.key]=structuredClone(q);
  }
  return {ingredients:nutritionRows(raw.nutrition.records),pricing,store:raw.pricing.store,status:raw.nutrition.status,pricingStatus:raw.pricing.ingredients.every(r=>r.status==='retrieved')?'retrieved':'partial'};
}
let reference={ingredients:nutritionRows(saved.records),pricing:{},store:priceManifest.defaultStore,status:'saved_reference',pricingStatus:'not_requested'};
export function getFoodReference(){return reference;}
export function installFoodReference(raw){reference=normalizeFoodReference(raw);return reference;}
export function recipeFingerprint(meal){return JSON.stringify([meal.name,meal.ingredients.map(i=>[i.name,i.grams]),meal.timing,meal.steps,meal.equipment]);}
function hash(s){let a=2166136261,b=5381;for(const c of s){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);}

// Names resolve through the reviewed manifest; generic words become explicit, visible assumptions.
export function recipeIngredient(name, source=reference) {
  const resolved=resolveIngredientName(name);
  const key=resolved.key??String(name).trim().toLowerCase();
  return {key,match:source.ingredients[key],assumption:resolved.assumption};
}

export function packageGrams(key,quote,source=reference) {
  const size=String(quote?.packageSize??'').trim().toLowerCase();
  const match=priceManifest.matches.find(m=>m.key===key);
  const mass=size.match(/^(\d+(?:\.\d+)?)\s*(g|kg|oz|onz|lb|lbs)$/);
  if(mass && Number(mass[1])>0) return {grams:Number(mass[1])*({g:1,kg:1000,oz:28.349523125,onz:28.349523125,lb:453.59237,lbs:453.59237}[mass[2]]),basis:'Published package mass'};
  const liquid=size.match(/^(\d+(?:\.\d+)?)\s*fl\s*oz$/),count=size.match(/^(\d+)\s*ct$/);
  const conversion=match?.conversion;
  const ingredient=source.ingredients[key];
  const portion=conversion && ingredient?.fdcId===conversion.fdcId ? ingredient.portions.find(p=>p.modifier===conversion.modifier && p.amount===1 && finite(p.gramWeight) && p.gramWeight>0) : null;
  if(liquid && conversion?.modifier==='cup' && portion) return {grams:Number(liquid[1])/8*portion.gramWeight,basis:'Estimated edible mass from the published USDA cup weight; 8 US fl oz per cup',fdcId:ingredient.fdcId,portion:structuredClone(portion)};
  if(count && key==='eggs' && /\blarge\b/i.test(quote.description) && portion) return {grams:Number(count[1])*portion.gramWeight,basis:'Estimated edible egg mass from USDA large-egg portion; shell excluded',fdcId:ingredient.fdcId,portion:structuredClone(portion)};
  return null;
}

export function deriveCookNutrition(ingredients,source=reference) {
  const rows=ingredients.map(item=>{
    const {key,match,assumption}=recipeIngredient(item.name,source);
    return {...item,key,match,assumption,values:match?ingredientNutrition(match,{grams:item.grams,preparation:match.preparation,weightBasis:match.weightBasis}):{}};
  });
  const values={},coverage={};
  for(const key of Object.keys(nutrientInfo)) {
    const known=rows.filter(r=>finite(r.values[key]));
    const subtotal=known.reduce((n,r)=>n+r.values[key],0);
    values[key]=rows.length && known.length===rows.length ? subtotal : null;
    coverage[key]={known:known.length,total:rows.length,missingIngredients:rows.filter(r=>!finite(r.values[key])).map(r=>r.name),knownSubtotal:known.length?subtotal:null};
  }
  return {basis:'per_serving',values,coverage,kind:'ingredient_estimate',assumptions:rows.map(r=>r.assumption).filter(Boolean),source:'USDA FoodData Central; reviewed ingredient IDs and input grams.',checkedAt:rows.filter(r=>r.match).map(r=>r.match.provenance.checkedAt).sort()[0]??null,preparation:'Ingredient-average estimate for one recipe portion. Cooking losses, exact pantry brands and cooked serving weight are not measured.',matches:rows.map(r=>({name:r.name,grams:r.grams,resolvedIngredient:r.key,assumption:r.assumption,fdcId:r.match?.fdcId??null,sourceUrl:r.match?.provenance.sourceUrl??null,preparation:r.match?.preparation??null,weightBasis:r.match?.weightBasis??null,dataType:r.match?.dataType??null,checkedAt:r.match?.provenance.checkedAt??null,publicationDate:r.match?.provenance.publicationDate??null,per100g:r.match?structuredClone(r.match.values):null,originalNutrients:r.match?Object.fromEntries(Object.entries(r.match.provenance.fields).map(([key,field])=>[key,field.originalRows.map(row=>({nutrientId:row.nutrient.id,unit:row.nutrient.unitName,amount:row.amount}))])):null,reason:r.match?null:manifest.unresolved[r.name]??'No reviewed ingredient/form match.'}))};
}

export function deriveCookPrice(ingredients,source=reference,now=Date.now()) {
  const rows=ingredients.map(item=>{
    const {key,assumption}=recipeIngredient(item.name,source);
    const q=source.pricing[key],mass=packageGrams(key,q,source);
    const current=q && Date.parse(q.expiresAt)>now && Date.parse(q.checkedAt)<=now+60000;
    return {name:item.name,resolvedIngredient:key,assumption,grams:item.grams,status:current&&mass?'priced':'unknown',consumedCost:current&&mass?item.grams/mass.grams*q.regularPrice:null,purchaseCost:current&&mass?(q.soldBy==='WEIGHT'?item.grams/mass.grams:Math.ceil(item.grams/mass.grams))*q.regularPrice:null,packageMass:mass,quote:q??null,reason:!q?(priceManifest.unresolved[item.name]??'No current, reviewed product quote.'):!current?'Quote expired.':!mass?'Package edible mass or unit conversion is unconfirmed.':null};
  });
  const complete=rows.length>0 && rows.every(r=>r.status==='priced');
  return {status:complete?'complete':'incomplete',value:complete?Math.round(rows.reduce((n,r)=>n+r.consumedCost,0)*100)/100:null,purchaseTotal:complete?Math.round(rows.reduce((n,r)=>n+r.purchaseCost,0)*100)/100:null,store:source.store,checkedAt:rows.filter(r=>r.quote).map(r=>r.quote.checkedAt).sort()[0]??null,expiresAt:rows.filter(r=>r.quote).map(r=>r.quote.expiresAt).sort()[0]??null,rows,basis:'Estimated cost of ingredient amounts used, using regular prices for reviewed reference products. Full-package purchase cost is separate; exact pantry brands, tax and checkout total are unconfirmed.'};
}

export function enrichCookFacts(meal,source=reference,now=Date.now()) {
  const nutrition=deriveCookNutrition(meal.ingredients,source);
  const pricing=deriveCookPrice(meal.ingredients,source,now);
  return {...structuredClone(meal),cost:pricing.value,portionGrams:null,portionLabel:'1 serving',nutrition,pricing,provenance:{...meal.provenance,sourceType:'recipe_with_usda_and_kroger_facts',fields:{...meal.provenance?.fields,nutrition:{status:'derived_from_usda',matches:nutrition.matches},cost:{status:pricing.status==='complete'?'kroger_ingredient_estimate':'unknown',checkedAt:pricing.checkedAt,expiresAt:pricing.expiresAt,store:pricing.store}},assumptions:[nutrition.preparation,pricing.basis],limitations:pricing.rows.filter(r=>r.reason).map(r=>`${r.name}: ${r.reason}`)}};
}

export function sourcedCookCandidate(base,source=reference,now=Date.now()) {
  if(base.mode!=='cook' || base.legacyHistory || base.suggestion && !base.review?.confirmed) return base;
  const meal=enrichCookFacts(base,source,now);
  const sourceRecipeId=base.sourceRecipeId??base.id;
  const identity=hash(JSON.stringify([recipeFingerprint(base),meal.nutrition,meal.pricing]));
  return {...meal,id:`sourced-${sourceRecipeId.replace(/^sourced-/,'').slice(0,45)}-${identity}`,sourceRecipeId,sourceFingerprint:recipeFingerprint(base),suggestion:base.suggestion===true};
}
export function sameSourceCandidate(actual,expected){return actual.id===expected.id && same(actual.ingredients,expected.ingredients) && same(actual.nutrition,expected.nutrition) && same(actual.pricing,expected.pricing);}
