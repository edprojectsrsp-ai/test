"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Brain, Wrench, FileText, Sparkles, Loader2,
  AlertTriangle, ChevronRight, MessageSquarePlus, Database, Cpu
} from "lucide-react";

const AI_API = process.env.NEXT_PUBLIC_AI_API_URL || "http://localhost:8001";
const USER_ID = 1; // TODO: pull from auth

type Citation = {
  schemes: number[]; packages: number[]; documents: number[]; chunks: number[];
};

type Msg = {
  role: "user" | "assistant" | "system";
  content: string;
  meta?: {
    provider?: string; model?: string; tokens?: number; cost?: number;
    task_type?: string; citations?: Citation; tools?: string[];
  };
};

type StreamEvent =
  | { type: "task_type"; value: string }
  | { type: "tool_call"; name: string; args: any }
  | { type: "tool_result"; name: string; preview: string }
  | { type: "token"; text: string }
  | { type: "done"; tokens: number; cost_usd: number; provider: string; model: string; citations: Citation }
  | { type: "error"; message: string };

export default function AIChatPage() {
  const [convId, setConvId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentTaskType, setCurrentTaskType] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ provider?: string; model?: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${AI_API}/ai/conversations/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, source: "web" }),
    }).then(r => r.json()).then(d => setConvId(d.conversation_id));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, currentTaskType, activeTool]);

  const sendStream = async () => {
    if (!input.trim() || !convId || busy) return;
    const q = input.trim();
    setInput("");
    setMsgs(m => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setBusy(true);
    setCurrentTaskType(null); setActiveTool(null); setProviderInfo(null);

    const resp = await fetch(`${AI_API}/ai/chat/stream`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: convId, user_id: USER_ID, message: q }),
    });
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let toolsUsed: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6)) as StreamEvent;
          if (ev.type === "task_type") setCurrentTaskType(ev.value);
          else if (ev.type === "tool_call") { setActiveTool(ev.name); toolsUsed.push(ev.name); }
          else if (ev.type === "tool_result") setActiveTool(null);
          else if (ev.type === "token") {
            setMsgs(m => { const copy = [...m]; copy[copy.length - 1].content += ev.text; return copy; });
          } else if (ev.type === "done") {
            setMsgs(m => {
              const copy = [...m];
              copy[copy.length - 1].meta = {
                provider: ev.provider, model: ev.model,
                tokens: ev.tokens, cost: ev.cost_usd,
                task_type: currentTaskType || undefined,
                citations: ev.citations, tools: toolsUsed,
              };
              return copy;
            });
            setProviderInfo({ provider: ev.provider, model: ev.model });
          } else if (ev.type === "error") {
            setMsgs(m => { const copy = [...m]; copy[copy.length - 1].content = `⚠️ ${ev.message}`; return copy; });
          }
        } catch {}
      }
    }
    setBusy(false); setActiveTool(null);
  };

  const newConv = async () => {
    const r = await fetch(`${AI_API}/ai/conversations/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, source: "web" }),
    }).then(r => r.json());
    setConvId(r.conversation_id); setMsgs([]);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold">Project Brain AI</h1>
            <p className="text-xs text-zinc-500">Multi-provider · task-aware routing · RAG-enabled</p>
          </div>
          <span className="px-2 py-0.5 text-xs font-mono rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">SPRINT 8 · INTELLIGENCE</span>
        </div>
        <div className="flex items-center gap-2">
          {providerInfo?.provider && (
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Cpu className="w-3 h-3" />{providerInfo.provider} · {providerInfo.model}
            </span>
          )}
          <button onClick={newConv} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg">
            <MessageSquarePlus className="w-4 h-4" />New
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full mx-auto">
        {msgs.length === 0 && (
          <div className="text-center text-zinc-500 mt-20">
            <Sparkles className="w-10 h-10 mx-auto mb-3 text-indigo-400" />
            <p className="text-lg">Ask anything about your projects.</p>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
              {[
                "Why is COB-7 delayed?",
                "Show me all red-risk packages",
                "What's the current cost of scheme 5?",
                "Draft a monthly review note for COB-7",
                "Find documents about the latest tender",
                "List commitments overdue this week",
              ].map(q => (
                <button key={q} onClick={() => setInput(q)}
                  className="text-left p-3 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-300">
                  → {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`mb-5 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                m.role === "user" ? "bg-indigo-600/30 border border-indigo-500/40" : "bg-zinc-900/70 border border-zinc-800"}`}>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{m.content || (busy && i === msgs.length - 1 ? "..." : "")}</pre>
                {m.meta && (
                  <div className="mt-2 pt-2 border-t border-zinc-800/70 text-[11px] text-zinc-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {m.meta.task_type && <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-300 rounded">{m.meta.task_type}</span>}
                    {m.meta.provider && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{m.meta.provider}</span>}
                    {m.meta.tokens != null && <span>{m.meta.tokens} tok</span>}
                    {m.meta.cost != null && <span>${m.meta.cost.toFixed(4)}</span>}
                    {m.meta.tools && m.meta.tools.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Wrench className="w-3 h-3" />
                        {Array.from(new Set(m.meta.tools)).join(", ")}
                      </span>
                    )}
                    {m.meta.citations && (m.meta.citations.schemes.length > 0 || m.meta.citations.packages.length > 0) && (
                      <span className="flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        {m.meta.citations.schemes.length > 0 && `${m.meta.citations.schemes.length} schemes`}
                        {m.meta.citations.packages.length > 0 && ` ${m.meta.citations.packages.length} pkgs`}
                        {m.meta.citations.documents.length > 0 && ` ${m.meta.citations.documents.length} docs`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Live status indicator */}
        {busy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm text-zinc-400 mb-4">
            {currentTaskType && (
              <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded text-xs">
                routing · {currentTaskType}
              </span>
            )}
            {activeTool && (
              <span className="flex items-center gap-1">
                <Wrench className="w-4 h-4 animate-pulse text-amber-400" />
                running <code className="text-amber-300">{activeTool}</code>
              </span>
            )}
            {!activeTool && currentTaskType && <Loader2 className="w-4 h-4 animate-spin" />}
          </motion.div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <footer className="border-t border-zinc-800 p-4">
        <div className="max-w-4xl mx-auto flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendStream())}
            placeholder="Ask about schemes, packages, risks, documents..."
            disabled={!convId || busy}
            className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
          <button onClick={sendStream} disabled={!input.trim() || busy || !convId}
            className="px-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 rounded-lg flex items-center gap-2">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </footer>
    </div>
  );
}
