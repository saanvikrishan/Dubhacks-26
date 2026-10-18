import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from pydantic import ValidationError
from meal_generation import RecipeGenerator, RecipeRequest
from agent import validate_call, _schema, UpdatePreferences

DRAFT = {"name":"Kiwi salad","description":"Fresh fruit.","prep":5,"cook":0,"ingredients":[{"name":"kiwi","grams":100}],"equipment":[],"steps":["Slice fruit."],"photo":"chickpeas"}
class FinalizationTests(unittest.IsolatedAsyncioTestCase):
    def test_custom_allergy_normalization_and_budget_clear(self):
        req=RecipeRequest(exclusions=[' Kiwi ', 'Peanuts','kiwi'],budget=None)
        self.assertEqual(req.exclusions,['kiwi','peanut']);self.assertIsNone(req.budget)
        args,error=validate_call('update_preferences',{'budget':None,'allergies_add':['Kiwi']})
        self.assertIsNone(error);self.assertEqual(args['allergies_add'],['kiwi']);self.assertIn('budget',args);self.assertIsNone(args['budget'])
        self.assertIn({'type':'null'},_schema(UpdatePreferences)['properties']['budget']['anyOf'])
        for bad in [[''],['a'*61],['a']*31]:
            with self.assertRaises(ValidationError): RecipeRequest(exclusions=bad)
    async def test_model_allergy_conflict_is_rejected_without_retry(self):
        call=AsyncMock(return_value=SimpleNamespace(text=json.dumps({'recipes':[DRAFT]})))
        client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=call)))
        result=await RecipeGenerator(models=['mock']).generate(client,RecipeRequest(ingredients=['kiwi','cucumber'],exclusions=['kiwi'],budget=None,cuisines=['Korean'],tastes=['Spicy']))
        self.assertEqual(result['meals'],[]);self.assertEqual(call.await_count,1)
        prompt=call.call_args.kwargs['contents'];self.assertIn('soft preferences',prompt);self.assertIn('Never relax diet, allergies, time or equipment',prompt)
        sent=json.loads(prompt.split('Input: ',1)[1].split('\nPreferences:',1)[0]);self.assertEqual(sent['ingredients'],['cucumber']);self.assertEqual(sent['exclusions'],['kiwi']);self.assertIsNone(sent['budget'])
    async def test_model_diet_conflict_is_rejected(self):
        draft={**DRAFT,'ingredients':[{'name':'chicken breast','grams':100}]}
        call=AsyncMock(return_value=SimpleNamespace(text=json.dumps({'recipes':[draft]})))
        client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=call)))
        self.assertEqual((await RecipeGenerator(models=['mock']).generate(client,RecipeRequest(diet='vegetarian')))['meals'],[])
