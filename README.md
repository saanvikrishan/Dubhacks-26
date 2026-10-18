# WhatsCooking.ai

**Cook what you already have, in the hour you actually have.**

## What it does

Dinner fails when the fridge and the calendar never meet. WhatsCooking.ai turns a grocery list or a fridge photo into meals that fit your preferences and the open time on your day, then texts you before the slot so you cook it or pick something else. Built for people whose schedule moves faster than their meal plan.

## Key features

- Meal planning from what's in your fridge, including substitutions when an ingredient is missing
- Calendar-aware scheduling across an internal schedule, Google Calendar, and Apple Calendar
- Automatic iMessage reminders through Spectrum and Photon, up to five minutes before the slot

## How we built it

React and Vite frontend, FastAPI backend, Postgres for plans and reminders, the Spectrum iMessage API for delivery, and Google Calendar OAuth for a read-only import of the day you already have.

## Challenges we ran into

Google's OAuth dance uses PKCE, and the code verifier was gone by the time the redirect came back, so a valid client still could not finish the token exchange. We keep the in-flight flow keyed by OAuth state so the verifier is still there when Google returns.

The calendar lives in the browser and can arrive from three sources, while reminders are sent by a separate poller that only sees Postgres. We built a sync bridge that writes internal, Google, and Apple events into one reminder table, with a stable key per event and day so each slot is texted once and an edit can send again.

## Documentation

Setup, environment variables, architecture, and known limitations: [fridgemate/README.md](fridgemate/README.md)

Built for DubHacks 2026.
