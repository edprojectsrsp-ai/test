"use client";

/**
 * Project Brain AI — Neural Chat Interface
 *
 * Full-window immersive chat with animated thinking state:
 *   • Swirling neural orb (concentric rotating rings with nodes)
 *   • Matrix data-stream (hex chars scanning over db table names)
 *   • Auto-cycling process log ("Scanning scheme_master…", etc.)
 *   • Scrambled-text decode effect
 *   • Tool-call tracker with live database names
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Check, ChevronRight, Copy, Cpu, Loader2,
  RefreshCw, Send, Wrench, X, Zap,
} from "lucide-react";

const AI_API  = process.env.NEXT_PUBLIC_AI_API_URL || "http://localhost:8001";
const USER_ID = 1;

const PROVIDERS = [
  { label: "Auto (Cascade)",        value: "auto",                     note: "Tries each in order" },
  { label: "Groq · Llama 3 8B",     value: "groq/llama3-8b-8192",      note: "Free · Fast" },
  { label: "Groq · Llama 3 70B",    value: "groq/llama3-70b-8192",     note: "Free · Best" },
  { label: "Groq · Mixtral 8×7B",   value: "groq/mixtral-8x7b-32768",  note: "Free · Long ctx" },
  { label: "Groq · Gemma 7B",       value: "groq/gemma-7b-it",         note: "Free · Google" },
  { label: "Gemini 1.5 Flash",      value: "gemini/gemini-1.5-flash",  note: "Free · Google" },
  { label: "Gemini 2.0 Flash",      value: "gemini/gemini-2.0-flash",  note: "Free · Latest" },
  { label: "Cerebras · Llama 3",    value: "cerebras/llama3.1-8b",     note: "Free · Ultra-fast" },
  { label: "Ollama · Qwen3 8B",     value: "ollama/qwen3:8b",          note: "Local · No key" },
  { label: "Ollama · Mistral 7B",   value: "ollama/mistral",           note: "Local · No key" },
] as const;

// ─────────────────────── Types ───────────────────────────────────────────────

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: { provider?: string; model?: string; tokens?: number; tools?: string[] };
  streaming?: boolean;
};

type StreamEvent =
  | { type: "task_type"; value: string }
  | { type: "tool_call"; name: string }
  | { type: "tool_result"; name: string; preview: string }
  | { type: "token"; text: string }
  | { type: "done"; tokens: number; cost_usd: number; provider: string; model: string }
  | { type: "error"; message: string };

const SUGGESTIONS = [
  "What is the overall status of COB-7?",
  "List all packages with delayed completion dates.",
  "Which schemes have the highest CAPEX budget?",
  "Show me physical progress of scheme 74.",
  "What are the ongoing tender cycles?",
  "Find schemes under tendering with cost above 100 Cr.",
];

// ─────────────────────── Neural background ───────────────────────────────────

function NeuralBackground({ active }: { active: boolean }) {
  const nodes = [
    {x:10,y:15},{x:25,y:8},{x:40,y:20},{x:55,y:5},{x:70,y:18},{x:85,y:10},{x:95,y:25},
    {x:15,y:40},{x:30,y:45},{x:50,y:38},{x:65,y:50},{x:80,y:42},{x:90,y:55},
    {x:5,y:65},{x:20,y:70},{x:38,y:60},{x:55,y:72},{x:72,y:65},{x:88,y:75},
    {x:12,y:88},{x:28,y:82},{x:45,y:90},{x:62,y:85},{x:78,y:92},{x:93,y:80},
  ];
  const edges = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],
    [0,7],[1,8],[2,9],[3,10],[4,11],[5,12],
    [7,8],[8,9],[9,10],[10,11],[11,12],
    [7,13],[8,14],[9,15],[10,16],[11,17],[12,18],
    [13,14],[14,15],[15,16],[16,17],[17,18],
    [13,19],[14,20],[15,21],[16,22],[17,23],[18,24],
    [19,20],[20,21],[21,22],[22,23],[23,24],
  ];
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
      viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      {edges.map(([a,b],i) => (
        <motion.line key={i}
          x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke={active ? "#22d3ee" : "#334155"}
          animate={active ? { opacity:[0.2,0.7,0.2], strokeWidth:["0.1","0.35","0.1"] } : { opacity:0.2 }}
          transition={active ? { duration:1.5+(i%5)*0.3, repeat:Infinity, delay:(i*0.07)%1.5 } : {}}
        />
      ))}
      {nodes.map((n,i) => (
        <motion.circle key={i} cx={n.x} cy={n.y}
          fill={active ? "#22d3ee" : "#475569"}
          animate={active ? { r:["0.4","1.1","0.4"], opacity:[0.4,1,0.4] } : { r:"0.4", opacity:0.3 }}
          transition={active ? { duration:1.8+(i%4)*0.4, repeat:Infinity, delay:(i*0.1)%2 } : {}}
        />
      ))}
    </svg>
  );
}

// ─────────────────────── Swirling brain orb ──────────────────────────────────

function SwirlOrb() {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      {/* Outer rotating ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        className="absolute h-28 w-28 rounded-full border border-cyan-500/30"
        style={{ borderTopColor: "#22d3ee", borderRightColor: "transparent" }}
      />
      {/* Mid ring opposite rotation */}
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        className="absolute h-20 w-20 rounded-full border border-blue-400/30"
        style={{ borderTopColor: "transparent", borderBottomColor: "#60a5fa" }}
      />
      {/* Inner ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="absolute h-12 w-12 rounded-full border border-violet-400/40"
        style={{ borderLeftColor: "#a78bfa", borderTopColor: "transparent" }}
      />
      {/* Orbiting dots on outer ring */}
      {[0,120,240].map((deg,i) => (
        <motion.div
          key={i}
          className="absolute h-2 w-2 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/60"
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear", delay: 0 }}
          style={{
            originX: "50%", originY: "50%",
            transform: `rotate(${deg}deg) translateY(-54px)`,
          }}
        />
      ))}
      {/* Center brain icon */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="z-10 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-600/30 ring-1 ring-cyan-500/50"
      >
        <Brain className="h-5 w-5 text-cyan-300" />
      </motion.div>
    </div>
  );
}

// ─────────────────────── Matrix data stream ──────────────────────────────────

const MATRIX_CHARS = "ABCDEF0123456789abcdefghijklmnop∑∂∇∆αβγδεζ";
const DB_REFS = [
  "scheme_master[74]", "packages[76]", "plan_activities", "daily_actuals",
  "capex_plan_values", "tender_cycles", "progress_plans[5]", "appendix2_items",
  "monthly_plan_entries", "field_observations", "billing_schedules",
];

function MatrixStream() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const tick = () => {
      setLines(prev => {
        const next = [...prev];
        // Add a new line occasionally
        if (Math.random() > 0.4) {
          const ref = DB_REFS[Math.floor(Math.random() * DB_REFS.length)];
          const noise = Array.from({ length: Math.floor(Math.random() * 8 + 4) }, () =>
            MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]
          ).join("");
          next.push(`${noise} → ${ref}`);
        }
        return next.slice(-6); // keep last 6
      });
    };
    const id = setInterval(tick, 220);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-36 overflow-hidden font-mono text-[10px] leading-5 text-cyan-500/70">
      <AnimatePresence initial={false} mode="popLayout">
        {lines.map((line, i) => (
          <motion.div
            key={`${line}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: [0, 0.8, 0.4] }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.4 }}
            className="truncate"
          >
            <span className="text-cyan-300/50">›</span> {line}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────── Scrambled-text decode ───────────────────────────────

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";

function ScrambleText({ text, speed = 40 }: { text: string; speed?: number }) {
  const [display, setDisplay] = useState(() =>
    text.split("").map(() => SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]).join("")
  );
  const iter = useRef(0);

  useEffect(() => {
    iter.current = 0;
    const id = setInterval(() => {
      iter.current += 1;
      setDisplay(
        text.split("").map((ch, i) =>
          i < iter.current
            ? ch
            : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        ).join("")
      );
      if (iter.current >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return <span className="font-mono">{display}</span>;
}

// ─────────────────────── Process log ─────────────────────────────────────────

const PROCESS_STAGES = [
  "Parsing query intent…",
  "Routing to inference engine…",
  "Scanning scheme_master (74 records)…",
  "Cross-referencing packages table…",
  "Aggregating plan_activities…",
  "Querying daily_actuals…",
  "Computing CAPEX aggregates…",
  "Loading tender_cycles…",
  "Checking progress_plans…",
  "Synthesizing response…",
  "Applying domain context (RSP/SAIL)…",
  "Verifying data integrity…",
  "Formatting output…",
];

function ProcessLog({ activeTool, taskType }: { activeTool: string | null; taskType: string | null }) {
  const [stageIdx, setStageIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setStageIdx(0);
    setHistory([]);
    const id = setInterval(() => {
      setStageIdx(prev => {
        const next = (prev + 1) % PROCESS_STAGES.length;
        setHistory(h => [...h.slice(-4), PROCESS_STAGES[prev]]);
        return next;
      });
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const current = activeTool
    ? `Executing tool: ${activeTool}…`
    : taskType
    ? `Task: ${taskType}…`
    : PROCESS_STAGES[stageIdx];

  return (
    <div className="space-y-1.5">
      {/* History (fading) */}
      {history.slice(-3).map((h, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px] text-zinc-600 line-through">
          <Check className="h-2.5 w-2.5 text-green-600 shrink-0" />
          {h}
        </div>
      ))}
      {/* Current step */}
      <motion.div
        key={current}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2 text-xs text-cyan-300"
      >
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400"
        />
        <ScrambleText text={current} speed={30} />
      </motion.div>
    </div>
  );
}

// ─────────────────────── Full thinking block ─────────────────────────────────

function ThinkingBlock({ activeTool, taskType }: { activeTool: string | null; taskType: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3"
    >
      {/* Brain avatar */}
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600">
        <Brain className="h-4 w-4 text-white" />
      </div>

      {/* Thinking panel */}
      <div className="flex-1 overflow-hidden rounded-2xl border border-cyan-500/20 bg-zinc-900/90 backdrop-blur-sm">
        {/* Top bar */}
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-2">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-cyan-400"
          />
          <span className="text-xs font-medium text-cyan-400">Project Brain is thinking</span>
          <div className="ml-auto flex gap-0.5">
            {[0.2,0.4,0.6].map((d,i) => (
              <motion.div
                key={i}
                className="h-3.5 w-0.5 rounded-full bg-cyan-500"
                animate={{ scaleY: [0.3, 1, 0.3] }}
                transition={{ duration: 0.7, repeat: Infinity, delay: d }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
          {/* Swirling orb */}
          <div className="flex flex-col items-center justify-center gap-3">
            <SwirlOrb />
            <motion.p
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-center text-[10px] text-zinc-500"
            >
              Neural inference active
            </motion.p>
          </div>

          {/* Process log + data stream */}
          <div className="space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Process Log</p>
            <ProcessLog activeTool={activeTool} taskType={taskType} />
          </div>

          {/* Matrix stream */}
          <div>
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">DB Scan</p>
            <MatrixStream />
          </div>
        </div>

        {/* Bottom scanner bar */}
        <div className="relative h-0.5 overflow-hidden bg-zinc-800">
          <motion.div
            className="absolute h-full w-32 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
            animate={{ x: ["-128px", "100vw"] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────── Message bubble ──────────────────────────────────────

function MessageBubble({
  msg,
  activeTool,
  taskType,
}: {
  msg: Msg;
  activeTool: string | null;
  taskType: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const copy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Show thinking block for the ENTIRE streaming duration (not just before first token)
  if (!isUser && msg.streaming) {
    return (
      <div className="space-y-3">
        <ThinkingBlock activeTool={activeTool} taskType={taskType} />
        {/* Growing text appears below the animation as tokens stream in */}
        {msg.content !== "" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3 pl-11"
          >
            <div className="max-w-[78%] rounded-2xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-3 text-sm leading-relaxed text-zinc-200">
              <span className="whitespace-pre-wrap">{msg.content}</span>
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="ml-0.5 inline-block h-4 w-0.5 bg-cyan-400 align-middle"
              />
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${
        isUser
          ? "bg-gradient-to-br from-amber-500 to-orange-500"
          : "bg-gradient-to-br from-cyan-500 to-blue-600"
      }`}>
        {isUser ? <span className="text-xs font-bold">You</span> : <Brain className="h-4 w-4" />}
      </div>

      <div className={`group relative max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? "border border-amber-500/30 bg-gradient-to-br from-amber-500/20 to-orange-500/10 text-amber-50"
          : "border border-zinc-700/50 bg-zinc-800/80 text-zinc-200"
      }`}>
        <span className="whitespace-pre-wrap">{msg.content}</span>

        {/* Meta footer */}
        {!isUser && !msg.streaming && msg.meta?.provider && (
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-zinc-700/50 pt-2 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {msg.meta.provider} / {msg.meta.model?.split("-").slice(-2).join("-")}
            </span>
            {msg.meta.tokens && <span>{msg.meta.tokens.toLocaleString()} tokens</span>}
            {msg.meta.tools && msg.meta.tools.length > 0 && (
              <span className="flex items-center gap-1 text-cyan-500">
                <Wrench className="h-3 w-3" /> {msg.meta.tools.join(", ")}
              </span>
            )}
          </div>
        )}

        {/* Copy */}
        {!isUser && !msg.streaming && msg.content && (
          <button
            onClick={copy}
            className="absolute -right-2 -top-2 hidden rounded-full bg-zinc-700 p-1 text-zinc-400 hover:text-white group-hover:block"
          >
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────── Page ────────────────────────────────────────────────

export default function AIChatPage() {
  const [convId, setConvId]         = useState<number | null>(null);
  const [msgs, setMsgs]             = useState<Msg[]>([]);
  const [input, setInput]           = useState("");
  const [busy, setBusy]             = useState(false);
  const [taskType, setTaskType]     = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ provider?: string; model?: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const startConv = useCallback(() => {
    setError(null);
    fetch(`${AI_API}/ai/conversations/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, source: "web" }),
    })
      .then(r => r.json())
      .then(d => setConvId(d.conversation_id))
      .catch(() => setError("Cannot connect to AI service on port 8001. Start the AI microservice first."));
  }, []);

  useEffect(() => { startConv(); }, [startConv]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    if (!convId) { setError("No active conversation. Retrying…"); startConv(); return; }

    setInput("");
    setError(null);
    const uid  = Date.now().toString();
    const aid  = (Date.now() + 1).toString();
    setMsgs(m => [...m,
      { id: uid, role: "user", content: q },
      { id: aid, role: "assistant", content: "", streaming: true },
    ]);
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

  const newChat = () => {
    setMsgs([]); setError(null); setTaskType(null); setActiveTool(null); startConv();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#09090b] text-white">
      <NeuralBackground active={busy} />

      {/* ── Header ── */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-black/60 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <motion.div
            animate={busy ? { scale:[1,1.15,1], opacity:[0.8,1,0.8] } : {}}
            transition={busy ? { duration:1.2, repeat:Infinity } : {}}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20"
          >
            <Brain className="h-5 w-5 text-white" />
          </motion.div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Project Brain AI</h1>
            <p className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className={`h-1.5 w-1.5 rounded-full ${convId ? "animate-pulse bg-green-500" : "bg-zinc-600"}`} />
              {convId ? `Session ${convId} · RSP Capital Projects` : "Connecting…"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Provider dropdown */}
          <div className="relative">
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              disabled={busy}
              className="appearance-none rounded-xl border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-8 text-xs font-medium text-cyan-300 outline-none focus:border-cyan-500/60 disabled:opacity-50"
            >
              {PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label} — {p.note}</option>
              ))}
            </select>
            <Cpu className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          </div>

          {busy && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300"
            >
              <Zap className="h-3.5 w-3.5 animate-pulse" /> Processing…
            </motion.div>
          )}

          <button onClick={newChat}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" /> New Chat
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6 md:px-10">
        {msgs.length === 0 ? (
          <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
            className="flex h-full flex-col items-center justify-center gap-8">
            <div className="text-center">
              <motion.div
                animate={{ scale:[1,1.06,1], opacity:[0.8,1,0.8] }}
                transition={{ duration:3, repeat:Infinity }}
                className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 ring-1 ring-cyan-500/30"
              >
                <Brain className="h-10 w-10 text-cyan-400" />
              </motion.div>
              <h2 className="mb-2 text-2xl font-bold">Ask Project Brain</h2>
              <p className="text-zinc-500">Grounded in your live RSP project data. No hallucinations.</p>
            </div>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <motion.button key={i}
                  initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
                  transition={{ delay: i * 0.07 }}
                  onClick={() => send(s)}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-300 backdrop-blur transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-300"
                >
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" /> {s}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {msgs.map(m => (
              <MessageBubble key={m.id} msg={m} activeTool={activeTool} taskType={taskType} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ── Error ── */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:20 }}
            className="relative z-10 mx-4 mb-2 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

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
      </div>
    </div>
  );
}
