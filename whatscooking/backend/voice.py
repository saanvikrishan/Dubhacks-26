"""Voice for the assistant: what the user says becomes text, and replies are read aloud.

A spoken request is transcribed (Gemini Flash-Lite understands audio) and then handled by the agent
exactly like a typed one, so every change still goes through the app's checks and Undo. Replies are
spoken with a Gemini TTS voice. Errors never expose provider details.
"""

import array
import asyncio
import base64
import binascii
import hashlib
import io
import os
import re
import wave
from collections import OrderedDict

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

TRANSCRIBE_MODEL = os.getenv("GEMINI_TRANSCRIBE_MODEL") or os.getenv("GEMINI_AGENT_MODEL") or "gemini-3.1-flash-lite"
# Fast, cheap voice first; the fuller model only if it fails.
SPEECH_MODELS = list(dict.fromkeys(m for m in (os.getenv("GEMINI_TTS_MODEL"), "gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts") if m))
VOICE = os.getenv("GEMINI_TTS_VOICE") or "Aoede"
AUDIO_TYPES = {"audio/wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/flac"}
MAX_AUDIO_BYTES = 10_000_000   # about 5 minutes of 16 kHz speech (recording runs until the user stops it)


class TranscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio: str = Field(min_length=100, max_length=13_500_000, description="base64 audio")
    mime: str = "audio/wav"
    hints: list[str] = Field(default_factory=list, max_length=60, description="Names that may be said: events, foods")


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=800)


def _fail(error, doing):
    if getattr(error, "code", None) == 402:
        return HTTPException(503, "Voice is paused: the Gemini account has no credits left.")
    if isinstance(error, asyncio.TimeoutError):
        return HTTPException(503, f"{doing} took too long. Try again.")
    return HTTPException(502, f"{doing} is not available right now. Try again.")


async def transcribe(client, types, request):
    if client is None:
        raise HTTPException(503, "Voice needs Gemini, which is not configured on the backend.")
    mime = request.mime.split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        raise HTTPException(422, "Unsupported audio format.")
    try:
        audio = base64.b64decode(request.audio, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "The recording could not be read.") from None
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "That recording is too long. Keep voice messages under five minutes.")
    hints = ", ".join(dict.fromkeys(h.strip()[:60] for h in request.hints if h.strip()))[:1200]
    prompt = ("Transcribe this voice message to a meal-planning assistant word for word, in the language spoken. "
              "Output only the words said, with no quotes, labels or notes. If nobody speaks, output nothing."
              + (f" Names that may come up: {hints}." if hints else ""))
    try:
        response = await asyncio.wait_for(client.aio.models.generate_content(
            model=TRANSCRIBE_MODEL,
            contents=[types.Part.from_bytes(data=audio, mime_type=mime), prompt],
            config=types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level="minimal")),
        ), timeout=20 + len(audio) / 200_000)   # longer recordings get more time
    except Exception as error:
        raise _fail(error, "Listening") from None
    text = re.sub(r"\s+", " ", (response.text or "")).strip().strip('"').strip()
    return {"text": text[:1000]}


def plain(text):
    """What should be read aloud: no Markdown symbols, bullets or extra spaces."""
    text = re.sub(r"[*_`#]+", "", text)
    text = re.sub(r"^\s*(?:[-•]|\d+[.)])\s+", "", text, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()[:800]


def pcm_from(data, mime):
    """(16-bit mono samples, rate). Some voice models already return a WAV file: its header and
    trailing info chunk must not be played as sound (they were heard as a burst of noise)."""
    if data[:4] == b"RIFF":
        with wave.open(io.BytesIO(data)) as file:
            frames, rate, width, channels = file.readframes(file.getnframes()), file.getframerate(), file.getsampwidth(), file.getnchannels()
        if width == 2 and channels == 2:
            frames = audioop_tomono(frames)
        return frames, rate
    rate = re.search(r"rate=(\d+)", mime or "")
    return data, int(rate.group(1)) if rate else 24000


def audioop_tomono(frames):
    samples = array.array("h", frames)
    return array.array("h", ((samples[i] + samples[i + 1]) // 2 for i in range(0, len(samples) - 1, 2))).tobytes()


def faded(pcm, rate, ms=8):
    """A few milliseconds of fade at each end, so clips start and stop without a click."""
    samples = array.array("h", pcm[: len(pcm) // 2 * 2])
    n = min(len(samples) // 2, rate * ms // 1000)
    for i in range(n):
        samples[i] = samples[i] * i // n
        samples[-1 - i] = samples[-1 - i] * i // n
    return samples.tobytes()


def to_wav(pcm, rate):
    pcm = faded(pcm, rate)
    out = io.BytesIO()
    with wave.open(out, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(pcm)
    return out.getvalue()


_spoken = OrderedDict()   # the same reply is never paid for twice


async def speak(client, types, text):
    if client is None:
        raise HTTPException(503, "Voice needs Gemini, which is not configured on the backend.")
    words = plain(text)
    if not words:
        raise HTTPException(422, "Nothing to say.")
    key = hashlib.sha256(f"{VOICE}\n{words}".encode()).hexdigest()
    if key in _spoken:
        _spoken.move_to_end(key)
        return _spoken[key]
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE))),
    )
    failure = None
    for model in SPEECH_MODELS:
        try:
            response = await asyncio.wait_for(client.aio.models.generate_content(
                model=model, contents=words, config=config,   # only the words: these models read any instruction aloud
            ), timeout=25)
            parts = response.candidates[0].content.parts if response.candidates else []
            data = next((p.inline_data for p in parts or [] if getattr(p, "inline_data", None) and p.inline_data.data), None)
            if data is None:
                raise ValueError("no audio")
            audio = to_wav(*pcm_from(data.data, data.mime_type))
            _spoken[key] = audio
            while len(_spoken) > 64:
                _spoken.popitem(last=False)
            return audio
        except Exception as error:
            failure = error
            if getattr(error, "code", None) == 402:
                break
    raise _fail(failure, "The voice")
