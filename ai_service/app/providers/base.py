"""
Provider abstraction layer.

Every provider implements:
- chat(messages, tools=None, stream=False) -> ChatResponse
- name, model_id, supports_tools, supports_streaming
- approximate cost calculation

Adding a new provider = add a file in providers/ implementing this contract.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, AsyncIterator, Any
import time


@dataclass
class ToolCall:
    """A single tool call request from the LLM."""
    id: str
    name: str
    arguments: dict


@dataclass
class ChatMessage:
    """One message in a conversation."""
    role: str  # 'system', 'user', 'assistant', 'tool'
    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: Optional[str] = None  # for role='tool'
    name: Optional[str] = None  # for role='tool', the tool name


@dataclass
class ChatResponse:
    """Standard response from any provider."""
    content: Optional[str]
    tool_calls: list[ToolCall] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0
    finish_reason: str = "stop"  # 'stop', 'tool_calls', 'length', 'error'
    error: Optional[str] = None


class LLMProvider(ABC):
    """Base class every provider implements."""

    name: str = "base"
    model_id: str = ""
    supports_tools: bool = True
    supports_streaming: bool = True
    # Cost per million tokens (USD)
    input_cost_per_1m: float = 0.0
    output_cost_per_1m: float = 0.0

    def __init__(self, api_key: Optional[str] = None, **kwargs):
        self.api_key = api_key
        self.config = kwargs

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stream: bool = False,
    ) -> ChatResponse:
        """Send a chat completion request. Returns a single ChatResponse."""
        ...

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Stream chat completion. Yields text chunks. Tool calls handled internally."""
        ...

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Calculate USD cost for this call."""
        return (input_tokens / 1_000_000 * self.input_cost_per_1m
                + output_tokens / 1_000_000 * self.output_cost_per_1m)

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} model={self.model_id}>"


def _strip_defaults(schema: dict) -> dict:
    """Recursively remove 'default' keys from JSON Schema.

    Groq (and strict OpenAI-compatible providers) return 400 Bad Request
    when tool parameter schemas contain 'default' — it is not part of the
    JSON Schema subset they accept for function calling.
    """
    if not isinstance(schema, dict):
        return schema
    cleaned = {}
    for k, v in schema.items():
        if k == "default":
            continue  # drop it
        if isinstance(v, dict):
            cleaned[k] = _strip_defaults(v)
        elif isinstance(v, list):
            cleaned[k] = [_strip_defaults(i) if isinstance(i, dict) else i for i in v]
        else:
            cleaned[k] = v
    return cleaned


def normalize_tools_to_openai_schema(tools: list[dict]) -> list[dict]:
    """Convert our internal tool definitions to OpenAI-style schema.

    Most providers (Groq, OpenAI, Ollama in OpenAI-compatible mode) accept this.
    Gemini needs slight transformation - handled in GeminiProvider.
    """
    out = []
    for t in tools:
        out.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": _strip_defaults(
                    t.get("parameters", {"type": "object", "properties": {}})
                ),
            }
        })
    return out
