"""
Ollama provider — Qwen3 8B local fallback.
Strategy: never let the user see "API down". Free, private, your DB never goes offline.
Requires Ollama installed: https://ollama.com — then `ollama pull qwen3:8b`
"""
import time, json
from typing import AsyncIterator
import httpx
from .base import LLMProvider, ChatMessage, ChatResponse, ToolCall, normalize_tools_to_openai_schema


class OllamaProvider(LLMProvider):
    name = "ollama"
    model_id = "qwen3:8b"
    supports_tools = True
    supports_streaming = True
    # Local = free
    input_cost_per_1m = 0.0
    output_cost_per_1m = 0.0

    def __init__(self, api_key=None, base_url="http://localhost:11434", model="qwen3:8b", **kw):
        super().__init__(api_key=api_key, **kw)
        self.base_url = base_url.rstrip("/")
        self.model_id = model
        # Tool-calling support varies by model. Only enable tools for known-good models.
        self._tools_enabled = self.model_id in {"qwen3:8b"}

    def _convert_messages(self, messages: list[ChatMessage]) -> list[dict]:
        out = []
        for m in messages:
            d = {"role": m.role}
            if m.content is not None: d["content"] = m.content
            if m.tool_calls:
                d["tool_calls"] = [{
                    "function": {"name": tc.name, "arguments": tc.arguments}
                } for tc in m.tool_calls]
            if m.tool_call_id: d["tool_call_id"] = m.tool_call_id
            out.append(d)
        return out

    async def chat(self, messages, tools=None, temperature=0.3, max_tokens=2048, stream=False):
        start = time.time()
        payload = {
            "model": self.model_id,
            "messages": self._convert_messages(messages),
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if tools and self._tools_enabled:
            payload["tools"] = normalize_tools_to_openai_schema(tools)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            return ChatResponse(content=None, provider=self.name, model=self.model_id,
                                latency_ms=int((time.time() - start) * 1000),
                                finish_reason="error", error=str(e))

        msg = data.get("message", {})
        tool_calls = []
        for tc in msg.get("tool_calls", []) or []:
            fn = tc.get("function", {})
            args = fn.get("arguments", {})
            if isinstance(args, str):
                try: args = json.loads(args)
                except: args = {}
            tool_calls.append(ToolCall(
                id=f"oll_{int(time.time()*1000)}_{fn.get('name','x')}",
                name=fn.get("name", "unknown"), arguments=args
            ))

        return ChatResponse(
            content=msg.get("content"), tool_calls=tool_calls,
            provider=self.name, model=self.model_id,
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            latency_ms=int((time.time() - start) * 1000),
            cost_usd=0.0,
            finish_reason="tool_calls" if tool_calls else "stop",
        )

    async def chat_stream(self, messages, tools=None, temperature=0.3, max_tokens=2048) -> AsyncIterator[str]:
        payload = {
            "model": self.model_id, "messages": self._convert_messages(messages),
            "stream": True, "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if tools and self._tools_enabled:
            payload["tools"] = normalize_tools_to_openai_schema(tools)
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as r:
                async for line in r.aiter_lines():
                    if not line.strip(): continue
                    try:
                        chunk = json.loads(line)
                        msg = chunk.get("message", {})
                        if msg.get("content"):
                            yield msg["content"]
                    except Exception:
                        continue
