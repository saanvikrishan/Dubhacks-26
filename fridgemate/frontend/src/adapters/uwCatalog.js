import { normalizeUwHfsRow } from "./uwHfsFood.js";
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function buildUwSnapshot(snapshot, reviewed) {
  const nutrition = snapshot.pages.flatMap(page => page.rows.map((cells, index) => {
    const item = normalizeUwHfsRow(page, cells, {id: `uw-nutrition-${page.venueId}-${slug(page.station)}-${index}`, location: page.location, station: page.station, itemName: cells[0]});
    item.dining = {venueId: page.venueId, recordType: "nutrition", matchStatus: "not_matched", stock: "unknown"};
    return item;
  }));
  const menu = reviewed.menuEntries.flatMap(entry => {
    const source = snapshot.menus.find(m => m.sourceUrl === entry.sourceUrl && m.responseSha256 === entry.responseSha256);
    // Stale human review must never certify a new PDF revision.
    if (!source) return [];
    if (source.venueId !== entry.venueId) throw new Error(`Reviewed menu venue does not match its source: ${entry.id}`);
    if (entry.verification !== "visually_reviewed" || !Number.isInteger(entry.page) || entry.page < 1 || entry.page > source.pageCount ||
        !entry.name?.trim() || !entry.station?.trim() ||
        ![null,"Vegan","Vegetarian"].includes(entry.diet) ||
        !["dish","component","meal","plate_choice","add_on"].includes(entry.kind) ||
        (entry.price !== null && (!Number.isFinite(entry.price) || entry.price < 0)) ||
        (entry.calories !== null && (!Number.isFinite(entry.calories) || entry.calories < 0)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.validTo) || entry.validFrom > entry.validTo ||
        !Array.isArray(entry.days) || !entry.days.length || entry.days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error(`Invalid reviewed menu fields: ${entry.id}`);
    const match = entry.match && nutrition.filter(item => item.dining.venueId === entry.venueId && item.venue.station === entry.station && item.name === entry.match && item.portionLabel === entry.portion && item.nutrition.values.energy_kcal === entry.calories);
    if (entry.match && match.length !== 1) throw new Error(`Reviewed nutrition match no longer holds: ${entry.id}`);
    const item = match ? structuredClone(match[0]) : {
      name: entry.name, mode: "eatOut", diets: entry.diet === "Vegan" ? ["vegan", "vegetarian"] : entry.diet === "Vegetarian" ? ["vegetarian"] : null,
      allergens: null, ingredients: [], equipment: [], portionGrams: null, steps: [],
      nutrition: {basis: "per_serving", kind: "published", values: {energy_kcal: ["plate_choice", "meal"].includes(entry.kind) ? null : entry.calories, protein_g: null, carbohydrate_g: null, fat_g: null, fiber_g: null, sodium_mg: null}, source: entry.sourceUrl, checkedAt: reviewed.reviewedAt},
      venue: {name: source.venueId === "local-point" ? "Local Point" : "Center Table", station: entry.station, opens: null, closes: null},
      dietary: {knownPresent: entry.knownPresent, allergenAbsence: "not_established", crossContact: "unknown", publishedDiet: entry.diet},
      provenance: {sourceType: "uw_hfs_weekly_menu", sourceUrl: entry.sourceUrl, checkedAt: reviewed.reviewedAt, fields: {}, assumptions: ["One published menu selection; optional additions are extra."], limitations: ["Protein and other unpublished values remain unknown.", "Blank or missing allergen icons do not prove absence."]},
    };
    item.id = entry.id;
    item.name = entry.name;
    item.description = entry.reviewNote;
    item.cost = entry.price;
    item.portionLabel = entry.portion ?? "Menu serving; exact portion unpublished";
    item.timing = {prep: 0, cook: 0, outbound: null};
    item.availability = {status: "published_menu", validFrom: entry.validFrom, validTo: entry.validTo, days: entry.days};
    item.provenance.fields.availability = {status:"published_menu",validFrom:entry.validFrom,validTo:entry.validTo,days:entry.days,sourceUrl:entry.sourceUrl,page:entry.page,stock:"unknown"};
    item.dining = {venueId: entry.venueId, recordType: "menu", kind: entry.kind, menuCalories: entry.calories,
      menuCalorieBasis: entry.kind === "plate_choice" ? "protein_choice_only_not_plate" : "listed_item", matchStatus: match ? "explicit_reviewed_match" : "unmatched", stock: "unknown"};
    item.provenance.fields.cost = {status: entry.price === null ? "unknown" : "uw_published", value: entry.price, originalValue: entry.originalValues.price, sourceUrl: entry.sourceUrl, page: entry.page};
    item.provenance.menu = structuredClone(entry);
    item.provenance.limitations.push("Published schedule does not confirm stock, queues, substitutions or unexpected closures.");
    if (entry.kind === "plate_choice") item.provenance.limitations.push("Printed calories are for the protein choice; price includes two sides. Full plate nutrition is unknown.");
    if (match) item.provenance.match = {status: "explicit_reviewed_match", nutritionId: match[0].id, venue: item.venue.name, station: entry.station, menuName: entry.name, nutritionName: entry.match, portion: entry.portion, rationale: entry.reviewNote};
    return [item];
  });
  const deals = (reviewed.deals ?? []).filter(deal => snapshot.sources.some(source => source.sourceUrl === deal.sourceUrl && source.responseSha256 === deal.responseSha256));
  const hours = reviewed.hours.filter(h => snapshot.venues.some(v => v.id === h.venueId && v.hoursSha256 === h.hoursSha256));
  return {schemaVersion: 1, checkedAt: snapshot.checkedAt, nutrition, menu, deals, hours,
    menuSources: snapshot.menus.map(m => Object.fromEntries(Object.entries(m).filter(([key]) => !["words", "pages"].includes(key)))),
    venueSources: snapshot.venues.map(v => Object.fromEntries(Object.entries(v).filter(([key]) => key !== "rawText"))),
    limitations: reviewed.limitations,
    report: {nutritionRows: nutrition.length, reviewedMenuRows: menu.length, publishedDeals: deals.length, matchedMenuRows: menu.filter(m => m.provenance.match).length,
      matchedPrices: menu.filter(m => m.provenance.match && m.cost !== null).length,
      pricedMenuRows: menu.filter(m => m.cost !== null).length, missingMenuPrices: menu.filter(m => m.cost === null).length,
      missingNutritionProtein: nutrition.filter(m => m.nutrition.values.protein_g === null).length,
      weeklyPdfCount: snapshot.menus.length, pdfPages: snapshot.menus.reduce((n,m) => n+m.pageCount,0),
      missingNutritionStations: snapshot.pages.filter(p => !p.rows.length).map(p => ({venueId:p.venueId, station:p.station})),
      staleMenuReviews: reviewed.menuEntries.length-menu.length, staleHoursReviews: reviewed.hours.length-hours.length,
      byVenue: Object.fromEntries(snapshot.venues.map(v => [v.id, {nutrition: nutrition.filter(m => m.dining.venueId===v.id).length, menu: menu.filter(m=>m.dining.venueId===v.id).length}]))}};
}
