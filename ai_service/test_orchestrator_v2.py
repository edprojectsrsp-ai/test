"""Behavioral verification of orchestrator v2 against the REAL upgraded tree.
Fake provider router + in-memory persistence. No DB, no API keys needed."""
import asyncio, json, sys
from unittest.mock import patch

sys.path.insert(0, ".")

from app.providers.base import ChatMessage, ChatResponse, ToolCall
import app.services.orchestrator as orch

PASS = 0; FAIL = 0
def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}")
    else: FAIL += 1; print(f"  FAIL  {name}  {detail}")

# ---------- in-memory persistence ----------
DB_MESSAGES = []
def fake_persist(conversation_id, role, content, tools_called=None,
                 cited_schemes=None, cited_packages=None, cited_documents=None,
                 cited_chunks=None, provider=None, model=None,
                 tokens_used=0, latency_ms=0, cost=0.0):
    DB_MESSAGES.append({"cid": conversation_id, "role": role, "content": content,
                        "tools_called": tools_called, "provider": provider,
                        "cited_schemes": cited_schemes})
    return len(DB_MESSAGES)

def fake_history(conversation_id):
    return [ChatMessage(role=m["role"], content=m["content"])
            for m in DB_MESSAGES if m["cid"] == conversation_id
            and m["role"] in ("user", "assistant") and m["content"]]

# ---------- fake router ----------
class FakeRouter:
    """Scriptable: each entry is either ('tools', [ToolCall..]) or ('text', str)."""
    def __init__(self, script):
        self.script = list(script); self.calls = []; self.stream_calls = []
    async def classify(self, q): return "lookup"
    async def call(self, msgs, task_type="lookup", tools=None,
                   forced_provider=None, strict_forced=False, model_override=None,
                   temperature=0.3, max_tokens=2048):
        self.calls.append({"tools": tools, "n_msgs": len(msgs),
                           "model_override": model_override,
                           "last_role": msgs[-1].role})
        kind, payload = self.script.pop(0)
        if kind == "tools":
            return ChatResponse(content=None, tool_calls=payload,
                                provider="fake", model="fake-1", finish_reason="tool_calls",
                                input_tokens=10, output_tokens=5)
        return ChatResponse(content=payload, provider="fake", model="fake-1",
                            input_tokens=10, output_tokens=20)
    async def stream(self, msgs, task_type="lookup", tools=None,
                     forced_provider=None, strict_forced=False, model_override=None,
                     temperature=0.3, max_tokens=2048):
        self.stream_calls.append({"tools": tools})
        kind, payload = self.script.pop(0)
        assert kind == "text"
        for i in range(0, len(payload), 10):
            yield {"provider": "fake", "model": "fake-1", "text": payload[i:i+10]}

TOOL_RESULT = {"packages": [{"id": i, "name": f"PKG-{i}"} for i in range(100)],
               "cited_scheme_ids": [74], "cited_package_ids": [74, 75]}
def fake_call_tool(name, args):
    return TOOL_RESULT

def run(coro): return asyncio.run(coro)

patches = [
    patch.object(orch, "persist_message", fake_persist),
    patch.object(orch, "load_conversation_history", fake_history),
    patch.object(orch, "call_tool", fake_call_tool),
    patch.object(orch, "taught_context", lambda q, scheme_id=None: "TAUGHT: MECON order date is 16.03.2026."),
    patch.object(orch, "get_active_system_prompt", lambda: orch.SYSTEM_PROMPT),
]
for p in patches: p.start()

print("── T1/T2: chat_once — user persistence, tool loop, citations, truncation ──")
DB_MESSAGES.clear()
fr = FakeRouter([
    ("tools", [ToolCall(id="c1", name="list_packages", arguments={"status": "in_progress"})]),
    ("text", "There are 100 ongoing packages (list truncated)."),
])
with patch.object(orch, "get_router", lambda: fr):
    out = run(orch.chat_once(1, 1, "list ongoing projects"))
ok("user turn persisted first", DB_MESSAGES[0]["role"] == "user" and DB_MESSAGES[0]["content"] == "list ongoing projects")
ok("assistant turn persisted", DB_MESSAGES[1]["role"] == "assistant" and "100 ongoing" in DB_MESSAGES[1]["content"])
ok("citations aggregated", out["cited_scheme_ids"] == [74] and out["cited_package_ids"] == [74, 75])
ok("tools_called recorded with FULL result", len(DB_MESSAGES[1]["tools_called"]) == 1
   and len(DB_MESSAGES[1]["tools_called"][0]["result"]["packages"]) == 100)
# the SECOND router call saw the truncated tool message in context
second_call_n = fr.calls[1]["n_msgs"]
ok("second LLM call includes tool msg", fr.calls[1]["last_role"] == "tool")
ok("reply returned", out["reply"].startswith("There are 100"))

print("── T3: multi-turn — history now contains the user turn ──")
fr2 = FakeRouter([("text", "COB-7 is scheme 74.")])
with patch.object(orch, "get_router", lambda: fr2):
    out2 = run(orch.chat_once(1, 1, "and what about COB-7?"))
ok("prior user msg visible in history", fr2.calls[0]["n_msgs"] >= 4)  # sys + u1 + a1 + u2
ok("both new turns persisted", DB_MESSAGES[-2]["role"] == "user" and DB_MESSAGES[-1]["role"] == "assistant")

print("── T4: exhaustion → forced no-tools synthesis (P0-3) ──")
DB_MESSAGES.clear()
always_tools = [("tools", [ToolCall(id=f"c{i}", name="x", arguments={})]) for i in range(orch.MAX_TOOL_ROUNDS)]
fr3 = FakeRouter(always_tools + [("text", "Synthesized from gathered data.")])
with patch.object(orch, "get_router", lambda: fr3):
    out3 = run(orch.chat_once(2, 1, "complex compound question"))
ok("no 'loop limit' error", "loop limit" not in out3["reply"].lower())
ok("synthesis answer returned", out3["reply"] == "Synthesized from gathered data.")
ok("exhausted flag set", out3["tool_rounds_exhausted"] is True)
ok("final call had tools=None", fr3.calls[-1]["tools"] is None)
ok("synth nudge present", fr3.calls[-1]["last_role"] == "system")

print("── T5: truncate_tool_result ──")
t = orch.truncate_tool_result({"rows": list(range(500))}, max_rows=40, max_bytes=100000)
ok("row cap applied", t["rows"]["truncated"] is True and t["rows"]["shown_rows"] == 40
   and t["rows"]["total_rows"] == 500)
big = orch.truncate_tool_result({"blob": "x" * 50000}, max_bytes=12000)
ok("byte cap applied", big.get("truncated") is True and len(big["preview"]) == 12000)
small = orch.truncate_tool_result({"a": [1, 2, 3]})
ok("small results untouched", small == {"a": [1, 2, 3]})

print("── T6: grounded streaming (P0-2) ──")
DB_MESSAGES.clear()
fr4 = FakeRouter([
    ("tools", [ToolCall(id="c1", name="get_progress_status", arguments={"package_id": 74})]),
    ("text", "COB-7 physical progress is 62.4% vs plan 68.0% — 5.6 pts behind."),
])
async def collect():
    chunks = []
    with patch.object(orch, "get_router", lambda: fr4):
        async for c in orch.chat_stream(3, 1, "is COB-7 on track?"):
            chunks.append(c)
    return chunks
chunks = run(collect())
text = "".join(c.get("text", "") for c in chunks if "text" in c)
ok("tool executed before stream", any(m["role"] == "assistant" and m["tools_called"] for m in DB_MESSAGES))
ok("streamed text matches final answer", text == "COB-7 physical progress is 62.4% vs plan 68.0% — 5.6 pts behind.")
ok("user turn persisted (stream)", DB_MESSAGES[0]["role"] == "user")
ok("assistant turn persisted (stream)", DB_MESSAGES[-1]["role"] == "assistant" and "62.4%" in DB_MESSAGES[-1]["content"])
ok("done meta emitted with citations", chunks[-1].get("done") is True and chunks[-1]["cited_scheme_ids"] == [74])
ok("chunk shape v1-compatible", all(("text" in c and "provider" in c) or c.get("done") for c in chunks))

print("── T7: temporal grounding ──")
import datetime as _dt
g = orch.temporal_grounding(_dt.datetime(2026, 7, 12, 10, 0, tzinfo=orch.IST))
ok("today present", "2026-07-12" in g)
ok("FY short format", "2026-27" in g)
ok("FY long format", "2026-2027" in g)
ok("FY month index", "month 4 of 12" in g)
g2 = orch.temporal_grounding(_dt.datetime(2026, 2, 10, tzinfo=orch.IST))
ok("Jan-Mar maps to prior FY", "2025-26" in g2 and "2025-2026" in g2)
sysp = orch.get_prompt_with_portfolio_hint("when was the MECON order placed?")
ok("taught fact injected", "16.03.2026" in sysp)
ok("temporal block in system prompt", "TEMPORAL CONTEXT" in sysp)

print("── T8: router clone — no singleton mutation ──")
from app.providers.router import ProviderRouter
class DummyProv:
    model_id = "orig-model"
    async def chat(self, *a, **k):
        return ChatResponse(content="ok", provider="dummy", model=self.model_id)
    async def chat_stream(self, *a, **k):
        yield "ok"
pr = ProviderRouter.__new__(ProviderRouter)   # skip _init_providers (no keys here)
pr.providers = {"groq": DummyProv()}
clone = pr._provider_for_request("groq", "llama-special")
ok("clone got override", clone.model_id == "llama-special")
ok("singleton untouched", pr.providers["groq"].model_id == "orig-model")
resp = run(pr.call([ChatMessage(role="user", content="hi")], forced_provider="groq",
                   model_override="llama-special"))
ok("call uses override model", resp.model == "llama-special")
ok("singleton still untouched after call", pr.providers["groq"].model_id == "orig-model")

for p in patches: p.stop()
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
