import asyncio
import json
import os
import re
import time
from datetime import date
from pathlib import Path

import httpx
from backboard import BackboardClient
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

import db as store
import usda

ROOT = Path(__file__).resolve().parent
# Prefer backend/.env, fall back to fridgemate/.env
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

app = FastAPI(title="FridgeMate API")

DEMO_USER_ID = os.getenv("DAYWELL_USER_ID", "demo").strip() or "demo"


@app.on_event("startup")
def on_startup():
    try:
        ready = store.init_db()
        print(
            f"[Startup] PostgreSQL/Tiger Data: {'connected' if ready else 'not configured (set DATABASE_URL)'}"
        )
    except Exception as e:
        print(f"[Startup] Database init failed: {type(e).__name__}: {e}")
    key = usda.refresh_api_key()
    print(
        f"[Startup] USDA FoodData Central: {'ready' if key else 'not configured (set USDA_API_KEY)'}"
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
# Prefer 3.8; fall back when free-tier quota/503 hits so Cook still works.
GEMINI_FALLBACKS = [
    m
    for m in [
        GEMINI_MODEL,
        "gemini-3.8-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
    ]
    if m
]
# de-dupe preserving order
_seen = set()
GEMINI_FALLBACKS = [
    m for m in GEMINI_FALLBACKS if not (m in _seen or _seen.add(m))
]
api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
client = genai.Client(api_key=api_key) if api_key else None

backboard_key = (os.getenv("BACKBOARD_API_KEY") or "").strip()
backboard_client = BackboardClient(api_key=backboard_key) if backboard_key else None
_assistant_id = None
DEMO_ASSISTANT_NAME = "FridgeMate demo"
ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def gemini_transient(msg: str) -> bool:
    return any(
        code in msg
        for code in (
            "429",
            "RESOURCE_EXHAUSTED",
            "503",
            "UNAVAILABLE",
            "high demand",
        )
    )


def normalize_ingredient_names(raw_list) -> list[str]:
    out = []
    seen = set()
    for item in raw_list or []:
        name = str(item).strip().replace("\n", " ")[:60]
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
        if len(out) >= 30:
            break
    return out


INJECTION_PATTERNS = (
    "ignore previous instructions",
    "ignore all previous",
    "ignore all instructions",
    "reveal your system prompt",
    "system prompt",
    "you are now",
    "api key",
    "api_key",
)
MEAL_ONLY = (
    "I can only help with meal planning — try asking about ingredients, time, or budget."
)
CONVO_FALLBACK = (
    "Tell me what you're looking for — ingredients, time, or budget — and I'll find something."
)
RATE_LIMIT = 20
RATE_WINDOW_SECONDS = 60
_request_times: list[float] = []
_LEAK = re.compile(
    r"AIza[0-9A-Za-z_\-]{20,}|sk-[A-Za-z0-9]{16,}|"
    r"system prompt|gemini|backboard|model:",
    re.IGNORECASE,
)


def enforce_rate_limit():
    now = time.monotonic()
    cutoff = now - RATE_WINDOW_SECONDS
    while _request_times and _request_times[0] < cutoff:
        _request_times.pop(0)
    if len(_request_times) >= RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many meal requests. Please wait a minute and try again.",
        )
    _request_times.append(now)


def blocked_user_text(text: str) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in INJECTION_PATTERNS)


def reject_blocked_text():
    print("Blocked prompt injection; Gemini was not called.")
    raise HTTPException(status_code=400, detail=MEAL_ONLY)


def redact_text(value: str) -> str:
    cleaned = _LEAK.sub("", value)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


def redact_output(value):
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_output(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_output(item) for key, item in value.items()}
    return value


def raise_gemini_failure(last_error, action: str):
    err = str(last_error or "unknown error")
    if "429" in err or "RESOURCE_EXHAUSTED" in err:
        raise HTTPException(
            status_code=429,
            detail=(
                "Gemini free-tier quota for this key is used up "
                f"(tried: {', '.join(GEMINI_FALLBACKS)}). "
                "Wait for reset, enable billing, or use another GEMINI_API_KEY."
            ),
        )
    raise HTTPException(
        status_code=502,
        detail=f"{action} failed: {err[:240]}",
    )


class ChatTurn(BaseModel):
    role: str
    text: str


class RecipeRequest(BaseModel):
    ingredients: list[str] = Field(default_factory=list)
    diet: str = "anything"
    time: int = 30
    exclusions: list[str] = Field(default_factory=list)
    text: str | None = None
    memories: list[str] = Field(default_factory=list)
    history: list[ChatTurn] = Field(default_factory=list)


class PhraseRequest(BaseModel):
    summary: str


class PreferenceRequest(BaseModel):
    content: str
    metadata: dict | None = None


class PantryItemIn(BaseModel):
    name: str
    grams: float = 500
    expires_on: str | None = None


class PantryReplaceRequest(BaseModel):
    items: list[PantryItemIn] = Field(default_factory=list)
    user_id: str = DEMO_USER_ID


class SavedMealRequest(BaseModel):
    meal: dict
    user_id: str = DEMO_USER_ID


@app.get("/")
def home():
    return {
        "message": "FridgeMate API is running!",
        "gemini": bool(client),
        "backboard": bool(backboard_client),
        "database": store.SessionLocal is not None,
        "usda": usda.usda_configured(),
        "model": GEMINI_MODEL if client else None,
    }


@app.get("/nutrition/lookup")
async def nutrition_lookup(q: str):
    """Debug / demo: look up per-100g macros from USDA FDC."""
    if not usda.usda_configured():
        raise HTTPException(
            status_code=503,
            detail="USDA_API_KEY is missing from backend/.env or fridgemate/.env",
        )
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query q is required.")
    per_100 = await usda.lookup_per_100g(query)
    if not per_100:
        return {"query": query, "status": "not_found", "per_100g": None}
    return {"query": query, "status": "ok", "per_100g": per_100, "source": "USDA FDC"}


@app.get("/pantry")
def get_pantry(user_id: str = DEMO_USER_ID):
    if not store.SessionLocal:
        return {"items": [], "status": "local_only"}
    try:
        return {"items": store.list_pantry(user_id), "status": "ok"}
    except Exception as e:
        print(f"Pantry list error: {e}")
        raise HTTPException(status_code=502, detail=f"Pantry read failed: {e}") from e


@app.put("/pantry")
def put_pantry(request: PantryReplaceRequest):
    if not store.SessionLocal:
        return {
            "items": [i.model_dump() for i in request.items],
            "status": "local_only",
            "message": "DATABASE_URL not set — pantry kept in the browser only.",
        }
    try:
        items = store.replace_pantry(
            [i.model_dump() for i in request.items],
            user_id=request.user_id or DEMO_USER_ID,
        )
        return {"items": items, "status": "ok"}
    except Exception as e:
        print(f"Pantry save error: {e}")
        raise HTTPException(status_code=502, detail=f"Pantry save failed: {e}") from e


@app.get("/saved-meals")
def get_saved_meals(user_id: str = DEMO_USER_ID):
    if not store.SessionLocal:
        return {"meals": [], "status": "local_only"}
    try:
        return {"meals": store.list_saved_meals(user_id), "status": "ok"}
    except Exception as e:
        print(f"Saved meals list error: {e}")
        raise HTTPException(status_code=502, detail=f"Saved meals read failed: {e}") from e


@app.post("/saved-meals")
def post_saved_meal(request: SavedMealRequest):
    if not store.SessionLocal:
        return {
            "status": "local_only",
            "message": "DATABASE_URL not set — meal not persisted to Postgres.",
            "meal": request.meal,
        }
    try:
        saved = store.save_meal(request.meal, user_id=request.user_id or DEMO_USER_ID)
        return {"status": "ok", "meal": saved}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        print(f"Saved meal error: {e}")
        raise HTTPException(status_code=502, detail=f"Save meal failed: {e}") from e


@app.delete("/saved-meals/{row_id}")
def remove_saved_meal(row_id: int, user_id: str = DEMO_USER_ID):
    if not store.SessionLocal:
        return {"status": "local_only", "deleted": False}
    try:
        ok = store.delete_saved_meal(row_id, user_id=user_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Saved meal not found.")
        return {"status": "ok", "deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Delete failed: {e}") from e


async def get_assistant_id():
    global _assistant_id
    if backboard_client is None:
        return None
    if _assistant_id:
        return _assistant_id

    env_id = os.getenv("BACKBOARD_ASSISTANT_ID")
    if env_id:
        _assistant_id = env_id
        return _assistant_id

    try:
        matches = await backboard_client.list_assistants(name=DEMO_ASSISTANT_NAME)
        if matches:
            _assistant_id = str(matches[0].assistant_id)
            return _assistant_id
        created = await backboard_client.create_assistant(name=DEMO_ASSISTANT_NAME)
        _assistant_id = str(created.assistant_id)
        return _assistant_id
    except Exception as e:
        print(f"Backboard error (detailed): {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return None


def require_backboard_client():
    if backboard_client is None:
        raise HTTPException(
            status_code=500,
            detail="BACKBOARD_API_KEY is missing from backend/.env or fridgemate/.env",
        )


@app.post("/preferences")
async def store_preference(request: PreferenceRequest):
    if backboard_client is None:
        # Return success but don't actually store to Backboard
        print("[Warning] Backboard client not available, preference not stored")
        return {"status": "local_only", "message": "Saved locally only"}
    
    assistant_id = await get_assistant_id()
    if not assistant_id:
        print("[Warning] Could not get assistant ID, preference not stored")
        return {"status": "local_only", "message": "Saved locally only"}
    
    try:
        result = await backboard_client.add_memory(
            assistant_id,
            request.content,
            metadata=request.metadata,
        )
        print(f"[Success] Preference stored to Backboard")
        return result
    except Exception as e:
        print(f"Backboard add_memory error (detailed): {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        # Don't raise an error - just return that it's saved locally
        return {"status": "local_only", "message": "Saved locally only", "error": str(e)}


@app.get("/preferences")
async def list_preferences():
    if backboard_client is None:
        # Return empty memories if Backboard not available
        return {"memories": []}
    
    assistant_id = await get_assistant_id()
    if not assistant_id:
        # Return empty memories if can't get assistant ID
        return {"memories": []}
    
    try:
        memories = await backboard_client.get_memories(assistant_id)
        return memories.model_dump()
    except Exception as e:
        print(f"Backboard get_memories error: {type(e).__name__}: {str(e)}")
        # Return empty memories on error
        return {"memories": []}


def memory_contents(result):
    contents = []
    if hasattr(result, "model_dump"):
        result = result.model_dump()
    memories = result.get("memories") if isinstance(result, dict) else []
    for memory in memories or []:
        content = memory.get("content") if isinstance(memory, dict) else None
        if content:
            contents.append(content)
    return contents


def slug(name: str, index: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "meal").lower()).strip("-")[:40]
    return f"gemini-{base or 'meal'}-{index}"


# TheMealDB CDN thumbs — existing photos, not AI generation (fast).
_image_cache: dict[str, str] = {}


def _image_search_queries(name: str) -> list[str]:
    base = re.sub(r"\s+", " ", (name or "").strip())
    base = re.sub(r"\([^)]*\)", "", base).strip(" ,-")
    parts = [p for p in re.split(r"[\s/]+", base) if p]
    candidates = [base, " ".join(parts[:3]), " ".join(parts[:2])]
    if parts:
        candidates.append(parts[0])
    out: list[str] = []
    seen: set[str] = set()
    for q in candidates:
        q = q.strip(" ,-")[:60]
        key = q.lower()
        if q and key not in seen:
            seen.add(key)
            out.append(q)
    return out


async def resolve_dish_image(name: str, client: httpx.AsyncClient | None = None) -> str | None:
    """Look up a real food photo by dish name (TheMealDB). Cached + ~ms CDN."""
    key = (name or "").strip().lower()
    if not key:
        return None
    cached = _image_cache.get(key)
    if cached:
        return cached

    async def _search(http: httpx.AsyncClient) -> str | None:
        for q in _image_search_queries(name):
            try:
                response = await http.get(
                    "https://www.themealdb.com/api/json/v1/1/search.php",
                    params={"s": q},
                )
                if response.status_code != 200:
                    continue
                meals = (response.json() or {}).get("meals") or []
                thumb = meals[0].get("strMealThumb") if meals else None
                if thumb:
                    _image_cache[key] = thumb
                    return thumb
            except Exception as e:
                print(f"[Image] TheMealDB miss for {q!r}: {type(e).__name__}")
        return None

    if client is not None:
        return await _search(client)
    async with httpx.AsyncClient(timeout=2.0) as http:
        return await _search(http)


async def attach_dish_images(meals: list[dict]) -> None:
    """Attach fast CDN image URLs in parallel (does not block on AI image gen)."""
    if not meals:
        return
    async with httpx.AsyncClient(timeout=2.0) as client:

        async def one(meal: dict) -> None:
            url = await resolve_dish_image(meal.get("name") or "", client)
            if url:
                meal["imageUrl"] = url
                meal["photo"] = url

        await asyncio.gather(*[one(m) for m in meals])


def normalize_ingredient(item) -> dict:
    if isinstance(item, str):
        return {"name": item[:60], "grams": 100}
    name = str(item.get("name") or "ingredient")[:60]
    grams = item.get("grams")
    try:
        grams = max(1, min(2000, int(grams)))
    except (TypeError, ValueError):
        grams = 100
    return {"name": name, "grams": grams}


def normalize_meal(raw: dict, index: int, fallback_ingredients: list[str]) -> dict:
    name = str(raw.get("name") or f"Suggested meal {index + 1}")[:80]
    description = str(
        raw.get("description") or "An AI suggestion based on your groceries."
    )[:240]
    total = raw.get("time")
    try:
        total = max(5, min(120, int(total)))
    except (TypeError, ValueError):
        total = 25
    prep = max(0, total // 3)
    cook = max(0, total - prep)

    ingredients = raw.get("ingredients") or []
    mapped = [normalize_ingredient(i) for i in ingredients[:12]]
    if not mapped and fallback_ingredients:
        mapped = [{"name": n, "grams": 100} for n in fallback_ingredients[:6]]

    steps = [str(s)[:200] for s in (raw.get("steps") or []) if s][:8]
    diets = raw.get("diets") or ["anything"]
    if isinstance(diets, str):
        diets = [diets]
    diets = [d for d in diets if d in ("anything", "vegetarian", "vegan")] or [
        "anything"
    ]
    note = str(raw.get("nutrition_note") or "").strip()

    return {
        "id": slug(name, index),
        "name": name,
        "description": description,
        "ingredients": mapped,
        "cost": 4.5,
        "portionGrams": 400,
        "portionLabel": "1 serving",
        "nutrition": {
            "values": {
                "energy_kcal": raw.get("energy_kcal") or 450,
                "protein_g": raw.get("protein_g") or 18,
                "carbohydrate_g": raw.get("carbohydrate_g") or 45,
                "fat_g": raw.get("fat_g") or 14,
                "fiber_g": raw.get("fiber_g") or 6,
                "sodium_mg": raw.get("sodium_mg") or 400,
            },
            "basis": "per_serving",
            "yieldServings": 1,
            "kind": "gemini_suggestion",
            "source": "Gemini via FridgeMate API · estimates only.",
            "checkedAt": date.today().isoformat(),
            "preparation": note
            or "AI-estimated; confirm ingredients and allergens yourself.",
        },
        "timing": {"prep": prep, "cook": cook, "outbound": 0},
        "diets": diets,
        "allergens": list(raw.get("allergens") or [])[:8],
        "equipment": [],
        "steps": steps
        or [
            "Prep your ingredients.",
            "Cook according to the recipe description.",
            "Taste and adjust seasoning.",
        ],
        "mode": "cook",
        "photo": None,
        "imageUrl": None,
        "suggestion": True,
    }


MODES = {"compare", "cook", "eatOut"}
SORTS = {"catalog", "time", "cost", "protein"}
DIETS = {"anything", "vegetarian", "vegan"}
EXCLUSIONS = {
    "soy",
    "egg",
    "milk",
    "wheat",
    "peanut",
    "tree nut",
    "sesame",
    "fish",
    "shellfish",
}
EQUIPMENT = {
    "stove", "pan", "pot",
    "microwave", "oven", "air fryer", "rice cooker",
    "toaster", "blender", "electric kettle",
    "baking sheet", "cutting board", "knife",
    "mixing bowl", "spatula", "colander",
    "slow cooker",
}
PATCH_KEYS = ("mode", "sort", "passed", "profile", "context", "pantry", "unparsed")
PROFILE_KEYS = ("diet", "exclusions", "preferred", "budget", "cooking", "equipment")
CATALOG_PATH = ROOT.parent / "src" / "data" / "catalog.js"


def reject_patch(detail: str):
    raise HTTPException(status_code=502, detail=detail)


def catalog_ingredient_names() -> set[str]:
    text = CATALOG_PATH.read_text(encoding="utf-8")
    return set(re.findall(r'ingredient\(\s*"([^"]+)"', text))


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def pantry_grams(value):
    if isinstance(value, dict):
        value = value.get("grams")
    if isinstance(value, str):
        cleaned = value.strip().lower().removesuffix("g").strip()
        try:
            value = float(cleaned) if "." in cleaned else int(cleaned)
        except ValueError:
            return None
    if is_number(value) and value >= 0:
        return value
    return None


def string_list(value, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        reject_patch(f"Gemini returned an invalid {label} list.")
    return value


def validate_patch(raw, names: set[str]) -> dict:
    if not isinstance(raw, dict):
        reject_patch("Gemini returned a non-object patch.")
    for key in PATCH_KEYS:
        if key not in raw:
            reject_patch(f"Gemini omitted {key}.")
    mode, sort = raw["mode"], raw["sort"]
    if mode is not None and mode not in MODES:
        reject_patch("Gemini returned an invalid mode.")
    if sort is not None and sort not in SORTS:
        reject_patch("Gemini returned an invalid sort.")
    passed = string_list(raw["passed"], "passed")
    unparsed = string_list(raw["unparsed"], "unparsed")

    profile = raw["profile"]
    if profile is None:
        profile = {key: None for key in PROFILE_KEYS}
    elif not isinstance(profile, dict):
        reject_patch("Gemini returned an invalid profile.")
    else:
        profile = {key: profile.get(key) for key in PROFILE_KEYS}
    diet = profile["diet"]
    if diet is not None and diet not in DIETS:
        reject_patch("Gemini returned an invalid diet.")
    exclusions = profile["exclusions"]
    if exclusions is not None:
        if (
            not isinstance(exclusions, list)
            or not all(isinstance(item, str) and item in EXCLUSIONS for item in exclusions)
        ):
            reject_patch("Gemini returned an invalid exclusion.")
    preferred = profile["preferred"]
    if preferred is not None and not isinstance(preferred, str):
        reject_patch("Gemini returned an invalid preferred value.")
    budget = profile["budget"]
    if budget is not None and (not is_number(budget) or budget < 0 or budget > 1000):
        reject_patch("Gemini returned an invalid budget.")
    cooking = profile["cooking"]
    if cooking is not None and not isinstance(cooking, bool):
        reject_patch("Gemini returned an invalid cooking value.")
    equipment = profile["equipment"]
    if equipment is not None and (
        not isinstance(equipment, list)
        or not all(isinstance(item, str) and item in EQUIPMENT for item in equipment)
    ):
        reject_patch("Gemini returned an invalid equipment list.")

    context = raw["context"]
    if context is None:
        context = {"available": None}
    elif not isinstance(context, dict):
        reject_patch("Gemini returned an invalid context.")
    else:
        available = context.get("available")
        if available is not None and (
            isinstance(available, bool)
            or not isinstance(available, int)
            or available < 1
            or available > 1440
        ):
            reject_patch("Gemini returned an invalid available window.")
        context = {"available": available}

    pantry = raw["pantry"]
    if pantry is None:
        pantry = None
    elif isinstance(pantry, list):
        # A bare name has no amount. Do not invent grams; unknown names are unparsed.
        cleaned = {}
        for item in pantry:
            if isinstance(item, str):
                if item not in names:
                    unparsed.append(item)
                continue
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                reject_patch("Gemini returned an invalid pantry.")
            name = item["name"]
            if name not in names:
                unparsed.append(name)
                continue
            amount = pantry_grams(item)
            if amount is None:
                continue
            cleaned[name] = amount
        pantry = cleaned or None
    elif not isinstance(pantry, dict):
        reject_patch("Gemini returned an invalid pantry.")
    else:
        cleaned = {}
        for name, grams in pantry.items():
            if name not in names:
                unparsed.append(str(name))
                continue
            amount = pantry_grams(grams)
            if amount is None:
                if grams is not None:
                    reject_patch(f"Gemini returned an invalid amount for {name}.")
                continue
            cleaned[name] = amount
        pantry = cleaned
    unparsed = list(dict.fromkeys(unparsed))

    return {
        "mode": mode,
        "sort": sort,
        "passed": passed,
        "profile": profile,
        "context": context,
        "pantry": pantry,
        "unparsed": unparsed,
    }


def recent_turns(history) -> list[dict]:
    turns = []
    for item in history or []:
        if isinstance(item, dict):
            role, text = item.get("role"), item.get("text")
        else:
            role, text = getattr(item, "role", None), getattr(item, "text", None)
        if role not in ("user", "assistant") or not isinstance(text, str):
            continue
        cleaned = " ".join(text.split())[:500]
        if cleaned:
            turns.append({"role": role, "text": cleaned})
    return turns[-4:]


def history_block(history) -> str:
    turns = recent_turns(history)
    if not turns:
        return "None."
    return "\n".join(
        f"{'User' if turn['role'] == 'user' else 'Assistant'}: {turn['text']}"
        for turn in turns
    )


async def conversational_reply(user_text: str, history) -> str:
    enforce_rate_limit()
    if blocked_user_text(user_text):
        reject_blocked_text()
    if not client:
        return CONVO_FALLBACK
    prompt = f"""You are the food assistant for Daywell. Chat naturally and briefly (1-2 sentences). You help with meal planning — ingredients, time, budget, dietary needs. If the user asks something unrelated to food/cooking, you can still respond conversationally, but steer back to how you can help with meals. Never invent recipe names, nutrition facts, or specific dishes — if they ask for actual meal suggestions, tell them to describe what they're looking for (ingredients, time, budget) so you can check real options.

Recent conversation:
{history_block(history)}

User: {user_text}
"""
    for model in GEMINI_FALLBACKS:
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.models.generate_content,
                    model=model,
                    contents=prompt,
                ),
                timeout=20,
            )
            text = redact_text((response.text or "").strip())
            if text:
                return text
        except HTTPException:
            raise
        except TimeoutError:
            print(f"Gemini conversation timed out ({model})")
            return CONVO_FALLBACK
        except Exception as e:
            msg = str(e)
            print(f"Gemini conversation error ({model}):", msg)
            if not gemini_transient(msg):
                break
    return CONVO_FALLBACK


def interpreter_prompt(text: str, memories: list[str], names: set[str], history=None) -> str:
    memory_block = "\n".join(f"- {item}" for item in memories) or "None."
    ingredients = ", ".join(sorted(names))
    return f"""You classify one message and, when it is a meal request, translate it into a constraint patch for an existing catalog.
Return JSON only. The object below shows the shape. Set intent from the message, not always "meal_request".

Set "intent" to "meal_request" or "conversation".
Use "meal_request" when the user wants meal options, or is refining an earlier meal request: cheaper, faster, more protein, a diet, an ingredient, a budget, a time limit, cook versus eat out, or "something else".
A follow-up that changes a constraint is still a meal_request even if it names no dish. "what about cheaper options" after a vegetarian request is a meal_request.
Carry constraints that are still in force from the recent chat into the patch. For "cheaper" or "faster" with no number, set sort to "cost" or "time" and leave budget and available null. Do not invent a dollar amount or a minute count.
Use "conversation" for greetings, thanks, questions about the app, and other small talk that does not ask for or refine meals.

For a meal_request, use null for every patch field the user did not mention and that the recent chat does not already constrain. Do not invent recipes.
Do not invent pantry grams. If a food is not in the catalog ingredient list, leave it out of pantry and add the user's words to unparsed.
For a conversation, leave every patch field null and unparsed empty.

Catalog ingredient names, exact spelling: {ingredients}
Modes: compare, cook, eatOut
Sorts: catalog, time, cost, protein
Diets: anything, vegetarian, vegan
Exclusions: soy, egg, milk, wheat, peanut, tree nut, sesame, fish, shellfish
Equipment: stove, pan, pot, microwave, oven, air fryer, rice cooker, toaster, blender, electric kettle, baking sheet, cutting board, knife, mixing bowl, spatula, colander, slow cooker
Map "peanuts" to the exclusion "peanut". Budget is USD per meal, from 0 to 1000.

Recent chat, oldest first:
{history_block(history)}

Known memories:
{memory_block}

User message:
{text}

Return this object and no other keys inside profile or context:
{{
  "intent": "meal_request",
  "mode": null,
  "sort": null,
  "passed": null,
  "profile": {{
    "diet": null,
    "exclusions": null,
    "preferred": null,
    "budget": null,
    "cooking": null,
    "equipment": null
  }},
  "context": {{"available": null}},
  "pantry": null,
  "unparsed": []
}}
"""


async def interpret_constraints(request: RecipeRequest) -> dict:
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env or fridgemate/.env",
        )
    text = (request.text or "").strip()
    if not text:
        reject_patch("Enter a food request.")
    memories = [item for item in request.memories if isinstance(item, str) and item.strip()]
    if backboard_client is not None:
        try:
            assistant_id = await get_assistant_id()
            if assistant_id:
                found = await backboard_client.search_memories(assistant_id, text, limit=5)
                memories.extend(memory_contents(found))
        except Exception as e:
            print("Backboard error:", str(e))
            memories = [
                item for item in request.memories if isinstance(item, str) and item.strip()
            ]
    names = catalog_ingredient_names()
    prompt = interpreter_prompt(text, memories, names, request.history)
    last_error = None
    for model in GEMINI_FALLBACKS:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )
            parsed = json.loads(response.text or "")
            if isinstance(parsed, dict) and parsed.get("intent") == "conversation":
                message = await conversational_reply(text, request.history)
                return {"intent": "conversation", "message": message}
            try:
                patch = validate_patch(parsed, names)
            except HTTPException:
                print("Gemini patch rejected:", json.dumps(parsed)[:1000])
                raise
            if model != GEMINI_MODEL:
                print(
                    f"Gemini: used fallback model {model} (primary {GEMINI_MODEL} unavailable)"
                )
            patch["intent"] = "meal_request"
            return redact_output(patch)
        except HTTPException:
            raise
        except Exception as e:
            last_error = e
            msg = str(e)
            print(f"Gemini error ({model}):", msg)
            if not any(
                code in msg
                for code in (
                    "429",
                    "RESOURCE_EXHAUSTED",
                    "503",
                    "UNAVAILABLE",
                    "high demand",
                )
            ):
                break
    err = str(last_error or "unknown error")
    if "429" in err or "RESOURCE_EXHAUSTED" in err:
        raise HTTPException(
            status_code=429,
            detail=(
                "Gemini free-tier quota for this key is used up "
                f"(tried: {', '.join(GEMINI_FALLBACKS)}). "
                "Wait for reset, enable billing, or use another GEMINI_API_KEY."
            ),
        )
    raise HTTPException(status_code=502, detail=f"Recipe generation failed: {err[:240]}")


@app.post("/recipes/phrase")
async def phrase_reply(request: PhraseRequest):
    enforce_rate_limit()
    summary = request.summary.strip()
    if not summary:
        raise HTTPException(status_code=400, detail="Missing summary.")
    if blocked_user_text(summary):
        reject_blocked_text()
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env or fridgemate/.env",
        )
    prompt = f"""Rewrite the meal assistant summary below as one or two natural, conversational sentences.
Vary the wording. Keep every fact exactly: meal names, durations, costs, reasons, and disclosure lines such as catalog misses and "for this reply only".
Do not add meals, times, prices, reasons, or advice that are not in the summary.
Return only the rewritten sentences.

Summary:
{summary}
"""
    last_error = None
    for model in GEMINI_FALLBACKS:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=prompt,
            )
            text = (response.text or "").strip()
            if not text:
                raise HTTPException(status_code=502, detail="Empty phrasing.")
            return {"text": redact_text(text)}
        except HTTPException:
            raise
        except Exception as e:
            last_error = e
            msg = str(e)
            print(f"Gemini phrase error ({model}):", msg)
            if not gemini_transient(msg):
                break
    raise_gemini_failure(last_error, "Reply phrasing")


@app.post("/recipes")
async def generate_recipes(request: RecipeRequest):
    enforce_rate_limit()
    user_text = (
        request.text
        if isinstance(request.text, str)
        else " ".join(str(item) for item in request.ingredients)
    )
    if blocked_user_text(user_text):
        reject_blocked_text()
    if isinstance(request.text, str):
        return await interpret_constraints(request)
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env or fridgemate/.env",
        )

    cleaned = [str(i).strip()[:60] for i in request.ingredients if str(i).strip()][
        :30
    ]
    ingredients = ", ".join(cleaned) if cleaned else "common pantry staples"
    known_preferences = ""
    if backboard_client is not None:
        assistant_id = await get_assistant_id()
        if assistant_id:
            query = (
                f"ingredients: {ingredients}; "
                f"diet: {request.diet}; "
                f"time: {request.time} minutes"
            )
            try:
                found = await backboard_client.search_memories(
                    assistant_id,
                    query,
                    limit=5,
                )
                facts = memory_contents(found)
                if facts:
                    known_preferences = "\n".join(f"- {fact}" for fact in facts)
            except Exception as e:
                print("Backboard error:", str(e))

    exclusions = ", ".join(request.exclusions) if request.exclusions else "none"
    prompt = f"""
You are FridgeMate, a practical cooking assistant for college students.

Available ingredients: {ingredients}
Dietary preference: {request.diet}
Avoid: {exclusions}
Maximum cooking time: {request.time} minutes
"""
    if known_preferences:
        prompt += f"""
Known preferences from memory:
{known_preferences}
Follow these preferences. Do not suggest food that conflicts with them.
"""
    prompt += """
Suggest 6 realistic recipes using these ingredients when possible.
Prioritize using ingredients that might otherwise go to waste.
Keep recipes affordable, beginner-friendly, and healthy.
Mention any extra ingredients needed rather than pretending the user already has them.

Return valid JSON only:
{
  "recipes": [
    {
      "name": "Recipe name",
      "description": "Short description",
      "time": 20,
      "ingredients": ["ingredient 1", "ingredient 2"],
      "steps": ["Step 1", "Step 2"],
      "nutrition_note": "Brief, cautious nutrition note",
      "diets": ["vegetarian"],
      "allergens": [],
      "energy_kcal": 450,
      "protein_g": 20
    }
  ]
}

Do not invent a photo field — images are generated from the recipe name separately.
"""

    last_error = None
    for model in GEMINI_FALLBACKS:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )
            parsed = json.loads(response.text or "{}")
            recipes = parsed.get("recipes") if isinstance(parsed, dict) else None
            if not isinstance(recipes, list) or not recipes:
                raise ValueError("No recipes in model response")
            meals = [
                normalize_meal(r if isinstance(r, dict) else {}, i, cleaned)
                for i, r in enumerate(recipes[:8])
            ]
            if usda.usda_configured():
                meals = await usda.enrich_meals(meals)
            await attach_dish_images(meals)
            if model != GEMINI_MODEL:
                print(f"Gemini: used fallback model {model} (primary {GEMINI_MODEL} unavailable)")
            return redact_output(
                {
                    "meals": meals,
                    "recipes": meals,
                    "ingredients": cleaned,
                    "model": model,
                    "nutrition": "usda" if usda.usda_configured() else "gemini_estimate",
                }
            )
        except Exception as e:
            last_error = e
            msg = str(e)
            print(f"Gemini error ({model}):", msg)
            if not gemini_transient(msg):
                break

    raise_gemini_failure(last_error, "Recipe generation")


@app.post("/vision/ingredients")
async def vision_ingredients(photo: UploadFile = File(...)):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env or fridgemate/.env",
        )

    content_type = (photo.content_type or "").lower().split(";")[0].strip()
    if content_type == "image/jpg":
        content_type = "image/jpeg"
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Upload a JPEG, PNG, WebP, or HEIC fridge photo.",
        )

    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Photo is too large (max 8 MB). Try a smaller image.",
        )

    prompt = """
You are FridgeMate. Look at this fridge / pantry photo and list edible ingredients
you can clearly see (produce, proteins, dairy, leftovers in labeled containers, etc.).
Ignore shelves, containers, brands, and non-food objects.
Use short grocery-style names (e.g. "eggs", "spinach", "milk").
Return valid JSON only:
{"ingredients":["ingredient 1","ingredient 2"]}
If nothing edible is visible, return {"ingredients":[]}.
"""
    image_part = types.Part.from_bytes(data=data, mime_type=content_type)
    last_error = None
    for model in GEMINI_FALLBACKS:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=[prompt, image_part],
                config={"response_mime_type": "application/json"},
            )
            parsed = json.loads(response.text or "{}")
            ingredients = normalize_ingredient_names(
                parsed.get("ingredients") if isinstance(parsed, dict) else []
            )
            if model != GEMINI_MODEL:
                print(
                    f"Gemini vision: used fallback model {model} "
                    f"(primary {GEMINI_MODEL} unavailable)"
                )
            return {"ingredients": ingredients, "model": model}
        except Exception as e:
            last_error = e
            msg = str(e)
            print(f"Gemini vision error ({model}):", msg)
            if not gemini_transient(msg):
                break

    raise_gemini_failure(last_error, "Fridge photo scan")


# ── Google Calendar OAuth ────────────────────────────────────────────────────
_GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
_GCAL_REDIRECT = "http://localhost:8000/google-calendar/callback/"
_gcal_tokens: dict = {}


def _gcal_flow():
    cid = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    csec = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
    if not cid or not csec:
        raise HTTPException(
            status_code=500,
            detail="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env",
        )
    try:
        from google_auth_oauthlib.flow import Flow  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="pip install google-auth-oauthlib google-api-python-client",
        )
    return Flow.from_client_config(
        {"web": {
            "client_id": cid, "client_secret": csec,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [_GCAL_REDIRECT],
        }},
        scopes=_GCAL_SCOPES,
        redirect_uri=_GCAL_REDIRECT,
    )


@app.get("/google-calendar/auth-url")
def gcal_auth_url():
    flow = _gcal_flow()
    url, _ = flow.authorization_url(access_type="offline", prompt="consent")
    return {"url": url}


@app.get("/google-calendar/callback")
def gcal_callback(code: str):
    from fastapi.responses import HTMLResponse  # type: ignore
    flow = _gcal_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    _gcal_tokens["access_token"] = creds.token
    _gcal_tokens["refresh_token"] = creds.refresh_token
    _gcal_tokens["connected"] = True
    return HTMLResponse("""<!doctype html><html><body><script>
if(window.opener){window.opener.postMessage({type:'gcal-connected'},'http://localhost:5173');window.close();}
else{document.write('<p>Connected! Close this tab.</p>');}
</script></body></html>""")


@app.get("/google-calendar/status")
def gcal_status():
    return {"connected": _gcal_tokens.get("connected", False)}


@app.get("/google-calendar/events")
async def gcal_events(from_: str | None = None, to: str | None = None):
    if not _gcal_tokens.get("connected"):
        raise HTTPException(status_code=401, detail="Google Calendar not connected.")
    try:
        from google.oauth2.credentials import Credentials  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except ImportError:
        raise HTTPException(status_code=500, detail="pip install google-api-python-client")
    cid = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    csec = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
    creds = Credentials(
        token=_gcal_tokens["access_token"],
        refresh_token=_gcal_tokens.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cid, client_secret=csec, scopes=_GCAL_SCOPES,
    )
    service = await asyncio.to_thread(build, "calendar", "v3", credentials=creds, cache_discovery=False)
    tmin = from_ or (date.today().isoformat() + "T00:00:00Z")
    tmax = to or (date.today().isoformat() + "T23:59:59Z")
    raw = await asyncio.to_thread(
        lambda: service.events().list(
            calendarId="primary", timeMin=tmin, timeMax=tmax,
            maxResults=500, singleEvents=True, orderBy="startTime",
        ).execute()
    )
    events = []
    for item in raw.get("items", []):
        s = item.get("start", {}); e = item.get("end", {})
        events.append({
            "id": item["id"],
            "title": item.get("summary", "Untitled"),
            "start": s.get("dateTime") or (s.get("date", "") + "T00:00:00Z"),
            "end":   e.get("dateTime") or (e.get("date", "") + "T23:59:59Z"),
            "allDay": "date" in s,
            "location": item.get("location", ""),
            "calendar": "Google Calendar",
            "source": "ics",
            "busy": item.get("transparency", "opaque") != "transparent",
            "readOnly": True,
            "completed": False,
        })
    return {"events": events, "authorized": True}
