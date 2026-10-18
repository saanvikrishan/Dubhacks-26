import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import main
from meal_generation import RecipeRequest, RecipeDraft

class MainCompatibilityTests(unittest.TestCase):
    def test_all_main_routes_remain_available(self):
        paths={r.path for r in main.app.routes}
        for path in ['/recipes','/recipes/phrase','/recipes/substitute','/vision/ingredients','/nutrition/lookup','/preferences','/pantry','/saved-meals','/saved-meals/{row_id}','/google-calendar/auth-url','/google-calendar/callback','/google-calendar/status','/google-calendar/events']:
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
