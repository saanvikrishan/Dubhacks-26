# WhatsCooking.ai frontend

React 19 + Vite 8. See the [main README](../../README.md) for complete setup and configuration.

From this directory:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
npm test
npm run lint
npm run build
```

Start FastAPI on port 8000 separately. Vite proxies `/api/*` to it; `/api/calendar/*` is served by the local Apple Calendar middleware. `WHATSCOOKING_BACKEND_URL` and `WHATSCOOKING_DINING_BACKEND_URL` are optional process-environment proxy overrides. Provider keys belong on the backend, never in browser environment variables.

- `src/domain/`: validated state transitions, eligibility, calendar, nutrition, preferences and recipe review.
- `src/adapters/`: browser storage and API boundaries, assistant actions, speech and reference data.
- `src/ui/`: schedule, food discovery, preferences/onboarding, review and chat.
- `src/data/`: reviewed reference snapshots and labeled illustrative catalog records.
- `server/` and `native/`: development middleware, data ingest utilities, signed Swift/EventKit helper.

The production build is static. Preview does not replace API hosting or the local calendar middleware. Old browser keys are read through by `src/domain/branding.js`; do not delete those compatibility aliases during a branding cleanup.
