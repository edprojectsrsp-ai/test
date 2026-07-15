"""
AI orchestrator v2 — Project Brain.

Drop-in replacement for app/services/orchestrator.py. Same public API
(create_conversation, chat_once, chat_stream, get_db, SYSTEM_PROMPT,
get_active_system_prompt, get_prompt_with_portfolio_hint, persist_message,
load_conversation_history) so chat_router.py and telegram_bot.py work unchanged.

Fixes over v1:
  P0-1  User messages are now persisted (v1 only saved assistant turns, so
        multi-turn history silently contained no user messages).
  P0-2  chat_stream now runs the FULL tool loop (grounded), then streams only
        the final synthesis. v1 streamed raw provider output with no tool
        execution and persisted nothing.
  P0-3  On the final tool round the model is called WITHOUT tools and told to
        synthesize from gathered data — no more "Tool loop limit reached".
  P1-a  Tool results are truncated (row cap + byte cap) before entering
        context; full results still recorded in tools_called for the UI.
  P1-b  Date / Indian-FY grounding injected every turn (today, current FY in
        both '2026-27' and '2026-2027' forms, months elapsed in FY).
  P1-c  History capped (last N turns) to bound context growth.
  P1-d  Blocking DB + tool calls moved off the event loop via asyncio.to_thread.
  P1-e  model_override handled per-request via provider clone (see router
        patch) instead of mutating the singleton.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import AsyncIterator, Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from app.providers.base import ChatMessage
from app.providers.router import get_router
from app.tools.db_tools import call_tool, get_tools_for_llm
from app.tools.memory_tools import taught_context

# Self-registering retrieval tools (resolve_entity, hybrid_search_documents,
# export_knowledge_bundle). Import is the integration; failure is non-fatal
# so the service still boots if migration 031 hasn't run yet.
try:
    import app.tools.retrieval_tools  # noqa: F401
    from app.services.retrieval import resolve_entities as _resolve_entities
except Exception:  # pragma: no cover
    _resolve_entities = None

logger = logging.getLogger(__name__)

load_dotenv()

MAX_TOOL_ROUNDS = int(os.environ.get("AI_MAX_TOOL_ROUNDS", "4"))
HISTORY_MAX_MESSAGES = int(os.environ.get("AI_HISTORY_MAX_MESSAGES", "24"))
TOOL_RESULT_MAX_ROWS = int(os.environ.get("AI_TOOL_RESULT_MAX_ROWS", "40"))
TOOL_RESULT_MAX_BYTES = int(os.environ.get("AI_TOOL_RESULT_MAX_BYTES", "12000"))

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
11. If a tool result has "truncated": true, say the list was truncated and offer to narrow the filter.

When asked to draft a report or note: structure with clear headings, use bullet points for facts,
and keep it executive-friendly (no jargon dumps).

RICH OUTPUT — you can render charts and custom tables directly in the chat UI:
- For a CHART, emit a fenced block exactly like:
  ```brain:chart
  {"type":"bar","title":"Physical progress by package","x":["PKG-1","PKG-2"],
   "series":[{"name":"Plan %","data":[68,55]},{"name":"Actual %","data":[62.4,51]}],
   "y_label":"%"}
  ```
  Allowed "type": "bar" | "line" | "area" | "pie". For "pie", use
  {"type":"pie","title":...,"slices":[{"label":"Civil","value":40},...]}.
  Numbers must come from tool results — never invented. One chart per block.
- For a CUSTOM TABLE beyond simple markdown, emit:
  ```brain:table
  {"title":"CAPEX vs actual","columns":[{"key":"pkg","label":"Package"},
   {"key":"plan","label":"Plan ₹Cr","align":"right"},{"key":"act","label":"Actual ₹Cr","align":"right"}],
   "rows":[{"pkg":"PKG-1","plan":12.5,"act":11.2}]}
  ```
- Plain markdown tables also render. Use a chart whenever the user asks to
  "show", "plot", "compare", "trend" or "graph" numeric data; use brain:table
  for aligned numeric tables. Keep prose around blocks short.
"""

IST = timezone(timedelta(hours=5, minutes=30))


def _fy_strings(today: date) -> tuple[str, str]:
    """Indian FY (Apr–Mar) in both formats used across Project Brain tables:
    '2026-27' (CAPEX etc.) and '2026-2027' (progress tables)."""
    start = today.year if today.month >= 4 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}", f"{start}-{start + 1}"


def temporal_grounding(now: Optional[datetime] = None) -> str:
    """Date/FY context injected into every system prompt so 'this month' /
    'current FY' queries resolve correctly."""
    now = now or datetime.now(IST)
    today = now.date()
    fy_short, fy_long = _fy_strings(today)
    fy_start_year = int(fy_long.split("-")[0])
    months_elapsed = (today.year - fy_start_year) * 12 + today.month - 4 + 1
    return (
        f"TEMPORAL CONTEXT (authoritative):\n"
        f"- Today is {today.isoformat()} ({today.strftime('%A, %d %b %Y')}), timezone IST.\n"
        f"- Current Indian financial year: {fy_short} (some tables store it as '{fy_long}'). "
        f"FY runs Apr {fy_start_year} – Mar {fy_start_year + 1}; month {months_elapsed} of 12.\n"
        f"- 'This month' = {today.strftime('%b %Y')}. 'Last month' = "
        f"{(today.replace(day=1) - timedelta(days=1)).strftime('%b %Y')}.\n"
        f"- When a tool needs a financial_year argument, try '{fy_short}' first and "
        f"'{fy_long}' if that returns nothing."
    )


def get_active_system_prompt() -> str:
    """Load the saved system prompt from DB if available, otherwise default."""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT body
            FROM record_notes
            WHERE note_type='ai_config'
              AND extra_fields->>'config_key' = 'system_prompt'
              AND is_deleted=FALSE
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1
            """
        )
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return SYSTEM_PROMPT


def entity_resolution_block(question: str) -> str:
    """Pre-resolve fuzzy entity references BEFORE the LLM sees the question,
    so 'con-7' behaves like ChatGPT: confident matches are asserted, near
    matches become a did-you-mean. Empty string when nothing matches or the
    retrieval layer isn't installed."""
    if not _resolve_entities or not question:
        return ""
    try:
        res = _resolve_entities(question)
    except Exception:
        return ""
    lines: list[str] = []
    for c in (res.get("resolved") or [])[:4]:
        lines.append(
            f"- CONFIRMED: '{c['matched_alias']}' in the question refers to "
            f"{c['canonical']} ({c['entity_type']}_id={c['entity_id']}, "
            f"confidence {c['confidence']}). Use this ID directly in tools."
        )
    sugg = res.get("suggestions") or []
    if not lines and sugg:
        opts = "; ".join(
            f"{c['canonical']} ({c['entity_type']}_id={c['entity_id']}, {c['confidence']})"
            for c in sugg[:3]
        )
        lines.append(
            f"- AMBIGUOUS reference detected. Closest known entities: {opts}. "
            f"If one is clearly intended, proceed with it and say so "
            f"('Assuming you mean COB-7 …'); if genuinely unclear, ask a "
            f"one-line did-you-mean question listing the options."
        )
    if not lines:
        return ""
    return "RESOLVED ENTITIES (from fuzzy matching against the live database):\n" + "\n".join(lines)


def get_prompt_with_portfolio_hint(question: str = "", scheme_id: Optional[int] = None) -> str:
    """System prompt + portfolio-list guidance + temporal grounding + taught facts."""
    prompt = (
        get_active_system_prompt()
        + "\n\n"
        + 'For "ongoing projects", "ongoing schemes", "active packages", or "projects in progress", '
        + 'use list_packages(status="in_progress") first. Do not ask for a specific name or ID for '
        + "portfolio-wide requests. When asked to list ongoing projects, output a markdown table with "
        + "scheme/package name, status, and cost."
        + "\n\n"
        + temporal_grounding()
    )
    if question:
        er = entity_resolution_block(question)
        if er:
            prompt += "\n\n" + er
        try:
            facts = taught_context(question, scheme_id=scheme_id)
            if facts:
                prompt += "\n\n" + facts
        except Exception:
            pass  # taught facts must never take down a chat turn
    return prompt


def get_db():
    dsn = (
        os.environ.get("PROJECT_BRAIN_DB_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain"
    )
    return psycopg2.connect(dsn)


# ---------------------------------------------------------------------------
# Tool-result truncation (P1-a)
# ---------------------------------------------------------------------------

def truncate_tool_result(result, max_rows: int = TOOL_RESULT_MAX_ROWS,
                         max_bytes: int = TOOL_RESULT_MAX_BYTES):
    """Bound what enters LLM context. Caps any list to max_rows and the whole
    JSON payload to max_bytes. Structure preserved; adds truncated flags."""
    def cap_lists(obj):
        if isinstance(obj, list):
            if len(obj) > max_rows:
                return {
                    "rows": [cap_lists(x) for x in obj[:max_rows]],
                    "truncated": True,
                    "total_rows": len(obj),
                    "shown_rows": max_rows,
                }
            return [cap_lists(x) for x in obj]
        if isinstance(obj, dict):
            return {k: cap_lists(v) for k, v in obj.items()}
        return obj

    capped = cap_lists(result)
    blob = json.dumps(capped, default=str)
    if len(blob) <= max_bytes:
        return capped
    return {
        "truncated": True,
        "reason": f"result exceeded {max_bytes} bytes",
        "preview": blob[:max_bytes],
        "note": "Ask a narrower question or add filters to see specifics.",
    }


# ---------------------------------------------------------------------------
# Persistence (P0-1: user turns now saved too)
# ---------------------------------------------------------------------------

def load_conversation_history(conversation_id: int) -> list[ChatMessage]:
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT role, content FROM (
            SELECT role, content, created_at, message_id
            FROM ai_messages WHERE conversation_id=%s
            ORDER BY created_at DESC, message_id DESC
            LIMIT %s
        ) t ORDER BY created_at ASC, message_id ASC
    """,
        (conversation_id, HISTORY_MAX_MESSAGES),
    )
    msgs: list[ChatMessage] = []
    for r in cur.fetchall():
        if r["role"] in ("user", "assistant") and r["content"]:
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
            conversation_id, role, content,
            json.dumps(tools_called, default=str) if tools_called else None,
            cited_schemes or None, cited_packages or None,
            cited_documents or None, cited_chunks or None,
            provider, model, tokens_used, latency_ms, cost,
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


# ---------------------------------------------------------------------------
# Core grounded tool loop — shared by chat_once and chat_stream
# ---------------------------------------------------------------------------

FINAL_SYNTH_NUDGE = (
    "You have gathered enough data. Do NOT request more tools. "
    "Answer the user's question now using ONLY the tool results above. "
    "If something is still unknown, say so explicitly."
)


class _LoopState:
    __slots__ = ("msgs", "tools_called", "cited_scheme_ids", "cited_package_ids",
                 "cited_document_ids", "cited_chunk_ids", "task_type")

    def __init__(self, msgs: list[ChatMessage], task_type: str):
        self.msgs = msgs
        self.task_type = task_type
        self.tools_called: list[dict] = []
        self.cited_scheme_ids: set[int] = set()
        self.cited_package_ids: set[int] = set()
        self.cited_document_ids: set[int] = set()
        self.cited_chunk_ids: set[int] = set()


async def _run_tool_rounds(
    router, state: _LoopState, tools: list[dict],
    forced_provider: Optional[str], strict_forced: bool,
    model_override: Optional[str] = None,
):
    """Run tool rounds until the model stops requesting tools OR the budget is
    spent. Returns (last_response_or_None, exhausted: bool). On exhaustion the
    caller makes one final tools=None call (P0-3)."""
    for round_no in range(MAX_TOOL_ROUNDS):
        resp = await _router_call(
            router, state.msgs, state.task_type, tools,
            forced_provider, strict_forced, model_override,
        )
        if not resp.tool_calls:
            return resp, False

        state.msgs.append(ChatMessage(
            role="assistant", content=resp.content, tool_calls=resp.tool_calls,
        ))
        for tc in resp.tool_calls:
            # off the event loop (P1-d)
            result = await asyncio.to_thread(call_tool, tc.name, tc.arguments)
            state.tools_called.append({"tool": tc.name, "args": tc.arguments, "result": result})

            if isinstance(result, dict):
                state.cited_scheme_ids.update(result.get("cited_scheme_ids") or [])
                state.cited_package_ids.update(result.get("cited_package_ids") or [])
                state.cited_document_ids.update(result.get("cited_document_ids") or [])
                state.cited_chunk_ids.update(result.get("cited_chunk_ids") or [])

            slim = truncate_tool_result(result)
            state.msgs.append(ChatMessage(
                role="tool", content=json.dumps(slim, default=str),
                tool_call_id=tc.id, name=tc.name,
            ))
    return None, True


async def _router_call(router, msgs, task_type, tools, forced_provider,
                       strict_forced, model_override):
    """Call router; pass model_override if the router supports it (patched
    router), otherwise fall back to the plain signature."""
    kwargs = dict(task_type=task_type, tools=tools,
                  forced_provider=forced_provider, strict_forced=strict_forced)
    try:
        return await router.call(msgs, model_override=model_override, **kwargs)
    except TypeError:
        return await router.call(msgs, **kwargs)


def _prepare_msgs(conversation_id: int, message: str, scheme_id: Optional[int]) -> list[ChatMessage]:
    history = load_conversation_history(conversation_id)
    return (
        [ChatMessage(role="system", content=get_prompt_with_portfolio_hint(message, scheme_id))]
        + history
        + [ChatMessage(role="user", content=message)]
    )


# ---------------------------------------------------------------------------
# chat_once — non-streaming
# ---------------------------------------------------------------------------

async def chat_once(
    conversation_id: int,
    user_id: int,
    message: str,
    scheme_id: int = None,
    package_id: int = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
    model_override: Optional[str] = None,
) -> dict:
    router = get_router()

    # P0-1: persist the user's turn FIRST so history is complete from now on.
    await asyncio.to_thread(persist_message, conversation_id, "user", message)

    msgs = await asyncio.to_thread(_prepare_msgs, conversation_id, message, scheme_id)
    task_type = await router.classify(message)
    tools = get_tools_for_llm()
    state = _LoopState(msgs, task_type)

    started = time.time()
    resp, exhausted = await _run_tool_rounds(
        router, state, tools, forced_provider, strict_forced, model_override)

    if exhausted:
        # P0-3: one final call WITHOUT tools — synthesize, don't error out.
        state.msgs.append(ChatMessage(role="system", content=FINAL_SYNTH_NUDGE))
        resp = await _router_call(router, state.msgs, state.task_type, None,
                                  forced_provider, strict_forced, model_override)

    latency_ms = int((time.time() - started) * 1000)
    final_text = (resp.content or "").strip() if resp else ""
    if not final_text:
        final_text = ("I gathered data but could not produce a final answer "
                      "(provider error). Please retry.")
    total_tokens = int(((resp.input_tokens or 0) + (resp.output_tokens or 0)) if resp else 0)

    await asyncio.to_thread(
        persist_message, conversation_id, "assistant", final_text,
        state.tools_called,
        sorted(state.cited_scheme_ids), sorted(state.cited_package_ids),
        sorted(state.cited_document_ids), sorted(state.cited_chunk_ids),
        resp.provider if resp else "none", resp.model if resp else "none",
        total_tokens, latency_ms, (resp.cost_usd or 0.0) if resp else 0.0,
    )
    return {
        "reply": final_text,
        "response": final_text,
        "provider": resp.provider if resp else "none",
        "model": resp.model if resp else "none",
        "task_type": task_type,
        "tokens_used": total_tokens,
        "latency_ms": latency_ms,
        "cost_usd": (resp.cost_usd if resp else 0.0),
        "tool_rounds_exhausted": exhausted,
        "cited_scheme_ids": sorted(state.cited_scheme_ids),
        "cited_package_ids": sorted(state.cited_package_ids),
        "cited_document_ids": sorted(state.cited_document_ids),
        "cited_chunk_ids": sorted(state.cited_chunk_ids),
    }


# ---------------------------------------------------------------------------
# chat_stream — P0-2: grounded streaming
# Runs the SAME tool loop (non-streamed), then streams only the final answer.
# Persists both turns. Chunk shape {"provider","model","text"} kept identical
# to v1 so the existing SSE UI works unchanged; a final {"done": true, ...}
# meta chunk carries citations (additive — old UIs ignore it).
# ---------------------------------------------------------------------------

async def chat_stream(
    conversation_id: int,
    user_id: int,
    message: str,
    scheme_id: int = None,
    package_id: int = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
    model_override: Optional[str] = None,
) -> AsyncIterator[dict]:
    router = get_router()

    await asyncio.to_thread(persist_message, conversation_id, "user", message)

    msgs = await asyncio.to_thread(_prepare_msgs, conversation_id, message, scheme_id)
    task_type = await router.classify(message)
    tools = get_tools_for_llm()
    state = _LoopState(msgs, task_type)
    started = time.time()

    resp, exhausted = await _run_tool_rounds(
        router, state, tools, forced_provider, strict_forced, model_override)

    # Build the message list for the streamed final synthesis.
    if exhausted:
        state.msgs.append(ChatMessage(role="system", content=FINAL_SYNTH_NUDGE))
    elif resp is not None:
        # Model already produced the final text without needing a re-call —
        # but we want streamed delivery, so ask it to write the final answer
        # from the gathered context (tool messages already in msgs).
        if not state.tools_called:
            # No tools used at all: stream the plain answer directly.
            final_text = (resp.content or "").strip()
            for piece in _rechunk(final_text):
                yield {"provider": resp.provider, "model": resp.model, "text": piece}
            await _persist_stream_result(conversation_id, final_text, state, resp,
                                         int((time.time() - started) * 1000))
            yield _done_meta(state, resp, final_text)
            return
        # Tools were used and resp is the grounded final: stream it as-is.
        final_text = (resp.content or "").strip()
        for piece in _rechunk(final_text):
            yield {"provider": resp.provider, "model": resp.model, "text": piece}
        await _persist_stream_result(conversation_id, final_text, state, resp,
                                     int((time.time() - started) * 1000))
        yield _done_meta(state, resp, final_text)
        return

    # Exhausted path: stream the forced no-tools synthesis live.
    buf: list[str] = []
    provider_name, model_name = "none", "none"
    async for chunk in router.stream(
        state.msgs, task_type=state.task_type, tools=None,
        forced_provider=forced_provider, strict_forced=strict_forced,
    ):
        provider_name = chunk.get("provider", provider_name)
        model_name = chunk.get("model", model_name)
        text = chunk.get("text", "")
        buf.append(text)
        yield chunk
    final_text = "".join(buf).strip()
    await asyncio.to_thread(
        persist_message, conversation_id, "assistant", final_text,
        state.tools_called,
        sorted(state.cited_scheme_ids), sorted(state.cited_package_ids),
        sorted(state.cited_document_ids), sorted(state.cited_chunk_ids),
        provider_name, model_name, 0, int((time.time() - started) * 1000), 0.0,
    )
    yield {"done": True, "provider": provider_name, "model": model_name,
           "cited_scheme_ids": sorted(state.cited_scheme_ids),
           "cited_package_ids": sorted(state.cited_package_ids),
           "cited_document_ids": sorted(state.cited_document_ids),
           "tool_rounds_exhausted": True}


def _rechunk(text: str, size: int = 48):
    """Yield a completed answer in small pieces so the UI still 'streams'."""
    for i in range(0, len(text), size):
        yield text[i:i + size]


async def _persist_stream_result(conversation_id, final_text, state, resp, latency_ms):
    total_tokens = int((resp.input_tokens or 0) + (resp.output_tokens or 0))
    await asyncio.to_thread(
        persist_message, conversation_id, "assistant", final_text,
        state.tools_called,
        sorted(state.cited_scheme_ids), sorted(state.cited_package_ids),
        sorted(state.cited_document_ids), sorted(state.cited_chunk_ids),
        resp.provider, resp.model, total_tokens, latency_ms, resp.cost_usd or 0.0,
    )


def _done_meta(state, resp, final_text):
    total_tokens = int((resp.input_tokens or 0) + (resp.output_tokens or 0))
    return {"done": True, "provider": resp.provider, "model": resp.model,
            "tokens_used": total_tokens,
            "cost_usd": resp.cost_usd or 0.0,
            "cited_scheme_ids": sorted(state.cited_scheme_ids),
            "cited_package_ids": sorted(state.cited_package_ids),
            "cited_document_ids": sorted(state.cited_document_ids),
            "tool_rounds_exhausted": False}
