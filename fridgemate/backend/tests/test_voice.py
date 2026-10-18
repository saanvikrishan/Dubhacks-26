import base64
import io
import sys
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai import types
import voice

PCM = b"\x00\x01" * 2400   # 0.1 s of 24 kHz audio


def audio_reply(data=PCM, mime="audio/L16;codec=pcm;rate=24000"):
    part = SimpleNamespace(inline_data=SimpleNamespace(data=data, mime_type=mime))
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])


class FakeGemini:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate))

    async def generate(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def clip(seconds=0.5):
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b"\x00\x00" * int(16000 * seconds))
    return base64.b64encode(out.getvalue()).decode()


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        voice._spoken.clear()

    async def test_transcribes_audio_with_the_names_the_user_may_say(self):
        gemini = FakeGemini(SimpleNamespace(text='  "Add tofu and plan dinner before Bio 101."\n'))
        result = await voice.transcribe(gemini, types, voice.TranscribeRequest(audio=clip(), hints=["Bio 101", "tofu", "tofu"]))
        self.assertEqual(result, {"text": "Add tofu and plan dinner before Bio 101."})
        call = gemini.calls[0]
        self.assertEqual(call["model"], voice.TRANSCRIBE_MODEL)
        self.assertEqual(call["contents"][0].inline_data.mime_type, "audio/wav")
        self.assertIn("Bio 101, tofu.", call["contents"][1])

    async def test_bad_recordings_are_refused_before_any_model_call(self):
        gemini = FakeGemini()
        for request, status in ((voice.TranscribeRequest(audio=clip(), mime="video/mp4"), 422),
                                (voice.TranscribeRequest(audio="not base64!" * 20), 422),
                                (voice.TranscribeRequest(audio=clip(79)), 413)):
            with self.assertRaises(HTTPException) as caught:
                await voice.transcribe(gemini, types, request)
            self.assertEqual(caught.exception.status_code, status)
        self.assertEqual(gemini.calls, [])

    async def test_speaks_only_the_words_as_wav_and_never_pays_twice(self):
        gemini = FakeGemini(audio_reply())
        audio = await voice.speak(gemini, types, "**Done!** Tofu is on your list.\n- spinach")
        with wave.open(io.BytesIO(audio)) as f:
            self.assertEqual((f.getframerate(), f.getnchannels(), f.getnframes()), (24000, 1, 2400))
        self.assertEqual(gemini.calls[0]["contents"], "Done! Tofu is on your list. spinach")
        self.assertEqual(gemini.calls[0]["config"].response_modalities, ["AUDIO"])
        self.assertEqual(await voice.speak(gemini, types, "**Done!** Tofu is on your list.\n- spinach"), audio)
        self.assertEqual(len(gemini.calls), 1)

    async def test_falls_back_to_the_next_voice_model_and_hides_provider_errors(self):
        gemini = FakeGemini(RuntimeError("secret-key-123"), audio_reply())
        with patch.object(voice, "SPEECH_MODELS", ["fast-tts", "full-tts"]):
            await voice.speak(gemini, types, "Hello there.")
            self.assertEqual([c["model"] for c in gemini.calls], ["fast-tts", "full-tts"])
            credits = type("E", (Exception,), {"code": 402})("secret-key-123")
            with self.assertRaises(HTTPException) as caught:
                await voice.speak(FakeGemini(credits), types, "Something else.")
        self.assertIn("no credits", caught.exception.detail)
        self.assertNotIn("secret", caught.exception.detail)


class VoiceRouteTests(unittest.TestCase):
    def test_routes(self):
        import main
        gemini = FakeGemini(SimpleNamespace(text="hello"), audio_reply())
        voice._spoken.clear()
        with patch.object(main, "client", gemini):
            app = TestClient(main.app)
            self.assertEqual(app.post("/assistant/transcribe", json={"audio": clip()}).json(), {"text": "hello"})
            spoken = app.post("/assistant/speak", json={"text": "Hi!"})
            self.assertEqual(spoken.headers["content-type"], "audio/wav")
            self.assertEqual(spoken.content[:4], b"RIFF")
            self.assertEqual(app.post("/assistant/speak", json={"text": ""}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
