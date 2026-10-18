/** Thin client for FastAPI Postgres / Tiger Data routes (proxied via Vite). */

export async function savePantryItems(names, grams = 500) {
  const items = (names || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .map((name) => ({ name, grams }));
  try {
    const response = await fetch("/api/pantry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, ...data };
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, status: "offline", error: error.message };
  }
}

export async function loadPantryItems() {
  try {
    const response = await fetch("/api/pantry");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, items: [] };
    return { ok: true, items: data.items || [], status: data.status };
  } catch {
    return { ok: false, items: [] };
  }
}

export async function persistSavedMeal(meal) {
  if (!meal?.id) return { ok: false };
  try {
    const response = await fetch("/api/saved-meals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, ...data };
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, status: "offline", error: error.message };
  }
}

export async function loadSavedMeals() {
  try {
    const response = await fetch("/api/saved-meals");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, meals: [] };
    return { ok: true, meals: data.meals || [], status: data.status };
  } catch {
    return { ok: false, meals: [] };
  }
}
