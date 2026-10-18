"""Bounded allergy names shared by recipe and assistant request validation."""
ALIASES = {"eggs": "egg", "peanuts": "peanut", "tree nuts": "tree nut", "dairy": "milk", "soya": "soy", "soybeans": "soy"}
def normalize_exclusions(values):
    if not isinstance(values, list) or len(values) > 30 or any(not isinstance(v, str) or not v.strip() or len(v) > 60 for v in values):
        raise ValueError("Use up to 30 nonempty allergy names, each at most 60 characters")
    names = (" ".join(v.lower().split()) for v in values)
    return list(dict.fromkeys(ALIASES.get(v, v) for v in names))
