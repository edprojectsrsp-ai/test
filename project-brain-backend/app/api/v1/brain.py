import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/brain", tags=["Brain"])


class ChatRequest(BaseModel):
    message: str
    context: Optional[Any] = None
    provider: Optional[str] = None
    strict_provider: bool = False


def _ai_base() -> str:
    return os.environ.get("AI_SERVICE_URL", "http://localhost:8001").rstrip("/")


@router.get("/providers")
def list_providers():
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{_ai_base()}/ai/providers")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        if settings.OPENAI_API_KEY:
            return {
                "available": ["openai"],
                "default": "openai",
                "configured_default": "openai",
                "all_known": ["openai", "gemini", "groq", "ollama"],
                "degraded": True,
                "reason": f"AI service unreachable ({type(e).__name__})",
            }
        return {
            "available": [],
            "default": None,
            "configured_default": "openai",
            "all_known": ["openai", "gemini", "groq", "ollama"],
            "degraded": True,
            "reason": f"AI service unreachable ({type(e).__name__}) and OPENAI_API_KEY not set",
        }


@router.post("/chat")
def ask_project_brain(request: ChatRequest):
    """
    Existing "assistant" endpoint used by the dashboard UI.

    Behavior:
      1) Prefer the local AI service (Sprint 8) if available.
         Forwards `provider` and `strict_provider` if the caller set them.
      2) Fallback to OpenAI direct (legacy) if AI service is down and OPENAI_API_KEY is set.
    """
    ai_base = _ai_base()

    # --- 1) Try AI service ---
    try:
        with httpx.Client(timeout=60.0) as client:
            # Keep it stateless here: new conversation per request (dashboard is lightweight).
            cid = client.post(
                f"{ai_base}/ai/conversations/start",
                json={"user_id": 1, "source": "backend"},
            ).json()["conversation_id"]

            # Push context into the message so the orchestrator can use it.
            msg = request.message
            if request.context is not None:
                msg = f"Context:\n{request.context}\n\nUser:\n{request.message}"

            resp = client.post(
                f"{ai_base}/ai/chat",
                json={
                    "conversation_id": cid,
                    "user_id": 1,
                    "message": msg,
                    "provider": request.provider,
                    "strict_provider": request.strict_provider,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "reply": data.get("response") or data.get("reply") or "",
                "provider": data.get("provider"),
                "model": data.get("model"),
                "task_type": data.get("task_type"),
                "tokens_used": data.get("tokens_used"),
                "cost_usd": data.get("cost_usd"),
            }
    except Exception:
        pass

    # --- 2) Fallback to OpenAI direct ---
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI service is unavailable and OPENAI_API_KEY is not set.",
        )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are 'Project Brain', an AI assistant for a construction management system. "
                        f"Current Screen Context: {request.context}. Keep your answer concise and directly related."
                    ),
                },
                {"role": "user", "content": request.message},
            ],
        )
        return {
            "reply": response.choices[0].message.content,
            "provider": "openai",
            "model": "gpt-4o-mini",
            "task_type": None,
            "degraded": True,
            "reason": "AI service unreachable; used OpenAI direct.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
