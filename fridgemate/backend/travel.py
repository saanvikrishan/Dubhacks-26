"""Server-only WALK Compute Route Matrix. No third-party dependencies or stored keys."""
import copy
import json
import math
import os
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

ORIGIN = {"name": "UW HUB", "lat": 47.655318, "lng": -122.30519045767}
DESTINATIONS = [
    {"id": "local-point", "lat": 47.655665634132, "lng": -122.31506904899},
    {"id": "center-table", "lat": 47.660001521503, "lng": -122.30423292456},
    {"id": "husky-den", "lat": ORIGIN["lat"], "lng": ORIGIN["lng"]},
]
ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def transport(request):
    with build_opener(NoRedirect).open(request, timeout=12) as response:
        return json.load(response)

def point(pin):
    return {"waypoint": {"location": {"latLng": {"latitude": pin["lat"], "longitude": pin["lng"]}}}}

def unknown(venue_id, status="unknown"):
    return {"venueId": venue_id, "status": status, "distanceMeters": None, "durationSeconds": None, "walkingMinutes": None}

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0

class WalkingClient:
    def __init__(self, api_key=None, send=transport, now=time.time):
        self.api_key = api_key
        self.send = send
        self.now = now
        self.cache = None
        self.lock = threading.Lock()

    def matrix(self):
        # Fixed HUB origin and three known destinations; no user-provided address or URL.
        with self.lock:
            if self.cache and self.now() - self.cache[0] < 300:
                return copy.deepcopy(self.cache[1])
            result = self._compute()
            if result["status"] in ("verified", "partial"):
                self.cache = (self.now(), result)
            return copy.deepcopy(result)

    def _compute(self):
        key = self.api_key if self.api_key is not None else os.getenv("GOOGLE_MAPS_API_KEY", "")
        base = {"origin": ORIGIN, "routes": [unknown(v["id"]) for v in DESTINATIONS]}
        if not key.strip(): return {**base, "status": "missing_api_key"}
        request = Request(ENDPOINT, method="POST", data=json.dumps({
            "origins": [point(ORIGIN)], "destinations": [point(v) for v in DESTINATIONS], "travelMode": "WALK"
        }).encode(), headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration"})
        try:
            rows = self.send(request)
        except HTTPError as error:
            return {**base, "status": "rate_limited" if error.code == 429 else "api_rejected", "httpStatus": error.code}
        except Exception:
            # Provider exception strings may contain secrets. Never expose them.
            return {**base, "status": "network_or_timeout"}
        if not isinstance(rows, list): return {**base, "status": "invalid_response"}
        checked = datetime.fromtimestamp(self.now(), timezone.utc).isoformat()
        routes = []
        for index, venue in enumerate(DESTINATIONS):
            matches = [row for row in rows if isinstance(row, dict) and row.get("originIndex") == 0 and row.get("destinationIndex") == index]
            if len(matches) != 1:
                routes.append(unknown(venue["id"], "invalid_element")); continue
            row = matches[0]
            status = row.get("status")
            if not isinstance(status, dict) or status.get("code", 0) != 0 or row.get("condition") != "ROUTE_EXISTS":
                routes.append(unknown(venue["id"], "route_unavailable")); continue
            duration = row.get("duration")
            try:
                seconds = float(duration[:-1]) if isinstance(duration, str) and duration.endswith("s") else None
            except ValueError:
                seconds = None
            meters = row.get("distanceMeters")
            # Numeric zero is omitted by Google's protobuf JSON serializer for an identical pin.
            if meters is None and seconds == 0 and venue["lat"] == ORIGIN["lat"] and venue["lng"] == ORIGIN["lng"]:
                meters = 0
            if not finite(seconds) or not finite(meters):
                routes.append(unknown(venue["id"], "invalid_element")); continue
            routes.append({"venueId": venue["id"], "status": "verified", "distanceMeters": meters,
                "durationSeconds": seconds, "walkingMinutes": math.ceil(seconds / 60), "checkedAt": checked,
                "travelMode": "WALK", "source": "Google Routes API", "origin": ORIGIN,
                "destination": {"lat": venue["lat"], "lng": venue["lng"]}})
        return {"status": "verified" if all(r["status"] == "verified" for r in routes) else "partial",
            "origin": ORIGIN, "checkedAt": checked, "routes": routes,
            "attribution": "Google Maps", "advisory": "Walking routes may lack clear sidewalks or pedestrian paths. Use caution."}

walking_client = WalkingClient()
