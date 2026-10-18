import {recipeSnapshots} from "./domain/generatedMeals.js";
import {useCalendarRefresh} from "./adapters/calendarRefresh.js";
import { useEffect, useRef, useState } from "react";
import {
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
  UsedUpDialog,
} from "./ui/Core";
import {
  Agenda,
  SidebarNotes,
  ComingUp,
  CalendarConnect,
  EventDialog,
  PlanCalendar,
} from "./ui/CalendarViews";
import { CookStart, FoodDiscovery, VenueDetails } from "./ui/FoodViews";
import { money, num, mealImage, prefetchMealImages } from "./ui/format";
import { RecipeReview } from "./ui/RecipeReview";
import { Onboarding } from "./ui/Onboarding";
import { byId, rememberMeal, rememberSuggestions, restoreSuggestions } from "./data/suggestions";
import { capabilities } from "./domain/config";
import { clockTime, minutes } from "./domain/engine";
import { dailyNutrition } from "./domain/nutrition";
import {
  dayKey,
  localInstant,
  mealWindowStillOpen,
  nextMealContext,
  prettyDate,
  scheduledItems,
  scheduleMealsForDay,
  timeKey,
} from "./domain/calendar";
import { today, transition } from "./domain/state";
import { storageAdapter } from "./adapters/storage";
import { persistSavedMeal, savePantryItems } from "./adapters/database";
import { recordActionFeedback } from "./adapters/mealFeedback";
import { prepareCook, prepareRecipeDrafts, requestRecipeDrafts } from "./adapters/recipes";
import { computeNudges, dismissedNudges, dismissNudge } from "./domain/nudges";
import { directionsUrl } from "./data/uwDining";
import "./App.css";
import "./ui/redesign.css";
const flags = capabilities();

export default function App() {
  const stateRef = useRef(null);
  const [state, setState] = useState(null);
  const [storageError, setStorageError] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [tab, setTab] = useState("Today"),
    [mode, setMode] = useState("cook"),
    [cookPhase, setCookPhase] = useState("discover"),
    [geminiMeals, setGeminiMeals] = useState(null),
    [groceryList, setGroceryList] = useState([]),
    [date, setDate] = useState(today());

  // Load state on mount
  useEffect(() => {
    async function loadState() {
      try {
        const loaded = await storageAdapter.load(window.localStorage);
        restoreSuggestions(recipeSnapshots(loaded.state));
        // A saved "next meal" goes stale; start from now and the calendar.
        const next = loaded.state.context?.manuallySet && mealWindowStillOpen(loaded.state.context) ? null : nextMealContext(loaded.state, byId);
        if (next) try { loaded.state = transition(loaded.state, { type: "updateContext", context: next }); } catch { /* keep the saved one */ }
        stateRef.current=loaded.state;
        const drafts=(loaded.state.generatedMeals??[]).filter(m=>m.suggestion===true && !m.sourceRecipeId);
        if(drafts.length) {setGeminiMeals(drafts.map(m=>m.id));setGroceryList(loaded.state.groceryList??[]);}
        setState(loaded.state);
        setStorageError(loaded.error);
        if (loaded.state?.geminiMeals?.length) rememberSuggestions(loaded.state.geminiMeals);
      } catch {
        stateRef.current=storageAdapter.reset(window.localStorage);
        restoreSuggestions(recipeSnapshots(stateRef.current));
        setState(stateRef.current);
        setStorageError('Failed to load saved state. Starting fresh.');
      } finally {
        setLoading(false);
      }
    }
    loadState();
  }, []);
  const [dialog, setDialog] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [, setNudgeTick] = useState(0);
  const [nudgesSeen, setNudgesSeen] = useState(false);
  
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  
  useCalendarRefresh(stateRef, dispatch, setError);

  // Opening Cook prepares likely photos and, for returning users, a saved-pantry batch.
  const cookOpen = tab === "Let's eat" && mode === "cook" && Boolean(state);
  useEffect(() => {
    if (cookOpen && stateRef.current) void prepareCook(stateRef.current);
  }, [cookOpen]);

  // Show loading screen while state is loading
  if (loading || !state) {
    return (
      <>
        <div className="ambient-scene" aria-hidden="true">
          <span className="ambient-orb a" />
          <span className="ambient-orb b" />
          <span className="ambient-orb c" />
        </div>
        <div className="loading-splash">
          <span className="brand-mark">
            <Icon name="spark" size={28} />
          </span>
          <p>WhatsCooking.ai</p>
        </div>
      </>
    );
  }
  
  restoreSuggestions(recipeSnapshots(state));
  const items = scheduledItems(state, byId),
    day = today(),
    summary = dailyNutrition(state.logs, byId, day),
    logs = state.logs.filter((l) => l.date === day);
  const close = () => setDialog(null);
  // Proactive suggestions from the user's own data (no model calls); dismissed ones stay hidden.
  const hidden = dismissedNudges();
  const nudges = computeNudges(state, { now: new Date(now), today: day, meals: byId }).filter((n) => !hidden.has(n.id));
  async function dispatch(action) {
    if (storageError) throw new Error(storageError);
    const next = transition(stateRef.current, action);
    try {
      storageAdapter.save(window.localStorage, next);
      stateRef.current=next;
      restoreSuggestions(recipeSnapshots(next));
      if (["updatePantry","addGeneratedMeals","reviewGeneratedMeal"].includes(action.type)) void savePantryItems(next.pantry);
      recordActionFeedback(action, next);
      
      // Always use the next state we just saved
      // Don't reload from backend because that might give us stale or empty data
      setState(next);
      

    } catch (err) {
      setStorageError(
        "Browser storage could not save your changes. Existing records are preserved.",
      );
      throw new Error(
        "Could not save. Check browser storage or reload before continuing.",
        {cause:err},
      );
    }
    setError("");
    const messages = {
      configure: "Preferences saved.",
      updateContext: "Meal window updated.",
      updateProfile: "Preferences saved.",
      updatePantry: "Groceries updated.",
      importCalendar: "Calendar loaded. Today and My Meal Plan are updated.",
      saveEvent: "Activity saved in WhatsCooking.ai.",
      deleteEvent: "Activity removed.",
      removeMealPlan: "Meal removed from My Meal Plan.",
      undo: "Plan change undone.",
      undoLog: "Last meal-log change undone.",
      removeLog: "Meal log removed. Your intake has been recalculated.",
    };
    if (messages[action.type] && !action.quiet) setNotice(messages[action.type]);
    if (
      (action.type === "updateProfile" || action.type === "configure") &&
      (action.profile?.phone || "").trim() &&
      (action.profile.phone || "").trim() !== (state.profile.phone || "").trim() &&
      (action.profile.reminderFrom || "").trim()
    ) {
      setNotice(
        `Preferences saved. Text ${action.profile.reminderFrom.trim()} once to activate reminders.`,
      );
    }
    if (action.type === "saveEvent") {
      const saved = next.events.find((e) => e.id === action.event.id);
      if (saved) await syncScheduleEvents([saved]);
    }
    if (action.type === "importCalendar") {
      await syncScheduleEvents(next.events.filter((e) => e.source === action.source));
    }
    return next;
  }
  async function syncScheduleEvents(events) {
    const payload = events
      .filter((event) => event && !event.allDay && event.id && event.title?.trim())
      .map((event) => ({
        id: event.id,
        name: event.title.trim(),
        date: dayKey(event.start),
        time: timeKey(event.start),
        source: event.source || "manual",
      }))
      .filter((event) => /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time));
    if (!payload.length) return;
    try {
      await fetch("/api/sync-schedule-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "demo", events: payload }),
      });
    } catch {
      /* backend unreachable — the calendar save itself already succeeded */
    }
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
  // Your next meal starts now and runs until the next busy thing on your calendar (no limit if
  // nothing is scheduled), so nobody has to pick a time first. A window you picked stays while it's open.
  async function refreshNextMeal() {
    const c = stateRef.current.context;
    if (c.manuallySet && mealWindowStillOpen(c, new Date())) return true;
    const next = nextMealContext(stateRef.current, byId);
    if (!next || ["date", "start", "available", "commitment", "commitmentTime", "manuallySet"].every((k) => c[k] === next[k])) return true;
    return safe({ type: "updateContext", context: next, quiet: true });
  }
  async function goFood(nextMode) {
    if (!(await refreshNextMeal())) return;
    setMode(nextMode);
    if (nextMode === "cook") {
      // Preserve an active grocery session (Gemini meals already generated).
      // If no session is active, only go to groceries screen when pantry is empty.
      if (!(geminiMeals && geminiMeals.length > 0)) {
        setGeminiMeals(null);
        setGroceryList([]);
      }
      setCookPhase("discover");
    }
    setTab("Let's eat");
  }
  function setFoodMode(nextMode) {
    setMode(nextMode);
    if (nextMode === "cook") {
      if (!(geminiMeals && geminiMeals.length > 0)) {
        setGeminiMeals(null);
        setGroceryList([]);
      }
      setCookPhase("discover");
    }
  }
  // New recipe drafts from the grocery screen or the assistant: persisted, then shown in Cook.
  async function acceptSuggestions(meals, ingredients, pantry) {
    // Drafts and explicit grocery quantities are persisted together. No invented stock.
    await dispatch({type:'addGeneratedMeals',meals,pantry,groceryList:ingredients});
    prefetchMealImages(meals);
    setGeminiMeals(meals.map(m=>m.id));
    setGroceryList(ingredients || []);
    setCookPhase("discover");
  }
  // What the assistant agent may do: apply a checked turn, undo it, and take the user places.
  const agentBridge = {
    ui: { screen: tab, mode: mode === "eatOut" ? "school" : "cook" },
    nudges,
    current: () => stateRef.current,
    dismissNudge: (id) => { dismissNudge(id); setNudgeTick((n) => n + 1); },
    async apply(actions) {
      const before = stateRef.current;
      try {
        for (const action of actions) await dispatch(action);
      } catch (err) {
        await dispatch({ type: "agentRestore", state: before });   // never leave half a turn applied
        throw err;
      }
      return before;
    },
    restore: (before) => dispatch({ type: "agentRestore", state: before }),
    async effect(effect) {
      if (effect.type === "go") {
        if (effect.mode) setMode(effect.mode);
        setTab(effect.tab);
      } else if (effect.type === "show") {
        openDetails(effect.meal);
      } else if (effect.type === "suggest") {
        const current = stateRef.current;
        const names = effect.ingredients.length ? effect.ingredients : Object.keys(current.pantry).filter((k) => current.pantry[k] > 0).slice(0, 30);
        if (!names.length) throw new Error("Tell me which groceries you have first.");
        const pantry = effect.ingredients.length ? {} : Object.fromEntries(names.map((n) => [n, current.pantry[n]]));
        const meals = await requestRecipeDrafts({ state: current, ingredients: names, pantry, signal: AbortSignal.timeout(60000) });
        if (!meals.length) throw new Error("No recipes came back for those groceries. Try again or add more.");
        await acceptSuggestions(meals, names, pantry);
        setMode("cook");
        setTab("Let's eat");
      }
    },
  };
  // A fresh batch of AI recipes that avoids every recipe already suggested.
  const shownRecipeNames = () => (state.generatedMeals ?? []).filter((m) => m.suggestion === true).map((m) => m.name);
  // Next 3 recipes requested quietly on the last card, so "More ideas" only waits for photos.
  function prepareMore() {
    prepareRecipeDrafts({ state, ingredients: groceryList, exclude: shownRecipeNames() });
  }
  async function moreIdeas() {
    const meals = await requestRecipeDrafts({ state, ingredients: groceryList, exclude: shownRecipeNames(), signal: AbortSignal.timeout(60000) });
    if (!meals.length) throw new Error("No new recipes came back. Try again, or change your groceries.");
    await dispatch({ type: "addGeneratedMeals", meals, pantry: {}, groceryList });
    prefetchMealImages(meals);
    setGeminiMeals(meals.map((m) => m.id));
  }
  async function choose(meal) {
    if(meal.sourceRecipeId && !byId[meal.id] && !(await safe({type:"captureSourcedMeal",meal}))) return false;
    rememberMeal(meal);
    // Check if the current context matches an open slot and fill it
    const openSlot = state.mealPlans.find(
      (p) =>
        p.openSlot &&
        p.date === state.context.date &&
        p.start === state.context.start,
    );
    if (openSlot) {
      // Fill the open slot with the chosen meal
      if (await safe({ type: "fillMealSlot", slotId: openSlot.id, mealId: meal.id })) {
        const saved = await persistSavedMeal(meal);
        setNotice(
          saved.status === "ok"
            ? `${meal.name} added to My Plan (${openSlot.slotLabel ?? "meal"} slot).`
            : `${meal.name} added to My Plan.`,
        );
        // Update the photon_plans row so the reminder says "Let's Get Cooking!"
        // instead of the generic 5-min browse prompt.
        try {
          await fetch("/api/sync-meal-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: "demo",
              plans: [{
                meal_name: meal.name,
                meal_date: openSlot.date,
                meal_time: openSlot.start,
                meal_id:   meal.id,
              }],
            }),
          });
        } catch { /* backend unreachable — continue */ }
        close();
        setTab("Today");
        setError("");
        return true;
      }
      return false;
    }
    const existing = state.mealPlans.find(
      (p) =>
        !p.openSlot &&
        p.mealId &&
        p.date === state.context.date &&
        p.start === state.context.start,
    );
    if (existing && existing.mealId !== meal.id) {
      setDialog({ type: "replace", meal, existing });
      return true;
    }
    if (await safe({ type: "choose", mealId: meal.id })) {
      const saved = await persistSavedMeal(meal);
      setNotice(
        saved.status === "ok"
          ? `${meal.name} added to My Meal Plan and saved to Postgres.`
          : `${meal.name} added to My Meal Plan.`,
      );
      close();
      setTab("Today");
      setError("");
      return true;
    }
    return false;
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
    const planned = byId[plan.mealId];
    setMode(planned?.mode ?? "cook");
    if((planned?.mode ?? "cook")==='cook') {
      setGeminiMeals(planned?.suggestion?state.generatedMeals.filter(m=>m.suggestion===true&&!m.sourceRecipeId).map(m=>m.id):null);
      setCookPhase('discover');
    }
    setTab("Let's eat");
    close();
  }
  const openLog = async (meal, log = null) => {
    if(meal.sourceRecipeId && !byId[meal.id] && !(await safe({type:"captureSourcedMeal",meal}))) return;
    setDialog({ type: "log", meal, log, id: log?.id ?? crypto.randomUUID() });
  };
  const openEvent = (event) => {
    // Open slots should navigate to Food → Cook with the right date/time context
    if (event.openSlot && event.plan) {
      const plan = event.plan;
      safe({
        type: "updateContext",
        context: {
          date: plan.date,
          start: plan.start,
          available: plan.available ?? plan.duration,
          commitment: plan.commitment ?? "No further commitment",
          commitmentTime: plan.commitmentTime ?? "23:59",
          manuallySet: false,
        },
      }).then(() => {
        setMode("cook");
        // Only send to the grocery input screen if the pantry is empty.
        // Users with a stocked pantry should land directly on meal discovery.
        const hasPantry = Object.values(stateRef.current.pantry ?? {}).some(g => g > 0);
        setCookPhase(hasPantry || (geminiMeals && geminiMeals.length > 0) ? "discover" : "groceries");
        setTab("Let's eat");
      });
      return;
    }
    setDialog({ type: "event", event: state.events.find(e=>e.id===event.id) ?? event });
  };
  const openDetails = (meal) => setDialog({ type: "details", meal });
  const addEvent = (eventDate) =>
    setDialog({
      type: "event",
      date: eventDate,
      event: {
        id: crypto.randomUUID(),
        title: "",
        start: localInstant(eventDate, "12:00"),
        end: localInstant(eventDate, "12:45"),
        kind: "meal",
        location: "",
        source: "manual",
        busy: true,
        readOnly: false,
        draft: true,
      },
    });
  const latest = logs.toSorted((a, b) =>
    (b.confirmedAt || "").localeCompare(a.confirmedAt || ""),
  )[0];
  const lastPlan = state.mealPlans
    .filter((p) => p.date === day && p.mealId && !p.openSlot && byId[p.mealId])
    .sort((a, b) => a.start.localeCompare(b.start))
    .at(-1);
  const lastMeal = lastPlan ? byId[lastPlan.mealId] : null;
  // Hide the hero card if this meal has been logged as eaten
  const lastPlanWasEaten = lastPlan && logs.some(
    (log) => log.mealId === lastPlan.mealId && log.date === lastPlan.date
  );
  const showLastPlan = lastPlan && lastMeal && !lastPlanWasEaten;
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
      <div className="ambient-scene" aria-hidden="true">
        <span className="ambient-orb a" />
        <span className="ambient-orb b" />
        <span className="ambient-orb c" />
        <span className="ambient-steam s1" />
        <span className="ambient-steam s2" />
        <span className="ambient-steam s3" />
      </div>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#today" onClick={() => setTab("Today")}>
            <span className="brand-mark">
              <Icon name="spark" size={22} />
            </span>
            <span className="brand-word">
              WhatsCooking<span className="brand-dot">.ai</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            {[
              ["Today", "grid"],
              ["My Meal Plan", "calendar"],
              ["Let's eat", "fork"],
              ["Grocery list", "cart"],
            ].map(([name, icon]) => (
              <button
                key={name}
                aria-current={tab === name ? "page" : undefined}
                onClick={async () => {
                  if (name === "Let's eat" && tab !== name) await refreshNextMeal();
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
              className="groceries-nav"
              aria-label="My groceries"
              onClick={() => setDialog({ type: "kitchen" })}
            >
              <Icon name="kitchen" />
              <span>My groceries</span>
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
                : tab === "My Meal Plan"
                  ? "Your calendar, meals and tasks in one place."
                  : tab === "Grocery list"
                    ? "Add what you need. Check it off as you shop."
                    : "Find a meal. Swipe to make it yours."}
            </p>
          </div>
          <div className="page-tools">
            {tab === "My Meal Plan" && (
              <button className="secondary" onClick={() => addEvent(date)}>
                + Schedule meal
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
            <div className="today-main reveal-stagger">
              <ComingUp
                items={items}
                date={day}
                now={now}
                connected={state.calendar.connected}
                onOpen={openEvent}
                onAdd={addEvent}
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
              {showLastPlan && lastMeal && (
                <section className="today-saved-meal">
                  <img
                    src={mealImage(lastMeal)}
                    alt={lastMeal.name}
                  />
                  <div>
                    <span className="eyebrow">YOUR MEAL PLAN</span>
                    <strong>{lastMeal.name}</strong>
                    <p>
                      {lastPlan.start} · {lastPlan.duration} min ·{" "}
                      {money(lastMeal.cost)} estimate
                    </p>
                  </div>
                  <div className="today-saved-actions">
                    <button
                      className="secondary"
                      onClick={() => openDetails(lastMeal)}
                    >
                      Details
                    </button>
                    {flags.mealLogging.available && (
                      <button
                        className="primary"
                        onClick={() => openLog(lastMeal)}
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
            <aside className="today-agenda reveal" style={{ animationDelay: "0.18s" }}>
              <Agenda
                items={items}
                date={day}
                now={now}
                connected={state.calendar.connected}
                onOpen={openEvent}
                onAdd={addEvent}
                onCalendar={() => setTab("My Meal Plan")}
              />
              <SidebarNotes date={day} />
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
        {tab === "My Meal Plan" && (
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
              <button
                className="secondary"
                style={{ marginLeft: "auto" }}
                onClick={async () => {
                  const ok = await safe({ type: "scheduleDayMeals", date });
                  if (ok !== false) {
                    setNotice(`Meal slots scheduled for ${date}. Tap a slot to choose a meal.`);
                    // Push the open slots to the backend so the Photon daemon can
                    // send iMessage reminders 5 minutes before each one.
                    try {
                      const slots = scheduleMealsForDay(items, date);
                      if (slots.length) {
                        await fetch("/api/sync-meal-plans", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            user_id: "demo",
                            plans: slots.map((s) => ({
                              meal_name: `${s.slot.charAt(0).toUpperCase() + s.slot.slice(1)} slot`,
                              meal_date: date,
                              meal_time: s.start,
                              meal_id:   null,
                            })),
                          }),
                        });
                      }
                    } catch {
                      // backend unreachable — reminders won't fire, but local plan is saved
                    }
                  }
                }}
              >
                🗓 Plan meals for this day
              </button>
            </div>
            <PlanCalendar
              onAddRange={(day,range)=>setDialog({type:"event",event:{id:crypto.randomUUID(),title:"",start:localInstant(day,range.start),end:localInstant(day,range.end),kind:"event",source:"manual",busy:true,readOnly:false,draft:true}})}
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
        {tab === "Let's eat" &&
          mode === "cook" &&
          cookPhase === "groceries" && (
            <CookStart
              key={`cook-start-${JSON.stringify(state.pantry)}`}
              state={state}
              onSuggested={acceptSuggestions}
              onBrowseLocal={()=>{setGeminiMeals(null);setCookPhase('discover');}}
              onUnavailable={(message)=>{setGeminiMeals(null);setCookPhase('discover');setError(message);}}
              onWindow={()=>setDialog({type:'time'})}
              onPreferences={()=>setDialog({type:'profile'})}
              onEatOut={() => setFoodMode("eatOut")}
            />
          )}
        {tab === "Let's eat" &&
          !(mode === "cook" && cookPhase === "groceries") && (
            <FoodDiscovery
              key={`${mode}-${state.context.date}-${state.context.start}-${state.context.available}-${geminiMeals?.join(",") || "catalog"}-${state.events.length}`}
              state={state}
              mode={mode}
              onMode={setFoodMode}
              onChoose={choose}
              onVenue={(venue) => setDialog({ type: "venue", venue })}
              onVenueDirections={(venue) => {
                window.location.assign(directionsUrl(venue));
              }}
              onDetails={openDetails}
              onPreferences={() => setDialog({ type: "profile" })}
              onWindow={() => setDialog({ type: "time" })}
              onUndoPlan={() => safe({ type: "undo" })}
              onChangeGroceries={() => {
                safe({ type: "clearGeminiMeals" });
                setCookPhase("groceries");
              }}
              geminiMeals={mode === "cook" && geminiMeals ? geminiMeals.map(id=>byId[id]).filter(Boolean) : null}
              onReview={meal=>setDialog({type:"reviewRecipe",meal})}
              groceryList={groceryList}
              onMoreIdeas={geminiMeals ? moreIdeas : null}
              onPrepareMore={geminiMeals ? prepareMore : null}
            />
          )}
        {tab === "Grocery list" && (
          <GroceryListView
            items={state.shoppingList ?? []}
            onChange={(shoppingList) =>
              safe({ type: "updateShoppingList", shoppingList })
            }
          />
        )}
        <footer className="compact-footer">
          <span>WhatsCooking.ai · meals that fit your day</span>
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
      <button
        className="floating-assistant"
        aria-label={nudges.length && !nudgesSeen ? "Open food assistant (new suggestion)" : "Open food assistant"}
        onClick={() => { setNudgesSeen(true); setDialog({ type: "assistant" }); }}
      >
        <Icon name="spark" size={22} />
        {nudges.length > 0 && !nudgesSeen && (
          <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: "50%", background: "#e8743b", boxShadow: "0 0 0 2px #fff" }} />
        )}
      </button>
      {/* First run: a quick setup (goal, diet, allergies, tastes), by taps or one spoken sentence. */}
      {!dialog && !state.profile.onboarded && (
        <Onboarding state={state} agent={agentBridge} onSave={dispatch} onClose={() => setNotice("You're all set. Change anything later in Food preferences.")} />
      )}
      {dialog?.type === "reviewRecipe" && <RecipeReview meal={dialog.meal} state={state} onSave={dispatch} onChoose={(id) => choose(stateRef.current.generatedMeals.find((m) => m.id === id) ?? dialog.meal)} onClose={close}/> }
      {dialog?.type === "calendar" && (
        <CalendarConnect
          state={state}
          date={tab === "My Meal Plan" ? date : day}
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
        <Assistant state={state} onAction={dispatch} onClose={close} agent={agentBridge} />
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
            onEdit={(log) => {
              const meal = byId[log.mealId];
              if (meal) openLog(meal, log);
            }}
            onRemove={(log) => setDialog({ type: "removeLog", log })}
          />
        </Modal>
      )}
      {dialog?.type === "log" && (
        <Log
          data={dialog}
          onSave={dispatch}
          onClose={close}
          onLogged={(meal) => {
            // After logging a meal, ask which ingredients got used up
            const mealObj = meal ?? dialog.meal;
            if (mealObj?.ingredients?.length) {
              // Find ingredients that are in the pantry (fuzzy match same as engine)
              const pantryKeys = Object.keys(state.pantry).filter(
                (k) => (state.pantry[k] ?? 0) > 0,
              );
              const usedIngredients = mealObj.ingredients
                .map((ing) => {
                  const stripped = ing.name
                    .replace(/\s*\(.*?\)\s*/g, "")
                    .replace(
                      /^[\d\s/\u00BC-\u00BE\u2150-\u215E]*(?:cup|tbsp?|tsp?|oz|g|ml|lb|block|can|clove|head|bunch|slice|piece|sprig|handful|pinch|dash|package|pkg|bag)s?\s+(?:of\s+)?/i,
                      "",
                    )
                    .replace(/^[\d\s/\u00BC-\u00BE\u2150-\u215E]+/, "")
                    .trim()
                    .toLowerCase();
                  const key =
                    pantryKeys.find((k) => k.toLowerCase() === ing.name.toLowerCase()) ??
                    pantryKeys.find((k) => k.toLowerCase() === stripped) ??
                    pantryKeys.find(
                      (k) => stripped.includes(k.toLowerCase()) || k.toLowerCase().includes(stripped),
                    );
                  return key ? { display: key, original: ing.name } : null;
                })
                .filter(Boolean)
                .filter((v, i, arr) => arr.findIndex((x) => x.display === v.display) === i);

              if (usedIngredients.length) {
                setDialog({ type: "usedUp", meal: mealObj, ingredients: usedIngredients });
                return;
              }
            }
            setNotice("Meal recorded. Use Undo to reverse it, or Meal log to edit a portion.");
          }}
        />
      )}
      {dialog?.type === "replace" && (
        <Confirm
          title="Replace this planned meal?"
          onClose={close}
          button="Confirm replacement"
          onConfirm={async () => {
            const mealName = dialog.meal.name;
            await dispatch({ type: "choose", mealId: dialog.meal.id });
            setNotice(`${mealName} replaced your planned meal.`);
            close();
            setTab("Today");
            setError("");
          }}
        >
          <p>
            Replace{" "}
            <strong>
              {byId[dialog.existing.mealId]?.name ?? "your planned meal"}
            </strong>{" "}
            with <strong>{dialog.meal.name}</strong> at {state.context.start} on{" "}
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
            {byId[dialog.log.mealId]?.name ?? "This meal"} ·{" "}
            {dialog.log.servings} servings. Your subtotal will be recalculated.
            You can undo this removal.
          </p>
        </Confirm>
      )}
      {dialog?.type === "usedUp" && (
        <UsedUpDialog
          meal={dialog.meal}
          ingredients={dialog.ingredients}
          onDone={async (finishedKeys) => {
            if (finishedKeys.length) {
              const pantry = { ...state.pantry };
              for (const key of finishedKeys) delete pantry[key];
              await safe({ type: "updatePantry", pantry });
              setNotice(
                `Removed ${finishedKeys.join(", ")} from your pantry. Meal recorded.`,
              );
            } else {
              setNotice("Meal recorded. Use Undo to reverse it, or Meal log to edit a portion.");
            }
            close();
          }}
          onClose={() => {
            setNotice("Meal recorded. Use Undo to reverse it, or Meal log to edit a portion.");
            close();
          }}
        />
      )}
      {dialog?.type === "reset" && (
        <Confirm
          title="Start a fresh demo?"
          onClose={close}
          button="Reset local demo"
          onConfirm={() => {
            stateRef.current=storageAdapter.reset(window.localStorage); restoreSuggestions([]); setState(stateRef.current);
            setStorageError(null);
            setNotice("Sample preferences restored.");
            close();
          }}
        >
          <p>
            This removes this browser’s WhatsCooking.ai preferences, pantry, calendar
            copies, meal plans and confirmed logs. Apple Calendar is unchanged.
          </p>
        </Confirm>
      )}
      {dialog?.type === "about" && (
        <Modal title="How this version works" onClose={close} wide>
          <div className="about-sections">
            <section>
              <h3>Today, My Meal Plan, Let’s eat, Grocery list</h3>
              <p>
                Today is your next activity and full day’s agenda. My Meal Plan is
                the calendar. Let’s eat has separate Cook and Eat at school swipe
                decks. Grocery list is for items to pick up while you shop.
              </p>
            </section>
            <section>
              <h3>How meals are chosen</h3>
              <p>
                A deterministic planner checks calendar conflicts, full activity
                time, budget, ingredients, equipment and dietary restrictions.
                It checks both the curated library and Gemini recipe drafts.
                Your food and cuisine preferences guide the order; daily nutrition
                goals show progress. The assistant can update your local schedule,
                preferences and groceries, with Undo and confirmation for sensitive
                changes. Gemini interprets requests; these checks decide what fits.
              </p>
            </section>
            <section>
              <h3>Real UW places, clear data limits</h3>
              <p>
                Restaurant locations, public hours and menu links come from
                official UW HFS pages. Dated dish listings retain their published
                prices, portions and nutrition when available. Walking estimates
                come from Google Routes starting at the HUB; venue browsing falls
                back to straight-line distances when routes are unavailable.
                Unpublished nutrients, cross-contact, stock and queues stay unknown.
              </p>
            </section>
            <section>
              <h3>Food images & nutrition</h3>
              <p>
                Meal pictures are AI-generated representative illustrations.
                Cook nutrition is estimated from reviewed USDA ingredient records
                and recipe grams. Missing values stay unknown; partial nutrient
                subtotals are labeled. Campus dishes keep their official UW facts.
              </p>
            </section>
            <section>
              <h3>Your data</h3>
              <p>
                Apple Calendar uses a local Mac helper after permission; Google
                Calendar and .ics import are also available. Imported events are
                read-only. Plans and logs stay in this browser; optional backend
                integrations save pantry items, recipes and food preferences.
                Phone reminders require setup. The app does not order food or
                write to your external calendars.
              </p>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
