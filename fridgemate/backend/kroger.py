"""Read-only, store-scoped Kroger quotes. Credentials and OAuth tokens stay server-side."""
import copy
import math
import os
import re
import threading
import time
from datetime import datetime, timezone

import httpx

BASE = "https://api.kroger.com/v1"
QUOTE_TTL = 900


def request(method, path, **options):
    with httpx.Client(timeout=12, follow_redirects=False) as client:
        return client.request(method, BASE + path, **options)


def amount(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def product_quotes(products, location_id, checked):
    quotes = []
    for product in products:
        if not isinstance(product, dict):
            continue
        for item in product.get("items") or []:
            if not isinstance(item, dict):
                continue
            original = item.get("price") if isinstance(item.get("price"), dict) else {}
            regular, promo = amount(original.get("regular")), amount(original.get("promo"))
            quotes.append({
                "locationId": location_id, "productId": product.get("productId"), "itemId": item.get("itemId"),
                "description": product.get("description"), "brand": product.get("brand"),
                "packageSize": item.get("size"), "soldBy": item.get("soldBy"),
                "regularPrice": regular, "promotionalPrice": promo,
                "status": "retrieved_price" if regular is not None else "unknown",
                "checkedAt": stamp(checked), "expiresAt": stamp(checked + QUOTE_TTL),
                "effectiveDate": original.get("effectiveDate"), "expirationDate": original.get("expirationDate"),
                "source": "Kroger Products API", "sourceUrl": BASE + "/products/" + str(product.get("productId") or ""),
                "originalPrice": copy.deepcopy(original), "portionCost": None,
                "limitations": ["Store-specific package quote; not a recipe portion cost.",
                                 "Promotions are separate; membership, quantity conditions, stock, tax and checkout total are not confirmed.",
                                 "Missing price is unknown. A zero promotional value is not automatically applied as a free item."],
            })
    return quotes


class KrogerClient:
    def __init__(self, client_id=None, client_secret=None, send=request, now=time.time):
        self.client_id = client_id
        self.client_secret = client_secret
        self.send, self.now = send, now
        self.token = None
        self.token_expires = 0
        self.cache = {}
        self.lock = threading.Lock()

    def status(self):
        return {"configured": bool(self._credentials()[0] and self._credentials()[1]), "connected": None,
                "priceBasis": "store-specific package", "requiresLocationId": True, "portionCost": None}

    def _credentials(self):
        return ((self.client_id if self.client_id is not None else os.getenv("KROGER_CLIENT_ID", "")).strip(),
                (self.client_secret if self.client_secret is not None else os.getenv("KROGER_CLIENT_SECRET", "")).strip())

    def _read(self, path, params):
        client_id, client_secret = self._credentials()
        if not client_id or not client_secret:
            return {"status": "missing_configuration"}, None
        try:
            if not self.token or self.token_expires <= self.now():
                response = self.send("POST", "/connect/oauth2/token", auth=(client_id, client_secret),
                                     data={"grant_type": "client_credentials", "scope": "product.compact"})
                if response.status_code != 200:
                    return {"status": "authentication_failed", "httpStatus": response.status_code}, None
                body = response.json()
                token, seconds = body.get("access_token"), amount(body.get("expires_in"))
                if not isinstance(token, str) or not token or seconds is None or seconds <= 0:
                    return {"status": "invalid_authentication_response"}, None
                self.token = token
                self.token_expires = self.now() + max(0, seconds - 60)
            response = self.send("GET", path, headers={"Authorization": "Bearer " + self.token}, params=params)
            if response.status_code != 200:
                if response.status_code == 401:
                    self.token = None
                return {"status": "rate_limited" if response.status_code == 429 else "api_rejected", "httpStatus": response.status_code}, None
            rows = response.json().get("data")
            if isinstance(rows, dict) and path.startswith("/products/"):
                rows = [rows]
            if not isinstance(rows, list):
                return {"status": "invalid_response"}, None
            return None, rows
        except Exception:
            # Provider exception strings can contain credentials or tokens.
            return {"status": "network_or_invalid_response"}, None

    def locations(self, zip_code):
        if not isinstance(zip_code, str) or not re.fullmatch(r"\d{5}", zip_code):
            raise ValueError("Use a five-digit ZIP code.")
        with self.lock:
            error, rows = self._read("/locations", {"filter.zipCode.near": zip_code, "filter.limit": 5})
            if error:
                return {**error, "locations": []}
            return {"status": "retrieved", "checkedAt": stamp(self.now()), "locations": [
                {key: row.get(key) for key in ("locationId", "name", "chain", "address")}
                for row in rows if isinstance(row, dict)]}

    def products(self, location_id, term):
        if not isinstance(location_id, str) or not re.fullmatch(r"\d{8}", location_id):
            raise ValueError("Choose an eight-digit Kroger location ID.")
        if not isinstance(term, str) or not 2 <= len(term.strip()) <= 80:
            raise ValueError("Use a product query of 2–80 characters.")
        term = term.strip()
        key = (location_id, term.casefold())
        with self.lock:
            previous = self.cache.get(key)
            if previous and self.now() - previous[0] < QUOTE_TTL:
                return {**copy.deepcopy(previous[1]), "cached": True}
            error, rows = self._read("/products", {"filter.locationId": location_id, "filter.term": term, "filter.limit": 5})
            if error:
                return {**error, "locationId": location_id, "quotes": []}
            checked = self.now()
            result = {"status": "retrieved", "locationId": location_id, "checkedAt": stamp(checked),
                      "expiresAt": stamp(checked + QUOTE_TTL), "quotes": product_quotes(rows, location_id, checked), "cached": False}
            self.cache[key] = (checked, copy.deepcopy(result))
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
            return result

    def product(self, location_id, product_id):
        if not isinstance(location_id, str) or not re.fullmatch(r"\d{8}", location_id):
            raise ValueError("Choose an eight-digit Kroger location ID.")
        if not isinstance(product_id, str) or not re.fullmatch(r"\d{10,14}", product_id):
            raise ValueError("Use a valid product ID.")
        key = (location_id, "product:" + product_id)
        with self.lock:
            previous = self.cache.get(key)
            if previous and self.now()-previous[0] < QUOTE_TTL:
                return {**copy.deepcopy(previous[1]), "cached": True}
            error, rows = self._read("/products/"+product_id, {"filter.locationId":location_id})
            if error:
                return {**error,"locationId":location_id,"quotes":[]}
            checked=self.now()
            result={"status":"retrieved","locationId":location_id,"checkedAt":stamp(checked),"expiresAt":stamp(checked+QUOTE_TTL),"quotes":product_quotes(rows,location_id,checked),"cached":False}
            self.cache[key]=(checked,copy.deepcopy(result))
            if len(self.cache)>64:self.cache.pop(next(iter(self.cache)))
            return result


kroger_client = KrogerClient()
