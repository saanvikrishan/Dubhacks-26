import { useRef, useState } from "react";
import { Icon, Modal } from "./Core";
import { money, num, photoFor } from "./format";
import { catalog, pantryItems } from "../data/catalog";
import { byId } from "../data/suggestions";
import { config } from "../domain/config";
import { recommend, clockTime, evaluate } from "../domain/engine";
import { portionNutrition } from "../domain/nutrition";
import { prettyDate } from "../domain/calendar";
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
  return (
    pantryItems.find((item) => item === q) ||
    pantryItems.find((item) => item.includes(q) || q.includes(item)) ||
    null
  );
}

/** First step when Cook is chosen: free-form groceries → Gemini suggestions. */
export function CookStart({ state, onSuggested, onEatOut }) {
  const [items, setItems] = useState([]),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(false),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState("");
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

  async function requestSuggestions(ingredients) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients,
          diet: state.profile.diet || "anything",
          time: state.context.available || 45,
          exclusions: state.profile.exclusions || [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((d) => d.msg || d).join(" ")
              : data.error || "Could not get meal suggestions.";
        if (response.status === 429)
          throw new Error(
            detail ||
              "Gemini quota exceeded. Try again later or use another API key.",
          );
        throw new Error(
          detail.includes("ECONNREFUSED")
            ? "Start the FastAPI backend on port 8000 (see fridgemate/backend)."
            : detail,
        );
      }
      const meals = data.meals || data.recipes || [];
      if (!Array.isArray(meals) || !meals.length)
        throw new Error("No meals came back. Try different ingredients.");
      onSuggested(meals, ingredients);
    } catch (err) {
      const msg = err.message || "Could not get meal suggestions.";
      setError(
        /Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)
          ? "Start the FastAPI backend on port 8000 (cd fridgemate/backend && uvicorn main:app --reload --port 8000)."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="food-layout cook-start-layout">
      <section className="cook-start" aria-label="Use your own groceries">
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
          <h2>Use your own groceries?</h2>
          <p>
            Type what you have, or upload a fridge photo—we’ll spot ingredients,
            then suggest meals you can swipe through.
          </p>
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
                No ingredients yet—upload a photo, type above, or tap a quick
                add.
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
          onClick={() => requestSuggestions([])}
        >
          {loading ? "Working…" : "Just suggest meals"}
        </button>
      </section>
    </div>
  );
}

export function SwipeCard({ children, onPass, onAccept, onDetails, label }) {
  const point = useRef(null),
    swiped = useRef(false),
    [dx, setDx] = useState(0),
    [flyingOff, setFlyingOff] = useState(null);
  
  return (
    <article
      className="swipe-card"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFlyingOff("left");
          setTimeout(onPass, 300);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setFlyingOff("right");
          setTimeout(onAccept, 300);
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
      }}
      onPointerMove={(e) => {
        if (!point.current || flyingOff) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        if (Math.abs(x) > 12 && Math.abs(x) > Math.abs(y) * 1.2) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDx(Math.max(-200, Math.min(200, x)));
        }
      }}
      onPointerUp={(e) => {
        if (!point.current || flyingOff) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        point.current = null;
        if (Math.abs(x) > 75 && Math.abs(x) > Math.abs(y) * 1.2) {
          swiped.current = true;
          setFlyingOff(x > 0 ? "right" : "left");
          setTimeout(() => {
            x > 0 ? onAccept() : onPass();
          }, 300);
        } else {
          setDx(0);
        }
      }}
      onPointerCancel={() => {
        if (flyingOff) return;
        point.current = null;
        setDx(0);
      }}
      onClickCapture={(e) => {
        if (swiped.current) {
          e.preventDefault();
          e.stopPropagation();
          swiped.current = false;
        }
      }}
    >
      <div
        className="swipe-moving"
        style={{
          transform: flyingOff 
            ? `translateX(${flyingOff === "right" ? 1000 : -1000}px) translateY(${flyingOff === "right" ? -30 : 30}px) rotate(${flyingOff === "right" ? 15 : -15}deg)`
            : `translateX(${dx}px)`,
          transition: flyingOff 
            ? "transform 0.3s cubic-bezier(0.4, 0, 1, 1), opacity 0.3s ease-out"
            : dx ? "none" : "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
          opacity: flyingOff 
            ? 0
            : dx ? Math.max(0.7, 1 - Math.abs(dx) / 300) : 1,
        }}
      >
        <div
          className={`swipe-stamp ${dx > 0 || flyingOff === "right" ? "accept" : "pass"}`}
          style={{ 
            opacity: flyingOff ? 1 : Math.min(1, Math.abs(dx) / 50),
            transform: `scale(${flyingOff ? 1.2 : Math.min(1.2, 0.8 + Math.abs(dx) / 100)})`,
          }}
        >
          {(dx > 0 || flyingOff === "right") ? "YES" : "PASS"}
        </div>
        {children}
      </div>
    </article>
  );
}

const fresh = new Set([
  "chickpea-bowl",
  "chickpea-toast",
  "tofu-cucumber",
  "chickpea-rice-salad",
]);
export function FoodDiscovery({
  state,
  mode,
  onMode,
  onChoose,
  onVenue,
  onVenueDirections,
  onDetails,
  onKitchen,
  onPreferences,
  onWindow,
  onUndoPlan,
  onChangeGroceries,
  geminiMeals = null,
  groceryList = [],
}) {
  const [passed, setPassed] = useState([]),
    [mood, setMood] = useState("any"),
    [sort, setSort] = useState("catalog"),
    [openOnly, setOpenOnly] = useState(true);
  const usingGemini = mode === "cook" && Array.isArray(geminiMeals);
  const all = recommend(
    catalog,
    state,
    { mode: "cook", sort, passed },
    { ...config, recommendation: { ...config.recommendation, maxCards: 100 } },
  );
  const geminiCards = usingGemini
    ? geminiMeals
        .filter((meal) => !passed.includes(meal.id))
        .filter((meal) => {
          if (mood === "any") return true;
          if (mood === "comfort") return !fresh.has(meal.id);
          if (mood === "quick")
            return meal.timing.prep + meal.timing.cook <= 10;
          if (mood === "hungry")
            return (meal.nutrition.values.energy_kcal ?? 0) >= 550;
          if (mood === "fancy")
            return meal.timing.prep + meal.timing.cook >= 15;
          return true;
        })
        .map((meal) => {
          const result = evaluate(meal, state);
          return {
            ...result,
            meal,
            feasible: true,
            duration:
              result.duration ??
              meal.timing.prep +
                meal.timing.cook +
                state.context.eating +
                state.context.cleanup +
                state.context.onward +
                state.context.buffer,
          };
        })
    : null;
  const meals = usingGemini
    ? geminiCards
    : all.cards.filter(
        (r) =>
          mood === "any" ||
          (mood === "comfort"
            ? !fresh.has(r.meal.id)
            : mood === "quick"
              ? r.meal.timing.prep + r.meal.timing.cook <= 10
              : mood === "hungry"
                ? r.meal.nutrition.values.energy_kcal >= 550
                : mood === "fancy"
                  ? r.meal.timing.prep + r.meal.timing.cook >= 15
                  : false),
      );
  // When constraints filter everything out, fall back to the full catalog so
  // there is always something to swipe — the card will note it doesn't fit.
  const allEvaluations = usingGemini
    ? null
    : all.evaluations.filter(
        (r) =>
          r.meal.mode === "cook" && !passed.includes(r.meal.id),
      );
  const cookCards =
    mode === "cook" && !usingGemini && meals.length === 0 && (allEvaluations?.length ?? 0) > 0
      ? allEvaluations
      : meals;
  const constrainedFallback =
    mode === "cook" && !usingGemini && meals.length === 0 && cookCards.length > 0;
  const venues = uwDining
    .filter(
      (v) =>
        !passed.includes(v.id) &&
        (!openOnly ||
          venueHours(v, state.context.date, state.context.start).open),
    )
    .sort((a, b) => distanceMeters(a) - distanceMeters(b));
  const meal = (mode === "cook" ? cookCards : meals)[0]?.meal,
    result = (mode === "cook" ? cookCards : meals)[0],
    venue = venues[0],
    nutrition = meal ? portionNutrition(meal) : null;
  const pass = (id) => setPassed((p) => [...p, id]);
  const saved = state.mealPlans.find(
    (p) => p.date === state.context.date && p.start === state.context.start,
  );
  const savedCheck = saved ? evaluate(byId[saved.mealId], state) : null;
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
              From <strong>UW HUB</strong> · nearest first
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
        {saved && (
          <div
            className={`food-saved-slot ${savedCheck.feasible ? "" : "needs-review"}`}
          >
            <div>
              <span>PLANNED · {saved.start}</span>
              <strong>{byId[saved.mealId].name}</strong>
              {!savedCheck.feasible && (
                <p>
                  {savedCheck.reasons.join(" ")} Choose a replacement below.
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
                ? `${meals.length} Gemini ideas${groceryList.length ? ` · from your list` : ""}`
                : constrainedFallback
                  ? `${cookCards.length} meals · showing all (none fit current constraints)`
                  : `${cookCards.length} meals fit your groceries`
              : `${venues.length} UW locations`}
          </span>
          <span>← Pass · {mode === "cook" ? "Choose" : "Directions"} →</span>
        </div>
        {mode === "cook" && meal ? (
          <SwipeCard
            key={meal.id}
            label={`Meal swipe card: ${meal.name}`}
            onPass={() => pass(meal.id)}
            onAccept={() => onChoose(meal)}
            onDetails={() => onDetails(meal)}
          >
            <button
              className="flashcard-cover"
              data-card-open
              onClick={() => onDetails(meal)}
              aria-label={`View ${meal.name} details`}
            >
              <img
                draggable={false}
                src={`/food/${photoFor(meal)}.png`}
                alt={`AI illustration representing ${meal.name}`}
              />
              <span className="cover-tag">
                <Icon name="leaf" size={14} />
                {usingGemini ? "Gemini suggestion" : "Cook with your groceries"}
              </span>
              <span className="photo-label">AI illustration</span>
            </button>
            <div className="flashcard-body">
              <h2>{meal.name}</h2>
              <p>{meal.description}</p>
              <div className="flash-facts">
                <span>
                  <Icon name="clock" size={17} />
                  {result.duration} min total
                </span>
                <span>{money(meal.cost)} estimate</span>
                <span>{num(nutrition.energy_kcal)} kcal</span>
                <span>{num(nutrition.protein_g)} g protein</span>
              </div>
              <div className="fits-line">
                <Icon name="check" size={16} />
                {usingGemini
                  ? "AI idea from your ingredients · estimates only"
                  : constrainedFallback
                    ? `Showing outside constraints · ${result.reasons?.[0] ?? "adjust window or groceries"}`
                    : "Ingredients, equipment, budget and calendar checked"}
              </div>
              <div className="swipe-actions">
                <button
                  className="decline-button"
                  onClick={() => pass(meal.id)}
                  aria-label="Pass on this meal"
                >
                  ×
                </button>
                <button
                  className="detail-button"
                  onClick={() => onDetails(meal)}
                >
                  Recipe & nutrition
                </button>
                <button
                  className="accept-button"
                  onClick={() => onChoose(meal)}
                  aria-label="Choose this meal"
                >
                  <Icon name="check" size={23} />
                </button>
              </div>
              <p className="swipe-hint">
                Swipe left to pass, right to choose. Tap for details.
              </p>
            </div>
          </SwipeCard>
        ) : mode === "eatOut" && venue ? (
          <SwipeCard
            key={venue.id}
            label={`Restaurant swipe card: ${venue.name}`}
            onPass={() => pass(venue.id)}
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
                {distanceMeters(venue) === 0
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
                    ? "Within published hours"
                    : "Closed at selected time"}
                </span>
                <span>Rating: view on Maps</span>
              </div>
              <h2>{venue.name}</h2>
              <p className="venue-address">{venue.location}</p>
              <p>{venue.description}</p>
              <div className="published-offers">
                {venue.offers.slice(0, 2).map((offer) => (
                  <span key={offer.name}>
                    {offer.name}
                    <strong>{money(offer.price)}</strong>
                  </span>
                ))}
                {!venue.offers.length && <p>Current prices: check menu</p>}
              </div>
              <div className="swipe-actions">
                <button
                  className="decline-button"
                  onClick={() => pass(venue.id)}
                  aria-label="Pass on this restaurant"
                >
                  ×
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
                  <Icon name="arrow" size={23} />
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
                : "No UW locations open at this time."}
            </h2>
            <p>
              {passed.length
                ? "Bring back passed cards or change your mood."
                : "Change the meal time or include locations outside their published hours."}
            </p>
            <button
              className="primary"
              onClick={() => passed.length ? setPassed([]) : setOpenOnly(false)}
            >
              {passed.length ? "Show passed cards" : "Show all locations"}
            </button>
          </div>
        )}
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
              ? usingGemini
                ? "Gemini estimates · not verified nutrition"
                : "Nutrition & costs are demo estimates"
              : "UW sources checked Oct 17 · hours can change"}
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
        <details className="small-panel how-decisions" open>
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
        {mode === "cook" &&
          all.evaluations.some(
            (r) => r.meal.mode === "cook" && !r.feasible,
          ) && (
            <details className="small-panel">
              <summary>Why some recipes are unavailable</summary>
              {all.evaluations
                .filter((r) => r.meal.mode === "cook" && !r.feasible)
                .map((r) => (
                  <p className="fine-print" key={r.meal.id}>
                    <strong>{r.meal.name}:</strong> {r.reasons.join(" ")}
                  </p>
                ))}
            </details>
          )}
      </aside>
      <button className="floating-groceries" onClick={onKitchen}>
        <Icon name="kitchen" size={20} />
        My groceries
      </button>
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
              : "Closed"}
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
      <h3>Published menu options</h3>
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
        Reserve a visit on your Daywell calendar. Choose and confirm the actual
        dish at the venue. No unknown nutrition will be added to your intake.
      </p>
      <button className="secondary" onClick={() => onPlan(venue)}>
        + Add visit to My Plan
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
