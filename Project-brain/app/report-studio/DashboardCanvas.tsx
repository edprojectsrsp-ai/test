"use client";

/**
 * Report Studio — Dashboard Canvas (Power BI report-page experience).
 *
 * What this adds beyond Matrix Builder (one query at a time):
 *   · Pages of visuals on a 12-column grid — drag to move, drag corner to resize
 *   · 9 visual types: table · bar · stacked bar · line · area · pie · donut · KPI · slicer
 *   · Slicers (list / date-range) filter every visual on the page sharing the dataset
 *   · Cross-filtering: click a bar / slice / row → other visuals filter to it (Power BI style)
 *   · Whole page renders in ONE round trip (POST /report-studio/query/batch)
 *   · Dashboards persist as query specs (rs_dashboards) — always live figures
 *   · Export: page → PNG (html2canvas) · visual → CSV
 *
 * Field wells per visual reuse the same semantic-layer contract as PowerBuilder
 * (dimensions + measures + filters compiled server-side; no raw SQL).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import EChartsViz from "./EChartsViz";
import {
  AreaChart as AreaIcon, BarChart3, Calendar, CheckSquare,
  Copy, Download, Filter as FilterIcon,
  FolderOpen, GripVertical, Hash, Image as ImageIcon, Layers, LayoutDashboard,
  LineChart as LineIcon, Loader2, Maximize2, PieChart as PieIcon, Pin,
  Plus, RefreshCw, Save, Search, Sigma, SlidersHorizontal, Table2, Trash2,
  Type, X,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rs = (p: string) => `${API}/report-studio${p}`;

const COLORS = ["#6ea8fe", "#f0883e", "#3fb950", "#e5534b", "#a371f7", "#f2cc60", "#39c5cf", "#db61a2", "#8ddb8c", "#c297ff"];

/* ------------------------------------------------------------------ types */

type Field = { key: string; label: string; type: string; default_agg?: string };
type Dataset = { key: string; label: string; dimensions: Field[]; measures: Field[] };

type Cond = { field: string; op: string; value?: any };
type MeasureSel = { field: string; agg: string; alias?: string };
type Viz = "table" | "bar" | "stackedbar" | "line" | "area" | "pie" | "donut" | "kpi";

type Layout = { x: number; y: number; w: number; h: number };
type Visual = {
  id: string;
  title: string;
  dataset: string;
  viz: Viz;
  dims: string[];
  measures: MeasureSel[];
  conds: Cond[];
  sortBy: string;
  sortDir: "asc" | "desc";
  limit: number;
  layout: Layout;
  options: { legend?: boolean };
};
type Slicer = {
  id: string;
  dataset: string;
  field: string;
  label: string;
  type: "list" | "daterange";
  layout: Layout;
  // runtime selection (persisted so a saved dashboard reopens as-left)
  selected: string[];       // list slicer
  from?: string; to?: string; // daterange slicer
};
type Page = { id: string; title: string; visuals: Visual[]; slicers: Slicer[] };
type XFilter = { sourceId: string; dataset: string; field: string; value: any; label: string };

type QueryResult = { ok: boolean; error?: string; columns: { key: string; label: string; type: string }[]; rows: Record<string, any>[] };

type DashMeta = { dashboard_id: number; name: string; description?: string; page_count: number; is_pinned: boolean; updated_at: string };

/* ------------------------------------------------------------------ utils */

const uid = () => Math.random().toString(36).slice(2, 9);
const NUMERIC = ["int", "number", "money"];
const isNum = (t: string) => NUMERIC.includes(t);

function fmtNum(v: any): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function csvOf(cols: { key: string; label: string }[], rows: Record<string, any>[]): string {
  const esc = (s: any) => {
    const v = s == null ? "" : String(s);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
}

/** Build the server QueryIn for a visual, merging page slicers + cross-filter. */
function specFor(v: Visual, slicers: Slicer[], xf: XFilter | null) {
  const conds: Cond[] = v.conds.filter((c) =>
    !((c.op === "in" || c.op === "not_in") && Array.isArray(c.value) && c.value.length === 0));
  for (const s of slicers) {
    if (s.dataset !== v.dataset) continue;
    if (s.type === "list" && s.selected.length) conds.push({ field: s.field, op: "in", value: s.selected });
    if (s.type === "daterange") {
      if (s.from && s.to) conds.push({ field: s.field, op: "between", value: [s.from, s.to] });
      else if (s.from) conds.push({ field: s.field, op: ">=", value: s.from });
      else if (s.to) conds.push({ field: s.field, op: "<=", value: s.to });
    }
  }
  if (xf && xf.sourceId !== v.id && xf.dataset === v.dataset) {
    conds.push({ field: xf.field, op: "=", value: xf.value });
  }
  return {
    dataset: v.dataset,
    dimensions: v.dims,
    measures: v.measures.map((m) => ({ field: m.field, agg: m.agg, ...(m.alias ? { alias: m.alias } : {}) })),
    computed: [],
    filters: conds.length ? { op: "AND", conditions: conds } : null,
    sort: v.sortBy ? [{ by: v.sortBy, dir: v.sortDir }] : [],
    limit: v.viz === "table" ? v.limit : Math.min(v.limit, 50),
    pivot: null,
    grand_total: false,
  };
}

const defaultVisual = (dataset: string, x: number, y: number): Visual => ({
  id: uid(), title: "New visual", dataset, viz: "bar",
  dims: [], measures: [], conds: [], sortBy: "", sortDir: "desc", limit: 100,
  layout: { x, y, w: 6, h: 5 }, options: { legend: true },
});

/* ------------------------------------------------------------------ styles */

const panel: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 };
const btn = (kind: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
  padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: "1px solid var(--line)",
  background: kind === "primary" ? "var(--steel)" : "transparent",
  color: kind === "primary" ? "#fff" : kind === "danger" ? "#e5534b" : "var(--ink-2)",
});
const inp: React.CSSProperties = {
  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7,
  color: "var(--ink)", fontSize: 12, padding: "5px 8px", outline: "none", width: "100%",
};
const secLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--ink-4)", margin: "10px 0 5px",
};

function TypeIcon({ type }: { type: string }) {
  const s = 11;
  if (type === "date") return <Calendar size={s} />;
  if (type === "bool") return <CheckSquare size={s} />;
  if (isNum(type)) return <Hash size={s} />;
  return <Type size={s} />;
}

const VIZ_DEFS: { v: Viz; label: string; icon: React.ReactNode }[] = [
  { v: "table", label: "Table", icon: <Table2 size={13} /> },
  { v: "bar", label: "Bar", icon: <BarChart3 size={13} /> },
  { v: "stackedbar", label: "Stacked", icon: <Layers size={13} /> },
  { v: "line", label: "Line", icon: <LineIcon size={13} /> },
  { v: "area", label: "Area", icon: <AreaIcon size={13} /> },
  { v: "pie", label: "Pie", icon: <PieIcon size={13} /> },
  { v: "donut", label: "Donut", icon: <PieIcon size={13} /> },
  { v: "kpi", label: "KPI", icon: <Sigma size={13} /> },
];

/* ================================================================== grid */

const GRID_COLS = 12;
const ROW_H = 56;
const GAP = 10;

/* ============================================================ component */

export default function DashboardCanvas() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const dsMap = useMemo(() => Object.fromEntries(datasets.map((d) => [d.key, d])), [datasets]);

  const [pages, setPages] = useState<Page[]>([{ id: uid(), title: "Page 1", visuals: [], slicers: [] }]);
  const [pageIdx, setPageIdx] = useState(0);
  const page = pages[pageIdx];

  const [selId, setSelId] = useState<string>("");       // selected visual/slicer for config panel
  const [xf, setXf] = useState<XFilter | null>(null);   // cross-filter (per page; cleared on page switch)
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // dashboard persistence
  const [dashId, setDashId] = useState<number | null>(null);
  const [dashName, setDashName] = useState("Untitled dashboard");
  const [dirty, setDirty] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dashList, setDashList] = useState<DashMeta[]>([]);
  const [saving, setSaving] = useState(false);

  // slicer member values cache
  const [memberCache, setMemberCache] = useState<Record<string, string[]>>({});

  const canvasRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(rs("/datasets"));
        const j = await r.json();
        setDatasets(j.datasets || []);
      } catch { setErr("Failed to load datasets"); }
    })();
  }, []);


  /* ------------------------------------------------------------ run page */

  const runnable = (v: Visual) => v.dataset && (v.dims.length > 0 || v.measures.length > 0);

  const runPage = useCallback(async () => {
    const vs = page.visuals.filter(runnable);
    if (!vs.length) { setResults({}); return; }
    setBusy(true); setErr("");
    try {
      const r = await authFetch(rs("/query/batch"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: vs.map((v) => specFor(v, page.slicers, xf)) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Batch failed");
      const out: Record<string, QueryResult> = {};
      vs.forEach((v, i) => { out[v.id] = j.results[i]; });
      setResults(out);
    } catch (e: any) {
      setErr(e.message || "Query failed");
    } finally { setBusy(false); }
  }, [page, xf]);

  // debounce re-run on page / slicer / cross-filter changes
  useEffect(() => {
    const t = setTimeout(runPage, 350);
    return () => clearTimeout(t);
  }, [runPage]);

  useEffect(() => { setXf(null); setSelId(""); }, [pageIdx]);

  /* ------------------------------------------------------------ mutators */

  const patchPage = (fn: (p: Page) => Page) => {
    setPages((ps) => ps.map((p, i) => (i === pageIdx ? fn(p) : p)));
    setDirty(true);
  };
  const patchVisual = (id: string, patch: Partial<Visual>) =>
    patchPage((p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const patchSlicer = (id: string, patch: Partial<Slicer>) =>
    patchPage((p) => ({ ...p, slicers: p.slicers.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const nextY = () => {
    let y = 0;
    for (const v of page.visuals) y = Math.max(y, v.layout.y + v.layout.h);
    for (const s of page.slicers) y = Math.max(y, s.layout.y + s.layout.h);
    return y;
  };

  const addVisual = () => {
    const v = defaultVisual(datasets[0]?.key || "", 0, nextY());
    patchPage((p) => ({ ...p, visuals: [...p.visuals, v] }));
    setSelId(v.id);
  };
  const addSlicer = () => {
    const ds = datasets[0];
    const f = ds?.dimensions[0];
    if (!ds || !f) return;
    const s: Slicer = {
      id: uid(), dataset: ds.key, field: f.key, label: f.label,
      type: f.type === "date" ? "daterange" : "list",
      layout: { x: 0, y: nextY(), w: 3, h: 4 }, selected: [],
    };
    patchPage((p) => ({ ...p, slicers: [...p.slicers, s] }));
    setSelId(s.id);
  };
  const removeItem = (id: string) => {
    patchPage((p) => ({
      ...p,
      visuals: p.visuals.filter((v) => v.id !== id),
      slicers: p.slicers.filter((s) => s.id !== id),
    }));
    if (selId === id) setSelId("");
    if (xf?.sourceId === id) setXf(null);
  };
  const duplicateVisual = (id: string) => {
    const src = page.visuals.find((v) => v.id === id);
    if (!src) return;
    const copy: Visual = { ...src, id: uid(), title: src.title + " (copy)", layout: { ...src.layout, y: nextY() } };
    patchPage((p) => ({ ...p, visuals: [...p.visuals, copy] }));
  };

  /* ------------------------------------------------------------ gridstack */

  // Init one GridStack per page mount; commit geometry changes back to state.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const grid = GridStack.init(
      { column: GRID_COLS, cellHeight: ROW_H, margin: GAP / 2, float: true,
        handle: ".dc-drag", resizable: { handles: "se" }, animate: true },
      el as HTMLDivElement,
    );
    gridRef.current = grid;
    grid.on("change", (_ev: unknown, items: any[]) => {
      if (!items?.length) return;
      const patch: Record<string, Layout> = {};
      for (const n of items) {
        if (n.id) patch[String(n.id)] = { x: n.x, y: n.y, w: n.w, h: n.h };
      }
      setPages((ps) => ps.map((pg, i) => i !== pageIdx ? pg : ({
        ...pg,
        visuals: pg.visuals.map((v) => patch[v.id] ? { ...v, layout: patch[v.id] } : v),
        slicers: pg.slicers.map((sl) => patch[sl.id] ? { ...sl, layout: patch[sl.id] } : sl),
      })));
      setDirty(true);
    });
    return () => { grid.destroy(false); gridRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Reconcile React-rendered items with the grid engine (adds + removals).
  const itemIds = [...page.visuals.map((v) => v.id), ...page.slicers.map((sl) => sl.id)].join("|");
  useEffect(() => {
    const grid = gridRef.current;
    const el = canvasRef.current;
    if (!grid || !el) return;
    grid.batchUpdate();
    el.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((node) => {
      if (!(node as any).gridstackNode) grid.makeWidget(node);
    });
    for (const n of [...grid.engine.nodes]) {
      if (n.el && !el.contains(n.el)) grid.removeWidget(n.el, false, false);
    }
    grid.batchUpdate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds, page.id]);

  /* ------------------------------------------------------------ slicer members */

  const loadMembers = useCallback(async (dataset: string, field: string) => {
    const key = `${dataset}::${field}`;
    if (memberCache[key]) return;
    try {
      const r = await authFetch(rs(`/field-values?dataset=${encodeURIComponent(dataset)}&field=${encodeURIComponent(field)}`));
      const j = await r.json();
      setMemberCache((m) => ({ ...m, [key]: (j.values || []).map(String) }));
    } catch { /* member list stays empty; slicer still typeable */ }
  }, [memberCache]);

  useEffect(() => {
    for (const s of page.slicers) if (s.type === "list") loadMembers(s.dataset, s.field);
  }, [page.slicers, loadMembers]);

  /* ------------------------------------------------------------ persistence */

  const serialize = useCallback(() => ({
    name: dashName,
    description: null,
    is_pinned: false,
    pages: pages.map((p) => ({
      id: p.id, title: p.title,
      slicers: p.slicers.map((s) => ({ id: s.id, dataset: s.dataset, field: s.field, label: s.label, type: s.type })),
      visuals: p.visuals.filter(runnable).map((v) => ({
        id: v.id, title: v.title, dataset: v.dataset, viz: v.viz,
        spec: specFor(v, [], null),
        layout: v.layout,
        options: {
          ...v.options,
          dims: v.dims, measures: v.measures, conds: v.conds,
          sortBy: v.sortBy, sortDir: v.sortDir, limit: v.limit,
        },
      })),
    })),
  }), [dashName, pages]);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const body = JSON.stringify(serialize());
      const r = await authFetch(dashId ? rs(`/dashboards/${dashId}`) : rs("/dashboards"), {
        method: dashId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Save failed");
      if (!dashId) setDashId(j.dashboard_id);
      setDirty(false);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  const openDrawer = async () => {
    setDrawer(true);
    try {
      const r = await authFetch(rs("/dashboards"));
      const j = await r.json();
      setDashList(j.dashboards || []);
    } catch { /* list stays empty */ }
  };

  const load = async (id: number) => {
    try {
      const r = await authFetch(rs(`/dashboards/${id}`));
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Load failed");
      const loaded: Page[] = (j.pages || []).map((p: any) => ({
        id: p.id || uid(), title: p.title || "Page",
        slicers: (p.slicers || []).map((s: any) => ({
          id: s.id || uid(), dataset: s.dataset, field: s.field, label: s.label || s.field,
          type: s.type === "daterange" ? "daterange" : "list",
          layout: s.layout || { x: 0, y: 0, w: 3, h: 4 }, selected: [],
        })),
        visuals: (p.visuals || []).map((v: any) => ({
          id: v.id || uid(), title: v.title || "Visual", dataset: v.dataset,
          viz: (v.viz as Viz) || "bar",
          dims: v.options?.dims || v.spec?.dimensions || [],
          measures: v.options?.measures || (v.spec?.measures || []).map((m: any) => ({ field: m.field, agg: m.agg || "sum", alias: m.alias })),
          conds: v.options?.conds || v.spec?.filters?.conditions || [],
          sortBy: v.options?.sortBy || v.spec?.sort?.[0]?.by || "",
          sortDir: v.options?.sortDir || v.spec?.sort?.[0]?.dir || "desc",
          limit: v.options?.limit || v.spec?.limit || 100,
          layout: v.layout || { x: 0, y: 0, w: 6, h: 5 },
          options: { legend: v.options?.legend !== false },
        })),
      }));
      setPages(loaded.length ? loaded : [{ id: uid(), title: "Page 1", visuals: [], slicers: [] }]);
      setPageIdx(0); setDashId(id); setDashName(j.name); setDirty(false); setDrawer(false); setXf(null);
    } catch (e: any) { setErr(e.message); }
  };

  const newDashboard = () => {
    setPages([{ id: uid(), title: "Page 1", visuals: [], slicers: [] }]);
    setPageIdx(0); setDashId(null); setDashName("Untitled dashboard");
    setDirty(false); setXf(null); setSelId(""); setDrawer(false);
  };

  const exportPng = async () => {
    if (!canvasRef.current) return;
    const html2canvas = (await import("html2canvas")).default;
    const cv = await html2canvas(canvasRef.current, { backgroundColor: getComputedStyle(document.body).backgroundColor || "#0d1117", scale: 2 });
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `${dashName.replace(/[^\w -]/g, "_")}_${page.title.replace(/[^\w -]/g, "_")}.png`;
    a.click();
  };

  const exportCsv = (v: Visual) => {
    const res = results[v.id];
    if (!res?.ok || !res.rows.length) return;
    const blob = new Blob([csvOf(res.columns, res.rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(v.title || "visual").replace(/[^\w -]/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ------------------------------------------------------------ cross-filter */

  const crossFilter = (v: Visual, row: Record<string, any>) => {
    if (!v.dims.length) return;
    const field = v.dims[0];
    const value = row[field];
    if (value == null) return;
    setXf((cur) =>
      cur && cur.sourceId === v.id && cur.field === field && cur.value === value
        ? null // click again to clear
        : { sourceId: v.id, dataset: v.dataset, field, value, label: `${dsMap[v.dataset]?.dimensions.find((d) => d.key === field)?.label || field} = ${value}` });
  };

  /* ------------------------------------------------------------ selected item */

  const selVisual = page.visuals.find((v) => v.id === selId) || null;
  const selSlicer = page.slicers.find((s) => s.id === selId) || null;

  const canvasH = Math.max(
    560,
    ...page.visuals.map((v) => (v.layout.y + v.layout.h) * (ROW_H + GAP) + 40),
    ...page.slicers.map((s) => (s.layout.y + s.layout.h) * (ROW_H + GAP) + 40),
  );

  /* ------------------------------------------------------------ gridstack css */

const GS_CSS = `
  .grid-stack-item-content { inset: 5px; }
  .grid-stack > .grid-stack-item > .ui-resizable-se {
    background: none; width: 12px; height: 12px; right: 6px; bottom: 6px;
    border-right: 2px solid var(--ink-4); border-bottom: 2px solid var(--ink-4);
    transform: none; opacity: .55;
  }
  .grid-stack-placeholder > .placeholder-content {
    background: var(--steel-soft, rgba(74,168,199,.15));
    border: 1px dashed var(--steel); border-radius: 10px;
  }
`;

/* ================================================================ render */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 130px)", minHeight: 620 }}>
      <style>{GS_CSS}</style>

      {/* ---------- toolbar ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <LayoutDashboard size={16} style={{ color: "var(--steel)" }} />
        <input value={dashName} onChange={(e) => { setDashName(e.target.value); setDirty(true); }}
               style={{ ...inp, width: 240, fontWeight: 800, fontSize: 13 }} />
        {dirty && <span style={{ fontSize: 10.5, color: "var(--amber, #f0883e)", fontWeight: 700 }}>● unsaved</span>}
        <div style={{ flex: 1 }} />
        <button style={btn()} onClick={addVisual}><Plus size={13} /> Visual</button>
        <button style={btn()} onClick={addSlicer}><SlidersHorizontal size={13} /> Slicer</button>
        <button style={btn()} onClick={runPage} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        <button style={btn()} onClick={exportPng}><ImageIcon size={13} /> PNG</button>
        <button style={btn()} onClick={openDrawer}><FolderOpen size={13} /> Open</button>
        <button style={btn("primary")} onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save
        </button>
      </div>

      {err && (
        <div style={{ margin: "8px 16px 0", padding: "7px 12px", borderRadius: 8, background: "rgba(229,83,75,.12)", border: "1px solid rgba(229,83,75,.4)", color: "#e5534b", fontSize: 12, fontWeight: 600 }}>
          {err} <button style={{ ...btn(), border: "none", padding: 2, marginLeft: 6 }} onClick={() => setErr("")}><X size={12} /></button>
        </div>
      )}

      {/* ---------- page tabs + cross-filter chip ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px 0" }}>
        {pages.map((p, i) => (
          <div key={p.id} onClick={() => setPageIdx(i)}
               style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                        fontSize: 12, fontWeight: 750,
                        background: i === pageIdx ? "var(--steel-soft)" : "transparent",
                        color: i === pageIdx ? "var(--steel)" : "var(--ink-3)",
                        border: `1px solid ${i === pageIdx ? "var(--line)" : "transparent"}` }}>
            {i === pageIdx ? (
              <input value={p.title}
                     onChange={(e) => patchPage((pg) => ({ ...pg, title: e.target.value }))}
                     onClick={(e) => e.stopPropagation()}
                     style={{ background: "transparent", border: "none", outline: "none", color: "inherit", fontWeight: 750, fontSize: 12, width: Math.max(50, p.title.length * 7) }} />
            ) : p.title}
            {pages.length > 1 && i === pageIdx && (
              <X size={11} style={{ opacity: 0.7 }} onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                setPages((ps) => ps.filter((_, j) => j !== i));
                setPageIdx((j) => Math.max(0, j - (i <= j ? 1 : 0)));
                setDirty(true);
              }} />
            )}
          </div>
        ))}
        <button style={{ ...btn(), padding: "4px 8px" }}
                onClick={() => { setPages((ps) => [...ps, { id: uid(), title: `Page ${ps.length + 1}`, visuals: [], slicers: [] }]); setPageIdx(pages.length); setDirty(true); }}>
          <Plus size={12} />
        </button>
        <div style={{ flex: 1 }} />
        {xf && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                         background: "var(--steel-soft)", color: "var(--steel)", border: "1px solid var(--line)" }}>
            <FilterIcon size={11} /> {xf.label}
            <X size={12} style={{ cursor: "pointer" }} onClick={() => setXf(null)} />
          </span>
        )}
      </div>

      {/* ---------- canvas + config panel ---------- */}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0, padding: "10px 16px 16px" }}>

        {/* canvas */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
          <div ref={canvasRef} className="grid-stack" key={page.id} style={{ minHeight: canvasH, margin: 12 }}>
            {page.visuals.length === 0 && page.slicers.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-4)", fontSize: 13 }}>
                <div style={{ textAlign: "center" }}>
                  <LayoutDashboard size={34} style={{ opacity: 0.4, marginBottom: 10 }} />
                  <div style={{ fontWeight: 700 }}>Empty page</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Add a <b>Visual</b> or a <b>Slicer</b> from the toolbar, then configure fields on the right.</div>
                </div>
              </div>
            )}

            {/* slicer tiles */}
            {page.slicers.map((s) => {
              const sel = selId === s.id;
              return (
                <div key={`${page.id}:${s.id}`} className="grid-stack-item" gs-id={s.id}
                     gs-x={s.layout.x} gs-y={s.layout.y} gs-w={s.layout.w} gs-h={s.layout.h} gs-min-w={2} gs-min-h={2}>
                <div className="grid-stack-item-content" onClick={() => setSelId(s.id)}
                     style={{ ...panel, display: "flex", flexDirection: "column",
                              borderColor: sel ? "var(--steel)" : "var(--line)", boxShadow: sel ? "0 0 0 1px var(--steel)" : "none", overflow: "hidden" }}>
                  <div className="dc-drag"
                       style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "grab",
                                borderBottom: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 11.5, fontWeight: 800, color: "var(--ink-2)" }}>
                    <SlidersHorizontal size={12} style={{ color: "var(--steel)" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                    <Trash2 size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeItem(s.id); }} />
                  </div>
                  <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
                    {s.type === "list" ? (
                      <SlicerList s={s} members={memberCache[`${s.dataset}::${s.field}`] || []}
                                  onChange={(selected) => patchSlicer(s.id, { selected })} />
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        <label style={{ fontSize: 10.5, color: "var(--ink-4)", fontWeight: 700 }}>From</label>
                        <input type="date" style={inp} value={s.from || ""} onChange={(e) => patchSlicer(s.id, { from: e.target.value })} />
                        <label style={{ fontSize: 10.5, color: "var(--ink-4)", fontWeight: 700 }}>To</label>
                        <input type="date" style={inp} value={s.to || ""} onChange={(e) => patchSlicer(s.id, { to: e.target.value })} />
                        {(s.from || s.to) && (
                          <button style={btn()} onClick={() => patchSlicer(s.id, { from: "", to: "" })}><X size={11} /> Clear</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                </div>
              );
            })}

            {/* visual tiles */}
            {page.visuals.map((v) => {
              const res = results[v.id];
              const sel = selId === v.id;
              const isXfSource = xf?.sourceId === v.id;
              return (
                <div key={`${page.id}:${v.id}`} className="grid-stack-item" gs-id={v.id}
                     gs-x={v.layout.x} gs-y={v.layout.y} gs-w={v.layout.w} gs-h={v.layout.h} gs-min-w={2} gs-min-h={2}>
                <div className="grid-stack-item-content" onClick={() => setSelId(v.id)}
                     style={{ ...panel, display: "flex", flexDirection: "column",
                              borderColor: sel ? "var(--steel)" : isXfSource ? "var(--amber, #f0883e)" : "var(--line)",
                              boxShadow: sel ? "0 0 0 1px var(--steel)" : "none", overflow: "hidden" }}>
                  <div className="dc-drag"
                       style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "grab",
                                borderBottom: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 11.5, fontWeight: 800, color: "var(--ink-2)" }}>
                    <GripVertical size={12} style={{ opacity: 0.5 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title || "Visual"}</span>
                    {isXfSource && <FilterIcon size={11} style={{ color: "var(--amber, #f0883e)" }} />}
                    <Download size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); exportCsv(v); }} />
                    <Copy size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); duplicateVisual(v.id); }} />
                    <Trash2 size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeItem(v.id); }} />
                  </div>
                  <div style={{ flex: 1, minHeight: 0, padding: v.viz === "table" ? 0 : 6 }}>
                    {!runnable(v) ? (
                      <Hint text="Pick a dataset, then add fields →" />
                    ) : !res ? (
                      <Hint text={busy ? "Running…" : "No data yet"} />
                    ) : !res.ok ? (
                      <Hint text={res.error || "Query error"} danger />
                    ) : res.rows.length === 0 ? (
                      <Hint text="No rows match current filters" />
                    ) : (
                      <VisualBody v={v} res={res} onPoint={(row) => crossFilter(v, row)} xf={xf} />
                    )}
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- config panel ---------- */}
        <div style={{ width: 292, flexShrink: 0, overflow: "auto", ...panel, padding: 12 }}>
          {selVisual ? (
            <VisualConfig v={selVisual} datasets={datasets} dsMap={dsMap} patch={(p) => patchVisual(selVisual.id, p)} />
          ) : selSlicer ? (
            <SlicerConfig s={selSlicer} datasets={datasets} dsMap={dsMap}
                          patch={(p) => patchSlicer(selSlicer.id, p)} />
          ) : (
            <div style={{ color: "var(--ink-4)", fontSize: 12, lineHeight: 1.6 }}>
              <b style={{ color: "var(--ink-2)" }}>Nothing selected</b>
              <p style={{ margin: "8px 0" }}>Click a tile on the canvas to configure its dataset, fields, visual type and filters.</p>
              <p style={{ margin: "8px 0" }}>Power BI-style interactions:</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>Drag a tile header to move · drag the corner to resize</li>
                <li><b>Click a bar / slice / row</b> to cross-filter other visuals on the page (click again or ✕ the chip to clear)</li>
                <li>Slicers filter every visual sharing their dataset</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ---------- open drawer ---------- */}
      {drawer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
             onClick={() => setDrawer(false)}>
          <div style={{ width: 380, height: "100%", background: "var(--panel)", borderLeft: "1px solid var(--line)", padding: 16, overflow: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <FolderOpen size={15} style={{ color: "var(--steel)" }} />
              <b style={{ fontSize: 13, flex: 1 }}>Saved dashboards</b>
              <button style={btn()} onClick={newDashboard}><Plus size={12} /> New</button>
              <X size={15} style={{ cursor: "pointer" }} onClick={() => setDrawer(false)} />
            </div>
            {dashList.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>None saved yet.</div>}
            {dashList.map((d) => (
              <div key={d.dashboard_id}
                   style={{ ...panel, padding: "10px 12px", marginBottom: 8, cursor: "pointer",
                            borderColor: d.dashboard_id === dashId ? "var(--steel)" : "var(--line)" }}
                   onClick={() => load(d.dashboard_id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {d.is_pinned && <Pin size={11} style={{ color: "var(--steel)" }} />}
                  <b style={{ fontSize: 12.5, flex: 1 }}>{d.name}</b>
                  <Trash2 size={12} style={{ opacity: 0.6 }} onClick={async (e: React.MouseEvent) => {
                    e.stopPropagation();
                    await authFetch(rs(`/dashboards/${d.dashboard_id}`), { method: "DELETE" });
                    setDashList((l) => l.filter((x) => x.dashboard_id !== d.dashboard_id));
                    if (dashId === d.dashboard_id) newDashboard();
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>
                  {d.page_count} page{d.page_count === 1 ? "" : "s"} · {new Date(d.updated_at).toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================ pieces */

function Hint({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 10 }}>
      <span style={{ fontSize: 11.5, color: danger ? "#e5534b" : "var(--ink-4)", textAlign: "center", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

/** Chart / table / KPI body for one visual. Click handlers drive cross-filtering. */
function VisualBody({ v, res, onPoint, xf }: {
  v: Visual; res: QueryResult; onPoint: (row: Record<string, any>) => void; xf: XFilter | null;
}) {
  const dimKey = v.dims[0];
  const numCols = res.columns.filter((c) => isNum(c.type) && c.key !== dimKey);
  const rows = res.rows;

  if (v.viz === "kpi") {
    const cells = numCols.length ? numCols : res.columns.slice(0, 1);
    return (
      <div style={{ height: "100%", display: "grid", gridTemplateColumns: `repeat(${Math.min(cells.length, 3)}, 1fr)`, gap: 8, padding: 6, alignContent: "center" }}>
        {cells.slice(0, 6).map((c, i) => (
          <div key={c.key} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 850, color: COLORS[i % COLORS.length], fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)" }}>
              {fmtNum(rows[0]?.[c.key])}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontWeight: 700, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>
    );
  }

  if (v.viz === "table") {
    return (
      <div style={{ height: "100%", overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
          <thead>
            <tr>
              {res.columns.map((c) => (
                <th key={c.key} style={{ position: "sticky", top: 0, background: "var(--panel-2)", textAlign: isNum(c.type) ? "right" : "left",
                                          padding: "6px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink-3)", fontWeight: 800, whiteSpace: "nowrap" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const active = xf && xf.sourceId === v.id && r[xf.field] === xf.value;
              return (
                <tr key={i} onClick={(e) => { e.stopPropagation(); onPoint(r); }}
                    style={{ cursor: dimKey ? "pointer" : "default", background: active ? "var(--steel-soft)" : "transparent" }}>
                  {res.columns.map((c) => (
                    <td key={c.key} style={{ padding: "5px 10px", borderBottom: "1px solid var(--line)",
                                             textAlign: isNum(c.type) ? "right" : "left",
                                             color: isNum(c.type) ? "var(--ink)" : "var(--ink-2)",
                                             fontFamily: isNum(c.type) ? "var(--font-mono, 'IBM Plex Mono', monospace)" : undefined,
                                             whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                      {isNum(c.type) ? fmtNum(r[c.key]) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (v.viz === "pie" || v.viz === "donut") {
    const valKey = numCols[0]?.key;
    if (!dimKey || !valKey) return <Hint text="Pie needs 1 dimension + 1 measure" />;
    return <EChartsViz v={v} res={res} xf={xf} onPoint={onPoint} />;
  }
  if (v.viz === "bar" || v.viz === "stackedbar" || v.viz === "line" || v.viz === "area") {
    if (!dimKey || !numCols.length) return <Hint text="Add 1 dimension + at least 1 measure" />;
    return <EChartsViz v={v} res={res} xf={xf} onPoint={onPoint} />;
  }
  return <Hint text="Unknown visual type" />;
}

/** Multi-select member list with search — the list slicer body. */
function SlicerList({ s, members, onChange }: { s: Slicer; members: string[]; onChange: (sel: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => members.filter((m) => m.toLowerCase().includes(q.toLowerCase())).slice(0, 250),
    [members, q]);
  const toggle = (m: string) =>
    onChange(s.selected.includes(m) ? s.selected.filter((x) => x !== m) : [...s.selected, m]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%" }}>
      <div style={{ position: "relative" }}>
        <Search size={11} style={{ position: "absolute", left: 7, top: 8, color: "var(--ink-4)" }} />
        <input style={{ ...inp, paddingLeft: 22 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {s.selected.length > 0 && (
        <button style={{ ...btn(), padding: "3px 8px", fontSize: 11 }} onClick={() => onChange([])}>
          <X size={10} /> Clear ({s.selected.length})
        </button>
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        {shown.map((m) => (
          <label key={m} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 2px", fontSize: 11.5, color: "var(--ink-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={s.selected.includes(m)} onChange={() => toggle(m)} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</span>
          </label>
        ))}
        {members.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-4)", padding: 4 }}>Loading members…</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- config panels */

function VisualConfig({ v, datasets, dsMap, patch }: {
  v: Visual; datasets: Dataset[]; dsMap: Record<string, Dataset>; patch: (p: Partial<Visual>) => void;
}) {
  const ds = dsMap[v.dataset];
  const [fieldQ, setFieldQ] = useState("");
  const match = (f: Field) => f.label.toLowerCase().includes(fieldQ.toLowerCase());

  const addDim = (k: string) => !v.dims.includes(k) && patch({ dims: [...v.dims, k] });
  const addMeasure = (f: Field) =>
    !v.measures.some((m) => m.field === f.key) &&
    patch({ measures: [...v.measures, { field: f.key, agg: f.default_agg || "sum" }] });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={13} style={{ color: "var(--steel)" }} />
        <b style={{ fontSize: 12.5, flex: 1 }}>Visual settings</b>
      </div>

      <div style={secLabel}>Title</div>
      <input style={inp} value={v.title} onChange={(e) => patch({ title: e.target.value })} />

      <div style={secLabel}>Dataset</div>
      <select style={inp} value={v.dataset}
              onChange={(e) => patch({ dataset: e.target.value, dims: [], measures: [], conds: [], sortBy: "" })}>
        {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>

      <div style={secLabel}>Visual type</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
        {VIZ_DEFS.map((z) => (
          <button key={z.v} onClick={() => patch({ viz: z.v })}
                  title={z.label}
                  style={{ ...btn(v.viz === z.v ? "primary" : "ghost"), padding: "6px 4px", justifyContent: "center", flexDirection: "column", gap: 2, fontSize: 9.5 }}>
            {z.icon}{z.label}
          </button>
        ))}
      </div>

      {ds && (
        <>
          <div style={secLabel}>Axis / group by ({v.dims.length})</div>
          {v.dims.map((k) => {
            const f = ds.dimensions.find((d) => d.key === k);
            return (
              <Chip key={k} icon={<TypeIcon type={f?.type || "text"} />} label={f?.label || k}
                    onRemove={() => patch({ dims: v.dims.filter((x) => x !== k) })} />
            );
          })}

          <div style={secLabel}>Values ({v.measures.length})</div>
          {v.measures.map((m, i) => {
            const f = ds.measures.find((x) => x.key === m.field);
            return (
              <div key={m.field} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f?.label || m.field}
                </span>
                <select style={{ ...inp, width: 92 }} value={m.agg}
                        onChange={(e) => patch({ measures: v.measures.map((x, j) => (j === i ? { ...x, agg: e.target.value } : x)) })}>
                  {["sum", "avg", "min", "max", "count", "count_distinct"].map((a) => <option key={a}>{a}</option>)}
                </select>
                <X size={12} style={{ cursor: "pointer", color: "var(--ink-4)" }}
                   onClick={() => patch({ measures: v.measures.filter((_, j) => j !== i) })} />
              </div>
            );
          })}

          <div style={secLabel}>Fields — click to add</div>
          <div style={{ position: "relative", marginBottom: 5 }}>
            <Search size={11} style={{ position: "absolute", left: 7, top: 8, color: "var(--ink-4)" }} />
            <input style={{ ...inp, paddingLeft: 22 }} placeholder="Find field…" value={fieldQ} onChange={(e) => setFieldQ(e.target.value)} />
          </div>
          <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 4 }}>
            {ds.dimensions.filter(match).map((f) => (
              <FieldRow key={f.key} f={f} muted={v.dims.includes(f.key)} onClick={() => addDim(f.key)} />
            ))}
            <div style={{ borderTop: "1px dashed var(--line)", margin: "4px 0" }} />
            {ds.measures.filter(match).map((f) => (
              <FieldRow key={f.key} f={f} muted={v.measures.some((m) => m.field === f.key)} onClick={() => addMeasure(f)} sigma />
            ))}
          </div>

          <div style={secLabel}>Sort · limit</div>
          <div style={{ display: "flex", gap: 4 }}>
            <select style={inp} value={v.sortBy} onChange={(e) => patch({ sortBy: e.target.value })}>
              <option value="">No sort</option>
              {[...v.dims, ...v.measures.map((m) => m.alias || m.field)].map((k) => <option key={k}>{k}</option>)}
            </select>
            <select style={{ ...inp, width: 70 }} value={v.sortDir} onChange={(e) => patch({ sortDir: e.target.value as any })}>
              <option value="desc">desc</option><option value="asc">asc</option>
            </select>
            <input style={{ ...inp, width: 62 }} type="number" min={1} max={1000} value={v.limit}
                   onChange={(e) => patch({ limit: Math.max(1, Number(e.target.value) || 100) })} />
          </div>

          <div style={secLabel}>Visual-level filters</div>
          {v.conds.map((c, i) => {
            const f = ds.dimensions.find((d) => d.key === c.field);
            return (
              <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                <select style={{ ...inp, width: 96 }} value={c.field}
                        onChange={(e) => patch({ conds: v.conds.map((x, j) => (j === i ? { ...x, field: e.target.value, value: undefined } : x)) })}>
                  {ds.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <select style={{ ...inp, width: 78 }} value={c.op}
                        onChange={(e) => patch({ conds: v.conds.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                  {(f?.type === "date"
                    ? ["this_fy", "last_fy", "ytd", "this_quarter", "this_month", "=", ">=", "<=", "not_null", "is_null"]
                    : f?.type === "bool"
                      ? ["is_true", "is_false"]
                      : ["=", "!=", "contains", "starts_with", ">", ">=", "<", "<=", "not_null", "is_null"]
                  ).map((o) => <option key={o}>{o}</option>)}
                </select>
                {!["is_null", "not_null", "is_true", "is_false", "this_fy", "last_fy", "ytd", "this_quarter", "this_month"].includes(c.op) && (
                  <input style={{ ...inp, flex: 1, minWidth: 0 }} value={c.value ?? ""} placeholder="value"
                         type={f?.type === "date" ? "date" : "text"}
                         onChange={(e) => patch({ conds: v.conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                )}
                <X size={12} style={{ cursor: "pointer", color: "var(--ink-4)", flexShrink: 0 }}
                   onClick={() => patch({ conds: v.conds.filter((_, j) => j !== i) })} />
              </div>
            );
          })}
          <button style={{ ...btn(), padding: "4px 8px", fontSize: 11 }}
                  onClick={() => ds.dimensions[0] && patch({ conds: [...v.conds, { field: ds.dimensions[0].key, op: "=" }] })}>
            <Plus size={11} /> Add filter
          </button>

          <div style={secLabel}>Options</div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" }}>
            <input type="checkbox" checked={v.options.legend !== false}
                   onChange={(e) => patch({ options: { ...v.options, legend: e.target.checked } })} />
            Show legend
          </label>
        </>
      )}
    </div>
  );
}

function SlicerConfig({ s, datasets, dsMap, patch }: {
  s: Slicer; datasets: Dataset[]; dsMap: Record<string, Dataset>; patch: (p: Partial<Slicer>) => void;
}) {
  const ds = dsMap[s.dataset];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SlidersHorizontal size={13} style={{ color: "var(--steel)" }} />
        <b style={{ fontSize: 12.5 }}>Slicer settings</b>
      </div>

      <div style={secLabel}>Label</div>
      <input style={inp} value={s.label} onChange={(e) => patch({ label: e.target.value })} />

      <div style={secLabel}>Dataset</div>
      <select style={inp} value={s.dataset}
              onChange={(e) => {
                const nds = dsMap[e.target.value];
                const f = nds?.dimensions[0];
                patch({ dataset: e.target.value, field: f?.key || "", label: f?.label || "", selected: [], from: "", to: "",
                        type: f?.type === "date" ? "daterange" : "list" });
              }}>
        {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>

      <div style={secLabel}>Field</div>
      <select style={inp} value={s.field}
              onChange={(e) => {
                const f = ds?.dimensions.find((d) => d.key === e.target.value);
                patch({ field: e.target.value, label: f?.label || e.target.value, selected: [], from: "", to: "",
                        type: f?.type === "date" ? "daterange" : "list" });
              }}>
        {(ds?.dimensions || []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>

      <p style={{ fontSize: 11, color: "var(--ink-4)", lineHeight: 1.5, marginTop: 12 }}>
        {s.type === "daterange"
          ? "Date-range slicer: filters every visual on this page whose dataset matches, on this date field."
          : "List slicer: pick one or more members — filters every visual on this page whose dataset matches."}
      </p>
    </div>
  );
}

function Chip({ icon, label, onRemove }: { icon: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", margin: "0 4px 4px 0",
                   borderRadius: 999, fontSize: 11, fontWeight: 700, background: "var(--steel-soft)", color: "var(--steel)", border: "1px solid var(--line)" }}>
      {icon} {label}
      <X size={11} style={{ cursor: "pointer" }} onClick={onRemove} />
    </span>
  );
}

function FieldRow({ f, muted, onClick, sigma }: { f: Field; muted: boolean; onClick: () => void; sigma?: boolean }) {
  return (
    <div onClick={muted ? undefined : onClick}
         style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 6, fontSize: 11.5,
                  cursor: muted ? "default" : "pointer", opacity: muted ? 0.4 : 1, color: "var(--ink-2)" }}>
      {sigma ? <Sigma size={11} style={{ color: "var(--amber, #f0883e)" }} /> : <TypeIcon type={f.type} />}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</span>
      {!muted && <Plus size={11} style={{ color: "var(--ink-4)" }} />}
    </div>
  );
}
