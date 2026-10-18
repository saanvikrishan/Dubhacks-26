# WhatsCooking.ai implementation status

Updated 2026-10-18 from the active source. The [main README](../README.md#implemented-features), [architecture](ARCHITECTURE.md), and [current handoff](CODEX-HANDOFF-AGENT-VOICE-ONBOARDING.md) replace earlier speculative migration checklists.

Implemented: local calendar/meal planning and logs; read-only Apple/Google/ICS imports; Gemini recipe/vision/assistant/voice flows; reviewed USDA/Kroger data; UW dining; Backboard personalization; onboarding; custom allergy controls; optional budgets; local soft-preference fallback; optional Postgres persistence and Spectrum reminders.

Outstanding: authenticated cross-device state, durable Google OAuth tokens, reminder deletion/Undo reconciliation, deployment hardening, broader verified food/allergy coverage, and fresh intentional live-provider smoke checks. None is described as finished in the README. No Next.js, MongoDB, Sanity, or social-recipe-transcriber migration is part of this release.
