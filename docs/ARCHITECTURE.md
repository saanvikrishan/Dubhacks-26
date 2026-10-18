# Architecture and configuration

## Module boundaries

| Layer | Location | Responsibility |
| --- | --- | --- |
| Shell | `fridgemate/src/App.jsx` | Today / My Plan / Food, shared state, dialogs, persistence errors |
| Calendar UI | `src/ui/CalendarViews.jsx` | Agenda, coming up, calendar grids, connection/import, activity editing |
| Food UI | `src/ui/FoodViews.jsx` | Gesture/keyboard decks, moods/priorities, recipes versus real venues |
| Shared dialogs | `src/ui/Core.jsx` | Preferences, groceries, portion confirmation, nutrition and assistant |
| Configuration | `src/domain/config.js`, `src/data/team-config.json` | Effective feature flags, dependency checks, provider registry; preserve original team settings |
| Feasibility | `src/domain/engine.js` | Pure hard constraints, reasons, full duration and simple comparisons |
| Calendar domain | `src/domain/calendar.js` | LA time conversion, busy conflicts/free windows, overlap layout, migration, bounded ICS parsing |
| Nutrition | `src/domain/nutrition.js` | Nullable nutrients, portion/basis conversion, per-field coverage and goal comparison |
| Mutation service | `src/domain/state.js` | All local edits, choices, replacements, independent meal slots, confirmed logs and undo |
| Data | `src/data/catalog.js`, `src/data/uwDining.js` | Curated demo recipes, stable historical IDs, separately sourced UW venue records |
| Adapters | `src/adapters/` | Browser persistence, bounded assistant interpretation proposals |
| Mac server bridge | `server/calendar-bridge.js`, `native/CalendarBridge.swift` | Loopback-only EventKit reads through Vite middleware; no calendar writes |
| Contracts | `src/domain/contracts.d.ts` | Food, portions, profiles, plans/logs, calendar activities and venue types |

The React/JavaScript/Vite stack is preserved. Type declarations document interfaces; this is not a TypeScript migration.

## Rules and features

`config.js` applies the user's direct scope and ranking instructions over the supplied build document. `recommendation.strategy` is `simple_comparison`; activating weighted scoring fails startup validation. Weight/penalty fields remain reference data and are never read by the engine.

Cook feasibility checks dietary/allergen coverage, strict known cost, ingredient gram quantities, equipment/cooking access, and a full same-day meal window. Duration includes preparation + sequential cooking + eating + cleanup + onward travel + buffer. Busy calendar events and other meal slots are hard conflicts; the same slot is excluded to permit a replacement. Changing constraints preserves the old plan until explicit replacement. Undo also rechecks feasibility.

Recipe order is stable catalog order with preferred-food matches first, or an explicitly selected protein / cost / total-time comparison. Mood is an explicit filter. Daily goals affect confirmed-intake display only. There is no model inference or weighted ranking.

The retained engine's multi-mode comparison is a compatibility boundary for old fixtures/tests; the new UI offers only Cook and Eat at school. Live UW venues are a distinct record type, not fabricated nutritionally complete food records. Current hours filter and straight-line distance sorting do not establish meal time, price, diet or allergen feasibility for an exact dish.

Core flags retain service-level enforcement. `calendarView` and `calendarImport` enable the newly implemented local features. OS calendar authorization is checked dynamically by EventKit, separately from these local UI capabilities. Legacy cloud `calendarRead/calendarWrite` remain off; toggling them cannot create cloud OAuth or writes. Gemini, Atlas, Photon, notifications, vision, jobs, auth and automatic rescheduling remain unavailable. Unsupported mutation actions fail before side effects.

## Calendar data path

1. Browser GET `/api/calendar/status` checks platform/authorization without requesting permission.
2. A user-initiated POST `/api/calendar/connect` requests permission if needed.
3. GET `/api/calendar/events?from=...&to=...` reads a range no longer than 93 days. The UI requests roughly 90 days around its selected date.
4. A local Swift/EventKit executable is compiled on demand with an embedded usage description and ad hoc signature into ignored `.calendar-bridge/`.
5. JSON events return to the same local browser origin, then pass through `importCalendar` validation and local persistence.

Requests require a loopback socket, an allowed localhost Host, matching Origin when supplied, and supported method/path/range. No CORS, arbitrary remote URL, write endpoint or background polling exists. Restart Vite after native helper changes. First use requires macOS Command Line Tools and Calendar permission. The helper is a local development integration, not a production-hosted API. Static builds show a truthful unavailable state and retain local ICS import.

Apple refresh or ICS import replaces previous imported copies and preserves manual activities, meal slots, logs and preferences. The active source and loaded range are recorded. Refresh manually after external changes. Imported records are read-only. Daywell meals/activities stay in Daywell; adding one does not write to Apple Calendar. Tasks are local or dated VTODO records; Apple Reminders is not read.

ICS parsing uses `ical.js` for recurrence, EXDATE and recurrence exceptions. Embedded VTIMEZONE and IANA TZID values are honored; floating times use America/Los_Angeles. All-day ends are exclusive. Imports are bounded by file size, date range, iteration and event count. Unsupported items produce warnings. Calendar copies contain private schedule data, remain browser-local, and are excluded from repository/source artifacts.

## State and nutrition

Storage keeps the existing `daywell.local-demo.v1` key/version and migrates calendar fields plus the old single meal into `mealPlans`. Stable IDs preserve existing consumption. Each meal slot is identified by date/start; selecting another slot preserves other days/meals. A plan is separate from confirmed consumption and never enters actual intake.

Consumption has generated request IDs for idempotency. Create/edit/remove stores a one-step inverse record; Undo restores the prior entry or removes the newly created entry. Saved historical logs without undo metadata have an explicit latest-log removal action, which can itself be undone. Nutrition scales per-serving, per-100g and per-recipe-yield records. Unknown nutrient values stay null and retain per-field coverage; incomplete coverage cannot produce a reliable goal remainder.

Malformed local data is preserved and mutations blocked. Failed saves report failure and do not claim success. No stock depletion, shopping, ordering, multi-tab synchronization, cross-device sync or authenticated storage is implied. Future live nutrition needs versioned snapshots so catalog edits cannot silently rewrite historical intake.

## Source and integration requirements

- **Cook:** nine illustrative recipes; replace with reviewed nutrient sources, portion weights, preparation assumptions, allergens and price provenance.
- **UW venues:** official HFS pages/deals, reviewed October 17, 2026; public UW map building pins. Weekly PDF links expire and need review. Distances are Haversine distances rounded to 50 m, not route estimates. No numeric ratings or exact dish nutrients are supplied. See `src/data/uwDining.js` for direct URLs.
- **Places/Maps:** configure a suitable provider and server-side credentials/billing if live numeric ratings, routed times and dynamic availability are needed. No Places key is read by this version. Current Maps links use only the public HUB and venue, not private calendar locations.
- **Auth + Atlas:** choose authenticated per-user ownership, database schema/migrations, `MONGODB_URI`, `MONGODB_DATABASE`, network/account access and a real persistence adapter. Current storage is localStorage.
- **Gemini:** supply backend `GEMINI_API_KEY`, selected model and schema-constrained interpreter grounded in verified records. Preserve deterministic feasibility and explicit choices. Current assistant never calls Gemini.
- **Photon 2.0:** supply actual SDK/API documentation, sandbox/channel/account access, ownership linking, webhook signature verification and idempotency. Implement a real channel against shared state before enabling messaging. No messages have been sent.
- **VEYZL:** team must provide actual repository/audit access for any sponsor review evidence. No audit, PR or competition submission is claimed.

`.env.example` records future backend names only. Never put secrets in `VITE_` variables. No credentials were needed for the completed local core or public UW research.
