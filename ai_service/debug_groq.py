"""Debug Groq 400 error - get actual response body."""
import asyncio, os, json
from dotenv import load_dotenv
load_dotenv()

from app.providers.base import normalize_tools_to_openai_schema
from app.tools.db_tools import get_tools_for_llm
from app.providers.groq_provider import GroqProvider
from app.providers.base import ChatMessage
import httpx

async def main():
    key = os.environ["GROQ_API_KEY"]
    tools = get_tools_for_llm()
    schemas = normalize_tools_to_openai_schema(tools)

    msgs = [
        {"role": "system", "content": "You are an assistant."},
        {"role": "user", "content": "What is COB-7 cost?"},
    ]

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": msgs,
        "tools": schemas,
        "tool_choice": "auto",
        "temperature": 0.3,
        "max_tokens": 512,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
        )
        print(f"Status: {r.status_code}")
        body = r.json()
        print(json.dumps(body, indent=2)[:2000])

asyncio.run(main())
