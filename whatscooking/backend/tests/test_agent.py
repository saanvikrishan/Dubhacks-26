import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai import types
import agent
import food_memory

USER_A = '11111111-1111-4111-8111-111111111111'
USER_B = '22222222-2222-4222-8222-222222222222'


def calls(*items):
    parts = [SimpleNamespace(function_call=SimpleNamespace(name=n, args=a), text=None, thought=False) for n, a in items]
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(role='model', parts=parts))])


def text(t):
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(role='model', parts=[SimpleNamespace(text=t, function_call=None, thought=False)]))])


class ScriptedGemini:
    """Returns the queued responses in order and records what it was sent."""
    def __init__(self, *responses, error=None):
        self.responses, self.error, self.sent = list(responses), error, []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate))

    async def generate(self, model, contents, config):
        self.sent.append(list(contents))   # a copy: the agent keeps appending to its list
        if self.error:
            raise self.error
        return self.responses.pop(0) if self.responses else text('Done.')


class MemoryBackboard:
    def __init__(self):
        self.assistants, self.memories = {}, {}
    async def list_assistants(self, name=None, limit=None):
        return [SimpleNamespace(name=n, assistant_id=i) for n, i in self.assistants.items() if n == name]
    async def create_assistant(self, name, description=None):
        ident = f'a{len(self.assistants)}'; self.assistants[name] = ident; self.memories[ident] = []
        return SimpleNamespace(assistant_id=ident)
    async def add_memory(self, ident, content, metadata=None):
        self.memories[ident].append({'content': content, 'metadata': metadata}); return {}
    async def search_memories(self, ident, query, limit=5):
        return {'memories': self.memories.get(ident, [])[:limit]}
    async def get_memories(self, ident, page_size=None):
        return {'memories': self.memories.get(ident, [])}


def request(message, **kw):
    return agent.AgentRequest(message=message, snapshot={'profile': {'diet': 'anything'}}, now='2026-10-18T12:00 Sunday', **kw)


class AgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        food_memory._assistants.clear(); food_memory._learned.clear(); food_memory._sent.clear(); food_memory._locks.clear()

    async def test_one_message_can_make_several_changes_in_order(self):
        gemini = ScriptedGemini(calls(
            ('update_preferences', {'diet': 'vegan'}),
            ('update_grocery_list', {'add': [{'name': 'tofu'}, {'name': 'spinach'}]}),
            ('add_event', {'title': 'Lab', 'date': '2026-10-18', 'start': '19:00', 'end': '21:00', 'kind': 'class'}),
        ), text("You're vegan now, tofu and spinach are on your list, and your 7pm lab is on the calendar."))
        result = await agent.run(gemini, None, request("I'm vegan now, add tofu and spinach, and add my 7pm lab"), types)
        self.assertEqual([a['tool'] for a in result['actions']], ['update_preferences', 'update_grocery_list', 'add_event'])
        self.assertEqual(result['actions'][0]['args'], {'diet': 'vegan', 'allergies_add': [], 'allergies_remove': [], 'cuisines_add': [],
            'cuisines_remove': [], 'avoid_cuisines_add': [], 'avoid_cuisines_remove': [], 'tastes_add': [], 'tastes_remove': [],
            'dislikes_add': [], 'dislikes_remove': [], 'equipment_add': [], 'equipment_remove': []})
        self.assertIn('vegan', result['reply'])
        prompt = gemini.sent[0][-1].parts[0].text
        self.assertIn('snapshot JSON', prompt); self.assertIn('User request:', prompt)

    async def test_invalid_arguments_are_refused_and_reported_to_the_model(self):
        gemini = ScriptedGemini(calls(('add_event', {'title': 'Lab', 'date': '2026-10-20', 'start': '19:00', 'end': '18:00'}),
                                      ('delete_everything', {})), text('Which time should the lab end?'))
        result = await agent.run(gemini, None, request('add lab'), types)
        self.assertEqual(result['actions'], [])
        self.assertEqual([r['tool'] for r in result['rejected']], ['add_event', 'delete_everything'])
        answers = gemini.sent[1][-1].parts
        self.assertTrue(all(p.function_response.response['status'] == 'rejected' for p in answers))

    async def test_conversation_sent_to_gemini_starts_with_the_user(self):
        gemini = ScriptedGemini(text('Sure.'))
        history = [agent.Turn(role='assistant', text='Hi! How can I help?'), agent.Turn(role='user', text='add tofu'),
                   agent.Turn(role='assistant', text='Added tofu. [Changed: Grocery list: added tofu]')]
        await agent.run(gemini, None, request('thanks', history=history), types)
        self.assertEqual([c.role for c in gemini.sent[0]], ['user', 'model', 'user'])

    async def test_stops_after_a_bounded_number_of_rounds(self):
        gemini = ScriptedGemini(*[calls(('go_to', {'screen': 'today'})) for _ in range(10)])
        result = await agent.run(gemini, None, request('loop'), types)
        self.assertEqual(len(gemini.sent), agent.MAX_ROUNDS)
        self.assertEqual(len(result['actions']), agent.MAX_ROUNDS)

    async def test_remember_is_private_to_the_user_and_recalled_later(self):
        backboard = MemoryBackboard()
        gemini = ScriptedGemini(calls(('update_preferences', {'dislikes_add': ['cilantro']}), ('remember', {'fact': 'Hates cilantro'})), text('Noted.'))
        result = await agent.run(gemini, backboard, request('remember I hate cilantro', user=USER_A), types)
        self.assertTrue(result['actions'][1]['args']['saved'])
        self.assertIn('Remembered: Hates cilantro', await agent.recall(backboard, USER_A, 'dinner ideas'))
        self.assertEqual(await agent.recall(backboard, USER_B, 'dinner ideas'), [])
        second = ScriptedGemini(text('Sure.'))
        await agent.run(second, backboard, request('dinner?', user=USER_A), types)
        self.assertIn('Hates cilantro', second.sent[0][-1].parts[0].text)

    async def test_works_without_backboard_and_errors_never_leak(self):
        broken = SimpleNamespace(list_assistants=lambda **k: (_ for _ in ()).throw(RuntimeError('secret')))
        self.assertEqual(await agent.recall(broken, USER_A, 'x'), [])
        result = await agent.run(ScriptedGemini(text('Hi!')), broken, request('hi', user=USER_A), types)
        self.assertEqual(result['reply'], 'Hi!')
        credits = type('E', (Exception,), {'code': 402})('private-key-123')
        with self.assertRaises(HTTPException) as caught:
            await agent.run(ScriptedGemini(error=credits), None, request('hi'), types)
        self.assertIn('no credits', caught.exception.detail); self.assertNotIn('private', caught.exception.detail)
        with self.assertRaises(HTTPException) as caught:
            await agent.run(None, None, request('hi'), types)
        self.assertEqual(caught.exception.status_code, 503)

    async def test_onboarding_preview_never_writes_memory_even_if_the_model_calls_remember(self):
        backboard = MemoryBackboard()
        gemini = ScriptedGemini(calls(('update_preferences', {'diet': 'vegan'}),
                                      ('remember', {'fact': 'Is vegan'})), text('Review these preferences.'))
        result = await agent.run(gemini, backboard, request('preview my profile', user=USER_A, preview=True), types)
        self.assertEqual(result['actions'][0]['tool'], 'update_preferences')
        self.assertFalse(result['actions'][1]['args']['saved'])
        self.assertEqual(backboard.assistants, {})
        self.assertEqual(backboard.memories, {})


class AgentRouteTests(unittest.TestCase):
    def test_route_returns_validated_actions(self):
        import main
        gemini = ScriptedGemini(calls(('go_to', {'screen': 'grocery_list'})), text('Here is your list.'))
        with patch.object(main, 'client', gemini), patch.object(main, 'backboard_client', None):
            response = TestClient(main.app).post('/assistant/agent', json={'message': 'show my grocery list', 'snapshot': {}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['actions'], [{'tool': 'go_to', 'args': {'screen': 'grocery_list'}}])
        self.assertEqual(TestClient(main.app).post('/assistant/agent', json={'message': ''}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
