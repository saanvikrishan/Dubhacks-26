import asyncio
import json
import os

from backboard import BackboardClient
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai

load_dotenv()

app = FastAPI(title="FridgeMate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

backboard_key = os.getenv("BACKBOARD_API_KEY")
backboard_client = BackboardClient(api_key=backboard_key) if backboard_key else None
_assistant_id = None
DEMO_ASSISTANT_NAME = "FridgeMate demo"


class RecipeRequest(BaseModel):
    ingredients: list[str]
    diet: str = "Anything"
    time: int = 30


class PreferenceRequest(BaseModel):
    content: str
    metadata: dict | None = None


@app.get("/")
def home():
    return {"message": "FridgeMate API is running!"}


async def get_assistant_id():
    global _assistant_id
    if backboard_client is None:
        return None
    if _assistant_id:
        return _assistant_id

    env_id = os.getenv("BACKBOARD_ASSISTANT_ID")
    if env_id:
        _assistant_id = env_id
        return _assistant_id

    try:
        matches = await backboard_client.list_assistants(name=DEMO_ASSISTANT_NAME)
        if matches:
            _assistant_id = str(matches[0].assistant_id)
            return _assistant_id
        created = await backboard_client.create_assistant(name=DEMO_ASSISTANT_NAME)
        _assistant_id = str(created.assistant_id)
        return _assistant_id
    except Exception as e:
        print("Backboard error:", str(e))
        return None


def require_backboard_client():
    if backboard_client is None:
        raise HTTPException(
            status_code=500,
            detail="BACKBOARD_API_KEY is missing from backend/.env",
        )


@app.post("/preferences")
async def store_preference(request: PreferenceRequest):
    require_backboard_client()
    assistant_id = await get_assistant_id()
    if not assistant_id:
        raise HTTPException(
            status_code=502,
            detail="Preference storage failed. Check the backend terminal.",
        )
    try:
        return await backboard_client.add_memory(
            assistant_id,
            request.content,
            metadata=request.metadata,
        )
    except Exception as e:
        print("Backboard error:", str(e))
        raise HTTPException(
            status_code=502,
            detail="Preference storage failed. Check the backend terminal.",
        )


@app.get("/preferences")
async def list_preferences():
    require_backboard_client()
    assistant_id = await get_assistant_id()
    if not assistant_id:
        raise HTTPException(
            status_code=502,
            detail="Preference lookup failed. Check the backend terminal.",
        )
    try:
        memories = await backboard_client.get_memories(assistant_id)
        return memories.model_dump()
    except Exception as e:
        print("Backboard error:", str(e))
        raise HTTPException(
            status_code=502,
            detail="Preference lookup failed. Check the backend terminal.",
        )


def memory_contents(result):
    contents = []
    memories = result.get("memories") if isinstance(result, dict) else []
    for memory in memories or []:
        content = memory.get("content") if isinstance(memory, dict) else None
        if content:
            contents.append(content)
    return contents


@app.post("/recipes")
async def generate_recipes(request: RecipeRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env",
        )

    ingredients = ", ".join(request.ingredients)
    known_preferences = ""
    if backboard_client is not None:
        assistant_id = await get_assistant_id()
        if assistant_id:
            query = (
                f"ingredients: {ingredients}; "
                f"diet: {request.diet}; "
                f"time: {request.time} minutes"
            )
            try:
                found = await backboard_client.search_memories(
                    assistant_id,
                    query,
                    limit=5,
                )
                facts = memory_contents(found)
                if facts:
                    known_preferences = "\n".join(f"- {fact}" for fact in facts)
            except Exception as e:
                print("Backboard error:", str(e))

    prompt = f"""
    You are FridgeMate, a practical cooking assistant for college students.

    Available ingredients: {ingredients}
    Dietary preference: {request.diet}
    Maximum cooking time: {request.time} minutes
    """
    if known_preferences:
        prompt += f"""
    Known preferences:
    {known_preferences}
    Follow these preferences. Do not suggest food that conflicts with them.
    """
    prompt += """
    Suggest 3 realistic recipes using these ingredients.
    Prioritize using ingredients that might otherwise go to waste.
    Keep recipes affordable, beginner-friendly, and healthy.
    Mention any extra ingredients needed rather than pretending
    the user already has them.

    Return valid JSON only, in this format:
    {
      "recipes": [
        {
          "name": "Recipe name",
          "description": "Short description",
          "time": 20,
          "ingredients": ["ingredient 1", "ingredient 2"],
          "steps": ["Step 1", "Step 2"],
          "nutrition_note": "Brief, cautious nutrition note"
        }
      ]
    }
    """

    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-3.8-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        return json.loads(response.text)

    except Exception as e:
        print("Gemini error:", str(e))
        raise HTTPException(
            status_code=502,
            detail="Recipe generation failed. Check the backend terminal.",
        )
