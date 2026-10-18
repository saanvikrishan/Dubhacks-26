# WhatsCooking.ai

**Cook what you already have, in the hour you actually have.**

## What it does

Dinner fails when the fridge and the calendar never meet. WhatsCooking.ai turns a grocery list or a fridge photo into meals that fit your preferences and the open time on your day, then texts you before the slot so you cook it or pick something else. Built for people whose schedule moves faster than their meal plan.

## Key features

- Smart Schedule Sync: Integrates youe Apple or Google Calendar to automatically schedule time for prep and cooking
- Fridge Photo Scanning: Instantly logs your available ingredients by letting you snap a quick picture of your fridge
- Context-Aware Filtering: Cross-references your schedule, ingredients, dietary restrictions, likes/dislikes, and budget to suggest meals you can realistically make right and enjoy right now
- Tinder-Style Meal Matching: Discover and select personalized recipes by swiping through options tailored to your current mood and preferences
- Automated Nutrition Tracking: Seamlessly logs and tracks your daily macros and calories through an automated workflow
- Campus Dining Fallback: Automatically routes you to the nearest open campus dining venue when you are out of groceries or too tired to cook.
- Interactive AI Assistant (FridgeMate): Our in house AI Assistant

## How we built it

React and Vite frontend, FastAPI backend, Postgres for plans and reminders, the Spectrum iMessage API for delivery, and Google Calendar OAuth for a read-only import of the day you already have.

## Quick Start

```sh
git clone https://github.com/saanvikrishan/Dubhacks-26.git && cd Dubhacks-26/fridgemate
python -m pip install -r backend/requirements.txt
npm ci --prefix frontend && npm install --prefix photon
```

Run these in three terminals, from `backend/`, `frontend/`, and `photon/`:

```sh
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
npm run dev -- --host 127.0.0.1
node remind.mjs
```

Full setup, environment variables, and architecture details: see [fridgemate/README.md](fridgemate/README.md)

## Challenges we ran into

Google's OAuth dance uses PKCE, and the code verifier was gone by the time the redirect came back, so a valid client still could not finish the token exchange. We keep the in-flight flow keyed by OAuth state so the verifier is still there when Google returns.

The calendar lives in the browser and can arrive from three sources, while reminders are sent by a separate poller that only sees Postgres. We built a sync bridge that writes internal, Google, and Apple events into one reminder table, with a stable key per event and day so each slot is texted once and an edit can send again.

## Documentation

Setup, environment variables, architecture, and known limitations: [fridgemate/README.md](fridgemate/README.md)

Built for DubHacks 2026.
