"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const AI_BASE =
  process.env.NEXT_PUBLIC_AI_API_URL ||
  process.env.NEXT_PUBLIC_AI_BASE ||
  "http://127.0.0.1:8002";

const C = {
  page: "var(--bg)",
  shell: "var(--panel)",
  sidebar: "var(--panel-2)",
  ink: "var(--ink)",
  muted: "var(--ink-3)",
  faint: "var(--ink-4)",
  line: "var(--line)",
  soft: "var(--panel-3)",
  soft2: "var(--panel-2)",
  user: "var(--steel-soft)",
  accent: "var(--steel)",
  accentDark: "var(--steel-deep)",
  danger: "var(--molten)",
  body: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

type Role = "user" | "assistant";

interface Msg {
  role: Role;
  content: string;
  streaming?: boolean;
  citedSchemes?: number[];
  citedDocs?: number[];
  provider?: string;
  model?: string;
  tokensUsed?: number;
  costUsd?: number;
}

interface Convo {
  conversation_id: number;
  title?: string | null;
}

const suggestions = [
  {
    title: "Progress briefing",
    prompt: "Give me a concise progress briefing for COB-7 this month.",
  },
  {
    title: "Delay reasons",
    prompt: "List delayed schemes with reasons and next action.",
  },
  {
    title: "Contract search",
    prompt: "Find the LD clause in the COB-7 contract.",
  },
  {
    title: "Leadership view",
    prompt: "Which packages need attention this week?",
  },
];

const assistants = [
  { label: "Auto assistant", value: "auto", hint: "Best available route" },
  { label: "Groq", value: "groq", hint: "Fast cloud answers" },
  { label: "Gemini", value: "gemini", hint: "Google model" },
  { label: "Ollama", value: "ollama", hint: "Local model" },
  { label: "OpenRouter Qwen", value: "openrouter/qwen/qwen-2.5-72b-instruct:free", hint: "Free OpenRouter model" },
];

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyBase}-b-${index++}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code
          key={`${keyBase}-c-${index++}`}
          style={{
            fontFamily: C.mono,
            fontSize: "0.9em",
            background: C.soft,
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            padding: "1px 5px",
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => text.split(/\n{2,}/), [text]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");

        if (lines.length >= 2 && lines[0].includes("|") && /^[\s|:-]+$/.test(lines[1])) {
          const head = lines[0].split("|").map((s) => s.trim()).filter(Boolean);
          const rows = lines.slice(2).map((line) => line.split("|").map((s) => s.trim()).filter(Boolean));
          return (
            <div key={blockIndex} style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, background: C.shell }}>
                <thead>
                  <tr>
                    {head.map((h, i) => (
                      <th key={i} style={{ textAlign: "left", padding: "9px 11px", borderBottom: `1px solid ${C.line}`, background: C.soft2 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} style={{ padding: "9px 11px", borderBottom: `1px solid ${C.line}` }}>
                          {renderInline(cell, `t-${blockIndex}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (lines.every((line) => /^\s*[-*]\s+/.test(line) || !line.trim())) {
          return (
            <ul key={blockIndex} style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 7 }}>
              {lines.filter(Boolean).map((line, lineIndex) => (
                <li key={lineIndex} style={{ lineHeight: 1.6 }}>
                  {renderInline(line.replace(/^\s*[-*]\s+/, ""), `l-${blockIndex}-${lineIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        const heading = block.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          return (
            <div key={blockIndex} style={{ fontSize: heading[1].length === 1 ? 20 : 16, fontWeight: 760, letterSpacing: -0.2 }}>
              {renderInline(heading[2], `h-${blockIndex}`)}
            </div>
          );
        }

        return (
          <p key={blockIndex} style={{ margin: 0, lineHeight: 1.72 }}>
            {renderInline(block, `p-${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}

interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  x?: string[];
  y_label?: string;
  series?: { name?: string; data: number[] }[];
  slices?: { label: string; value: number }[];
}

interface TableSpec {
  title?: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string | number | null>[];
}

function parseRichBlocks(text: string): Array<{ kind: "text"; text: string } | { kind: "chart"; spec: ChartSpec } | { kind: "table"; spec: TableSpec }> {
  const blocks: Array<{ kind: "text"; text: string } | { kind: "chart"; spec: ChartSpec } | { kind: "table"; spec: TableSpec }> = [];
  const re = /```brain:(chart|table)\s*\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text))) {
    if (match.index > last) blocks.push({ kind: "text", text: text.slice(last, match.index) });
    try {
      const spec = JSON.parse(match[2]);
      if (match[1] === "chart" && (Array.isArray(spec.series) || Array.isArray(spec.slices))) {
        blocks.push({ kind: "chart", spec });
      } else if (match[1] === "table" && Array.isArray(spec.columns) && Array.isArray(spec.rows)) {
        blocks.push({ kind: "table", spec });
      } else {
        blocks.push({ kind: "text", text: match[0] });
      }
    } catch {
      blocks.push({ kind: "text", text: match[0] });
    }
    last = re.lastIndex;
  }

  if (last < text.length) blocks.push({ kind: "text", text: text.slice(last) });
  return blocks.length ? blocks : [{ kind: "text", text }];
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function BrainChart({ spec }: { spec: ChartSpec }) {
  const width = 620;
  const height = 260;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 28;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const palette = ["#10a37f", "#2563eb", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

  if (spec.type === "pie" && spec.slices?.length) {
    const total = spec.slices.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0) || 1;
    const cx = 140;
    const cy = height / 2;
    const radius = 82;
    let angle = -Math.PI / 2;
    const arcs = spec.slices.map((slice, index) => {
      const fraction = Math.max(0, Number(slice.value) || 0) / total;
      const next = angle + fraction * Math.PI * 2;
      const large = next - angle > Math.PI ? 1 : 0;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(next);
      const y2 = cy + radius * Math.sin(next);
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
      angle = next;
      return { path, color: palette[index % palette.length], label: slice.label, fraction };
    });
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, background: C.soft2, padding: 14, marginTop: 4 }}>
        {spec.title && <div style={{ fontWeight: 800, marginBottom: 8 }}>{spec.title}</div>}
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={spec.title || "pie chart"}>
          {arcs.map((arc, index) => <path key={index} d={arc.path} fill={arc.color} opacity={0.92} stroke="#fff" strokeWidth={1} />)}
          {arcs.map((arc, index) => (
            <g key={`legend-${index}`}>
              <rect x={300} y={padTop + index * 24} width={12} height={12} rx={3} fill={arc.color} />
              <text x={320} y={padTop + index * 24 + 11} fill={C.ink} fontSize={13} fontFamily={C.body}>
                {arc.label} - {(arc.fraction * 100).toFixed(1)}%
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  const series = spec.series ?? [];
  const labels = spec.x ?? [];
  const maxValue = niceMax(Math.max(1, ...series.flatMap((item) => item.data.map((value) => Number(value) || 0))));
  const xAt = (index: number) => padLeft + (labels.length <= 1 ? plotW / 2 : (plotW * index) / (labels.length - 1));
  const yAt = (value: number) => padTop + plotH - (Math.max(0, value) / maxValue) * plotH;

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, background: C.soft2, padding: 14, marginTop: 4 }}>
      {spec.title && <div style={{ fontWeight: 800, marginBottom: 8 }}>{spec.title}</div>}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={spec.title || "chart"}>
        {[0, 0.25, 0.5, 0.75, 1].map((grid) => (
          <g key={grid}>
            <line x1={padLeft} x2={width - padRight} y1={padTop + plotH * grid} y2={padTop + plotH * grid} stroke={C.line} />
            <text x={padLeft - 8} y={padTop + plotH * grid + 4} fill={C.muted} fontSize={11} fontFamily={C.mono} textAnchor="end">
              {(maxValue * (1 - grid)).toFixed(maxValue >= 10 ? 0 : 1)}
            </text>
          </g>
        ))}
        {labels.map((label, index) => (
          <text key={label} x={xAt(index)} y={height - 12} textAnchor="middle" fill={C.muted} fontSize={11} fontFamily={C.body}>
            {label.length > 12 ? `${label.slice(0, 11)}...` : label}
          </text>
        ))}
        {spec.type === "bar" && series.map((item, seriesIndex) => {
          const groupW = plotW / Math.max(1, labels.length);
          const barW = Math.min(22, (groupW - 12) / Math.max(1, series.length));
          return item.data.map((value, index) => {
            const x = padLeft + index * groupW + (groupW - barW * series.length) / 2 + seriesIndex * barW;
            const y = yAt(Number(value) || 0);
            return <rect key={`${seriesIndex}-${index}`} x={x} y={y} width={barW - 2} height={padTop + plotH - y} rx={4} fill={palette[seriesIndex % palette.length]} opacity={0.9} />;
          });
        })}
        {spec.type !== "bar" && series.map((item, seriesIndex) => {
          const points = item.data.map((value, index) => `${xAt(index)},${yAt(Number(value) || 0)}`).join(" ");
          const area = `${padLeft},${padTop + plotH} ${points} ${width - padRight},${padTop + plotH}`;
          return (
            <g key={seriesIndex}>
              {spec.type === "area" && <polygon points={area} fill={palette[seriesIndex % palette.length]} opacity={0.13} />}
              <polyline points={points} fill="none" stroke={palette[seriesIndex % palette.length]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              {item.data.map((value, index) => <circle key={index} cx={xAt(index)} cy={yAt(Number(value) || 0)} r={4} fill={palette[seriesIndex % palette.length]} />)}
            </g>
          );
        })}
        {series.map((item, index) => (
          <g key={`series-${index}`}>
            <rect x={padLeft + index * 130} y={8} width={10} height={10} rx={2} fill={palette[index % palette.length]} />
            <text x={padLeft + index * 130 + 16} y={17} fill={C.muted} fontSize={12} fontFamily={C.body}>{item.name || `Series ${index + 1}`}</text>
          </g>
        ))}
        {spec.y_label && <text x={12} y={padTop + 12} fill={C.muted} fontSize={11} fontFamily={C.mono}>{spec.y_label}</text>}
      </svg>
    </div>
  );
}

function BrainTable({ spec }: { spec: TableSpec }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden", background: C.shell, marginTop: 4 }}>
      {spec.title && <div style={{ padding: "12px 14px", fontWeight: 800, borderBottom: `1px solid ${C.line}`, background: C.soft2 }}>{spec.title}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {spec.columns.map((column) => (
                <th key={column.key} style={{ textAlign: column.align ?? "left", padding: "10px 12px", borderBottom: `1px solid ${C.line}`, color: C.muted, background: C.soft2 }}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {spec.columns.map((column) => (
                  <td key={column.key} style={{ textAlign: column.align ?? "left", padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
                    {row[column.key] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RichContent({ text }: { text: string }) {
  const blocks = useMemo(() => parseRichBlocks(text), [text]);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {blocks.map((block, index) => {
        if (block.kind === "chart") return <BrainChart key={index} spec={block.spec} />;
        if (block.kind === "table") return <BrainTable key={index} spec={block.spec} />;
        return <Markdown key={index} text={block.text} />;
      })}
    </div>
  );
}

function SourceChips({ schemes, docs }: { schemes?: number[]; docs?: number[] }) {
  if (!schemes?.length && !docs?.length) return null;

  const chip: React.CSSProperties = {
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "5px 10px",
    color: C.muted,
    textDecoration: "none",
    fontSize: 12,
    background: C.soft2,
  };

  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 13 }}>
      {(schemes ?? []).map((id) => (
        <a key={`scheme-${id}`} href={`/view/${id}`} style={chip}>Scheme {id}</a>
      ))}
      {(docs ?? []).map((id) => (
        <a key={`doc-${id}`} href={`/documents?doc=${id}`} style={chip}>Document {id}</a>
      ))}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} aria-label="Thinking">
      {[0, 1, 2].map((item) => (
        <span
          key={item}
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: C.accent,
            opacity: 0.35 + item * 0.2,
          }}
        />
      ))}
    </span>
  );
}

function ThinkingPanel() {
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted, fontSize: 13 }}>
        <span className="brainPulse" style={{ width: 9, height: 9, borderRadius: 999, background: C.accent }} />
        Reading project data, documents, and tools
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {["Resolve scheme/package", "Run grounded tools", "Prepare concise answer"].map((label, index) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 9, color: C.muted, fontSize: 12 }}>
            <span
              className="brainBar"
              style={{
                width: 36,
                height: 5,
                borderRadius: 999,
                background: `linear-gradient(90deg, ${C.accent}, #bfdbfe)`,
                animationDelay: `${index * 160}ms`,
              }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";

  return (
    <div style={{ display: "grid", gridTemplateColumns: isUser ? "1fr auto" : "auto 1fr", gap: 12, alignItems: "start" }}>
      {!isUser && (
        <div style={{ width: 34, height: 34, borderRadius: 11, background: C.ink, color: "#fff", display: "grid", placeItems: "center", fontWeight: 850 }}>
          B
        </div>
      )}
      <div
        style={{
          justifySelf: isUser ? "end" : "stretch",
          maxWidth: isUser ? 720 : 860,
          background: isUser ? C.user : C.shell,
          border: `1px solid ${isUser ? "#cfe3ff" : C.line}`,
          borderRadius: isUser ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
          padding: "14px 16px",
          boxShadow: isUser ? "none" : "0 10px 28px rgba(15, 23, 42, 0.045)",
          color: C.ink,
        }}
      >
        {!isUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12, marginBottom: 8 }}>
            <span style={{ fontWeight: 760 }}>Project Brain</span>
            {msg.provider && <span style={{ fontFamily: C.mono, color: C.faint }}>{msg.provider}</span>}
            {msg.streaming && <ThinkingDots />}
          </div>
        )}
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{msg.content}</div>
        ) : msg.streaming && !msg.content ? (
          <ThinkingPanel />
        ) : (
          <RichContent text={msg.content || (msg.streaming ? "Checking the live database and available documents..." : "")} />
        )}
        {!isUser && !msg.streaming && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", color: C.faint, fontSize: 12, marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
            {msg.model && <span style={{ fontFamily: C.mono }}>{msg.model}</span>}
            {msg.tokensUsed != null && <span>{msg.tokensUsed.toLocaleString()} tokens</span>}
            {msg.costUsd != null && msg.costUsd > 0 && <span>${msg.costUsd.toFixed(4)}</span>}
          </div>
        )}
        {!isUser && !msg.streaming && <SourceChips schemes={msg.citedSchemes} docs={msg.citedDocs} />}
      </div>
      {isUser && (
        <div style={{ width: 34, height: 34, borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", display: "grid", placeItems: "center", fontWeight: 850 }}>
          U
        </div>
      )}
    </div>
  );
}

export default function BrainChat({ userId = 1 }: { userId?: number }) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [cid, setCid] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistant, setAssistant] = useState("auto");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${AI_BASE}/ai/conversations`)
      .then((r) => r.json())
      .then((rows: Convo[]) => setConvos(rows))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function openConvo(id: number) {
    setCid(id);
    try {
      const rows = await fetch(`${AI_BASE}/ai/conversations/${id}/messages`).then((r) => r.json());
      setMsgs(rows.map((row: any) => ({
        role: row.role,
        content: row.content,
        citedSchemes: row.cited_scheme_ids ?? undefined,
        citedDocs: row.cited_document_ids ?? undefined,
        provider: row.provider ?? undefined,
        model: row.model_name ?? undefined,
        tokensUsed: row.tokens_used ?? undefined,
      })));
    } catch {
      setMsgs([]);
    }
  }

  async function ensureConvo(prompt: string): Promise<number> {
    if (cid) return cid;
    const body = await fetch(`${AI_BASE}/ai/conversations/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, title: prompt.slice(0, 60), source: "web" }),
    }).then((r) => r.json());
    setCid(body.conversation_id);
    setConvos((items) => [{ conversation_id: body.conversation_id, title: prompt.slice(0, 60) }, ...items]);
    return body.conversation_id;
  }

  async function send(textFromSuggestion?: string) {
    const text = (textFromSuggestion ?? input).trim();
    if (!text || busy) return;

    setInput("");
    setBusy(true);
    setMsgs((items) => [...items, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);

    try {
      const conversation_id = await ensureConvo(text);
      const response = await fetch(`${AI_BASE}/ai/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id,
          user_id: userId,
          message: text,
          ...(assistant === "auto" ? {} : {
            provider: assistant.split("/")[0],
            model_override: assistant.includes("/") ? assistant.split("/").slice(1).join("/") : undefined,
          }),
        }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk: any;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }

          setMsgs((items) => {
            const copy = [...items];
            const last = copy[copy.length - 1];
            if (!last || last.role !== "assistant") return items;

            if (chunk.done) {
              copy[copy.length - 1] = {
                ...last,
                streaming: false,
                citedSchemes: chunk.cited_scheme_ids ?? [],
                citedDocs: chunk.cited_document_ids ?? [],
                provider: chunk.provider,
                model: chunk.model,
                tokensUsed: chunk.tokens_used,
                costUsd: chunk.cost_usd,
              };
            } else if (typeof chunk.text === "string") {
              copy[copy.length - 1] = {
                ...last,
                content: last.content + chunk.text,
                provider: chunk.provider ?? last.provider,
                model: chunk.model ?? last.model,
              };
            }
            return copy;
          });
        }
      }

      setMsgs((items) => items.map((item, index) => index === items.length - 1 ? { ...item, streaming: false } : item));
    } catch {
      setMsgs((items) => items.map((item, index) => index === items.length - 1
        ? { ...item, streaming: false, content: item.content || "I could not reach the AI service. Please check that port 8002 is running." }
        : item));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 96px)",
        height: "calc(100vh - 96px)",
        background: C.page,
        color: C.ink,
        fontFamily: C.body,
        display: "grid",
        gridTemplateColumns: "300px minmax(0, 1fr)",
        borderRadius: 28,
        overflow: "hidden",
        border: `1px solid ${C.line}`,
        boxShadow: "0 24px 80px rgba(15, 23, 42, 0.09)",
      }}
    >
      <style>
        {`
          @keyframes brainPulse {
            0%, 100% { transform: scale(0.82); opacity: 0.45; }
            50% { transform: scale(1.22); opacity: 1; }
          }
          @keyframes brainBar {
            0% { transform: scaleX(0.28); opacity: 0.35; transform-origin: left; }
            45% { transform: scaleX(1); opacity: 1; transform-origin: left; }
            100% { transform: scaleX(0.38); opacity: 0.45; transform-origin: right; }
          }
          .brainPulse { animation: brainPulse 1.05s ease-in-out infinite; }
          .brainBar { animation: brainBar 1.18s ease-in-out infinite; }
        `}
      </style>
      <aside style={{ background: C.sidebar, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: 18, display: "grid", gap: 12, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: C.ink, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900 }}>B</div>
            <div>
              <div style={{ fontWeight: 820, letterSpacing: -0.2 }}>AI Assistant</div>
              <div style={{ color: C.muted, fontSize: 12 }}>Project Brain</div>
            </div>
          </div>
          <button
            onClick={() => { setCid(null); setMsgs([]); }}
            style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 14, background: C.ink, color: "#fff", padding: "11px 12px", cursor: "pointer", fontWeight: 760, textAlign: "left" }}
          >
            + New chat
          </button>
          <a href="/documents" style={{ textDecoration: "none", color: C.accentDark, background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 14, padding: "10px 12px", fontWeight: 740, fontSize: 13 }}>
            Document ingest
          </a>
        </div>

        <div style={{ padding: "14px 10px 8px", color: C.faint, fontSize: 12, fontWeight: 760, textTransform: "uppercase", letterSpacing: 0.7 }}>
          Recent chats
        </div>
        <div style={{ padding: "0 10px 14px", overflowY: "auto", flex: 1 }}>
          {convos.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, padding: 12 }}>Your conversations will appear here.</div>
          ) : (
            convos.map((convo) => (
              <button
                key={convo.conversation_id}
                onClick={() => openConvo(convo.conversation_id)}
                title={convo.title || `Conversation ${convo.conversation_id}`}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 11px",
                  marginBottom: 4,
                  background: convo.conversation_id === cid ? C.soft : "transparent",
                  color: C.ink,
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 14,
                }}
              >
                {convo.title || `Conversation ${convo.conversation_id}`}
              </button>
            ))
          )}
        </div>
      </aside>

      <main style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "linear-gradient(180deg, var(--panel) 0%, var(--bg) 100%)" }}>
        <header style={{ padding: "18px 26px", borderBottom: "1px solid #93c5fd", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, color: "#0a0a0a" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 850, letterSpacing: -0.35 }}>Project Brain Assistant</div>
            <div style={{ color: C.muted, fontSize: 13 }}>Grounded answers from schemes, packages, documents, and live project data.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, background: C.shell, borderRadius: 999, padding: "6px 10px", color: C.muted, fontSize: 12, fontWeight: 760 }}>
              Assistant
              <select
                value={assistant}
                onChange={(event) => setAssistant(event.target.value)}
                disabled={busy}
                style={{ border: "none", outline: "none", background: "transparent", color: C.ink, fontWeight: 760, cursor: busy ? "wait" : "pointer" }}
              >
                {assistants.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.accentDark, background: "#ecfdf5", border: "1px solid #bbf7d0", padding: "7px 11px", borderRadius: 999, fontSize: 12, fontWeight: 760 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: C.accent }} />
              AI service connected
            </div>
          </div>
        </header>

        <section style={{ flex: 1, overflowY: "auto", padding: "30px 28px 18px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 18 }}>
            {msgs.length === 0 && (
              <div style={{ maxWidth: 820, margin: "58px auto 0", textAlign: "center" }}>
                <div style={{ width: 60, height: 60, borderRadius: 20, margin: "0 auto 18px", background: C.ink, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 26, boxShadow: "0 18px 50px rgba(15,23,42,0.2)" }}>B</div>
                <h1 style={{ margin: 0, fontSize: 34, letterSpacing: -0.8, lineHeight: 1.08 }}>How can I help with Project Brain?</h1>
                <p style={{ margin: "12px auto 24px", color: C.muted, maxWidth: 560, lineHeight: 1.55 }}>
                  Ask a project question, summarize progress, search documents, or prepare a leadership-ready answer.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  {suggestions.map((item) => (
                    <button
                      key={item.title}
                      onClick={() => void send(item.prompt)}
                      style={{ border: `1px solid ${C.line}`, background: C.shell, color: C.ink, borderRadius: 18, padding: 16, textAlign: "left", cursor: "pointer", lineHeight: 1.45, boxShadow: "var(--shadow)" }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 5 }}>{item.title}</div>
                      <div style={{ color: C.muted, fontSize: 13 }}>{item.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((msg, index) => <MessageRow key={index} msg={msg} />)}
            <div ref={endRef} />
          </div>
        </section>

        <footer style={{ padding: "14px 28px 24px", background: "linear-gradient(180deg, transparent 0%, var(--bg) 24%)" }}>
          <div style={{ maxWidth: 920, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: C.shell, border: `1px solid ${C.line}`, borderRadius: 24, padding: 12, boxShadow: "var(--shadow)" }}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={Math.min(6, Math.max(1, input.split("\n").length))}
                placeholder="Message Project Brain"
                style={{ flex: 1, border: "none", outline: "none", resize: "none", fontSize: 15, lineHeight: 1.55, padding: "10px 12px", fontFamily: C.body, color: C.ink, background: "transparent", minHeight: 26, maxHeight: 180 }}
              />
              <button
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                style={{ minWidth: 76, height: 44, borderRadius: 16, border: "none", background: busy || !input.trim() ? "#d1d5db" : C.accent, color: "#fff", cursor: busy || !input.trim() ? "default" : "pointer", fontWeight: 850, fontSize: 14 }}
                aria-label="Send message"
              >
                {busy ? "Wait" : "Send"}
              </button>
            </div>
            <div style={{ color: C.faint, fontSize: 11, textAlign: "center", marginTop: 9 }}>
              Project Brain can make mistakes. Verify critical dates, costs, and contract clauses before issuing.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
