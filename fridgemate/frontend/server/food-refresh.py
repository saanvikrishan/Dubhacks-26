"""Refresh reviewed USDA detail snapshots. Run with backend/.venv/bin/python server/food-refresh.py."""
import asyncio
import json
import sys
from pathlib import Path
from dotenv import load_dotenv
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'backend'))
load_dotenv(ROOT.parent/'backend/.env')
import usda

async def main():
    result=await usda.fdc_client.details([m['fdcId'] for m in usda.MATCHES.values()],force=True)
    if result['status']!='retrieved' or result['missingIds']:
        raise SystemExit('USDA refresh failed: '+result['status']+'; previous snapshots retained.')
    records={r['fdcId']:r for r in result['records']}
    if any(not usda.matched_record(records.get(m['fdcId']),m) for m in usda.MATCHES.values()):
        raise SystemExit('A reviewed source identity changed; review mappings before replacing snapshots.')
    (usda.DATA/'usda-records.json').write_text(json.dumps({'records':[usda.slim_record(r) for r in result['records']]},separators=(',',':'))+'\n')
    (usda.DATA/'usda-browser.json').write_text(json.dumps({'records':[usda.compact_record(r) for r in result['records']]},separators=(',',':'))+'\n')
    print('Retrieved and validated',len(result['records']),'USDA detail records. No fuzzy matches promoted.')

asyncio.run(main())
