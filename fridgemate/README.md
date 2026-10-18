# Daywell / FridgeMate

React + Vite frontend with a Python FastAPI backend for Gemini recipes (and optional Backboard memory).

## Run locally

**1. Backend (Gemini keys stay here)**

```sh
cd fridgemate/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Uses fridgemate/.env or backend/.env for GEMINI_API_KEY / BACKBOARD_API_KEY
python -c "from uvicorn import run; run('main:app', host='127.0.0.1', port=8000, reload=True)"
```


**2. Frontend**

```sh
cd fridgemate
npm ci
npm run dev -- --host 127.0.0.1
```

Open the Local URL Vite prints. Cook → add ingredients → suggests via `POST /api/recipes` (proxied to FastAPI `:8000`).

Apple Calendar still uses the local Mac Vite bridge; ICS import works without it.

```sh
npm test
npm run build
npm run lint
```
