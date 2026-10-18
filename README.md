# WhatsCooking.ai

**Cook what you already have, in the time you actually have.**

WhatsCooking.ai helps busy college students decide what to eat, use their groceries, and fit meals around classes and commitments. It connects food preferences, available ingredients, and a daily schedule in one meal-planning experience. Built for DubHacks 2026, this is a working local demo with optional live integrations, not a production nutrition or allergy-certification service.

## The experience

1. **Make it yours.** Onboard with selectable preferences or a spoken introduction. Review the preview, then save. Add or remove standard and custom allergies; set an optional meal budget, cuisines, tastes, kitchen equipment, and editable nutrition goals.
2. **Find time.** Use Today and My Meal Plan, create local events or meal slots, import an ICS file, or connect Apple/Google Calendar. The app accounts for preparation, cooking, eating, cleanup, travel, and the next commitment.
3. **Decide what to eat.** In Let's eat, enter groceries, use your saved pantry, or scan a fridge photo. Browse recipe cards, pass on dishes, request more ideas, or explore reviewed UW campus dining.
4. **Review and plan.** Check a suggested recipe's ingredients, quantities, equipment, cost, and dietary details before choosing it. Missing groceries can join the shopping list. Planning and logging consumption are separate actions.
5. **Follow through.** Log what you ate to update nutrition totals. With Postgres, Spectrum, an enrolled phone, and the separate reminder worker configured, receive an iMessage before a meal slot.

## Implemented features

| Area | Current implementation |
| --- | --- |
| Meal decisions | Deterministic eligibility checks, calendar conflicts, explicit priorities, cuisine variety, mood/flavor controls, and learned preference ordering. Mood/flavor broaden locally when no exact match exists. Allergies and dietary restrictions do not become soft preferences. |
| Recipes and photos | Gemini produces three recipe drafts by default; more are requested on demand. Requests are validated, cached and coalesced. Generated meal photos have bounded queues, caching and budgets, and are labeled illustrations. Empty/error recipe responses expose local recipe browsing without an automatic paid retry. |
| Food preferences | Eleven cuisines, six taste preferences, preferred/disliked foods, avoided cuisines, six onboarding goals, editable nutrition targets, custom allergies, and a clearable budget. A blank budget means no spending cap; zero remains a real zero-dollar cap. |
| Pantry and groceries | Editable ingredient grams, fridge-photo ingredient suggestions, grocery/shopping lists, saved cooking sessions, and optional database persistence. Photo output requires user review. |
| Nutrition and pricing | 131 reviewed USDA ingredient mappings, grams-based calculations, labeled partial coverage, and 13 reviewed QFC University Village product mappings through Kroger. Ingredient-use cost and package-purchase cost are distinct; unknown facts remain unknown. |
| UW dining | Reviewed menu/station records, published positive allergen indicators, venue hours and directions, plus Google walking estimates when configured. Missing/future menu data is shown as uncertainty. |
| Assistant and voice | Typed Gemini function-calling assistant, validated local actions, confirmation and Undo, notes, meal suggestions, voice transcription and spoken replies. Onboarding speech previews preferences before saving. Local schedule/grocery nudges need no model call. |
| Memory | Backboard feedback for chose/logged/skipped meals, anonymous per-browser preference learning, remembered facts, and photo indexing. Existing browser and remote memory identities are preserved by compatibility reads. |
| Calendar | Today, agenda/week/month views, recurring ICS events, local tasks/notes, manual busy overrides, automatic meal-window context, Apple EventKit helper, and read-only Google Calendar import. |
| Reminders | Separate Spectrum iMessage poller, phone enrollment/handshake, and Postgres-backed plans and send records. This is optional and can send real messages when started. |

## Architecture

```text
whatscooking/
  frontend/   React 19 + Vite 8; browser state, domain rules, UI, local calendar bridge
  backend/    FastAPI + Pydantic; Gemini, Backboard, food data, calendar and database APIs
  photon/     Node + pg + spectrum-ts; optional iMessage reminder worker
```

The active source directory is `whatscooking/`, matching the latest teammate rename. Product references use **WhatsCooking.ai**. Internal compatibility keys and historic assistant names are intentionally retained so existing data remains usable.

The browser is authoritative for the full profile, calendar, meal plans and consumption logs. `domain/state.js` validates transitions; `domain/engine.js` decides eligibility; `domain/discovery.js` orders feasible options and separates drafts requiring review. Gemini proposes recipes and assistant actions; it does not declare a meal safe or mutate browser state directly.

During development, Vite forwards `/api/*` to FastAPI, except the local Apple Calendar middleware. FastAPI uses optional Postgres/Tiger Data storage and provider adapters. The reminder worker independently polls Postgres. See [architecture and ownership](docs/ARCHITECTURE.md) and [the agent handoff](docs/CODEX-HANDOFF-AGENT-VOICE-ONBOARDING.md).

## Setup

### Requirements

- Node.js 22.12+ and npm; Python 3.11+.
- macOS and Apple Command Line Tools for Apple Calendar import. ICS import works without that helper.
- Optional PostgreSQL/Tiger Data and provider accounts for the integrations below.

Clone the repository, then run these commands **from the repository root**:

```sh
git clone https://github.com/saanvikrishan/Dubhacks-26.git
cd Dubhacks-26
python3 -m venv whatscooking/backend/.venv
whatscooking/backend/.venv/bin/python -m pip install -r whatscooking/backend/requirements-dev.txt
npm ci --prefix whatscooking/frontend
```

On Windows, use the virtualenv's `Scripts/python.exe` in place of `.venv/bin/python`. `requirements-dev.txt` includes runtime dependencies and the backend test transport; use `requirements.txt` alone for runtime installation.

### Configuration

Create your own secret configuration locally; never commit it or expose provider keys with a `VITE_` prefix. FastAPI loads `whatscooking/backend/.env` and then `whatscooking/.env`, preserving already-set process variables. The reminder worker reads only `whatscooking/backend/.env`. This audit did not modify existing `.env` files.

| Integration | Variable names |
| --- | --- |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_RECIPE_MODEL`, `GEMINI_AGENT_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` |
| Meal photos | `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_CHECK_MODEL`, `MEAL_IMAGE_DAILY_LIMIT`, `MEAL_IMAGE_WARM_LIMIT`, `MEAL_IMAGE_WARM` |
| Backboard | `BACKBOARD_API_KEY`, `BACKBOARD_ASSISTANT_ID` |
| Database and reminder identity | `DATABASE_URL` or `TIGER_DATABASE_URL`, `WHATSCOOKING_USER_ID` |
| USDA | `USDA_API_KEY` or `FDC_API_KEY` |
| Kroger | `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` |
| Walking estimates | `GOOGLE_MAPS_API_KEY` |
| Google Calendar OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Spectrum reminders | `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`, `BACKEND_URL` |
| Vite proxy process overrides | `WHATSCOOKING_BACKEND_URL`, `WHATSCOOKING_DINING_BACKEND_URL` |

Without provider credentials, local state, calendar editing/ICS, reviewed reference data, local recipe browsing, and deterministic decisions remain available. Live recipe/vision/voice requests need Gemini; saved reference data does not require a live USDA lookup. Database routes fall back to local-only operation when Postgres is absent. Backboard memory, live prices/routes, Google connection, and messaging each need their corresponding configuration. Older environment aliases remain supported. Historical names in example files do not imply an implemented MongoDB or webhook integration.

### Run locally

In terminal 1, from the repository root:

```sh
cd whatscooking/backend
MEAL_IMAGE_WARM=0 .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
```

In terminal 2, from the repository root:

```sh
cd whatscooking/frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. Backend API documentation is at `http://127.0.0.1:8000/docs`. Google OAuth's current callback posts to `http://localhost:5173`, so use that browser origin for Google connection. The registered redirect must match the backend's `http://localhost:8000/google-calendar/callback/` address.

`MEAL_IMAGE_WARM=0` disables startup photo warming; entering Cook can still request photos or prepared recipes. Do not repeatedly exercise live generation as a test. The automated checks below use mocks.

For optional iMessage reminders, install and start the worker in a third terminal:

```sh
npm ci --prefix whatscooking/photon
cd whatscooking/photon
node remind.mjs
```

Save an international-format phone number in Food preferences, then send the one-time activation message to the sender line shown by the app. Run the worker only when you intend to send reminders. It polls every 30 seconds and sends for upcoming slots within five minutes; delivery timing is external.

## Verify

From the repository root:

```sh
npm test --prefix whatscooking/frontend
npm run lint --prefix whatscooking/frontend
npm run build --prefix whatscooking/frontend
(cd whatscooking/backend && .venv/bin/python -m unittest discover -s tests)
```

Tests cover state transitions, calendar behavior, recipe review, restrictions, nutrition, provider request boundaries, memory compatibility, assistant/voice contracts, and fallback behavior. Provider calls are mocked. Release results and browser-flow coverage are recorded in [verification](docs/VERIFICATION.md).

`npm run build` generates `frontend/dist`. `npm run preview` previews those static assets; it is not a production API deployment. Deployment must supply equivalent API routing, secure provider configuration, and a host-specific calendar strategy. Apple Calendar requires the local Mac helper.

## Limits and next steps

- **Safety and data coverage:** custom allergies use bounded, normalized ingredient-name checks. They cannot identify every derivative, hidden ingredient or cross-contact risk. Unknown allergy coverage remains blocked from feasible recommendations; recipe review records user confirmation, not independent certification. Newly added restrictions invalidate earlier review coverage.
- **Recipe review:** the existing quick-confirm flow can raise pantry amounts to recipe requirements, add equipment, and add shopping items. With a numeric budget, an unknown price can use that cap as a user-confirmed estimate. With no budget cap, unknown prices stay null. These are user assumptions, not verified purchases, stock or prices.
- **Storage and identity:** full app state is browser-local, with no account authentication or cross-device synchronization. Backboard uses an anonymous UUID; shared demo preferences and reminder contact remain separate. Undo does not reverse remote memory, feedback or reminder writes.
- **Calendar:** Google tokens are memory-only, import reads the primary calendar with a 500-event limit, and all-day conversion uses UTC boundaries. Reconnect after restart. Google and Apple imports do not write back to external calendars. A changed Apple helper identity can require a new permission grant.
- **Reminders:** deleting a local plan does not remove its reminder database row; sync failures can leave browser and worker state inconsistent. Fix deletion/Undo consistency before relying on unattended messaging.
- **Availability:** provider quotas, cost, response latency, stale quotes and menu coverage can reduce available choices. Soft preference fallback never removes mandatory constraints. A genuine no-fit state is valid.
- **Next steps:** prioritize reminder consistency, persistent Google OAuth/session security, broader reviewed ingredient/allergy coverage, and deliberate live provider verification. Authentication and deployment hardening are future work; no architectural migration is required for this demo.

## Team boundaries

Kevin owns food data structures, nutrition, normalization, feasibility and recommendation logic. Saurav owns Python/Gemini, API schemas and backend/memory integrations. Saanvi and Mahika own frontend UX, cards, dashboard/chat integration and deployment. This release preserves their architecture, flavor controls and grocery-session behavior; changes in shared files address the requested integration fixes.

Built for **DubHacks 2026**.
