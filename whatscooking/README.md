# WhatsCooking.ai application

This directory contains the working React/FastAPI application and optional reminder worker. The [main README](../README.md) is the authoritative guide for features, setup, configuration, testing, and limitations.

| Directory | Responsibility |
| --- | --- |
| [`frontend/`](frontend/README.md) | React UI, browser state, meal eligibility, calendar views and local Apple Calendar bridge |
| `backend/` | FastAPI, Gemini, Backboard, USDA/Kroger/Routes adapters, Google OAuth, optional Postgres persistence |
| `photon/` | Separate Spectrum iMessage worker; reads `backend/.env` and Postgres |

For the core demo, run the backend and frontend in separate terminals as documented in the main README. The worker is optional and sends real messages when configured; do not start it for mock tests.

- [UW dining source review and ingest](README-UW-DINING.md)
- [Architecture and ownership](../docs/ARCHITECTURE.md)
- [Verification](../docs/VERIFICATION.md)
- [Current agent handoff](../docs/CODEX-HANDOFF-AGENT-VOICE-ONBOARDING.md)
