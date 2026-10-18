const BASE = "https://api.nal.usda.gov/fdc/v1";
export class UsdaClientError extends Error {
  constructor(code) {
    super(`USDA request failed: ${code}.`);
    this.name = "UsdaClientError";
    this.code = code;
  }
}

/** Server-only. Keys never enter frontend records, logs, returned URLs, or errors. */
export function createUsdaClient({
  apiKey = process.env.USDA_FDC_API_KEY,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  ttlMs = 86400000,
  maxEntries = 50,
  timeoutMs = 10000,
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw new UsdaClientError("missing_api_key");
  if (
    typeof fetchImpl !== "function" ||
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 100 ||
    !Number.isFinite(ttlMs) ||
    ttlMs < 0 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new UsdaClientError("invalid_client_options");
  const cache = new Map(),
    pending = new Map();
  async function request(path, body) {
    const key = JSON.stringify([path, body]),
      hit = cache.get(key);
    if (hit && hit.expires > now()) return structuredClone(hit.data);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    const operation = (async () => {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(
            `${BASE}${path}?api_key=${encodeURIComponent(apiKey.trim())}`,
            {
              method: body ? "POST" : "GET",
              ...(body
                ? {
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  }
                : {}),
              signal: controller.signal,
              redirect: "error",
            },
          );
        } catch {
          throw new UsdaClientError("network_or_timeout");
        }
        if (!response.ok)
          throw new UsdaClientError(
            response.status === 429 ? "rate_limited" : "service_unavailable",
          );
        if (Number(response.headers?.get("content-length")) > 1000000)
          throw new UsdaClientError("response_too_large");
        let text;
        try {
          text = await response.text();
        } catch {
          throw new UsdaClientError("network_or_timeout");
        }
        if (text.length > 1000000)
          throw new UsdaClientError("response_too_large");
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new UsdaClientError("invalid_response");
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new UsdaClientError("invalid_response");
        cache.delete(key);
        while (cache.size >= maxEntries)
          cache.delete(cache.keys().next().value);
        cache.set(key, { expires: now() + ttlMs, data });
        return data;
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.set(key, operation);
    try {
      return structuredClone(await operation);
    } finally {
      pending.delete(key);
    }
  }
  return {
    async search(query, { pageSize = 5, dataTypes = ["SR Legacy"] } = {}) {
      if (
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 160 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 10 ||
        !Array.isArray(dataTypes) ||
        !dataTypes.length ||
        dataTypes.some(
          (t) => !["SR Legacy", "Foundation", "Survey (FNDDS)"].includes(t),
        )
      )
        throw new UsdaClientError("invalid_search");
      const result = await request("/foods/search", {
        query: query.trim(),
        pageSize,
        dataType: dataTypes,
      });
      if (!Array.isArray(result.foods))
        throw new UsdaClientError("invalid_response");
      return {
        matches: result.foods.map((f) => ({
          fdcId: f.fdcId,
          description: f.description,
          dataType: f.dataType,
        })),
        selectionRequired: true,
      };
    },
    async detail(fdcId) {
      if (!Number.isInteger(fdcId) || fdcId < 1 || fdcId > 1000000000)
        throw new UsdaClientError("invalid_fdc_id");
      const result = await request(`/food/${fdcId}`);
      if (result.fdcId !== fdcId || !Array.isArray(result.foodNutrients))
        throw new UsdaClientError("invalid_response");
      return result;
    },
    status: () => ({
      provider: "usda_fdc",
      configured: true,
      cacheEntries: cache.size,
      networkHealth: "not_assumed",
    }),
  };
}
