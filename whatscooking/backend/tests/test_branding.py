import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import branding
import food_memory
from meal_images import PhotoIndex


class BrandingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        food_memory._assistants.clear()
        food_memory._locks.clear()

    async def test_existing_personal_memories_reuse_the_original_assistant(self):
        user = '11111111-1111-4111-8111-111111111111'
        old = f'Daywell user {user}'
        client = SimpleNamespace(
            list_assistants=AsyncMock(side_effect=lambda name, limit: [SimpleNamespace(name=old, assistant_id='existing')] if name == old else []),
            create_assistant=AsyncMock(),
        )
        self.assertEqual(await food_memory.user_assistant(client, user, create=True), 'existing')
        client.create_assistant.assert_not_awaited()

    async def test_existing_photo_index_is_reused_and_new_indexes_use_the_new_brand(self):
        client = SimpleNamespace(
            list_assistants=AsyncMock(side_effect=lambda name, limit: [SimpleNamespace(name=name, assistant_id='photos')] if name == 'Daywell dish photos' else []),
            create_assistant=AsyncMock(return_value=SimpleNamespace(assistant_id='new')),
        )
        self.assertEqual(await PhotoIndex(client)._assistant(), 'photos')
        client.create_assistant.assert_not_awaited()
        client.list_assistants = AsyncMock(return_value=[])
        self.assertEqual(await PhotoIndex(client)._assistant(), 'new')
        self.assertEqual(client.create_assistant.call_args.kwargs['name'], 'whatscooking.ai dish photos')

    async def test_existing_shared_preferences_remain_accessible(self):
        import main
        client = SimpleNamespace(
            list_assistants=AsyncMock(side_effect=lambda name, limit: [SimpleNamespace(name=name, assistant_id='preferences')] if name == 'FridgeMate demo' else []),
            create_assistant=AsyncMock(),
        )
        with patch.object(main, 'backboard_client', client), patch.object(main, '_assistant_id', None), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(await main.get_assistant_id(), 'preferences')
        client.create_assistant.assert_not_awaited()
        self.assertEqual(main.app.title, 'WhatsCooking.ai API')

    def test_existing_user_configuration_is_supported_without_editing_env_files(self):
        with patch.dict(os.environ, {'DAYWELL_USER_ID':'existing'}, clear=True):
            self.assertEqual(branding.configured_user_id(), 'existing')
            with patch.dict(os.environ, {'WHATSCOOKING_USER_ID':'new'}):
                self.assertEqual(branding.configured_user_id(), 'new')
