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
"""
import os
import json
import logging
import time
from typing import Optional, AsyncIterator
import psycopg2
import psycopg2.extras
from app.providers.router import get_router
from app.providers.base import ChatMessage, ToolCall
from app.tools.db_tools import call_tool, get_tools_for_llm

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 4
DEFAULT_TOKEN_BUDGET = 50000


SYSTEM_PROMPT = """You are PROJECT BRAIN ASSISTANT — the AI for a Rourkela Steel Plant project monitoring system.

You help engineers, PMs, and leadership get answers about schemes, packages, lifecycle stages, contracts, risks, progress, and CAPEX.

# ABSOLUTE RULES (violating these is a critical failure)

1. **NEVER invent data.** Scheme names, IDs, costs, dates, contractor names, status values, package numbers — none of these may be guessed or assumed. If you don't have a tool result that provides a value, you do not have that value. Period.

2. **You MUST call tools first.** For ANY question that references a scheme, package, status, cost, date, progress %, delay, contract, tender, or any other system data — your FIRST action is a tool call, not a text reply. Text-only replies are only permitted for:
   - Greetings ("hello", "thanks", etc)
   - Meta questions about your own capabilities
   - Requests to format / restructure something the user already provided

3. **Tool errors are real.** If a tool returns `{"error": "data_source_not_available", ...}`, that data source IS NOT CONFIGURED in this database. Tell the user that exact data isn't available. Do NOT substitute your training-data knowledge to fill the gap. Do NOT try a different tool that doesn't have the same data.

4. **Be specific about what you don't know.** If a user asks "what's the status of the coke oven scheme" and `find_scheme` returns 3 matches none of which contain "coke oven", say: "I searched for 'coke oven' and didn't find a matching scheme. The closest matches were: [list]. Could you give me the scheme ID or a more specific name?"

# TOOL-CALLING PATTERNS

For any question about a SPECIFIC scheme (by name or ID):
   1. `find_scheme` first — never assume the ID
   2. Then `get_scheme_details` with the resolved ID

For "is X on track?" / "how delayed is X?":
   - Use `get_progress_status` + `analyze_delays`

For "why is X delayed?":
   - `analyze_delays` for the package — its result includes the recent monitoring_log entries which are the actual recorded reasons
   - If no monitoring entries, say so — don't speculate

For "show me all <X>" (packages / approvals / commitments):
   - Use the corresponding `list_*` tool — do not enumerate from memory

For CAPEX questions:
   - `get_capex_summary` with scheme_id (resolve via find_scheme first if needed)

For dashboard / portfolio-wide questions:
   - `get_today_dashboard` for the snapshot
   - `get_risk_summary` for risk levels

# OUTPUT STYLE

- Be terse. Engineers don't want fluff.
- Use exact numbers, dates, names from tool results — never round, never re-format, never translate.
- Format costs in ₹ Crores (e.g. "₹12.5 Cr") matching what the tool returned.
- Format dates in ISO (YYYY-MM-DD) or "MMM YYYY".
- For lists: compact bullet points.
- ALWAYS include the scheme_id and/or package_id in your answer so the UI can link.
- If multiple tools are relevant, call them in sequence rather than fabricating fallback values.

# WHEN UNSURE

It is correct to say "I don't have that information" or "that data isn't configured in this system". It is wrong to make something up. Treat hallucination as the worst possible error.
"""


def get_db():
    dsn = os.environ.get("PROJECT_BRAIN_DB_URL",
                        "postgresql://postgres:abc123@127.0.0.1:5433/project_brain")
    return psycopg2.connect(dsn)


def load_conversation_history(conversation_id: int) -> list[ChatMessage]:
    """Load prior messages for the conversation."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT role, content, tools_called
        FROM ai_messages WHERE conversation_id=%s
        ORDER BY created_at ASC
    """, (conversation_id,))
    msgs = []
    for r in cur.fetchall():
        # Tool calls and tool results are recorded together; for simplicity, we replay text only
        # (the LLM doesn't need to see prior tool internals beyond the assistant's final text)
        if r["role"] in ("user", "assistant"):
            msgs.append(ChatMessage(role=r["role"], content=r["content"]))
    conn.close()
    return msgs


def persist_message(
    conversation_id: int, role: str, content: str,
    tools_called: Optional[list] = None,
    provider: Optional[str] = None, model: Optional[str] = None,
    tokens_used: int = 0, latency_ms: int = 0, cost: float = 0.0,
    cited_schemes: list = None, cited_packages: list = None,
    cited_documents: list = None, cited_chunks: list = None,
):
    """Save one message to ai_messages and update conversation totals."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ai_messages
            (conversation_id, role, content, tools_called,
             cited_scheme_ids, cited_package_ids, cited_document_ids, cited_chunk_ids,
             provider, model_name, tokens_used, latency_ms, cost_estimate_usd)
        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING message_id
    """, (
        conversation_id, role, content,
        json.dumps(tools_called) if tools_called else None,
        cited_schemes or None, cited_packages or None,
        cited_documents or None, cited_chunks or None,
        provider, model, tokens_used, latency_ms, cost,
    ))
    msg_id = cur.fetchone()[0]
    cur.execute("""
        UPDATE ai_conversations SET
            last_message_at = CURRENT_TIMESTAMP,
            message_count = message_count + 1,
            total_tokens = total_tokens + %s
        WHERE conversation_id = %s
    """, (tokens_used, conversation_id))
    conn.commit()
    conn.close()
    return msg_id


def create_conversation(user_id: int, scheme_id: int = None, package_id: int = None,
                        title: str = None, source: str = "web") -> int:
    """Start a new conversation. Returns conversation_id."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ai_conversations (user_id, scheme_id, package_id, title, source)
        VALUES (%s, %s, %s, %s, %s) RETURNING conversation_id
    """, (user_id, scheme_id, package_id, title, source))
    conv_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return conv_id


def extract_citations(tool_results: list[dict]) -> dict:
    """Pull scheme_id, package_id, document_id from tool result data for citation."""
    schemes, packages, docs, chunks = set(), set(), set(), set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "scheme_id" and isinstance(v, int): schemes.add(v)
                elif k == "package_id" and isinstance(v, int): packages.add(v)
                elif k == "document_id" and isinstance(v, int): docs.add(v)
                elif k == "chunk_id" and isinstance(v, int): chunks.add(v)
                walk(v)
        elif isinstance(o, list):
            for x in o: walk(x)

    for tr in tool_results: walk(tr)
    return {
        "schemes": list(schemes)[:20],
        "packages": list(packages)[:20],
        "documents": list(docs)[:20],
        "chunks": list(chunks)[:30],
    }


async def chat_once(
    user_query: str,
    conversation_id: int,
    user_id: int,
    scheme_id: Optional[int] = None,
    package_id: Optional[int] = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
) -> dict:
    """Process one user message through the full tool-calling loop.

    If `forced_provider` is set (e.g. "openai", "gemini", "groq", "ollama"),
    bypass task-aware routing and use that provider. `strict_forced=True`
    disables the fallback chain entirely (useful for testing one provider).
    """
    router = get_router()
    overall_start = time.time()

    # 1. Classify (still useful for analytics even when forced)
    task_type = await router.classify_query(user_query)
    logger.info(f"Classified '{user_query[:60]}...' as task={task_type} "
                f"(forced_provider={forced_provider})")

    # 2. Build context
    history = load_conversation_history(conversation_id)
    context_lines = [SYSTEM_PROMPT]
    if scheme_id:
        context_lines.append(f"\nCURRENT CONTEXT: scheme_id={scheme_id}")
    if package_id:
        context_lines.append(f"\nCURRENT CONTEXT: package_id={package_id}")
    messages: list[ChatMessage] = [ChatMessage(role="system", content="\n".join(context_lines))]
    messages.extend(history)
    messages.append(ChatMessage(role="user", content=user_query))

    # Persist user message
    persist_message(conversation_id, "user", user_query)

    tools = get_tools_for_llm()
    tool_results_accumulated: list[dict] = []
    tool_calls_log: list[dict] = []
    total_tokens, total_cost, total_latency = 0, 0.0, 0
    final_response: Optional[str] = None
    used_provider, used_model = None, None

    # 3. Tool-calling loop
    for round_no in range(MAX_TOOL_ROUNDS):
        resp = await router.call(messages, task_type=task_type, tools=tools,
                                 temperature=0.3, max_tokens=2048,
                                 forced_provider=forced_provider,
                                 strict_forced=strict_forced)
        if resp.error or resp.finish_reason == "error":
            final_response = f"⚠️ AI error: {resp.error}"
            break

        total_tokens += resp.input_tokens + resp.output_tokens
        total_cost += resp.cost_usd
        total_latency += resp.latency_ms
        used_provider, used_model = resp.provider, resp.model

        if not resp.tool_calls:
            # Final answer
            final_response = resp.content
            break

        # Execute tool calls
        # Append the assistant turn (with tool_calls) to the message history
        messages.append(ChatMessage(role="assistant", content=resp.content,
                                    tool_calls=resp.tool_calls))
        for tc in resp.tool_calls:
            logger.info(f"Tool call: {tc.name}({json.dumps(tc.arguments)[:120]})")
            result = call_tool(tc.name, tc.arguments)
            tool_results_accumulated.append(result)
            tool_calls_log.append({"name": tc.name, "args": tc.arguments, "result_preview": str(result)[:200]})
            messages.append(ChatMessage(
                role="tool", content=json.dumps(result), tool_call_id=tc.id, name=tc.name
            ))

    if final_response is None:
        final_response = "Hit max tool-calling rounds. Try a more focused question."

    # 4. Extract citations
    citations = extract_citations(tool_results_accumulated)

    # 5. Persist assistant response
    persist_message(
        conversation_id, "assistant", final_response,
        tools_called=tool_calls_log,
        provider=used_provider, model=used_model,
        tokens_used=total_tokens, latency_ms=total_latency, cost=total_cost,
        cited_schemes=citations["schemes"], cited_packages=citations["packages"],
        cited_documents=citations["documents"], cited_chunks=citations["chunks"],
    )

    return {
        "response": final_response,
        "task_type": task_type,
        "provider": used_provider,
        "model": used_model,
        "tokens_used": total_tokens,
        "cost_usd": round(total_cost, 6),
        "latency_ms": int((time.time() - overall_start) * 1000),
        "tool_calls": tool_calls_log,
        "citations": citations,
    }


async def chat_stream(
    user_query: str,
    conversation_id: int,
    user_id: int,
    scheme_id: Optional[int] = None,
    package_id: Optional[int] = None,
    forced_provider: Optional[str] = None,
    strict_forced: bool = False,
) -> AsyncIterator[dict]:
    """Streaming version. Yields events:
        {"type": "task_type", "value": "analysis"}
        {"type": "tool_call", "name": "find_scheme", "args": {...}}
        {"type": "tool_result", "name": "find_scheme", "preview": "..."}
        {"type": "token", "text": "..."}
        {"type": "done", "tokens": 1234, "cost_usd": 0.001}

    Strategy: run tool-calling loop non-streaming. Stream only the final assistant turn.
    """
    router = get_router()
    overall_start = time.time()
    task_type = await router.classify_query(user_query)
    yield {"type": "task_type", "value": task_type}

    history = load_conversation_history(conversation_id)
    context_lines = [SYSTEM_PROMPT]
    if scheme_id: context_lines.append(f"\nCURRENT CONTEXT: scheme_id={scheme_id}")
    if package_id: context_lines.append(f"\nCURRENT CONTEXT: package_id={package_id}")
    messages: list[ChatMessage] = [ChatMessage(role="system", content="\n".join(context_lines))]
    messages.extend(history)
    messages.append(ChatMessage(role="user", content=user_query))
    persist_message(conversation_id, "user", user_query)

    tools = get_tools_for_llm()
    tool_results_accum: list[dict] = []
    tool_log: list[dict] = []
    total_tokens, total_cost = 0, 0.0
    used_provider, used_model = None, None

    # Tool-calling loop (non-streaming)
    for round_no in range(MAX_TOOL_ROUNDS):
        resp = await router.call(messages, task_type=task_type, tools=tools,
                                 temperature=0.3, max_tokens=2048,
                                 forced_provider=forced_provider,
                                 strict_forced=strict_forced)
        if resp.error:
            yield {"type": "error", "message": resp.error}
            return
        total_tokens += resp.input_tokens + resp.output_tokens
        total_cost += resp.cost_usd
        used_provider, used_model = resp.provider, resp.model

        if not resp.tool_calls:
            # Final answer - now stream it (without tools, no streaming-during-tools complexity)
            final_messages = messages + [ChatMessage(role="assistant", content=resp.content)]
            # Actually just yield what we have
            for chunk_text in (resp.content or "").split(" "):
                yield {"type": "token", "text": chunk_text + " "}
            # Persist
            citations = extract_citations(tool_results_accum)
            persist_message(
                conversation_id, "assistant", resp.content or "",
                tools_called=tool_log, provider=used_provider, model=used_model,
                tokens_used=total_tokens, latency_ms=int((time.time() - overall_start) * 1000),
                cost=total_cost,
                cited_schemes=citations["schemes"], cited_packages=citations["packages"],
                cited_documents=citations["documents"], cited_chunks=citations["chunks"],
            )
            yield {"type": "done", "tokens": total_tokens, "cost_usd": round(total_cost, 6),
                   "provider": used_provider, "model": used_model, "citations": citations}
            return

        messages.append(ChatMessage(role="assistant", content=resp.content, tool_calls=resp.tool_calls))
        for tc in resp.tool_calls:
            yield {"type": "tool_call", "name": tc.name, "args": tc.arguments}
            result = call_tool(tc.name, tc.arguments)
            tool_results_accum.append(result)
            tool_log.append({"name": tc.name, "args": tc.arguments})
            yield {"type": "tool_result", "name": tc.name, "preview": str(result)[:300]}
            messages.append(ChatMessage(role="tool", content=json.dumps(result),
                                        tool_call_id=tc.id, name=tc.name))

    yield {"type": "error", "message": "Hit max tool-calling rounds"}
