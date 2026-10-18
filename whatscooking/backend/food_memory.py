"""Per-user Backboard memory of meal choices. Current explicit preferences stay authoritative."""
import asyncio
import re
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from branding import BRAND, LEGACY_USER_PREFIX, find_assistant

# ── Per-user meal feedback (chose / logged / skipped) ────────────────────────
# Each anonymous user gets their own Backboard assistant, so memories are
# isolated server-side by assistant. The id is a random browser UUID, not an
# authenticated identity.
USER_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
WEIGHTS = {'logged': 2, 'chose': 1, 'skipped': -1}
_assistants = {}
_learned = {}
_sent = {}
_locks = {}


class MealFeedback(BaseModel):
    model_config = ConfigDict(extra='forbid')
    user: str = Field(max_length=36)
    kind: Literal['chose', 'logged', 'skipped']
    eventId: str = Field(min_length=1, max_length=200)
    mealId: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=80)
    mode: Literal['cook', 'eatOut'] = 'cook'
    cuisines: list[str] = Field(default_factory=list, max_length=4)
    tastes: list[str] = Field(default_factory=list, max_length=6)
    mainIngredients: list[str] = Field(default_factory=list, max_length=5)
    at: str = Field(default='', max_length=40)


def valid_user(user_id):
    return isinstance(user_id, str) and bool(USER_ID.match(user_id))


def empty_learned(status):
    return {'status': status, 'likedCuisines': [], 'likedTastes': [], 'likedIngredients': [],
            'avoidCuisines': [], 'recentMeals': [], 'repeatedlySkipped': [], 'events': 0}


async def user_assistant(client, user_id, create=False):
    if not valid_user(user_id):
        raise ValueError('Invalid user id')
    if user_id in _assistants:
        return _assistants[user_id]
    # One lock per user so concurrent first events cannot create two assistants.
    async with _locks.setdefault(user_id, asyncio.Lock()):
        if user_id in _assistants:
            return _assistants[user_id]
        name = f'{BRAND} user {user_id}'
        ident = await find_assistant(client, name, (f'{LEGACY_USER_PREFIX}{user_id}',))
        if not ident and create:
            created = await asyncio.wait_for(client.create_assistant(
                name=name, description='whatscooking.ai meal choices for one anonymous user'), timeout=10)
            ident = str(created.assistant_id)
        if ident:
            _assistants[user_id] = ident
        return ident


def _clean(values, limit=40):
    return [v.strip()[:limit] for v in values if isinstance(v, str) and v.strip()]


async def record_feedback(client, event: MealFeedback):
    """Store one explicit meal event. Duplicate event ids are ignored."""
    if client is None:
        return {'status': 'missing_configuration'}
    if not valid_user(event.user):
        raise ValueError('Invalid user id')
    sent = _sent.setdefault(event.user, set())
    if event.eventId in sent:
        return {'status': 'duplicate'}
    try:
        ident = await user_assistant(client, event.user, create=True)
        cuisines, tastes = _clean(event.cuisines), _clean(event.tastes)
        verb = {'chose': 'Chose', 'logged': 'Ate and logged', 'skipped': 'Skipped'}[event.kind]
        details = ', '.join(cuisines + tastes)
        content = f"{verb} {event.name.strip()}" + (f" ({details})" if details else '') + \
            (' at a UW dining location.' if event.mode == 'eatOut' else ' to cook.')
        metadata = {'type': 'meal_feedback', 'kind': event.kind, 'eventId': event.eventId,
                    'mealId': event.mealId, 'name': event.name.strip(), 'mode': event.mode,
                    'cuisines': cuisines, 'tastes': tastes,
                    'mainIngredients': _clean(event.mainIngredients, 60), 'at': event.at}
        await asyncio.wait_for(client.add_memory(ident, content, metadata=metadata), timeout=10)
    except Exception:
        return {'status': 'unavailable'}
    sent.add(event.eventId)
    if len(sent) > 500:
        sent.clear()
    _learned.pop(event.user, None)
    return {'status': 'saved'}


def summarize_feedback(body):
    """Turn feedback memories into conservative learned preferences (no model call)."""
    if hasattr(body, 'model_dump'):
        body = body.model_dump()
    rows = body.get('memories', []) if isinstance(body, dict) else []
    events, seen = [], set()
    for row in rows:
        meta = row.get('metadata') if isinstance(row, dict) else None
        if not isinstance(meta, dict) or meta.get('type') != 'meal_feedback' or meta.get('kind') not in WEIGHTS:
            continue
        key = meta.get('eventId') or row.get('id')
        if key in seen:
            continue
        seen.add(key)
        events.append(meta)
    events.sort(key=lambda m: str(m.get('at') or ''), reverse=True)
    result = empty_learned('retrieved')
    result['events'] = len(events)
    scores = {'cuisines': {}, 'tastes': {}, 'mainIngredients': {}}
    positive, skips, dish_skips, dish_positive = {}, {}, {}, set()
    for meta in events:
        weight = WEIGHTS[meta['kind']]
        name = str(meta.get('name') or '').strip()[:80]
        for field, table in scores.items():
            for value in _clean(meta.get(field) or [], 60):
                key = value.lower()
                table[key] = (table[key][0] + weight, value) if key in table else (weight, value)
        for cuisine in _clean(meta.get('cuisines') or []):
            if weight > 0:
                positive[cuisine.lower()] = True
            else:
                skips[cuisine.lower()] = (skips.get(cuisine.lower(), (0, cuisine))[0] + 1, cuisine)
        if not name:
            continue
        if weight > 0:
            dish_positive.add(name.lower())
            if name.lower() not in [m.lower() for m in result['recentMeals']] and len(result['recentMeals']) < 8:
                result['recentMeals'].append(name)
        else:
            dish_skips[name.lower()] = (dish_skips.get(name.lower(), (0, name))[0] + 1, name)
    liked = lambda table, n: [label for score, label in sorted(table.values(), key=lambda v: -v[0]) if score >= 2][:n]
    result['likedCuisines'] = liked(scores['cuisines'], 4)
    result['likedTastes'] = liked(scores['tastes'], 4)
    result['likedIngredients'] = liked(scores['mainIngredients'], 6)
    # One skip is not a dislike: avoid a cuisine only after 3+ skips and no positive signal.
    result['avoidCuisines'] = [label for key, (count, label) in skips.items() if count >= 3 and key not in positive][:4]
    result['repeatedlySkipped'] = [label for key, (count, label) in dish_skips.items() if count >= 2 and key not in dish_positive][:6]
    return result


async def learned_preferences(client, user_id):
    if client is None:
        return empty_learned('missing_configuration')
    if not valid_user(user_id):
        return empty_learned('missing_user')
    cached = _learned.get(user_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        ident = await user_assistant(client, user_id)
        if not ident:
            result = empty_learned('no_history')
        else:
            memories = await asyncio.wait_for(client.get_memories(ident, page_size=100), timeout=5)
            result = summarize_feedback(memories)
    except Exception:
        result = empty_learned('unavailable')
    _learned[user_id] = (time.monotonic() + (60 if result['status'] in ('retrieved', 'no_history') else 15), result)
    return result
