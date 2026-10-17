
import os

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


class RecipeRequest(BaseModel):
    ingredients: list[str]
    diet: str = "Anything"
    time: int = 30


@app.get("/")
def home():
    return {"message": "FridgeMate API is running!"}


@app.post("/recipes")
def generate_recipes(request: RecipeRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing from backend/.env",
        )

    ingredients = ", ".join(request.ingredients)

    prompt = f"""
    You are FridgeMate, a practical cooking assistant for college students.

    Available ingredients: {ingredients}
    Dietary preference: {request.diet}
    Maximum cooking time: {request.time} minutes

    Suggest 3 realistic recipes using these ingredients.
    Prioritize using ingredients that might otherwise go to waste.
    Keep recipes affordable, beginner-friendly, and healthy.
    Mention any extra ingredients needed rather than pretending
    the user already has them.

    Return valid JSON only, in this format:
    {{
      "recipes": [
        {{
          "name": "Recipe name",
          "description": "Short description",
          "time": 20,
          "ingredients": ["ingredient 1", "ingredient 2"],
          "steps": ["Step 1", "Step 2"],
          "nutrition_note": "Brief, cautious nutrition note"
        }}
      ]
    }}
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        import json
        result = json.loads(response.text)
        return result

    except Exception as e:
        print("Gemini error:", str(e))
        raise HTTPException(
            status_code=502,
            detail="Recipe generation failed. Check the backend terminal.",
        )
