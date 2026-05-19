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


@router.post("/chat")
def ask_project_brain(request: ChatRequest):
    """
    Existing "assistant" endpoint used by the dashboard UI.

    Behavior:
      1) Prefer the local AI service (Sprint 8) if available.
      2) Fallback to OpenAI direct (legacy) if AI service is down and OPENAI_API_KEY is set.
    """
    ai_base = os.environ.get("AI_SERVICE_URL", "http://localhost:8001").rstrip("/")

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
                json={"conversation_id": cid, "user_id": 1, "message": msg},
            )
            resp.raise_for_status()
            data = resp.json()
            return {"reply": data.get("response") or data.get("reply") or ""}
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
        return {"reply": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
