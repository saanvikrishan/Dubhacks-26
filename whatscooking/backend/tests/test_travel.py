import json
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from travel import WalkingClient, DESTINATIONS

def rows():
    return [{"originIndex":0,"destinationIndex":i,"status":{},"condition":"ROUTE_EXISTS","duration":"90s","distanceMeters":123} for i in range(3)]

class WalkingTests(unittest.TestCase):
    def test_walk_matrix_headers_order_rounding_cache_and_detachment(self):
        calls=[];clock=[100]
        def send(req):
            calls.append(req)
            self.assertEqual(json.loads(req.data)["travelMode"],"WALK")
            self.assertEqual(req.get_header("X-goog-api-key"),"test-secret")
            self.assertNotIn("test-secret",req.full_url)
            self.assertEqual(len(json.loads(req.data)["destinations"]),3)
            return list(reversed(rows()))
        client=WalkingClient("test-secret",send,lambda:clock[0])
        result=client.matrix();self.assertEqual(result["status"],"verified")
        self.assertEqual(result["routes"][0]["walkingMinutes"],2)
        self.assertEqual(result["routes"][0]["distanceMeters"],123)
        result["routes"][0]["durationSeconds"]=999
        self.assertEqual(client.matrix()["routes"][0]["durationSeconds"],90)
        self.assertEqual(len(calls),1)
        clock[0]=401;client.matrix();self.assertEqual(len(calls),2)
        self.assertNotIn("test-secret",json.dumps(result))

    def test_missing_key_does_not_call_provider(self):
        def fail(_):raise AssertionError("must not request")
        value=WalkingClient("",fail).matrix()
        self.assertEqual(value["status"],"missing_api_key")
        self.assertTrue(all(r["durationSeconds"] is None for r in value["routes"]))

    def test_bad_missing_negative_and_duplicate_elements_remain_unknown(self):
        for mutation in (lambda r:r[0].pop("duration"),lambda r:r[0].update(duration="-1s"),lambda r:r[0].update(duration="NaNs"),lambda r:r[0].update(distanceMeters=-1),lambda r:r.append(r[0]),lambda r:r[0].update(status={"code":5}),lambda r:r[0].update(condition="ROUTE_NOT_FOUND")):
            response=rows();mutation(response)
            value=WalkingClient("key",lambda _:response).matrix()
            self.assertIsNone(value["routes"][0]["durationSeconds"])
            self.assertEqual(value["status"],"partial")

    def test_zero_distance_proto_default_is_only_valid_for_identical_hub_pin(self):
        response=rows();response[2].update(duration="0s");response[2].pop("distanceMeters")
        response[0].pop("distanceMeters")
        value=WalkingClient("key",lambda _:response).matrix()
        self.assertEqual(value["routes"][2]["durationSeconds"],0)
        self.assertEqual(value["routes"][2]["distanceMeters"],0)
        self.assertIsNone(value["routes"][0]["distanceMeters"])

    def test_provider_failures_and_invalid_json_never_leak_key(self):
        for code in (403,429):
            def fail(_):raise HTTPError("hidden",code,"test-secret",{},None)
            value=WalkingClient("test-secret",fail).matrix()
            self.assertNotIn("test-secret",json.dumps(value))
            self.assertTrue(all(r["distanceMeters"] is None for r in value["routes"]))
        def fail(_):raise RuntimeError("test-secret")
        self.assertEqual(WalkingClient("test-secret",fail).matrix()["status"],"network_or_timeout")
        self.assertEqual(WalkingClient("key",lambda _:{}).matrix()["status"],"invalid_response")

if __name__ == "__main__":unittest.main()
