import asyncio
import json
import os
import re
from datetime import date
from pathlib import Path

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
PHOTOS = ("pasta", "chickpeas", "tofu")
# Weighted cues → stock photos in public/food/{key}.png
PHOTO_SIGNALS = {
    "pasta": (
        ("penne", 6),
        ("spaghetti", 6),
        ("linguine", 6),
        ("fettuccine", 6),
        ("macaroni", 6),
        ("lasagna", 6),
        ("ravioli", 6),
        ("pasta", 5),
        ("noodle", 4),
        ("carbonara", 4),
        ("alfredo", 4),
        ("bolognese", 4),
        ("marinara", 3),
        ("arrabbiata", 4),
        ("tomato sauce", 3),
        ("parmesan", 1),
        ("basil", 1),
    ),
    "chickpeas": (
        ("chickpea", 6),
        ("garbanzo", 6),
        ("hummus", 6),
        ("falafel", 5),
        ("chana", 5),
        ("tzatziki", 4),
        ("mediterranean", 3),
        ("cucumber", 2),
        ("lentil", 3),
        ("dal", 3),
        ("bean salad", 3),
        ("black bean", 2),
        ("kidney bean", 2),
        ("white bean", 2),
        ("bean", 2),
    ),
    "tofu": (
        ("tofu", 6),
        ("tempeh", 5),
        ("stir-fry", 4),
        ("stir fry", 4),
        ("teriyaki", 4),
        ("sesame", 2),
        ("buddha bowl", 4),
        ("grain bowl", 2),
        ("rice bowl", 3),
        ("broccoli", 2),
        ("bell pepper", 1),
        ("soy", 1),
        ("edamame", 3),
    ),
}
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


class RecipeRequest(BaseModel):
    ingredients: list[str] = Field(default_factory=list)
    diet: str = "anything"
    time: int = 30
    exclusions: list[str] = Field(default_factory=list)


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


def pick_photo(
    raw: str | None,
    name: str,
    description: str = "",
    ingredients: list | None = None,
    steps: list | None = None,
) -> str:
    """Pick the stock image that best matches the dish (name weighted highest)."""
    ing_text = " ".join(
        (i if isinstance(i, str) else str((i or {}).get("name") or ""))
        for i in (ingredients or [])
    )
    step_text = " ".join(str(s) for s in (steps or []))
    name_l = (name or "").lower()
    desc_l = (description or "").lower()
    rest_l = f"{ing_text} {step_text}".lower()

    scores = {key: 0 for key in PHOTOS}
    for key, signals in PHOTO_SIGNALS.items():
        for token, weight in signals:
            if token in name_l:
                scores[key] += weight * 3  # dish title wins
            if token in desc_l:
                scores[key] += weight * 2
            if token in rest_l:
                scores[key] += weight

    # Model hint is a weak tie-break only — never override a clear keyword win.
    hint = (raw or "").strip().lower()
    if hint in scores:
        scores[hint] += 1

    best = max(PHOTOS, key=lambda k: (scores[k], PHOTOS.index(k)))
    if scores[best] <= 0:
        # No cues: prefer a grain bowl look over random pasta.
        return "tofu"
    return best


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
        "photo": pick_photo(
            raw.get("photo"),
            name,
            description,
            mapped,
            steps,
        ),
        "suggestion": True,
    }


@app.post("/recipes")
async def generate_recipes(request: RecipeRequest):
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
      "photo": "tofu",
      "diets": ["vegetarian"],
      "allergens": [],
      "energy_kcal": 450,
      "protein_g": 20
    }
  ]
}

photo must be the closest visual match among ONLY these stock photos:
- pasta = penne in red tomato sauce with basil/cheese
- chickpeas = Mediterranean chickpea rice bowl with cucumber, tomato, herbs
- tofu = seared tofu stir-fry bowl with broccoli, peppers, carrots over rice
Match the recipe name first (e.g. any pasta dish → pasta; hummus/falafel/chickpea → chickpeas; tofu/stir-fry/teriyaki bowl → tofu).
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
            if model != GEMINI_MODEL:
                print(f"Gemini: used fallback model {model} (primary {GEMINI_MODEL} unavailable)")
            return {
                "meals": meals,
                "recipes": meals,
                "ingredients": cleaned,
                "model": model,
                "nutrition": "usda" if usda.usda_configured() else "gemini_estimate",
            }
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
