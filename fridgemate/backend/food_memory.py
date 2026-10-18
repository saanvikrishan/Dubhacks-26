"""Recall structured food preferences; current explicit preferences stay authoritative."""
import asyncio
import os
import re
import time

_cache = None
_until = 0
_pending = None


def extract_preferences(body):
    if hasattr(body,'model_dump'):body=body.model_dump()
    rows=body.get('memories',[]) if isinstance(body,dict) else []
    structured=[row for row in rows if isinstance(row,dict) and isinstance(row.get('metadata'),dict) and row['metadata'].get('type')=='food_preferences']
    if structured:
        rows=sorted(structured,key=lambda row:str(row['metadata'].get('savedAt') or row.get('updated_at') or row.get('created_at') or ''),reverse=True)[:1]
    result=[]
    for row in rows[:20]:
        if not isinstance(row,dict):continue
        metadata=row.get('metadata') or {}
        if not isinstance(metadata,dict):metadata={}
        state=metadata.get('state') or {}
        profile=metadata.get('profile') or (state.get('profile') if isinstance(state,dict) else {}) or {}
        preferred=profile.get('preferred') if isinstance(profile,dict) else None
        cuisines=profile.get('cuisines',[]) if isinstance(profile,dict) else []
        tastes=profile.get('tastes',[]) if isinstance(profile,dict) else []
        dislikes=profile.get('dislikes','') if isinstance(profile,dict) else ''
        content=row.get('content') or ''
        if not preferred and isinstance(content,str):
            match=re.search(r'\b(?:like|love|prefer|enjoy)\s+([\w ,&-]{2,60})',content,re.I)
            if match:preferred=match.group(1).strip()
        if not isinstance(preferred,str):preferred=''
        cuisines=[c[:40] for c in cuisines if isinstance(c,str) and c.strip()] if isinstance(cuisines,list) else []
        tastes=[v[:40] for v in tastes if isinstance(v,str)] if isinstance(tastes,list) else []
        dislikes=dislikes[:160] if isinstance(dislikes,str) else ''
        if preferred.strip() or cuisines or tastes or dislikes:
            result.append({'preferred':preferred.strip()[:80],'cuisines':cuisines[:12],'tastes':tastes[:8],'dislikes':dislikes,'source':'Backboard','sourceId':str(row.get('id') or row.get('memory_id') or ''),'checkedAt':row.get('updated_at') or row.get('created_at')})
    return result[:10]


async def recall_preferences(client,assistant_id=None):
    global _cache,_until,_pending
    if _cache is not None and _until>time.monotonic():return _cache
    if _pending:return await asyncio.shield(_pending)
    async def read():
        global _cache,_until
        if client is None:return {'status':'missing_configuration','preferences':[]}
        try:
            ident=assistant_id or os.getenv('BACKBOARD_ASSISTANT_ID')
            if not ident:
                existing=await asyncio.wait_for(client.list_assistants(name='FridgeMate demo',limit=10),timeout=5)
                ident=str(existing[0].assistant_id) if existing else None
            if not ident:
                result={'status':'no_existing_assistant','preferences':[]}
            else:
                memories=await asyncio.wait_for(client.get_memories(ident,page_size=20),timeout=5)
                result={'status':'retrieved','preferences':extract_preferences(memories)}
        except Exception:
            result={'status':'unavailable','preferences':[]}
        _cache=result;_until=time.monotonic()+(300 if result['status']=='retrieved' else 30)
        return result
    _pending=asyncio.create_task(read())
    try:return await asyncio.shield(_pending)
    finally:_pending=None


def invalidate_preferences():
    global _cache,_until
    _cache=None
    _until=0
