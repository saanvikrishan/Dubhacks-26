import { useEffect, useRef, useState } from "react";
import { catalog, pantryItems } from "../data/catalog";
import { byId } from "../data/suggestions";
import { capabilities, config } from "../domain/config";
import { clockTime, evaluate, minutes, timeParts } from "../domain/engine";
import {
  dailyNutrition,
  goalStatus,
  nutrientInfo,
  portionNutrition,
} from "../domain/nutrition";
import { money, num, niceTime } from "./format";
import { today } from "../domain/state";

import { interpretFoodRequest, replyFromPatch } from "../adapters/assistant";

const flags = capabilities();
const modeName = (mode) => (mode === "cook" ? "Cook at home" : "Eat out");

function Icon({ name, size = 20 }) {
  const paths = {
    leaf: (
      <path d="M12 21V10m0 6C3 18 1 8 4 6c6 0 8 5 8 8m0-4c0-6 4-9 9-8 1 6-3 10-9 8" />
    ),
    grid: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="15" width="6" height="6" rx="1" />
        <path d="M15 15h6m-6 6h6m-6-3h6" />
      </>
    ),
    fork: <path d="M5 3v6c0 4 6 4 6 0V3M8 3v19M20 22V3c-6 4-6 12 0 12" />,
    kitchen: <path d="M5 3h14v18H5zM5 11h14M8 6v2m0 6v3M3 21h18" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6h4" />
      </>
    ),
    wallet: <path d="M20 7H4V4h14v3M4 7v13h17V7zM21 11h-6v5h6" />,
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM21 2v4m-2-2h4" />
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m4 12 5 5L20 6" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 2v6m10-6v6M3 11h18m-12 4 2 2 4-4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    edit: <path d="m15 4 5 5-11 11H4v-5zM13 6l5 5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.leaf}
    </svg>
  );
}

function MealArt({ meal }) {
  return (
    <div
      className="meal-illustration"
      role="img"
      aria-label={`Illustration of ${meal.name}`}
    >
      <svg viewBox="0 0 320 300" aria-hidden="true">
        <defs>
          <radialGradient id={`plate-${meal.id}`}>
            <stop stopColor="#fff" />
            <stop offset=".85" stopColor="#fdfbf4" />
            <stop offset="1" stopColor="#e6dfcf" />
          </radialGradient>
        </defs>
        <ellipse cx="165" cy="161" rx="120" ry="114" fill="#8c6d4330" />
        <circle cx="160" cy="147" r="121" fill={`url(#plate-${meal.id})`} />
        <circle cx="160" cy="147" r="100" fill="#dfc998" />
        {Array.from({ length: 42 }, (_, i) => (
          <ellipse
            key={i}
            cx={93 + ((i * 31) % 140)}
            cy={74 + ((i * 19) % 150)}
            rx="4"
            ry="2.5"
            fill={i % 3 ? "#f3e2af" : "#baa268"}
          />
        ))}
        {[0, 1, 2, 3, 4].map((n) => (
          <g
            key={n}
            transform={`translate(${83 + (n % 2) * 37} ${87 + n * 23}) rotate(${n * 20})`}
          >
            <path
              d="M-19 0Q-16-28 0-24Q20-26 24-3Q15 22-4 17Q-20 20-19 0"
              fill={n % 2 ? "#618343" : "#78994f"}
            />
            <path d="m-4 11 8-27" stroke="#96b16a" strokeWidth="2" />
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <g
            key={n}
            transform={`translate(${156 + (n % 2) * 37} ${105 + Math.floor(n / 2) * 39}) rotate(${n % 2 ? 16 : -11})`}
          >
            <rect
              x="-13"
              y="-13"
              width="29"
              height="27"
              rx="5"
              fill="#eace88"
              stroke="#c8aa67"
              strokeWidth="2"
            />
            <path d="m-8-8 17 2" stroke="#f8e6b3" strokeWidth="3" />
          </g>
        ))}
        {[0, 1, 2, 3].map((n) => (
          <circle
            key={n}
            cx={143 + (n % 2) * 35}
            cy={72 + Math.floor(n / 2) * 36}
            r="14"
            fill={n % 2 ? "#d9864d" : "#c76c41"}
          />
        ))}
        <path
          d="M240 35q20-30 35-25-5 25-28 27m-1-1q30-4 35 10-21 12-36-8"
          fill="#718f50"
        />
        <path d="m242 56 8-34" stroke="#456943" strokeWidth="3" />
      </svg>
      <span className="art-caption">
        A little less deciding.
        <br />
        <em>A little more living.</em>
      </span>
    </div>
  );
}
function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={onClose}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Confirm({ title, onClose, onConfirm, button, children }) {
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      {children}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose}>
          Keep as is
        </button>
        <button
          className="primary"
          onClick={() => {
            try {
              onConfirm();
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          {button}
        </button>
      </div>
    </Modal>
  );
}
function ContextFields({ value, onChange }) {
  // Helper to ensure time is in 24-hour HH:MM format
  const normalizeTime = (timeStr) => {
    if (!timeStr) return timeStr;
    // If already in HH:MM format, return as-is
    if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr;
    // If has AM/PM, convert to 24-hour
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2];
      const period = match[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
    return timeStr;
  };

  const field = (key, label, type = "number", min = 0, max = 240) => (
    <label>
      {label}
      <input
        type={type}
        value={value[key] ?? ""}
        min={min}
        max={max}
        required={key !== "service"}
        onChange={(e) => {
          let newValue = type === "number"
            ? e.target.value === "" && key === "service"
              ? null
              : Number(e.target.value)
            : e.target.value;
          
          // Normalize time values to 24-hour format
          if (type === "time" && newValue) {
            newValue = normalizeTime(newValue);
          }
          
          const updated = { ...value, [key]: newValue };
          
          // Auto-adjust available window when start or commitment time changes
          if ((key === "start" || key === "commitmentTime") && updated.start && updated.commitmentTime) {
            const normalizedStart = normalizeTime(updated.start);
            const normalizedCommitment = normalizeTime(updated.commitmentTime);
            if (normalizedStart && normalizedCommitment) {
              const startMinutes = parseInt(normalizedStart.split(':')[0]) * 60 + parseInt(normalizedStart.split(':')[1]);
              const commitmentMinutes = parseInt(normalizedCommitment.split(':')[0]) * 60 + parseInt(normalizedCommitment.split(':')[1]);
              const calculatedWindow = commitmentMinutes - startMinutes;
              if (calculatedWindow > 0) {
                updated.available = calculatedWindow;
                updated.start = normalizedStart;
                updated.commitmentTime = normalizedCommitment;
              }
            }
          }
          
          onChange(updated);
        }}
      />
    </label>
  );
  return (
    <>
      <div className="form-grid">
        {field("date", "Meal date", "date")}
        {field("start", "Meal start", "time")}
        {field("available", "Available window (minutes)", "number", 1, 1440)}
        {field("commitmentTime", "Next commitment at", "time")}
        {field("commitment", "Next commitment", "text")}
        {field("location", "Location / area", "text")}
      </div>
      <details className="allowances">
        <summary>Meal time allowances</summary>
        <p className="muted">
          Full activity includes these allowances. Travel and service are your
          assumptions, not live estimates.
        </p>
        <div className="form-grid">
          {field("eating", "Eating (min)")}
          {field("cleanup", "Cooking cleanup (min)")}
          {field("onward", "Onward travel (min)")}
          {field("buffer", "Buffer (min)")}
          {field("service", "Eat-out service (min)")}
        </div>
      </details>
    </>
  );
}
function Setup({ state, onSave, onClose, timeOnly = false }) {
  const [profile, setProfile] = useState(structuredClone(state.profile)),
    [context, setContext] = useState({ ...state.context }),
    [error, setError] = useState("");
  const toggle = (key, item) =>
    setProfile({
      ...profile,
      [key]: profile[key].includes(item)
        ? profile[key].filter((v) => v !== item)
        : [...profile[key], item],
    });
  const editGoal = (i, key, value) =>
    setProfile({
      ...profile,
      goals: profile.goals.map((g, j) =>
        j === i ? { ...g, [key]: value } : g,
      ),
    });
  return (
    <Modal
      title={timeOnly ? "Meal window" : "Food preferences"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave(
              timeOnly
                ? { type: "updateContext", context: { ...context, manuallySet: true } }
                : flags.manualSchedule.available
                  ? { type: "configure", profile, context }
                  : { type: "updateProfile", profile },
            );
            onClose();
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <p className="muted">
          {timeOnly
            ? "Update your window. Your saved meal stays until you approve a replacement."
            : "A few preferences, a little context. Sample values are editable; all catalog food remains demo data."}
        </p>
        {!timeOnly && (
          <>
            <div className="form-grid">
              <label>
                Dietary restriction
                <select
                  value={profile.diet}
                  onChange={(e) =>
                    setProfile({ ...profile, diet: e.target.value })
                  }
                >
                  <option value="anything">Anything</option>
                  <option value="vegetarian">Vegetarian</option>
                  <option value="vegan">Vegan</option>
                </select>
              </label>
              <label>
                Strict meal budget ($)
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  required
                  value={profile.budget}
                  onChange={(e) =>
                    setProfile({ ...profile, budget: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Preferred food (optional)
                <input
                  value={profile.preferred}
                  placeholder="e.g. tofu (optional)"
                  onChange={(e) =>
                    setProfile({ ...profile, preferred: e.target.value })
                  }
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={profile.cooking}
                  onChange={(e) =>
                    setProfile({ ...profile, cooking: e.target.checked })
                  }
                />
                I have cooking access
              </label>
            </div>
            <fieldset>
              <legend>Exclude these allergens</legend>
              <p className="muted">
                Unknown allergen data is excluded when a restriction is set.
                Demo labels cannot establish real allergen safety.
              </p>
              <div className="checks">
                {[
                  "soy",
                  "egg",
                  "milk",
                  "wheat",
                  "peanut",
                  "tree nut",
                  "sesame",
                  "fish",
                  "shellfish",
                ].map((item) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={profile.exclusions.includes(item)}
                      onChange={() => toggle("exclusions", item)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Available equipment</legend>
              <div className="checks">
                {["stove", "pan", "pot"].map((item) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={profile.equipment.includes(item)}
                      onChange={() => toggle("equipment", item)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {flags.manualSchedule.available && (
          <>
            <h3>Your meal window</h3>
            <ContextFields value={context} onChange={setContext} />
          </>
        )}
        {!timeOnly && flags.nutritionGoals.available && (
          <details className="allowances">
            <summary>Optional daily nutrition goals</summary>
            <p className="muted">
              Your own goals, compared with confirmed intake. No preset targets.
            </p>
            {profile.goals.map((goal, i) => (
              <div className="goal-editor" key={i}>
                <label>
                  Nutrient
                  <select
                    value={goal.nutrient}
                    onChange={(e) => editGoal(i, "nutrient", e.target.value)}
                  >
                    {Object.entries(nutrientInfo).map(
                      ([key, [label, unit]]) => (
                        <option key={key} value={key}>
                          {label} ({unit})
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Direction
                  <select
                    value={goal.mode}
                    onChange={(e) => editGoal(i, "mode", e.target.value)}
                  >
                    <option value="minimum">Minimum</option>
                    <option value="maximum">Maximum</option>
                    <option value="target_range">Target range</option>
                  </select>
                </label>
                <label>
                  Value
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    value={goal.value}
                    required
                    onChange={(e) =>
                      editGoal(i, "value", Number(e.target.value))
                    }
                  />
                </label>
                {goal.mode === "target_range" && (
                  <label>
                    Upper bound
                    <input
                      type="number"
                      min={goal.value}
                      max="100000"
                      value={goal.upper ?? ""}
                      required
                      onChange={(e) =>
                        editGoal(i, "upper", Number(e.target.value))
                      }
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setProfile({
                      ...profile,
                      goals: profile.goals.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove goal
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setProfile({
                  ...profile,
                  goals: [
                    ...profile.goals,
                    { nutrient: "protein_g", mode: "minimum", value: 0 },
                  ],
                })
              }
            >
              + Add a goal
            </button>
          </details>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="primary" type="submit">
            {timeOnly ? "Update meal options" : "Save preferences"}
            <Icon name="arrow" />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function NutritionTable({ meal, servings = 1 }) {
  const values = portionNutrition(meal, servings);
  return (
    <>
      <div className="nutrition-table">
        {config.nutrition.displayNutrients.map((key) => (
          <div key={key}>
            <span>{nutrientInfo[key][0]}</span>
            <strong>
              {num(values[key])}
              {values[key] != null ? ` ${nutrientInfo[key][1]}` : ""}
            </strong>
          </div>
        ))}
      </div>
      <p className="fine-print">
        Illustrative demo nutrition · {num(servings)} serving
        {servings === 1 ? "" : "s"} · {num(meal.portionGrams * servings)} g.{" "}
        {meal.nutrition.preparation}
      </p>
    </>
  );
}
function Details({ meal, state, onClose, onChoose, onLog }) {
  const result = evaluate(meal, state);
  return (
    <Modal title={meal.name} onClose={onClose} wide>
      <p className="muted">
        {modeName(meal.mode)} · {money(meal.cost)} estimated ·{" "}
        {meal.portionLabel} ({meal.portionGrams} g)
      </p>
      {flags.nutritionDetails.available && (
        <>
          <h3>What’s in this portion</h3>
          <NutritionTable meal={meal} />
          <details className="allowances">
            <summary>Nutrition source & basis</summary>
            <p>{meal.nutrition.source}</p>
            <p>
              ID: {meal.id} · Basis: {meal.nutrition.basis} · Fixture checked:{" "}
              {meal.nutrition.checkedAt}. No external source verifies these
              numbers.
            </p>
          </details>
        </>
      )}
      <h3>The full meal window</h3>
      <div className="time-breakdown">
        {Object.entries(timeParts(meal, state.context)).map(([key, value]) => (
          <div key={key}>
            <span>{key}</span>
            <strong>{value == null ? "Required" : `${value} min`}</strong>
          </div>
        ))}
        <div>
          <strong>Total activity</strong>
          <strong>{result.duration ?? "Unknown"} min</strong>
        </div>
      </div>
      <p className="fine-print">
        Preparation and cooking are sequential. Overlapping cooking steps are
        counted once. Travel/service are planning allowances.
      </p>
      {meal.mode === "cook" ? (
        <>
          <h3>Ingredients for one portion</h3>
          <ul className="ingredient-list">
            {meal.ingredients.map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <span>
                  {item.grams} g needed · {state.pantry[item.name] ?? 0} g on
                  hand
                </span>
              </li>
            ))}
          </ul>
          <h3>Let’s make it</h3>
          <ol className="recipe">
            {meal.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <h3>{meal.venue.name}</h3>
          <p>{meal.venue.location}</p>
          <p>
            Sample hours: {clockTime(meal.venue.opens)}–
            {clockTime(meal.venue.closes)}. Real availability unknown.
          </p>
          <p className="muted">
            This is a fictional venue. Real directions and ordering need a
            verified venue adapter.
          </p>
        </>
      )}
      <p className="fine-print">
        Allergens:{" "}
        {meal.allergens === null
          ? "Unknown"
          : meal.allergens.join(", ") || "None listed"}
        . Demo information does not verify real allergen safety.
      </p>
      {!result.feasible && (
        <div className="notice warning">{result.reasons.join(" ")}</div>
      )}
      <div className="dialog-actions">
        {result.feasible && (
          <button
            className="primary"
            onClick={() => {
              onClose();
              onChoose(meal);
            }}
          >
            Choose this meal
          </button>
        )}
        {flags.mealLogging.available && (
          <button
            className="secondary"
            onClick={() => {
              onClose();
              onLog(meal);
            }}
          >
            Log eaten
          </button>
        )}
      </div>
    </Modal>
  );
}
function Card({
  result,
  state,
  primary = false,
  selected = false,
  onChoose,
  onPass,
  onDetails,
  onLog,
  onChange,
}) {
  const meal = result.meal,
    n = portionNutrition(meal);
  return (
    <article
      className={primary ? "meal-card featured" : "meal-card alternative"}
    >
      {primary && <MealArt meal={meal} />}
      <div className="meal-content">
        <div className="card-overline">
          <span className={`pill ${selected ? "selected-pill" : ""}`}>
            <Icon
              name={selected ? "check" : meal.mode === "cook" ? "leaf" : "fork"}
              size={15}
            />
            {selected ? "Your selected meal" : modeName(meal.mode)}
          </span>
          <span className="fine-print">Demo option</span>
        </div>
        <h2>{meal.name}</h2>
        <p className="meal-description">{meal.description}</p>
        <div className="meal-facts">
          <span>
            <Icon name="clock" size={18} />
            {result.duration} min total
          </span>
          <span>
            <Icon name="wallet" size={18} />
            {money(meal.cost)} est.
          </span>
        </div>
        {flags.nutritionDetails.available && (
          <div className="macro-strip">
            <span>
              <strong>{num(n.energy_kcal)}</strong> kcal
            </span>
            <span>
              <strong>{num(n.protein_g)}</strong> g protein
            </span>
            <span>
              {meal.portionLabel} · {meal.portionGrams} g
            </span>
          </div>
        )}
        <p className="fit-reason">
          <Icon name="check" size={16} />
          {meal.mode === "cook"
            ? "Uses ingredients you have"
            : "Fits your sample meal window"}{" "}
          · {money(state.profile.budget - meal.cost)} below your cap
        </p>
        <div className="card-actions">
          {selected ? (
            <>
              <button className="primary" onClick={() => onDetails(meal)}>
                {meal.mode === "cook" ? "View recipe" : "View meal details"}
                <Icon name="arrow" size={17} />
              </button>
              {flags.mealLogging.available && (
                <button className="secondary" onClick={() => onLog(meal)}>
                  + Log eaten
                </button>
              )}
              <button className="text-button" onClick={onChange}>
                Change meal
              </button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => onChoose(meal)}>
                {state.plan ? "Choose replacement" : "Choose this meal"}
                <Icon name="arrow" size={17} />
              </button>
              <button className="secondary" onClick={() => onDetails(meal)}>
                Details
              </button>
              <button className="text-button" onClick={() => onPass(meal.id)}>
                Pass
              </button>
            </>
          )}
        </div>
        {primary && (
          <p className="card-footnote">
            {selected
              ? `Planned for ${state.plan.date}, ${niceTime(state.plan.start)}–${niceTime(clockTime(minutes(state.plan.start) + state.plan.duration))}.`
              : `Fits ${niceTime(state.context.start)}–${niceTime(clockTime(minutes(state.context.start) + result.duration))}, including buffer.`}{" "}
            Nutrition is illustrative.
          </p>
        )}
      </div>
    </article>
  );
}
function Kitchen({ state, onSave }) {
  const [pantry, setPantry] = useState({ ...state.pantry }),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <section className="panel kitchen-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR INGREDIENTS, YOUR CALL</span>
          <h2>A little kitchen check-in.</h2>
        </div>
        <Icon name="kitchen" size={30} />
      </div>
      <p className="muted">
        Confirmed edible quantities in grams. Rice and chickpeas are already
        cooked; pasta is dry. Sample pantry values are editable. Choosing a meal
        leaves inventory as entered.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({ type: "updatePantry", pantry });
            setSaved(true);
            setError("");
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <div className="pantry-grid">
          {pantryItems.map((item) => (
            <label key={item}>
              {item}
              <span className="input-unit">
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={pantry[item] ?? 0}
                  required
                  onChange={(e) => {
                    setPantry({ ...pantry, [item]: Number(e.target.value) });
                    setSaved(false);
                  }}
                />
                <span>g</span>
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="primary">
          Save ingredients
          <Icon name="check" size={17} />
        </button>
        {saved && (
          <p role="status">Ingredients saved. Meal options refreshed.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
function Intake({ state, onEdit, onRemove }) {
  const date = today(),
    summary = dailyNutrition(state.logs, byId, date),
    logs = state.logs.filter((log) => log.date === date);
  const costs = logs.filter((log) => byId[log.mealId].cost != null);
  return (
    <section className="panel intake">
      <div className="section-heading">
        <h2>Food, so far.</h2>
        <Icon name="leaf" />
      </div>
      <p className="eyebrow">CONFIRMED TODAY</p>
      {logs.length ? (
        <>
          <div className="intake-main">
            <strong>{num(summary.energy_kcal.value)}</strong>
            <span>
              kcal subtotal
              <br />
              <small>
                {summary.energy_kcal.known}/{logs.length} logs have energy
              </small>
            </span>
          </div>
          <div className="nutrition-table">
            {config.nutrition.displayNutrients
              .filter((key) => key !== "energy_kcal")
              .map((key) => (
                <div key={key}>
                  <span>{nutrientInfo[key][0]}</span>
                  <strong>
                    {num(summary[key].value)}
                    {summary[key].value != null
                      ? ` ${nutrientInfo[key][1]}`
                      : ""}
                    <small>
                      {summary[key].known}/{logs.length} covered
                    </small>
                  </strong>
                </div>
              ))}
          </div>
          <p className="fine-print">
            {logs.length} confirmed {logs.length === 1 ? "meal" : "meals"}.
            Incomplete day · illustrative nutrition. Unknown values are
            excluded, not counted as zero.
          </p>
        </>
      ) : (
        <div className="empty-intake">
          <span className="empty-icon">
            <Icon name="fork" size={28} />
          </span>
          <h3>Your next meal starts here.</h3>
          <p>
            Confirm a meal and portion after eating to see your nutrition
            subtotal.
          </p>
          <span className="fine-print">No confirmed meals today</span>
        </div>
      )}
      {flags.nutritionGoals.available &&
        state.profile.goals.map((goal, i) => (
          <div className="goal-status" key={i}>
            <strong>
              {nutrientInfo[goal.nutrient][0]} · {goal.mode.replace("_", " ")}{" "}
              {goal.value}
              {goal.mode === "target_range" ? `–${goal.upper}` : ""}{" "}
              {nutrientInfo[goal.nutrient][1]}
            </strong>
            <p>{goalStatus(summary[goal.nutrient], goal)}</p>
          </div>
        ))}
      {state.plan && flags.nutritionDetails.available && (
        <div className="planned-preview">
          <span className="eyebrow">
            PLANNED · {state.plan.date === date ? "TODAY" : state.plan.date}
          </span>
          <p>{byId[state.plan.mealId].name}</p>
          <strong>
            {num(
              portionNutrition(byId[state.plan.mealId], state.plan.servings)
                .energy_kcal,
            )}{" "}
            kcal · {money(byId[state.plan.mealId].cost)}
          </strong>
          <small>Preview only · excluded from intake</small>
        </div>
      )}
      {logs.length > 0 && (
        <div className="log-list">
          <h3>Confirmed meals</h3>
          {logs.map((log) => (
            <div className="log-item" key={log.id}>
              <span>
                {byId[log.mealId].name}
                <small>
                  {num(log.servings)} serving{log.servings === 1 ? "" : "s"}
                </small>
              </span>
              <div>
                <button className="text-button" onClick={() => onEdit(log)}>
                  Edit
                </button>
                <button className="text-button" onClick={() => onRemove(log)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <p className="fine-print">
            Confirmed cost:{" "}
            {costs.length
              ? money(
                  costs.reduce(
                    (sum, log) => sum + byId[log.mealId].cost * log.servings,
                    0,
                  ),
                )
              : "Unknown"}{" "}
            estimated · {costs.length}/{logs.length} known. Portion-based
            estimate, not a receipt.
          </p>
        </div>
      )}
    </section>
  );
}
function Assistant({ state, onAction, onClose }) {
  const [text, setText] = useState(""),
    [messages, setMessages] = useState([
      {
        message:
          "A little help with your next meal. Try “compare meals” or “I have 45 minutes”.",
      },
    ]),
    [error, setError] = useState("");
  return (
    <Modal title="Your food assistant" onClose={onClose}>
      <p className="fine-print">
        Simple local commands · AI is connected. Photon is not connected.
      </p>
      <div className="chat-messages" aria-live="polite">
        {messages.map((msg, i) => (
          <div
            className={msg.user ? "chat-bubble user" : "chat-bubble"}
            key={i}
          >
            {msg.message}
            {msg.proposal && (
              <button
                className="secondary"
                disabled={msg.applied}
                onClick={() => {
                  try {
                    onAction(msg.proposal);
                    setMessages((prev) =>
                      prev.map((m, j) =>
                        j === i ? { ...m, applied: true } : m,
                      ),
                    );
                    setError("");
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                {msg.applied ? "Applied" : "Apply this change"}
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const sent = text.trim();
          if (!sent) return;
          let response;
          try {
            response = interpretFoodRequest(sent, state, catalog);
          } catch (err) {
            setError(err.message);
            return;
          }
          if (!response.unrecognized) {
            setMessages((prev) => [
              ...prev,
              { user: true, message: sent },
              response,
            ]);
            setText("");
            setError("");
            return;
          }
          setMessages((prev) => [
            ...prev,
            { user: true, message: sent },
            { message: "Checking that…", pending: true },
          ]);
          setText("");
          setError("");
          try {
            const res = await fetch("/api/recipes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: sent, memories: [] }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const detail =
                typeof data.detail === "string"
                  ? data.detail
                  : Array.isArray(data.detail)
                    ? data.detail.map((item) => item.msg || item).join(" ")
                    : data.error || "Could not interpret that request.";
              setMessages((prev) => prev.filter((item) => !item.pending));
              setError(detail);
              return;
            }
            const reply = replyFromPatch(data, state, catalog);
            setMessages((prev) => [
              ...prev.filter((item) => !item.pending),
              reply,
            ]);
            const summary = reply.message;
            if (typeof summary === "string" && summary) {
              try {
                const phrased = await fetch("/api/recipes/phrase", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ summary }),
                  signal: AbortSignal.timeout(25000),
                });
                const phraseData = await phrased.json().catch(() => ({}));
                const text =
                  phrased.ok && typeof phraseData.text === "string"
                    ? phraseData.text.trim()
                    : "";
                if (text)
                  setMessages((prev) =>
                    prev.map((item) =>
                      item === reply ? { ...item, message: text } : item,
                    ),
                  );
              } catch {
                // Keep the templated reply already on screen.
              }
            }
          } catch (err) {
            setMessages((prev) => prev.filter((item) => !item.pending));
            setError(err.message || "Could not interpret that request.");
          }
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Food request
        </label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What would help with your meal?"
        />
        <button
          className="primary"
          type="submit"
          aria-label="Send food request"
        >
          <Icon name="arrow" />
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
function Log({ data, onClose, onSave, onLogged }) {
  const [servings, setServings] = useState(data.log?.servings ?? 1),
    [date, setDate] = useState(data.log?.date ?? today()),
    [error, setError] = useState("");
  return (
    <Modal
      title={data.log ? "Edit confirmed consumption" : "What did you eat?"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({
              type: data.log ? "editLog" : "log",
              id: data.id,
              mealId: data.meal.id,
              servings,
              date,
            });
            onLogged();
            onClose();
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <h3>{data.meal.name}</h3>
        <p className="muted">
          One serving = {data.meal.portionLabel} ({data.meal.portionGrams} g).
          Confirm the amount you actually ate.
        </p>
        <div className="form-grid">
          <label>
            Servings eaten
            <input
              type="number"
              min="0.01"
              max="10"
              step="0.01"
              value={servings}
              required
              onChange={(e) => setServings(Number(e.target.value))}
            />
          </label>
          <label>
            Date eaten
            <input
              type="date"
              value={date}
              required
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        {servings > 0 && flags.nutritionDetails.available && (
          <NutritionTable meal={data.meal} servings={servings} />
        )}
        <p className="fine-print">
          Consumption is separate from your plan. Ingredient quantities remain
          as entered.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="primary" type="submit">
            {data.log ? "Save corrected portion" : "Confirm eaten"}
            <Icon name="check" />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export {
  Icon,
  Modal,
  Confirm,
  Setup,
  Details,
  Kitchen,
  Intake,
  Assistant,
  Log,
  Card,
  MealArt,
};
