import asyncio
import copy
import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import usda
import food_reference
import food_memory
from kroger import KrogerClient

class UsdaParsingTests(unittest.TestCase):
    def test_detail_search_shapes_and_ids_are_distinct_from_row_ids_and_numbers(self):
        detail={'dataType':'SR Legacy','foodNutrients':[{'id':1003,'nutrient':{'id':1093,'unitName':'g'},'amount':.25},{'id':999,'nutrient':{'id':1003,'unitName':'g'},'amount':20}]}
        values,_=usda.nutrient_values(detail)
        self.assertEqual(values['protein_g'],20);self.assertEqual(values['sodium_mg'],250)
        self.assertIsNone(values['energy_kcal'])
        search={'dataType':'SR Legacy','foodNutrients':[{'nutrientId':1003,'unitName':'g','value':12},{'nutrientId':1008,'unitName':'kJ','value':418.4}]}
        self.assertEqual(usda.nutrient_values(search)[0]['protein_g'],12)
        self.assertAlmostEqual(usda.nutrient_values(search)[0]['energy_kcal'],100)
        self.assertIsNone(usda.nutrient_values({'foodNutrients':[{'nutrientNumber':'203','value':99,'unitName':'g'}]})[0]['protein_g'])
    def test_foundation_energy_priority_zero_missing_and_conflicts(self):
        raw={'dataType':'Foundation','foodNutrients':[{'nutrient':{'id':2047,'unitName':'kcal'},'amount':80},{'nutrient':{'id':2048,'unitName':'kcal'},'amount':78},{'nutrient':{'id':1003,'unitName':'g'},'amount':0}]}
        values,fields=usda.nutrient_values(raw);self.assertEqual(values['energy_kcal'],78);self.assertEqual(fields['energy_kcal']['nutrientId'],2048);self.assertEqual(values['protein_g'],0);self.assertIsNone(values['sodium_mg'])
        raw['foodNutrients'].append({'nutrient':{'id':1003,'unitName':'g'},'amount':2})
        self.assertIsNone(usda.nutrient_values(raw)[0]['protein_g'])
        raw['foodNutrients']=raw['foodNutrients'][:1]
        self.assertEqual(usda.nutrient_values(raw)[0]['energy_kcal'],80)

class UsdaClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_limit_cache_coalescing_and_detached_records(self):
        calls=[];clock=[1000]
        async def send(path,payload):
            calls.append((path,payload));await asyncio.sleep(0)
            return 200,[{'fdcId':i,'description':'Food '+str(i),'dataType':'Foundation','foodNutrients':[]} for i in payload['fdcIds']]
        client=usda.FdcClient(send=send,now=lambda:clock[0],saved=[])
        with patch.object(usda,'usda_configured',return_value=True):
            a,b=await asyncio.gather(client.details(list(range(1,22))),client.details(list(range(1,22))))
            self.assertEqual(len(calls),2);self.assertEqual(len(calls[0][1]['fdcIds']),20)
            a['records'][0]['description']='changed';self.assertNotEqual(a,b)
            clock[0]+=usda.TTL+1;await client.details([1]);self.assertEqual(len(calls),3)
    async def test_429_and_exceptions_retain_original_saved_dates_without_false_live_success(self):
        saved={'fdcId':1,'retrievedAt':'2026-10-01','description':'Saved'}
        client=usda.FdcClient(send=AsyncMock(return_value=(429,None)),now=lambda:1000,saved=[saved])
        with patch.object(usda,'usda_configured',return_value=True):
            result=await client.details([1,2]);self.assertEqual(result['status'],'rate_limited');self.assertEqual(result['records'][0]['retrievedAt'],'2026-10-01');self.assertEqual(result['missingIds'],[2])
            await client.details([1]);self.assertEqual(client.send.await_count,1)
        client=usda.FdcClient(send=AsyncMock(side_effect=RuntimeError('private-api-key')),saved=[])
        with patch.object(usda,'usda_configured',return_value=True):
            result=await client.details([1]);self.assertNotIn('private-api-key',json.dumps(result));self.assertEqual(result['records'],[])
    async def test_no_fuzzy_promotion_no_default_grams_and_recipe_yield(self):
        match=usda.MATCHES['tofu']
        raw={'fdcId':match['fdcId'],'description':match['expectedDescription'],'dataType':match['expectedDataType'],'retrievedAt':'2026-10-18','foodNutrients':[{'nutrient':{'id':1003,'unitName':'g'},'amount':20}]}
        client=usda.FdcClient(saved=[raw],send=AsyncMock())
        with patch.object(usda,'fdc_client',client),patch.object(usda,'usda_configured',return_value=False):
            self.assertIsNone(await usda.lookup_per_100g('rice'))
            result=await usda.enrich_meal({'ingredients':[{'name':'tofu','grams':150}],'nutrition':{'yieldServings':2}})
            self.assertEqual(result['nutrition']['values']['protein_g'],15)
            self.assertIsNone(result['nutrition']['values']['energy_kcal'])
            result=await usda.enrich_meal({'ingredients':[{'name':'tofu'}]})
            self.assertIsNone(result['nutrition']['values']['protein_g'])
            self.assertNotIn('cost',result);self.assertNotIn('allergens',result)
    async def test_reference_does_not_promote_a_changed_product_or_missing_price(self):
        nutrition={'status':'saved_reference','records':[],'matches':[]}
        wrong={'status':'retrieved','quotes':[{'productId':'wrong','description':'wrong','packageSize':'1 oz'}]}
        with patch.object(usda,'ingredient_reference',new=AsyncMock(return_value=nutrition)),patch.object(food_reference.kroger_client,'product',return_value=wrong):
            result=await food_reference.food_reference('70500807')
        self.assertTrue(all(row['quote'] is None for row in result['pricing']['ingredients']))

class MemoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        food_memory._cache=None;food_memory._until=0;food_memory._pending=None
    async def test_read_only_recall_uses_existing_assistant_and_extracts_soft_preferences_only(self):
        from types import SimpleNamespace
        client=SimpleNamespace(list_assistants=AsyncMock(return_value=[SimpleNamespace(assistant_id='existing')]),get_memories=AsyncMock(return_value={'memories':[{'id':'memory','metadata':{'state':{'profile':{'preferred':'tofu','cuisines':['Italian'],'exclusions':['soy'],'budget':999}}}}]}),create_assistant=AsyncMock(),add_memory=AsyncMock())
        with patch.dict(os.environ,{'BACKBOARD_ASSISTANT_ID':''}):result=await food_memory.recall_preferences(client)
        self.assertEqual(result['status'],'retrieved');self.assertEqual(result['preferences'][0]['preferred'],'tofu');self.assertNotIn('budget',result['preferences'][0]);self.assertNotIn('exclusions',result['preferences'][0]);client.create_assistant.assert_not_called();client.add_memory.assert_not_called()
        await food_memory.recall_preferences(client);self.assertEqual(client.get_memories.await_count,1)
    async def test_memory_failure_has_a_clear_status_and_no_secret(self):
        from types import SimpleNamespace
        client=SimpleNamespace(get_memories=AsyncMock(side_effect=RuntimeError('private-memory-key')))
        result=await food_memory.recall_preferences(client,'existing');self.assertEqual(result,{'status':'unavailable','preferences':[]})
        self.assertNotIn('private-memory-key',json.dumps(result))

class StructuredPreferenceTests(unittest.TestCase):
    def test_latest_preference_snapshot_overrides_old_memories_and_can_clear_preferences(self):
        old={'metadata':{'type':'food_preferences','savedAt':'2026-10-17','profile':{'preferred':'tofu','cuisines':['Chinese']}}}
        new={'metadata':{'type':'food_preferences','savedAt':'2026-10-18','profile':{'preferred':'','cuisines':['Italian'],'tastes':['Spicy'],'dislikes':'olives'}}}
        found=food_memory.extract_preferences({'memories':[old,new]})
        self.assertEqual(len(found),1);self.assertEqual(found[0]['cuisines'],['Italian']);self.assertEqual(found[0]['tastes'],['Spicy']);self.assertEqual(found[0]['dislikes'],'olives')
        new['metadata']['profile']={'preferred':'','cuisines':[],'tastes':[],'dislikes':''}
        self.assertEqual(food_memory.extract_preferences({'memories':[old,new]}),[])
    def test_recipe_preferences_are_bounded_input_fields(self):
        from meal_generation import RecipeRequest
        from pydantic import ValidationError
        request=RecipeRequest(cuisines=['Italian'],tastes=['Spicy'],dislikes='olives')
        self.assertEqual(request.cuisines,['italian'])
        with self.assertRaises(ValidationError):RecipeRequest(cuisines=['x'*61])
