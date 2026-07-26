"""
Task-aware router. Picks the right provider for each query type.

Routing logic:
  1. Quick heuristic classification (keyword-based) — sub-millisecond, free
  2. If ambiguous → Groq classifies in ~300ms
  3. Route to the best provider for that task type
  4. On failure, fall through to next provider in the chain

When `forced_provider` is passed, classification + routing chain are bypassed
and the call goes to that provider only. If that one fails, we still walk a
small fallback chain ([forced, ollama]) so a single API hiccup doesn't lose
the request entirely — set `strict_forced=True` to disable even that.
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Optional

import psycopg2
import psycopg2.extras

from .base import ChatMessage, ChatResponse, LLMProvider
from .gemini_provider import GeminiProvider
from .groq_provider import GroqProvider
from .ollama_provider import OllamaProvider
from .openai_provider import OpenAIProvider
from .cerebras_provider import CerebrasProvider
from .openrouter_provider import OpenRouterProvider

logger = logging.getLogger(__name__)

# Task type → ordered list of providers to try
# Priority: fastest free cloud first, then fallbacks
ROUTING_TABLE = {
    "classify": ["groq", "cerebras", "ollama"],
    "lookup":   ["groq", "cerebras", "gemini", "openrouter", "openai", "ollama"],
    "analysis": ["gemini", "cerebras", "groq", "openrouter", "openai", "ollama"],
    "report":   ["gemini", "openai", "cerebras", "openrouter", "ollama"],
    "rag":      ["gemini", "openai", "openrouter", "ollama"],
    "fallback": ["ollama"],
}

VALID_PROVIDERS = {"groq", "gemini", "openai", "ollama", "cerebras", "openrouter"}

# Default user-facing pick when no override is set. Configurable via env.
DEFAULT_PROVIDER = os.environ.get("AI_DEFAULT_PROVIDER", "openai").lower()
SETTINGS_REFRESH_SECONDS = int(os.environ.get("AI_SETTINGS_REFRESH_SECONDS", "30") or 30)

PROVIDER_SETTINGS = {
    "groq": {
        "env": "GROQ_API_KEY",
        "key": "ai_provider_groq_api_key",
        "enabled": "ai_provider_groq_enabled",
        "model": "ai_provider_groq_model",
        "default_model": "llama-3.3-70b-versatile",
    },
    "gemini": {
        "env": "GEMINI_API_KEY",
        "alt_env": "GOOGLE_API_KEY",
        "key": "ai_provider_gemini_api_key",
        "enabled": "ai_provider_gemini_enabled",
        "model": "ai_provider_gemini_model",
        "default_model": "gemini-2.5-flash",
    },
    "openai": {
        "env": "OPENAI_API_KEY",
        "key": "ai_provider_openai_api_key",
        "enabled": "ai_provider_openai_enabled",
        "model": "ai_provider_openai_model",
        "default_model": "gpt-4.1-mini",
    },
    "cerebras": {
        "env": "CEREBRAS_API_KEY",
        "key": "ai_provider_cerebras_api_key",
        "enabled": "ai_provider_cerebras_enabled",
        "model": "ai_provider_cerebras_model",
        "default_model": "llama-3.3-70b",
    },
    "openrouter": {
        "env": "OPENROUTER_API_KEY",
        "key": "ai_provider_openrouter_api_key",
        "enabled": "ai_provider_openrouter_enabled",
        "model": "ai_provider_openrouter_model",
        "default_model": "qwen/qwen-2.5-72b-instruct:free",
    },
}

# Heuristic patterns that strongly imply a task type
LOOKUP_PATTERNS = [
    r"\bwhat (is|was|are) the\b",
    r"\bwhen (was|did|is)\b",
    r"\bwho (is|was)\b",
    r"\blist( all| me)?\b",
    r"\bshow me\b",
    r"\bcurrent (status|cost|date)\b",
    r"\bhow many\b",
]
ANALYSIS_PATTERNS = [
    r"\bwhy\b",
    r"\banalyz",
    r"\bcompar",
    r"\bvariance\b",
    r"\bforecast\b",
    r"\brisk\b",
    r"\bidentify\b",
    r"\bexplain\b",
    r"\bdelayed\b",
    r"\bdelay\b",
    r"\bimpact\b",
    r"\bbottleneck\b",
]
REPORT_PATTERNS = [
    r"\bdraft\b",
    r"\bwrite (a|me|up)\b",
    r"\bgenerate (a |the )?(report|note|memo|letter|review)\b",
    r"\bmonthly review\b",
    r"\bleadership (report|update|note)\b",
    r"\bcompose\b",
    r"\bprepare\b",
]
RAG_PATTERNS = [
    r"\bdocuments?\b",
    r"\baccording to\b",
    r"\bin the (contract|letter|note|nit|tender)\b",
    r"\bcorrespondence\b",
    r"\brecord notes?\b",
    r"\battachments?\b",
    r"\buploaded\b",
    r"\bfound in\b",
    r"\bmentioned in\b",
    r"\bfind .* (about|on|for)\b",
]


def quick_classify(query: str) -> Optional[str]:
    """Fast keyword-based classification. Returns task type or None."""
    q = query.lower()
    if any(re.search(p, q) for p in RAG_PATTERNS):
        return "rag"
    if any(re.search(p, q) for p in REPORT_PATTERNS):
        return "report"
    if any(re.search(p, q) for p in ANALYSIS_PATTERNS):
        return "analysis"
    if any(re.search(p, q) for p in LOOKUP_PATTERNS):
        return "lookup"
    return None


def _as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on", "enabled")


def _db_settings() -> dict[str, str]:
    db_url = (
        os.environ.get("PROJECT_BRAIN_DB_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
    )
    if not db_url:
        return {}
    try:
        with psycopg2.connect(db_url) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT setting_key, setting_value FROM app_settings")
                return {str(r["setting_key"]): str(r["setting_value"] or "") for r in cur.fetchall()}
    except Exception as exc:
        logger.debug("Could not load AI provider settings from app_settings: %s", exc)
        return {}


def _env_key(meta: dict) -> str:
    value = os.environ.get(meta["env"])
    if value:
        return value
    alt_env = meta.get("alt_env")
    return os.environ.get(alt_env, "") if alt_env else ""


class ProviderRouter:
    """Holds provider instances and routes queries to the right one with fallback."""

    def __init__(self):
        self.providers: dict[str, LLMProvider] = {}
        self.default_provider = DEFAULT_PROVIDER
        self._settings_loaded_at = 0.0
        self._init_providers()

    def _init_providers(self):
        settings = _db_settings()
        self.default_provider = (settings.get("ai_default_provider") or DEFAULT_PROVIDER).strip().lower()
        self.providers = {}

        groq_meta = PROVIDER_SETTINGS["groq"]
        groq_key = settings.get(groq_meta["key"]) or _env_key(groq_meta)
        if groq_key and _as_bool(settings.get(groq_meta["enabled"]), True):
            self.providers["groq"] = GroqProvider(api_key=groq_key)
            self.providers["groq"].model_id = settings.get(groq_meta["model"]) or groq_meta["default_model"]
            logger.info("Groq provider initialized")

        gemini_meta = PROVIDER_SETTINGS["gemini"]
        gemini_key = settings.get(gemini_meta["key"]) or _env_key(gemini_meta)
        if gemini_key and _as_bool(settings.get(gemini_meta["enabled"]), True):
            self.providers["gemini"] = GeminiProvider(api_key=gemini_key)
            self.providers["gemini"].model_id = settings.get(gemini_meta["model"]) or gemini_meta["default_model"]
            logger.info("Gemini provider initialized")

        openai_meta = PROVIDER_SETTINGS["openai"]
        openai_key = settings.get(openai_meta["key"]) or _env_key(openai_meta)
        if openai_key and _as_bool(settings.get(openai_meta["enabled"]), True):
            self.providers["openai"] = OpenAIProvider(api_key=openai_key)
            self.providers["openai"].model_id = settings.get(openai_meta["model"]) or openai_meta["default_model"]
            logger.info("OpenAI provider initialized")

        cerebras_meta = PROVIDER_SETTINGS["cerebras"]
        cerebras_key = settings.get(cerebras_meta["key"]) or _env_key(cerebras_meta)
        if cerebras_key and _as_bool(settings.get(cerebras_meta["enabled"]), True):
            cerebras_model = settings.get(cerebras_meta["model"]) or cerebras_meta["default_model"]
            self.providers["cerebras"] = CerebrasProvider(api_key=cerebras_key)
            self.providers["cerebras"].model_id = cerebras_model
            logger.info(f"Cerebras provider initialized ({cerebras_model})")

        openrouter_meta = PROVIDER_SETTINGS["openrouter"]
        openrouter_key = settings.get(openrouter_meta["key"]) or _env_key(openrouter_meta)
        if openrouter_key and _as_bool(settings.get(openrouter_meta["enabled"]), True):
            or_model = settings.get(openrouter_meta["model"]) or openrouter_meta["default_model"]
            self.providers["openrouter"] = OpenRouterProvider(api_key=openrouter_key, model=or_model)
            logger.info(f"OpenRouter provider initialized ({or_model})")

        ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        ollama_model = os.environ.get("OLLAMA_MODEL", "phi3:mini")
        self.providers["ollama"] = OllamaProvider(base_url=ollama_base, model=ollama_model)
        self._settings_loaded_at = time.time()
        logger.info(f"Ollama provider initialized at {ollama_base} ({ollama_model})")

    def refresh_if_needed(self) -> None:
        if time.time() - self._settings_loaded_at >= SETTINGS_REFRESH_SECONDS:
            self._init_providers()

    def get_available(self) -> list[str]:
        return list(self.providers.keys())

    def get_default_provider(self) -> Optional[str]:
        if self.default_provider in self.providers:
            return self.default_provider
        for p in ROUTING_TABLE["lookup"]:
            if p in self.providers:
                return p
        return None

    def _resolve_chain(self, task_type: str, forced_provider: Optional[str], strict_forced: bool) -> list[str]:
        if forced_provider:
            forced = forced_provider.strip().lower()
            if forced.startswith("ollama:"):
                return [forced]
            if forced not in VALID_PROVIDERS:
                return ROUTING_TABLE.get(task_type, ROUTING_TABLE["lookup"])
            if strict_forced:
                return [forced]
            return [forced] + (["ollama"] if forced != "ollama" else [])
        return ROUTING_TABLE.get(task_type, ROUTING_TABLE["lookup"])

    async def classify(self, query: str) -> str:
        cat = quick_classify(query)
        if cat:
            return cat

        if "groq" not in self.providers:
            return "lookup"  # safe default

        msgs = [
            ChatMessage(
                role="system",
                content=(
                    "Classify the user query into exactly one category. Output ONLY the category word, nothing else.\n"
                    "Categories:\n"
                    "  lookup   - asks for a specific fact, status, list, or count\n"
                    "  analysis - asks WHY something happened, comparison, risk, delay reasoning\n"
                    "  report   - asks to draft, write, generate a report/note/memo\n"
                    "  rag      - asks about content of a specific document, letter, or correspondence\n"
                ),
            ),
            ChatMessage(role="user", content=query),
        ]
        resp = await self.providers["groq"].chat(msgs, temperature=0.0, max_tokens=10)
        cat = (resp.content or "lookup").strip().lower().split()[0]
        if cat not in ROUTING_TABLE:
            return "lookup"
        return cat

    def _provider_for_request(self, provider_name: str, model_override: Optional[str]):
        """Return the provider to use for THIS request. When a model override
        is given, return a shallow clone with model_id swapped so the shared
        singleton is never mutated (fixes cross-request contamination)."""
        provider = self.providers[provider_name]
        if model_override:
            import copy as _copy
            clone = _copy.copy(provider)
            clone.model_id = model_override
            if hasattr(clone, "_tools_enabled"):
                model_lower = model_override.lower()
                clone._tools_enabled = "qwen3" in model_lower or "qwen2.5" in model_lower
            return clone
        return provider

    async def call(
        self,
        messages: list[ChatMessage],
        task_type: str = "lookup",
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        forced_provider: Optional[str] = None,
        strict_forced: bool = False,
        model_override: Optional[str] = None,
    ) -> ChatResponse:
        chain = self._resolve_chain(task_type, forced_provider, strict_forced)
        last_error = None
        for provider_name in chain:
            actual_provider_name = provider_name
            request_model_override = None
            if provider_name.startswith("ollama:"):
                actual_provider_name = "ollama"
                request_model_override = provider_name.split(":", 1)[1]

            if actual_provider_name not in self.providers:
                continue
            # model_override only applies to the explicitly forced provider,
            # never to fallbacks (a Groq model name means nothing to Ollama).
            if forced_provider and provider_name == forced_provider.strip().lower():
                request_model_override = model_override
            provider = self._provider_for_request(actual_provider_name, request_model_override)
            logger.info(
                f"Trying {actual_provider_name} ({provider.model_id}) for task={task_type} (forced={forced_provider}, strict={strict_forced})"
            )
            try:
                resp = await provider.chat(messages, tools=tools, temperature=temperature, max_tokens=max_tokens)
                if resp.error or resp.finish_reason == "error":
                    last_error = resp.error
                    logger.warning(f"{actual_provider_name} returned error: {resp.error}")
                    continue
                return resp
            except Exception as e:
                last_error = str(e)
                logger.warning(f"{actual_provider_name} exception: {e}")
                continue

        return ChatResponse(
            content=None,
            provider="none",
            model="none",
            finish_reason="error",
            error=f"All providers failed. Last error: {last_error}",
        )

    async def stream(
        self,
        messages: list[ChatMessage],
        task_type: str = "lookup",
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        forced_provider: Optional[str] = None,
        strict_forced: bool = False,
        model_override: Optional[str] = None,
    ):
        chain = self._resolve_chain(task_type, forced_provider, strict_forced)
        for provider_name in chain:
            actual_provider_name = provider_name
            request_model_override = None
            if provider_name.startswith("ollama:"):
                actual_provider_name = "ollama"
                request_model_override = provider_name.split(":", 1)[1]

            if actual_provider_name not in self.providers:
                continue
            if forced_provider and provider_name == forced_provider.strip().lower():
                request_model_override = model_override
            provider = self._provider_for_request(actual_provider_name, request_model_override)
            logger.info(f"Streaming from {actual_provider_name} ({provider.model_id}) for task={task_type}")
            try:
                async for chunk in provider.chat_stream(
                    messages, tools=tools, temperature=temperature, max_tokens=max_tokens
                ):
                    yield {"provider": actual_provider_name, "model": provider.model_id, "text": chunk}
                return
            except Exception as e:
                logger.warning(f"Stream from {actual_provider_name} failed: {e}")
                continue
        yield {"provider": "none", "model": "none", "text": "[All providers failed]"}


# Singleton
_router: Optional[ProviderRouter] = None


def get_router() -> ProviderRouter:
    global _router
    if _router is None:
        _router = ProviderRouter()
    else:
        _router.refresh_if_needed()
    return _router
