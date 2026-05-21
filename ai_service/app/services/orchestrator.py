"""
AI orchestrator. The main chat loop with tool calling.

Flow:
  1. Classify query → task type
  2. Build system prompt + history + new user msg
  3. Call provider with tools
  4. If LLM requests tools → execute → feed back → repeat (max 4 turns)
  5. Persist conversation to ai_conversations + ai_messages
  6. Return final response with citations

Tool calling cap: 4 rounds (prevents infinite loops, enough for compound queries)
Token budget: 50K per conversation default (configurable)

Sprint AI: accepts `forced_provider` and `strict_forced` and forwards them to
the ProviderRouter so the UI can force OpenAI/Gemini/Groq/Ollama per message.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import AsyncIterator, Optional

import psycopg2
import psycopg2.extras

from app.providers.base import ChatMessage
from app.providers.router import get_router
from app.tools.db_tools import call_tool, get_tools_for_llm

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 4
DEFAULT_TOKEN_BUDGET = 50000

SYSTEM_PROMPT = """You are PROJECT BRAIN ASSISTANT — the AI for a Rourkela Steel Plant project monitoring system.

You help engineers, PMs, and leadership get answers about schemes, packages, lifecycle stages, contracts, risks, progress, and documents.

RULES:
1. Always call tools to fetch real data. Never make up scheme names, dates, costs, or facts.
2. If user asks about a specific scheme/package, first find it via find_scheme.
3. For "is X on track?" use get_progress_status + compute_s_curve_variance.
4. For "why is X delayed?" use analyze_delays + get_record_notes + get_correspondence.
5. For "show me documents about Y" use search_documents.
6. Always cite the scheme_id, package_id, document_id you used so the UI can link.
7. Be concise. Engineers don't want fluff. Numbers, dates, names — not paragraphs.
8. If a tool returns an error, explain the issue, don't fabricate.
9. Format costs in ₹ Crores (e.g. "₹12.5 Cr"). Format dates in ISO (YYYY-MM-DD) or "Jan 2024" style.
10. When listing packages or schemes, use compact bullet lists.

When asked to draft a report or note: structure with clear headings, use bullet points for facts,
and keep it executive-friendly (no jargon dumps).
"""


def get_db():
    dsn = os.environ.get(
        "PROJECT_BRAIN_DB_URL", "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"
    )
    return psycopg2.connect(dsn)


def load_conversation_history(conversation_id: int) -> list[ChatMessage]:
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT role, content, tools_called
        FROM ai_messages WHERE conversation_id=%s
        ORDER BY created_at ASC
    """,
        (conversation_id,),
    )
    msgs: list[ChatMessage] = []
    for r in cur.fetchall():
        if r["role"] in ("user", "assistant"):
            msgs.append(ChatMessage(role=r["role"], content=r["content"]))
    conn.close()
    return msgs


def persist_message(
    conversation_id: int,
    role: str,
    content: str,
    tools_called: Optional[list] = None,
    cited_schemes: Optional[list[int]] = None,
    cited_packages: Optional[list[int]] = None,
    cited_documents: Optional[list[int]] = None,
    cited_chunks: Optional[list[int]] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    tokens_used: int = 0,
    latency_ms: int = 0,
    cost: float = 0.0,
) -> int:
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO ai_messages
            (conversation_id, role, content, tools_called,
             cited_scheme_ids, cited_package_ids, cited_document_ids, cited_chunk_ids,
             provider, model_name, tokens_used, latency_ms, cost_estimate_usd)
        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING message_id
    """,
        (
            conversation_id,
            role,
            content,
            json.dumps(tools_called) if tools_called else None,
            cited_schemes or None,
            cited_packages or None,
            cited_documents or None,
            cited_chunks or None,
            provider,
            model,
            tokens_used,
            latency_ms,
            cost,
        ),
    )
    msg_id = cur.fetchone()[0]
    cur.execute(
        """
        UPDATE ai_conversations SET
            last_message_at = CURRENT_TIMESTAMP,
            message_count = message_count + 1,
            total_tokens = total_tokens + %s
        WHERE conversation_id = %s
    """,
        (tokens_used, conversation_id),
    )
    conn.commit()
    conn.close()
    return msg_id


def create_conversation(
    user_id: int,
    scheme_id: int = None,
    package_id: int = None,
    title: str = None,
    source: str = "web",
) -> int:
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO ai_conversations (user_id, scheme_id, package_id, title, source)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING conversation_id
    """,
        (user_id, scheme_id, package_id, title, source),
    )
    cid = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return cid


async def chat_once(
    conversation_id: int,
    user_id: int,
    message: str,
    scheme_id: int = None,
    package_id: int = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
) -> dict:
    router = get_router()

    history = load_conversation_history(conversation_id)
    msgs = [ChatMessage(role="system", content=SYSTEM_PROMPT)] + history + [
        ChatMessage(role="user", content=message)
    ]

    task_type = await router.classify(message)
    tools = get_tools_for_llm()

    cited_scheme_ids: set[int] = set()
    cited_package_ids: set[int] = set()
    cited_document_ids: set[int] = set()
    cited_chunk_ids: set[int] = set()
    tools_called: list[dict] = []

    last_resp = None
    started = time.time()
    for round_no in range(MAX_TOOL_ROUNDS):
        logger.info(f"LLM round {round_no + 1}/{MAX_TOOL_ROUNDS} task={task_type} (forced_provider={forced_provider})")
        t0 = time.time()
        resp = await router.call(
            msgs,
            task_type=task_type,
            tools=tools,
            forced_provider=forced_provider,
            strict_forced=strict_forced,
        )
        latency_ms = int((time.time() - t0) * 1000)
        last_resp = resp

        if resp.tool_calls:
            for tc in resp.tool_calls:
                result = call_tool(tc.name, tc.args)
                tools_called.append({"tool": tc.name, "args": tc.args, "result": result})

                if isinstance(result, dict):
                    cited_scheme_ids.update(result.get("cited_scheme_ids") or [])
                    cited_package_ids.update(result.get("cited_package_ids") or [])
                    cited_document_ids.update(result.get("cited_document_ids") or [])
                    cited_chunk_ids.update(result.get("cited_chunk_ids") or [])

                msgs.append(ChatMessage(role="assistant", content=f"[TOOL CALL] {tc.name} {tc.args}"))
                msgs.append(ChatMessage(role="tool", content=json.dumps(result)))
            continue

        final_text = (resp.content or "").strip()
        persist_message(
            conversation_id,
            "assistant",
            final_text,
            tools_called=tools_called,
            cited_schemes=sorted(cited_scheme_ids),
            cited_packages=sorted(cited_package_ids),
            cited_documents=sorted(cited_document_ids),
            cited_chunks=sorted(cited_chunk_ids),
            provider=resp.provider,
            model=resp.model,
            tokens_used=resp.tokens_used or 0,
            latency_ms=latency_ms,
            cost=resp.cost_usd or 0.0,
        )
        return {
            "reply": final_text,
            "response": final_text,
            "provider": resp.provider,
            "model": resp.model,
            "task_type": task_type,
            "tokens_used": resp.tokens_used,
            "latency_ms": latency_ms,
            "cost_usd": resp.cost_usd,
            "cited_scheme_ids": sorted(cited_scheme_ids),
            "cited_package_ids": sorted(cited_package_ids),
            "cited_document_ids": sorted(cited_document_ids),
            "cited_chunk_ids": sorted(cited_chunk_ids),
        }

    err = "Tool loop limit reached. The assistant could not complete the request."
    persist_message(conversation_id, "assistant", err, tools_called=tools_called)
    return {"reply": err, "response": err, "provider": "none", "model": "none"}


async def chat_stream(
    conversation_id: int,
    user_id: int,
    message: str,
    scheme_id: int = None,
    package_id: int = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
) -> AsyncIterator[dict]:
    router = get_router()

    history = load_conversation_history(conversation_id)
    msgs = [ChatMessage(role="system", content=SYSTEM_PROMPT)] + history + [
        ChatMessage(role="user", content=message)
    ]
    task_type = await router.classify(message)
    tools = get_tools_for_llm()

    async for chunk in router.stream(
        msgs,
        task_type=task_type,
        tools=tools,
        forced_provider=forced_provider,
        strict_forced=strict_forced,
    ):
        yield chunk

