import {CUISINES,GOALS,TASTES,withGoal} from "../domain/preferences.js";
import {MealWindowPicker} from "./MealWindowPicker.jsx";
import {contextForWindow} from "../domain/mealWindow.js";
import { knownPresentAllergens, hasAllergenAbsenceCoverage } from "../domain/allergens.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EQUIPMENT } from "../domain/generatedMeals";
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
  portionNutrition, nutritionDisplayRows,
} from "../domain/nutrition";
import {
  mealSubstitutions,
  pantryCovers,
  substitutionLine,
} from "../domain/substitutions";
import { money, num, niceTime } from "./format";
import { today } from "../domain/state";

import { interpretFoodRequest, replyFromPatch } from "../adapters/assistant";
import { askAgent, planTurn, restoreNote, writeNote } from "../adapters/agent";
import { listen, speakReply, stopSpeaking, transcribe, voiceHints, voiceSupported } from "../adapters/voice";

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
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
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
function ContextFields({ value, onChange, state }) {
  const end = value.available === "" ? value.commitmentTime : clockTime(Math.min(1439, minutes(value.start) + Number(value.available)));
  const range = (date, start, finish) => {
    try { onChange(contextForWindow(value, date, start, finish)); }
    catch { onChange({...value,date,start,available:"",commitmentTime:finish}); }
  };
  const number = (key,label,min=0,max=240) => <label>{label}<input type="number" min={min} max={max} required={key!=="service"} value={value[key]??""} onChange={e=>onChange({...value,[key]:e.target.value===""?(key==="service"?null:""):Number(e.target.value)})}/></label>;
  return <>
    <div className="form-grid">
      <label>Meal date<input type="date" required value={value.date} onChange={e=>onChange({...value,date:e.target.value})}/></label>
      <label>Starts<input type="time" required value={value.start} onChange={e=>{const duration=Number(value.available)||60;range(value.date,e.target.value,clockTime(Math.min(1439,minutes(e.target.value)+duration)));}}/></label>
      <label>Ends<input type="time" required value={end==="Unknown"?value.commitmentTime:end} onChange={e=>range(value.date,value.start,e.target.value)}/></label>
      {number("available","Duration (minutes)",1,1440)}
    </div>
    <MealWindowPicker state={state} value={value} onChange={onChange}/>
    <details className="allowances"><summary>Location & next commitment</summary><div className="form-grid"><label>Location / area<input value={value.location??""} onChange={e=>onChange({...value,location:e.target.value})}/></label><label>Next commitment<input value={value.commitment??""} onChange={e=>onChange({...value,commitment:e.target.value})}/></label><label>Next commitment at<input type="time" required value={value.commitmentTime} onChange={e=>onChange({...value,commitmentTime:e.target.value})}/></label></div></details>
    <details className="allowances"><summary>Meal time allowances</summary><div className="form-grid">{number("eating","Eating (min)")}{number("cleanup","Cleanup (min)")}{number("onward","Onward travel (min)")}{number("buffer","Buffer (min)")}{number("service","Dining service (min)")}</div></details>
  </>;
}
function Setup({ state, onSave, onClose, timeOnly = false }) {
  const [profile, setProfile] = useState(structuredClone(state.profile)),
    [context, setContext] = useState({ ...state.context }),
    [error, setError] = useState("");
  const toggle = (key, item) =>
    setProfile({
      ...profile,
      [key]: (profile[key]??[]).includes(item)
        ? profile[key].filter((v) => v !== item)
        : [...(profile[key]??[]), item],
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
            ? "Choose today, tomorrow or any date. Drag a meal period; your saved meals stay in place."
            : "Choose what you enjoy. Recipe amounts describe one serving; grocery purchase weight is optional for nutrition."}
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
                Main goal
                <select
                  value={profile.goal ?? ""}
                  onChange={(e) => setProfile(withGoal(profile, e.target.value))}
                >
                  <option value="">No particular goal</option>
                  {Object.entries(GOALS).map(([key, goal]) => <option key={key} value={key}>{goal.label}</option>)}
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
              <label>Foods you dislike (optional)<input maxLength={160} value={profile.dislikes??''} placeholder="e.g. mushrooms, olives" onChange={e=>setProfile({...profile,dislikes:e.target.value})}/></label>
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
            <fieldset><legend>Favorite cuisines</legend><div className="checks">{CUISINES.map(value=><label key={value}><input type="checkbox" checked={(profile.cuisines??[]).includes(value)} onChange={()=>toggle('cuisines',value)}/>{value}</label>)}</div></fieldset>
            <fieldset><legend>Cuisines to avoid</legend><div className="checks">{CUISINES.map(value=><label key={value}><input type="checkbox" checked={(profile.avoidCuisines??[]).includes(value)} onChange={()=>toggle('avoidCuisines',value)}/>{value}</label>)}</div></fieldset>
            <fieldset><legend>Tastes you enjoy</legend><div className="checks">{TASTES.map(value=><label key={value}><input type="checkbox" checked={(profile.tastes??[]).includes(value)} onChange={()=>toggle('tastes',value)}/>{value}</label>)}</div><p className="fine-print">These preferences guide meal suggestions. When connected, Backboard remembers your food, cuisine and taste choices.</p></fieldset>
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
                {EQUIPMENT.map((item) => (
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
            <ContextFields value={context} onChange={setContext} state={state} />
          </>
        )}
        {!timeOnly && flags.nutritionGoals.available && (
          <details className="allowances">
            <summary>Optional daily nutrition goals</summary>
            <p className="muted">
              Daily targets suggested by your main goal. Adjust them here and compare with confirmed intake.
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
  const rows=nutritionDisplayRows(meal,servings,config.nutrition.displayNutrients);
  const unmatched=meal.nutrition.matches?.filter(m=>!m.fdcId).map(m=>m.name)??[];
  return <>
    <div className="nutrition-table">{rows.map(row=><div key={row.key}>
      <span>{nutrientInfo[row.key][0]}{row.partial?' · ingredient subtotal':''}</span>
      <strong>{num(row.value)} {nutrientInfo[row.key][1]}</strong>
    </div>)}</div>
    {!rows.length && <p>Nutrition needs an ingredient match before it can be calculated for this recipe.</p>}
    <p className="fine-print">{num(servings)} serving{servings===1?'':'s'} · {meal.mode==='cook'?'Calculated from the recipe amounts below; you do not need to weigh your grocery purchase.':'Published source values for this portion.'}</p>
    {rows.some(r=>r.partial) && <p className="fine-print">Subtotals include published nutrient values only; they are not complete meal totals.{unmatched.length?` Still to match: ${unmatched.join(', ')}.`:''}</p>}
    {rows.filter(r=>r.partial&&r.missingIngredients.length).map(row=><p className="fine-print" key={row.key}>{nutrientInfo[row.key][0]} is not published for: {row.missingIngredients.join(', ')}.</p>)}
    {(meal.nutrition.assumptions??[]).map(note=><p className="fine-print" key={note}>{note}</p>)}
  </>;
}

function Details({ meal, state, onClose, onChoose, onLog }) {
  const result = evaluate(meal, state);
  return (
    <Modal title={meal.name} onClose={onClose} wide>
      <p className="muted">
        {modeName(meal.mode)} · {meal.cost==null?'Cost needs a product match':`${money(meal.cost)} estimated`} ·{" "}
        {meal.portionLabel}{meal.portionGrams==null?'':` (${meal.portionGrams} g)`}
      </p>
      {flags.nutritionDetails.available && (
        <>
          <h3>What’s in this portion</h3>
          <NutritionTable meal={meal} />
          <details className="allowances" open={meal.nutrition?.kind === "usda_estimated"}>
            <summary>Nutrition source & basis</summary>
            <p>{meal.nutrition.source}</p>
            {['usda_estimated','ingredient_estimate'].includes(meal.nutrition?.kind) ? (
              <>
                <p>Calculated from reviewed USDA ingredient records and input grams. Missing ingredients or nutrients leave totals incomplete. Cooking losses and exact brands are not measured.</p>
                {meal.nutrition.matches?.map(match=><p key={match.name}>{match.name} · {match.grams??'Unknown'} g · {match.sourceUrl?<a href={match.sourceUrl} target="_blank" rel="noreferrer">USDA {match.fdcId}</a>:'No reviewed match'}</p>)}
              </>
            ) : <p>Basis: {meal.nutrition.basis} · Checked: {meal.nutrition.checkedAt??'Unknown'}. {meal.nutrition.kind==='illustrative_demo'?'Illustrative demo values.':''}</p>}
          </details>
        </>
      )}
      {meal.pricing && <details className="allowances"><summary>Ingredient cost sources</summary><p>{meal.pricing.basis}</p><p>{meal.pricing.store.name} · Full-package purchase estimate: {money(meal.pricing.purchaseTotal)}</p>{meal.pricing.rows.map(row=><p key={row.name}>{row.name}: {row.consumedCost==null?'Unavailable':money(row.consumedCost)} · {row.quote?.description??row.reason} {row.quote&&<a href={row.quote.sourceUrl} target="_blank" rel="noreferrer">Kroger source</a>}</p>)}</details>}
      <h3>The full meal window</h3>
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
        {knownPresentAllergens(meal).join(", ") || "None confirmed"}
        {!hasAllergenAbsenceCoverage(meal) && "; other allergens and cross-contact remain unknown"}
        . Ingredient information does not verify allergen absence or cross-contact safety.
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

const AGENT_PROMPTS = [
  "What can I cook with my groceries?",
  "Plan meals around tomorrow’s schedule",
  "Something lighter tonight",
  "Show my grocery list",
];

// The conversation outlives the dialog, so Undo still works after the assistant takes you somewhere.
const chat = { messages: [], listeners: new Set() };
const subscribeChat = (listener) => {
  chat.listeners.add(listener);
  return () => chat.listeners.delete(listener);
};
const readChat = () => chat.messages;
function updateChat(update) {
  chat.messages = update(chat.messages);
  chat.listeners.forEach((listener) => listener());
}
// Only the most recent change that is still in place can be undone (Undo restores the state before it).
const latestTurn = (messages) =>
  messages.findLastIndex((m) => m.turn && !m.turn.undone && (m.turn.before || m.turn.notes.length));
// What the model sees of an earlier reply, including what really changed.
const historyText = (m) =>
  m.turn?.summaries.length
    ? `${m.message} [${m.turn.undone ? "The user undid: " : "Changed: "}${m.turn.summaries.join("; ")}]`
    : m.message;

// Model replies sometimes use light Markdown (**bold**, bullet lines); show formatting, not symbols.
function inlineMarks(line) {
  return line
    .split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g)
    .map((part, i) =>
      /^(\*\*|__)[\s\S]+(\*\*|__)$/.test(part) ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : /^\*[^*][\s\S]*\*$/.test(part) ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : /^`[\s\S]+`$/.test(part) ? (
        part.slice(1, -1)
      ) : (
        part
      ),
    );
}
function ReplyText({ text }) {
  const blocks = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "");
    if (!line) continue;
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      const last = blocks.at(-1);
      if (last?.list) last.items.push(item[1]);
      else blocks.push({ list: true, items: [item[1]] });
    } else blocks.push({ list: false, text: line });
  }
  return blocks.map((block, i) =>
    block.list ? (
      <ul key={i} style={{ margin: "4px 0", paddingLeft: 18 }}>
        {block.items.map((entry, k) => (
          <li key={k}>{inlineMarks(entry)}</li>
        ))}
      </ul>
    ) : (
      <p key={i} style={{ margin: i ? "6px 0 0" : 0 }}>
        {inlineMarks(block.text)}
      </p>
    ),
  );
}

// Spoken answers to an open question, and phrases that end a hands-free conversation.
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm|please do|sounds good)\b/i;
const NO = /^(no|nope|cancel|don'?t|never ?mind|not now)\b/i;
const DONE_TALKING = /^(stop( listening)?|that'?s (all|it)|bye|goodbye|never ?mind)[.!]?$/i;
const VOICE_STATUS = {
  listening: "Listening… pause when you’re done",
  hearing: "Got it, writing that down…",
  speaking: "Speaking… tap the mic to cut in",
};

function Assistant({ state, onAction, onClose, agent }) {
  const greeting = agent
    ? "Hi — I can plan your meals and change your schedule, preferences and grocery list for you. Type, or tap the mic and just talk; you can undo anything I change."
    : "Hi — I’m your food copilot. Ask in plain language, or tap a prompt below to start.";
  const messages = useSyncExternalStore(subscribeChat, readChat);
  const setMessages = updateChat;
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const undoable = latestTurn(messages);
  // Voice: tap the mic and talk; replies are read aloud and the mic reopens for a follow-up.
  const canTalk = Boolean(agent) && voiceSupported();
  const [voice, setVoice] = useState("idle"),
    [level, setLevel] = useState(0),
    [voiceOut, setVoiceOut] = useState(() => {
      try {
        return localStorage.getItem("daywell-voice-replies") !== "off";
      } catch {
        return true;
      }
    });
  const mic = useRef(null),
    handsFree = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      mic.current?.cancel();
      stopSpeaking();
    };
  }, []);

  function toggleVoiceOut() {
    const next = !voiceOut;
    setVoiceOut(next);
    if (!next) stopSpeaking();
    try {
      localStorage.setItem("daywell-voice-replies", next ? "on" : "off");
    } catch {
      /* the choice just isn't remembered */
    }
  }

  async function toggleMic() {
    if (voice === "listening") return mic.current?.stop();   // done talking: use what was said
    stopSpeaking();
    handsFree.current = true;
    await hear(8000);
  }

  async function hear(waitMs) {
    setError("");
    let recorder;
    try {
      recorder = await listen({ onLevel: setLevel, waitMs });
    } catch (err) {
      handsFree.current = false;
      setVoice("idle");
      setError(err?.name === "NotAllowedError" ? "Allow microphone access to talk to the assistant." : "The microphone isn’t available.");
      return;
    }
    if (!alive.current) return recorder.cancel();
    mic.current = recorder;
    setVoice("listening");
    const wav = await recorder.result;
    mic.current = null;
    setLevel(0);
    if (!alive.current) return;
    if (!wav) {
      handsFree.current = false;   // nobody spoke: end the conversation quietly
      setVoice("idle");
      return;
    }
    setVoice("hearing");
    let words = "";
    try {
      words = await transcribe(wav, { hints: voiceHints(agent.current()) });
    } catch (err) {
      setError(err.message);
    }
    if (!alive.current) return;
    setVoice("idle");
    if (!words || DONE_TALKING.test(words)) {
      if (!words) setError((e) => e || "I didn’t catch that. Tap the mic to try again.");
      handsFree.current = false;
      return;
    }
    await sendPrompt(words, true);
  }

  // Spoken requests are answered out loud; then the mic opens again for a follow-up.
  async function replyAloud(words) {
    if (words && voiceOut && alive.current) {
      setVoice("speaking");
      await speakReply(words);
    }
    if (!alive.current) return;
    setVoice("idle");
    if (handsFree.current) await hear(6000);
  }

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function sendPrompt(raw, spoken = false) {
    const sent = raw.trim();
    if (!sent || busy) return;
    if (agent) return sendToAgent(sent, spoken);

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

  // The agent: the model picks app actions, checked here with the app's own rules, then applied
  // at once with Undo (or after "Yes, go ahead" for risky steps like removing an allergy).
  async function sendToAgent(sent, spoken = false) {
    const from = chat.messages.length;
    if (!spoken) handsFree.current = false;
    // "Yes" or "cancel" answers an open question directly, without another model call.
    const asking = from - 1;
    if (chat.messages[asking]?.confirm && (YES.test(sent) || NO.test(sent))) {
      setText("");
      setMessages((prev) => [...prev, { user: true, message: sent }]);
      if (YES.test(sent)) await confirmTurn(asking);
      else cancelConfirm(asking);
      if (spoken) await replyAloud(chat.messages[asking]?.message);
      return;
    }
    const history = chat.messages
      .filter((m) => !m.pending && typeof m.message === "string" && m.message.trim())
      .slice(-8)
      .map((m) => ({ role: m.user ? "user" : "assistant", text: historyText(m).slice(0, 1500) }));
    setBusy(true);
    setText("");
    setError("");
    setMessages((prev) => [...prev, { user: true, message: sent }, { message: "Thinking…", pending: true }]);
    let failed = "";
    try {
      const data = await askAgent({ message: sent, history, state: agent.current(), ui: agent.ui });
      await finishTurn(data.reply, data.actions ?? []);
    } catch (err) {
      failed = err.message || "The assistant could not answer right now.";
      setError(failed);
    } finally {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setBusy(false);
    }
    if (spoken)
      await replyAloud(failed || chat.messages.slice(from).filter((m) => !m.user && !m.pending && typeof m.message === "string").map((m) => m.message).join(" "));
  }

  const cancelConfirm = (index) =>
    setMessages((prev) => prev.map((m, j) => (j === index ? { message: "Okay — I left everything as it was." } : m)));

  async function finishTurn(reply, calls) {
    let undid = null;
    if (calls.some((c) => c.tool === "undo_last")) {
      const last = latestTurn(chat.messages);
      undid = last >= 0 && (await undoTurn(last, true));
    }
    const rest = calls.filter((c) => c.tool !== "undo_last");
    const plan = planTurn(agent.current(), rest);
    setMessages((prev) => prev.filter((m) => !m.pending));
    if (!plan.ok) {
      setMessages((prev) => [...prev, { message: `I couldn't do that: ${plan.error} Nothing was changed.` }]);
      return;
    }
    if (plan.confirm.length) {
      setMessages((prev) => [
        ...prev,
        {
          message: `This would ${plan.confirm.join(" and ")}. Should I go ahead?`,
          confirm: { calls: rest, reply, summaries: plan.summaries },
        },
      ]);
      return;
    }
    if (undid) plan.summaries.unshift("Undid my last changes");
    await commit(undid === false && !rest.length ? "There's nothing of mine to undo right now." : reply, plan);
  }

  async function commit(reply, plan, index = -1) {
    const before = plan.actions.length ? await agent.apply(plan.actions) : null;
    const notes = plan.effects
      .filter((e) => e.type === "note")
      .map((e) => ({ date: e.date, text: writeNote(e.date, e.text) }));
    const turn = { summaries: plan.summaries, before, after: before && agent.current(), notes, undone: false };
    const msg = { message: reply, turn };
    setMessages((prev) => (index < 0 ? [...prev, msg] : prev.map((m, j) => (j === index ? msg : m))));
    // Then take the user where they asked to go.
    const moves = plan.effects.filter((e) => ["go", "suggest", "show"].includes(e.type));
    try {
      for (const effect of moves) {
        if (effect.type === "suggest")
          setMessages((prev) => [...prev, { message: "Finding meal ideas…", pending: true }]);
        await agent.effect(effect);
      }
      if (moves.some((e) => e.type !== "show")) onClose();
    } catch (err) {
      setError(err.message || "I couldn't open that.");
    } finally {
      setMessages((prev) => prev.filter((m) => !m.pending));
    }
  }

  async function confirmTurn(index) {
    const asked = chat.messages[index]?.confirm;
    if (!asked || busy) return;
    setBusy(true);
    setError("");
    try {
      const plan = planTurn(agent.current(), asked.calls);
      if (plan.ok) await commit(asked.reply, plan, index);
      else
        setMessages((prev) =>
          prev.map((m, j) => (j === index ? { message: `I couldn't do that anymore: ${plan.error} Nothing was changed.` } : m)),
        );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const setTurn = (index, patch) =>
    setMessages((prev) => prev.map((m, j) => (j === index ? { ...m, turn: { ...m.turn, ...patch } } : m)));

  async function undoTurn(index, force = false) {
    const turn = chat.messages[index]?.turn;
    if (!turn || turn.undone) return false;
    // Undo restores the whole state from before the turn, so warn if anything changed since.
    if (!force && turn.after && JSON.stringify(agent.current()) !== JSON.stringify(turn.after)) {
      setTurn(index, { warn: true });
      return false;
    }
    try {
      if (turn.before) await agent.restore(turn.before);
      for (const note of [...turn.notes].reverse()) restoreNote(note.date, note.text);
      setTurn(index, { undone: true, warn: false });
      setError("");
      return true;
    } catch (err) {
      setError(err.message);
      return false;
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
        <span>{VOICE_STATUS[voice] ?? "Listening for meal help"}</span>
        {canTalk && (
          <button type="button" className="text-button" style={{ marginLeft: "auto", fontSize: 11 }} aria-pressed={voiceOut} onClick={toggleVoiceOut}>
            {voiceOut ? "Voice replies on" : "Voice replies off"}
          </button>
        )}
      </div>
      <div className="chat-messages" aria-live="polite" ref={listRef}>
        <div className="chat-row">
          <span className="chat-avatar" aria-hidden="true">
            <Icon name="spark" size={14} />
          </span>
          <div className="chat-bubble">{greeting}</div>
        </div>
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
              ) : msg.user ? (
                msg.message
              ) : (
                <ReplyText text={msg.message} />
              )}
              {(msg.turn?.summaries.length > 0 || msg.confirm) && (
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                  {(msg.confirm ? msg.confirm.summaries : msg.turn.summaries).map((line, k) => (
                    <li key={k} style={msg.turn?.undone ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                      {msg.confirm ? "• " : "✓ "}
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              {msg.confirm && (
                <div className="assistant-proposal">
                  <button className="assistant-apply-link" disabled={busy} onClick={() => confirmTurn(i)}>
                    Yes, go ahead →
                  </button>
                  <button
                    className="assistant-dismiss-link"
                    disabled={busy}
                    onClick={() => cancelConfirm(i)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {msg.turn?.undone && <div className="assistant-proposal">Undone.</div>}
              {i === undoable && (
                <div className="assistant-proposal">
                  {msg.turn.warn && <span>You changed things since — undo puts everything back to before this request.</span>}
                  <button
                    className={msg.turn.warn ? "assistant-apply-link" : "assistant-dismiss-link"}
                    disabled={busy}
                    onClick={() => undoTurn(i, msg.turn.warn)}
                  >
                    {msg.turn.warn ? "Undo anyway" : "Undo"}
                  </button>
                  {msg.turn.warn && (
                    <button className="assistant-dismiss-link" onClick={() => setTurn(i, { warn: false })}>
                      Keep
                    </button>
                  )}
                </div>
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
      {agent?.nudges.length > 0 && (
        <div className="assistant-prompts" role="group" aria-label="Suggestions for you">
          {agent.nudges.map((nudge) => (
            <button
              key={nudge.id}
              type="button"
              className="assistant-chip"
              disabled={busy}
              onClick={() => {
                agent.dismissNudge(nudge.id);
                sendPrompt(nudge.prompt);
              }}
            >
              {nudge.text}
            </button>
          ))}
        </div>
      )}
      {messages.length < 2 && !agent?.nudges.length && (
        <div className="assistant-prompts" role="group" aria-label="Try asking">
          {(agent ? AGENT_PROMPTS : ASSISTANT_PROMPTS).map((prompt) => (
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
          placeholder={agent ? (canTalk ? "Ask, or tap the mic and talk…" : "Ask, or tell me what to change…") : "Ask anything about meals…"}
          autoComplete="off"
        />
        {canTalk && (
          <button
            type="button"
            className="assistant-send"
            onClick={toggleMic}
            disabled={(busy && voice !== "listening") || voice === "hearing"}
            aria-label={voice === "listening" ? "Stop listening and send" : "Talk to the assistant"}
            aria-pressed={voice === "listening"}
            style={
              voice === "listening"
                ? { background: "linear-gradient(145deg, #e8743b, #b9531f)", color: "#fff", boxShadow: `0 0 0 ${3 + Math.round(level * 10)}px #e8743b33`, transition: "box-shadow 0.1s" }
                : { background: "transparent", color: "#2f5538", border: "1px solid #c9d6bc" }
            }
          >
            <Icon name="mic" size={18} />
          </button>
        )}
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
          One serving = {data.meal.portionLabel}{data.meal.portionGrams==null?"":` (${data.meal.portionGrams} g)`}.
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
    "/api/nutrition/analyze-list",
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
            ? "USDA_API_KEY is missing from whatscooking/.env"
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
