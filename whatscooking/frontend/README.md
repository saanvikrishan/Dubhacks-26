# WhatsCooking.ai frontend

Vite + React UI for WhatsCooking.ai.

```sh
cd whatscooking/frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open the Local URL Vite prints (usually http://127.0.0.1:5173/).

API calls under `/api/*` are proxied to the FastAPI backend on `http://127.0.0.1:8000` (see `vite.config.js`). Start the backend from `whatscooking/backend` first:

```sh
cd whatscooking/backend
source .venv/bin/activate
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Full project setup: see [../README.md](../README.md).
