"""Generated meal photos for Cook recipes: one cached, accuracy-checked image per dish.

Only exact photos are shown. A photo is reused for another recipe only when it is the same dish:
the same dish type (ignoring word order and filler words) and the same three main ingredients.
UW dining dishes never use this; a generated picture must not stand in for a real served dish.

Speed comes from drawing before anyone looks: every new recipe batch is pre-drawn on the server,
common dishes are warmed in the background (ordered by Backboard-learned preferences), and a
shared Backboard photo index lets any recipe find an existing photo of the same dish.
"""
import asyncio
from branding import LEGACY_PHOTO_NAMES, find_assistant
import hashlib
import io
import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Literal

from google.genai import types
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, field_validator

IMAGE_DIR = Path(__file__).resolve().parent / 'generated-images'
KEY = re.compile(r'^[0-9a-f]{32}$')
WIDTH = 768        # card cover is wide and short; 16:9 at 768 px is ~60-100 KB as JPEG
TIMEOUT = 30
MAIN = 3           # the heaviest ingredients decide what a dish looks like
FILLER = {'with', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'style', 'quick', 'easy', 'simple', 'classic', 'homemade', 'basic'}


class MealImageRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=80)
    ingredients: list[str] = Field(default_factory=list, max_length=8)   # heaviest first
    cuisine: str | None = Field(default=None, max_length=40)
    dishType: str | None = Field(default=None, max_length=40)
    # 'campus': a real published UW menu item; 'place' is its station and portion (no ingredient list exists).
    setting: Literal['home', 'campus'] = 'home'
    place: str | None = Field(default=None, max_length=80)

    @field_validator('name')
    @classmethod
    def plain_name(cls, value):
        if not value.strip():
            raise ValueError('Name the dish.')
        return ' '.join(value.split())

    @field_validator('ingredients')
    @classmethod
    def plain_ingredients(cls, values):
        if any(not isinstance(v, str) or not v.strip() or len(v) > 60 for v in values):
            raise ValueError('Use short ingredient names.')
        return list(dict.fromkeys(' '.join(v.lower().split()) for v in values))

    @field_validator('dishType')
    @classmethod
    def plain_dish(cls, value):
        if not isinstance(value, str):
            return None
        return ' '.join(value.lower().split()) or None


class PredrawRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requests: list[MealImageRequest] = Field(max_length=16)


class WarmRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    user: str | None = Field(default=None, max_length=36)
    cuisines: list[str] = Field(default_factory=list, max_length=12)


def dish_words(request):
    """'Fried rice with egg' and 'Egg fried rice' are the same dish; 'tofu soup' and 'tofu stir-fry' are not."""
    text = re.sub(r'[^a-z0-9 ]+', ' ', (request.dishType or request.name).lower())
    return ' '.join(sorted({w for w in text.split() if w not in FILLER}))


def main_ingredients(request):
    return sorted(request.ingredients[:MAIN])


def image_key(request):
    if request.setting == 'campus':   # each published menu item at its station is its own dish
        basis = json.dumps(['campus', request.name.lower(), (request.place or '').lower()])
        return hashlib.sha256(basis.encode()).hexdigest()[:32]
    basis = json.dumps([dish_words(request), main_ingredients(request)])
    return hashlib.sha256(basis.encode()).hexdigest()[:32]


def request_from_meal(meal):
    """Same fields, order and limits as the browser's request (frontend/src/ui/format.js)."""
    heaviest = sorted(meal.get('ingredients') or [], key=lambda i: -(i.get('grams') or 0))[:6]
    return MealImageRequest(name=str(meal.get('name') or '')[:80] or 'Meal',
                            ingredients=[str(i.get('name')).strip().lower() for i in heaviest if str(i.get('name') or '').strip()],
                            cuisine=(meal.get('cuisines') or [None])[0], dishType=meal.get('dishType'))


def photo_prompt(request):
    if request.setting == 'campus':
        place = f' ({request.place})' if request.place else ''
        return (f'Realistic photo of one serving of {request.name}{place}, as served at a university dining hall or campus café, '
                'on a simple plate, bowl, tray or paper wrapper as appropriate, natural light. '
                'No text, signage, logos, hands, people or packaging branding.')
    style = f' ({request.cuisine} style)' if request.cuisine else ''
    made = f", made only with: {', '.join(request.ingredients)}" if request.ingredients else ''
    return (f'Realistic overhead food photograph of one home-cooked portion of {request.name}{style}{made}. '
            'Served on a simple plate or bowl on a plain table, natural light, appetizing but realistic home cooking. '
            'No text, labels, logos, hands, packaging, and no garnish or ingredient that is not listed.')


def to_jpeg(data):
    image = Image.open(io.BytesIO(data)).convert('RGB')
    if image.width > WIDTH:
        image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=82, optimize=True, progressive=True)
    return out.getvalue()


# Everyday student dishes, drawn ahead of time. Ingredient names are reviewed USDA keys, heaviest first.
COMMON_DISHES = [
    ('Egg Fried Rice', 'egg fried rice', ['cooked white rice', 'eggs', 'green onions'], 'Chinese'),
    ('Chicken Fried Rice', 'chicken fried rice', ['cooked white rice', 'chicken breast', 'eggs'], 'Chinese'),
    ('Kimchi Fried Rice', 'kimchi fried rice', ['cooked white rice', 'kimchi', 'eggs'], 'Korean'),
    ('Tofu and Broccoli Stir-Fry', 'tofu stir-fry', ['tofu', 'broccoli', 'soy sauce'], 'Chinese'),
    ('Chicken and Broccoli Stir-Fry', 'chicken stir-fry', ['chicken breast', 'broccoli', 'soy sauce'], 'Chinese'),
    ('Beef and Pepper Stir-Fry', 'beef stir-fry', ['ground beef', 'green bell pepper', 'onions'], 'Chinese'),
    ('Mapo-Style Tofu', 'mapo tofu', ['tofu', 'ground beef', 'green onions'], 'Chinese'),
    ('Teriyaki Chicken Rice Bowl', 'teriyaki chicken bowl', ['cooked white rice', 'chicken breast', 'teriyaki sauce'], 'Japanese'),
    ('Salmon Rice Bowl', 'salmon rice bowl', ['cooked white rice', 'salmon', 'cucumber'], 'Japanese'),
    ('Miso-Glazed Salmon', 'glazed salmon', ['salmon', 'soy sauce', 'green onions'], 'Japanese'),
    ('Bibimbap', 'bibimbap', ['cooked white rice', 'spinach', 'eggs'], 'Korean'),
    ('Spicy Tofu Kimchi Stew', 'kimchi stew', ['tofu', 'kimchi', 'green onions'], 'Korean'),
    ('Gochujang Chicken', 'gochujang chicken', ['chicken thigh', 'gochujang', 'green onions'], 'Korean'),
    ('Chickpea Curry', 'chickpea curry', ['chickpeas', 'canned tomatoes', 'onions'], 'Indian'),
    ('Chicken Curry with Rice', 'chicken curry', ['chicken thigh', 'cooked white rice', 'onions'], 'Indian'),
    ('Red Lentil Dal', 'lentil dal', ['lentils', 'canned tomatoes', 'onions'], 'Indian'),
    ('Spaghetti with Tomato Sauce', 'pasta tomato sauce', ['dry pasta', 'canned tomatoes', 'olive oil'], 'Italian'),
    ('Garlic Butter Pasta', 'garlic pasta', ['dry pasta', 'butter', 'garlic'], 'Italian'),
    ('Spinach Mushroom Pasta', 'spinach pasta', ['dry pasta', 'spinach', 'mushrooms'], 'Italian'),
    ('Margherita Toast', 'tomato cheese toast', ['white bread', 'mozzarella', 'tomatoes'], 'Italian'),
    ('Beef Tacos', 'beef tacos', ['ground beef', 'corn tortillas', 'tomatoes'], 'Mexican'),
    ('Black Bean Quesadilla', 'bean quesadilla', ['flour tortillas', 'black beans', 'cheddar cheese'], 'Mexican'),
    ('Chicken Burrito Bowl', 'chicken burrito bowl', ['cooked white rice', 'chicken breast', 'black beans'], 'Mexican'),
    ('Greek Chickpea Salad', 'chickpea salad', ['chickpeas', 'cucumber', 'tomatoes'], 'Mediterranean'),
    ('Hummus Veggie Plate', 'hummus plate', ['hummus', 'cucumber', 'carrots'], 'Mediterranean'),
    ('Shakshuka', 'shakshuka', ['canned tomatoes', 'eggs', 'onions'], 'Middle Eastern'),
    ('Thai Basil Chicken', 'basil chicken', ['chicken breast', 'cooked white rice', 'basil'], 'Thai'),
    ('Coconut Chickpea Curry', 'coconut curry', ['coconut milk', 'chickpeas', 'spinach'], 'Thai'),
    ('Pho-Style Noodle Soup', 'noodle soup', ['rice noodles', 'chicken broth', 'bean sprouts'], 'Vietnamese'),
    ('Spinach Cheese Omelet', 'omelet', ['eggs', 'spinach', 'cheddar cheese'], 'American'),
    ('Scrambled Eggs on Toast', 'scrambled eggs toast', ['eggs', 'whole-wheat bread', 'butter'], 'American'),
    ('Peanut Butter Banana Oatmeal', 'oatmeal', ['rolled oats', 'whole milk', 'bananas'], 'American'),
    ('Greek Yogurt Berry Bowl', 'yogurt bowl', ['greek yogurt', 'blueberries', 'strawberries'], 'American'),
    ('Turkey Cheddar Sandwich', 'turkey sandwich', ['white bread', 'ground turkey', 'cheddar cheese'], 'American'),
    ('Baked Sweet Potato with Black Beans', 'stuffed sweet potato', ['sweet potatoes', 'black beans', 'sour cream'], 'American'),
    ('Sheet Pan Chicken and Vegetables', 'sheet pan chicken', ['chicken breast', 'potatoes', 'broccoli'], 'American'),
    ('Chicken Rice Bowl', 'chicken rice bowl', ['cooked white rice', 'chicken breast', 'broccoli'], 'American'),
    ('Tuna Salad Sandwich', 'tuna sandwich', ['white bread', 'canned tuna', 'mayonnaise'], 'American'),
    ('Avocado Toast with Egg', 'avocado toast', ['whole-wheat bread', 'avocado', 'eggs'], 'American'),
    ('Vegetable Soup', 'vegetable soup', ['vegetable broth', 'carrots', 'potatoes'], 'American'),
]
COMMON = [MealImageRequest(name=n, dishType=d, ingredients=i, cuisine=c) for n, d, i, c in COMMON_DISHES]


class PhotoIndex:
    """Shared Backboard memory of verified photos: searchable by dish description, no personal data.
    A local copy next to the photos answers first, so a slow or failing Backboard never delays a photo."""
    NAME = 'whatscooking.ai dish photos'
    PAUSE = 300   # after a Backboard failure, skip it for five minutes

    def __init__(self, backboard, directory=IMAGE_DIR):
        self.backboard, self.ident, self.lock = backboard, None, asyncio.Lock()
        self.local_path, self.paused_until = Path(directory) / 'index.json', 0.0

    def _local(self):
        try:
            rows = json.loads(self.local_path.read_text())
            return rows if isinstance(rows, list) else []
        except (OSError, ValueError):
            return []

    def _match(self, rows, request, exists):
        for meta in rows:
            if not isinstance(meta, dict) or meta.get('type') != 'dish_photo' or not KEY.match(str(meta.get('key', ''))):
                continue
            same = MealImageRequest(name=meta.get('name') or 'x', dishType=meta.get('dishType'), ingredients=meta.get('mainIngredients') or [])
            if dish_words(same) == dish_words(request) and main_ingredients(same) == main_ingredients(request) and exists(meta['key']):
                return meta['key']
        return None

    def _healthy(self):
        return self.backboard is not None and time.monotonic() >= self.paused_until

    @staticmethod
    def describe(request):
        return (f"Photo of {request.dishType or request.name}: {request.name}; main ingredients "
                f"{', '.join(request.ingredients[:MAIN])}" + (f"; {request.cuisine}" if request.cuisine else ''))

    async def _assistant(self):
        if self.ident or self.backboard is None:
            return self.ident
        async with self.lock:
            if not self.ident:
                existing = await find_assistant(self.backboard, self.NAME, LEGACY_PHOTO_NAMES)
                if existing:
                    self.ident = existing
                else:
                    created = await asyncio.wait_for(self.backboard.create_assistant(
                        name=self.NAME, description='Index of verified whatscooking.ai meal photos'), timeout=10)
                    self.ident = str(created.assistant_id)
        return self.ident

    async def find(self, request, exists):
        """Key of an existing photo of the same dish, or None. Search proposes; the strict rule decides."""
        local = self._match(self._local(), request, exists)
        if local or not self._healthy():
            return local
        try:
            ident = await self._assistant()
            if not ident:
                return None
            found = await asyncio.wait_for(self.backboard.search_memories(ident, self.describe(request), limit=5), timeout=2)
            rows = found.get('memories', []) if isinstance(found, dict) else getattr(found, 'memories', []) or []
            return self._match([(r.get('metadata') if isinstance(r, dict) else getattr(r, 'metadata', None)) or {} for r in rows], request, exists)
        except Exception:
            self.paused_until = time.monotonic() + self.PAUSE
            return None

    async def add(self, request, key, checked):
        meta = {'type': 'dish_photo', 'key': key, 'name': request.name, 'dishType': request.dishType,
                'mainIngredients': request.ingredients[:MAIN], 'cuisine': request.cuisine, 'checked': checked,
                'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        try:
            self.local_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.local_path.with_suffix('.tmp')
            temp.write_text(json.dumps((self._local() + [meta])[-2000:]))
            temp.replace(self.local_path)
        except OSError:
            pass
        if not self._healthy():
            return
        try:
            ident = await self._assistant()
            if ident:
                await asyncio.wait_for(self.backboard.add_memory(ident, self.describe(request), metadata=meta), timeout=10)
        except Exception:
            self.paused_until = time.monotonic() + self.PAUSE

    async def popular_dishes(self):
        """How often each dish type has been drawn for anyone: a hint for warm-up order."""
        try:
            ident = await self._assistant()
            if not ident:
                return Counter()
            body = await asyncio.wait_for(self.backboard.get_memories(ident, page_size=100), timeout=5)
            body = body.model_dump() if hasattr(body, 'model_dump') else body
            return Counter(dish_words(MealImageRequest(name=m['metadata'].get('name') or 'x', dishType=m['metadata'].get('dishType')))
                           for m in body.get('memories', []) if (m.get('metadata') or {}).get('type') == 'dish_photo')
        except Exception:
            return Counter()


class MealImageService:
    def __init__(self, models=None, check_model=None, directory=IMAGE_DIR, daily_limit=None, warm_limit=None, today=None, index=None):
        # Lite draws in ~3 s vs ~10 s with comparable quality (compared side by side); full model is the fallback.
        self.models = list(dict.fromkeys(models or [os.getenv('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-lite-image'), 'gemini-3.1-flash-image']))
        self.check_model = check_model or os.getenv('GEMINI_IMAGE_CHECK_MODEL', 'gemini-3.1-flash-lite')
        self.dir = Path(directory)
        self.budgets = {'daily': daily_limit if daily_limit is not None else int(os.getenv('MEAL_IMAGE_DAILY_LIMIT', '200')),
                        'warmup': warm_limit if warm_limit is not None else int(os.getenv('MEAL_IMAGE_WARM_LIMIT', '40'))}
        self.today = today or (lambda: time.strftime('%Y-%m-%d', time.gmtime()))
        # A card someone is looking at never queues behind background pre-drawing.
        # A whole batch draws at once (up to 8 jobs), so every card's photo is ready about when the first one is.
        self.lanes = {'visible': asyncio.Semaphore(2), 'background': asyncio.Semaphore(8)}
        self.pending, self.used, self.index, self.reused = {}, {}, index, {}
        self.started, self.tasks = set(), set()   # jobs already drawing; fire-and-forget tasks kept alive
        self.failed = set()                       # keys whose last attempt produced no photo

    def path(self, key):
        return self.dir / f'{key}.jpg' if KEY.match(key or '') else None

    def _exists(self, key):
        path = self.path(key)
        return bool(path and path.exists())

    def _spend(self, budget):
        day, count = self.used.get(budget, (None, 0))
        count = count if day == self.today() else 0
        if count >= self.budgets[budget]:
            return False
        self.used[budget] = (self.today(), count + 1)
        return True

    def _refund(self, budget):
        day, count = self.used.get(budget, (None, 0))
        if day == self.today() and count > 0:
            self.used[budget] = (day, count - 1)

    def _start(self, client, request, key, lane, budget):
        if key not in self.pending:
            task = asyncio.create_task(self._create(client, request, key, lane, budget))
            self.pending[key] = task
            task.add_done_callback(lambda done: self._finished(key, done))
        return self.pending[key]

    def _finished(self, key, task):
        if self.pending.get(key) is task:
            self.pending.pop(key)
        if task.cancelled():
            return
        ok = task.exception() is None and task.result().get('status') in ('generated', 'reused')
        (self.failed.discard if ok else self.failed.add)(key)

    async def first_ready(self, keys, timeout=8):
        """Wait until any of these photos exists (or all attempts end), at most `timeout` seconds."""
        if any(self._exists(self.reused.get(k, k)) for k in keys):
            return True
        tasks = {self.pending[k] for k in keys if k in self.pending}
        end = asyncio.get_running_loop().time() + timeout
        while tasks:
            done, tasks = await asyncio.wait(tasks, timeout=max(0, end - asyncio.get_running_loop().time()), return_when=asyncio.FIRST_COMPLETED)
            if not done or any(self._exists(self.reused.get(k, k)) for k in keys):
                break
        return any(self._exists(self.reused.get(k, k)) for k in keys)

    def predraw(self, client, requests):
        """Start drawing in the background and return each request's photo key, for status polling."""
        self.warm(client, requests)
        return [image_key(r) for r in requests]

    def status(self, keys):
        """ready (with url) / drawing / failed / none (never requested), per key. No Gemini calls."""
        out = {}
        for key in keys:
            found = self.reused.get(key, key)
            if self._exists(found):
                out[key] = {'status': 'ready', 'url': f'/api/food/image/{found}.jpg'}
            elif key in self.pending:
                out[key] = {'status': 'drawing'}
            else:
                out[key] = {'status': 'failed' if key in self.failed else 'none'}
        return out

    def _keep(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def image(self, client, request):
        key = image_key(request)
        found = self.reused.get(key, key)
        if self._exists(found):
            return {'key': found, 'url': f'/api/food/image/{found}.jpg', 'status': 'cached'}
        if client is None:
            return {'status': 'missing_configuration'}
        queued = self.pending.get(key)
        if queued is not None and key not in self.started and self.lanes['background'].locked():
            queued.cancel()   # still waiting for a background slot: move it to the visible lane
            self.pending.pop(key, None)
        result = await asyncio.shield(self._start(client, request, key, 'visible', 'daily'))
        if result['status'] in ('generated', 'reused'):
            return {**result, 'url': f"/api/food/image/{result['key']}.jpg"}
        return result

    def warm(self, client, requests, budget='daily'):
        """Start drawing in the background; a card that asks later joins the same job. Returns how many started."""
        if client is None:
            return 0
        started = 0
        for request in requests:
            key = image_key(request)
            if key in self.pending or self._exists(self.reused.get(key, key)):
                continue
            self._start(client, request, key, 'background', budget)
            started += 1
        return started

    def warm_common(self, client, learned=None, cuisines=(), popular=None, limit=12):
        """Common dishes this user is most likely to see, ordered by Backboard-learned likes and shared popularity."""
        learned, popular = learned or {}, popular or Counter()
        liked_cuisines = {c.lower() for c in [*cuisines, *learned.get('likedCuisines', [])]}
        liked_ingredients = {i.lower() for i in learned.get('likedIngredients', [])}
        recent = ' '.join(learned.get('recentMeals', [])).lower()
        def score(request):
            return (3 * ((request.cuisine or '').lower() in liked_cuisines)
                    + len(liked_ingredients & set(request.ingredients))
                    + 2 * any(w in recent for w in dish_words(request).split())
                    + min(popular.get(dish_words(request), 0), 5) / 5)
        todo = [r for r in sorted(COMMON, key=score, reverse=True) if not self._exists(image_key(r))][:limit]
        return self.warm(client, todo, budget='warmup')

    async def _create(self, client, request, key, lane, budget):
        if self.index is not None and request.setting == 'home':
            match = await self.index.find(request, self._exists)
            if match:
                self.reused[key] = match
                return {'status': 'reused', 'key': match}
        async with self.lanes[lane]:
            self.started.add(key)
            try:
                return await self._draw_checked(client, request, key, budget)
            finally:
                self.started.discard(key)

    async def _draw_checked(self, client, request, key, budget):
        for attempt in range(2):   # one retry if the check says the picture is not this dish
            if not self._spend(budget):
                return {'status': 'limit'}
            # The retry goes to the stronger model first: it is the more accurate one.
            drawn = await self._draw(client, request, self.models if attempt == 0 else self.models[::-1])
            if drawn is None:
                self._refund(budget)   # nothing was generated (e.g. quota or credits), so it costs nothing
                return {'status': 'failed'}
            data, mime = drawn
            verdict = await self._check(client, data, mime, request)
            if verdict is not False:
                self.dir.mkdir(parents=True, exist_ok=True)
                temp = self.dir / f'{key}.tmp'
                temp.write_bytes(to_jpeg(data))
                temp.replace(self.path(key))
                if self.index is not None and request.setting == 'home':
                    self._keep(self.index.add(request, key, verdict is True))
                return {'status': 'generated', 'key': key, 'checked': verdict is True}
        return {'status': 'failed'}

    async def _draw(self, client, request, models=None):
        config = types.GenerateContentConfig(image_config=types.ImageConfig(aspect_ratio='16:9'))
        for model in models or self.models:
            try:
                response = await asyncio.wait_for(client.aio.models.generate_content(
                    model=model, contents=photo_prompt(request), config=config), timeout=TIMEOUT)
                for part in response.candidates[0].content.parts:
                    if getattr(part, 'inline_data', None) and part.inline_data.mime_type.startswith('image/'):
                        return part.inline_data.data, part.inline_data.mime_type
            except Exception:
                continue   # next model; provider messages and keys are never returned
        return None

    async def _check(self, client, data, mime, request):
        """True/False from a quick vision check; None when the checker itself is unavailable."""
        question = (f'Does this photo plausibly show {request.name}' + (f' ({request.place})' if request.place else '')
                    + (f" made with {', '.join(request.ingredients)}" if request.ingredients else '')
                    + ', with no visible text or packaging? Answer as JSON {"matches": true|false}.')
        try:
            response = await asyncio.wait_for(client.aio.models.generate_content(
                model=self.check_model, contents=[types.Part.from_bytes(data=data, mime_type=mime), question],
                config={'response_mime_type': 'application/json'}), timeout=15)
            verdict = json.loads(response.text or '{}').get('matches')
            return verdict if isinstance(verdict, bool) else None
        except Exception:
            return None
