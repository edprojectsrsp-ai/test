"""
Gemini provider — gemini-2.5-flash.
Strategy: analysis, reasoning, document Q&A (1M context window).
"""
import time, json
from typing import AsyncIterator, Optional
import httpx
from .base import LLMProvider, ChatMessage, ChatResponse, ToolCall


class GeminiProvider(LLMProvider):
    name = "gemini"
    model_id = "gemini-2.5-flash"
    supports_tools = True
    supports_streaming = True
    # Gemini 2.5 Flash pricing
    input_cost_per_1m = 0.30
    output_cost_per_1m = 2.50
    base_url = "https://generativelanguage.googleapis.com/v1beta"

    def _convert_messages(self, messages: list[ChatMessage]) -> tuple[Optional[str], list[dict]]:
        """Convert to Gemini's contents format. Returns (system_instruction, contents)."""
        system_text = None
        contents = []
        for m in messages:
            if m.role == "system":
                system_text = m.content
                continue
            role = "user" if m.role in ("user", "tool") else "model"
            parts = []
            if m.content:
                parts.append({"text": m.content})
            if m.tool_calls:
                for tc in m.tool_calls:
                    parts.append({"functionCall": {"name": tc.name, "args": tc.arguments}})
            if m.role == "tool" and m.name:
                # Tool result message — convert to functionResponse
                try: content_data = json.loads(m.content) if m.content else {}
                except Exception: content_data = {"result": m.content}
                parts = [{"functionResponse": {"name": m.name, "response": content_data}}]
            if parts:
                contents.append({"role": role, "parts": parts})
        return system_text, contents

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """Convert our tool format to Gemini's function declarations."""
        funcs = []
        for t in tools:
            funcs.append({
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("parameters", {"type": "object", "properties": {}}),
            })
        return [{"functionDeclarations": funcs}]

    async def chat(self, messages, tools=None, temperature=0.3, max_tokens=2048, stream=False):
        start = time.time()
        system_text, contents = self._convert_messages(messages)
        payload = {
            "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
        }
        if system_text:
            payload["systemInstruction"] = {"parts": [{"text": system_text}]}
        if tools:
            payload["tools"] = self._convert_tools(tools)

        url = f"{self.base_url}/models/{self.model_id}:generateContent?key={self.api_key}"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            return ChatResponse(content=None, provider=self.name, model=self.model_id,
                                latency_ms=int((time.time() - start) * 1000),
                                finish_reason="error", error=str(e))

        if "candidates" not in data or not data["candidates"]:
            return ChatResponse(content=None, provider=self.name, model=self.model_id,
                                latency_ms=int((time.time() - start) * 1000),
                                finish_reason="error", error=f"No candidates: {data}")

        cand = data["candidates"][0]
        parts = cand.get("content", {}).get("parts", [])
        text_parts = [p.get("text", "") for p in parts if "text" in p]
        tool_calls = []
        for p in parts:
            if "functionCall" in p:
                fc = p["functionCall"]
                tool_calls.append(ToolCall(
                    id=f"gem_{int(time.time()*1000)}_{fc['name']}",
                    name=fc["name"], arguments=fc.get("args", {})
                ))

        usage = data.get("usageMetadata", {})
        in_t = usage.get("promptTokenCount", 0)
        out_t = usage.get("candidatesTokenCount", 0)
        return ChatResponse(
            content="".join(text_parts) if text_parts else None,
            tool_calls=tool_calls,
            provider=self.name, model=self.model_id,
            input_tokens=in_t, output_tokens=out_t,
            latency_ms=int((time.time() - start) * 1000),
            cost_usd=self.estimate_cost(in_t, out_t),
            finish_reason="tool_calls" if tool_calls else cand.get("finishReason", "STOP").lower(),
        )

    async def chat_stream(self, messages, tools=None, temperature=0.3, max_tokens=2048) -> AsyncIterator[str]:
        system_text, contents = self._convert_messages(messages)
        payload = {
            "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
        }
        if system_text:
            payload["systemInstruction"] = {"parts": [{"text": system_text}]}
        if tools:
            payload["tools"] = self._convert_tools(tools)

        url = f"{self.base_url}/models/{self.model_id}:streamGenerateContent?alt=sse&key={self.api_key}"
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=payload) as r:
                async for line in r.aiter_lines():
                    if not line.startswith("data: "): continue
                    body = line[6:].strip()
                    if not body: continue
                    try:
                        chunk = json.loads(body)
                        for cand in chunk.get("candidates", []):
                            for p in cand.get("content", {}).get("parts", []):
                                if p.get("text"):
                                    yield p["text"]
                    except Exception:
                        continue
