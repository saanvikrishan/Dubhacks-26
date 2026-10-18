"""Load Markdown skill briefs for WhatsCooking agents."""

from functools import lru_cache
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=16)
def load_skill(name: str, max_chars: int = 6000) -> str:
    """
    Return the text of `skills/{name}.md` (name may omit the .md suffix).
    Empty string if the file is missing.
    """
    filename = name if name.endswith(".md") else f"{name}.md"
    path = SKILLS_DIR / filename
    try:
        return path.read_text(encoding="utf-8")[:max_chars]
    except OSError:
        return ""
