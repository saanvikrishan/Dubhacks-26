import { useRef, useState } from "react";
import { Icon, Modal } from "./Core";
import { money, num, photoFor } from "./format";
import { catalog, byId, pantryItems } from "../data/catalog";
import { config } from "../domain/config";
import { recommend, clockTime, evaluate } from "../domain/engine";
import { addGroceryNames, pantryFromGroceries } from "../domain/groceries";
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
const wideRecommend = {
  ...config,
  recommendation: { ...config.recommendation, maxCards: 100 },
};

function GroceryPrompt({ initialItems, state, onUseGroceries, onSuggestMeals, onAmounts }) {
  const [items, setItems] = useState(initialItems),
    [draft, setDraft] = useState(""),
    [hint, setHint] = useState("");
  const preview = pantryFromGroceries(items);
  const ideas = preview.matched.length
    ? recommend(
        catalog,
        { ...state, pantry: preview.pantry },
        { mode: "cook" },
        wideRecommend,
      ).cards
    : [];
  const extras = items.filter(
    (item) => !pantryItems.some((name) => name.toLowerCase() === item.toLowerCase()),
  );
  const selected = (name) =>
    items.some((item) => item.toLowerCase() === name.toLowerCase());
  function addDraft() {
    const next = addGroceryNames(items, draft);
    if (next.length === items.length && !draft.trim()) return;
    setItems(next);
    setDraft("");
    setHint("");
  }
  function toggle(name) {
    setHint("");
    setItems((current) =>
      current.some((item) => item.toLowerCase() === name.toLowerCase())
        ? current.filter((item) => item.toLowerCase() !== name.toLowerCase())
        : [...current, name],
    );
  }
  function submit(event) {
    event.preventDefault();
    const next = addGroceryNames(items, draft);
    setItems(next);
    setDraft("");
    const result = pantryFromGroceries(next);
    if (!result.matched.length) {
      setHint(
        next.length
          ? "Those ingredients aren’t in the recipe library yet. Tap a few below, or just suggest meals."
          : "Add what you have, or choose Just suggest meals.",
      );
      return;
    }
    onUseGroceries(next, result);
  }
  return (
    <section className="grocery-prompt" aria-labelledby="grocery-heading">
      <div className="grocery-card">
        <div className="grocery-intro">
          <span className="eyebrow">COOK AT HOME</span>
          <h2 id="grocery-heading">Use your own groceries?</h2>
          <p>
            Add what you have. We’ll suggest meals you can make, with pictures
            you can swipe left to pass or right to choose.
          </p>
        </div>
        <form onSubmit={submit}>
          <label className="grocery-label" htmlFor="grocery-input">
            What do you have?
          </label>
          <div className="grocery-entry">
            <input
              id="grocery-input"
              value={draft}
              placeholder="eggs, rice, tomatoes…"
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDraft();
                }
              }}
            />
            <button type="button" className="secondary" onClick={addDraft}>
              Add
            </button>
          </div>
          {extras.length > 0 && (
            <div className="grocery-selected" aria-label="Other groceries you added">
              {extras.map((item) => (
                <button
                  type="button"
                  key={item}
                  className="grocery-chip unmatched"
                  onClick={() => toggle(item)}
                >
                  {item}
                  <span aria-hidden="true"> ×</span>
                  <span className="sr-only">Remove {item}</span>
                </button>
              ))}
            </div>
          )}
          {preview.unmatched.length > 0 && (
            <p className="grocery-hint">
              No recipes yet for {preview.unmatched.join(", ")}.
            </p>
          )}
          {hint && (
            <p className="grocery-hint" role="status">
              {hint}
            </p>
          )}
          {ideas.length > 0 && (
            <p className="grocery-count" aria-live="polite">
              {ideas.length === 1
                ? "1 meal you could make"
                : `${ideas.length} meals you could make`}
            </p>
          )}
          <button
            className="primary grocery-continue"
            type="submit"
            disabled={!items.length && draft.trim().length < 2}
          >
            See what I can make
            <Icon name="arrow" size={16} />
          </button>
        </form>
        <div className="grocery-common">
          <span>Or tap what you have</span>
          <div className="grocery-chips">
            {pantryItems.map((item) => (
              <button
                type="button"
                key={item}
                className={`grocery-chip${selected(item) ? " selected" : ""}`}
                aria-pressed={selected(item)}
                onClick={() => toggle(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="text-button grocery-amounts" onClick={onAmounts}>
          Enter amounts in grams
        </button>
      </div>
      <div className="grocery-skip">
        <p>Skip the list and browse ideas.</p>
        <button type="button" className="grocery-skip-button" onClick={onSuggestMeals}>
          Just suggest meals
        </button>
      </div>
    </section>
  );
}

export function FoodDiscovery({
  state,
  mode,
  cookStep,
  suggestionMode,
  groceryList,
  onMode,
  onStartCook,
  onChoose,
  onVenue,
  onVenueDirections,
  onDetails,
  onKitchen,
  onPreferences,
  onWindow,
  onUndoPlan,
  onUseGroceries,
  onSuggestMeals,
  onEditGroceries,
}) {
  const [passed, setPassed] = useState([]),
    [mood, setMood] = useState("any"),
    [sort, setSort] = useState("catalog"),
    [openOnly, setOpenOnly] = useState(true);
  const asking = mode === "cook" && cookStep === "ask";
  const suggestingAny = mode === "cook" && suggestionMode === "any";
  const all = recommend(
    catalog,
    state,
    { mode: "cook", sort, passed, ignoreIngredients: suggestingAny },
    wideRecommend,
  );
  const meals = all.cards.filter(
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
  const venues = uwDining
    .filter(
      (v) =>
        !passed.includes(v.id) &&
        (!openOnly ||
          venueHours(v, state.context.date, state.context.start).open),
    )
    .sort((a, b) => distanceMeters(a) - distanceMeters(b));
  const meal = meals[0]?.meal,
    result = meals[0],
    venue = venues[0],
    nutrition = meal ? portionNutrition(meal) : null,
    shortOn = meal
      ? meal.ingredients.filter((item) => !(state.pantry[item.name] >= item.grams))
      : [];
  const pass = (id) => setPassed((p) => [...p, id]);
  const saved = state.mealPlans.find(
    (p) => p.date === state.context.date && p.start === state.context.start,
  );
  const savedCheck = saved ? evaluate(byId[saved.mealId], state) : null;
  return (
    <div className={`food-layout${asking ? " grocery-layout" : ""}`}>
      <section className="food-discovery">
        <div className="food-topbar">
          <div className="food-mode">
            <button
              aria-pressed={mode === "cook"}
              onClick={() => {
                onStartCook();
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
        {asking ? (
          <GroceryPrompt
            initialItems={groceryList}
            state={state}
            onUseGroceries={onUseGroceries}
            onSuggestMeals={onSuggestMeals}
            onAmounts={onKitchen}
          />
        ) : mode === "cook" ? (
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
        {!asking && saved && (
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
        {!asking && state.planUndo && (
          <button className="text-button plan-undo" onClick={onUndoPlan}>
            ↶ Undo last plan change
          </button>
        )}
        {!asking && (
          <>
        <div className="deck-heading">
          <span>
            {mode === "cook"
              ? suggestingAny
                ? `${meals.length} meal ideas`
                : `${meals.length} meals from what you have`
              : `${venues.length} UW locations`}
          </span>
          <span>← Pass · {mode === "cook" ? "Choose" : "Directions"} →</span>
        </div>
        {mode === "cook" && meal ? (
          <SwipeCard
            key={meal.id}
            label={`Meal swipe card: ${meal.name}`}
            onPass={() => pass(meal.id)}
            onAccept={() => onChoose(meal, { ignoreIngredients: suggestingAny })}
            onDetails={() => onDetails(meal, { ignoreIngredients: suggestingAny })}
          >
            <button
              className="flashcard-cover"
              data-card-open
              onClick={() => onDetails(meal, { ignoreIngredients: suggestingAny })}
              aria-label={`View ${meal.name} details`}
            >
              <img
                draggable={false}
                src={`/food/${photoFor(meal)}.png`}
                alt={`AI illustration representing ${meal.name}`}
              />
              <span className="cover-tag">
                <Icon name="leaf" size={14} />
                {suggestingAny ? "Meal idea" : "Cook with your groceries"}
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
                {suggestingAny && shortOn.length
                  ? `Time, diet, budget and calendar checked. You may still need ${shortOn.map((item) => item.name).join(", ")}.`
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
                  onClick={() => onDetails(meal, { ignoreIngredients: suggestingAny })}
                >
                  Recipe & nutrition
                </button>
                <button
                  className="accept-button"
                  onClick={() => onChoose(meal, { ignoreIngredients: suggestingAny })}
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
                : mode === "eatOut"
                  ? "No UW locations open at this time."
                  : "No meals fit right now."}
            </h2>
            <p>
              {passed.length
                ? "Bring back passed cards or change your mood."
                : mode === "eatOut"
                  ? "Change the meal time or include locations outside their published hours."
                  : suggestingAny
                    ? "Check the meal window, restrictions and budget."
                    : "Nothing you listed fits this window. Edit your groceries, or just suggest meals."}
            </p>
            <div className="deck-empty-actions">
              <button
                className="primary"
                onClick={() =>
                  passed.length
                    ? setPassed([])
                    : mode === "eatOut"
                      ? setOpenOnly(false)
                      : suggestingAny
                        ? onPreferences()
                        : onEditGroceries()
                }
              >
                {passed.length
                  ? "Show passed cards"
                  : mode === "eatOut"
                    ? "Show all locations"
                    : suggestingAny
                      ? "Adjust constraints"
                      : "Edit groceries"}
              </button>
              {mode === "cook" && !suggestingAny && (
                <button className="secondary" onClick={onSuggestMeals}>
                  Just suggest meals
                </button>
              )}
            </div>
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
          {mode === "cook" && (
            <button className="text-button" onClick={onEditGroceries}>
              {suggestingAny ? "Use your groceries" : "Edit groceries"}
            </button>
          )}
          <span>
            {mode === "cook"
              ? "Nutrition & costs are demo estimates"
              : "UW sources checked Oct 17 · hours can change"}
          </span>
        </div>
          </>
        )}
      </section>
      {!asking && (
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
            Cook starts with the groceries you list, then shows meals from{" "}
            {catalog.filter((m) => m.mode === "cook").length} curated recipes.
            Rules remove meals that conflict with those ingredients, your
            equipment, diet, budget, time or calendar. Just suggest meals skips
            the grocery list. Your selected priority then orders the rest.
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
      )}
      {!asking && (
      <button
        className="floating-groceries"
        onClick={mode === "cook" ? onEditGroceries : onKitchen}
      >
        <Icon name="kitchen" size={20} />
        {mode === "cook"
          ? suggestingAny
            ? "Use your groceries"
            : "Edit groceries"
          : "My groceries"}
      </button>
      )}
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
