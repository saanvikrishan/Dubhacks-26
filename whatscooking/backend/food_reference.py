"""Read-only source facts for the existing Cook decision path. No model/persistence calls."""
import asyncio
import json
import re
from pathlib import Path
import usda
from kroger import kroger_client

PRICES = json.loads((Path(__file__).resolve().parents[1]/'frontend/src/data/food/pricing-matches.json').read_text())


async def food_reference(location_id=None):
    location_id = location_id or PRICES['defaultStore']['locationId']
    if not isinstance(location_id,str) or not re.fullmatch(r'\d{8}',location_id):
        raise ValueError('Choose an eight-digit Kroger store ID.')
    nutrition = await usda.ingredient_reference()
    semaphore=asyncio.Semaphore(3)
    async def quote(match):
        async with semaphore:
            result=await asyncio.to_thread(kroger_client.product,location_id,match['productId'])
        exact=[q for q in result.get('quotes',[]) if q['productId']==match['productId'] and q['description']==match['expectedDescription'] and q['packageSize']==match['expectedSize']]
        return {'key':match['key'],'status':result['status'] if exact else 'unmatched_product','quote':exact[0] if len(exact)==1 else None}
    pricing=await asyncio.gather(*(quote(match) for match in PRICES['matches']))
    nutrition={**nutrition,'records':[usda.compact_record(r) for r in nutrition['records']]}
    return {'version':1,'nutrition':nutrition,'pricing':{'store':{'locationId':location_id,'name':PRICES['defaultStore']['name'] if location_id==PRICES['defaultStore']['locationId'] else 'Selected Kroger store'},'ingredients':pricing,'unresolved':PRICES['unresolved']}}
