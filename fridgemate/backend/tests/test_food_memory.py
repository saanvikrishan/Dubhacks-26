import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import food_memory
from food_memory import MealFeedback, learned_preferences, record_feedback, summarize_feedback
from meal_generation import RecipeGenerator, RecipeRequest, distinct, normalize_draft, personalization, RecipeDraft

A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'


class FakeBackboard:
    """One memory list per assistant, like Backboard."""
    def __init__(self):
        self.assistants, self.memories = {}, {}
        self.add_memory = AsyncMock(side_effect=self._add)

    async def list_assistants(self, name=None, limit=None):
        return [SimpleNamespace(name=n, assistant_id=i) for n, i in self.assistants.items() if n == name]

    async def create_assistant(self, name, description=None):
        ident = f'assistant-{len(self.assistants)}'
        self.assistants[name], self.memories[ident] = ident, []
        return SimpleNamespace(assistant_id=ident)

    async def _add(self, ident, content, metadata=None):
        self.memories[ident].append({'id': str(len(self.memories[ident])), 'content': content, 'metadata': metadata})
        return {'id': 'memory'}

    async def get_memories(self, ident, page_size=None):
        return {'memories': list(self.memories.get(ident, []))}


def event(user, kind, name, n, cuisines=('Korean',), tastes=('Spicy',), ingredients=('tofu',)):
    return MealFeedback(user=user, kind=kind, eventId=f'{kind}:{name}:{n}', mealId=name.lower().replace(' ', '-'),
                        name=name, cuisines=list(cuisines), tastes=list(tastes), mainIngredients=list(ingredients), at=f'2026-10-18T0{n}:00')


def memories(*specs):
    return {'memories': [{'id': str(i), 'metadata': {'type': 'meal_feedback', 'kind': kind, 'eventId': str(i), 'name': name,
                                                     'cuisines': cuisines, 'tastes': [], 'mainIngredients': [], 'at': str(i)}}
                         for i, (kind, name, cuisines) in enumerate(specs)]}


class LearnedRuleTests(unittest.TestCase):
    def test_one_or_two_skips_are_not_a_dislike(self):
        learned = summarize_feedback(memories(('skipped', 'Green salad', ['Mediterranean']), ('skipped', 'Green salad', ['Mediterranean'])))
        self.assertEqual(learned['avoidCuisines'], [])
        self.assertEqual(learned['repeatedlySkipped'], ['Green salad'])

    def test_three_skips_without_likes_avoid_a_cuisine_but_a_log_wins(self):
        skips = [('skipped', f'Salad {i}', ['Mediterranean']) for i in range(3)]
        self.assertEqual(summarize_feedback(memories(*skips))['avoidCuisines'], ['Mediterranean'])
        mixed = summarize_feedback(memories(*skips, ('logged', 'Greek bowl', ['Mediterranean'])))
        self.assertEqual(mixed['avoidCuisines'], [])

    def test_likes_need_repeated_or_logged_evidence(self):
        self.assertEqual(summarize_feedback(memories(('chose', 'Bibimbap', ['Korean'])))['likedCuisines'], [])
        learned = summarize_feedback(memories(('chose', 'Bibimbap', ['Korean']), ('chose', 'Kimchi stew', ['Korean'])))
        self.assertEqual(learned['likedCuisines'], ['Korean'])
        self.assertEqual(set(learned['recentMeals']), {'Bibimbap', 'Kimchi stew'})

    def test_other_memory_types_and_duplicate_events_are_ignored(self):
        body = memories(('logged', 'Bibimbap', ['Korean']))
        body['memories'] += [dict(body['memories'][0]), {'id': 'x', 'metadata': {'type': 'food_preferences'}}]
        self.assertEqual(summarize_feedback(body)['events'], 1)


class FeedbackStoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        food_memory._assistants.clear(); food_memory._learned.clear(); food_memory._sent.clear(); food_memory._locks.clear()

    async def test_users_are_isolated_by_their_own_assistant(self):
        client = FakeBackboard()
        for n in range(2):
            self.assertEqual((await record_feedback(client, event(A, 'logged', f'Kimchi tofu {n}', n)))['status'], 'saved')
        a, b = await learned_preferences(client, A), await learned_preferences(client, B)
        self.assertEqual(a['likedCuisines'], ['Korean'])
        self.assertEqual(b['status'], 'no_history'); self.assertEqual(b['events'], 0)
        self.assertEqual(len(client.assistants), 1)

    async def test_duplicate_event_ids_are_stored_once_and_new_feedback_refreshes_cache(self):
        client = FakeBackboard()
        await record_feedback(client, event(A, 'chose', 'Bulgogi', 1))
        self.assertEqual((await record_feedback(client, event(A, 'chose', 'Bulgogi', 1)))['status'], 'duplicate')
        self.assertEqual(client.add_memory.await_count, 1)
        self.assertEqual((await learned_preferences(client, A))['likedCuisines'], [])
        await record_feedback(client, event(A, 'chose', 'Japchae', 2))
        self.assertEqual((await learned_preferences(client, A))['likedCuisines'], ['Korean'])

    async def test_missing_or_failing_backboard_never_raises(self):
        self.assertEqual((await learned_preferences(None, A))['status'], 'missing_configuration')
        broken = SimpleNamespace(list_assistants=AsyncMock(side_effect=RuntimeError('secret-key')))
        result = await learned_preferences(broken, A)
        self.assertEqual(result['status'], 'unavailable'); self.assertNotIn('secret', json.dumps(result))
        self.assertEqual((await record_feedback(broken, event(A, 'chose', 'Bulgogi', 1)))['status'], 'unavailable')
        self.assertEqual((await learned_preferences(FakeBackboard(), 'not-a-uuid'))['status'], 'missing_user')


DRAFT = {"name": "Kimchi tofu stew", "description": "Spicy stew.", "prep": 5, "cook": 10,
         "ingredients": [{"name": "tofu", "grams": 150}, {"name": "kimchi", "grams": 80}],
         "equipment": [], "steps": ["Simmer."], "photo": "tofu", "cuisine": "Korean", "tastes": ["Spicy"]}


def fake_gemini(drafts):
    call = AsyncMock(return_value=SimpleNamespace(text=json.dumps({'recipes': drafts})))
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=call))), call


class PersonalizedGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_prompt_carries_explicit_then_learned_preferences(self):
        client, call = fake_gemini([DRAFT])
        request = RecipeRequest(cuisines=['Korean'], tastes=['Spicy'], avoidCuisines=['Thai'], userId=A)
        learned = {'likedCuisines': ['Korean'], 'recentMeals': ['Bibimbap'], 'repeatedlySkipped': ['Green salad']}
        result = await RecipeGenerator(models=['test']).generate(client, request, learned)
        prompt = call.call_args.kwargs['contents']
        context = json.loads(prompt.split('\nPreferences: ', 1)[1])
        self.assertEqual(context['explicit']['cuisines'], ['korean'])
        self.assertEqual(context['explicit']['avoidCuisines'], ['thai'])
        self.assertEqual(context['learnedFromHistory']['recentMeals'], ['Bibimbap'])
        self.assertIn('explicit preferences outrank learnedFromHistory', prompt)
        self.assertEqual(context['focusCuisines'], ['Korean'])
        self.assertEqual(personalization(RecipeRequest(cuisines=['Thai']), {'likedCuisines': ['Korean', 'Thai'], 'avoidCuisines': ['Korean']})['focusCuisines'], ['Thai'])
        self.assertNotIn(A, prompt)
        self.assertEqual(result['meals'][0]['cuisines'], ['Korean']); self.assertEqual(result['meals'][0]['tastes'], ['Spicy'])

    async def test_new_feedback_changes_the_cache_key(self):
        client, call = fake_gemini([DRAFT])
        g, request = RecipeGenerator(models=['test']), RecipeRequest(userId=A)
        await g.generate(client, request, {'likedCuisines': []})
        await g.generate(client, request, {'likedCuisines': []})
        self.assertEqual(call.await_count, 1)
        await g.generate(client, request, {'likedCuisines': ['Korean']})
        self.assertEqual(call.await_count, 2)

    async def test_drafts_with_a_known_excluded_allergen_are_dropped(self):
        soy_free = {**DRAFT, 'name': 'Chicken rice', 'ingredients': [{'name': 'chicken', 'grams': 120}, {'name': 'rice', 'grams': 150}]}
        sauced = {**soy_free, 'name': 'Soy glazed chicken', 'ingredients': [*soy_free['ingredients'], {'name': 'soy sauce', 'grams': 15}]}
        client, _ = fake_gemini([DRAFT, sauced, soy_free])
        result = await RecipeGenerator(models=['test']).generate(client, RecipeRequest(exclusions=['soy']))
        self.assertEqual([m['name'] for m in result['meals']], ['Chicken rice'])
        client, _ = fake_gemini([sauced])
        self.assertEqual((await RecipeGenerator(models=['test']).generate(client, RecipeRequest(exclusions=['wheat'])))['meals'], [])
        eggplant = {**soy_free, 'name': 'Roast eggplant', 'ingredients': [{'name': 'eggplant', 'grams': 200}]}
        omelet = {**soy_free, 'name': 'Omelet', 'cuisine': 'American', 'ingredients': [{'name': 'eggs', 'grams': 100}]}
        client, _ = fake_gemini([eggplant, omelet])
        self.assertEqual([m['name'] for m in (await RecipeGenerator(models=['test']).generate(client, RecipeRequest(exclusions=['egg'])))['meals']], ['Roast eggplant'])

    async def test_concurrent_first_events_create_one_assistant(self):
        import asyncio
        food_memory._assistants.clear(); food_memory._learned.clear(); food_memory._sent.clear(); food_memory._locks.clear()
        client = FakeBackboard()
        await asyncio.gather(*(record_feedback(client, event(A, 'chose', f'Meal {n}', n)) for n in range(3)))
        self.assertEqual(len(client.assistants), 1)
        self.assertEqual(sum(len(m) for m in client.memories.values()), 3)

    def test_near_duplicates_are_dropped_and_missing_labels_default_to_other(self):
        twin = normalize_draft(RecipeDraft(**{**DRAFT, 'name': 'Spicy kimchi tofu', 'cook': 12}))
        other = normalize_draft(RecipeDraft(**{**DRAFT, 'cuisine': 'Japanese', 'name': 'Miso tofu'}))
        self.assertEqual(len(distinct([normalize_draft(RecipeDraft(**DRAFT)), twin, other])), 2)
        bare = {k: v for k, v in DRAFT.items() if k not in ('cuisine', 'tastes')}
        self.assertEqual(normalize_draft(RecipeDraft(**bare))['cuisines'], [])


class RouteTests(unittest.TestCase):
    def setUp(self):
        food_memory._assistants.clear(); food_memory._learned.clear(); food_memory._sent.clear()

    def test_feedback_reaches_the_next_generation_request(self):
        import main
        backboard, (gemini, call) = FakeBackboard(), fake_gemini([DRAFT])
        with patch.object(main, 'backboard_client', backboard), patch.object(main, 'client', gemini), \
             patch.object(main, 'recipe_generator', RecipeGenerator(models=['test'])):
            app = TestClient(main.app)
            for n in range(2):
                payload = event(A, 'logged', f'Kimchi tofu {n}', n).model_dump()
                self.assertEqual(app.post('/food/feedback', json=payload).json()['status'], 'saved')
            recalled = app.get('/food/preferences', params={'user': A}).json()
            self.assertEqual(recalled['learned']['likedCuisines'], ['Korean'])
            self.assertEqual(app.get('/food/preferences', params={'user': B}).json()['learned']['events'], 0)
            response = app.post('/recipes', json={'ingredients': ['tofu'], 'equipment': [], 'userId': A})
            self.assertEqual(response.status_code, 200)
            context = json.loads(call.call_args.kwargs['contents'].split('\nPreferences: ', 1)[1])
            self.assertEqual(context['learnedFromHistory']['likedCuisines'], ['Korean'])
            self.assertEqual(app.post('/food/feedback', json={**payload, 'user': 'not-a-uuid', 'eventId': 'new'}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
