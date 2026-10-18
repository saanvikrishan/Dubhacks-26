import { buildUwDiningCatalog, prepareUwDiningMeal, currentWalking } from "../domain/uwDining.js";
import { sourcedCookCandidate, enrichCookFacts, recipeFingerprint } from "../domain/foodFacts.js";
import { useFoodReference, refreshFoodReference } from "../adapters/foodReference.js";
import { withSourcedWalking } from "../domain/uwDining.js";
import { useUwWalking, refreshWalking } from "../adapters/uwWalking.js";
import { UwDiningCatalog, UwMenuPreview, UwWalkingSummary } from "./UwDining.jsx";
import { useEffect, useRef, useState } from "react";
import { Icon, Modal } from "./Core";
import {
  MEAL_IMAGE_PLACEHOLDER,
  prefetchMealImages,
  mealImage,
  money,
  num,
} from "./format";

function MealPhoto({ meal, alt, className }) {
  const assigned = mealImage(meal);
  const [failedSrc, setFailedSrc] = useState(null);
  const src = failedSrc === assigned ? MEAL_IMAGE_PLACEHOLDER : assigned;
  return (
    <><img
      className={className}
      draggable={false}
      src={src}
      alt={alt || meal?.name || "Meal"}
      loading="eager"
      decoding="async"
      onError={() => {if(src!==MEAL_IMAGE_PLACEHOLDER)setFailedSrc(src);}}
    /><span className="photo-label">{src===MEAL_IMAGE_PLACEHOLDER?"Photo unavailable":"Meal illustration"}</span></>
  );
}
import { catalog, pantryItems } from "../data/catalog";
import { buildSourcedCatalog } from "../data/sourcedCatalog";
import { byId } from "../data/suggestions";
import { clockTime, evaluate, recommend } from "../domain/engine";
import { discoverCookMeals } from "../domain/discovery";
import { requestRecipeDrafts, cookingMinutes } from "../adapters/recipes";
import { nutritionDisplayRows, usdaConfidenceExplain } from "../domain/nutrition";
import { mealSubstitutions, pantryCovers, substitutionLine } from "../domain/substitutions";
import { prettyDate, eventsForDay, blocksMealPlanning } from "../domain/calendar";
import {
  DEAL_SOURCE,
  UW_MAP_SOURCE,
  directionsUrl,
  distanceMeters,
  ratingUrl,
  uwDining,
  venueHours,
} from "../data/uwDining";

function matchPantryName(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  return pantryItems.find((item) => item === q) || null;
}

/** First step when Cook is chosen: free-form groceries → Gemini suggestions. */
export function CookStart({ state, onSuggested, onEatOut, onBrowseLocal, onUnavailable, onWindow, onPreferences }) {
  useFoodReference();
  const [items, setItems] = useState([]),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(false),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState("");
  const [amounts,setAmounts]=useState({});
  const controller=useRef(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const busy = loading || scanning;

  function addParts(parts) {
    const next = [...items];
    for (const part of parts) {
      const cleaned = part.trim().replace(/\s+/g, " ").slice(0, 60);
      if (!cleaned) continue;
      const catalogMatch = matchPantryName(cleaned);
      const label = catalogMatch || cleaned;
      if (
        !next.some((item) => item.toLowerCase() === label.toLowerCase())
      )
        next.push(label);
    }
    setItems(next.slice(0, 30));
  }

  function addFromDraft() {
    const parts = draft.split(/[,;\n]+/).filter((p) => p.trim());
    if (!parts.length) return;
    addParts(parts);
    setDraft("");
    setError("");
  }

  function removeItem(name) {
    setItems((list) => list.filter((item) => item !== name));
  }

  async function scanFridgePhoto(file) {
    if (!file) return;
    setScanning(true);
    setError("");
    try {
      const body = new FormData();
      body.append("photo", file);
      const response = await fetch("/api/vision/ingredients", {
        method: "POST",
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((d) => d.msg || d).join(" ")
              : "Could not read that photo.";
        if (response.status === 429)
          throw new Error(
            detail ||
              "Gemini quota exceeded. Try again later or use another API key.",
          );
        throw new Error(detail);
      }
      const found = data.ingredients || [];
      if (!found.length)
        throw new Error(
          "No ingredients spotted. Try a clearer photo or add them manually.",
        );
      addParts(found);
    } catch (err) {
      const msg = err.message || "Could not read that photo.";
      setError(
        /Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)
          ? "Start the FastAPI backend on port 8000 (see fridgemate/backend)."
          : msg,
      );
    } finally {
      setScanning(false);
    }
  }

  async function requestSuggestions(ingredients, quantities=amounts) {
    setLoading(true);
    setError("");
    try {
      controller.current?.abort();
      controller.current=new AbortController();
      const pantry=Object.fromEntries(ingredients.filter(name=>quantities[name]!==undefined && quantities[name]!=='' && Number(quantities[name])>=0).map(name=>[name,Number(quantities[name])]));
      const meals=await requestRecipeDrafts({state,ingredients,pantry,signal:AbortSignal.any([controller.current.signal,AbortSignal.timeout(40000)])});
      if(!meals.length) throw new Error('No recipes matched those inputs. Adjust the cooking window or browse local recipes.');
      await onSuggested(meals,ingredients,pantry);
    } catch (err) {
      if (err.name === "AbortError") return;
      const msg = err.name === "TimeoutError" ? "Recipe generation timed out. Try again or browse local recipes." : err.message || "Could not get meal suggestions.";
      const shown = /Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)
          ? "Start the FastAPI backend on port 8000 (cd fridgemate/backend && uvicorn main:app --reload --port 8000)."
          : msg;
      if (onUnavailable) onUnavailable(shown);
      else setError(shown);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="food-layout cook-start-layout">
      <section className="cook-start" aria-label="Using your own groceries? Add them here!">
        <div className="food-topbar">
          <div className="food-mode">
            <button aria-pressed={true} type="button">
              <Icon name="leaf" size={18} />
              Cook
            </button>
            <button
              aria-pressed={false}
              type="button"
              onClick={onEatOut}
              disabled={busy}
            >
              <Icon name="fork" size={18} />
              Eat at school
            </button>
          </div>
        </div>
        <div className="cook-start-card">
          <span className="cook-start-eyebrow">
            <Icon name="kitchen" size={16} />
            Your kitchen
          </span>
          <h2>Using your own groceries?</h2>
          <p className="cook-start-subhead">Add them here!</p>
          <p>
            Type what you have, or upload a fridge photo—we’ll spot ingredients,
            then suggest meals you can swipe through.
          </p>
          <p className="fine-print">{cookingMinutes(state)} min for preparation and cooking · ${state.profile.budget.toFixed(2)} portion budget. Eating, cleanup, travel and buffer are reserved.</p>
          <div className="dialog-actions"><button className="text-button" onClick={onWindow}>Adjust meal window</button><button className="text-button" onClick={onPreferences}>Diet, budget & equipment</button></div>
          <div className="cook-start-photo">
            <label className="cook-start-photo-button">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                disabled={busy}
                aria-label="Upload fridge photo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  scanFridgePhoto(file);
                }}
              />
              {scanning ? "Scanning photo…" : "Upload fridge photo"}
            </label>
            <span className="cook-start-photo-hint">
              JPEG, PNG, or WebP · max 8 MB
            </span>
          </div>
          <label className="cook-start-entry">
            <span>What do you have?</span>
            <div className="cook-start-input-row">
              <input
                type="text"
                value={draft}
                placeholder="e.g. chicken, spinach, tortillas"
                aria-label="Type groceries you have"
                disabled={busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFromDraft();
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={addFromDraft}
                disabled={busy || !draft.trim()}
              >
                Add
              </button>
            </div>
          </label>
          <div className="cook-start-chips" role="group" aria-label="Your groceries">
            {items.map((item) => (
              <button
                key={item}
                type="button"
                className="cook-chip on"
                onClick={() => removeItem(item)}
                disabled={busy}
                aria-label={`Remove ${item}`}
                title="Tap to remove"
              >
                {item} ×
              </button>
            ))}
            {!items.length && (
              <span className="cook-start-empty">
                No ingredients yet—upload a photo or type what you have above.
              </span>
            )}
          </div>
          <div className="cook-start-chips cook-start-suggestions" role="group" aria-label="Quick add">
            {pantryItems.slice(0, 10).map((item) => (
              <button
                key={item}
                type="button"
                className="cook-chip"
                disabled={
                  busy ||
                  items.some((x) => x.toLowerCase() === item.toLowerCase())
                }
                onClick={() => addParts([item])}
              >
                + {item}
              </button>
            ))}
          </div>
          {items.length>0 && <div className="pantry-grid">{items.map(name=><label key={name}>{name}<input aria-label={`Grams available: ${name}`} type="number" min="0" max="100000" step="any" disabled={busy} placeholder="Optional" value={amounts[name]??''} onChange={e=>setAmounts({...amounts,[name]:e.target.value})}/><small>Available edible grams · optional until review</small></label>)}</div>}
          {items.length > 0 && (
            <p className="cook-start-count">
              {items.length} ingredient{items.length === 1 ? "" : "s"}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="primary cook-start-submit"
            disabled={busy || !items.length}
            onClick={() => requestSuggestions(items)}
          >
            {loading ? "Suggesting…" : "Suggest meals"}
            {!busy && <Icon name="arrow" size={16} />}
          </button>
        </div>
        <button
          type="button"
          className="cook-start-skip"
          disabled={busy}
          onClick={() => {const names=Object.keys(state.pantry).filter(k=>state.pantry[k]>0).slice(0,30); requestSuggestions(names,Object.fromEntries(names.map(n=>[n,state.pantry[n]])));}}
        >
          {loading ? "Working…" : "Suggest from my saved pantry"}
        </button>
        <button className="secondary" type="button" disabled={busy} onClick={onBrowseLocal}>Browse local recipes without Gemini</button>
      </section>
    </div>
  );
}

export function SwipeCard({ children, onPass, onAccept, onDetails, label }) {
  const point = useRef(null),
    swiped = useRef(false),
    [dx, setDx] = useState(0),
    [dy, setDy] = useState(0),
    [flyingOff, setFlyingOff] = useState(null),
    [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [label]);

  const lean =
    dx > 28 ? "lean-accept" : dx < -28 ? "lean-pass" : flyingOff === "right"
      ? "lean-accept"
      : flyingOff === "left"
        ? "lean-pass"
        : "";
  const rot = flyingOff
    ? flyingOff === "right"
      ? 18
      : -18
    : Math.max(-14, Math.min(14, dx / 14));
  const lift = flyingOff ? 0 : Math.min(10, Math.abs(dx) / 20);

  return (
    <article
      className={`swipe-card ${lean} ${entered ? "is-in" : ""}`}
      aria-label={label}
      tabIndex={0}
      style={{ "--swipe-progress": Math.min(1, Math.abs(dx) / 120) }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFlyingOff("left");
          setTimeout(()=>{setFlyingOff(null);setDx(0);onPass();}, 300);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setFlyingOff("right");
          setTimeout(()=>{setFlyingOff(null);setDx(0);onAccept();}, 300);
        }
        if (e.key === "Enter") onDetails();
      }}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          (e.target.closest("button,a,input,select") &&
            !e.target.closest("[data-card-open]"))
        )
          return;
        point.current = { x: e.clientX, y: e.clientY };
        swiped.current = false;
        e.currentTarget.classList.add("is-dragging");
      }}
      onPointerMove={(e) => {
        if (!point.current || flyingOff) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.1) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDx(Math.max(-220, Math.min(220, x)));
          setDy(Math.max(-40, Math.min(40, y * 0.35)));
        }
      }}
      onPointerUp={(e) => {
        e.currentTarget.classList.remove("is-dragging");
        if (!point.current || flyingOff) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        point.current = null;
        if (Math.abs(x) > 75 && Math.abs(x) > Math.abs(y) * 1.1) {
          swiped.current = true;
          setFlyingOff(x > 0 ? "right" : "left");
          setTimeout(() => {
            setFlyingOff(null);setDx(0);
            x > 0 ? onAccept() : onPass();
          }, 320);
        } else {
          setDx(0);
          setDy(0);
        }
      }}
      onPointerCancel={(e) => {
        e.currentTarget.classList.remove("is-dragging");
        if (flyingOff) return;
        point.current = null;
        setDx(0);
        setDy(0);
      }}
      onClickCapture={(e) => {
        if (swiped.current) {
          e.preventDefault();
          e.stopPropagation();
          swiped.current = false;
        }
      }}
    >
      <div className="swipe-stack-shadow" aria-hidden="true" />
      <div
        className="swipe-moving"
        style={{
          transform: flyingOff
            ? `translateX(${flyingOff === "right" ? 1100 : -1100}px) translateY(${flyingOff === "right" ? -48 : 48}px) rotate(${rot}deg) scale(0.94)`
            : `translateX(${dx}px) translateY(${dy - lift}px) rotate(${rot}deg)`,
          transition: flyingOff
            ? "transform 0.32s cubic-bezier(0.4, 0, 1, 1), opacity 0.28s ease-out"
            : dx
              ? "none"
              : "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          opacity: flyingOff ? 0 : dx ? Math.max(0.78, 1 - Math.abs(dx) / 340) : 1,
        }}
      >
        <div
          className="swipe-tint"
          style={{
            opacity: flyingOff
              ? 0.28
              : Math.min(0.22, Math.abs(dx) / 380),
            background:
              dx > 0 || flyingOff === "right"
                ? "rgba(61, 154, 95, 0.58)"
                : "rgba(196, 116, 74, 0.52)",
          }}
        />
        <div
          className={`swipe-stamp ${dx > 0 || flyingOff === "right" ? "accept" : "pass"}`}
          style={{
            opacity: flyingOff ? 1 : Math.min(1, Math.abs(dx) / 42),
            transform: `scale(${flyingOff ? 1.18 : Math.min(1.15, 0.75 + Math.abs(dx) / 110)}) rotate(${rot * -0.4}deg)`,
          }}
        >
          {dx > 0 || flyingOff === "right" ? "✓" : "✕"}
        </div>
        {children}
      </div>
    </article>
  );
}

export function FoodDiscovery({
  state,
  mode,
  onMode,
  onChoose,
  onVenue,
  onVenueDirections,
  onDetails,
  onPreferences,
  onWindow,
  onUndoPlan,
  onChangeGroceries,
  onReview,
  geminiMeals = null,
  groceryList = [],
}) {
  const [passed, setPassed] = useState([]),
    [mood, setMood] = useState("any"),
    [sort, setSort] = useState("catalog"),
    [openOnly, setOpenOnly] = useState(true);
  const allDayBusy = eventsForDay(state.events ?? [], state.context.date).filter(e=>e.allDay && blocksMealPlanning(e) && !e.completed);
  const usingGemini = mode === "cook" && Array.isArray(geminiMeals);
  useEffect(() => {
    if (usingGemini) prefetchMealImages(geminiMeals);
  }, [usingGemini, geminiMeals]);
  const walking = useUwWalking(mode === "eatOut");
  const food = useFoodReference();
  const sourced = buildSourcedCatalog().map(record => {
    const item = withSourcedWalking(record, walking.routes);
    return {meal:item, ...evaluate(item, state)};
  });
  const input=usingGemini?geminiMeals:[...catalog,...(state.generatedMeals??[]).filter(m=>m.review?.confirmed && !m.sourceRecipeId)];
  const unique=new Map();
  for(const original of input.filter(m=>m.mode==='cook')) {
    const base=original.sourceRecipeId ? catalog.find(m=>m.id===original.sourceRecipeId)??state.generatedMeals.find(m=>m.id===original.sourceRecipeId)??original : original;
    const candidate=base.suggestion&&!base.review?.confirmed?enrichCookFacts(base,food.reference):sourcedCookCandidate(base,food.reference);
    unique.set(recipeFingerprint(candidate),candidate);
  }
  const all=discoverCookMeals([...unique.values()],state,{sort,mood,passed,preferences:food.preferences});
  const meals=all.display;
  const school=recommend(buildUwDiningCatalog().filter(m=>m.dining.recordType==='menu').map(m=>prepareUwDiningMeal(m,state,walking.routes).meal),state,{mode:'eatOut',sort:'time',passed});
  const schoolMeal=school.cards[0]?.meal;
  const venues = uwDining
    .filter(
      (v) =>
        !passed.includes(v.id) &&
        (!openOnly ||
          (venueHours(v, state.context.date, state.context.start).open || venueHours(v, state.context.date, state.context.start).status === "unknown")),
    )
    .sort((a, b) => distanceMeters(a) - distanceMeters(b));
  const meal = meals[0]?.meal,
    result = meals[0],
    venue = schoolMeal?uwDining.find(v=>v.id===schoolMeal.dining.venueId):venues[0],
    nutrition = meal ? nutritionDisplayRows(meal,1,['energy_kcal','protein_g']) : [];
  const venueWalk=venue?currentWalking(walking.routes.find(r=>r.venueId===venue.id)):null;
  const pass = (id) => setPassed((p) => [...p, id]);
  const saved = state.mealPlans.find(
    (p) => p.date === state.context.date && p.start === state.context.start,
  );
  const savedCheck = saved && !saved.openSlot && byId[saved.mealId] ? evaluate(byId[saved.mealId], state) : null;
  return (
    <div className="food-layout">
      <section className="food-discovery">
        <div className="food-topbar">
          <div className="food-mode">
            <button
              aria-pressed={mode === "cook"}
              onClick={() => {
                onMode("cook");
                setPassed([]);
              }}
            >
              <Icon name="leaf" size={18} />
              Cook
            </button>
            <button
              aria-pressed={mode === "eatOut"}
              onClick={() => {
                onMode("eatOut");
                setPassed([]);
              }}
            >
              <Icon name="fork" size={18} />
              Eat at school
            </button>
          </div>
          <button className="window-button" onClick={onWindow}>
            <Icon name="clock" size={16} />
            {prettyDate(state.context.date, { month: "short" })} ·{" "}
            {state.context.start} · {state.context.available} min{" "}
            <span>Adjust</span>
          </button>
        </div>
        {mode === "cook" && onChangeGroceries && <button className="secondary" onClick={onChangeGroceries}>Your groceries & photo scan</button>}
        {mode === "cook" ? (
          <div className="food-filters">
            <label>
              Mood
              <select
                aria-label="Food mood"
                value={mood}
                onChange={(e) => {
                  setMood(e.target.value);
                  setPassed([]);
                }}
              >
                <option value="any">Anything sounds good</option>
                <option value="comfort">Comforting</option>
                <option value="quick">Quick & Simple</option>
                <option value="hungry">Hungry as a beast</option>
                <option value="fancy">Feeling fancy</option>
              </select>
            </label>
            <label>
              Prioritize
              <select
                aria-label="Food priority"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="catalog">My preferences</option>
                <option value="protein">More protein</option>
                <option value="cost">Lower cost</option>
                <option value="time">Faster prep</option>
              </select>
            </label>
            <button className="filter-link" onClick={onPreferences}>
              Diet, budget & goals
            </button>
          </div>
        ) : (
          <div className="venue-filterbar">
            <span>
              From <strong>UW HUB</strong> · {schoolMeal?"walking time first":"nearest first"}
            </span>
            <label className="check-label">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Open at your meal time
            </label>
          </div>
        )}
        {saved && !saved.openSlot && byId[saved.mealId] && (
          <div
            className="food-saved-slot"
          >
            <div>
              <span>PLANNED · {saved.start}</span>
              <strong>{byId[saved.mealId].name}</strong>
              {savedCheck && !savedCheck.feasible && savedCheck.reasons.length > 0 && (
                <p className="fine-print">
                  Heads up: {savedCheck.reasons[0].replace(/^Not enough confirmed ingredients:/i, "You may need:").replace(/^Needs \d+ minutes;.*$/, "Takes a bit longer than your window.")}
                </p>
              )}
            </div>
            <button
              className="text-button"
              onClick={() => onDetails(byId[saved.mealId])}
            >
              Details
            </button>
          </div>
        )}
        {state.planUndo && (
          <button className="text-button plan-undo" onClick={onUndoPlan}>
            ↶ Undo last plan change
          </button>
        )}
        <div className="deck-heading">
          <span>
            {mode === "cook"
              ? usingGemini
                ? `${all.cards.length} fit · ${all.drafts.length} to review${groceryList.length ? ' · from your list' : ''}`
                : `${all.cards.length} meals fit your groceries`
              : schoolMeal?`${school.cards.length} dishes fit · ${venues.length} locations`:`${venues.length} UW locations · no verified dish fits this window`}
          </span>
          <span>← Pass · {mode === "cook" ? "Choose" : "Directions"} →</span>
        </div>
        {mode === "cook" && meal ? (
          <SwipeCard
            key={meal.id}
            label={`Meal swipe card: ${meal.name}`}
            onPass={() => pass(meal.id)}
            onAccept={() => result.feasible ? onChoose(meal) : onReview(meal)}
            onDetails={() => onDetails(meal)}
          >
            <button
              className="flashcard-cover"
              data-card-open
              onClick={() => onDetails(meal)}
              aria-label={`View ${meal.name} details`}
            >
              <MealPhoto key={meal.id} meal={meal} alt={meal.name} />
              <span className="cover-tag">
                <Icon name="leaf" size={14} />
                {meal.suggestion ? (meal.review?.confirmed?'Reviewed recipe':'Recipe draft · needs review') : "Cook with your groceries"}
              </span>
            </button>
            <div className="flashcard-body">
              <h2>{meal.name}</h2>
              <p>{meal.description}</p>
              <div className="flash-facts">
                <span>
                  <Icon name="clock" size={17} />
                  {result.duration ?? 'Unknown'} min total
                </span>
                <span>{meal.cost==null?'Cost needs a product match':`${money(meal.cost)} ingredient estimate`}</span>
                {nutrition.map(row=><span key={row.key}>{num(row.value)} {row.key==='energy_kcal'?'kcal':'g protein'}{row.partial?' subtotal':''}</span>)}
                {!nutrition.length&&<span>Nutrition needs an ingredient match</span>}
              </div>
              <div
                className="fits-line"
                title={
                  meal.nutrition?.kind === "usda_estimated"
                    ? usdaConfidenceExplain(meal.nutrition)
                    : undefined
                }
              >
                <Icon name="check" size={16} />
                {result.feasible ? `Ingredients, equipment, budget and calendar checked${result.preferenceReason?" · Saved preference match":""}` : "Not ready to choose"}
              </div>
              {!result.feasible && <div className="notice warning" role="status">{result.reasons.join(' ')}</div>}
              {(() => {
                const pantry = groceryList.length ? groceryList : state.pantry;
                let alts = mealSubstitutions(meal, pantry).slice(0, 4);
                // If the API left substitutions empty but flagged gaps, still show them
                if (!alts.length && Array.isArray(meal.missingIngredients)) {
                  alts = meal.missingIngredients
                    .filter((name) => name && !pantryCovers(name, pantry))
                    .slice(0, 4)
                    .map((missing) => ({
                      missing,
                      useInstead: null,
                      fromPantry: false,
                      canOmit: false,
                      note: `${missing} isn’t in your list — swap it or add it.`,
                    }));
                }
                if (!alts.length) return null;
                return (
                  <div className="substitution-callout">
                    <strong>Alternatives</strong>
                    <div className="substitution-chips">
                      {alts.map((s) => (
                        <button
                          type="button"
                          key={`${s.missing}-${s.useInstead || "omit"}`}
                          className={`sub-chip ${s.fromPantry ? "from-pantry" : ""}`}
                          title={s.note || substitutionLine(s)}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.currentTarget.classList.toggle("is-open");
                          }}
                        >
                          <span className="sub-chip-main">
                            {substitutionLine(s)}
                          </span>
                          {s.note ? (
                            <span className="sub-chip-note">{s.note}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="swipe-actions">
                <button
                  className="decline-button"
                  onClick={() => pass(meal.id)}
                  aria-label="Pass on this meal"
                >
                  ✕
                </button>
                <button
                  className="detail-button"
                  onClick={() => onDetails(meal)}
                >
                  Recipe & nutrition
                </button>
                <button
                  className="accept-button"
                  onClick={() => result.feasible ? onChoose(meal) : onReview(meal)}
                  aria-label={result.feasible ? "Choose this meal" : "Review recipe details"}
                >
                  ✓
                </button>
              </div>
              <p className="swipe-hint">
                Swipe left to pass. Swipe right to {result.feasible?'choose':'review details'}. Tap for recipe and nutrition.
              </p>
            </div>
          </SwipeCard>
        ) : mode === "eatOut" && venue ? (
          <SwipeCard
            key={schoolMeal?.id??venue.id}
            label={`Restaurant swipe card: ${schoolMeal?.name??venue.name}`}
            onPass={() => pass(schoolMeal?.id??venue.id)}
            onAccept={() => onVenueDirections(venue)}
            onDetails={() => onVenue(venue)}
          >
            <button
              className="flashcard-cover"
              data-card-open
              onClick={() => onVenue(venue)}
              aria-label={`View ${venue.name} details`}
            >
              <img
                draggable={false}
                src={`/food/${venue.photo}.png`}
                alt="Illustrative meal, not a photo of this restaurant’s dish"
              />
              <span className="cover-tag">
                {venueWalk ? `${venueWalk.distanceMeters} m walking` : distanceMeters(venue) === 0
                  ? "At the HUB"
                  : `~${distanceMeters(venue)} m · straight-line`}
              </span>
              <span className="photo-label">
                AI illustration · not venue photography
              </span>
            </button>
            <div className="flashcard-body">
              <div className="venue-card-status">
                <span
                  className={
                    venueHours(venue, state.context.date, state.context.start)
                      .open
                      ? "open"
                      : "closed"
                  }
                >
                  {venueHours(venue, state.context.date, state.context.start)
                    .open
                    ? schoolMeal ? "Within published station hours" : "Within venue hours; stations vary"
                    : venueHours(venue, state.context.date, state.context.start).status === "unknown" ? "Hours unverified for selected date" : "Outside venue hours"}
                </span>
                <span>Rating: view on Maps</span>
              </div>
              <h2>{schoolMeal?.name??venue.name}</h2>
              {schoolMeal && <p>{venue.name} · {schoolMeal.venue.station} · {schoolMeal.portionLabel}</p>}
              {schoolMeal && <div className="flash-facts"><span>{money(schoolMeal.cost)} published</span><span>{num(schoolMeal.nutrition.values.energy_kcal)} kcal</span><span>{schoolMeal.timing.outbound} min walk</span></div>}
              <p className="venue-address">{venue.location}</p>
              <p>{venue.description}</p>
              <UwWalkingSummary venueId={venue.id} />
              {schoolMeal?<p className="fine-print">Published allergens present: {schoolMeal.dietary.knownPresent.join(", ")||"None confirmed"}. Protein and cross-contact are unconfirmed. Menu and sources are in details.</p>:<UwMenuPreview venueId={venue.id} state={state} />}
              <div className="swipe-actions">
                <button
                  className="decline-button"
                  onClick={() => pass(venue.id)}
                  aria-label="Pass on this restaurant"
                >
                  ✕
                </button>
                <button
                  className="detail-button"
                  onClick={() => onVenue(venue)}
                >
                  Menu & details
                </button>
                <button
                  className="accept-button"
                  onClick={() => onVenueDirections(venue)}
                  aria-label="Open walking directions"
                >
                  ✓
                </button>
              </div>
              <p className="swipe-hint">
                Swipe right for Google Maps. Menu and nutrition stay one tap
                away.
              </p>
            </div>
          </SwipeCard>
        ) : (
          <div className="deck-empty">
            <Icon name="fork" size={35} />
            <h2>
              {passed.length
                ? "You’ve seen these options."
                : mode==='cook' && ['not_requested','loading'].includes(food.status) ? 'Checking food prices…'
                : mode==='cook' && food.status==='unavailable' ? 'Food prices could not be loaded.'
                : mode==='cook' ? "No meals fit this window." : "No UW locations open at this time."}
            </h2>
            <p>
              {passed.length
                ? "Bring back passed cards or change your mood."
                : mode==='cook' && ['not_requested','loading'].includes(food.status) ? 'Checking ingredient prices and nutrition. Your meal options will update shortly.'
                : mode==='cook' && food.status==='unavailable' ? 'Retry the price lookup. Missing prices have not been replaced with guesses.'
                : mode==='cook' ? (Object.values(state.pantry).some(g => g > 0) ? "Choose a later time or review the reasons below. Your food restrictions stay in place." : "Add the groceries you have, or explore UW dining. You can plan for today or a future date.") : "Change the meal time or include locations outside their published hours."}
            </p>
            {mode === "cook" && allDayBusy.length>0 && <p className="error">Your calendar marks {allDayBusy.map(e=>e.title).join(", ")} busy all day. Open the event in My Plan to change whether it blocks meals, or choose another date.</p>}
            <button
              className="primary"
              disabled={mode==='cook' && ['not_requested','loading'].includes(food.status)}
              onClick={() => passed.length ? setPassed([]) : mode==='cook' && food.status==='unavailable' ? refreshFoodReference() : mode==='cook' ? (Object.values(state.pantry).some(g => g > 0) ? onWindow() : onChangeGroceries()) : setOpenOnly(false)}
            >
              {passed.length ? "Show passed cards" : mode==='cook' && ['not_requested','loading'].includes(food.status) ? 'Checking prices…' : mode==='cook' && food.status==='unavailable' ? 'Retry price lookup' : mode==='cook'?(Object.values(state.pantry).some(g => g > 0)?'Choose meal time':'Add groceries'):"Show all locations"}
            </button>
          </div>
        )}
        {mode === "cook" && !meal && !passed.length && <div className="empty-meal-actions"><button className="secondary" onClick={onWindow}>Plan for later or tomorrow</button><button className="text-button" onClick={() => onMode("eatOut")}>Explore UW dining</button></div>}
        {mode==='cook' && all.evaluations.some(r=>!r.feasible && !all.drafts.some(d=>d.meal.id===r.meal.id)) && <details className="allowances"><summary>Why other meals do not fit</summary>{all.evaluations.filter(r=>!r.feasible && !all.drafts.some(d=>d.meal.id===r.meal.id)).map(r=><p key={r.meal.id}><strong>{r.meal.name}</strong> — {r.reasons.join(' ')}</p>)}</details>}
        <div className="deck-footer">
          <button
            className="text-button"
            disabled={!passed.length}
            onClick={() => setPassed((p) => p.slice(0, -1))}
          >
            ↶ Undo last pass
          </button>
          {mode === "cook" && onChangeGroceries ? (
            <button className="text-button" onClick={onChangeGroceries}>
              Change groceries
            </button>
          ) : null}
          <span>
            {mode === "cook"
              ? food.status==='loading'?'Loading USDA and store price facts…':`USDA ingredient estimates · ${food.reference.store.name} price estimates`
              : "Published UW dishes · Google walking routes from the HUB"}
          </span>
        </div>

      </section>
      <aside className="food-explainer">
        <section className="small-panel">
          <h3>Your meal constraints</h3>
          <dl>
            <div>
              <dt>Budget</dt>
              <dd>{money(state.profile.budget)} per meal</dd>
            </div>
            <div>
              <dt>Diet</dt>
              <dd>{state.profile.diet}</dd>
            </div>
            <div>
              <dt>Exclusions</dt>
              <dd>{state.profile.exclusions.join(", ") || "None set"}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {state.context.date} · {state.context.start}
              </dd>
            </div>
            <div>
              <dt>Next commitment</dt>
              <dd>{state.context.commitmentTime}</dd>
            </div>
          </dl>
          <button className="text-button" onClick={onPreferences}>
            Edit preferences
          </button>
        </section>
        <details className="small-panel how-decisions">
          <summary>How Daywell chooses</summary>
          <p>
            Cook cards come from{" "}
            {catalog.filter((m) => m.mode === "cook").length} curated recipes.
            Rules remove meals that conflict with your ingredients, equipment,
            diet, budget, time or calendar. Your selected priority then orders
            the rest.
          </p>
          <p>
            Eat at school uses real UW dining locations and published menu
            links. A venue choice does not verify a particular dish or its
            allergens.
          </p>
          <p>
            No weighted score or language model is deciding for you. The
            assistant currently supports local food commands.
          </p>
        </details>
        {mode === "cook" && <details className="small-panel" aria-label="Sourced records">
          <summary>More sourced records</summary>
          <button className="secondary" disabled={walking.status === "loading"} onClick={refreshWalking}>Retrieve Google walking routes</button>
          {walking.status === "unavailable" && <p className="fine-print">Refresh failed. Previously retrieved routes retain their original timestamps and expire after five minutes.</p>}
          <p className="fine-print">
            USDA ingredient estimates and published UW HFS rows. They stay out
            of the swipe deck until price, travel, service, and hours are
            known. Straight-line distance is meters, not walking minutes.
          </p>
          {sourced.map(({ meal: item, feasible, reasons }) => {
            const place = uwDining.find(
              (venue) =>
                venue.name === item.venue?.name ||
                venue.name === item.provenance?.locationReference?.name,
            );
            return (
              <p className="fine-print" key={item.id}>
                <strong>{item.name}</strong> — {feasible ? "Feasible" : "Not feasible"}
                {" · "}
                {item.nutrition?.kind ?? "unknown source"}
                {" · "}
                {item.cost == null ? "Price unknown" : money(item.cost)}
                {" · "}
                {item.provenance?.fields.walking?.status === "retrieved_route"
                  ? `${item.timing.outbound} min walking · ${item.provenance.fields.walking.distanceMeters} m route · Google Maps · retrieved ${new Date(item.provenance.fields.walking.checkedAt).toLocaleTimeString()}`
                  : item.timing?.outbound == null ? "Travel time unknown" : `${item.timing.outbound} min stated travel`}
                {item.venue?.opens == null && item.mode === "eatOut"
                  ? " · Hours unknown"
                  : ""}
                {place ? ` · ${distanceMeters(place)} m straight-line from the HUB` : ""}
                {!feasible && reasons.length ? `. ${reasons.join(" ")}` : ""}
              </p>
            );
          })}
        </details>}
        {mode === "cook" &&
          !usingGemini &&
          all.evaluations.some(
            (r) => r.meal.mode === "cook" && !r.feasible,
          ) && (
            <details className="small-panel">
              <summary>Tips for these meals</summary>
              {all.evaluations
                .filter((r) => r.meal.mode === "cook" && !r.feasible)
                .map((r) => {
                  const note = r.reasons.map((reason) => {
                    if (/not enough confirmed ingredients/i.test(reason)) {
                      const match = reason.match(/:\s*(.+)/);
                      const items = match
                        ? match[1].split(",").map((s) => s.replace(/\s*\(.*?\)/g, "").trim()).filter(Boolean)
                        : [];
                      return items.length ? `Grab: ${items.slice(0, 3).join(", ")}` : "A few ingredients needed";
                    }
                    if (/needs equipment/i.test(reason)) return reason.replace("Needs equipment:", "Helpful to have:");
                    if (/needs \d+ minutes/i.test(reason)) return "Takes a bit longer than your window";
                    if (/costs \$/i.test(reason)) return reason.replace("Costs", "Est.").replace(", above your", " · cap");
                    return reason;
                  }).join(" · ");
                  return (
                    <p className="fine-print" key={r.meal.id}>
                      <strong>{r.meal.name}:</strong> {note}
                    </p>
                  );
                })}
            </details>
          )}
      </aside>
    </div>
  );
}

export function VenueDetails({ venue, state, onClose, onPlan }) {
  const hours = venueHours(venue, state.context.date, state.context.start);
  return (
    <Modal title={venue.name} onClose={onClose} wide>
      <p className="venue-detail-location">{venue.location}</p>
      <div className="venue-detail-metrics">
        <span>
          <strong>
            {distanceMeters(venue) === 0
              ? "On site"
              : `~${distanceMeters(venue)} m`}
          </strong>
          from UW HUB
        </span>
        <span>
          <strong>
            {hours.range
              ? `${clockTime(hours.range[0])}–${clockTime(hours.range[1])}`
              : hours.status === "unknown" ? "Unknown" : "Closed"}
          </strong>
          published hours for {state.context.date}
        </span>
        <a href={ratingUrl(venue)} target="_blank" rel="noreferrer">
          <strong>Google Maps ↗</strong>Current rating & reviews
        </a>
      </div>
      <p className="muted">
        Distance is straight-line between official UW building pins. Open
        walking directions for the actual route and travel time.
      </p>
      <UwWalkingSummary venueId={venue.id} />
      <UwMenuPreview venueId={venue.id} state={state} />
      <details className="allowances"><summary>Full menu, nutrition & sources</summary><UwDiningCatalog state={state} initialVenueId={venue.id} /></details>
      <h3>Published value deals · current service unverified</h3>
      <div className="published-offers detail-offers">
        {venue.offers.length ? (
          venue.offers.map((o) => (
            <span key={o.name}>
              {o.name}
              <strong>{money(o.price)}</strong>
            </span>
          ))
        ) : (
          <p>Prices were not verified. Check the current menu.</p>
        )}
      </div>
      <p className="fine-print">
        Published UW value deals; exact availability, tax, toppings and changes
        need checking at the venue. These are menu leads, not a verified
        nutrition match.
      </p>
      <div className="venue-links">
        <a
          className="secondary"
          href={venue.weeklyMenu || venue.menu}
          target="_blank"
          rel="noreferrer"
        >
          Full menu ↗
        </a>
        <a
          className="secondary"
          href="https://hfs.uw.edu/eat/nutrition/"
          target="_blank"
          rel="noreferrer"
        >
          UW nutrition & allergens ↗
        </a>
        <a
          className="primary"
          href={directionsUrl(venue)}
          target="_blank"
          rel="noreferrer"
        >
          Walking directions
          <Icon name="arrow" size={16} />
        </a>
      </div>
      <h3>Plan the time</h3>
      <p className="muted">
        Reserve a visit on your WhatsCooking.ai calendar. Choose and confirm the actual
        dish at the venue. No unknown nutrition will be added to your intake.
      </p>
      <button className="secondary" onClick={() => onPlan(venue)}>
        + Add visit to My Meal Plan
      </button>
      <details className="allowances">
        <summary>Sources & what is still unknown</summary>
        <p>
          <a href={venue.menu} target="_blank" rel="noreferrer">
            UW location, menus & hours
          </a>{" "}
          ·{" "}
          <a href={DEAL_SOURCE} target="_blank" rel="noreferrer">
            UW value deal prices
          </a>{" "}
          ·{" "}
          <a href={UW_MAP_SOURCE} target="_blank" rel="noreferrer">
            UW building coordinates
          </a>
        </p>
        <p>
          Reviewed {venue.checkedAt}. Ratings, live queues, stock, exact dish
          nutrients and allergen suitability are not loaded. No rating or
          nutrition value has been invented.
        </p>
      </details>
    </Modal>
  );
}
