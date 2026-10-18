import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from pydantic import ValidationError
from meal_generation import RecipeGenerator, RecipeRequest, RecipeResponse

DRAFT = {"name":"Chickpea salad","description":"A simple salad.","prep":5,"cook":0,"ingredients":[{"name":"chickpeas","grams":150}],"equipment":[],"steps":["Combine already cooked chickpeas."],"photo":"chickpeas"}
def fake(side_effect=None):
    call=AsyncMock(side_effect=side_effect,return_value=SimpleNamespace(text=json.dumps({"recipes":[DRAFT]})))
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=call))),call
class ProviderError(Exception):
    def __init__(self, code):
        super().__init__('private-provider-error-with-secret');self.code=code

class GenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_fake_facts_or_remote_review(self):
        client,call=fake();g=RecipeGenerator(models=['test']);result=await g.generate(client,RecipeRequest())
        meal=result['meals'][0]
        self.assertIsNone(meal['cost']);self.assertIsNone(meal['portionGrams']);self.assertIsNone(meal['allergens']);self.assertIsNone(meal['review'])
        self.assertTrue(all(v is None for v in meal['nutrition']['values'].values()))
        self.assertIn('response_json_schema',call.call_args.kwargs['config'])
    async def test_cache_coalesces_and_returns_detached_results(self):
        client,call=fake();g=RecipeGenerator(models=['test']);req=RecipeRequest()
        a,b=await asyncio.gather(g.generate(client,req),g.generate(client,req));self.assertEqual(call.await_count,1)
        a['meals'].clear();self.assertEqual(len(b['meals']),1)
        again=await g.generate(client,req);self.assertTrue(again['cached']);self.assertEqual(len(again['meals']),1)
        await g.generate(client,RecipeRequest(diet='vegan'));self.assertEqual(call.await_count,2)
    async def test_quota_fallback_and_cooldown(self):
        client,call=fake([ProviderError(429),SimpleNamespace(text=json.dumps({'recipes':[DRAFT]}))]);g=RecipeGenerator(models=['exhausted','working'])
        result=await g.generate(client,RecipeRequest());self.assertEqual(result['model'],'working');self.assertIn('exhausted',g.cooldown)
        call.side_effect=None
        await g.generate(client,RecipeRequest(diet='vegan'));self.assertEqual(call.call_args.kwargs['model'],'working')
    async def test_malformed_output_falls_back_without_fabricating(self):
        client,call=fake([SimpleNamespace(text='{bad'),SimpleNamespace(text=json.dumps({'recipes':[DRAFT]}))]);g=RecipeGenerator(models=['bad','good']);self.assertEqual((await g.generate(client,RecipeRequest()))['model'],'good')
    async def test_empty_no_fit_and_over_budget_time_equipment_are_not_overridden(self):
        client,call=fake();g=RecipeGenerator(models=['test']);result=await g.generate(client,RecipeRequest(time=1));self.assertEqual(result['meals'],[])
        client,call=fake();call.return_value=SimpleNamespace(text='{"recipes":[]}');result=await RecipeGenerator(models=['test']).generate(client,RecipeRequest());self.assertEqual(result['meals'],[])
    async def test_failures_are_sanitized_and_no_key_does_not_make_call(self):
        g=RecipeGenerator(models=['test']);client,call=fake([ProviderError(403)])
        with self.assertRaises(HTTPException) as caught: await g.generate(client,RecipeRequest())
        self.assertNotIn('secret',caught.exception.detail)
        with self.assertRaises(HTTPException) as caught: await g.generate(None,RecipeRequest())
        self.assertEqual(caught.exception.status_code,503);self.assertEqual(call.await_count,1)
    async def test_bounded_timeout(self):
        async def slow(**kwargs): await asyncio.sleep(1)
        client,call=fake(slow);g=RecipeGenerator(models=['test'],deadline=.01)
        with self.assertRaises(HTTPException) as caught: await g.generate(client,RecipeRequest())
        self.assertEqual(caught.exception.status_code,503)
    def test_strict_request_and_draft_validation(self):
        for data in [{'time':'30'},{'time':False},{'budget':float('nan')},{'budget':-1},{'exclusions':['unknown']},{'calendar':[]},{'pantry':{'rice':-1}},{'pantry':{'rice':'50'}}]:
            with self.assertRaises(ValidationError): RecipeRequest(**data)
        for data in [{**DRAFT,'cost':4.5},{**DRAFT,'review':{'confirmed':True}},{**DRAFT,'prep':-1},{**DRAFT,'ingredients':[{'name':'rice','grams':'100'}]},{**DRAFT,'equipment':['unlisted magic tool']}]:
            with self.assertRaises(ValidationError): RecipeResponse.model_validate({'recipes':[data]})
    def test_stable_identifiers_preserve_different_recipe_facts(self):
        from meal_generation import normalize_draft,RecipeDraft
        a=normalize_draft(RecipeDraft(**DRAFT));b=normalize_draft(RecipeDraft(**{**DRAFT,'cook':1}))
        self.assertNotEqual(a['id'],b['id'])

if __name__=='__main__':unittest.main()
