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
from typing import Optional

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


class ProviderRouter:
    """Holds provider instances and routes queries to the right one with fallback."""

    def __init__(self):
        self.providers: dict[str, LLMProvider] = {}
        self._init_providers()

    def _init_providers(self):
        groq_key = os.environ.get("GROQ_API_KEY")
        if groq_key:
            self.providers["groq"] = GroqProvider(api_key=groq_key)
            logger.info("Groq provider initialized")

        gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if gemini_key:
            self.providers["gemini"] = GeminiProvider(api_key=gemini_key)
            logger.info("Gemini provider initialized")

        openai_key = os.environ.get("OPENAI_API_KEY")
        if openai_key:
            self.providers["openai"] = OpenAIProvider(api_key=openai_key)
            logger.info("OpenAI provider initialized")

        cerebras_key = os.environ.get("CEREBRAS_API_KEY")
        if cerebras_key:
            cerebras_model = os.environ.get("CEREBRAS_MODEL", "llama-3.3-70b")
            self.providers["cerebras"] = CerebrasProvider(api_key=cerebras_key)
            self.providers["cerebras"].model_id = cerebras_model
            logger.info(f"Cerebras provider initialized ({cerebras_model})")

        openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        if openrouter_key:
            # Default: Qwen free. Can be overridden per-request via model_override.
            or_model = os.environ.get("OPENROUTER_MODEL", "qwen/qwen-2.5-72b-instruct:free")
            self.providers["openrouter"] = OpenRouterProvider(api_key=openrouter_key, model=or_model)
            logger.info(f"OpenRouter provider initialized ({or_model})")

        ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        ollama_model = os.environ.get("OLLAMA_MODEL", "phi3:mini")
        self.providers["ollama"] = OllamaProvider(base_url=ollama_base, model=ollama_model)
        logger.info(f"Ollama provider initialized at {ollama_base} ({ollama_model})")

    def get_available(self) -> list[str]:
        return list(self.providers.keys())

    def get_default_provider(self) -> Optional[str]:
        if DEFAULT_PROVIDER in self.providers:
            return DEFAULT_PROVIDER
        for p in ROUTING_TABLE["lookup"]:
            if p in self.providers:
                return p
        return None

    def _resolve_chain(self, task_type: str, forced_provider: Optional[str], strict_forced: bool) -> list[str]:
        if forced_provider:
            forced = forced_provider.strip().lower()
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
            if provider_name not in self.providers:
                continue
            # model_override only applies to the explicitly forced provider,
            # never to fallbacks (a Groq model name means nothing to Ollama).
            use_override = model_override if (forced_provider and provider_name == forced_provider.strip().lower()) else None
            provider = self._provider_for_request(provider_name, use_override)
            logger.info(
                f"Trying {provider_name} for task={task_type} (forced={forced_provider}, strict={strict_forced})"
            )
            try:
                resp = await provider.chat(messages, tools=tools, temperature=temperature, max_tokens=max_tokens)
                if resp.error or resp.finish_reason == "error":
                    last_error = resp.error
                    logger.warning(f"{provider_name} returned error: {resp.error}")
                    continue
                return resp
            except Exception as e:
                last_error = str(e)
                logger.warning(f"{provider_name} exception: {e}")
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
            if provider_name not in self.providers:
                continue
            use_override = model_override if (forced_provider and provider_name == forced_provider.strip().lower()) else None
            provider = self._provider_for_request(provider_name, use_override)
            logger.info(f"Streaming from {provider_name} for task={task_type}")
            try:
                async for chunk in provider.chat_stream(
                    messages, tools=tools, temperature=temperature, max_tokens=max_tokens
                ):
                    yield {"provider": provider_name, "model": provider.model_id, "text": chunk}
                return
            except Exception as e:
                logger.warning(f"Stream from {provider_name} failed: {e}")
                continue
        yield {"provider": "none", "model": "none", "text": "[All providers failed]"}


# Singleton
_router: Optional[ProviderRouter] = None


def get_router() -> ProviderRouter:
    global _router
    if _router is None:
        _router = ProviderRouter()
    return _router
