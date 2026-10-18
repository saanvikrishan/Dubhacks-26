import asyncio
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from meal_images import MealImageRequest, MealImageService, PhotoIndex, image_key, photo_prompt, request_from_meal, COMMON


def png_bytes(width=1600, height=900):
    out = io.BytesIO()
    Image.new('RGB', (width, height), (200, 120, 60)).save(out, 'PNG')
    return out.getvalue()


class FakeGemini:
    """Image models return a picture; the check model returns the next queued verdict."""
    def __init__(self, verdicts=(True,), image_error=None, check_error=None):
        self.verdicts, self.image_error, self.check_error = list(verdicts), image_error, check_error
        self.draws, self.checks, self.prompts = 0, 0, []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate))

    async def generate(self, model, contents, config=None):
        await asyncio.sleep(0)
        if 'image' in model:
            self.draws += 1
            self.prompts.append(contents)
            if self.image_error:
                raise self.image_error
            part = SimpleNamespace(inline_data=SimpleNamespace(data=png_bytes(), mime_type='image/png'))
            return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])
        self.checks += 1
        if self.check_error:
            raise self.check_error
        return SimpleNamespace(text=json.dumps({'matches': self.verdicts.pop(0) if self.verdicts else True}))


REQUEST = MealImageRequest(name='Kimchi Fried Rice', ingredients=['White Rice', 'kimchi', 'tofu'], cuisine='Korean')


class MealImageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.service = MealImageService(models=['test-image'], check_model='test-check', directory=self.dir.name, daily_limit=5)

    def tearDown(self):
        self.dir.cleanup()

    async def test_generates_once_resizes_and_then_serves_from_cache(self):
        client = FakeGemini()
        first = await self.service.image(client, REQUEST)
        self.assertEqual(first['status'], 'generated'); self.assertTrue(first['checked'])
        self.assertEqual(first['url'], f"/api/food/image/{image_key(REQUEST)}.jpg")
        saved = Image.open(self.service.path(image_key(REQUEST)))
        self.assertEqual((saved.format, saved.width), ('JPEG', 768))
        again = await self.service.image(client, REQUEST)
        self.assertEqual(again['status'], 'cached'); self.assertEqual(client.draws, 1)

    async def test_identical_concurrent_requests_share_one_generation(self):
        client = FakeGemini()
        results = await asyncio.gather(*(self.service.image(client, REQUEST) for _ in range(3)))
        self.assertEqual(client.draws, 1)
        self.assertTrue(all(r['status'] == 'generated' for r in results))

    async def test_prompt_is_built_from_the_recipe(self):
        client = FakeGemini()
        await self.service.image(client, REQUEST)
        self.assertIn('Kimchi Fried Rice', client.prompts[0]); self.assertIn('white rice, kimchi, tofu', client.prompts[0])
        self.assertIn('Korean', photo_prompt(REQUEST)); self.assertIn('No text', photo_prompt(REQUEST))

    async def test_a_wrong_picture_is_retried_once_then_never_shown(self):
        client = FakeGemini(verdicts=[False, True])
        self.assertEqual((await self.service.image(client, REQUEST))['status'], 'generated'); self.assertEqual(client.draws, 2)
        other = MealImageRequest(name='Bibimbap', ingredients=['rice'])
        client = FakeGemini(verdicts=[False, False])
        self.assertEqual((await self.service.image(client, other))['status'], 'failed')
        self.assertFalse(self.service.path(image_key(other)).exists())

    async def test_unavailable_checker_keeps_the_image_but_reports_it_unchecked(self):
        result = await self.service.image(FakeGemini(check_error=RuntimeError('quota')), REQUEST)
        self.assertEqual(result['status'], 'generated'); self.assertFalse(result['checked'])

    async def test_daily_cap_missing_key_and_provider_errors(self):
        capped = MealImageService(models=['test-image'], check_model='c', directory=self.dir.name, daily_limit=0)
        self.assertEqual((await capped.image(FakeGemini(), REQUEST))['status'], 'limit')
        self.assertEqual((await self.service.image(None, REQUEST))['status'], 'missing_configuration')
        failed = await self.service.image(FakeGemini(image_error=RuntimeError('secret-key-123')), REQUEST)
        self.assertEqual(failed, {'status': 'failed'})
        self.assertEqual(self.service.used.get('daily', (None, 0))[1], 0)   # failed draws are refunded

    async def test_campus_items_get_their_own_prompt_and_skip_the_recipe_index(self):
        cheese = MealImageRequest(name='Cheese', setting='campus', place='Dawg House Pizza, Slice')
        self.assertIn('university dining hall', photo_prompt(cheese)); self.assertIn('Dawg House Pizza', photo_prompt(cheese))
        self.assertNotEqual(image_key(cheese), image_key(MealImageRequest(name='Cheese', setting='campus', place='Other Grill')))
        self.assertNotEqual(image_key(cheese), image_key(MealImageRequest(name='Cheese')))
        client = FakeGemini()
        self.assertEqual((await self.service.image(client, cheese))['status'], 'generated')
        self.assertIn('Dawg House Pizza', client.prompts[0])

    def test_paths_only_accept_generated_keys(self):
        self.assertIsNone(self.service.path('../main'))
        self.assertIsNone(self.service.path('abc'))
        self.assertIsNotNone(self.service.path(image_key(REQUEST)))
        self.assertEqual(image_key(REQUEST), image_key(MealImageRequest(name='kimchi fried rice', ingredients=['tofu', 'kimchi', 'white rice'])))


class SlowGemini(FakeGemini):
    """Draws wait until released, so lane behaviour can be observed."""
    def __init__(self):
        super().__init__()
        self.release = asyncio.Event()
    async def generate(self, model, contents, config=None):
        if 'image' in model:
            await self.release.wait()
        return await super().generate(model, contents, config)


class FakeBackboard:
    def __init__(self):
        self.memories, self.assistants = [], {}
    async def list_assistants(self, name=None, limit=None):
        return [SimpleNamespace(name=n, assistant_id=i) for n, i in self.assistants.items() if n == name]
    async def create_assistant(self, name, description=None):
        self.assistants[name] = 'photos'; return SimpleNamespace(assistant_id='photos')
    async def add_memory(self, ident, content, metadata=None):
        self.memories.append({'content': content, 'metadata': metadata}); return {}
    async def search_memories(self, ident, query, limit=5):
        return {'memories': list(self.memories)[:limit]}
    async def get_memories(self, ident, page_size=None):
        return {'memories': list(self.memories)}


def dish(name, dish_type, ingredients):
    return MealImageRequest(name=name, dishType=dish_type, ingredients=ingredients)


class FasterPhotoTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
    def tearDown(self):
        self.dir.cleanup()
    def service(self, **kw):
        return MealImageService(models=['test-image'], check_model='c', directory=self.dir.name, daily_limit=20, **kw)

    def test_same_dish_shares_a_key_and_different_dishes_do_not(self):
        a = dish('Quick Egg and Scallion Fried Rice', 'egg fried rice', ['white rice', 'eggs', 'green onions', 'soy sauce'])
        b = dish('Classic Fried Rice with Egg', 'fried rice with egg', ['eggs', 'white rice', 'green onions', 'sesame oil'])
        self.assertEqual(image_key(a), image_key(b))
        self.assertNotEqual(image_key(a), image_key(dish('x', 'egg fried rice', ['white rice', 'eggs', 'kimchi'])))
        self.assertNotEqual(image_key(dish('x', 'tofu soup', ['tofu', 'broccoli', 'soy sauce'])),
                            image_key(dish('x', 'tofu stir-fry', ['tofu', 'broccoli', 'soy sauce'])))
        meal = {'name': 'Fried Rice', 'dishType': 'egg fried rice', 'cuisines': ['Chinese'],
                'ingredients': [{'name': 'Eggs', 'grams': 100}, {'name': 'white rice', 'grams': 150}, {'name': 'green onions', 'grams': 10}]}
        self.assertEqual(request_from_meal(meal).ingredients, ['white rice', 'eggs', 'green onions'])

    async def test_pre_drawn_photo_is_joined_not_drawn_twice(self):
        service, client = self.service(), FakeGemini()
        self.assertEqual(service.warm(client, [REQUEST]), 1)
        result = await service.image(client, REQUEST)
        self.assertEqual(result['status'], 'generated'); self.assertEqual(client.draws, 1)
        self.assertEqual(service.warm(client, [REQUEST]), 0)

    async def test_visible_card_never_waits_behind_background_work(self):
        service, slow = self.service(), SlowGemini()
        service.warm(slow, [dish(f'Dish {i}', f'dish {i}', [f'item {i}']) for i in range(10)])
        await asyncio.sleep(0.05)   # 8 background jobs drawing (blocked), 2 queued
        visible = asyncio.create_task(service.image(FakeGemini(), REQUEST))
        result = await asyncio.wait_for(visible, timeout=2)
        self.assertEqual(result['status'], 'generated')
        queued = dish('Dish 9', 'dish 9', ['item 9'])   # still waiting for a background slot
        promoted = await asyncio.wait_for(service.image(FakeGemini(), queued), timeout=2)
        self.assertEqual(promoted['status'], 'generated')
        slow.release.set()

    async def test_backboard_index_reuses_only_the_same_dish(self):
        backboard = FakeBackboard()
        index = PhotoIndex(backboard)
        service, client = self.service(index=index), FakeGemini()
        first = dish('Egg Fried Rice', 'egg fried rice', ['white rice', 'eggs', 'green onions'])
        await service.image(client, first)
        await asyncio.sleep(0.05)   # index write runs in the background
        self.assertEqual(backboard.memories[0]['metadata']['type'], 'dish_photo')
        self.assertNotIn('user', json.dumps(backboard.memories[0]['metadata']))
        # Different words for the same dish: found through the index (simulates a key computed elsewhere).
        service.reused.clear()
        same = dish('Fried rice with egg and scallions', 'fried rice with egg', ['eggs', 'white rice', 'green onions'])
        self.assertEqual(await index.find(same, service._exists), image_key(first))
        other = dish('Tofu Stir-Fry', 'tofu stir-fry', ['white rice', 'eggs', 'green onions'])
        self.assertIsNone(await index.find(other, service._exists))
        self.assertEqual(client.draws, 1)

    async def test_warm_up_follows_learned_likes_and_has_its_own_budget(self):
        service = MealImageService(models=['test-image'], check_model='c', directory=self.dir.name, daily_limit=1, warm_limit=3)
        client = FakeGemini()
        started = service.warm_common(client, learned={'likedCuisines': ['Korean']}, limit=3)
        self.assertEqual(started, 3)
        names = [r.name for r in COMMON if image_key(r) in service.pending]
        self.assertTrue(all(next(c for c in COMMON if c.name == n).cuisine == 'Korean' for n in names))
        await asyncio.gather(*service.pending.values())
        self.assertEqual(client.draws, 3)
        self.assertEqual((await service.image(client, REQUEST))['status'], 'generated')   # daily budget untouched


class MealImageRouteTests(unittest.TestCase):
    def test_create_then_serve_and_reject_bad_names(self):
        import main
        with tempfile.TemporaryDirectory() as folder:
            service = MealImageService(models=['test-image'], check_model='c', directory=folder, daily_limit=5)
            with patch.object(main, 'meal_images', service), patch.object(main, 'client', FakeGemini()):
                app = TestClient(main.app)
                created = app.post('/food/image', json={'name': 'Tofu Stir Fry', 'ingredients': ['tofu', 'broccoli']}).json()
                self.assertEqual(created['status'], 'generated')
                served = app.get(created['url'].removeprefix('/api'))
                self.assertEqual(served.status_code, 200); self.assertEqual(served.headers['content-type'], 'image/jpeg')
                self.assertIn('immutable', served.headers['cache-control'])
                self.assertEqual(app.get('/food/image/..%2Fmain.py').status_code, 404)
                self.assertEqual(app.get('/food/image/' + '0' * 32 + '.png').status_code, 404)
                self.assertEqual(app.post('/food/image', json={'name': '', 'ingredients': []}).status_code, 422)


class PreDrawRouteTests(unittest.TestCase):
    def test_recipes_route_starts_every_photo_before_responding(self):
        import main
        from unittest.mock import AsyncMock, MagicMock
        meals = [{'name': f'Dish {i}', 'dishType': f'dish {i}', 'cuisines': [], 'ingredients': [{'name': 'tofu', 'grams': 100}]} for i in range(8)]
        warm = MagicMock(return_value=8)
        with patch.object(main.recipe_generator, 'generate', new=AsyncMock(return_value={'meals': meals})), \
             patch.object(main.meal_images, 'warm', warm), patch.object(main, 'client', object()):
            response = TestClient(main.app).post('/recipes', json={'ingredients': ['tofu'], 'equipment': []})
        self.assertEqual(response.status_code, 200)
        requests = warm.call_args.args[1]
        self.assertEqual([r.name for r in requests], [m['name'] for m in meals])


if __name__ == '__main__':
    unittest.main()
