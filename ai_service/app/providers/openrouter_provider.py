"""
OpenRouter provider — access 50+ free models via one API key.
Free models used: Qwen 2.5 72B, Gemma 3 27B.
Base URL: https://openrouter.ai/api/v1  (OpenAI-compatible)
Key: OPENROUTER_API_KEY from .env
"""
import time, json
from typing import AsyncIterator, Optional
import httpx
from .base import LLMProvider, ChatMessage, ChatResponse, ToolCall, normalize_tools_to_openai_schema


class OpenRouterProvider(LLMProvider):
    name = "openrouter"
    model_id = "qwen/qwen-2.5-72b-instruct:free"
    supports_tools = True
    supports_streaming = True
    input_cost_per_1m  = 0.0  # free tier
    output_cost_per_1m = 0.0
    base_url = "https://openrouter.ai/api/v1"

    def __init__(self, api_key: str, model: Optional[str] = None, **kwargs):
        super().__init__(api_key=api_key, **kwargs)
        if model:
            self.model_id = model

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",  # required by OpenRouter
            "X-Title": "Project Brain RSP",
        }

    def _convert_messages(self, messages: list[ChatMessage]) -> list[dict]:
        out = []
        for m in messages:
            d: dict = {"role": m.role}
            if m.content is not None:
                d["content"] = m.content
            if m.tool_calls:
                d["tool_calls"] = [{
                    "id": tc.id, "type": "function",
                    "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}
                } for tc in m.tool_calls]
            if m.tool_call_id:
                d["tool_call_id"] = m.tool_call_id
            if m.name:
                d["name"] = m.name
            out.append(d)
        return out

    async def chat(self, messages, tools=None, temperature=0.3, max_tokens=2048, stream=False):
        start = time.time()
        payload = {
            "model": self.model_id,
            "messages": self._convert_messages(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = normalize_tools_to_openai_schema(tools)
            payload["tool_choice"] = "auto"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            return ChatResponse(content=None, provider=self.name, model=self.model_id,
                                latency_ms=int((time.time()-start)*1000),
                                finish_reason="error", error=str(e))

        choice = data["choices"][0]
        msg    = choice["message"]
        usage  = data.get("usage", {})
        tool_calls = []
        for tc in (msg.get("tool_calls") or []):
            try:    args = json.loads(tc["function"]["arguments"])
            except: args = {}
            tool_calls.append(ToolCall(id=tc["id"], name=tc["function"]["name"], arguments=args))

        in_t, out_t = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
        return ChatResponse(
            content=msg.get("content"), tool_calls=tool_calls,
            provider=self.name, model=self.model_id,
            input_tokens=in_t, output_tokens=out_t,
            latency_ms=int((time.time()-start)*1000),
            cost_usd=0.0,
            finish_reason=choice.get("finish_reason", "stop"),
        )

    async def chat_stream(self, messages, tools=None, temperature=0.3, max_tokens=2048) -> AsyncIterator[str]:
        payload = {
            "model": self.model_id,
            "messages": self._convert_messages(messages),
            "temperature": temperature, "max_tokens": max_tokens, "stream": True,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", f"{self.base_url}/chat/completions",
                                     headers=self._headers(), json=payload) as r:
                async for line in r.aiter_lines():
                    if not line.startswith("data: "): continue
                    body = line[6:].strip()
                    if body == "[DONE]": break
                    try:
                        chunk = json.loads(body)
                        delta = chunk["choices"][0].get("delta", {})
                        if delta.get("content"):
                            yield delta["content"]
                    except Exception:
                        continue
