# WhatsCooking.ai frontend

Vite + React UI for WhatsCooking.ai.

```sh
cd fridgemate/frontend
npm ci
npm run dev -- --host 127.0.0.1
```

API calls under `/api/*` are proxied to the FastAPI backend on `http://127.0.0.1:8000` (see `vite.config.js`). Start the backend from `fridgemate/backend` first.
