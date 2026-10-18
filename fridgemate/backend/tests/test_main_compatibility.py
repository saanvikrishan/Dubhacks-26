import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import main
from meal_generation import RecipeRequest, RecipeDraft

class MainCompatibilityTests(unittest.TestCase):
    def test_all_main_routes_remain_available(self):
        paths={r.path for r in main.app.routes}
        for path in ['/profile-patch','/recipes','/recipes/phrase','/recipes/substitute','/vision/ingredients','/nutrition/lookup','/preferences','/pantry','/saved-meals','/saved-meals/{row_id}','/google-calendar/auth-url','/google-calendar/callback','/google-calendar/status','/google-calendar/events','/meal-reminder-message','/sync-meal-plans']:
            self.assertIn(path,paths)
    def test_assistant_and_draft_requests_keep_their_distinct_contracts(self):
        client=TestClient(main.app)
        with patch.object(main,'interpret_constraints',new=AsyncMock(return_value={'intent':'conversation','message':'test reply'})) as interpret:
            self.assertEqual(client.post('/recipes',json={'text':'hello','memories':[],'history':[]}).json()['message'],'test reply')
            interpret.assert_awaited_once()
        with patch.object(main.recipe_generator,'generate',new=AsyncMock(return_value={'meals':[]})) as generate:
            self.assertEqual(client.post('/recipes',json={'ingredients':['tofu'],'equipment':['air fryer'],'time':20}).json(),{'meals':[]})
            generate.assert_awaited_once()
    def test_main_equipment_can_be_used_by_recipe_drafts(self):
        req=RecipeRequest(ingredients=['tofu'],equipment=['air fryer','rice cooker','slow cooker'])
        draft=RecipeDraft(name='Tofu',description='Test recipe',prep=5,cook=10,ingredients=[{'name':'tofu','grams':100.0}],equipment=['air fryer'],steps=['Cook tofu.'],photo='tofu')
        self.assertIn(draft.equipment[0],req.equipment)

    def test_new_main_profile_endpoint_returns_a_proposal_without_mutation(self):
        import copy, json
        profile={'diet':'vegetarian','exclusions':['soy'],'cuisines':[],'equipment':['stove']}
        before=copy.deepcopy(profile)
        provider=MagicMock()
        provider.models.generate_content.return_value.text=json.dumps({'cuisines_add':['Italian','invalid'],'summary':'Update preferences?'})
        with patch.object(main,'client',provider), patch.object(main,'enforce_rate_limit'):
            response=TestClient(main.app).post('/profile-patch',json={'text':'I like Italian food','current_profile':profile})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['patch'],{'cuisines_add':['Italian']})
        self.assertEqual(profile,before)
        provider.models.generate_content.assert_called_once()

    def test_structured_food_preferences_write_and_invalidate_recall(self):
        metadata={'type':'food_preferences','profile':{'preferred':'tofu','cuisines':['Italian'],'tastes':['Savory'],'dislikes':'olives'},'savedAt':'2026-10-18T09:00:00Z'}
        provider=MagicMock()
        provider.add_memory=AsyncMock(return_value={'id':'test-memory'})
        with patch.object(main,'backboard_client',provider), patch.object(main,'get_assistant_id',new=AsyncMock(return_value='test-assistant')), patch.object(main,'invalidate_preferences') as invalidate:
            response=TestClient(main.app).post('/preferences',json={'content':'Food preferences: tofu, Italian, savory; dislikes olives.','metadata':metadata})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),{'id':'test-memory'})
        provider.add_memory.assert_awaited_once_with('test-assistant','Food preferences: tofu, Italian, savory; dislikes olives.',metadata=metadata)
        invalidate.assert_called_once_with()
