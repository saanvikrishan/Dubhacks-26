# WhatsCooking.ai

WhatsCooking.ai helps you turn what you have, and the time you actually have, into a meal. You set food preferences, get recipe ideas from a grocery list or a fridge photo, place a meal on your day, and get an iMessage before it is time to cook or choose.

The app lives in this `fridgemate/` directory:

```
fridgemate/
  frontend/   # Vite + React UI
  backend/    # FastAPI (recipes, vision, pantry, calendar, enrollment)
  photon/     # Spectrum iMessage reminder poller
  backend/.env   # secrets; the poller reads this file
```

## Core flow

1. Open **Food preferences** and set diet, allergens, cuisines, and an optional reminder phone.
2. On **Let's eat**, add groceries or upload a fridge photo. WhatsCooking.ai suggests meals that fit the list, the meal window, and your preferences. Ingredient substitutions appear on the meal when something is missing.
3. Choose a meal to put it on **My Meal Plan**, or use **Eat at school** for UW dining.
4. On **Today** or **My Meal Plan**, schedule a meal, plan the day's open slots, or import a calendar.
5. With the poller running and the phone activated, WhatsCooking.ai texts a reminder up to 5 minutes before the slot.

## Architecture

| Part | Path | Role |
| --- | --- | --- |
| Frontend | `fridgemate/frontend` | Today, My Meal Plan, and Let's eat. Vite proxies `/api/*` to the backend and strips the `/api` prefix. |
| Backend | `fridgemate/backend` | FastAPI on port 8000. Gemini recipes and fridge vision, USDA nutrition, pantry and saved meals, Google Calendar, phone enrollment. |
| Poller | `fridgemate/photon` | A separate Node process. Every 30 seconds it reads `photon_plans` and sends one iMessage per slot that is still in the future and inside a 5-minute lead. |

The UI keeps the calendar in browser storage. Saving a meal (`Schedule a meal` → `Save meal`) also POSTs to `http://127.0.0.1:8000/sync-schedule-events`. **Plan meals for this day**, and choosing a meal into an open slot, POST to `/sync-meal-plans`. The poller does not import the FastAPI app. It only needs Postgres and the Spectrum project credentials in `backend/.env`.

## Setup

### Prerequisites

- Node.js 22.12+ and npm
- Python 3.11+ (3.14 works)
- PostgreSQL, including Tiger Data, if you want pantry sync, saved meals, and reminders
- A Spectrum project if you want iMessage reminders
- Apple Calendar import also needs a Mac with Apple Command Line Tools (`xcrun swiftc`)

### Environment variables

Keep secrets in `fridgemate/backend/.env` or `fridgemate/.env`. The backend loads `backend/.env` first, then the parent `.env`. The poller reads **only** `fridgemate/backend/.env`. Never prefix these with `VITE_`.

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_RECIPE_MODEL=
GEMINI_IMAGE_MODEL=
GEMINI_IMAGE_CHECK_MODEL=
MEAL_IMAGE_DAILY_LIMIT=200
MEAL_IMAGE_WARM_LIMIT=40
MEAL_IMAGE_WARM=
BACKBOARD_API_KEY=
BACKBOARD_ASSISTANT_ID=
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
DAYWELL_USER_ID=demo
USDA_API_KEY=
GOOGLE_MAPS_API_KEY=
KROGER_CLIENT_ID=
KROGER_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
```

`TIGER_DATABASE_URL` is accepted in place of `DATABASE_URL`. `FDC_API_KEY` is accepted in place of `USDA_API_KEY`. The poller uses `BACKEND_URL` when it asks for a personalized cooking note (default `http://127.0.0.1:8000`). Vite uses `DAYWELL_BACKEND_URL` or `DAYWELL_DINING_BACKEND_URL` only to point the dev proxy somewhere other than `http://127.0.0.1:8000`.

What you can skip:

- Without `GEMINI_API_KEY`, recipe and fridge-photo calls fail. The rest of the server still starts.
- Without `DATABASE_URL`, pantry and saved-meal routes return `local_only` and the UI still works. Reminders cannot be stored.
- Without `USDA_API_KEY`, meal suggestions keep Gemini's nutrition estimates. A free key is at https://fdc.nal.usda.gov/api-key-signup.html
- Without `BACKBOARD_API_KEY`, preference memory is skipped.
- Without `GOOGLE_MAPS_API_KEY`, campus walking times stay unknown. Venue direction links still work.
- Without `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`, grocery price lookup is unavailable.
- Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, Google Calendar connect fails.
- Without `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`, phone enrollment and the poller fail.

`fridgemate/.env.example` still lists `MONGODB_URI`, `MONGODB_DATABASE`, `PHOTON_API_KEY`, and `PHOTON_WEBHOOK_SECRET`. Current code does not read those names.

### Install

```sh
cd fridgemate/backend
python -m venv .venv
```

Activate it (`.venv\Scripts\activate` on Windows, `source .venv/bin/activate` on macOS or Linux), then:

```sh
pip install -r requirements.txt
```

`pillow` is in that file. Meal photos fail to import without it.

```sh
cd fridgemate/frontend
npm ci
```

```sh
cd fridgemate/photon
npm install
```

### Run

Start the backend from `fridgemate/backend`:

```sh
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend from `fridgemate/frontend`:

```sh
npm run dev -- --host 127.0.0.1
```

Open the Local URL Vite prints, usually http://127.0.0.1:5173/. Cook starts from **Let's eat**: add ingredients or upload a fridge photo. Those calls go to `/api/recipes` and `/api/vision/ingredients`, which Vite forwards to port 8000. Restart Vite after `vite.config.js` proxy changes.

Start the poller from `fridgemate/photon`, and leave it running:

```sh
node remind.mjs
```

It prints `Photon reminders polling every 30s (fires 5 min before each slot).` Spectrum connects on the first send. Ticks with nothing due print nothing.

Optional checks, from `fridgemate/frontend`:

```sh
npm test
npm run build
npm run lint
```

## Features

- **Meal planning and recipes.** Let's eat takes a grocery list or a fridge photo and asks Gemini for meals that fit the window and preferences. Choosing one adds it to My Meal Plan and, when Postgres is configured, to `saved_meals`.
- **Ingredient substitutions.** Missing ingredients are called out on the meal, with a swap when one is known. The backend route is `POST /recipes/substitute`.
- **Internal schedule.** **Schedule a meal** (the My Meal Plan **+** button, or the empty-state button) opens a dialog. **Save meal** stores the event locally and syncs it for reminders. **Plan meals for this day** adds an open breakfast, lunch, or dinner slot where that window is free, and syncs those slots too.
- **Google Calendar.** **Connect Google Calendar** on My Meal Plan uses read-only OAuth (`calendar.readonly`). Imported events sync into reminders. WhatsCooking.ai cannot create events in Google Calendar.
- **Apple Calendar and ICS.** **Connect Apple Calendar** reads calendars on this Mac through the Vite server. On any system, an `.ics` import updates Today and My Meal Plan without that bridge.
- **UW dining.** Eat at school uses the reviewed campus catalog. Walking times need `GOOGLE_MAPS_API_KEY`. See `README-UW-DINING.md` for ingest and review.
- **iMessage reminders.** The poller texts the phone saved for user `demo`.
  - An open slot gets a 5-minute warning that names WhatsCooking.ai.
  - A slot with a chosen meal gets “Let's Get Cooking!” plus a short note when the backend can write one.
  - **Auto-enrollment.** In Food preferences, enter the phone as E.164 (`+1XXXXXXXXXX`) and save. Saving a new or changed number calls `POST /api/enroll-phone` before the profile is stored. Spectrum returns the sender line for that number, and the page tells you to text it.
  - **One-time handshake.** Enrollment does not by itself let texts through. You must send one iMessage to the sender the page shows. Each enrolled number can be assigned a different Photon line, and texting an older line does not activate a newer one. Saving the same number again does not re-enroll it. Saving a different number replaces the single `demo` contact, and that new number needs its own text to its own sender.

## Known limitations

- The poller fires when a slot is inside the next 5 minutes, so the text can arrive a few minutes before the clock time on the event. In testing, Spectrum accepted the send in under a second and Apple reported delivery within a few seconds. Delivery can still take longer, up to a few minutes, before the bubble shows on the phone.
- The reminder body for an open slot does not include the meal title. Two reminders can look identical.
- The app stores one reminder phone, on user id `demo` (or `DAYWELL_USER_ID`). Spectrum keeps every number you have enrolled, but the poller texts only the current contact.
- Deleting a meal in the UI does not delete its `photon_plans` row. An all-day event is not synced. A sync failure is swallowed so the on-screen save can still succeed.
- Google Calendar tokens are kept in memory and disappear when the backend restarts. `google-auth-oauthlib` is imported for that flow and is not listed in `requirements.txt`; connect fails until it is installed.
- Apple Calendar connect returns an error off a Mac, or when the local Vite server is not the process serving the app. Use `.ics` import in that case. The bridge's own message still says “Daywell”.
- `POST /preferences` can succeed while Backboard memory logging fails. Preferences are still saved.
- The poller's captured terminal output can lag behind the send. A row in `photon_sent` means the send call returned.

## Tech stack

- Frontend: React 19, Vite 8, `ical.js`
- Backend: FastAPI, Uvicorn, Pydantic, SQLAlchemy, psycopg, Pillow, HTTPX, `google-genai`, `backboard-sdk`
- Data: PostgreSQL, USDA FoodData Central, optional Kroger and Google Maps
- Reminders: Node.js, `pg`, `spectrum-ts` 12.11.0, Spectrum iMessage
