"""Ingredient coverage + agent-driven substitution suggestions."""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable

# Second words that mean a different product (rice ≠ rice vinegar).
_COMPOUND_TAILS = {
    "vinegar",
    "sauce",
    "oil",
    "powder",
    "extract",
    "juice",
    "broth",
    "stock",
    "seasoning",
    "paste",
    "flakes",
}

_STOP = {
    "fresh",
    "dried",
    "frozen",
    "chopped",
    "minced",
    "sliced",
    "raw",
    "cooked",
    "boneless",
    "skinless",
    "organic",
    "large",
    "small",
    "cup",
    "cups",
    "tbsp",
    "tsp",
    "of",
    "and",
    "or",
    "the",
    "a",
    "an",
}


def _norm(text: str) -> str:
    t = str(text or "").lower().replace("-", " ")
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return " ".join(t.split())


def _tokens(text: str) -> set[str]:
    return {t for t in _norm(text).split() if t and t not in _STOP and len(t) > 1}


def pantry_covers(needed: str, available: list[str]) -> bool:
    """
    True if the user already has this food (including cuts/forms).
    e.g. available 'chicken' covers needed 'chicken breast'.
    """
    n = _norm(needed)
    if not n:
        return True
    n_parts = n.split()
    n_toks = _tokens(n)

    for raw in available:
        a = _norm(raw)
        if not a:
            continue
        a_parts = a.split()
        a_toks = _tokens(a)

        if n == a:
            return True

        # Full-word containment either direction, with compound-tail guard
        if a in n or n in a:
            if len(a_parts) == 1 and len(n_parts) > 1 and n_parts[-1] in _COMPOUND_TAILS:
                if n_parts[0] == a_parts[0]:
                    continue
            if len(n_parts) == 1 and len(a_parts) > 1 and a_parts[-1] in _COMPOUND_TAILS:
                if a_parts[0] == n_parts[0]:
                    continue
            # Require word-boundary style match for short tokens
            if len(a) >= 3 and (f" {a} " in f" {n} " or n.startswith(a + " ") or n.endswith(" " + a)):
                return True
            if len(n) >= 3 and (f" {n} " in f" {a} " or a.startswith(n + " ") or a.endswith(" " + n)):
                return True

        # Shared meaningful token (chicken ∩ chicken breast)
        shared = {t for t in (n_toks & a_toks) if len(t) >= 4}
        if shared:
            return True

    return False


def missing_ingredients(meal: dict[str, Any], available: list[str]) -> list[str]:
    missing: list[str] = []
    seen: set[str] = set()
    for item in meal.get("ingredients") or []:
        name = str(item.get("name") if isinstance(item, dict) else item).strip()
        if not name or pantry_covers(name, available):
            continue
        key = _norm(name)
        if key in seen:
            continue
        seen.add(key)
        missing.append(name)
    return missing


def _normalize_swap(raw: dict, available: list[str]) -> dict[str, Any] | None:
    missing_name = str(raw.get("missing") or raw.get("ingredient") or "").strip()
    use = str(
        raw.get("useInstead")
        or raw.get("use_instead")
        or raw.get("alternative")
        or ""
    ).strip()
    if not missing_name:
        return None
    # Never surface a swap for something they already have
    if pantry_covers(missing_name, available):
        return None
    # Don't "swap" to the same covered food
    if use and pantry_covers(missing_name, [use]) and pantry_covers(use, available):
        return None
    return {
        "missing": missing_name[:80],
        "useInstead": (use[:80] or None),
        "fromPantry": bool(use) and pantry_covers(use, available),
        "note": str(raw.get("note") or raw.get("reason") or "").strip()[:220],
        "canOmit": bool(raw.get("canOmit") or raw.get("can_omit")),
    }


def attach_substitutions(
    meal: dict[str, Any],
    available: list[str],
    agent_swaps: list[dict] | None = None,
) -> dict[str, Any]:
    """Attach real gaps + agent swaps; stub any remaining missing ingredients."""
    missing = missing_ingredients(meal, available)
    swaps: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw in list(agent_swaps or []) + list(meal.get("substitutions") or []):
        if not isinstance(raw, dict):
            continue
        normalized = _normalize_swap(raw, available)
        if not normalized:
            continue
        key = _norm(normalized["missing"])
        if key in seen:
            continue
        # Only keep swaps for ingredients that are still missing
        if not any(_norm(m) == key or pantry_covers(m, [normalized["missing"]]) for m in missing):
            if not pantry_covers(normalized["missing"], missing):
                # allow if missing list uses a related name
                if not any(pantry_covers(normalized["missing"], [m]) for m in missing):
                    continue
        seen.add(key)
        if not normalized.get("note") and normalized.get("useInstead"):
            src = "from your groceries" if normalized["fromPantry"] else "as a swap"
            normalized["note"] = (
                f"Use {normalized['useInstead']} {src} instead of {normalized['missing']}."
            )
        swaps.append(normalized)

    # Always surface an Alternatives row for leftovers the agent skipped
    for name in missing:
        key = _norm(name)
        if key in seen:
            continue
        stub = suggest_swap(name, available)
        if stub:
            seen.add(key)
            swaps.append(stub)

    meal = {**meal}
    meal["missingIngredients"] = missing
    meal["substitutions"] = swaps[:8]
    return meal


def _agent_swaps_for(
    meal: dict[str, Any],
    agent_by_meal: dict[str, list[dict]],
) -> list[dict]:
    """Match agent output by id or name (models often echo the title only)."""
    mid = str(meal.get("id") or "").strip()
    name = str(meal.get("name") or "").strip()
    if mid and mid in agent_by_meal:
        return agent_by_meal[mid]
    if name and name in agent_by_meal:
        return agent_by_meal[name]
    name_key = _norm(name)
    if name_key:
        for key, swaps in agent_by_meal.items():
            if _norm(key) == name_key:
                return swaps
    return []


def attach_all(
    meals: list[dict[str, Any]],
    available: list[str],
    agent_by_meal: dict[str, list[dict]] | None = None,
) -> list[dict[str, Any]]:
    agent_by_meal = agent_by_meal or {}
    out = []
    for meal in meals:
        out.append(
            attach_substitutions(meal, available, _agent_swaps_for(meal, agent_by_meal))
        )
    return out


def substitution_skill_prompt(
    meals: list[dict[str, Any]],
    available: list[str],
) -> str | None:
    """Build the substitution-skill prompt, or None if nothing is missing."""
    from skills.loader import load_skill

    blocks = []
    for meal in meals:
        missing = missing_ingredients(meal, available)
        if not missing:
            continue
        blocks.append(
            {
                "id": meal.get("id"),
                "name": meal.get("name"),
                "missing": missing,
                "recipe_ingredients": [
                    (i.get("name") if isinstance(i, dict) else i)
                    for i in (meal.get("ingredients") or [])
                ],
            }
        )
    if not blocks:
        return None

    skill = load_skill("substitution_skill")
    return f"""You are WhatsCooking.ai's substitution skill.
{skill}

User HAS: {json.dumps(available)}

Return JSON only:
{{
  "meals": [
    {{
      "id": "meal-id",
      "substitutions": [
        {{
          "missing": "ingredient",
          "use_instead": "swap or null",
          "from_pantry": true,
          "note": "short reason",
          "can_omit": false
        }}
      ]
    }}
  ]
}}

Only include meals that still need a real swap. Skip any missing item already covered by HAS
(e.g. HAS chicken → skip chicken breast). Never suggest dropping a protein they listed.

Meals needing help:
{json.dumps(blocks, indent=2)}
"""


async def enrich_with_agent(
    meals: list[dict[str, Any]],
    available: list[str],
    generate_json: Callable[[str], Awaitable[dict]],
) -> list[dict[str, Any]]:
    """
    Run substitution skill via generate_json(prompt)->dict, then attach results.
    generate_json should call Gemini (or similar) and return parsed JSON.
    """
    prompt = substitution_skill_prompt(meals, available)
    agent_by_meal: dict[str, list[dict]] = {}
    if prompt:
        try:
            data = await generate_json(prompt)
            for row in (data or {}).get("meals") or []:
                if not isinstance(row, dict):
                    continue
                mid = str(row.get("id") or row.get("name") or "").strip()
                if not mid:
                    continue
                agent_by_meal[mid] = [
                    s for s in (row.get("substitutions") or []) if isinstance(s, dict)
                ]
                # Also index by name when both are present
                name = str(row.get("name") or "").strip()
                if name and name != mid:
                    agent_by_meal[name] = agent_by_meal[mid]
        except Exception as e:
            print(f"[Substitution skill] agent failed: {type(e).__name__}: {e}")

    return attach_all(meals, available, agent_by_meal)


def suggest_swap(needed: str, available: list[str]) -> dict[str, Any] | None:
    """Single-ingredient helper for /recipes/substitute (no hardcoded food groups)."""
    if pantry_covers(needed, available):
        return None
    # Prefer any available item only when the agent isn't used — light heuristic:
    # same shared token role is handled by pantry_covers; otherwise ask user to omit/buy.
    return {
        "missing": needed,
        "useInstead": None,
        "fromPantry": False,
        "note": (
            f"{needed} isn’t in your list. Pick a similar item you have, "
            "or add it — the cook agent will refine swaps on the next suggest."
        ),
        "canOmit": False,
    }
