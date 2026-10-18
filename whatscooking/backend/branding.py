"""Product identity and compatibility reads for existing configuration and memory."""
import asyncio
import os

BRAND = 'whatscooking.ai'
LEGACY_DEMO_NAMES = ('WhatsCooking demo', 'FridgeMate demo')
LEGACY_PHOTO_NAMES = ('Daywell dish photos',)
LEGACY_USER_PREFIX = 'Daywell user '


def configured_user_id():
    return (os.getenv('WHATSCOOKING_USER_ID') or os.getenv('DAYWELL_USER_ID') or 'demo').strip() or 'demo'


async def find_assistant(client, name, legacy_names=()):
    """Reuse an existing assistant before creating a newly branded one; never rewrite memories."""
    for candidate in (name, *legacy_names):
        rows = await asyncio.wait_for(client.list_assistants(name=candidate, limit=5), timeout=5)
        for row in rows or []:
            actual = row.get('name', candidate) if isinstance(row, dict) else getattr(row, 'name', candidate)
            if actual == candidate:
                return str(row['assistant_id'] if isinstance(row, dict) else row.assistant_id)
    return None
