"use client";

/**
 * WYSIWYG Report Template Designer (C4) — compose a report from live-bound
 * blocks (heading, text with {{placeholders}}, KPI row, data table, chart,
 * page break), reorder/edit/delete inline, save as a named template, and
 * print. Every block binds to the unified data context so the designed report
 * always shows the same numbers as the DPR summary / dashboards / statics.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, BarChart3, Download, FileText, Heading1, LayoutTemplate,
  Loader2, Plus, Printer, Save, Table2, Trash2, Type, X,
} from "lucide-react";
import { exportPayload } from "@/lib/export";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const API = "http://localhost:8000/api/v1";

type Block = { id: string; type: string; props: Record<string, any> };
type TemplateMeta = { template_id: number; name: string; block_count: number };
type Ctx = Record<string, any>;

const uid = () => Math.random().toString(36).slice(2, 9);

const TABLE_SOURCES: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  summary_rows: {
    label: "DPR Summary rows",
    columns: [
      { key: "activity", label: "Activity" }, { key: "scope", label: "Scope" },
      { key: "uom", label: "UoM" }, { key: "lastFyActual", label: "Till Last FY" },
      { key: "ftmPlan", label: "FTM Plan" }, { key: "ftmActual", label: "FTM Actual" },
      { key: "currentFyPlanPercent", label: "FY Plan %" }, { key: "currentFyActualPercent", label: "FY Actual %" },
      { key: "cumulativePlanPercent", label: "Cum Plan %" }, { key: "cumulativeActualPercent", label: "Cum Actual %" },
    ],
  },
  pmc_activities: {
    label: "PMC activity rows",
    columns: [
      { key: "item", label: "Item" }, { key: "scope", label: "Scope" }, { key: "uom", label: "UoM" },
      { key: "overallTarget", label: "Overall Target %" }, { key: "cumulativePrevious", label: "Cumulative %" },
      { key: "targetMonth", label: "Month Target %" }, { key: "nextMonthTarget", label: "Next Month %" },
      { key: "achievementMonth", label: "Achievement %" },
    ],
  },
  capex_monthly: {
    label: "CAPEX monthly",
    columns: [
      { key: "month", label: "Month" }, { key: "plan", label: "Plan (Cr)" }, { key: "actual", label: "Actual (Cr)" },
    ],
  },
  "manpower.rows": {
    label: "Manpower month-average",
    columns: [
      { key: "agency", label: "Agency" }, { key: "manpower", label: "Manpower" },
      { key: "category", label: "Category" }, { key: "value", label: "Avg / day" },
    ],
  },
};

const KPI_OPTIONS = [
  { key: "meta.plannedPercent", label: "Planned %", suffix: "%" },
  { key: "meta.actualPercent", label: "Actual %", suffix: "%" },
  { key: "meta.grossCostCr", label: "Gross Cost", prefix: "₹", suffix: " Cr" },
  { key: "capex.expLastFy", label: "Exp. till last FY", prefix: "₹", suffix: " Cr" },
  { key: "capex.beFy", label: "BE (FY)", prefix: "₹", suffix: " Cr" },
  { key: "delay.projectSlipDays", label: "Forecast slip", suffix: " d" },
];

const CHART_SOURCES: Record<string, string> = {
  scurve_trend: "S-Curve (cumulative %)",
  capex_monthly: "CAPEX plan vs actual (Cr)",
};

function getPath(ctx: Ctx, path: string) {
  return path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), ctx);
}
const num = (v: any, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

function substitute(text: string, ctx: Ctx) {
  return String(text || "").replace(/\{\{([\w.]+)\}\}/g, (_, p) => {
    const v = getPath(ctx, p);
    return v == null ? `{{${p}}}` : (typeof v === "number" ? num(v) : String(v));
  });
}

const DEFAULT_BLOCKS: Block[] = [
  { id: uid(), type: "heading", props: { text: "{{meta.schemeName}} — Monthly Progress Report", level: 1 } },
  { id: uid(), type: "paragraph", props: { text: "As on {{meta.asOf}} · {{meta.financialYear}} · Plan month {{meta.month}}" } },
  { id: uid(), type: "kpis", props: { keys: ["meta.plannedPercent", "meta.actualPercent", "meta.grossCostCr", "delay.projectSlipDays"] } },
  { id: uid(), type: "table", props: { source: "summary_rows", columns: ["activity", "scope", "uom", "cumulativePlanPercent", "cumulativeActualPercent"] } },
  { id: uid(), type: "chart", props: { source: "scurve_trend", kind: "line" } },
];

// ─────────────────────────── block renderers ────────────────────────────────

function BlockView({ block, ctx }: { block: Block; ctx: Ctx | null }) {
  const p = block.props || {};
  if (!ctx) return <div className="py-3 text-xs text-slate-400">Loading data…</div>;
  if (block.type === "heading") {
    const cls = p.level === 2 ? "text-lg" : p.level === 3 ? "text-base" : "text-2xl";
    return <h2 className={`${cls} font-bold text-slate-900`}>{substitute(p.text, ctx)}</h2>;
  }
  if (block.type === "paragraph") {
    return <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{substitute(p.text, ctx)}</p>;
  }
  if (block.type === "kpis") {
    const keys: string[] = p.keys || [];
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, keys.length))}, 1fr)` }}>
        {keys.map((k) => {
          const opt = KPI_OPTIONS.find((o) => o.key === k);
          const v = getPath(ctx, k);
          return (
            <div key={k} className="rounded-lg border border-slate-300 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">{opt?.label || k}</p>
              <p className="text-xl font-bold text-slate-900">{opt?.prefix || ""}{num(v)}{opt?.suffix || ""}</p>
            </div>
          );
        })}
      </div>
    );
  }
  if (block.type === "table") {
    const spec = TABLE_SOURCES[p.source];
    const rows: any[] = getPath(ctx, p.source) || [];
    const cols = (p.columns || []).map((k: string) => spec?.columns.find((c) => c.key === k)).filter(Boolean);
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>{cols.map((c: any) => (
            <th key={c.key} className="border border-slate-400 bg-slate-100 px-2 py-1.5 text-[10px] font-bold uppercase text-slate-700">{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.slice(0, p.maxRows || 40).map((r, i) => (
            <tr key={i} className={r.overall ? "bg-violet-50 font-bold" : r.source === "capex" ? "bg-amber-50" : ""}>
              {cols.map((c: any) => {
                const v = r[c.key];
                return <td key={c.key} className={`border border-slate-300 px-2 py-1 ${typeof v === "number" ? "text-right" : "text-left"}`}>
                  {typeof v === "number" ? num(v) : (v ?? "—")}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.type === "chart") {
    const data: any[] = getPath(ctx, p.source) || [];
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {p.source === "capex_monthly" || p.kind === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="plan" name="Plan" fill="#0ea5e9" />
              <Bar dataKey="actual" name="Actual" fill="#10b981" />
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="cumulativePlanPercent" name="Plan %" stroke="#0ea5e9" strokeDasharray="6 3" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cumulativeActualPercent" name="Actual %" stroke="#10b981" dot={false} strokeWidth={2.5} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }
  if (block.type === "pagebreak") {
    return <div className="border-t-2 border-dashed border-slate-300 py-1 text-center text-[9px] uppercase tracking-widest text-slate-400 print:break-after-page">page break</div>;
  }
  return null;
}

// ─────────────────────────── block editor ───────────────────────────────────

function BlockEditor({ block, onChange, onClose }: { block: Block; onChange: (b: Block) => void; onClose: () => void }) {
  const p = block.props || {};
  const set = (patch: Record<string, any>) => onChange({ ...block, props: { ...p, ...patch } });
  const spec = TABLE_SOURCES[p.source];
  return (
    <div className="rounded-lg border border-cyan-300 bg-cyan-50/70 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wide text-cyan-800">{block.type} settings</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X size={14} /></button>
      </div>
      {(block.type === "heading" || block.type === "paragraph") && (
        <>
          <textarea value={p.text || ""} onChange={(e) => set({ text: e.target.value })} rows={block.type === "paragraph" ? 3 : 1}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 outline-none" />
          <p className="mt-1 text-[10px] text-slate-500">
            Placeholders: {"{{meta.schemeName}} {{meta.month}} {{meta.actualPercent}} {{meta.financialYear}} {{delay.projectSlipDays}}"}
          </p>
          {block.type === "heading" && (
            <label className="mt-1 block">Level{" "}
              <select value={p.level || 1} onChange={(e) => set({ level: Number(e.target.value) })}
                className="rounded border border-slate-300 bg-white px-1 py-0.5">
                {[1, 2, 3].map((l) => <option key={l} value={l}>H{l}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      {block.type === "kpis" && (
        <div className="flex flex-wrap gap-2">
          {KPI_OPTIONS.map((o) => (
            <label key={o.key} className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1">
              <input type="checkbox" checked={(p.keys || []).includes(o.key)}
                onChange={(e) => set({ keys: e.target.checked ? [...(p.keys || []), o.key] : (p.keys || []).filter((k: string) => k !== o.key) })} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      {block.type === "table" && (
        <>
          <label className="block">Data source{" "}
            <select value={p.source || ""} onChange={(e) => {
              const s = TABLE_SOURCES[e.target.value];
              set({ source: e.target.value, columns: s ? s.columns.slice(0, 6).map((c) => c.key) : [] });
            }} className="rounded border border-slate-300 bg-white px-1 py-0.5">
              {Object.entries(TABLE_SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          {spec && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {spec.columns.map((c) => (
                <label key={c.key} className="flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5">
                  <input type="checkbox" checked={(p.columns || []).includes(c.key)}
                    onChange={(e) => set({ columns: e.target.checked ? [...(p.columns || []), c.key] : (p.columns || []).filter((k: string) => k !== c.key) })} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {block.type === "chart" && (
        <label className="block">Source{" "}
          <select value={p.source || "scurve_trend"} onChange={(e) => set({ source: e.target.value })}
            className="rounded border border-slate-300 bg-white px-1 py-0.5">
            {Object.entries(CHART_SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

// ─────────────────────────── designer shell ─────────────────────────────────

export default function TemplateDesigner() {
  const [schemes, setSchemes] = useState<{ id: number; name: string }[]>([]);
  const [schemeId, setSchemeId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [blocks, setBlocks] = useState<Block[]>(DEFAULT_BLOCKS);
  const [name, setName] = useState("Monthly Progress Brief");
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  const buildExportPayload = () => {
    const meta = ctx?.meta || {};
    const kpiLines = (blocks.filter((b) => b.type === "kpis")[0]?.props?.keys || []).map((k: string) => {
      const opt = KPI_OPTIONS.find((o) => o.key === k);
      const v = getPath(ctx || {}, k);
      return [opt?.label || k, v];
    });
    const tableBlock = blocks.find((b) => b.type === "table");
    const tableSections: any[] = [];
    if (tableBlock && ctx) {
      const source = tableBlock.props.source;
      const cols = tableBlock.props.columns || [];
      const rows = (getPath(ctx, source) || []).map((r: any) => cols.map((c: string) => r[c]));
      const headers = cols.map((c: string) => TABLE_SOURCES[source]?.columns.find((x) => x.key === c)?.label || c);
      tableSections.push({ title: TABLE_SOURCES[source]?.label || "Data", headers, rows });
    }
    const paras = blocks
      .filter((b) => b.type === "paragraph" || b.type === "heading")
      .map((b) => substitute(b.props.text || "", ctx || {}));
    return {
      title: name || "Designed Report",
      project_label: meta.schemeName || schemes.find((s) => String(s.id) === schemeId)?.name || "—",
      fy_label: meta.financialYear || "—",
      month_label: month,
      status_text: `Plan ${meta.plannedPercent ?? "—"}% · Actual ${meta.actualPercent ?? "—"}%`,
      header_lines: paras.slice(0, 8),
      physical_text: paras.join("\n"),
      stage_text: "",
      capex_text: "",
      dpr_summary: [],
      kpi_rows: kpiLines,
      table_sections: tableSections,
    };
  };

  const runExport = async (format: "pdf" | "docx" | "xlsx") => {
    setExporting(true);
    setMsg("");
    try {
      await exportPayload({
        format,
        payload: buildExportPayload(),
        filenameStem: name || "template_report",
      });
      setMsg(`Exported ${format.toUpperCase()} ✓`);
    } catch (e: any) {
      setMsg(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      setSchemes(d.map((s: any) => ({ id: s.id, name: s.name })));
      setSchemeId((c) => c || String(d.find((s: any) => s.id === 74)?.id || d[0]?.id || ""));
    }).catch(() => {});
    loadTemplates();
  }, []);

  const loadTemplates = () =>
    fetch(`${API}/report-templates`).then((r) => r.json()).then((d) => setTemplates(d.templates || [])).catch(() => {});

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    fetch(`${API}/report-templates-data?scheme_id=${schemeId}&month=${month}`)
      .then((r) => r.json()).then((d) => alive && setCtx(d)).catch(() => {});
    return () => { alive = false; };
  }, [schemeId, month]);

  const move = (i: number, dir: -1 | 1) => setBlocks((b) => {
    const j = i + dir;
    if (j < 0 || j >= b.length) return b;
    const next = [...b];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i: number) => setBlocks((b) => b.filter((_, k) => k !== i));
  const add = (type: string) => {
    const defaults: Record<string, any> = {
      heading: { text: "New heading", level: 2 },
      paragraph: { text: "Write here… use {{meta.schemeName}} placeholders." },
      kpis: { keys: ["meta.plannedPercent", "meta.actualPercent"] },
      table: { source: "summary_rows", columns: ["activity", "scope", "cumulativeActualPercent"] },
      chart: { source: "scurve_trend", kind: "line" },
      pagebreak: {},
    };
    const b = { id: uid(), type, props: defaults[type] || {} };
    setBlocks((cur) => [...cur, b]);
    setEditing(b.id);
  };

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const body = { name, description: "", blocks };
      const r = currentId
        ? await fetch(`${API}/report-templates/${currentId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`${API}/report-templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!currentId && d.template_id) setCurrentId(d.template_id);
      setMsg("Saved ✓"); loadTemplates();
    } catch { setMsg("Save failed"); } finally { setSaving(false); }
  };

  const open = async (tid: number) => {
    const d = await fetch(`${API}/report-templates/${tid}`).then((r) => r.json());
    setBlocks(d.blocks || []); setName(d.name || "Untitled"); setCurrentId(tid); setEditing(null);
  };
  const del = async (tid: number) => {
    await fetch(`${API}/report-templates/${tid}`, { method: "DELETE" });
    if (tid === currentId) setCurrentId(null);
    loadTemplates();
  };

  const palette = [
    { type: "heading", icon: Heading1, label: "Heading" },
    { type: "paragraph", icon: Type, label: "Text" },
    { type: "kpis", icon: LayoutTemplate, label: "KPI Row" },
    { type: "table", icon: Table2, label: "Data Table" },
    { type: "chart", icon: BarChart3, label: "Chart" },
    { type: "pagebreak", icon: FileText, label: "Page Break" },
  ];

  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[240px_1fr]" style={{ background: "var(--bg)", minHeight: "80vh" }}>
      {/* left rail */}
      <div className="space-y-4 print:hidden">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Add block</p>
          <div className="grid grid-cols-2 gap-1.5">
            {palette.map(({ type, icon: Icon, label }) => (
              <button key={type} onClick={() => add(type)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-1.5 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--panel-2)]">
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Templates</p>
          <button onClick={() => { setBlocks(DEFAULT_BLOCKS.map((b) => ({ ...b, id: uid() }))); setCurrentId(null); setName("Untitled"); }}
            className="mb-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--ink-3)] hover:bg-[var(--panel-2)]">
            <Plus size={12} /> New template
          </button>
          <div className="space-y-1">
            {templates.map((t) => (
              <div key={t.template_id}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${t.template_id === currentId ? "bg-[var(--steel-soft)] text-[var(--steel)]" : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]"}`}>
                <button onClick={() => open(t.template_id)} className="flex-1 truncate text-left font-semibold">{t.name}</button>
                <span className="mx-1 text-[10px] text-[var(--ink-4)]">{t.block_count}</span>
                <button onClick={() => del(t.template_id)} className="text-[var(--ink-4)] hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-[11px] text-[var(--ink-4)]">No saved templates yet.</p>}
          </div>
        </div>
      </div>

      {/* canvas */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="min-w-[200px] rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm font-bold text-[var(--ink)] outline-none" />
          <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none">
            {schemes.map((s) => <option key={s.id} value={String(s.id)}>#{s.id} · {s.name.slice(0, 40)}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {msg && <span className="text-xs text-emerald-500">{msg}</span>}
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-500 hover:bg-emerald-500/20">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
            <button type="button" disabled={exporting || !ctx} onClick={() => runExport("pdf")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50">
              <Download size={13} /> PDF
            </button>
            <button type="button" disabled={exporting || !ctx} onClick={() => runExport("docx")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50">
              <Download size={13} /> DOC
            </button>
            <button type="button" disabled={exporting || !ctx} onClick={() => runExport("xlsx")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50">
              <Download size={13} /> Excel
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700">
              <Printer size={13} /> Print
            </button>
          </div>
        </div>

        {/* the document */}
        <div className="mx-auto max-w-[880px] rounded-xl bg-white p-8 shadow-lg print:max-w-none print:rounded-none print:p-2 print:shadow-none">
          {blocks.map((b, i) => (
            <div key={b.id} className="group relative mb-4">
              <div className="absolute -right-2 -top-2 z-10 hidden gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow group-hover:flex print:hidden">
                <button onClick={() => setEditing(editing === b.id ? null : b.id)} title="Edit"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"><Type size={12} /></button>
                <button onClick={() => move(i, -1)} title="Up" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ArrowUp size={12} /></button>
                <button onClick={() => move(i, 1)} title="Down" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ArrowDown size={12} /></button>
                <button onClick={() => remove(i)} title="Delete" className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-600"><Trash2 size={12} /></button>
              </div>
              {editing === b.id && (
                <div className="mb-2 print:hidden">
                  <BlockEditor block={b} onClose={() => setEditing(null)}
                    onChange={(nb) => setBlocks((cur) => cur.map((x) => (x.id === b.id ? nb : x)))} />
                </div>
              )}
              <BlockView block={b} ctx={ctx} />
            </div>
          ))}
          {blocks.length === 0 && <p className="py-16 text-center text-sm text-slate-400">Add blocks from the left rail.</p>}
        </div>
      </div>
    </div>
  );
}
