import {useState} from "react";
import {uwCatalog, prepareUwDiningMeal, currentWalking} from "../domain/uwDining.js";
import {evaluate} from "../domain/engine.js";
import {uwDining, directionsUrl} from "../data/uwDining.js";
import {refreshWalking, useUwWalking} from "../adapters/uwWalking.js";
import {money, num} from "./format.js";
import "./uwDining.css";
const value = (n, unit) => n == null ? "Unknown" : `${num(n)} ${unit}`;
const sourceLink = item => `${item.provenance.menu?.sourceUrl ?? item.provenance.sourceUrl}${item.provenance.menu?.page ? `#page=${item.provenance.menu.page}` : ""}`;

export function UwWalkingSummary({venueId, allowRefresh = true}) {
  const walking = useUwWalking();
  const route = currentWalking(walking.routes.find(r=>r.venueId===venueId));
  return <div className="uw-walk"><p className="fine-print">{route
    ? `${Math.ceil(route.durationSeconds/60)} min walking · ${route.distanceMeters} m route from the UW HUB · Google Maps · retrieved ${new Date(route.checkedAt).toLocaleTimeString()}`
    : "Walking time unknown · from the UW HUB"}</p>{allowRefresh && <button className="text-button" disabled={walking.status === "loading"} onClick={refreshWalking}>{walking.status === "loading" ? "Getting walk…" : route ? "Refresh walk" : "Get walking time"}</button>}{walking.status === "unavailable" && <small>Route refresh unavailable; previous retrieval times are unchanged.</small>}{walking.advisory && <details><summary>Walking advisory</summary><p className="fine-print">{walking.advisory}</p></details>}</div>;
}
export function UwMenuPreview({venueId,state}) {
  const day = new Date(`${state.context.date}T12:00:00Z`).getUTCDay();
  const seen = new Set();
  const rows = uwCatalog.menu.filter(m => {
    if (m.dining.venueId !== venueId || m.availability.validFrom > state.context.date || m.availability.validTo < state.context.date || !m.availability.days.includes(day) || ["component","add_on","plate_choice"].includes(m.dining.kind)) return false;
    const key = JSON.stringify([m.name,m.venue.station,m.portionLabel,m.cost]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0,3);
  return <div className="published-offers compact-menu" aria-label="Published menu highlights">
    <strong>Menu · {state.context.date}</strong>
    {rows.length ? rows.map(item => <div className="uw-menu-row" key={item.id}>
      <span><a href={sourceLink(item)} target="_blank" rel="noreferrer">{item.name}</a><small>{item.venue.station} · {item.portionLabel}</small></span>
      <span>{money(item.cost)}<small>{value(item.nutrition.values.energy_kcal,"kcal")}</small></span>
    </div>) : <p className="fine-print">No dated dishes verified for this day. Check the official menu.</p>}
    <small>Published menu; stock, protein and allergen safety unconfirmed. More nutrition and sources in Menu & details.</small>
  </div>;
}
export function UwDiningCatalog({state, initialVenueId = "all"}) {
  const [venueId,setVenueId]=useState(initialVenueId), [query,setQuery]=useState(""), [kind,setKind]=useState("menu"), [limit,setLimit]=useState(6);
  const walking=useUwWalking();
  const day=new Date(`${state.context.date}T12:00:00Z`).getUTCDay();
  const current = uwCatalog.menu.filter(m=>m.availability.validFrom<=state.context.date && m.availability.validTo>=state.context.date && m.availability.days.includes(day));
  const all = kind==="nutrition" ? uwCatalog.nutrition : current;
  const filtered = all.filter(item=>(venueId==="all" || item.dining.venueId===venueId) && `${item.name} ${item.venue.station}`.toLowerCase().includes(query.toLowerCase()));
  const facts = filtered.slice(0,limit).map(item=>prepareUwDiningMeal(item,state,walking.routes).meal);
  const deals=uwCatalog.deals.filter(d=>venueId==="all" || d.venueId===venueId);
  return <section className="uw-catalog small-panel" aria-label="Verified UW dining catalog">
    <h3>UW meal catalog</h3>
    <p className="fine-print">{uwCatalog.report.nutritionRows} published nutrition listings · {uwCatalog.report.reviewedMenuRows} reviewed menu entries · reviewed {uwCatalog.checkedAt}. Menu schedules do not confirm stock. Exact protein is unpublished.</p>
    <button className="secondary" disabled={walking.status==="loading"} onClick={refreshWalking}>{walking.status==="loading"?"Retrieving routes…":"Retrieve Google walking routes"}</button>
    <p className="fine-print">Routes start at the UW HUB, not your current location. {!["not_requested","loading","verified","partial"].includes(walking.status) ? "Route service unavailable; walking values remain unknown." : walking.status==="not_requested" ? "Walking values have not been requested." : walking.status==="verified" ? "Google Maps walking routes retrieved." : walking.status==="partial" ? "Some Google routes are unavailable." : ""}</p>
    {walking.advisory && <p className="fine-print">Google Maps: {walking.advisory}</p>}
    <div className="uw-filters">
      <label>Location<select value={venueId} onChange={e=>{setVenueId(e.target.value);setLimit(6);}}><option value="all">All three locations</option>{uwDining.filter(v=>["local-point","center-table","husky-den"].includes(v.id)).map(v=><option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
      <label>Records<select value={kind} onChange={e=>{setKind(e.target.value);setLimit(6);}}><option value="menu">Reviewed menu for {state.context.date}</option><option value="nutrition">Nutrition listings · service unverified</option></select></label>
      <label>Dish or station<input value={query} placeholder="Search published names" onChange={e=>{setQuery(e.target.value);setLimit(6);}}/></label>
    </div>
    <p className="fine-print">{filtered.length} records. {kind==="nutrition" ? "A nutrition listing alone does not confirm that a dish is served today." : "Only visually reviewed pages appear here. Other PDF pages remain unverified."}</p>
    {venueId==="husky-den" && <p className="fine-print">No weekly PDF link was published on the retrieved Husky Den venue page. Browse its 182 nutrition listings or the separate deals below.</p>}
    {!facts.length && <p>No verified entries in this view. Try nutrition listings or a different date. Unknown availability remains unknown.</p>}
    <div className="uw-dish-grid">{facts.map(item=>{
      const result=evaluate(item,state), n=item.nutrition.values, menu=item.provenance.menu;
      const venue=uwDining.find(v=>v.id===item.dining.venueId);
      return <article className="uw-dish" key={item.id}>
        <h4>{item.name}</h4><p>{item.venue.name} · {item.venue.station}</p>
        <strong>{money(item.cost)}</strong><p>{item.portionLabel}</p>
        <dl><div><dt>Calories</dt><dd>{value(n.energy_kcal,"kcal")}</dd></div><div><dt>Protein</dt><dd>{value(n.protein_g,"g")}</dd></div><div><dt>Carbs</dt><dd>{value(n.carbohydrate_g,"g")}</dd></div><div><dt>Sodium</dt><dd>{value(n.sodium_mg,"mg")}</dd></div><div><dt>Saturated fat</dt><dd>{value(item.published?.saturatedFat_g,"g")}</dd></div></dl>
        {item.dining.menuCalorieBasis==="protein_choice_only_not_plate" && <p>Menu prints {item.dining.menuCalories} kcal for the protein choice. Plate total unknown; price includes two sides.</p>}
        <p>Diet: {item.dietary.publishedDiet??"Unknown"}. Published allergens present: {item.dietary.knownPresent.join(", ")||"None confirmed"}. Allergen absence and cross-contact: unknown.</p>
        <p>Station hours: {item.dining.hours.status==="published" ? "Within published station hours" : item.dining.hours.status==="conflict" ? "Conflicting published hours" : item.dining.hours.status==="closed" ? "Outside published service hours" : "Unknown for this visit"}.</p>
        <UwWalkingSummary venueId={item.dining.venueId}/>
        <p className={result.feasible?"uw-eligible":"fine-print"}>{result.feasible?"Meets your selected constraints using published facts; confirm availability at the venue.":result.reasons.join(" ")}</p>
        <details><summary>Sources & verification</summary><p>{item.dining.matchStatus==="explicit_reviewed_match"?"Explicitly reviewed venue, station, variant and slice match.":"No menu-to-nutrition match has been certified."}</p><p>{menu?`Menu applies ${menu.validFrom}–${menu.validTo}, listed days only. PDF page ${menu.page}.`:"Nutrition table effective menu dates are unpublished."}</p><p>{item.description}</p><a href={sourceLink(item)} target="_blank" rel="noreferrer">Official UW source ↗</a>{item.provenance.match && <p><a href={item.provenance.sourceUrl} target="_blank" rel="noreferrer">Matched nutrition table ↗</a></p>}<pre>{JSON.stringify(menu?.originalValues??item.published.originalRow,null,2)}</pre></details>
        <a href={directionsUrl(venue)} target="_blank" rel="noreferrer">Google Maps walking directions ↗</a>
      </article>;
    })}</div>
    {filtered.length>limit && <button className="secondary" onClick={()=>setLimit(n=>n+12)}>Show more dishes</button>}
    <details><summary>Published UW value deals · service unverified</summary><p className="fine-print">These are separately scoped offers. Their prices are not transferred to similar dishes or nutrition rows.</p>{deals.map(d=><p key={d.id}><a href={d.sourceUrl} target="_blank" rel="noreferrer">{d.name}</a> · {money(d.price)} · {uwDining.find(v=>v.id===d.venueId)?.name} / {d.station} · {d.portion??"Portion unknown"} · {d.effectiveLabel}; exact dates unknown.</p>)}</details>
    <details><summary>Hours, conflicts & coverage</summary>{uwCatalog.hours.filter(h=>venueId==="all"||h.venueId===venueId).map(h=><div key={h.venueId}><a href={h.sourceUrl} target="_blank" rel="noreferrer">{uwDining.find(v=>v.id===h.venueId)?.name} official hours</a><p>{h.originalText}</p><p>Applied only {h.validFrom}–{h.validTo} in America/Los_Angeles; special closures unconfirmed.</p>{h.conflicts.map(c=><p key={c}>{c}</p>)}</div>)}{uwCatalog.limitations.map(t=><p key={t}>{t}</p>)}</details>
  </section>;
}
