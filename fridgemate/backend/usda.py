"""USDA FoodData Central lookups for recipe nutrition estimates."""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

FDC_BASE = "https://api.nal.usda.gov/fdc/v1"
# Prefer a real key; DEMO_KEY works for light hackathon demos with rate limits.
USDA_API_KEY = (os.getenv("USDA_API_KEY") or os.getenv("FDC_API_KEY") or "").strip()

# FDC nutrientNumber → our schema keys (detail "100x" + search legacy "2xx")
NUTRIENT_MAP = {
    "1008": "energy_kcal",
    "208": "energy_kcal",
    "957": "energy_kcal",  # Atwater General
    "958": "energy_kcal",  # Atwater Specific
    "1003": "protein_g",
    "203": "protein_g",
    "1005": "carbohydrate_g",
    "205": "carbohydrate_g",
    "1004": "fat_g",
    "204": "fat_g",
    "1079": "fiber_g",
    "291": "fiber_g",
    "1093": "sodium_mg",
    "307": "sodium_mg",
}

_EMPTY = {
    "energy_kcal": 0.0,
    "protein_g": 0.0,
    "carbohydrate_g": 0.0,
    "fat_g": 0.0,
    "fiber_g": 0.0,
    "sodium_mg": 0.0,
}

# Simple in-process cache: query → (expires_at, per_100g dict | None)
_cache: dict[str, tuple[float, dict[str, float] | None]] = {}
_CACHE_TTL = 60 * 60 * 6  # 6 hours


def usda_configured() -> bool:
    return bool(USDA_API_KEY)


def refresh_api_key() -> str:
    global USDA_API_KEY
    USDA_API_KEY = (
        os.getenv("USDA_API_KEY") or os.getenv("FDC_API_KEY") or ""
    ).strip()
    return USDA_API_KEY


def _api_key() -> str:
    return refresh_api_key()


def _extract_per_100g(food: dict[str, Any]) -> dict[str, float] | None:
    nutrients = food.get("foodNutrients") or []
    out = dict(_EMPTY)
    found = 0
    for row in nutrients:
        number = str(
            row.get("nutrientNumber")
            or (row.get("nutrient") or {}).get("number")
            or ""
        )
        key = NUTRIENT_MAP.get(number)
        if not key:
            continue
        amount = row.get("value")
        if amount is None:
            amount = row.get("amount")
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            continue
        out[key] = amount
        found += 1
    return out if found else None


async def lookup_per_100g(query: str) -> dict[str, float] | None:
    """Search FDC and return nutrient amounts per 100 g, or None."""
    q = " ".join(str(query or "").lower().split())[:80]
    if not q or not _api_key():
        return None

    now = time.time()
    cached = _cache.get(q)
    if cached and cached[0] > now:
        return cached[1]

    payload = {
        "query": q,
        "pageSize": 5,
        "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)"],
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                f"{FDC_BASE}/foods/search",
                params={"api_key": _api_key()},
                json=payload,
            )
            if response.status_code == 429:
                print("[USDA] rate limited")
                _cache[q] = (now + 60, None)
                return None
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        print(f"[USDA] search failed for {q!r}: {type(e).__name__}: {e}")
        _cache[q] = (now + 120, None)
        return None

    foods = data.get("foods") or []

    def rank(food: dict) -> tuple:
        desc = (food.get("description") or "").lower()
        dtype = food.get("dataType") or ""
        exact = 0 if desc.startswith(q) else 1 if q in desc else 2
        type_rank = 0 if dtype == "Foundation" else 1 if dtype == "SR Legacy" else 2
        return (exact, type_rank, -float(food.get("score") or 0))

    result = None
    for food in sorted(foods, key=rank):
        parsed = _extract_per_100g(food)
        if parsed and (parsed.get("energy_kcal") or parsed.get("protein_g")):
            result = parsed
            break

    _cache[q] = (now + _CACHE_TTL, result)
    return result


def _scale(per_100g: dict[str, float], grams: float) -> dict[str, float]:
    factor = max(0.0, float(grams)) / 100.0
    return {k: v * factor for k, v in per_100g.items()}


async def enrich_meal(meal: dict[str, Any]) -> dict[str, Any]:
    """
    Replace Gemini placeholder macros with a USDA-based per-serving estimate
    when enough ingredients match FoodData Central.
    """
    if not _api_key():
        return meal

    ingredients = meal.get("ingredients") or []
    if not ingredients:
        return meal

    totals = dict(_EMPTY)
    matched: list[str] = []
    unmatched: list[str] = []

    for item in ingredients:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        try:
            grams = float(item.get("grams") or 100)
        except (TypeError, ValueError):
            grams = 100.0
        per_100 = await lookup_per_100g(name)
        if not per_100:
            unmatched.append(name)
            continue
        scaled = _scale(per_100, grams)
        for key, value in scaled.items():
            totals[key] += value
        matched.append(name)

    if not matched:
        return meal

    yield_servings = meal.get("nutrition", {}).get("yieldServings") or 1
    try:
        yield_servings = max(1.0, float(yield_servings))
    except (TypeError, ValueError):
        yield_servings = 1.0

    values = {
        key: round(total / yield_servings, 1) for key, total in totals.items()
    }
    confidence = (
        "high"
        if len(matched) >= max(2, int(0.75 * len(ingredients)))
        else "medium"
        if len(matched) >= max(1, len(ingredients) // 2)
        else "low"
    )

    nutrition = dict(meal.get("nutrition") or {})
    nutrition["values"] = values
    nutrition["basis"] = "per_serving"
    nutrition["kind"] = "usda_estimated"
    nutrition["confidence"] = confidence
    nutrition["source"] = (
        f"USDA FoodData Central · {len(matched)}/{len(ingredients)} ingredients "
        f"matched · confidence {confidence}."
    )
    nutrition["preparation"] = (
        "Estimated from USDA ingredient matches; confirm allergens and portions."
    )
    nutrition["usda_matched"] = matched
    nutrition["usda_unmatched"] = unmatched
    meal = {**meal, "nutrition": nutrition}
    return meal


async def enrich_meals(meals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for meal in meals:
        try:
            out.append(await enrich_meal(meal))
        except Exception as e:
            print(f"[USDA] enrich failed: {type(e).__name__}: {e}")
            out.append(meal)
    return out
