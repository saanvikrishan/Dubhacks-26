import { useEffect, useRef, useState } from "react";
import { catalog } from "../data/catalog";
import { byId } from "../data/suggestions";
import { capabilities, config } from "../domain/config";
import { clockTime, evaluate, minutes, timeParts } from "../domain/engine";
import {
  assessGroceryNutrition,
  dailyNutrition,
  estimateGrams,
  goalStatus,
  nutrientInfo,
  portionNutrition,
  usdaConfidenceExplain,
} from "../domain/nutrition";
import {
  mealSubstitutions,
  pantryCovers,
  substitutionLine,
} from "../domain/substitutions";
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
    cart: (
      <path d="M3 4h2l2.4 11h10.2l2-7H7M9 20a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 9 20m8 0a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 17 20" />
    ),
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
function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = "",
  leading = null,
  subtitle = "",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  const label = typeof title === "string" ? title : "Dialog";
  return (
    <dialog
      ref={ref}
      className={[wide ? "wide" : "", className].filter(Boolean).join(" ")}
      onCancel={onClose}
      aria-label={label}
    >
      <div className="dialog-header">
        <div className="dialog-heading">
          {leading}
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="dialog-subtitle">{subtitle}</p> : null}
          </div>
        </div>
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
            if (timeOnly) {
              await onSave({
                type: "updateContext",
                context: { ...context, manuallySet: true },
              });
              onClose();
              return;
            }
            const phone = (profile.phone || "").trim();
            const previous = (state.profile.phone || "").trim();
            if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
              setError(
                "Use international format, starting with + and the country code.",
              );
              return;
            }
            let nextProfile = { ...profile, phone };
            if (phone && phone !== previous) {
              const response = await fetch("/api/enroll-phone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: "demo", phone }),
              });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) {
                const detail =
                  typeof data.detail === "string"
                    ? data.detail
                    : "Could not activate reminders for that number.";
                throw new Error(detail);
              }
              const sender =
                typeof data.sender === "string" ? data.sender.trim() : "";
              if (sender) nextProfile = { ...nextProfile, reminderFrom: sender };
            }
            await onSave(
              flags.manualSchedule.available
                ? { type: "configure", profile: nextProfile, context }
                : { type: "updateProfile", profile: nextProfile },
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
              <label>
                Reminder phone
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1XXXXXXXXXX"
                  value={profile.phone || ""}
                  onChange={(e) =>
                    setProfile({ ...profile, phone: e.target.value })
                  }
                />
              </label>
            </div>
            <p className="muted">
              {(profile.reminderFrom || "").trim()
                ? `Text ${profile.reminderFrom.trim()} once to activate reminders.`
                : "Use international format, like +1XXXXXXXXXX. Saving a number enrolls it for iMessage reminders."}
            </p>
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
                {[
                  "stove", "pan", "pot",
                  "microwave", "oven", "air fryer", "rice cooker",
                  "toaster", "blender", "electric kettle",
                  "baking sheet", "cutting board", "knife",
                  "mixing bowl", "spatula", "colander",
                  "slow cooker",
                ].map((item) => (
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
                    <optgroup label="Macronutrients &amp; Energy">
                      {["energy_kcal","protein_g","carbohydrate_g","fiber_g","sugar_g","added_sugar_g"].map((key) => (
                        <option key={key} value={key}>{nutrientInfo[key][0]} ({nutrientInfo[key][1]})</option>
                      ))}
                    </optgroup>
                    <optgroup label="Lipids (Fats)">
                      {["fat_g","saturated_fat_g","trans_fat_g","mono_fat_g","poly_fat_g","cholesterol_mg"].map((key) => (
                        <option key={key} value={key}>{nutrientInfo[key][0]} ({nutrientInfo[key][1]})</option>
                      ))}
                    </optgroup>
                    <optgroup label="Vitamins">
                      {["vitamin_a_mcg","vitamin_c_mg","vitamin_d_mcg","vitamin_e_mg","vitamin_k_mcg","thiamin_mg","riboflavin_mg","niacin_mg","pantothenic_mg","vitamin_b6_mg","folate_mcg","vitamin_b12_mcg","choline_mg"].map((key) => (
                        <option key={key} value={key}>{nutrientInfo[key][0]} ({nutrientInfo[key][1]})</option>
                      ))}
                    </optgroup>
                    <optgroup label="Minerals">
                      {["calcium_mg","iron_mg","magnesium_mg","phosphorus_mg","potassium_mg","sodium_mg","zinc_mg","copper_mg","manganese_mg","selenium_mcg"].map((key) => (
                        <option key={key} value={key}>{nutrientInfo[key][0]} ({nutrientInfo[key][1]})</option>
                      ))}
                    </optgroup>
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
        {meal.nutrition?.kind === "usda_estimated"
          ? `USDA FoodData Central estimate${meal.nutrition.confidence ? ` · ${meal.nutrition.confidence} confidence` : ""}`
          : meal.nutrition?.kind === "gemini_suggestion"
            ? "Gemini estimate · not verified"
            : "Illustrative demo nutrition"}{" "}
        · {num(servings)} serving
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
          <details className="allowances" open={meal.nutrition?.kind === "usda_estimated"}>
            <summary>Nutrition source & basis</summary>
            <p>{meal.nutrition.source}</p>
            {meal.nutrition?.kind === "usda_estimated" ? (
              <>
                <p>
                  <strong>
                    {(meal.nutrition.confidence || "medium").replace(/^./, (c) =>
                      c.toUpperCase(),
                    )}{" "}
                    confidence:
                  </strong>{" "}
                  {usdaConfidenceExplain(meal.nutrition)}
                </p>
                <p>
                  High ≈ most ingredients matched · Medium ≈ about half · Low ≈
                  only a few. Unmatched ingredients are left out of the totals.
                  Macros are summed from USDA matches and scaled per serving.
                </p>
              </>
            ) : (
              <p>
                ID: {meal.id} · Basis: {meal.nutrition.basis} · Checked:{" "}
                {meal.nutrition.checkedAt}. No external source verifies these
                numbers.
              </p>
            )}
          </details>
        </>
      )}
      <h3>Time</h3>
      <div className="time-breakdown">
        {Object.entries(timeParts(meal, state.context)).map(([key, value]) => (
          <div key={key}>
            <span>{key}</span>
            <strong>{value == null ? "Required" : `${value} min`}</strong>
          </div>
        ))}
        {meal.mode === "cook" && (
          <div>
            <strong>Total</strong>
            <strong>
              {result.duration ?? "Unknown"} min
            </strong>
          </div>
        )}
      </div>
      <p className="fine-print">
        {meal.mode === "cook"
          ? "Prep and cook are sequential. Overlapping cooking steps are counted once."
          : "Travel and service are planning allowances, not live estimates."}
      </p>
      {meal.mode === "cook" ? (
        <>
          <h3>Ingredients for one portion</h3>
          <ul className="ingredient-list">
            {meal.ingredients.map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <span>
                  {item.grams} g needed ·{" "}
                  {pantryCovers(item.name, state.pantry)
                    ? "on hand"
                    : `${state.pantry[item.name] ?? 0} g on hand`}
                </span>
              </li>
            ))}
          </ul>
          {mealSubstitutions(meal, state.pantry).length > 0 && (
            <>
              <h3>Alternatives for what you don’t have</h3>
              <ul className="substitution-list">
                {mealSubstitutions(meal, state.pantry).map((s) => (
                  <li key={`${s.missing}-${s.useInstead || "omit"}`}>
                    <strong>{substitutionLine(s)}</strong>
                    {s.note ? <span className="muted"> — {s.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
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
      <div className="dialog-actions">
        <button
          className="primary"
          onClick={() => {
            onClose();
            onChoose(meal);
          }}
        >
            Choose this meal
          </button>
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
            {meal.mode === "cook"
              ? `${meal.timing.prep + meal.timing.cook} min · prep + cook`
              : `${result.duration} min`}
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
              : `Fits ${niceTime(state.context.start)}–${niceTime(clockTime(minutes(state.context.start) + result.duration))}.`}{" "}
            Nutrition is illustrative.
          </p>
        )}
      </div>
    </article>
  );
}
function pantryEntries(pantry) {
  return Object.entries(pantry || {})
    .filter(([, grams]) => Number(grams) > 0)
    .map(([name, grams]) => ({ name, grams: Number(grams) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function Kitchen({ state, onSave }) {
  const [items, setItems] = useState(() => pantryEntries(state.pantry)),
    [draft, setDraft] = useState(""),
    [grams, setGrams] = useState("500"),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);

  function addItem() {
    const name = draft.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) return;
    const amount = Number(grams);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      setError("Enter a quantity above 0 g and up to 100000 g.");
      return;
    }
    const key = name.toLowerCase();
    setItems((list) => {
      const existing = list.find((item) => item.name.toLowerCase() === key);
      if (existing)
        return list.map((item) =>
          item.name.toLowerCase() === key
            ? { ...item, grams: Math.max(item.grams, amount) }
            : item,
        );
      return [...list, { name, grams: amount }].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    });
    setDraft("");
    setGrams("500");
    setError("");
    setSaved(false);
  }

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
        Add what you actually have. Quantities are in grams—rice and chickpeas
        as cooked, pasta as dry. Choosing a meal leaves inventory as entered.
      </p>
      <form
        className="kitchen-add"
        onSubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
      >
        <label>
          Ingredient
          <input
            type="text"
            value={draft}
            placeholder="e.g. spinach, chicken, tortillas"
            aria-label="Ingredient name"
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          Amount
          <span className="input-unit">
            <input
              type="number"
              min="1"
              max="100000"
              step="1"
              value={grams}
              aria-label="Amount in grams"
              onChange={(e) => {
                setGrams(e.target.value);
                setError("");
              }}
            />
            <span>g</span>
          </span>
        </label>
        <button type="submit" className="secondary" disabled={!draft.trim()}>
          Add
        </button>
      </form>
      <div className="kitchen-list" role="list" aria-label="Groceries on hand">
        {items.map((item) => (
          <div className="kitchen-row" role="listitem" key={item.name}>
            <span className="kitchen-name">{item.name}</span>
            <span className="input-unit">
              <input
                type="number"
                min="1"
                max="100000"
                step="1"
                value={item.grams}
                aria-label={`${item.name} grams`}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setItems((list) =>
                    list.map((row) =>
                      row.name === item.name
                        ? { ...row, grams: Number.isFinite(next) ? next : 0 }
                        : row,
                    ),
                  );
                  setSaved(false);
                }}
              />
              <span>g</span>
            </span>
            <button
              type="button"
              className="text-button"
              aria-label={`Remove ${item.name}`}
              onClick={() => {
                setItems((list) => list.filter((row) => row.name !== item.name));
                setSaved(false);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!items.length && (
          <p className="kitchen-empty">
            Nothing listed yet—type an ingredient above to start.
          </p>
        )}
      </div>
      <button
        type="button"
        className="primary"
        onClick={async () => {
          const pantry = Object.fromEntries(
            items
              .filter((item) => item.name && item.grams > 0)
              .map((item) => [item.name, item.grams]),
          );
          try {
            await onSave({ type: "updatePantry", pantry });
            setSaved(true);
            setError("");
          } catch (err) {
            setError(err.message);
          }
        }}
      >
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
    </section>
  );
}
function Intake({ state, onEdit, onRemove }) {
  const date = today(),
    summary = dailyNutrition(state.logs, byId, date),
    logs = state.logs.filter((log) => log.date === date && byId[log.mealId]);
  const costs = logs.filter((log) => byId[log.mealId]?.cost != null);
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
      {state.plan &&
        byId[state.plan.mealId] &&
        flags.nutritionDetails.available && (
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
                {byId[log.mealId]?.name ?? "Meal"}
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
                    (sum, log) =>
                      sum + (byId[log.mealId]?.cost ?? 0) * log.servings,
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
const ASSISTANT_PROMPTS = [
  "Compare meals for me",
  "I have 45 minutes",
  "What’s easy with my groceries?",
  "Something lighter tonight",
];

function Assistant({ state, onAction, onClose }) {
  const [text, setText] = useState(""),
    [messages, setMessages] = useState([
      {
        message:
          "Hi — I’m your food copilot. Ask in plain language, or tap a prompt below to start.",
      },
    ]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function sendPrompt(raw) {
    const sent = raw.trim();
    if (!sent || busy) return;

    // 1. Try local command interpreter first
    let response;
    try {
      response = interpretFoodRequest(sent, state, catalog);
    } catch (err) {
      setError(err.message);
      return;
    }
    if (!response.unrecognized) {
      setMessages((prev) => [...prev, { user: true, message: sent }, response]);
      setText("");
      setError("");
      return;
    }

    // 2. Detect preference/taste statements — route to profile-patch
    // 2. Detect preference statements by scanning for known profile keywords
    const DIETS     = ["vegan", "vegetarian"];
    const ALLERGENS = ["soy","egg","milk","wheat","peanut","tree nut","sesame","fish","shellfish"];
    const EQUIPMENT = ["microwave","oven","air fryer","rice cooker","toaster","blender",
      "electric kettle","baking sheet","cutting board","knife","mixing bowl","spatula",
      "colander","slow cooker","stove","pan","pot"];
    const CUISINES  = ["italian","mexican","chinese","japanese","indian","thai","korean",
      "mediterranean","american","french","greek","spanish","middle eastern",
      "vietnamese","caribbean","latin american"];

    const q = sent.toLowerCase();

    const hitsDiet      = DIETS.some(d => q.includes(d));
    const hitsAllergen  = ALLERGENS.some(a => q.includes(a));
    const hitsEquipment = EQUIPMENT.some(e => q.includes(e));
    const hitsCuisine   = CUISINES.some(c => q.includes(c));
    const hitsCooking   = /\b(kitchen|cooking access)\b/.test(q);

    if (hitsDiet || hitsAllergen || hitsEquipment || hitsCuisine || hitsCooking) {
      const patch = {};

      const negative = /\b(hate|avoid|don.?t eat|can.?t eat|allergic|intolerant|no |not |without|don.?t have|can.?t have|don.?t like|dislike)\b/.test(q);
      const positive = !negative;

      // Diet
      if (q.includes("vegan"))         patch.diet = "vegan";
      else if (q.includes("vegetarian")) patch.diet = "vegetarian";
      else if (/\bi eat (meat|everything|anything|all)\b/.test(q)) patch.diet = "anything";

      // Cooking access
      if (/\bno (kitchen|stove|oven|cooking)\b|\bcan.?t cook\b/.test(q)) patch.cooking = false;
      else if (/\b(have|got).{0,10}kitchen\b|\bcan cook\b/.test(q))       patch.cooking = true;

      // Allergens — negative = add exclusion, positive = remove exclusion
      if (negative) {
        const add = ALLERGENS.filter(a => q.includes(a));
        if (add.length) patch.exclusions_add = add;
      } else {
        const remove = ALLERGENS.filter(a => q.includes(a));
        if (remove.length) patch.exclusions_remove = remove;
      }

      // Equipment — positive = add, negative = remove
      if (positive) {
        const add = EQUIPMENT.filter(e => q.includes(e));
        if (add.length) patch.equipment_add = add;
      } else {
        const remove = EQUIPMENT.filter(e => q.includes(e));
        if (remove.length) patch.equipment_remove = remove;
      }

      // Cuisines — positive = add to liked, negative = remove
      if (positive) {
        const add = CUISINES.filter(c => q.includes(c));
        if (add.length) {
          patch.cuisines_add = add.map(c => c.charAt(0).toUpperCase() + c.slice(1));
          if (!patch.preferred) patch.preferred = add[0] + " food";
        }
      } else {
        const remove = CUISINES.filter(c => q.includes(c));
        if (remove.length)
          patch.cuisines_remove = remove.map(c => c.charAt(0).toUpperCase() + c.slice(1));
      }

      if (Object.keys(patch).length > 0) {
        const newProfile = { ...state.profile };
        if (patch.diet)       newProfile.diet = patch.diet;
        if (patch.preferred)  newProfile.preferred = patch.preferred;
        if (patch.cooking != null) newProfile.cooking = patch.cooking;
        if (patch.exclusions_add?.length)
          newProfile.exclusions = [...new Set([...newProfile.exclusions, ...patch.exclusions_add])];
        if (patch.exclusions_remove?.length)
          newProfile.exclusions = newProfile.exclusions.filter(e => !patch.exclusions_remove.includes(e));
        if (patch.equipment_add?.length)
          newProfile.equipment = [...new Set([...newProfile.equipment, ...patch.equipment_add])];
        if (patch.equipment_remove?.length)
          newProfile.equipment = newProfile.equipment.filter(e => !patch.equipment_remove.includes(e));
        if (patch.cuisines_add?.length)
          newProfile.cuisines = [...new Set([...(newProfile.cuisines ?? []), ...patch.cuisines_add])];
        if (patch.cuisines_remove?.length)
          newProfile.cuisines = (newProfile.cuisines ?? []).filter(c => !patch.cuisines_remove.includes(c));

        const changes = [];
        if (patch.diet) changes.push(`set diet to ${patch.diet}`);
        if (patch.cooking != null) changes.push(patch.cooking ? "turn cooking on" : "turn cooking off");
        if (patch.exclusions_add?.length)    changes.push(`exclude ${patch.exclusions_add.join(", ")}`);
        if (patch.exclusions_remove?.length) changes.push(`stop excluding ${patch.exclusions_remove.join(", ")}`);
        if (patch.equipment_add?.length)     changes.push(`add ${patch.equipment_add.join(", ")} to your equipment`);
        if (patch.equipment_remove?.length)  changes.push(`remove ${patch.equipment_remove.join(", ")} from equipment`);
        if (patch.cuisines_add?.length)      changes.push(`add ${patch.cuisines_add.join(", ")} to liked cuisines`);
        if (patch.preferred) changes.push(`set preferred food to "${patch.preferred}"`);

        setMessages((prev) => [
          ...prev,
          { user: true, message: sent },
          {
            message: `Got it — I'd ${changes.join(", ")}. Want me to save that?`,
            proposal: { type: "updateProfile", profile: newProfile },
          },
        ]);
        setText("");
        return;
      }
      // Keywords hit but nothing actionable — fall through to Gemini
    }

    // 3. Fall through to Gemini meal interpreter
    const history = messages
      .filter(
        (item) =>
          !item.pending &&
          typeof item.message === "string" &&
          item.message.trim(),
      )
      .slice(-4)
      .map((item) => ({
        role: item.user ? "user" : "assistant",
        text: item.message.slice(0, 500),
      }));
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { user: true, message: sent },
      { message: "Thinking…", pending: true },
    ]);
    setText("");
    setError("");
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sent, memories: [], history }),
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
      if (data.intent === "conversation") {
        const message =
          typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "Tell me what you're looking for — ingredients, time, or budget — and I'll find something.";
        setMessages((prev) => [
          ...prev.filter((item) => !item.pending),
          { message },
        ]);
        return;
      }
      const reply = replyFromPatch(data, state, catalog);
      setMessages((prev) => [...prev.filter((item) => !item.pending), reply]);
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
          const phrasedText =
            phrased.ok && typeof phraseData.text === "string"
              ? phraseData.text.trim()
              : "";
          if (phrasedText)
            setMessages((prev) =>
              prev.map((item) =>
                item === reply ? { ...item, message: phrasedText } : item,
              ),
            );
        } catch {
          // Keep the templated reply already on screen.
        }
      }
    } catch (err) {
      setMessages((prev) => prev.filter((item) => !item.pending));
      setError(err.message || "Could not interpret that request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="WhatsCooking.ai"
      subtitle="Food copilot · live"
      className="assistant-dialog"
      onClose={onClose}
      leading={
        <span className="assistant-orb" aria-hidden="true">
          <Icon name="spark" size={18} />
        </span>
      }
    >
      <div className="assistant-status">
        <span className="assistant-pulse" aria-hidden="true" />
        <span>Listening for meal help</span>
      </div>
      <div className="chat-messages" aria-live="polite" ref={listRef}>
        {messages.map((msg, i) => (
          <div
            className={
              msg.user
                ? "chat-row user"
                : msg.pending
                  ? "chat-row pending"
                  : "chat-row"
            }
            key={i}
          >
            {!msg.user && (
              <span className="chat-avatar" aria-hidden="true">
                <Icon name="spark" size={14} />
              </span>
            )}
            <div className={msg.user ? "chat-bubble user" : "chat-bubble"}>
              {msg.pending ? (
                <span className="chat-typing" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                msg.message
              )}
              {msg.proposal && (
                <div className="assistant-proposal">
                  <button
                    className="assistant-apply-link"
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
                    {msg.applied ? "✓ Done" : "Yes, update my profile →"}
                  </button>
                  {!msg.applied && (
                    <button
                      className="assistant-dismiss-link"
                      onClick={() =>
                        setMessages((prev) =>
                          prev.map((m, j) =>
                            j === i ? { ...m, proposal: null } : m,
                          ),
                        )
                      }
                    >
                      No thanks
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {messages.length < 3 && (
        <div className="assistant-prompts" role="group" aria-label="Try asking">
          {ASSISTANT_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="assistant-chip"
              disabled={busy}
              onClick={() => sendPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      <form
        className="chat-form assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendPrompt(text);
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Ask WhatsCooking.ai
        </label>
        <input
          id="chat-input"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask anything about meals…"
          autoComplete="off"
        />
        <button
          className="primary assistant-send"
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
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
            onLogged(data.meal);
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

function UsedUpDialog({ meal, ingredients, onDone, onClose }) {
  const [checked, setChecked] = useState(new Set());
  function toggle(key) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  return (
    <Modal title="Did you use anything up?" onClose={onClose}>
      <p className="muted">
        You just made <strong>{meal.name}</strong>. Tap any ingredient you ran
        out of so we can remove it from your pantry.
      </p>
      <div className="used-up-list">
        {ingredients.map(({ display }) => (
          <label key={display} className="used-up-item">
            <input
              type="checkbox"
              checked={checked.has(display)}
              onChange={() => toggle(display)}
            />
            <span>{display}</span>
          </label>
        ))}
      </div>
      <p className="fine-print">
        Leave everything unchecked if you still have leftovers.
      </p>
      <div className="dialog-actions">
        <button
          className="primary"
          onClick={() => onDone([...checked])}
        >
          {checked.size ? `Remove ${checked.size} item${checked.size > 1 ? "s" : ""}` : "Nothing ran out"}
          <Icon name="check" />
        </button>
        <button className="secondary" onClick={onClose}>
          Skip
        </button>
      </div>
    </Modal>
  );
}

async function analyzeGroceryOnBackend(items) {
  const payload = {
    items: items.map((item) => ({
      name: item.name,
      qty: item.qty || "",
      grams: estimateGrams(item.qty),
    })),
  };
  const urls = [
    "/api/nutrition/analyze-list",
    "http://127.0.0.1:8000/nutrition/analyze-list",
  ];
  let lastError = "Could not reach nutrition API.";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        lastError =
          "Nutrition API did not return JSON — restart the Vite app so /api proxies to port 8000.";
        continue;
      }
      if (!res.ok) {
        lastError =
          data?.detail ||
          (res.status === 503
            ? "USDA_API_KEY is missing from fridgemate/.env"
            : `Lookup failed (${res.status})`);
        continue;
      }
      return data;
    } catch (err) {
      lastError = err.message || "Could not reach nutrition API on port 8000.";
    }
  }
  throw new Error(lastError);
}

function GroceryListView({ items = [], onChange }) {
  const [draft, setDraft] = useState("");
  const [qty, setQty] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const list = Array.isArray(items) ? items : [];
  const remaining = list.filter((item) => !item.checked).length;
  const checkedCount = list.length - remaining;

  function persist(next) {
    onChange(next);
    setAnalysis(null);
    setAnalysisError("");
  }

  function addItem(e) {
    e?.preventDefault?.();
    const name = draft.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!name) return;
    const key = name.toLowerCase();
    const existing = list.find((item) => item.name.toLowerCase() === key);
    if (existing) {
      persist(
        list.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                qty: qty.trim() || item.qty,
                checked: false,
              }
            : item,
        ),
      );
    } else {
      persist([
        ...list,
        {
          id: crypto.randomUUID(),
          name,
          qty: qty.trim().slice(0, 40),
          checked: false,
        },
      ]);
    }
    setDraft("");
    setQty("");
  }

  async function analyzeList() {
    if (!list.length || analyzing) return;
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysis(null);
    try {
      const data = await analyzeGroceryOnBackend(list);
      const totals = {
        energy_kcal: 0,
        protein_g: 0,
        fiber_g: 0,
        carbohydrate_g: 0,
        fat_g: 0,
        sodium_mg: 0,
        ...(data.totals || {}),
      };
      const matched = Array.isArray(data.matched) ? data.matched : [];
      const unmatched = (Array.isArray(data.unmatched) ? data.unmatched : []).map(
        (row) => (typeof row === "string" ? row : row.name),
      );
      if (!matched.length) {
        setAnalysisError(
          unmatched.length
            ? `USDA couldn’t match: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}. Try simpler names like “spinach” or “eggs”.`
            : "No items to analyze.",
        );
      }
      const report = assessGroceryNutrition(
        totals,
        list.map((item) => item.name),
      );
      setAnalysis({
        ...report,
        matched,
        unmatched,
        totals,
        usedUsda: matched.length > 0,
      });
    } catch (err) {
      setAnalysisError(err.message || "Could not analyze this list.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="grocery-list-page reveal" aria-label="Grocery list">
      <div className="grocery-list-hero">
        <div>
          <p className="eyebrow">SHOPPING</p>
          <h2>Build your grocery list</h2>
          <p className="subtle">
            Add what you need to pick up. When you’re done, check whether the
            list covers general daily nutrient needs.
          </p>
        </div>
        <div className="grocery-list-stats" aria-live="polite">
          <strong>{remaining}</strong>
          <span>{remaining === 1 ? "item left" : "items left"}</span>
        </div>
      </div>

      <form className="grocery-list-add" onSubmit={addItem}>
        <label>
          Item
          <input
            type="text"
            value={draft}
            placeholder="e.g. spinach, oat milk, tortillas"
            aria-label="Grocery item name"
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <label>
          Amount
          <input
            type="text"
            value={qty}
            placeholder="optional · 200g, 2…"
            aria-label="Amount or note"
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={!draft.trim()}>
          Add to list
        </button>
      </form>

      <div className="grocery-list-toolbar">
        <span>
          {list.length
            ? `${list.length} on list${checkedCount ? ` · ${checkedCount} checked` : ""}`
            : "Empty list"}
        </span>
        <div>
          {checkedCount > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => persist(list.filter((item) => !item.checked))}
            >
              Clear checked
            </button>
          )}
          {list.length > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => persist([])}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="grocery-list-board" role="list" aria-label="Your grocery list">
        {list.length ? (
          list.map((item) => (
            <div
              className={`grocery-list-row${item.checked ? " is-checked" : ""}`}
              role="listitem"
              key={item.id}
            >
              <button
                type="button"
                className="grocery-check"
                aria-pressed={item.checked}
                aria-label={
                  item.checked
                    ? `Mark ${item.name} as still needed`
                    : `Check off ${item.name}`
                }
                onClick={() =>
                  persist(
                    list.map((row) =>
                      row.id === item.id
                        ? { ...row, checked: !row.checked }
                        : row,
                    ),
                  )
                }
              >
                {item.checked ? <Icon name="check" size={16} /> : null}
              </button>
              <div className="grocery-list-copy">
                <strong>{item.name}</strong>
                {item.qty ? <small>{item.qty}</small> : null}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.name}`}
                onClick={() =>
                  persist(list.filter((row) => row.id !== item.id))
                }
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          ))
        ) : (
          <div className="grocery-list-empty">
            <Icon name="cart" size={28} />
            <p>Nothing on the list yet.</p>
            <small>Type an item above to start your run.</small>
          </div>
        )}
      </div>

      {list.length > 0 && (
        <div className="grocery-analyze-bar">
          <button
            type="button"
            className="primary"
            disabled={analyzing}
            onClick={analyzeList}
          >
            {analyzing ? "Analyzing…" : "Done — check nutrients"}
          </button>
          <p className="fine-print">
            Uses USDA FoodData Central when available, plus food-group coverage.
            Amounts default to ~150 g per item unless you enter grams.
          </p>
        </div>
      )}

      {analysisError && (
        <div className="notice warning" role="alert">
          {analysisError}
        </div>
      )}

      {analysis && (
        <section className="grocery-analysis" aria-live="polite">
          <div className="grocery-analysis-head">
            <div>
              <p className="eyebrow">NUTRIENT CHECK</p>
              <h3>{analysis.score}% coverage vs general daily needs</h3>
              <p>{analysis.summary}</p>
            </div>
          </div>
          <div className="grocery-nutrient-grid">
            {analysis.nutrients.map((n) => (
              <div
                key={n.key}
                className={`grocery-nutrient-card status-${n.status}`}
              >
                <span>{n.label}</span>
                <strong>
                  {Math.round(n.value)}
                  {n.unit}
                </strong>
                <small>
                  {n.pct}% of ~{n.target}
                  {n.unit}/day · {n.detail}
                </small>
              </div>
            ))}
          </div>
          <div className="grocery-group-grid">
            {analysis.groups.map((g) => (
              <div
                key={g.id}
                className={`grocery-group-chip${g.met ? " is-met" : ""}`}
              >
                <strong>{g.met ? "Covered" : "Missing"}</strong>
                <span>{g.label}</span>
                <small>{g.met ? g.examples.join(", ") : g.tip}</small>
              </div>
            ))}
          </div>
          {(analysis.unmatched?.length > 0 || analysis.matched?.length > 0) && (
            <p className="fine-print">
              {analysis.usedUsda
                ? `USDA matched ${analysis.matched.length} item${analysis.matched.length === 1 ? "" : "s"}.`
                : "USDA macros unavailable — food-group check still applied."}
              {analysis.unmatched?.length
                ? ` Couldn’t match: ${analysis.unmatched.slice(0, 6).join(", ")}${analysis.unmatched.length > 6 ? "…" : ""}.`
                : ""}
            </p>
          )}
        </section>
      )}
    </section>
  );
}

export {
  Icon,
  Modal,
  Confirm,
  Setup,
  Details,
  Kitchen,
  GroceryListView,
  Intake,
  Assistant,
  Log,
  Card,
  MealArt,
  UsedUpDialog,
};
