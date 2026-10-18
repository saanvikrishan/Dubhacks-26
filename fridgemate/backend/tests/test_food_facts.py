import asyncio
import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import usda
import food_reference

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

class SavedRecordTests(unittest.TestCase):
    def test_slim_record_keeps_every_nutrient_value_and_drops_only_lab_metadata(self):
        full={'fdcId':1,'description':'Tofu','dataType':'Foundation','foodCategory':{'description':'Legumes'},'foodPortions':[{'gramWeight':126}],
              'inputFoods':[{'id':9}],'nutrientConversionFactors':[{'type':'x'}],
              'foodNutrients':[{'id':5,'type':'FoodNutrient','amount':8.1,'dataPoints':3,'min':7,'max':9,'nutrientAnalysisDetails':[{'labMethod':'x'}],
                                'nutrient':{'id':1003,'number':'203','name':'Protein','unitName':'g'}},
                               {'id':6,'amount':0.01,'foodNutrientDerivation':{'code':'A'},'nutrient':{'id':1176,'number':'416','name':'Biotin','unitName':'µg'}}]}
        slim=usda.slim_record(full)
        self.assertEqual([(n['nutrient']['name'],n['amount']) for n in slim['foodNutrients']],[('Protein',8.1),('Biotin',0.01)])
        self.assertNotIn('inputFoods',slim);self.assertNotIn('dataPoints',slim['foodNutrients'][0]);self.assertEqual(slim['foodCategory'],{'description':'Legumes'})
        self.assertEqual(usda.compact_record(slim),usda.compact_record(full))


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

class RecipePreferenceTests(unittest.TestCase):
    def test_recipe_preferences_are_bounded_input_fields(self):
        from meal_generation import RecipeRequest
        from pydantic import ValidationError
        request=RecipeRequest(cuisines=['Italian'],tastes=['Spicy'],dislikes='olives')
        self.assertEqual(request.cuisines,['italian'])
        with self.assertRaises(ValidationError):RecipeRequest(cuisines=['x'*61])
