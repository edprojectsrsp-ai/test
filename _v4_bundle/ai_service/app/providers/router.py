"""
Task-aware router. Picks the right provider for each query type.

Routing logic:
  1. Quick heuristic classification (keyword-based) — sub-millisecond, free
  2. If ambiguous → Groq classifies in ~300ms
  3. Route to the best provider for that task type
  4. On failure, fall through to next provider in the chain

Task types and primary providers:
  - 'classify'   → Groq (intent classification)
  - 'lookup'     → Groq (simple DB queries)
  - 'analysis'   → Gemini (multi-step reasoning)
  - 'report'     → OpenAI (prose quality)
  - 'rag'        → Gemini (1M context)
  - 'fallback'   → Ollama (offline / API down)
"""
from __future__ import annotations
import os, re, logging
from typing import Optional
from .base import LLMProvider, ChatMessage, ChatResponse
from .groq_provider import GroqProvider
from .gemini_provider import GeminiProvider
from .openai_provider import OpenAIProvider
from .ollama_provider import OllamaProvider

logger = logging.getLogger(__name__)

# Task type → ordered list of providers to try
ROUTING_TABLE = {
    "classify":  ["groq", "ollama"],
    "lookup":    ["groq", "gemini", "ollama"],
    "analysis":  ["gemini", "openai", "ollama"],
    "report":    ["openai", "gemini", "ollama"],
    "rag":       ["gemini", "openai", "ollama"],
    "fallback":  ["ollama"],
}

# Heuristic patterns that strongly imply a task type
LOOKUP_PATTERNS = [
    r"\bwhat (is|was|are) the\b", r"\bwhen (was|did|is)\b", r"\bwho (is|was)\b",
    r"\blist( all| me)?\b", r"\bshow me\b", r"\bcurrent (status|cost|date)\b",
    r"\bhow many\b",
]
ANALYSIS_PATTERNS = [
    r"\bwhy\b", r"\banalyz", r"\bcompar", r"\bvariance\b", r"\bforecast\b",
    r"\brisk\b", r"\bidentify\b", r"\bexplain\b", r"\bdelayed\b", r"\bdelay\b",
    r"\bimpact\b", r"\bbottleneck\b",
]
REPORT_PATTERNS = [
    r"\bdraft\b", r"\bwrite (a|me|up)\b", r"\bgenerate (a |the )?(report|note|memo|letter|review)\b",
    r"\bmonthly review\b", r"\bleadership (report|update|note)\b",
    r"\bcompose\b", r"\bprepare\b",
]
RAG_PATTERNS = [
    r"\bdocuments?\b", r"\baccording to\b", r"\bin the (contract|letter|note|nit|tender)\b",
    r"\bcorrespondence\b", r"\brecord notes?\b", r"\battachments?\b", r"\buploaded\b",
    r"\bfound in\b", r"\bmentioned in\b", r"\bfind .* (about|on|for)\b",
]


def quick_classify(query: str) -> Optional[str]:
    """Fast keyword-based classification. Returns task type or None."""
    q = query.lower()
    # Order matters - check most specific first
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

        ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        ollama_model = os.environ.get("OLLAMA_MODEL", "qwen3:8b")
        self.providers["ollama"] = OllamaProvider(base_url=ollama_base, model=ollama_model)
        logger.info(f"Ollama provider initialized at {ollama_base} ({ollama_model})")

    def get_available(self) -> list[str]:
        return list(self.providers.keys())

    async def classify_query(self, query: str) -> str:
        """Classify a query into one of: lookup, analysis, report, rag.

        Tries quick heuristic first; falls back to Groq LLM if heuristic returns None.
        """
        quick = quick_classify(query)
        if quick:
            logger.debug(f"quick_classify → {quick} for: {query[:60]}")
            return quick

        # Fallback: ask Groq
        if "groq" not in self.providers:
            return "lookup"  # safe default

        msgs = [
            ChatMessage(role="system", content=(
                "Classify the user query into exactly one category. Output ONLY the category word, nothing else.\n"
                "Categories:\n"
                "  lookup   - asks for a specific fact, status, list, or count\n"
                "  analysis - asks WHY something happened, comparison, risk, delay reasoning\n"
                "  report   - asks to draft, write, generate a report/note/memo\n"
                "  rag      - asks about content of a specific document, letter, or correspondence\n"
            )),
            ChatMessage(role="user", content=query),
        ]
        resp = await self.providers["groq"].chat(msgs, temperature=0.0, max_tokens=10)
        cat = (resp.content or "lookup").strip().lower().split()[0]
        if cat not in ROUTING_TABLE:
            return "lookup"
        return cat

    async def call(
        self,
        messages: list[ChatMessage],
        task_type: str = "lookup",
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> ChatResponse:
        """Call providers in order until one succeeds."""
        chain = ROUTING_TABLE.get(task_type, ROUTING_TABLE["lookup"])
        last_error = None
        for provider_name in chain:
            if provider_name not in self.providers:
                continue
            provider = self.providers[provider_name]
            logger.info(f"Trying {provider_name} for task={task_type}")
            try:
                resp = await provider.chat(messages, tools=tools,
                                           temperature=temperature, max_tokens=max_tokens)
                if resp.error or resp.finish_reason == "error":
                    last_error = resp.error
                    logger.warning(f"{provider_name} returned error: {resp.error}")
                    continue
                return resp
            except Exception as e:
                last_error = str(e)
                logger.warning(f"{provider_name} exception: {e}")
                continue

        return ChatResponse(content=None, provider="none", model="none",
                            finish_reason="error",
                            error=f"All providers failed. Last error: {last_error}")

    async def stream(
        self,
        messages: list[ChatMessage],
        task_type: str = "lookup",
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ):
        """Stream from the first available provider in the routing chain."""
        chain = ROUTING_TABLE.get(task_type, ROUTING_TABLE["lookup"])
        for provider_name in chain:
            if provider_name not in self.providers:
                continue
            provider = self.providers[provider_name]
            logger.info(f"Streaming from {provider_name} for task={task_type}")
            try:
                async for chunk in provider.chat_stream(messages, tools=tools,
                                                        temperature=temperature,
                                                        max_tokens=max_tokens):
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
