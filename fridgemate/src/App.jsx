import { useEffect, useState } from "react";
import {
  Icon,
  Modal,
  Confirm,
  Setup,
  Details,
  Kitchen,
  Intake,
  Assistant,
  Log,
} from "./ui/Core";
import {
  Agenda,
  ComingUp,
  CalendarConnect,
  EventDialog,
  PlanCalendar,
} from "./ui/CalendarViews";
import { CookStart, FoodDiscovery, VenueDetails } from "./ui/FoodViews";
import { money, mealImage, num } from "./ui/format";
import { pantryItems } from "./data/catalog";
import { byId, rememberSuggestions } from "./data/suggestions";
import { capabilities } from "./domain/config";
import { clockTime, minutes } from "./domain/engine";
import { dailyNutrition } from "./domain/nutrition";
import {
  localInstant,
  nextMealWindow,
  prettyDate,
  scheduledItems,
  timeKey,
} from "./domain/calendar";
import { today, transition } from "./domain/state";
import { storageAdapter } from "./adapters/storage";
import { persistSavedMeal, savePantryItems } from "./adapters/database";
import { directionsUrl } from "./data/uwDining";
import "./App.css";
import "./ui/redesign.css";
const flags = capabilities();

export default function App() {
  const [state, setState] = useState(null);
  const [storageError, setStorageError] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Load state on mount
  useEffect(() => {
    async function loadState() {
      try {
        const loaded = await storageAdapter.load(window.localStorage);
        setState(loaded.state);
        setStorageError(loaded.error);
      } catch (error) {
        setState(storageAdapter.reset(window.localStorage));
        setStorageError('Failed to load saved state. Starting fresh.');
      } finally {
        setLoading(false);
      }
    }
    loadState();
  }, []);
  const [tab, setTab] = useState("Today"),
    [mode, setMode] = useState("cook"),
    [cookPhase, setCookPhase] = useState("groceries"),
    [geminiMeals, setGeminiMeals] = useState(null),
    [groceryList, setGroceryList] = useState([]),
    [date, setDate] = useState(today());
  const [dialog, setDialog] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  
  // Show loading screen while state is loading
  if (loading || !state) {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Icon name="leaf" size={40} />
          <p>Loading Daywell...</p>
        </div>
      </div>
    );
  }
  
  const items = scheduledItems(state, byId),
    day = today(),
    summary = dailyNutrition(state.logs, byId, day),
    logs = state.logs.filter((l) => l.date === day);
  const close = () => setDialog(null);
  async function dispatch(action) {
    if (storageError) throw new Error(storageError);
    const next = transition(state, action);
    try {
      const savedToBackend = await storageAdapter.save(window.localStorage, next);
      
      // Always use the next state we just saved
      // Don't reload from backend because that might give us stale or empty data
      setState(next);
      

    } catch (err) {
      setStorageError(
        "Browser storage could not save your changes. Existing records are preserved.",
      );
      throw new Error(
        "Could not save. Check browser storage or reload before continuing.",
      );
    }
    setError("");
    const messages = {
      configure: "Preferences saved.",
      updateContext: "Meal window updated.",
      updateProfile: "Preferences saved.",
      updatePantry: "Groceries updated.",
      importCalendar: "Calendar loaded. Today and My Plan are updated.",
      saveEvent: "Activity saved in Daywell.",
      deleteEvent: "Activity removed.",
      removeMealPlan: "Meal removed from My Plan.",
      undo: "Plan change undone.",
      undoLog: "Last meal-log change undone.",
      removeLog: "Meal log removed. Your intake has been recalculated.",
    };
    if (messages[action.type]) setNotice(messages[action.type]);
    return next;
  }
  async function safe(action) {
    try {
      await dispatch(action);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }
  async function goFood(nextMode) {
    // Only auto-calculate window if coming from Today tab AND the user hasn't
    // manually set a window for today already.
    if (tab === "Today") {
      const contextIsForToday = state.context.date === day;
      const userSetManually = state.context.manuallySet === true;
      if (!contextIsForToday || !userSetManually) {
        const window = nextMealWindow(
          items,
          day,
          new Date(now),
          Math.max(45, state.context.available),
        );
        if (window && !(await safe({ type: "updateContext", context: { ...window, manuallySet: false } }))) return;
        if (!window)
          setNotice(
            "No free window of 35 minutes or more was found. Adjust the meal window in Food.",
          );
      }
    }
    setMode(nextMode);
    if (nextMode === "cook") {
      setGeminiMeals(null);
      setGroceryList([]);
      setCookPhase("groceries");
    }
    setTab("Food");
  }
  function setFoodMode(nextMode) {
    setMode(nextMode);
    if (nextMode === "cook") {
      setGeminiMeals(null);
      setGroceryList([]);
      setCookPhase("groceries");
    }
  }
  async function choose(meal) {
    const existing = state.mealPlans.find(
      (p) => p.date === state.context.date && p.start === state.context.start,
    );
    if (existing && existing.mealId !== meal.id) {
      setDialog({ type: "replace", meal, existing });
      return;
    }
    if (await safe({ type: "choose", mealId: meal.id })) {
      const saved = await persistSavedMeal(meal);
      setNotice(
        saved.status === "ok"
          ? `${meal.name} added to My Plan and saved to Postgres.`
          : `${meal.name} added to My Plan.`,
      );
      setDialog({ type: "details", meal });
    }
  }
  async function reviseMeal(plan) {
    const begin = Date.parse(localInstant(plan.date, plan.start));
    const next = items
      .filter(
        (e) =>
          e.busy &&
          !e.completed &&
          e.kind !== "task" &&
          e.id !== plan.id &&
          Date.parse(e.start) > begin &&
          Date.parse(e.start) < Date.parse(localInstant(plan.date, "23:59")),
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const commitmentTime =
      next && timeKey(next.start) > plan.start ? timeKey(next.start) : "23:59";
    if (
      !(await safe({
        type: "updateContext",
        context: {
          date: plan.date,
          start: plan.start,
          available: Math.min(
            plan.duration,
            minutes(commitmentTime) - minutes(plan.start),
          ),
          commitment: next?.title ?? "No further commitment",
          commitmentTime,
        },
      }))
    )
      return;
    setMode(byId[plan.mealId].mode);
    setTab("Food");
    close();
  }
  const openLog = (meal, log = null) =>
    setDialog({ type: "log", meal, log, id: log?.id ?? crypto.randomUUID() });
  const openEvent = (event) => setDialog({ type: "event", event });
  const openDetails = (meal) => setDialog({ type: "details", meal });
  const addEvent = (eventDate) => setDialog({ type: "event", date: eventDate });
  const latest = logs.toSorted((a, b) =>
    (b.confirmedAt || "").localeCompare(a.confirmedAt || ""),
  )[0];
  const lastPlan = state.mealPlans
    .filter((p) => p.date === day)
    .sort((a, b) => a.start.localeCompare(b.start))
    .at(-1);
  // Hide the hero card if this meal has been logged as eaten
  const lastPlanWasEaten = lastPlan && logs.some(
    (log) => log.mealId === lastPlan.mealId && log.date === lastPlan.date
  );
  const showLastPlan = lastPlan && !lastPlanWasEaten;
  function undoLog() {
    safe(
      state.logUndo
        ? { type: "undoLog" }
        : { type: "removeLog", id: latest.id },
    );
  }
  function planVisit(venue) {
    setDialog({
      type: "event",
      event: {
        id: crypto.randomUUID(),
        title: `Meal at ${venue.name}`,
        start: localInstant(state.context.date, state.context.start),
        end: localInstant(
          state.context.date,
          clockTime(Math.min(1439, minutes(state.context.start) + 30)),
        ),
        kind: "meal",
        location: venue.location,
        source: "manual",
        busy: true,
        readOnly: false,
        venueId: venue.id,
        draft: true,
      },
    });
  }
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#today" onClick={() => setTab("Today")}>
            <span className="brand-mark">
              <Icon name="leaf" size={25} />
            </span>
            daywell<span className="brand-dot">.</span>
          </a>
          <nav aria-label="Main navigation">
            {[
              ["Today", "grid"],
              ["My Plan", "calendar"],
              ["Food", "fork"],
            ].map(([name, icon]) => (
              <button
                key={name}
                aria-current={tab === name ? "page" : undefined}
                onClick={() => {
                  setTab(name);
                  setError("");
                }}
              >
                <Icon name={icon} size={19} />
                <span>{name}</span>
              </button>
            ))}
          </nav>
          <div className="header-right">
            <button
              className="assistant-nav"
              aria-label="Assistant"
              onClick={() => setDialog({ type: "assistant" })}
            >
              <Icon name="spark" />
              <span>Assistant</span>
            </button>
            <button
              className="avatar"
              aria-label="Profile and preferences"
              onClick={() => setDialog({ type: "profile" })}
            >
              You
            </button>
          </div>
        </div>
      </header>
      <main className="app-shell redesigned-shell">
        <div className="compact-page-title">
          <div>
            <h1>{tab}</h1>
            <p>
              {tab === "Today"
                ? prettyDate(day, { weekday: "long" })
                : tab === "My Plan"
                  ? "Your calendar, meals and tasks in one place."
                  : "Find a meal. Swipe to make it yours."}
            </p>
          </div>
          <div className="page-tools">
            {tab === "My Plan" && (
              <button className="secondary" onClick={() => addEvent(date)}>
                + Add activity
              </button>
            )}
            <button
              className={`calendar-status ${state.calendar.connected ? "connected" : ""}`}
              onClick={() => setDialog({ type: "calendar" })}
            >
              <Icon name="calendar" size={16} />
              <span>
                {state.calendar.connected
                  ? state.calendar.source === "apple"
                    ? "Apple Calendar"
                    : "Imported calendar"
                  : "Connect calendar"}
              </span>
              <span className="connection-dot" />
            </button>
            <button
              className="build-label"
              onClick={() => setDialog({ type: "about" })}
            >
              About this build
            </button>
          </div>
        </div>
        {storageError && (
          <div className="notice warning" role="alert">
            {storageError}
            <button
              className="text-button"
              onClick={() => setDialog({ type: "reset" })}
            >
              Reset demo
            </button>
          </div>
        )}
        {error && (
          <div className="notice warning" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice compact-notice" role="status">
            <span>{notice}</span>
            <div>
              {state.logUndo && (
                <button
                  className="text-button"
                  onClick={() => safe({ type: "undoLog" })}
                >
                  Undo log change
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
        )}
        {tab === "Today" && (
          <div className="today-layout">
            <div className="today-main">
              <ComingUp
                items={items}
                date={day}
                now={now}
                connected={state.calendar.connected}
                onOpen={openEvent}
                onAdd={addEvent}
                onConnect={() => setDialog({ type: "calendar" })}
              />
              <section className="meal-entry">
                <div className="panel-title">
                  <h2>What’s the plan for food?</h2>
                  <button
                    className="text-button"
                    onClick={() => setDialog({ type: "time" })}
                  >
                    <Icon name="clock" size={15} />
                    Meal window
                  </button>
                </div>
                <div className="meal-paths">
                  <button
                    className="meal-path cook-path"
                    onClick={() => goFood("cook")}
                  >
                    <div className="path-copy">
                      <span className="path-icon">
                        <Icon name="leaf" size={22} />
                      </span>
                      <strong>Cook</strong>
                      <p>Use groceries you have</p>
                      <span className="path-link">
                        Find a meal
                        <Icon name="arrow" size={16} />
                      </span>
                    </div>
                    <img
                      src="/food/tofu.png"
                      alt="Illustrative tofu and rice meal"
                    />
                  </button>
                  <button
                    className="meal-path school-path"
                    onClick={() => goFood("eatOut")}
                  >
                    <div className="path-copy">
                      <span className="path-icon">
                        <Icon name="fork" size={22} />
                      </span>
                      <strong>Eat at school</strong>
                      <p>Explore food near the HUB</p>
                      <span className="path-link">
                        See UW places
                        <Icon name="arrow" size={16} />
                      </span>
                    </div>
                    <img src="/food/pasta.png" alt="Illustrative pasta meal" />
                  </button>
                </div>
              </section>
              {showLastPlan && (
                <section className="today-saved-meal">
                  <img
                    src={mealImage(byId[lastPlan.mealId])}
                    alt={byId[lastPlan.mealId].name}
                  />
                  <div>
                    <span className="eyebrow">YOUR MEAL PLAN</span>
                    <strong>{byId[lastPlan.mealId].name}</strong>
                    <p>
                      {lastPlan.start} · {lastPlan.duration} min ·{" "}
                      {money(byId[lastPlan.mealId].cost)} estimate
                    </p>
                  </div>
                  <div className="today-saved-actions">
                    <button
                      className="secondary"
                      onClick={() => openDetails(byId[lastPlan.mealId])}
                    >
                      Details
                    </button>
                    {flags.mealLogging.available && (
                      <button
                        className="primary"
                        onClick={() => openLog(byId[lastPlan.mealId])}
                      >
                        Log eaten
                      </button>
                    )}
                  </div>
                </section>
              )}
              <section className="nutrition-compact">
                <div className="panel-title">
                  <h2>Confirmed food today</h2>
                  <div>
                    {(state.logUndo || latest) && (
                      <button className="text-button" onClick={undoLog}>
                        {state.logUndo ? "Undo last change" : "Undo last log"}
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => setDialog({ type: "intake" })}
                    >
                      Meal log <Icon name="arrow" size={14} />
                    </button>
                  </div>
                </div>
                <div className="nutrition-snapshot">
                  <div>
                    <strong>
                      {summary.energy_kcal.value == null
                        ? "—"
                        : num(summary.energy_kcal.value)}
                    </strong>
                    <span>kcal subtotal</span>
                  </div>
                  <div>
                    <strong>
                      {summary.protein_g.value == null
                        ? "—"
                        : num(summary.protein_g.value)}
                      <small>
                        {summary.protein_g.value != null ? " g" : ""}
                      </small>
                    </strong>
                    <span>protein</span>
                  </div>
                  <div>
                    <strong>{logs.length}</strong>
                    <span>confirmed logs</span>
                  </div>
                </div>
                <p className="fine-print">
                  {logs.length
                    ? `${summary.energy_kcal.known}/${logs.length} logs have energy data. `
                    : "Confirm what you ate to start a subtotal. "}
                  Planned meals are excluded. Cook recipes use USDA when configured.
                </p>
              </section>
            </div>
            <aside className="today-agenda">
              <Agenda
                items={items}
                date={day}
                now={now}
                connected={state.calendar.connected}
                onOpen={openEvent}
                onAdd={addEvent}
                onCalendar={() => setTab("My Plan")}
              />
              <div className="schedule-sync-note">
                <span className="connection-dot" />
                {state.calendar.connected
                  ? `Last loaded ${new Date(state.calendar.lastSync).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                  : "Calendar not connected"}
                <button
                  className="text-button"
                  onClick={() => setDialog({ type: "calendar" })}
                >
                  {state.calendar.connected ? "Refresh" : "Connect"}
                </button>
              </div>
            </aside>
          </div>
        )}
        {tab === "My Plan" && (
          <>
            {state.calendar.connected &&
              state.calendar.range &&
              (Date.parse(localInstant(date, "12:00")) <
                Date.parse(state.calendar.range.from) ||
                Date.parse(localInstant(date, "12:00")) >=
                  Date.parse(state.calendar.range.to)) && (
                <div className="notice compact-notice">
                  <span>This date is outside the loaded calendar range.</span>
                  <button
                    className="text-button"
                    onClick={() => setDialog({ type: "calendar" })}
                  >
                    Load around this date
                  </button>
                </div>
              )}
            <div className="plan-date-controls">
              <button className="text-button" onClick={() => setDate(day)}>
                Jump to today
              </button>
              <label>
                <span className="sr-only">Selected calendar date</span>
                <input
                  aria-label="Selected calendar date"
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
              </label>
            </div>
            <PlanCalendar
              items={items}
              now={now}
              connected={state.calendar.connected}
              date={date}
              onDate={setDate}
              onOpen={openEvent}
              onAdd={addEvent}
              onConnect={() => setDialog({ type: "calendar" })}
            />
          </>
        )}
        {tab === "Food" &&
          mode === "cook" &&
          cookPhase === "groceries" && (
            <CookStart
              key={`cook-start-${JSON.stringify(state.pantry)}`}
              state={state}
              onSuggested={async (meals, ingredients) => {
                rememberSuggestions(meals);
                setGeminiMeals(meals);
                setGroceryList(ingredients || []);
                if (ingredients?.length) {
                  const pantry = { ...state.pantry };
                  for (const item of pantryItems) {
                    if (
                      !ingredients.some(
                        (g) => g.toLowerCase() === item.toLowerCase(),
                      )
                    )
                      pantry[item] = pantry[item] ?? 0;
                  }
                  for (const name of ingredients)
                    pantry[name] = Math.max(pantry[name] ?? 0, 500);
                  await safe({ type: "updatePantry", pantry });
                  const remote = await savePantryItems(ingredients);
                  if (remote.status === "ok")
                    setNotice("Groceries saved to Postgres.");
                }
                setCookPhase("discover");
              }}
              onEatOut={() => setFoodMode("eatOut")}
            />
          )}
        {tab === "Food" &&
          !(mode === "cook" && cookPhase === "groceries") && (
            <FoodDiscovery
              key={`${mode}-${state.context.date}-${state.context.start}-${state.context.available}-${geminiMeals?.map((m) => m.id).join(",") || "catalog"}-${state.events.length}`}
              state={state}
              mode={mode}
              onMode={setFoodMode}
              onChoose={choose}
              onVenue={(venue) => setDialog({ type: "venue", venue })}
              onVenueDirections={(venue) => {
                window.location.assign(directionsUrl(venue));
              }}
              onDetails={openDetails}
              onKitchen={() => setDialog({ type: "kitchen" })}
              onPreferences={() => setDialog({ type: "profile" })}
              onWindow={() => setDialog({ type: "time" })}
              onUndoPlan={() => safe({ type: "undo" })}
              onChangeGroceries={() => {
                setCookPhase("groceries");
              }}
              geminiMeals={mode === "cook" ? geminiMeals : null}
              groceryList={groceryList}
            />
          )}
        <footer className="compact-footer">
          <span>Daywell · Your day, a little easier.</span>
          <button
            className="text-button"
            onClick={() => setDialog({ type: "about" })}
          >
            Sources & app status
          </button>
          <button
            className="text-button"
            onClick={() => setDialog({ type: "reset" })}
          >
            Reset demo
          </button>
        </footer>
      </main>
      {dialog?.type === "calendar" && (
        <CalendarConnect
          state={state}
          date={tab === "My Plan" ? date : day}
          onSave={dispatch}
          onClose={close}
        />
      )}
      {dialog?.type === "event" && (
        <EventDialog
          event={dialog.event}
          date={dialog.date ?? date}
          onSave={dispatch}
          onClose={close}
          onMeal={openDetails}
          onRemoveMeal={(id) => safe({ type: "removeMealPlan", id })}
          onRevise={reviseMeal}
        />
      )}
      {dialog?.type === "venue" && (
        <VenueDetails
          venue={dialog.venue}
          state={state}
          onClose={close}
          onPlan={planVisit}
        />
      )}
      {dialog?.type === "profile" && (
        <Setup state={state} onSave={dispatch} onClose={close} />
      )}
      {dialog?.type === "time" && (
        <Setup state={state} timeOnly onSave={dispatch} onClose={close} />
      )}
      {dialog?.type === "details" && (
        <Details
          meal={dialog.meal}
          state={state}
          onChoose={choose}
          onLog={openLog}
          onClose={close}
        />
      )}
      {dialog?.type === "kitchen" && (
        <Modal title="Groceries on hand" onClose={close} wide>
          <Kitchen state={state} onSave={dispatch} />
        </Modal>
      )}
      {dialog?.type === "assistant" && (
        <Assistant state={state} onAction={dispatch} onClose={close} />
      )}
      {dialog?.type === "intake" && (
        <Modal title="Your confirmed meal log" onClose={close} wide>
          {(state.logUndo || latest) && (
            <button className="secondary" onClick={undoLog}>
              {state.logUndo ? "Undo last log change" : "Undo most recent log"}
            </button>
          )}
          <Intake
            state={state}
            onEdit={(log) => openLog(byId[log.mealId], log)}
            onRemove={(log) => setDialog({ type: "removeLog", log })}
          />
        </Modal>
      )}
      {dialog?.type === "log" && (
        <Log
          data={dialog}
          onSave={dispatch}
          onClose={close}
          onLogged={() =>
            setNotice(
              "Meal recorded. Use Undo to reverse it, or Meal log to edit a portion.",
            )
          }
        />
      )}
      {dialog?.type === "replace" && (
        <Confirm
          title="Replace this planned meal?"
          onClose={close}
          button="Confirm replacement"
          onConfirm={async () => {
            await dispatch({ type: "choose", mealId: dialog.meal.id });
            setNotice("Meal replaced in My Plan.");
            setDialog({ type: "details", meal: dialog.meal });
          }}
        >
          <p>
            Replace <strong>{byId[dialog.existing.mealId].name}</strong> with{" "}
            <strong>{dialog.meal.name}</strong> at {state.context.start} on{" "}
            {state.context.date}?
          </p>
          <p className="muted">Confirmed consumption is unchanged.</p>
        </Confirm>
      )}
      {dialog?.type === "removeLog" && (
        <Confirm
          title="Remove this consumption log?"
          onClose={close}
          button="Remove log"
          onConfirm={async () => {
            await dispatch({ type: "removeLog", id: dialog.log.id });
            setDialog({ type: "intake" });
          }}
        >
          <p>
            {byId[dialog.log.mealId].name} · {dialog.log.servings} servings.
            Your subtotal will be recalculated. You can undo this removal.
          </p>
        </Confirm>
      )}
      {dialog?.type === "reset" && (
        <Confirm
          title="Start a fresh demo?"
          onClose={close}
          button="Reset local demo"
          onConfirm={() => {
            setState(storageAdapter.reset(window.localStorage));
            setStorageError(null);
            setNotice("Sample preferences restored.");
            close();
          }}
        >
          <p>
            This removes this browser’s Daywell preferences, pantry, calendar
            copies, meal plans and confirmed logs. Apple Calendar is unchanged.
          </p>
        </Confirm>
      )}
      {dialog?.type === "about" && (
        <Modal title="How this version works" onClose={close} wide>
          <div className="about-sections">
            <section>
              <h3>Today, My Plan, Food</h3>
              <p>
                Today is your next activity and full day’s agenda. My Plan is
                the calendar. Food has separate Cook and Eat at school swipe
                decks.
              </p>
            </section>
            <section>
              <h3>The current “agent”</h3>
              <p>
                A deterministic planner checks calendar conflicts, full activity
                time, budget, ingredients, equipment and dietary restrictions.
                It uses a curated recipe library and your chosen priority.
                Weighted scoring and Gemini are not active. The assistant
                supports explicit local commands.
              </p>
            </section>
            <section>
              <h3>Real UW places, clear data limits</h3>
              <p>
                Restaurant locations, public hours and menu links come from
                official UW HFS pages. Distances use official UW building pins
                from the HUB and are straight-line, not routed walking
                distances. Current ratings, exact dish nutrition, stock and
                queues are not loaded. Google Maps provides routes and reviews.
              </p>
            </section>
            <section>
              <h3>Food images & nutrition</h3>
              <p>
                Meal pictures are AI-generated representative illustrations.
                Cook recipe nutrient values remain labeled demo estimates. Real
                venue cards do not inherit fake calories or ratings.
              </p>
            </section>
            <section>
              <h3>Your data</h3>
              <p>
                Apple Calendar is read through a local Mac helper after
                permission. .ics import is also available. Imported events are
                read-only; local activities and meal blocks are stored in this
                browser. There are no orders, payments, notifications or
                external calendar writes.
              </p>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
