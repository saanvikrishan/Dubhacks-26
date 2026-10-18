"""Data-quality checks for the reviewed USDA ingredient list and its saved fallback records."""
import json
import sys
import unittest
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import usda

FIXTURE = Path(__file__).resolve().parents[2] / 'frontend/tests/fixtures/ingredient-names.json'
SAVED = {r['fdcId']: r for r in json.loads((usda.DATA / 'usda-records.json').read_text())['records']}
LAB_FIELDS = {'dataPoints', 'min', 'max', 'median', 'foodNutrientDerivation', 'nutrientAnalysisDetails', 'loq', 'type'}


class ReviewedListTests(unittest.TestCase):
    def test_every_reviewed_food_has_a_matching_saved_record(self):
        for key, match in usda.MATCHES.items():
            with self.subTest(key=key):
                self.assertTrue(usda.matched_record(SAVED.get(match['fdcId']), match))
                self.assertIn(match['preparation'], ('raw', 'cooked'))
                self.assertEqual(match['weightBasis'], f"{match['preparation']}_edible_weight")
                if match['expectedDataType'] == 'Branded':
                    self.assertTrue(match.get('labelSource') and match.get('brandOwner'))
                    self.assertEqual(SAVED[match['fdcId']].get('brandOwner'), match['brandOwner'])

    def test_core_macros_are_published_and_energy_is_plausible(self):
        for key, match in usda.MATCHES.items():
            values, _ = usda.nutrient_values(SAVED[match['fdcId']])
            with self.subTest(key=key):
                for nutrient in ('energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'sodium_mg'):
                    self.assertIsNotNone(values[nutrient], nutrient)
                # General 4/9/4 factors vs USDA's food-specific energy; catches wrong foods, not rounding.
                if values['energy_kcal'] >= 50:
                    atwater = 4 * values['protein_g'] + 9 * values['fat_g'] + 4 * values['carbohydrate_g']
                    self.assertTrue(0.8 <= atwater / values['energy_kcal'] <= 1.5, round(atwater / values['energy_kcal'], 2))

    def test_names_are_unambiguous(self):
        names = Counter(n for m in usda.MATCHES.values() for n in [m['key'], *m.get('aliases', [])])
        self.assertEqual([n for n, c in names.items() if c > 1], [])
        self.assertEqual([w for w in usda.DEFAULTS if w in names], [])
        self.assertTrue(all(d['key'] in usda.MATCHES for d in usda.DEFAULTS.values()))
        self.assertEqual([w for w in usda.MANIFEST['unresolved'] if w in names or w in usda.DEFAULTS], [])

    def test_saved_fallback_keeps_nutrients_without_lab_metadata(self):
        for record in SAVED.values():
            self.assertTrue(record['foodNutrients'])
            self.assertFalse(LAB_FIELDS & set().union(*(row.keys() for row in record['foodNutrients'])))
        self.assertEqual(set(SAVED), {m['fdcId'] for m in usda.MATCHES.values()})


class NameResolutionTests(unittest.TestCase):
    def test_shared_cases_match_the_frontend(self):
        for name, key, assumes in json.loads(FIXTURE.read_text())['cases']:
            with self.subTest(name=name):
                resolved, assumption = usda.resolve_name(name)
                self.assertEqual(resolved, key)
                self.assertEqual(bool(assumption), assumes)

    def test_bare_lookups_never_apply_a_default(self):
        self.assertEqual(usda.resolve_name('rice', allow_defaults=False), (None, None))
        self.assertEqual(usda.resolve_name('2 cups jasmine rice'), ('white rice', 'For this recipe, jasmine rice means uncooked white rice.'))


if __name__ == '__main__':
    unittest.main()
