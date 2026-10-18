# WhatsCooking.ai architecture

The active application is `whatscooking/frontend`, `whatscooking/backend`, and `whatscooking/photon`. The [main README](../README.md) describes setup and product scope.

## State and decisions

`App.jsx` owns browser state and integration bridges. `domain/state.js` validates transitions; `storage.js` saves complete local state. Plans and consumption logs remain separate. Recipe snapshots retain historical facts across reloads. `branding.js` copies legacy storage values to current keys without removing originals; explicit reset clears both.

`engine.js` enforces mandatory diet/allergy, selected budget, pantry, kitchen/equipment, time and calendar checks. `allergens.js` normalizes standard/custom names, checks positive ingredient conflicts, and keeps absence evidence separate. Reviews record the exclusions checked; later restrictions require new coverage. A null budget removes only the price cap, never the safety checks.

`discovery.js` applies mood/flavor before slicing the deck, then performs at most one local retry with those soft filters cleared if necessary. Known conflicting drafts stay hidden; unconfirmed drafts remain distinct from feasible choices. Explicit preferences, daily goals, learned signals and cuisine variety order options. Weighted scoring is disabled.

## Provider boundaries

FastAPI `main.py` routes to `meal_generation.py`, `agent.py`, `voice.py`, `food_memory.py`, `meal_images.py`, food reference/USDA/Kroger and travel adapters. Pydantic validates requests and model output. Recipe generation has request coalescing, caching, model cooldowns and deadlines. Soft-preference broadening occurs within one prompt, without a new paid call for empty results. Cook already exposes the local catalog when generation is empty/unavailable.

`adapters/agent.js` translates schema-checked tool calls into existing transitions and preflights the turn. `Core.jsx` handles confirmation/Undo and voice. `Onboarding.jsx` requests a preview and applies it only on save; preview mode suppresses remote remember writes. Local Undo does not undo remote side effects.

Backboard has separate per-user choice memory, shared demo food preferences, agent notes and photo indexing. `backend/branding.py` reuses historical assistant identities. Anonymous UUID scoping is not authentication. Postgres persistence is optional and does not synchronize full browser state.

## Calendar and reminders

ICS and Apple EventKit imports feed local schedule state. Vite serves the signed Apple helper; Google OAuth/read-only import lives in FastAPI with memory-only tokens. No external calendar writes are implemented. The separate Spectrum worker polls Postgres for upcoming slots, using enrollment/handshake and sent-record deduplication. Local deletion/Undo does not currently reconcile remote reminder rows.

## Ownership

- Kevin: food contracts, normalization, nutrition, feasibility, recommendations and explanations.
- Saurav: Python/Gemini, backend schemas, provider integrations, memory and messaging services.
- Saanvi/Mahika: frontend UX, cards, dashboard/chat integration and deployment.

Preserve teammate flavor controls and grocery-session retention. Larger OAuth, reminder, authentication or deployment changes need coordination. Historical specification documents are design history, not authorization to replace the current React/FastAPI architecture.
