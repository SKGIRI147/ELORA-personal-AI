# backend/app/qa.py
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests

router = APIRouter(prefix="/qa", tags=["qa"])

class QAIn(BaseModel):
    question: str

class QAOut(BaseModel):
    answer: str

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # optional: set in backend/.env

def wiki_answer(q: str) -> str:
    """Quick factual answer via Wikipedia if OpenAI is not configured."""
    try:
        r = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": q,
                "utf8": 1,
                "format": "json",
                "srlimit": 1,
            },
            timeout=6,
        )
        data = r.json()
        items = data.get("query", {}).get("search", [])
        if not items:
            return ""
        title = items[0]["title"]
        r2 = requests.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
            timeout=6,
        )
        j2 = r2.json()
        extract = (j2.get("extract") or "").strip()
        return extract
    except Exception:
        return ""

def openai_answer(q: str) -> str:
    """Use OpenAI if OPENAI_API_KEY is set; otherwise return empty."""
    try:
        if not OPENAI_API_KEY:
            return ""
        import openai
        openai.api_key = OPENAI_API_KEY
        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "Answer concisely and factually."},
                {"role": "user", "content": q},
            ],
            temperature=0.2,
            max_tokens=256,
        )
        return resp.choices[0].message["content"].strip()
    except Exception:
        return ""

@router.post("/ask", response_model=QAOut)
def ask(body: QAIn):
    q = (body.question or "").strip()
    if not q:
        raise HTTPException(400, "Empty question")

    # Prefer OpenAI if configured, else fallback to Wikipedia
    answer = openai_answer(q) or wiki_answer(q)
    if not answer:
        answer = "Sorry, I couldn’t find a reliable answer."
    return {"answer": answer[:1200]}
