"""Reviewed USDA detail records and deterministic ingredient nutrition; never recipe search."""
from __future__ import annotations
import asyncio
import copy
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
import httpx

FDC_BASE = 'https://api.nal.usda.gov/fdc/v1'
DATA = Path(__file__).resolve().parents[1] / 'frontend/src/data/food'
MANIFEST = json.loads((DATA / 'ingredient-matches.json').read_text())
MATCHES = {row['key']: row for row in MANIFEST['matches']}
NAMES = {name: row['key'] for row in MANIFEST['matches'] for name in [row['key'], *row.get('aliases', [])]}
DEFAULTS = MANIFEST.get('defaults', {})
NUTRIENT_IDS = json.loads((DATA / 'nutrient-map.json').read_text())
USDA_API_KEY = ''
TTL = 21600
BATCH = 10        # small full-detail requests return quickly
PARALLEL = 4      # concurrent USDA requests per refresh
MAX_IDS = 200     # reviewed ingredient list size guard


def refresh_api_key():
    global USDA_API_KEY
    USDA_API_KEY = (os.getenv('USDA_API_KEY') or os.getenv('FDC_API_KEY') or '').strip()
    return USDA_API_KEY


def usda_configured():
    return bool(refresh_api_key())


# Mirror of frontend/src/domain/ingredientNames.js; both pass tests/fixtures/ingredient-names.json.
UNITS = r'g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|l|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|pieces?|slices?|cans?|pinch(?:es)?|dash(?:es)?|handfuls?|bunch(?:es)?|stalks?'
DESCRIPTORS = {'fresh', 'chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded', 'finely', 'roughly', 'thinly', 'coarsely', 'large', 'small',
               'medium', 'boneless', 'skinless', 'peeled', 'organic', 'raw', 'uncooked', 'halved', 'cubed', 'julienned', 'trimmed', 'rinsed', 'drained',
               'warm', 'cold', 'hot', 'boiling', 'lukewarm'}


def clean_name(name):
    text = re.sub(r'\([^)]*\)', ' ', str(name or '').lower()).split(',')[0]
    text, quantity = re.subn(r'^\s*[\d½¼¾⅓⅔⅛][\d\s./½¼¾⅓⅔⅛-]*', ' ', text)
    if quantity:
        text = re.sub(rf'^\s*(?:{UNITS})\b\.?(?:\s+of)?\s+', ' ', text)
    return re.sub(r'\s+', ' ', re.sub(r'\b(?:to taste|for garnish|optional|divided)\b', ' ', text)).strip()


def _forms(phrase):
    *words, last = phrase.split(' ')
    stem = ' '.join(words) + ' ' if words else ''
    out = []
    if last.endswith('ies'): out.append(last[:-3] + 'y')
    if last.endswith('es'): out.append(last[:-2])
    if last.endswith('s'): out.append(last[:-1])
    if last.endswith('y'): out.append(last[:-1] + 'ies')
    if not last.endswith('s'): out += [last + 's', last + 'es']
    return [phrase, *(stem + w for w in out)]


def resolve_name(name, allow_defaults=True):
    """Reviewed key and any assumption note for a free-text ingredient; (None, None) when unknown. Never fuzzy."""
    cleaned = clean_name(name)
    stripped = ' '.join(w for w in cleaned.split(' ') if w not in DESCRIPTORS)
    for candidate in dict.fromkeys(c for c in (cleaned, stripped) if c):
        for form in _forms(candidate):
            if form in NAMES:
                return NAMES[form], None
            choice = DEFAULTS.get(form) if allow_defaults else None
            if choice:
                return choice['key'], f"For this recipe, {form} means {choice.get('note') or choice['key']}."
    return None, None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def stamp():
    return datetime.now(timezone.utc).isoformat()


def unit(text):
    return str(text or '').strip().lower().replace('µ', 'u').replace('μ', 'u')


def converted(value, source, target):
    if not finite(value):
        return None
    source, target = unit(source), unit(target)
    if target == 'kcal':
        return value if source == 'kcal' else value / 4.184 if source == 'kj' else None
    weights = {'g': 1, 'mg': .001, 'ug': .000001, 'mcg': .000001}
    return value * weights[source] / weights[target] if source in weights and target in weights else None


def nutrient_values(food):
    """IDs are nutrient IDs, not row IDs/nutrient numbers. Missing/conflicting values stay null."""
    rows = food.get('foodNutrients') or []
    values, fields = {}, {}
    for key, normal_ids in NUTRIENT_IDS.items():
        ids = ([2048, 2047, 1008, 1062] if food.get('dataType') == 'Foundation' else [1008, 2048, 2047, 1062]) if key == 'energy_kcal' else normal_ids
        target = 'kcal' if key == 'energy_kcal' else 'mg' if key.endswith('_mg') else 'ug' if key.endswith('_mcg') else 'g'
        values[key] = None
        fields[key] = {'status': 'unknown', 'originalRows': [], 'unit': target}
        for ident in ids:
            selected = [r for r in rows if (r.get('nutrient') or {}).get('id', r.get('nutrientId')) == ident]
            if not selected:
                continue
            parsed = [converted(r.get('amount', r.get('value')), (r.get('nutrient') or {}).get('unitName', r.get('unitName')), target) for r in selected]
            distinct = set(parsed)
            value = parsed[0] if len(distinct) == 1 and None not in distinct else None
            fields[key] = {'status': 'usda_published_normalized' if value is not None else 'unknown', 'nutrientId': ident, 'originalRows': copy.deepcopy(selected), 'unit': target}
            if value is not None:
                values[key] = value
                break
    return values, fields


def _extract_per_100g(food):
    values, _ = nutrient_values(food)
    return values if any(v is not None for v in values.values()) else None


async def request(path, payload):
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as http:
        response = await http.post(FDC_BASE + path, params={'api_key': refresh_api_key()}, json=payload)
        return response.status_code, response.json() if response.status_code == 200 else None


class FdcClient:
    def __init__(self, send=request, now=time.time, saved=None):
        self.send, self.now = send, now
        rows = saved if saved is not None else json.loads((DATA / 'usda-records.json').read_text())['records']
        self.saved = {r['fdcId']: copy.deepcopy(r) for r in rows}
        self.cache = {}
        self.lock = asyncio.Lock()
        self.retry_at = 0

    async def details(self, ids, force=False):
        ids = list(dict.fromkeys(ids))
        if len(ids) > MAX_IDS or any(not isinstance(i, int) or i <= 0 for i in ids):
            raise ValueError(f'Use at most {MAX_IDS} positive FDC IDs.')
        async with self.lock:
            needed = [i for i in ids if force or i not in self.cache or self.cache[i][0] <= self.now()]
            status = 'cached' if not needed else 'saved_reference'
            if needed and usda_configured() and self.now() >= self.retry_at:
                gate = asyncio.Semaphore(PARALLEL)

                async def fetch(batch):
                    async with gate:
                        try:
                            code, body = await self.send('/foods', {'fdcIds': batch, 'format': 'full'})
                        except Exception:
                            return 'network_or_invalid_response'
                    if code != 200 or not isinstance(body, list):
                        return 'rate_limited' if code == 429 else 'api_rejected'
                    checked = stamp()
                    for record in body:
                        if isinstance(record, dict) and record.get('fdcId') in batch:
                            record = {**record, 'retrievedAt': checked, 'retrievalUrl': FDC_BASE + '/food/' + str(record['fdcId'])}
                            self.cache[record['fdcId']] = (self.now()+TTL, record)
                    return 'retrieved'

                results = await asyncio.gather(*(fetch(needed[i:i+BATCH]) for i in range(0, len(needed), BATCH)))
                failed = [r for r in results if r != 'retrieved']
                # Successful batches stay live; failed ones fall back to saved records below.
                status = 'retrieved' if not failed else 'rate_limited' if 'rate_limited' in failed else failed[0]
                if failed:
                    self.retry_at = self.now() + (60 if 'rate_limited' in failed else 30)
            records = []
            for ident in ids:
                cached = self.cache.get(ident)
                record = cached[1] if cached and cached[0] > self.now() else self.saved.get(ident)
                if record:
                    records.append(copy.deepcopy(record))
            return {'status': status, 'records': records, 'missingIds': [i for i in ids if not any(r['fdcId'] == i for r in records)]}

    async def search_candidates(self, query):
        if not isinstance(query, str) or not 2 <= len(query.strip()) <= 80:
            raise ValueError('Use a query of 2–80 characters.')
        if not usda_configured():
            return {'status': 'missing_configuration', 'candidates': []}
        try:
            code, body = await self.send('/foods/search', {'query': query.strip(), 'dataType': ['Foundation', 'SR Legacy'], 'pageSize': 10})
            return {'status': 'needs_review' if code == 200 else 'rate_limited' if code == 429 else 'api_rejected', 'candidates': [{k: r.get(k) for k in ['fdcId', 'description', 'dataType']} for r in (body or {}).get('foods', [])[:10]]}
        except Exception:
            return {'status': 'network_or_invalid_response', 'candidates': []}


fdc_client = FdcClient()


def matched_record(record, match):
    return bool(record and record.get('fdcId') == match['fdcId'] and record.get('description') == match['expectedDescription'] and record.get('dataType') == match['expectedDataType'])


def compact_record(record):
    ids={ident for group in NUTRIENT_IDS.values() for ident in group}|{2047,2048}
    return {**{k:record.get(k) for k in ['fdcId','description','dataType','publicationDate','retrievedAt','retrievalUrl','foodPortions']},
            **{k:record[k] for k in ['brandOwner'] if k in record},
            'foodNutrients':[{k:r[k] for k in ['id','nutrient','amount'] if k in r} for r in record.get('foodNutrients',[]) if r.get('nutrient',{}).get('id') in ids]}


def slim_record(record):
    """Saved fallback copy: every nutrient value kept, USDA lab metadata (samples, min/max, derivation) dropped."""
    return {**{k:record[k] for k in ['fdcId','description','dataType','brandOwner','foodCategory','publicationDate','retrievedAt','retrievalUrl','foodPortions'] if k in record},
            'foodNutrients':[{k:r[k] for k in ['id','nutrient','amount'] if k in r} for r in record.get('foodNutrients',[])]}


async def ingredient_reference():
    result = await fdc_client.details([m['fdcId'] for m in MATCHES.values()])
    records = {r['fdcId']: r for r in result['records']}
    return {**result, 'matches': [m for m in MATCHES.values() if matched_record(records.get(m['fdcId']), m)], 'unresolved': MANIFEST['unresolved']}


async def lookup_per_100g(query):
    key, _ = resolve_name(query, allow_defaults=False)  # a bare lookup cannot show an assumption note
    match = MATCHES.get(key)
    if not match:
        return None  # Fuzzy search results require explicit review; never auto-certify.
    result = await fdc_client.details([match['fdcId']])
    record = next((r for r in result['records'] if matched_record(r, match)), None)
    return _extract_per_100g(record) if record else None


async def enrich_meal(meal):
    """Compatibility adapter: full coverage per nutrient, positive input grams, explicit yield."""
    ingredients = meal.get('ingredients') or []
    servings = (meal.get('nutrition') or {}).get('yieldServings', 1)
    if not ingredients or not finite(servings) or servings <= 0:
        return meal
    result = await ingredient_reference()
    records = {r['fdcId']: r for r in result['records']}
    rows = []
    for item in ingredients:
        name, grams = item.get('name'), item.get('grams')
        key, assumption = resolve_name(name)
        match = MATCHES.get(key)
        record = records.get(match['fdcId']) if match else None
        values = nutrient_values(record)[0] if match and matched_record(record, match) and finite(grams) and grams > 0 else {}
        rows.append({'name': name, 'grams': grams, 'fdcId': match['fdcId'] if values else None, 'values': values, 'record': record if values else None,
                     'assumption': assumption if values else None})
    values, coverage = {}, {}
    for key in NUTRIENT_IDS:
        known = [r['values'][key]*r['grams']/100/servings for r in rows if r['values'].get(key) is not None]
        values[key] = sum(known) if len(known) == len(rows) else None
        coverage[key] = {'known': len(known), 'total': len(rows), 'knownSubtotal': sum(known) if known else None}
    return {**meal, 'nutrition': {'basis': 'per_serving', 'kind': 'ingredient_estimate', 'values': values, 'coverage': coverage,
        'source': 'USDA FoodData Central; reviewed ingredient IDs and measured input grams.',
        'checkedAt': min((r['record']['retrievedAt'] for r in rows if r['record']), default=None),
        'preparation': 'Input-weight ingredient estimate; cooking losses, exact brand and final serving weight are not measured.',
        'assumptions': [r['assumption'] for r in rows if r['assumption']],
        'matches': [{'name': r['name'], 'grams': r['grams'], 'fdcId': r['fdcId'], 'sourceUrl': FDC_BASE+'/food/'+str(r['fdcId']) if r['fdcId'] else None} for r in rows]}}


async def enrich_meals(meals):
    return [await enrich_meal(meal) for meal in meals]
