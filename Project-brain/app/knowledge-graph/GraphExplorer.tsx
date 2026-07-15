"use client";

/**
 * Knowledge Graph explorer (C1 / Sprint 3) — force-directed canvas over the AI
 * service subgraph()/neighbors() API. Search, expand, click node/edge for
 * evidence, filter delay-relevant edges, jump into Delay Studio.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLink, FileText, GitBranch, Loader2, RefreshCw, Search, Share2, Zap,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const AI_BASE =
  process.env.NEXT_PUBLIC_AI_API_URL ||
  process.env.NEXT_PUBLIC_AI_BASE ||
  "http://127.0.0.1:8002";

type GNode = { node_id: number; label: string; node_type: string; ref_id: number | null };
type GEdge = {
  src: number; dst: number; relation: string; weight: number | null;
  evidence_document_id: number | null; evidence_chunk_id?: number | null;
  props?: Record<string, any> | null;
};
type SubgraphResult = { root: number; nodes: GNode[]; edges: GEdge[]; error?: string };

const TYPE_COLOR: Record<string, string> = {
  scheme: "#22d3ee", package: "#34d399", contractor: "#f59e0b",
  topic: "#a78bfa", document: "#f472b6", default: "#71717a",
};
const HOT_RELATIONS: Record<string, string> = {
  caused_delay: "#ef4444", granted_eot: "#f59e0b", has_ld_clause: "#f472b6",
};

type Pos = { x: number; y: number; vx: number; vy: number };

/** tiny force layout: spring on edges, repulsion between nodes, center gravity */
function layout(nodes: GNode[], edges: GEdge[], W: number, H: number, rootId: number): Map<number, Pos> {
  const pos = new Map<number, Pos>();
  const n = nodes.length || 1;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    const r = node.node_id === rootId ? 0 : Math.min(W, H) * 0.32;
    pos.set(node.node_id, {
      x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
      vx: 0, vy: 0,
    });
  });
  const K = 0.02, REP = 5200, SPRING = 90, DAMP = 0.85;
  for (let iter = 0; iter < 220; iter++) {
    // repulsion
    for (const a of nodes) {
      const pa = pos.get(a.node_id)!;
      for (const b of nodes) {
        if (a.node_id >= b.node_id) continue;
        const pb = pos.get(b.node_id)!;
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        const d2 = Math.max(64, dx * dx + dy * dy);
        const f = REP / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        pa.vx += dx * f; pa.vy += dy * f;
        pb.vx -= dx * f; pb.vy -= dy * f;
      }
    }
    // springs
    for (const e of edges) {
      const pa = pos.get(e.src), pb = pos.get(e.dst);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - SPRING) * 0.012;
      dx /= d; dy /= d;
      pa.vx += dx * f; pa.vy += dy * f;
      pb.vx -= dx * f; pb.vy -= dy * f;
    }
    // gravity + integrate
    for (const node of nodes) {
      const p = pos.get(node.node_id)!;
      p.vx += (W / 2 - p.x) * K * 0.08;
      p.vy += (H / 2 - p.y) * K * 0.08;
      p.vx *= DAMP; p.vy *= DAMP;
      p.x = Math.max(24, Math.min(W - 24, p.x + p.vx));
      p.y = Math.max(20, Math.min(H - 20, p.y + p.vy));
    }
  }
  return pos;
}

export default function GraphExplorerPage() {
  const [query, setQuery] = useState("COB-7");
  const [depth, setDepth] = useState(2);
  const [data, setData] = useState<SubgraphResult | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GEdge | null>(null);
  const [neighborInfo, setNeighborInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [delayOnly, setDelayOnly] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 880, H = 560;

  const load = useCallback((name: string) => {
    setLoading(true); setErr(""); setSelected(null); setSelectedEdge(null); setNeighborInfo(null);
    authFetch(`${AI_BASE}/ai/graph/subgraph?name=${encodeURIComponent(name)}&depth=${depth}&max_nodes=80`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setErr(typeof d.detail === "string" ? d.detail : `Graph error ${r.status}`);
          setData(null);
          return;
        }
        if (d.error) { setErr(d.error); setData(null); }
        else setData(d);
      })
      .catch((e) => setErr(`AI service unreachable (${AI_BASE}): ${e}`))
      .finally(() => setLoading(false));
  }, [depth]);

  useEffect(() => { load(query); /* initial */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEdges = useMemo(() => {
    const edges = data?.edges || [];
    if (!delayOnly) return edges;
    return edges.filter((e) => HOT_RELATIONS[e.relation]);
  }, [data, delayOnly]);

  const positions = useMemo(
    () => (data ? layout(data.nodes, visibleEdges, W, H, data.root) : new Map<number, Pos>()),
    [data, visibleEdges],
  );

  const pickNode = (n: GNode) => {
    setSelected(n);
    setSelectedEdge(null);
    authFetch(`${AI_BASE}/ai/graph/neighbors?name=${encodeURIComponent(n.label)}&limit=40`)
      .then((r) => r.json()).then(setNeighborInfo).catch(() => setNeighborInfo(null));
  };

  const pickEdge = (e: GEdge) => {
    setSelectedEdge(e);
    setSelected(null);
    setNeighborInfo(null);
  };

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    (data?.nodes || []).forEach((n) => { c[n.node_type] = (c[n.node_type] || 0) + 1; });
    return c;
  }, [data]);

  const nodeById = useMemo(() => {
    const m = new Map<number, GNode>();
    (data?.nodes || []).forEach((n) => m.set(n.node_id, n));
    return m;
  }, [data]);

  const delayEdgeCount = useMemo(
    () => (data?.edges || []).filter((e) => e.relation === "caused_delay").length,
    [data],
  );

  const edgeQuote = (e: GEdge | null) => {
    if (!e) return "";
    const props = e.props || {};
    return (props as any).quote || "";
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Share2 className="h-6 w-6 text-violet-400" /> Knowledge Graph Explorer
          </h1>
          <p className="text-sm text-zinc-400">
            Interactive canvas · evidence-backed relations · delay moat feed for Delay Studio
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2">
            <Search className="h-4 w-4 text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(query)}
              placeholder="Entity name… e.g. COB-7"
              className="w-52 bg-transparent px-1 py-2 text-sm outline-none" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            Depth
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm outline-none">
              {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2 py-2 text-xs text-zinc-400">
            <input type="checkbox" checked={delayOnly} onChange={(e) => setDelayOnly(e.target.checked)} />
            Delay edges only
          </label>
          <button onClick={() => load(query)}
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-bold text-violet-300 hover:bg-violet-500/20">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />} Explore
          </button>
          <button title="Rebuild graph from repository"
            onClick={() => { authFetch(`${AI_BASE}/ai/graph/sync`, { method: "POST" }).then(() => load(query)); }}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800">
            <RefreshCw className="h-3.5 w-3.5" /> Sync
          </button>
          <Link href="/delay-analysis"
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/20">
            <Zap className="h-3.5 w-3.5" /> Delay Studio
          </Link>
        </div>
      </div>

      {err && <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* canvas */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-zinc-400">
            {Object.entries(typeCounts).map(([t, c]) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR[t] || TYPE_COLOR.default }} />
                {t} <b className="text-zinc-200">{c}</b>
              </span>
            ))}
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">
              {delayEdgeCount} caused_delay
            </span>
            <span className="ml-auto text-zinc-600">
              {visibleEdges.length} relations · click edge for evidence · double-click node to re-root
            </span>
          </div>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minHeight: 480 }}>
            {visibleEdges.map((e, i) => {
              const a = positions.get(e.src), b = positions.get(e.dst);
              if (!a || !b) return null;
              const hot = HOT_RELATIONS[e.relation];
              const isSel = selectedEdge === e || (
                selectedEdge?.src === e.src && selectedEdge?.dst === e.dst && selectedEdge?.relation === e.relation
              );
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={i} style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); pickEdge(e); }}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={isSel ? "#fff" : (hot || "#3f3f46")}
                    strokeWidth={isSel ? 3 : hot ? 2.2 : 1}
                    opacity={hot || isSel ? 0.95 : 0.55} />
                  {/* wider hit target */}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="transparent" strokeWidth={10} />
                  <text x={mx} y={my - 3} fontSize={7.5}
                    fill={isSel ? "#fff" : (hot || "#52525b")} textAnchor="middle">
                    {e.relation}
                  </text>
                </g>
              );
            })}
            {data?.nodes.map((n) => {
              const p = positions.get(n.node_id);
              if (!p) return null;
              const isRoot = n.node_id === data.root;
              const isSel = selected?.node_id === n.node_id;
              const color = TYPE_COLOR[n.node_type] || TYPE_COLOR.default;
              return (
                <g key={n.node_id} style={{ cursor: "pointer" }}
                  onClick={() => pickNode(n)}
                  onDoubleClick={() => { setQuery(n.label); load(n.label); }}>
                  <circle cx={p.x} cy={p.y} r={isRoot ? 11 : 7}
                    fill={color} opacity={0.9}
                    stroke={isSel ? "#ffffff" : isRoot ? "#e4e4e7" : "transparent"} strokeWidth={isSel ? 2.5 : 1.5} />
                  <text x={p.x} y={p.y - (isRoot ? 15 : 11)} fontSize={isRoot ? 10 : 8.5}
                    fill={isSel ? "#fff" : "#a1a1aa"} textAnchor="middle" fontWeight={isRoot ? 700 : 400}>
                    {n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* details / evidence panel */}
        <div className="space-y-3">
          {selectedEdge ? (
            <div className="rounded-2xl border border-red-500/25 bg-zinc-900/50 p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Selected edge · evidence</p>
              <p className="font-mono text-sm font-bold" style={{ color: HOT_RELATIONS[selectedEdge.relation] || "#a1a1aa" }}>
                {selectedEdge.relation}
              </p>
              <p className="mt-1 text-xs text-zinc-300">
                <b>{nodeById.get(selectedEdge.src)?.label || selectedEdge.src}</b>
                <span className="text-zinc-600"> → </span>
                <b>{nodeById.get(selectedEdge.dst)?.label || selectedEdge.dst}</b>
              </p>
              {edgeQuote(selectedEdge) && (
                <blockquote className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] italic leading-relaxed text-zinc-300">
                  &ldquo;{edgeQuote(selectedEdge)}&rdquo;
                </blockquote>
              )}
              {!edgeQuote(selectedEdge) && (
                <p className="mt-2 text-[11px] text-zinc-600">
                  No quote on edge props — open the source document if linked.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedEdge.evidence_document_id && (
                  <Link href={`/view/${selectedEdge.evidence_document_id}`}
                    className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20">
                    <FileText className="h-3 w-3" /> Document #{selectedEdge.evidence_document_id}
                  </Link>
                )}
                {selectedEdge.relation === "caused_delay" && (
                  <Link href="/delay-analysis"
                    className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/20">
                    <Zap className="h-3 w-3" /> Use in Delay Studio
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Selected node</p>
              {selected ? (
                <>
                  <p className="text-sm font-bold text-zinc-100">{selected.label}</p>
                  <p className="mb-3 text-xs text-zinc-500">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: `${TYPE_COLOR[selected.node_type] || TYPE_COLOR.default}22`, color: TYPE_COLOR[selected.node_type] || TYPE_COLOR.default }}>
                      {selected.node_type}
                    </span>
                    {selected.ref_id != null && <span className="ml-2">ref #{selected.ref_id}</span>}
                  </p>
                  {neighborInfo?.neighbors ? (
                    <div className="max-h-80 space-y-1.5 overflow-y-auto">
                      {(neighborInfo.neighbors || []).map((r: any, i: number) => (
                        <div key={i} className="rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px]">
                          <span style={{ color: HOT_RELATIONS[r.relation] || "#a1a1aa" }} className="font-mono">{r.relation}</span>
                          <span className="ml-1 text-[10px] text-zinc-600">({r.direction || "—"})</span>
                          <span className="ml-1 text-zinc-300">{r.label}</span>
                          {r.evidence_document_id && (
                            <Link href={`/view/${r.evidence_document_id}`} className="ml-1 inline-flex items-center gap-0.5 text-cyan-400 underline">
                              evidence <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : neighborInfo?.error ? (
                    <p className="text-xs text-amber-300">{neighborInfo.error}</p>
                  ) : neighborInfo ? (
                    <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-2 text-[10px] text-zinc-400">
                      {JSON.stringify(neighborInfo, null, 1).slice(0, 2000)}
                    </pre>
                  ) : (
                    <p className="text-xs text-zinc-600">Loading relations…</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-zinc-600">
                  Click a node for relations, or a red delay edge for document evidence. Double-click a node to re-root.
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-[11px] leading-relaxed text-zinc-500">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Delay-relevant relations</p>
            {Object.entries(HOT_RELATIONS).map(([rel, color]) => (
              <p key={rel}><span className="font-mono" style={{ color }}>{rel}</span></p>
            ))}
            <p className="mt-2">
              <span className="font-mono text-red-300">caused_delay</span> edges (with document evidence)
              pre-populate the Delay Studio register via{" "}
              <span className="text-zinc-300">Import from correspondence</span>.
            </p>
            <Link href="/delay-analysis"
              className="mt-3 inline-flex items-center gap-1 font-semibold text-amber-300 hover:underline">
              <Zap className="h-3 w-3" /> Open Delay Studio →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
