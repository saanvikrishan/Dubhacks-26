> Latest main merge, nutrition, preference and calendar update: [README-MAIN-PREFERENCES-FIX.md](README-MAIN-PREFERENCES-FIX.md). Older counts and paths below are historical.

# API, pricing and image checks — 2026-10-18

**Current implementation:** see [README-FOOD-INTEGRATION.md](README-FOOD-INTEGRATION.md) and [FOOD-INTEGRATION-VERIFICATION.json](FOOD-INTEGRATION-VERIFICATION.json). The earlier observations below predate recipe costing.

Evidence: [API-VERIFICATION.json](API-VERIFICATION.json). All values in that file are historical verification observations, not live promises. No keys or OAuth tokens are included.

## Live API results

- Google Routes WALK Compute Route Matrix succeeded through `POST /api/dining/walking`: UW HUB → Local Point 918 m / 730 s (13 rounded-up minutes), Center Table 544 m / 491 s (9 minutes), Husky Den 0 m / 0 s at the identical HUB pin. Retrieval time is retained; normal route expiry remains five minutes.
- Kroger OAuth, location lookup and product lookup all returned HTTP 200. The new app endpoints also returned HTTP 200. The verification store was QFC University Village, location `70500807`; it is a test selection, not an automatic user-store preference.
- Example exact SKU `0001111091342`: Simple Truth Organic Extra Firm Tofu, 14 oz, regular 3.49 and separate promotional 1.99. The full original price/date fields and other returned packages are retained in the evidence file. These are package quotes; tax, promotional eligibility, stock and recipe portion cost are unconfirmed.

## Reusable server endpoints

The existing backend reads `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` exclusively from its server environment.

- `GET /api/pricing/kroger/status`: configuration only; it does not claim connectivity.
- `GET /api/pricing/kroger/locations?zip_code=98105`: bounded public store lookup.
- `GET /api/pricing/kroger/products?location_id=70500807&term=tofu`: store-scoped package quotes, cached up to 15 minutes.

Unknown prices stay null. Promotions remain separate, including zero promotional fields. No product search result is silently matched to a recipe, converted from a pack count into grams, or applied as a meal price. This earlier quote-only check has been superseded by reviewed product matching and automatic ingredient-use costing for supported recipes. Ambiguous variants and package bases remain incomplete; see the current implementation report.

## Price checks

The strict engine rejects missing, nonfinite, negative and over-budget costs; an exact cap passes. The verified UW catalog retains 23 explicitly matched priced menu rows. Every displayed menu cost retains its original PDF value, source and page. Menu dates, portion/plate scopes, independent deals and unknown facts remain separate.

## Image checks

Random Flickr fallbacks and arbitrary remote image URLs no longer populate recipe cards. Curated local tofu, pasta and chickpea illustrations are used for their explicit catalog IDs. Automatic photo search is disabled: keyword matches still produced a wrong tofu salad picture. Only the three explicit ID/name assignments may render bundled illustrations. All other dishes and failed images show a neutral photo-unavailable placeholder; supplied remote URLs and generated search phrases are ignored.

## Validation

Before the photo-only follow-up, 117 JavaScript tests, 23 backend tests, full lint and the production build passed. The deterministic-photo follow-up passes three focused image/price regressions, lint on the touched code, and the production build. API tests use fake transports; the live checks above were explicit, bounded read-only requests. The existing bundle-size warning remains. No main-branch push or force push is part of this work.

Reference contracts: [Google route matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix), [Kroger public API workspace](https://www.postman.com/kroger/the-kroger-co-s-public-workspace/documentation/ki6utqb/kroger-public-apis).
