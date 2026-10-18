import { useRef, useState } from "react";
import { Icon, Modal } from "./Core";
import { money, num, photoFor } from "./format";
import { catalog, byId } from "../data/catalog";
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

export function SwipeCard({ children, onPass, onAccept, onDetails, label }) {
  const point = useRef(null),
    swiped = useRef(false),
    [dx, setDx] = useState(0);
  return (
    <article
      className="swipe-card"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onPass();
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onAccept();
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
        if (!point.current) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        if (Math.abs(x) > 12 && Math.abs(x) > Math.abs(y) * 1.2) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDx(Math.max(-160, Math.min(160, x)));
        }
      }}
      onPointerUp={(e) => {
        if (!point.current) return;
        const x = e.clientX - point.current.x,
          y = e.clientY - point.current.y;
        point.current = null;
        if (Math.abs(x) > 75 && Math.abs(x) > Math.abs(y) * 1.2) {
          swiped.current = true;
          x > 0 ? onAccept() : onPass();
        }
        setDx(0);
      }}
      onPointerCancel={() => {
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
          transform: `translateX(${dx}px) rotate(${dx / 30}deg)`,
          transition: dx ? "none" : undefined,
        }}
      >
        <div
          className={`swipe-stamp ${dx > 0 ? "accept" : "pass"}`}
          style={{ opacity: Math.min(1, Math.abs(dx) / 80) }}
        >
          {dx > 0 ? "YES" : "PASS"}
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
}) {
  const [passed, setPassed] = useState([]),
    [mood, setMood] = useState("any"),
    [sort, setSort] = useState("catalog"),
    [openOnly, setOpenOnly] = useState(true);
  const all = recommend(
    catalog,
    state,
    { mode: "cook", sort, passed },
    { ...config, recommendation: { ...config.recommendation, maxCards: 100 } },
  );
  const meals = all.cards.filter(
    (r) =>
      mood === "any" ||
      (mood === "fresh"
        ? fresh.has(r.meal.id)
        : mood === "quick"
          ? r.meal.timing.prep + r.meal.timing.cook <= 10
          : !fresh.has(r.meal.id)),
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
                <option value="fresh">Fresh & light</option>
                <option value="comfort">Comforting</option>
                <option value="quick">Quick & simple</option>
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
                <option value="time">More time left</option>
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
              ? `${meals.length} meals fit your constraints`
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
                Cook with your groceries
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
                Ingredients, equipment, budget and calendar checked
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
                : mode === "eatOut"
                  ? "No UW locations open at this time."
                  : "No meals fit right now."}
            </h2>
            <p>
              {passed.length
                ? "Bring back passed cards or change your mood."
                : mode === "eatOut"
                  ? "Change the meal time or include locations outside their published hours."
                  : "Check the meal window, groceries, restrictions and budget."}
            </p>
            <button
              className="primary"
              onClick={() =>
                passed.length
                  ? setPassed([])
                  : mode === "eatOut"
                    ? setOpenOnly(false)
                    : onPreferences()
              }
            >
              {passed.length
                ? "Show passed cards"
                : mode === "eatOut"
                  ? "Show all locations"
                  : "Adjust constraints"}
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
          <span>
            {mode === "cook"
              ? "Nutrition & costs are demo estimates"
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
