import { previewFoodIntent, validateFoodIntent } from "../domain/intent.js";

/** Transport is injected: Saurav owns Gemini and the eventual /interpret-food route. */
export function createGeminiIntentAdapter({
  transport,
  timeoutMs = 8000,
} = {}) {
  if (
    typeof transport !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new Error("Provide an intent transport and a timeout of 1–30000 ms.");
  return {
    async preview({ text, state, catalog, config, fallbackIntent } = {}) {
      if (typeof text !== "string" || !text.trim() || text.length > 4000)
        throw new Error("Provide 1–4000 characters of food input.");
      // Fallback must be an explicitly supplied intent, validated before any call.
      const fallback =
        fallbackIntent === undefined
          ? null
          : validateFoodIntent(fallbackIntent);
      const controller = new AbortController();
      let timer;
      let raw,
        failure = null;
      try {
        raw = await Promise.race([
          Promise.resolve().then(() =>
            transport({ text: text.trim(), signal: controller.signal }),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("timeout"));
            }, timeoutMs);
          }),
        ]);
      } catch {
        failure = "transport_unavailable";
      } finally {
        clearTimeout(timer);
      }
      let intent;
      if (!failure) {
        try {
          intent = validateFoodIntent(raw);
        } catch {
          failure = "invalid_intent";
        }
      }
      if (failure && !fallback)
        return {
          ok: false,
          previewOnly: true,
          error: failure,
          source: "unavailable",
          message:
            "No verified intent is available. Original state is unchanged.",
        };
      const result = previewFoodIntent(
        failure ? fallback : intent,
        state,
        catalog,
        config,
      );
      return {
        ok: true,
        source: failure ? "explicit_fallback" : "structured_intent",
        fallbackReason: failure,
        ...result,
      };
    },
  };
}

/** Optional same-origin HTTP transport; no Gemini key and no state/catalog transmission. */
export function createIntentHttpTransport({
  endpoint = "/api/interpret-food",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (
    typeof endpoint !== "string" ||
    !/^\/(?!\/)/.test(endpoint) ||
    /[\\?#\s]/.test(endpoint) ||
    typeof fetchImpl !== "function"
  )
    throw new Error("Intent endpoint must be a same-origin absolute path.");
  return async ({ text, signal }) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
      redirect: "error",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Intent service unavailable.");
    const declared = Number(response.headers?.get("content-length"));
    if (declared > 16384) throw new Error("Intent response exceeds 16 KB.");
    const raw = await response.text();
    return validateFoodIntent(raw);
  };
}
