import json
import math
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from kroger import KrogerClient, product_quotes

class Response:
    def __init__(self,status,body):self.status_code,self.body=status,body
    def json(self):return self.body

class KrogerTests(unittest.TestCase):
    def test_missing_credentials_and_invalid_location_do_not_call_provider(self):
        calls=[]
        client=KrogerClient('','',send=lambda *a,**k:calls.append(a))
        self.assertEqual(client.products('70500807','tofu')['status'],'missing_configuration')
        self.assertEqual(calls,[])
        with self.assertRaises(ValueError):client.products('','tofu')
        with self.assertRaises(ValueError):client.locations('https://example.com')
        self.assertEqual(calls,[])
    def test_store_scope_token_cache_price_scope_and_timestamp_cache(self):
        clock=[1000];calls=[]
        def send(method,path,**kwargs):
            calls.append((method,path,kwargs))
            if method=='POST':return Response(200,{'access_token':'private-token','expires_in':1800})
            return Response(200,{'data':[{'productId':'123','description':'Exact tofu SKU','items':[{'itemId':'456','size':'14 oz','soldBy':'UNIT','price':{'regular':3.49,'promo':1.99,'expirationDate':{'value':'2026-11-11'}}}]}]})
        client=KrogerClient('private-client','private-secret',send=send,now=lambda:clock[0])
        result=client.products('70500807','tofu');quote=result['quotes'][0]
        self.assertEqual(calls[1][2]['params']['filter.locationId'],'70500807')
        self.assertEqual(quote['packageSize'],'14 oz');self.assertEqual(quote['regularPrice'],3.49);self.assertEqual(quote['promotionalPrice'],1.99);self.assertIsNone(quote['portionCost'])
        result['quotes'][0]['regularPrice']=999
        clock[0]+=30;cached=client.products('70500807','TOFU')
        self.assertEqual(cached['quotes'][0]['regularPrice'],3.49);self.assertEqual(cached['checkedAt'],quote['checkedAt']);self.assertEqual(len(calls),2)
        clock[0]+=901;fresh=client.products('70500807','tofu');self.assertNotEqual(fresh['checkedAt'],cached['checkedAt']);self.assertEqual(len(calls),3)
        text=json.dumps(fresh)
        for secret in ['private-token','private-client','private-secret']:self.assertNotIn(secret,text)
    def test_missing_price_and_zero_promotion_never_become_recipe_cost(self):
        rows=[{'productId':'a','items':[{'itemId':'1','size':'2 ct','price':{'promo':0}}]}]
        quote=product_quotes(rows,'70500807',1000)[0]
        self.assertIsNone(quote['regularPrice']);self.assertEqual(quote['promotionalPrice'],0);self.assertEqual(quote['status'],'unknown');self.assertIsNone(quote['portionCost'])
        quote=product_quotes([{'items':[{'price':{'regular':'3.49'}}]}],'70500807',1000)[0]
        self.assertIsNone(quote['regularPrice'])
    def test_authentication_failure_malformed_data_and_provider_exceptions_are_sanitized(self):
        for response in [Response(401,{'access_token':'secret'}),Response(200,{'access_token':'token','expires_in':'bad'})]:
            client=KrogerClient('id','secret',send=lambda *a,**k:response)
            result=client.products('70500807','tofu');self.assertEqual(result['quotes'],[]);self.assertNotIn('secret',json.dumps(result))
        def fail(*a,**k):raise RuntimeError('private-client private-secret private-token')
        self.assertEqual(KrogerClient('id','secret',send=fail).products('70500807','tofu')['status'],'network_or_invalid_response')
    def test_failed_refresh_does_not_republish_expired_prices(self):
        clock=[1000]
        def send(method,path,**kwargs):
            if method=='POST':return Response(200,{'access_token':'token','expires_in':7200})
            if clock[0]>1000:return Response(503,{})
            return Response(200,{'data':[{'items':[{'price':{'regular':3.49}}]}]})
        client=KrogerClient('id','secret',send=send,now=lambda:clock[0]);client.products('70500807','tofu');clock[0]+=901
        result=client.products('70500807','tofu');self.assertEqual(result['status'],'api_rejected');self.assertEqual(result['quotes'],[]);self.assertNotIn('checkedAt',result)
