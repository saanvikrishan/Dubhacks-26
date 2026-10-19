import { minutes } from "../domain/engine.js";
export const money = (n) => (n == null ? "Unknown price" : `$${n.toFixed(2)}`);
// Nutrition reads naturally: whole numbers from 10 up (613 kcal), one decimal below (5.7 g).
export const num = (n) =>
  n == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) >= 10 ? 0 : 1 }).format(n);
export const niceTime = (t) => {
  const m = minutes(t);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
};

/** Animated plate + steam — used until a real dish photo resolves. */
export const MEAL_IMAGE_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#e4f0e8"/>
          <stop offset="1" stop-color="#d2e4d6"/>
        </linearGradient>
        <radialGradient id="plate" cx="50%" cy="48%" r="42%">
          <stop stop-color="#ffffff"/>
          <stop offset=".75" stop-color="#f4f7f1"/>
          <stop offset="1" stop-color="#c9d9cc"/>
        </radialGradient>
        <style>
          .steam { animation: rise 5.2s ease-in-out infinite; transform-origin: center bottom; }
          .steam2 { animation-delay: .9s; }
          .steam3 { animation-delay: 1.8s; }
          .bite { animation: pulse 5.5s ease-in-out infinite; transform-origin: 384px 360px; }
          .spin { animation: slowspin 28s linear infinite; transform-origin: 384px 390px; opacity:.22; }
          @keyframes rise {
            0%,100% { opacity:.08; transform: translateY(6px) scaleY(.92); }
            50% { opacity:.28; transform: translateY(-12px) scaleY(1.05); }
          }
          @keyframes pulse {
            0%,100% { transform: scale(1); }
            50% { transform: scale(1.015); }
          }
          @keyframes slowspin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        </style>
      </defs>
      <rect width="768" height="768" fill="url(#bg)"/>
      <ellipse cx="384" cy="520" rx="210" ry="36" fill="#9fbaa855"/>
      <g class="spin" opacity=".35">
        <circle cx="384" cy="390" r="168" fill="none" stroke="#7eaa8c" stroke-width="10" stroke-dasharray="28 22"/>
      </g>
      <g class="bite">
        <circle cx="384" cy="390" r="150" fill="url(#plate)"/>
        <circle cx="384" cy="390" r="118" fill="#e8f3ea"/>
        <ellipse cx="340" cy="370" rx="38" ry="28" fill="#6fb892"/>
        <ellipse cx="410" cy="360" rx="34" ry="26" fill="#e0b56a"/>
        <ellipse cx="390" cy="420" rx="42" ry="30" fill="#c45c3888"/>
        <circle cx="355" cy="410" r="14" fill="#2a9a6c"/>
        <circle cx="430" cy="405" r="12" fill="#d4a017"/>
      </g>
      <g fill="#ffffffcc" stroke="none">
        <path class="steam" d="M330 300c0-28 18-42 18-70"/>
        <path class="steam steam2" d="M384 290c0-32 16-48 16-78" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
        <path class="steam steam3" d="M438 300c0-28 18-42 18-70" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
        <path class="steam" d="M330 300c0-28 18-42 18-70" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
      </g>
    </svg>`,
  );

export function isMealPlaceholder(url) {
  return (
    !url ||
    url === MEAL_IMAGE_PLACEHOLDER ||
    (typeof url === "string" && url.startsWith("data:image/svg"))
  );
}

// ── Meal photos ─────────────────────────────────────────────────────────────
// Each Cook recipe and each published UW menu item gets one AI photo, generated and
// accuracy-checked by the backend (POST /api/food/image) and cached there for good.
// Campus photos are labelled as AI images, never as dining-hall photography.
const generated = new Map(); // request key -> image URL, or null after a failure
const BUNDLED = { pasta: "/food/pasta.png", chickpeas: "/food/chickpeas.png", tofu: "/food/tofu.png" };

const isCampusDish = (meal) => Boolean(meal?.name && meal.dining);
const canGenerate = (meal) =>
  isCampusDish(meal) || (Boolean(meal?.name) && meal.mode !== "eatOut" && (meal.ingredients?.length ?? 0) > 0);

function imageRequest(meal) {
  if (isCampusDish(meal)) {
    const portion = /unpublished/i.test(meal.portionLabel ?? "") ? "" : meal.portionLabel ?? "";
    const place = [meal.venue?.station, portion].filter(Boolean).join(", ").slice(0, 80);
    return { name: String(meal.name).trim().slice(0, 80), ingredients: [], setting: "campus", ...(place ? { place } : {}) };
  }
  const ingredients = [...meal.ingredients]
    .sort((a, b) => (b.grams ?? 0) - (a.grams ?? 0))
    .slice(0, 6)
    .map((i) => String(i.name ?? "").trim().toLowerCase())
    .filter(Boolean);
  return {
    name: String(meal.name).trim().slice(0, 80),
    ingredients,
    ...(meal.cuisines?.[0] ? { cuisine: meal.cuisines[0] } : {}),
    ...(meal.dishType ? { dishType: meal.dishType } : {}),
  };
}
/** The photo request for a recipe or campus dish, or null; used to start a prepared batch's photos. */
export const photoRequestFor = (meal) => (canGenerate(meal) ? imageRequest(meal) : null);
const requestKey = (req) => JSON.stringify([req.setting ?? "home", req.place ?? "", req.name.toLowerCase(), [...req.ingredients].sort()]);

/** Kept for existing callers; random tagged stock photos are no longer used. */
export function taggedMealImage() {
  return MEAL_IMAGE_PLACEHOLDER;
}

// ── Photo store ─────────────────────────────────────────────────────────────
// Each photo is tracked by the server's photo key: recipes arrive with one (the server already
// started drawing them); other dishes get one from /predraw. One cheap status request every
// 1.5 s reports which are ready, so decks can show only cards whose photo has loaded.
const serverKeys = new Map(); // request key -> server photo key
const requests = new Map(); // request key -> photo request
const trackedAt = new Map(); // request key -> when tracking started
const waiters = new Map(); // request key -> resolve callbacks
const listeners = new Set();
let version = 0;
let pollTimer = null;
const GIVE_UP_MS = 120000;

export const subscribePhotos = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const photoVersion = () => version;

function settle(key, url) {
  if (generated.has(key)) return;
  generated.set(key, url);
  serverKeys.delete(key);
  version++;
  for (const listener of listeners) listener();
  for (const resolve of waiters.get(key) ?? []) resolve(url ?? MEAL_IMAGE_PLACEHOLDER);
  waiters.delete(key);
}

/** 'ready', 'failed' or 'pending'. Cards that never get generated photos count as ready. */
export function photoState(meal) {
  if (!canGenerate(meal)) return "ready";
  const key = requestKey(imageRequest(meal));
  if (!generated.has(key)) return "pending";
  return generated.get(key) ? "ready" : "failed";
}

async function drawNow(key) {
  serverKeys.delete(key);
  try {
    const response = await fetch("/api/food/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requests.get(key)),
      signal: AbortSignal.timeout(90000),
    });
    const data = response.ok ? await response.json() : {};
    settle(key, typeof data.url === "string" && data.url.startsWith("/api/food/image/") ? data.url : null);
  } catch {
    settle(key, null);
  }
}

function poll(delay = 1500) {
  if (pollTimer || !serverKeys.size) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    const waiting = [...serverKeys].slice(0, 16);
    try {
      const keys = [...new Set(waiting.map(([, server]) => server))].join(",");
      const response = await fetch(`/api/food/image-status?keys=${keys}`);
      const status = response.ok ? await response.json() : {};
      for (const [key, server] of waiting) {
        const state = status[server]?.status;
        if (state === "ready") settle(key, status[server].url);
        else if (state === "failed" || Date.now() - trackedAt.get(key) > GIVE_UP_MS) settle(key, null);
        else if (state === "none") void drawNow(key);
      }
    } catch {
      /* try again on the next tick */
    }
    poll();
  }, delay);
  pollTimer.unref?.(); // in Node (tests), background polling never keeps the process alive
}

/** Start (or join) photos for these meals and keep polling until each is ready or has failed. */
export function trackMealPhotos(meals) {
  const ask = [];
  for (const meal of meals ?? []) {
    if (!canGenerate(meal)) continue;
    const req = imageRequest(meal);
    const key = requestKey(req);
    if (generated.has(key) || requests.has(key)) continue;
    requests.set(key, req);
    trackedAt.set(key, Date.now());
    if (/^[0-9a-f]{32}$/.test(meal.photoKey ?? "")) serverKeys.set(key, meal.photoKey);
    else ask.push(key);
  }
  for (let i = 0; i < ask.length; i += 16) {
    const batch = ask.slice(i, i + 16);
    fetch("/api/food/image/predraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: batch.map((key) => requests.get(key)) }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("predraw"))))
      .then((data) => {
        batch.forEach((key, n) => (/^[0-9a-f]{32}$/.test(data.keys?.[n] ?? "") ? serverKeys.set(key, data.keys[n]) : settle(key, null)));
        poll(0);
      })
      .catch(() => batch.forEach((key) => settle(key, null)));
  }
  poll(0); // already-drawn photos show at once
}

export function resolveMealImage(meal) {
  if (!canGenerate(meal)) return Promise.resolve(mealImage(meal));
  const key = requestKey(imageRequest(meal));
  if (generated.has(key)) return Promise.resolve(generated.get(key) ?? MEAL_IMAGE_PLACEHOLDER);
  trackMealPhotos([meal]);
  return new Promise((resolve) => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
}

/** Recipes from the server are already being drawn, so tracking them only polls. */
export function prefetchMealImages(meals) {
  trackMealPhotos((meals ?? []).slice(0, 8));
}

export function mealImage(meal) {
  if (!meal) return MEAL_IMAGE_PLACEHOLDER;
  if (canGenerate(meal)) {
    const key = requestKey(imageRequest(meal));
    // Cards that do not call resolveMealImage (e.g. Today) still get their photo on the next render.
    if (!generated.has(key) && typeof window !== "undefined") trackMealPhotos([meal]);
    return generated.get(key) ?? MEAL_IMAGE_PLACEHOLDER;
  }
  // Dining and other non-recipe cards keep their bundled art or a published photo URL.
  if (!meal.suggestion && BUNDLED[meal.photo]) return BUNDLED[meal.photo];
  for (const field of ["imageUrl", "photo"]) {
    if (typeof meal[field] === "string" && /^https?:\/\//.test(meal[field])) return meal[field];
  }
  return MEAL_IMAGE_PLACEHOLDER;
}

export const photoFor = (meal) => mealImage(meal);
