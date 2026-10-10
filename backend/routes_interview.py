import os
import re
import json
import time
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any, Literal
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai import errors

# Load .env from workspace root
ROOT_DIR = Path(__file__).resolve().parent.parent
DOTENV_PATH = ROOT_DIR / ".env"
load_dotenv(dotenv_path=DOTENV_PATH)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

router = APIRouter(prefix="/interview", tags=["interview"])


# ── Pydantic Request & Response Models ───────────────────────────────────────

class InterviewStartRequest(BaseModel):
    role: str = Field(..., description="Target job role, e.g., 'Frontend Developer', 'Data Scientist'")
    level: str = Field(..., description="Candidate level, e.g., 'Junior', 'Mid-Level', 'Senior', 'Intern'")
    type: Literal["HR", "technical"] = Field(..., description="Interview type: HR or technical")
    language: Literal["en", "ml-en"] = Field(default="en", description="Preferred language mode: English (en) or Malayalam-English mixed (ml-en)")
    resumeText: Optional[str] = Field(default=None, description="Optional parsed resume text or summary")


class NextQuestion(BaseModel):
    question: str
    difficulty: str  # e.g., 'easy', 'medium', 'hard'
    topic: str


class InterviewStartResponse(BaseModel):
    question: str
    difficulty: str
    topic: str


class InterviewEvaluateRequest(BaseModel):
    history: List[dict] = Field(default_factory=list, description="Recent conversation turns (last 6-8)")
    answer: str = Field(..., description="Candidate's latest answer")
    emotionSummary: Optional[dict] = Field(default=None, description="Optional free-form facial emotion summary dict")
    speechStats: Optional[dict] = Field(default=None, description="Optional free-form speech statistics dict")


class InterviewEvaluateResponse(BaseModel):
    feedback: str = Field(..., description="Constructive evaluation feedback on the candidate's answer")
    score: float = Field(..., ge=0.0, le=10.0, description="Evaluation score on a scale of 0 to 10 (0-10)")
    nextQuestion: NextQuestion = Field(..., description="Adaptive next question based on answer quality")


class InterviewReportRequest(BaseModel):
    fullHistory: List[dict] = Field(default_factory=list, description="All interview conversation turns")
    perAnswerStats: Optional[List[dict]] = Field(default=None, description="Optional list of free-form per-answer metric dicts")
    emotionSummaries: Optional[List[dict]] = Field(default=None, description="Optional list of free-form emotion summary dicts")


class InterviewReportResponse(BaseModel):
    overallScore: float = Field(..., ge=0.0, le=100.0, description="Overall interview score on a scale of 0 to 100 (0-100)")
    strengths: List[str] = Field(..., description="List of 3-5 key candidate strengths with supporting evidence")
    improvements: List[str] = Field(..., description="List of 3-5 actionable areas for improvement")
    perAnswer: List[dict] = Field(..., description="Per-answer breakdown summarizing each turn with score (0-10) and feedback")


# ── Helper: Safe Gemini Calling with Rate Limit Backoff & JSON Parsing ───────

def _get_gemini_client() -> genai.Client:
    key = os.getenv("GEMINI_API_KEY")
    if not key or not key.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY is not configured on the server."
        )
    return genai.Client(api_key=key.strip())


def _clean_json_text(raw_text: str) -> str:
    """Strip markdown code block fences and trailing noise."""
    if not raw_text:
        return ""
    text = raw_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


async def generate_gemini_json(
    prompt: str,
    system_instruction: str,
    max_retries: int = 3,
    base_backoff_seconds: float = 1.5
) -> Dict[str, Any]:
    """
    Executes a Gemini generation call requesting structured JSON output.
    Logs latency to the console.
    Retries with exponential backoff on HTTP 429 / resource exhaustion.
    """
    client = _get_gemini_client()
    target_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        response_mime_type="application/json",
        temperature=0.7,
    )

    last_error = None
    for attempt in range(max_retries):
        try:
            start_time = time.perf_counter()

            # Execute generation; handle possible 404 for discontinued legacy default model
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=target_model,
                    contents=prompt,
                    config=config
                )
            except errors.ClientError as ce:
                # If target model is deprecated / 404 not found, fallback to gemini-3.8-flash
                if getattr(ce, "code", None) == 404 or "not available" in str(ce).lower():
                    fallback_model = "gemini-3.8-flash"
                    print(f"[Gemini] Model '{target_model}' returned 404/unavailable. Falling back to '{fallback_model}'.")
                    target_model = fallback_model
                    response = await asyncio.to_thread(
                        client.models.generate_content,
                        model=target_model,
                        contents=prompt,
                        config=config
                    )
                else:
                    raise

            duration = time.perf_counter() - start_time
            print(f"[Gemini] Call to '{target_model}' completed in {duration:.2f}s ({duration * 1000:.0f}ms)")

            raw_text = response.text or ""
            cleaned = _clean_json_text(raw_text)

            try:
                data = json.loads(cleaned)
                return data
            except json.JSONDecodeError as json_err:
                match = re.search(r"(\{.*\})", cleaned, re.DOTALL)
                if match:
                    try:
                        return json.loads(match.group(1))
                    except Exception:
                        pass
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Gemini returned invalid JSON: {cleaned[:200]}"
                ) from json_err

        except errors.APIError as api_err:
            last_error = api_err
            status_code = getattr(api_err, "code", None)
            err_msg = str(api_err)

            is_rate_limited = (
                status_code in (429, 503) or
                "RESOURCE_EXHAUSTED" in err_msg or
                "rate limit" in err_msg.lower() or
                "quota" in err_msg.lower()
            )

            if is_rate_limited and attempt < max_retries - 1:
                sleep_duration = base_backoff_seconds * (2 ** attempt)
                print(f"[Gemini] Rate limit encountered. Retrying in {sleep_duration:.1f}s (attempt {attempt + 1}/{max_retries})...")
                await asyncio.sleep(sleep_duration)
                continue

            if is_rate_limited:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="AI service rate limit exceeded. Please wait a moment and try again."
                ) from api_err

            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"AI service error ({status_code or 'API'}): {err_msg[:250]}"
            ) from api_err

        except HTTPException:
            raise
        except Exception as general_err:
            last_error = general_err
            if attempt < max_retries - 1:
                sleep_duration = base_backoff_seconds * (2 ** attempt)
                await asyncio.sleep(sleep_duration)
                continue
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unexpected error communicating with AI service: {str(general_err)[:250]}"
            ) from general_err

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Failed to generate response after {max_retries} attempts: {str(last_error)[:200]}"
    )


# ── System Prompts ───────────────────────────────────────────────────────────

COMMON_CANDIDATE_UNDERSTANDING_RULE = """
Candidate Language & Cultural Understanding Rule:
- The candidate may speak or respond in English or mixed Malayalam-English ("Manglish" code-switching, where Malayalam words/syntax are transcribed in English script alongside technical terms, e.g. "Njan ee project FastAPI vachu build cheythu", "Enikku indexing patti ariyilla", "State management cheyyan Redux use cheythittund").
- You MUST fully comprehend both standard English and Malayalam-English mixed answers.
- Extract the candidate's actual technical knowledge, reasoning, and depth without penalizing them for linguistic switching or non-native phrasing.
- All output questions and feedback MUST be generated in simple, natural, professional English. Never output questions in Malayalam script.
"""

START_INTERVIEW_SYSTEM_PROMPT = f"""You are MockMate's expert AI Interviewer.
Your role is to formulate the initial interview question for a candidate.

{COMMON_CANDIDATE_UNDERSTANDING_RULE}

Guidelines:
1. Do NOT use canned or hardcoded questions (like "Tell me about yourself").
2. Tailor the opening question strictly to the candidate's role, seniority level, interview type (HR vs technical), and resume text (if provided).
3. If resume text is given, pick an authentic hook or project from their background.
4. Keep the question crisp, engaging, and in simple professional English.
5. Provide the difficulty level ('easy', 'medium', or 'hard') and the specific topic.

Response format: Return ONLY a valid JSON object matching:
{{
  "question": "string",
  "difficulty": "easy" | "medium" | "hard",
  "topic": "string"
}}
"""

EVALUATE_SYSTEM_PROMPT = f"""You are MockMate's real-time AI Interview Evaluator and Interviewer.
You evaluate the candidate's answer and determine the next question in the interview.

{COMMON_CANDIDATE_UNDERSTANDING_RULE}

Evaluation Guidelines:
1. Score the answer objectively on a scale of 0.0 to 10.0 (where 0 is poor/unresponsive and 10 is outstanding) based on correctness, depth, problem-solving, and communication clarity.
2. Provide concise, constructive feedback (2-3 sentences) highlighting what was good and any missing details or inaccuracies.
3. If emotionSummary or speechStats are provided, factor them into the communication assessment (e.g. high stress/nervousness, poise, pace).
4. Adaptive Follow-Up Question Logic:
   - If the candidate's answer was WEAK, vague, or had significant misconceptions: Ask a targeted follow-up question to test fundamentals or give them an opportunity to clarify.
   - If the candidate's answer was INTERESTING, advanced, or mentioned an intriguing detail/tradeoff: Ask a deeper follow-up delving into that exact design decision.
   - If the answer was COMPLETE, solid, and standard: Progress naturally to a new topic or the next difficulty stage for their role.
5. Always keep the next question concise and in simple English. Never repeat questions from the history.

Response format: Return ONLY a valid JSON object matching:
{{
  "feedback": "string",
  "score": number (0.0 to 10.0),
  "nextQuestion": {{
    "question": "string",
    "difficulty": "easy" | "medium" | "hard",
    "topic": "string"
  }}
}}
"""

REPORT_SYSTEM_PROMPT = f"""You are MockMate's comprehensive AI Interview Report Generator.
Analyze the complete interview transcript, per-answer scores, and emotion aggregates to generate a final performance report.

{COMMON_CANDIDATE_UNDERSTANDING_RULE}

Reporting Guidelines:
1. Calculate a realistic overallScore from 0.0 to 100.0 reflecting cumulative performance.
2. List 3 to 5 key candidate strengths with specific evidence from their answers.
3. List 3 to 5 clear, actionable areas for improvement.
4. Provide a perAnswer list summarizing each turn with question, answer, score (0.0 to 10.0), topic, and brief feedback.

Response format: Return ONLY a valid JSON object matching:
{{
  "overallScore": number (0.0 to 100.0),
  "strengths": ["string", ...],
  "improvements": ["string", ...],
  "perAnswer": [
    {{
      "question": "string",
      "answer": "string",
      "score": number,
      "feedback": "string",
      "topic": "string"
    }},
    ...
  ]
}}
"""


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/start", response_model=InterviewStartResponse)
async def start_interview(payload: InterviewStartRequest):
    """
    POST /interview/start
    Generates a tailored opening question for the specified role, level, type, and resume.
    """
    prompt = f"""Generate an opening interview question with the following context:
- Role: {payload.role}
- Experience Level: {payload.level}
- Interview Type: {payload.type}
- Candidate Language Mode: {payload.language}
- Resume / Background: {payload.resumeText if payload.resumeText else 'None provided'}

Formulate an authentic, non-generic opening question for this candidate.
"""
    result = await generate_gemini_json(
        prompt=prompt,
        system_instruction=START_INTERVIEW_SYSTEM_PROMPT
    )

    question = result.get("question")
    if not question:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI did not generate a question in the response."
        )

    return InterviewStartResponse(
        question=str(question),
        difficulty=str(result.get("difficulty", "medium")),
        topic=str(result.get("topic", payload.type))
    )


@router.post("/evaluate", response_model=InterviewEvaluateResponse)
async def evaluate_answer(payload: InterviewEvaluateRequest):
    """
    POST /interview/evaluate
    Evaluates the candidate's latest answer, giving a score (scale 0-10) and feedback,
    along with an adaptive next question (asking a follow-up if weak or interesting).
    Mention emotionSummary and speechStats to Gemini only if present.
    """
    recent_history_text = json.dumps(payload.history[-8:], indent=2) if payload.history else "[]"

    # Only include optional stats in prompt if present
    extra_context = []
    if payload.emotionSummary:
        extra_context.append(f"Observed Facial Emotion Summary during this answer:\n{json.dumps(payload.emotionSummary, indent=2)}")
    if payload.speechStats:
        extra_context.append(f"Observed Speech Stats:\n{json.dumps(payload.speechStats, indent=2)}")

    extra_context_str = ("\n\n" + "\n\n".join(extra_context)) if extra_context else ""

    prompt = f"""Evaluate this interview turn:
Recent Conversation History (last 6-8 turns):
{recent_history_text}

Candidate's Latest Answer:
"{payload.answer}"{extra_context_str}

Evaluate this answer on a scale of 0 to 10. If weak or interesting, formulate a targeted follow-up; otherwise progress to the next topic.
"""
    result = await generate_gemini_json(
        prompt=prompt,
        system_instruction=EVALUATE_SYSTEM_PROMPT
    )

    feedback = result.get("feedback", "Good effort.")
    score = float(result.get("score", 5.0))
    # Clamp score to [0, 10]
    score = max(0.0, min(10.0, score))

    next_q_data = result.get("nextQuestion") or {}
    next_question = NextQuestion(
        question=str(next_q_data.get("question", "Could you elaborate more on your previous experience?")),
        difficulty=str(next_q_data.get("difficulty", "medium")),
        topic=str(next_q_data.get("topic", "General"))
    )

    return InterviewEvaluateResponse(
        feedback=str(feedback),
        score=score,
        nextQuestion=next_question
    )


@router.post("/report", response_model=InterviewReportResponse)
async def generate_report(payload: InterviewReportRequest):
    """
    POST /interview/report
    Generates an end-of-interview report with overall score (scale 0-100), strengths,
    improvements, and per-answer review. Mention optional stats only if present.
    """
    history_text = json.dumps(payload.fullHistory, indent=2) if payload.fullHistory else "[]"

    extra_report_context = []
    if payload.perAnswerStats:
        extra_report_context.append(f"Per Answer Stats:\n{json.dumps(payload.perAnswerStats, indent=2)}")
    if payload.emotionSummaries:
        extra_report_context.append(f"Session Emotion Analytics:\n{json.dumps(payload.emotionSummaries, indent=2)}")

    extra_report_str = ("\n\n" + "\n\n".join(extra_report_context)) if extra_report_context else ""

    prompt = f"""Generate a comprehensive interview performance report based on the full session data:
Full History:
{history_text}{extra_report_str}

Produce the final overallScore on a scale of 0 to 100, strengths, areas for improvement, and per-answer reviews.
"""
    result = await generate_gemini_json(
        prompt=prompt,
        system_instruction=REPORT_SYSTEM_PROMPT
    )

    overall_score = float(result.get("overallScore", 70.0))
    overall_score = max(0.0, min(100.0, overall_score))
    strengths = result.get("strengths") or []
    improvements = result.get("improvements") or []
    per_answer = result.get("perAnswer") or []

    return InterviewReportResponse(
        overallScore=overall_score,
        strengths=[str(s) for s in strengths],
        improvements=[str(i) for i in improvements],
        perAnswer=per_answer
    )
