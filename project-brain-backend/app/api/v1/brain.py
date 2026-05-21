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
    # Sprint AI: optional provider override. Forwarded to the AI service.
    # When None / "auto", the AI service decides via task-aware routing.
    provider: Optional[str] = None
    strict_provider: bool = False


def _ai_base() -> str:
    return os.environ.get("AI_SERVICE_URL", "http://localhost:8001").rstrip("/")

def _ollama_base() -> str:
    return os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")

def _configured_providers() -> list[str]:
    """
    Provider order:
      1) Preferred provider (env `AI_DEFAULT_PROVIDER`) if configured
      2) Otherwise default to Groq if configured
      3) Then other configured providers
      4) Always end with Ollama (no key required)
    """
    configured: list[str] = []
    if settings.OPENAI_API_KEY:
        configured.append("openai")
    if settings.GEMINI_API_KEY:
        configured.append("gemini")
    if settings.GROQ_API_KEY:
        configured.append("groq")

    preferred = (os.environ.get("AI_DEFAULT_PROVIDER") or settings.AI_DEFAULT_PROVIDER or "").strip().lower()
    order: list[str] = []

    if preferred in configured:
        order.append(preferred)
    elif "groq" in configured:
        order.append("groq")

    for p in configured:
        if p not in order:
            order.append(p)

    order.append("ollama")
    return order

def _system_prompt(context: Any) -> str:
    return (
        "You are 'Project Brain', an AI assistant for a construction management system. "
        f"Current Screen Context: {context}. Keep your answer concise and directly related."
    )

def _call_openai(message: str, context: Any) -> dict:
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not set.")
    from openai import OpenAI

    model = os.environ.get("OPENAI_MODEL", "") or "gpt-4o-mini"
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": _system_prompt(context)}, {"role": "user", "content": message}],
    )
    return {"reply": response.choices[0].message.content, "provider": "openai", "model": model, "degraded": True}

def _call_gemini(message: str, context: Any) -> dict:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY is not set.")
    model = os.environ.get("GEMINI_MODEL", "") or "gemini-2.0-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={settings.GEMINI_API_KEY}"
    )
    payload = {"contents": [{"parts": [{"text": f"{_system_prompt(context)}\n\nUser:\n{message}"}]}]}
    with httpx.Client(timeout=60.0) as client:
        r = client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    text = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    return {"reply": text, "provider": "gemini", "model": model, "degraded": True}

def _call_groq(message: str, context: Any) -> dict:
    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is not set.")
    from openai import OpenAI

    model = os.environ.get("GROQ_MODEL", "") or "llama-3.1-8b-instant"
    client = OpenAI(api_key=settings.GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": _system_prompt(context)}, {"role": "user", "content": message}],
    )
    return {"reply": response.choices[0].message.content, "provider": "groq", "model": model, "degraded": True}

def _call_ollama(message: str, context: Any) -> dict:
    model = os.environ.get("OLLAMA_MODEL", "") or "llama3.1:8b"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _system_prompt(context)},
            {"role": "user", "content": message},
        ],
        "stream": False,
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.post(f"{_ollama_base()}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
    reply = (data.get("message") or {}).get("content") or ""
    return {"reply": reply, "provider": "ollama", "model": model, "degraded": True}


@router.get("/providers")
def list_providers():
    """Proxy to the AI service's /ai/providers so the web UI can hit
    a single origin (the main backend) for everything.

    Returns the same shape the AI service does. If the AI service is down,
    falls back to a tiny static descriptor so the UI dropdown still shows.
    """
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{_ai_base()}/ai/providers")
            r.raise_for_status()
            data = r.json() or {}
            # Ensure UI can select providers that are configured directly on the backend
            # even if the separate AI service doesn't advertise them.
            backend_order = _configured_providers()
            available = list(dict.fromkeys((data.get("available") or []) + [p for p in backend_order if p != "ollama"]))
            if "ollama" not in available:
                available.append("ollama")
            # Prefer backend default (e.g. Groq) over AI service's default (often Ollama).
            default = next((p for p in backend_order if p != "ollama"), None) or data.get("default") or (available[0] if available else None)
            data["available"] = available
            data["default"] = default
            data["configured_default"] = default
            return data
    except Exception as e:
        # AI service unreachable — return a degraded but usable list. The UI
        # falls back to direct-OpenAI in that case (see ask_project_brain).
        available = [p for p in _configured_providers() if p != "ollama"] + ["ollama"]
        default = available[0] if available else None
        return {
            "available": available,
            "default": default,
            "configured_default": default,
            "all_known": ["openai", "gemini", "groq", "ollama"],
            "degraded": True,
            "reason": f"AI service unreachable ({type(e).__name__})",
        }


@router.post("/chat")
def ask_project_brain(request: ChatRequest):
    """
    Existing "assistant" endpoint used by the dashboard UI.

    Behavior:
      1) Prefer the local AI service (Sprint 8) if available.
         Forwards `provider` and `strict_provider` if the caller set them.
      2) Fallback to OpenAI direct (legacy) if AI service is down and
         OPENAI_API_KEY is set.
    """
    ai_base = _ai_base()

    # --- 1) Try AI service ---
    try:
        with httpx.Client(timeout=60.0) as client:
            # Stateless: new conversation per request (dashboard chat is lightweight).
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
            # Pass through provider/model metadata so the UI can show "answered by Gemini"
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

    # --- 2) Fallback chain (OpenAI -> Gemini -> Groq -> Ollama) ---
    # If the caller explicitly requested a provider with strict_provider=True, do not fall back.
    if request.provider and request.strict_provider:
        p = request.provider.strip().lower()
        try:
            if p == "openai":
                return _call_openai(request.message, request.context)
            if p == "gemini":
                return _call_gemini(request.message, request.context)
            if p == "groq":
                return _call_groq(request.message, request.context)
            if p == "ollama":
                return _call_ollama(request.message, request.context)
            raise HTTPException(status_code=400, detail=f"Unknown provider: {request.provider}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    errors: list[str] = []
    for provider in _configured_providers():
        try:
            if provider == "openai":
                return _call_openai(request.message, request.context)
            if provider == "gemini":
                return _call_gemini(request.message, request.context)
            if provider == "groq":
                return _call_groq(request.message, request.context)
            if provider == "ollama":
                return _call_ollama(request.message, request.context)
        except Exception as e:
            errors.append(f"{provider}: {type(e).__name__}: {str(e)}")

    raise HTTPException(status_code=503, detail="All AI providers failed: " + " | ".join(errors))
