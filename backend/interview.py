"""
MockMate - adaptive interview endpoints (Gemini).

Wire into main.py:
    from interview import router as interview_router
    app.include_router(interview_router)

Install:
    pip install google-genai python-dotenv
"""
import json
import os
import time
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from google import genai
from google.genai import types, errors
from pydantic import BaseModel, Field

# Root .env (ai-interview-bot/.env)
_DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
_FALLBACK_MODEL = "gemini-3.5-flash-lite"

router = APIRouter(prefix="/interview", tags=["interview"])
_client: Optional[genai.Client] = None


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class Turn(BaseModel):
    question: str
    answer: str


class Signals(BaseModel):
    """Averages for the last answer, computed in the browser."""
    confidence: Optional[float] = Field(None, ge=0, le=100)
    dominant_emotion: Optional[str] = None
    filler_count: int = 0
    wpm: Optional[float] = None


class Setup(BaseModel):
    role: str = "Python developer"
    level: str = "fresher"
    interview_type: Literal["HR", "technical", "mixed"] = "mixed"


class NextRequest(Setup):
    history: List[Turn]
    signals: Optional[Signals] = None
    max_questions: int = Field(6, ge=1, le=15)


class Question(BaseModel):
    question: str
    topic: str
    difficulty: Literal["easy", "medium", "hard"]
    is_follow_up: bool


class Feedback(BaseModel):
    summary: str
    strengths: List[str]
    improvements: List[str]
    score: int = Field(ge=0, le=100)


# --------------------------------------------------------------------------- #
# Gemini helpers
# --------------------------------------------------------------------------- #
def get_client() -> genai.Client:
    global _client
    if _client is None:
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise HTTPException(500, "GEMINI_API_KEY is not configured")
        _client = genai.Client(api_key=key)
    return _client


def call_json(prompt: str, schema: type) -> dict:
    """Call Gemini, force JSON output, retry on transient errors.

    On a 404 (discontinued model) the call is retried once with _FALLBACK_MODEL.
    On 429 rate-limit errors it waits progressively longer before retrying.
    Retries up to 5 times total with exponential backoff.
    """
    model = _DEFAULT_MODEL
    last_error = None
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            t0 = time.perf_counter()
            try:
                resp = get_client().models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=schema,
                        temperature=0.8,
                    ),
                )
            except errors.ClientError as ce:
                code = getattr(ce, "code", None)
                err_str = str(ce).lower()
                if code == 404 or "not_found" in err_str:
                    print(f"[Gemini] '{model}' unavailable (404), falling back to '{_FALLBACK_MODEL}'")
                    model = _FALLBACK_MODEL
                    resp = get_client().models.generate_content(
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=schema,
                            temperature=0.8,
                        ),
                    )
                elif code == 429 or "rate" in err_str or "quota" in err_str:
                    wait = 5 * (attempt + 1)  # 5s, 10s, 15s, ...
                    print(f"[Gemini] Rate limited (attempt {attempt+1}/{max_attempts}), waiting {wait}s...")
                    last_error = ce
                    time.sleep(wait)
                    continue
                else:
                    raise
            ms = (time.perf_counter() - t0) * 1000
            print(f"[Gemini] {model} — {ms:.0f} ms")
            return json.loads(resp.text)
        except HTTPException:
            raise
        except Exception as exc:  # network error, bad JSON, unexpected...
            last_error = exc
            wait = 2.5 * (attempt + 1)
            print(f"[Gemini] Error on attempt {attempt+1}: {exc}. Retrying in {wait:.1f}s...")
            time.sleep(wait)
    raise HTTPException(503, f"Language model unavailable after {max_attempts} attempts: {last_error}")


def system_prompt(s: Setup) -> str:
    return (
        f"You are a friendly, professional interviewer for a {s.level} {s.role} position "
        f"({s.interview_type} interview).\n"
        "Rules:\n"
        "- Ask exactly ONE question at a time, in plain spoken English (it will be read aloud), under 40 words.\n"
        "- Never repeat a question or topic already covered.\n"
        "- Adapt difficulty to the candidate: if the last answer was strong and specific, go deeper or harder.\n"
        "  If it was vague, very short or wrong, ask a simpler or clarifying follow-up on the same topic.\n"
        "- If the delivery notes show low confidence or many filler words, keep a warm, encouraging tone.\n"
        "  Never mention cameras, emotions or that you are measuring anything.\n"
        "- Output JSON only."
    )


def history_text(history: List[Turn], keep: int = 6) -> str:
    turns = history[-keep:]
    return "\n".join(f"Q: {t.question}\nA: {t.answer}" for t in turns) or "(no questions yet)"


def signals_text(sig: Optional[Signals]) -> str:
    if not sig:
        return "(no delivery data)"
    parts = []
    if sig.confidence is not None:
        parts.append(f"estimated confidence {sig.confidence:.0f}/100")
    if sig.dominant_emotion:
        parts.append(f"dominant expression: {sig.dominant_emotion}")
    parts.append(f"filler words: {sig.filler_count}")
    if sig.wpm:
        parts.append(f"pace: {sig.wpm:.0f} words/min")
    return "; ".join(parts)


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.post("/start", response_model=Question)
def start(setup: Setup):
    prompt = (
        f"{system_prompt(setup)}\n\n"
        "Start the interview with a short, easy warm-up question suited to this role."
    )
    return call_json(prompt, Question)


@router.post("/next")
def next_step(req: NextRequest):
    answered = len(req.history)

    # Interview finished -> feedback report
    if answered >= req.max_questions:
        prompt = (
            f"{system_prompt(req)}\n\n"
            f"The interview is over. Full transcript:\n{history_text(req.history, keep=len(req.history))}\n\n"
            f"Delivery notes for the last answer: {signals_text(req.signals)}\n\n"
            "Write constructive feedback: a short summary, 2-4 strengths, 2-4 specific improvements, "
            "and an overall score 0-100. Treat confidence data as a rough estimate, not a judgement."
        )
        return {"done": True, "feedback": call_json(prompt, Feedback)}

    prompt = (
        f"{system_prompt(req)}\n\n"
        f"Conversation so far (most recent last):\n{history_text(req.history)}\n\n"
        f"Delivery notes for the last answer: {signals_text(req.signals)}\n"
        f"This will be question {answered + 1} of {req.max_questions}.\n\n"
        "Decide whether to follow up on the last answer or move to a new topic, "
        "then ask the next question."
    )
    return {"done": False, "question": call_json(prompt, Question)}
