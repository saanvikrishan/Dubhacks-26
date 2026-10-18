import source from "../data/uw/browser.json" with {type: "json"};
import { buildUwSnapshot } from "../adapters/uwCatalog.js";
const data = buildUwSnapshot(source.snapshot, source.reviewed);
import { HUB, uwDining } from "../data/uwDining.js";
export const uwCatalog = data;
export function buildUwDiningCatalog() {return structuredClone([...data.menu, ...data.nutrition]);}
const minute = text => Number(text.slice(0,2))*60+Number(text.slice(3));
export function currentWalking(route, now = Date.now()) {
  const age = now - Date.parse(route?.checkedAt);
  return route?.status === "verified" && route.travelMode === "WALK" &&
    route.origin?.lat === HUB.lat && route.origin?.lng === HUB.lng &&
    Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 &&
    Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 &&
    age >= -60000 && age <= 300000 ? route : null;
}
export function stationHours(venueId, station, date, arrival, end = arrival) {
  const h = data.hours.find(h => h.venueId === venueId);
  if (!h || date < h.validFrom || date > h.validTo) return {status:"unknown", range:null};
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!Number.isInteger(day)) return {status:"unknown",range:null};
  const s = h.stationHours.find(s => s.station === station);
  if (!s) return {status: h.general[day].length ? "unknown" : "closed", range:null};
  const ranges = s.week[day];
  if (venueId === "husky-den" && station === "Dawg House Pizza" && day === 5 && end > 900 && arrival < 960) return {status:"conflict",range:null,source:h};
  const range = ranges.find(([open,close]) => arrival >= open && end <= close);
  return {status:range ? "published" : "closed",range:range??null,ranges,source:h};
}
/** Prepare a detached record for the existing engine. No plan, log, pantry or persistence writes. */
export function prepareUwDiningMeal(record, state, routes = [], now = Date.now()) {
  if (!record.dining) return {meal:record,reasons:[]};
  const meal = structuredClone(record), reasons = [];
  const candidate = routes.find(r => r.venueId === meal.dining.venueId) ?? meal.dining.route;
  const route = candidate?.venueId === meal.dining.venueId ? currentWalking(candidate, now) : null;
  meal.timing.outbound = route ? Math.ceil(route.durationSeconds/60) : null;
  meal.dining.route = route;
  meal.provenance.fields.walking = route ? {status:"retrieved_route",...route} : {status:"unknown"};
  const date = state.context.date, day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const a = meal.availability;
  if (meal.dining.recordType !== "menu" || !a.validFrom || !a.validTo || date < a.validFrom || date > a.validTo || !a.days?.includes(day)) reasons.push("A current menu entry is not verified for the selected date.");
  if (["component","add_on"].includes(meal.dining.kind)) reasons.push("This is a menu component or add-on, not a complete meal selection.");
  const arrival = minute(state.context.start) + (meal.timing.outbound ?? 0);
  const end = arrival+(state.context.service??0)+state.context.eating;
  const hours = stationHours(meal.dining.venueId, meal.venue.station, date, arrival, end);
  meal.dining.hours = hours;
  meal.provenance.fields.hours = {status:hours.status,sourceUrl:hours.source?.sourceUrl??null,
    validFrom:hours.source?.validFrom??null,validTo:hours.source?.validTo??null,
    originalText:hours.source?.originalText??null,hoursSha256:hours.source?.hoursSha256??null};
  meal.venue.opens = hours.range?.[0] ?? null;
  meal.venue.closes = hours.range?.[1] ?? null;
  meal.venue.hoursKind = hours.status;
  if (hours.status === "conflict") reasons.push("Station and building hours conflict for this visit; confirm with UW.");
  if (hours.status === "closed") reasons.push("The visit falls outside the published station service hours.");
  for (const excluded of state.profile.exclusions) if (meal.dietary.knownPresent.includes(excluded)) reasons.push(`Contains excluded ${excluded} (published positive indicator).`);
  for (const goal of state.profile.goals) {
    const label = ({energy_kcal:"Calories",protein_g:"Protein",carbohydrate_g:"Carbohydrates",fat_g:"Fat",fiber_g:"Fiber",sodium_mg:"Sodium"})[goal.nutrient] ?? goal.nutrient;
    const value = meal.nutrition.values[goal.nutrient];
    if (!Number.isFinite(value)) reasons.push(`${label} is unknown; the requested nutrient goal cannot be verified.`);
    else if ((goal.mode === "minimum" && value < goal.value) ||
             (goal.mode === "maximum" && value > goal.value) ||
             (goal.mode === "target_range" && (value < goal.value || value > goal.upper))) {
      reasons.push(`${label} does not meet your requested nutrient limit.`);
    }
  }
  return {meal,reasons};
}

/** Enrich legacy sourced listings only with walking facts, never prices or hours. */
export function withSourcedWalking(record, routes = [], now = Date.now()) {
  const meal = structuredClone(record);
  if (meal.mode !== "eatOut" || !meal.provenance) return meal;
  const venue = uwDining.find(v => v.name === meal.venue?.name);
  const candidate = venue ? routes.find(route => route.venueId === venue.id) : undefined;
  const route = currentWalking(candidate, now);
  meal.timing.outbound = route ? Math.ceil(route.durationSeconds / 60) : null;
  meal.provenance.fields.walking = route
    ? { ...route, status: "retrieved_route", limitation: "One retrieved walk from the UW HUB; not live stock, queues, closures or shuttle time." }
    : { status: "unknown", ...(candidate?.checkedAt ? {lastRetrievedAt:candidate.checkedAt} : {}) };
  return meal;
}
