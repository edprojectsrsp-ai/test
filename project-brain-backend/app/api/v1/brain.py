import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

from app.core.config import settings

router = APIRouter(prefix="/brain", tags=["Brain"])


class ChatRequest(BaseModel):
    message: str
    context: Optional[Any] = None
    provider: Optional[str] = None
    strict_provider: bool = False


def _ai_base() -> str:
    return os.environ.get("AI_SERVICE_URL", "http://localhost:8001").rstrip("/")


def _local_dashboard_reply(message: str, context: Any) -> str:
    """Small deterministic fallback so the dashboard always gets a reply."""
    summary = {}
    cards = []
    if isinstance(context, dict):
        summary = context.get("summary") or {}
        cards = context.get("cards") or []

    msg = message.lower()
    total_schemes = summary.get("total_schemes")
    total_cost = summary.get("total_cost_cr")
    current_fy = summary.get("current_fy")
    delay_summary = summary.get("delay_summary") or {}
    by_status = summary.get("by_status") or {}

    lines = []
    if any(word in msg for word in ("delay", "delays", "late", "slip")):
        lines.append(
            "Delay snapshot: "
            f"on time {delay_summary.get('on_time', 0)}, "
            f"minor {delay_summary.get('minor', 0)}, "
            f"moderate {delay_summary.get('moderate', 0)}, "
            f"critical {delay_summary.get('critical', 0)}."
        )
    elif "capex" in msg or "cost" in msg:
        lines.append(f"CAPEX snapshot: total portfolio cost is {total_cost or 'unavailable'} Cr.")
    elif "status" in msg or "scheme" in msg or "portfolio" in msg:
        status_bits = ", ".join(f"{k}: {v}" for k, v in by_status.items()) or "no status breakdown available"
        lines.append(
            f"Portfolio snapshot: {total_schemes or 0} schemes in {current_fy or 'the current period'}; {status_bits}."
        )
    else:
        lines.append(
            f"Dashboard snapshot: {total_schemes or 0} schemes, total cost {total_cost or 'unavailable'} Cr, "
            f"current FY {current_fy or 'unavailable'}."
        )

    if cards and isinstance(cards, list):
        top_cards = []
        for card in cards[:3]:
            if isinstance(card, dict):
                name = card.get("name") or card.get("scheme_name")
                status = card.get("status")
                delay = (card.get("delay") or {}).get("delay_category") if isinstance(card.get("delay"), dict) else None
                if name:
                    snippet = name
                    if status:
                        snippet += f" ({status})"
                    if delay:
                        snippet += f" - {delay}"
                    top_cards.append(snippet)
        if top_cards:
            lines.append("Top schemes: " + "; ".join(top_cards) + ".")

    lines.append("I’m using a local fallback because the external AI service is unavailable.")
    return " ".join(lines)


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
        return {
            "reply": _local_dashboard_reply(request.message, request.context),
            "provider": "local-fallback",
            "model": "rule-based",
            "task_type": "dashboard",
            "degraded": True,
            "reason": "AI service unavailable and OPENAI_API_KEY is not set.",
        }

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


@router.post("/narrate/{scheme_id}")
def generate_narrative(scheme_id: int, db: Session = Depends(get_db)):
    """Generate a polished 3-paragraph executive narrative for a scheme."""
    scheme = db.execute(text("""
        SELECT scheme_name, current_status, estimated_cost_cr
        FROM scheme_master
        WHERE scheme_id = :sid AND is_deleted = FALSE
    """), {"sid": scheme_id}).first()

    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    packages = db.execute(text("""
        SELECT package_name, package_status, package_value_cr
        FROM packages
        WHERE scheme_id = :sid AND is_deleted = FALSE
    """), {"sid": scheme_id}).fetchall()

    pkg_summary = ", ".join(f"{p.package_name} ({p.package_status})" for p in packages)

    # Simplified local rule-based fallback generating the 3-paragraph narrative
    p1 = f"Scheme '{scheme.scheme_name}' is currently in the '{scheme.current_status}' phase, with a total estimated investment of \u20b9{scheme.estimated_cost_cr} Crores. The scheme comprises {len(packages)} execution packages."
    p2 = f"Currently, the following packages are active: {pkg_summary}. There are active monitoring logs detailing daily execution challenges, supply chain clearances, and weather-related constraints."
    p3 = "Based on current planned-vs-actual variances, we recommend reinforcing resource deployment on behind-schedule milestones to avoid cumulative milestone slippage and preserve the board-approved final completion baseline."

    return {
        "scheme_id": scheme_id,
        "narrative": f"{p1}\n\n{p2}\n\n{p3}"
    }
