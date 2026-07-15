"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Focus, Network, RefreshCw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { ThemeToggle } from "@/theme/ThemeProvider";

const AI_BASE = process.env.NEXT_PUBLIC_AI_API_URL || process.env.NEXT_PUBLIC_AI_BASE || "http://127.0.0.1:8002";

type KGNode = { node_id: number; label: string; node_type: string; ref_id: number | null };
type KGEdge = {
  src: number;
  dst: number;
  relation: string;
  weight: number;
  evidence_document_id?: number | null;
  evidence_chunk_id?: number | null;
};
type GraphData = { root: number; nodes: KGNode[]; edges: KGEdge[] };
type Point = { x: number; y: number };

const NODE_COLORS: Record<string, string> = {
  scheme: "#0ea5e9",
  package: "#8b5cf6",
  contractor: "#f59e0b",
  document: "#10b981",
  topic: "#ef4444",
};

function nodeColor(type: string) {
  return NODE_COLORS[type] || "#64748b";
}

function shortLabel(label: string, max = 28) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function graphPositions(nodes: KGNode[], root: number): Map<number, Point> {
  const positions = new Map<number, Point>();
  positions.set(root, { x: 600, y: 360 });
  const rest = nodes.filter((node) => node.node_id !== root);
  const rings = rest.length > 36 ? 3 : rest.length > 16 ? 2 : 1;
  const perRing = Math.ceil(rest.length / rings);
  rest.forEach((node, index) => {
    const ring = Math.floor(index / perRing);
    const inRing = rest.slice(ring * perRing, Math.min((ring + 1) * perRing, rest.length));
    const local = index - ring * perRing;
    const angle = -Math.PI / 2 + (Math.PI * 2 * local) / Math.max(1, inRing.length);
    const radiusX = 225 + ring * 145;
    const radiusY = 155 + ring * 90;
    positions.set(node.node_id, { x: 600 + Math.cos(angle) * radiusX, y: 360 + Math.sin(angle) * radiusY });
  });
  return positions;
}

export default function KnowledgeGraph() {
  const [query, setQuery] = useState("COB-7");
  const [depth, setDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(60);
  const [data, setData] = useState<GraphData | null>(null);
  const [selected, setSelected] = useState<KGNode | null>(null);
  const [relation, setRelation] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const loadGraph = useCallback(async (name = query) => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ name: name.trim(), depth: String(depth), max_nodes: String(maxNodes) });
      const response = await fetch(`${AI_BASE}/ai/graph/subgraph?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Graph lookup failed");
      setData(body);
      setSelected(body.nodes.find((node: KGNode) => node.node_id === body.root) || body.nodes[0] || null);
      setRelation("");
      setNodeType("");
      setZoom(1);
    } catch (cause: any) {
      setData(null);
      setSelected(null);
      setError(cause?.message || "Graph lookup failed");
    } finally {
      setLoading(false);
    }
  }, [depth, maxNodes, query]);

  useEffect(() => { void loadGraph("COB-7"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncGraph = async () => {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch(`${AI_BASE}/ai/graph/sync`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Graph sync failed");
      await loadGraph();
    } catch (cause: any) {
      setError(cause?.message || "Graph sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const relations = useMemo(() => [...new Set((data?.edges || []).map((edge) => edge.relation))].sort(), [data]);
  const nodeTypes = useMemo(() => [...new Set((data?.nodes || []).map((node) => node.node_type))].sort(), [data]);
  const visibleNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((node) => !nodeType || node.node_type === nodeType || node.node_id === data.root);
  }, [data, nodeType]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.node_id)), [visibleNodes]);
  const visibleEdges = useMemo(() => (data?.edges || []).filter((edge) =>
    (!relation || edge.relation === relation) && visibleNodeIds.has(edge.src) && visibleNodeIds.has(edge.dst)
  ), [data, relation, visibleNodeIds]);
  const positions = useMemo(() => graphPositions(visibleNodes, data?.root ?? -1), [visibleNodes, data]);
  const nodeById = useMemo(() => new Map((data?.nodes || []).map((node) => [node.node_id, node])), [data]);
  const selectedEdges = useMemo(() => selected ? (data?.edges || []).filter((edge) => edge.src === selected.node_id || edge.dst === selected.node_id) : [], [data, selected]);
  const evidenceIds = useMemo(() => [...new Set(selectedEdges.map((edge) => edge.evidence_document_id).filter((id): id is number => !!id))], [selectedEdges]);

  const focusNode = (node: KGNode) => {
    setQuery(node.label);
    void loadGraph(node.label);
  };

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
        <div>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em]" style={{ color: "var(--steel)" }}><Network size={17} /> Evidence Graph</div>
          <h1 className="mt-1 text-3xl font-black">Knowledge Graph Explorer</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-3)" }}>Schemes, packages, contractors, documents, delay causes, EOT and contractual evidence.</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={() => void syncGraph()} disabled={syncing} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--steel)" }}>
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing" : "Sync graph"}
          </button>
        </div>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl p-4" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
        <label className="min-w-[280px] flex-1 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Find an entity
          <div className="mt-1 flex overflow-hidden rounded-xl" style={{ border: "1px solid var(--line-2)", background: "var(--panel-2)" }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadGraph(); }} placeholder="COB-7, contractor, document or topic" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
            <button onClick={() => void loadGraph()} className="px-4" aria-label="Search graph" style={{ color: "var(--steel)" }}><Search size={18} /></button>
          </div>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Depth
          <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="mt-1 block rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} hop{value > 1 ? "s" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Limit
          <select value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} className="mt-1 block rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
            {[30, 60, 100, 150].map((value) => <option key={value} value={value}>{value} nodes</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Relation
          <select value={relation} onChange={(event) => setRelation(event.target.value)} className="mt-1 block max-w-[210px] rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
            <option value="">All relations</option>{relations.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Node type
          <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} className="mt-1 block max-w-[180px] rounded-xl px-3 py-2.5 text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
            <option value="">All types</option>{nodeTypes.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </section>

      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="relative min-h-[680px] overflow-hidden rounded-2xl" style={{ background: "var(--panel)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            {loading ? "Loading graph…" : `${visibleNodes.length} nodes · ${visibleEdges.length} links`}
          </div>
          <div className="absolute right-4 top-4 z-10 flex overflow-hidden rounded-xl" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            <button onClick={() => setZoom((value) => Math.max(.55, value - .15))} className="p-2.5" aria-label="Zoom out"><ZoomOut size={17} /></button>
            <button onClick={() => setZoom(1)} className="border-x px-3 text-xs font-bold" style={{ borderColor: "var(--line)" }}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom((value) => Math.min(1.8, value + .15))} className="p-2.5" aria-label="Zoom in"><ZoomIn size={17} /></button>
          </div>

          {data && (
            <svg viewBox="0 0 1200 720" className="h-[680px] w-full" role="img" aria-label="Interactive knowledge graph">
              <g transform={`translate(600 360) scale(${zoom}) translate(-600 -360)`}>
                {visibleEdges.map((edge, index) => {
                  const from = positions.get(edge.src); const to = positions.get(edge.dst);
                  if (!from || !to) return null;
                  return <g key={`${edge.src}-${edge.dst}-${edge.relation}-${index}`}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.evidence_document_id ? "var(--steel)" : "var(--line-2)"} strokeWidth={Math.max(1.2, Math.min(3, Number(edge.weight) || 1))} strokeOpacity={edge.evidence_document_id ? .72 : .5} />
                    {visibleEdges.length <= 28 && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} textAnchor="middle" fontSize="10" fill="var(--ink-3)">{edge.relation.replaceAll("_", " ")}</text>}
                  </g>;
                })}
                {visibleNodes.map((node) => {
                  const point = positions.get(node.node_id); if (!point) return null;
                  const active = selected?.node_id === node.node_id;
                  const root = node.node_id === data.root;
                  return <g key={node.node_id} transform={`translate(${point.x} ${point.y})`} onClick={() => setSelected(node)} style={{ cursor: "pointer" }} role="button" tabIndex={0}>
                    <circle r={root ? 35 : 27} fill={nodeColor(node.node_type)} fillOpacity={active ? 1 : .84} stroke={active ? "var(--ink)" : "var(--panel)"} strokeWidth={active ? 4 : 2} />
                    <text y="4" textAnchor="middle" fontSize={root ? "13" : "11"} fontWeight="800" fill="#fff">{node.node_type.slice(0, 3).toUpperCase()}</text>
                    <rect x="-76" y={root ? 43 : 35} width="152" height="28" rx="9" fill="var(--panel-2)" stroke="var(--line)" />
                    <text y={root ? 61 : 53} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{shortLabel(node.label)}</text>
                  </g>;
                })}
              </g>
            </svg>
          )}

          {!data && !loading && <div className="grid h-[680px] place-items-center text-center" style={{ color: "var(--ink-3)" }}><div><Network className="mx-auto mb-3" size={42} /><p>Search for a scheme, document, contractor or topic.</p></div></div>}

          <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 rounded-xl p-2" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            {Object.entries(NODE_COLORS).map(([type, color]) => <span key={type} className="inline-flex items-center gap-1.5 px-1 text-xs"><i className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{type}</span>)}
          </div>
        </section>

        <aside className="rounded-2xl p-5 xl:sticky xl:top-4 xl:self-start" style={{ background: "var(--panel)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
          {selected ? <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ background: nodeColor(selected.node_type) }}>{selected.node_type}</span><h2 className="mt-3 text-xl font-black leading-tight">{selected.label}</h2>{selected.ref_id != null && <p className="mt-1 text-xs font-mono" style={{ color: "var(--ink-3)" }}>Reference #{selected.ref_id}</p>}</div>
              <button onClick={() => focusNode(selected)} className="rounded-lg p-2" title="Focus graph on this node" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}><Focus size={17} /></button>
            </div>

            {selected.node_type === "scheme" && selected.ref_id != null && <a href={`/view/${selected.ref_id}`} className="mb-4 inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--steel)" }}>Open scheme <ExternalLink size={14} /></a>}
            {selected.node_type === "document" && selected.ref_id != null && <a href={`${AI_BASE}/ai/ingest/documents/${selected.ref_id}/download`} className="mb-4 inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--steel)" }}>Open original evidence <ExternalLink size={14} /></a>}

            <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <h3 className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Connections ({selectedEdges.length})</h3>
              <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1">
                {selectedEdges.map((edge, index) => {
                  const other = nodeById.get(edge.src === selected.node_id ? edge.dst : edge.src);
                  if (!other) return null;
                  return <button key={`${edge.src}-${edge.dst}-${index}`} onClick={() => setSelected(other)} className="rounded-xl p-3 text-left" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}><div className="text-xs font-bold" style={{ color: "var(--steel)" }}>{edge.relation.replaceAll("_", " ")}</div><div className="mt-1 text-sm font-semibold">{other.label}</div>{edge.evidence_document_id && <div className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Evidence document #{edge.evidence_document_id}</div>}</button>;
                })}
              </div>
            </div>

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <h3 className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>Evidence ({evidenceIds.length})</h3>
              {evidenceIds.length ? <div className="mt-2 flex flex-wrap gap-2">{evidenceIds.map((id) => <a key={id} href={`${AI_BASE}/ai/ingest/documents/${id}/download`} className="rounded-lg px-2.5 py-1.5 text-xs font-bold" style={{ background: "var(--steel-soft)", color: "var(--steel)", border: "1px solid var(--line)" }}>Document #{id}</a>)}</div> : <p className="mt-2 text-sm" style={{ color: "var(--ink-3)" }}>Structural link; no source document is required.</p>}
            </div>
          </> : <p style={{ color: "var(--ink-3)" }}>Select a node to inspect its relationships and evidence.</p>}
        </aside>
      </div>
    </div>
  );
}
