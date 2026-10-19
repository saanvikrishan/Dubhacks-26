# Kroger Public APIs — Codex Reference (whatscooking.ai)

**Purpose:** Use Kroger's public APIs as a potential source of **store-specific grocery prices** for whatscooking.ai's Cook-mode ingredient-cost estimates. These APIs cover Kroger-owned chains/locations, **not all Seattle grocery stores**.

## 1. Products API

Docs: https://developer.kroger.com/documentation/api-products/public/products/overview

- **Operations:** `GET` product search (search term or product ID); `GET` product details (specific product).
- **Rate limit:** **10,000 calls/day**, shared across operations on the `/products` endpoint.
- **Search pagination:** Default **10 results**; use `filter.limit` and `filter.start`. Search is fuzzy, so result order can change between requests.
- **Critical for pricing:** Include `filter.locationId` on `/products` requests. Without a location ID, store-specific price and other location-dependent data may not be returned.
- **Price fields:** `price` (regular/promo) and `nationalPrice` (national regular/promo), when available. Seasonal items may lack prices; some items lack national prices.
- **Fulfillment flags:** `instore`, `shiptohome`, `delivery`, `curbside`. `instore: true` means the store sells the item, **not** that it is currently in stock.
- **Optional inventory:** `stockLevel` may be absent; documented values: `HIGH`, `LOW`, `TEMPORARILY_OUT_OF_STOCK`.
- **Product links:** `productPageURI` is a relative URI; prepend the appropriate chain domain retrieved from the Locations API `/v1/chains` response.
- **Other store data:** Item aisle location may be returned for the selected store.

## 2. Locations API

Docs: https://developer.kroger.com/documentation/api-products/public/locations/overview

- **Purpose:** Discover Kroger-owned stores, chains, and departments, and look up a **location ID** for product pricing.
- **Rate limit:** **1,600 calls/day per endpoint** (three endpoint groups, each with its own cap).
- **Pagination:** Not supported. Default/max response limit is **9,999**; control with `filter.limit`.
- **Search radius:** Defaults to **10 miles**; adjust using `filter.radiusInMiles` where needed.
- **Operations:** Location list/details (`GET`) and existence check (`HEAD`); chain list/details (`GET`) and check (`HEAD`); department list/details (`GET`) and check (`HEAD`).

## 3. Recommended whatscooking.ai integration flow

1. Look up a nearby **Kroger-owned** store via Locations API; retain its verified `locationId`, name, and location.
2. Search relevant Cook-mode ingredients using Products API **with `filter.locationId`**.
3. Match products carefully (item, size, unit); use returned store-specific regular/promo prices **only when actually present**.
4. For recipe cost estimates, normalize package price to the amount used. Label calculations as **estimated ingredient costs**, not guaranteed checkout totals.
5. On missing/ambiguous matches, unavailable prices, or API errors, show **price unavailable** rather than invented data. Cache appropriate lookups to protect rate limits.

## 4. Implementation boundaries / verification

- **Keep edits scoped** to grocery-price data integration and its existing Cook-mode display. Do not rewrite teammates' Gemini, routing, or unrelated UI work.
- Keep API credentials and any client secret **server-side**; never expose them in frontend code, commits, or logs.
- These two PDFs are **overviews only**: they do **not** document OAuth token setup, exact request URLs for every operation, full query/response schemas, or permissions. Verify these against Kroger's **Products API Reference**, **Locations API Reference**, and authentication docs before coding.
- Do not claim Seattle grocery coverage, real-time stock, or successful API integration until tested against actual responses.

**Sources:** Kroger *Products API Overview* (3 pages) and *Locations API Overview* (2 pages), supplied Oct 18, 2026.
