"use client";

/**
 * Matrix Designer — the metadata-driven report platform UI.
 *
 * Three working areas:
 *   RULES    visual rule builder (field/op/value rows, AND/OR, period tokens,
 *            reusable rule references), live preview with matching count
 *   DESIGN   hierarchical row tree (children inherit parent rules) + measure
 *            columns + reconciliation mode per parent
 *   RUN      period-sensitive grid — pick any reporting date; click any cell
 *            for full drill-down (contributing schemes, never a black box);
 *            reconciliation panel; freeze approved snapshots
 *
 * Everything is metadata: no report logic lives in this file — it only edits
 * and displays what the matrix engine calculates server-side.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Eye, FileSpreadsheet,
  FolderOpen, GitBranch, Loader2, Lock, Play, Plus, RefreshCw, Save, Scale,
  Search, Shield, Trash2, X,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const mx = (p: string) => `${API}/report-studio/matrix${p}`;

/* ------------------------------------------------------------------ types */

type Field = { key: string; label: string; type: string };
type Cond = { field?: string; op?: string; value?: any; rule?: string; conditions?: Cond[] };
type Rule = { rule_key: string; rule_name: string; description?: string; condition: any; version: number };
type LibMeasure = { measure_key: string; name: string; kind: string; field?: string; agg?: string; weight_field?: string; expr?: string; unit?: string; decimals?: number };
type Col = { key: string; name: string; measure?: { field: string; agg: string; weight_field?: string }; measure_key?: string };
type Row = { id: string; name: string; rule?: string; recon?: string | null; children?: Row[] };
type Defn = { columns: Col[]; rows: Row[] };
type RunRow = { id: string; name: string; depth: number; rule?: string; recon?: string; scheme_count: number; cells: Record<string, number | null> };
type RunResult = { report_date: string; fy: string; population_count: number; rows: RunRow[]; reconciliation: any[] };

const uid = () => Math.random().toString(36).slice(2, 8);

/* ------------------------------------------------------------------ styles */

const panel: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 };
const inp: React.CSSProperties = {
  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7,
  color: "var(--ink)", fontSize: 12, padding: "5px 8px", outline: "none",
};
const btn = (primary = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
  padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
  border: "1px solid var(--line)",
  background: primary ? "var(--steel)" : "transparent",
  color: primary ? "#fff" : "var(--ink-2)",
});
const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const TOKENS = ["report_date", "fy_start", "fy_end", "prev_fy_start", "prev_fy_end", "one_year_before_report"];
const AGGS = ["sum", "count", "count_distinct", "avg", "min", "max", "median", "weighted_avg"];
const RECONS = [
  { v: "", label: "No check" },
  { v: "exclusive", label: "Children mutually exclusive" },
  { v: "exhaustive", label: "Children cover parent" },
  { v: "exclusive_exhaustive", label: "Exclusive + exhaustive" },
];

/* ================================================================ page */

export default function MatrixDesigner() {
  const [tab, setTab] = useState<"rules" | "design" | "run" | "measures" | "data">("run");
  const [fieldsMeta, setFieldsMeta] = useState<{ fields: Field[]; operators: Record<string, string[]> }>({ fields: [], operators: {} });
  const [rules, setRules] = useState<Rule[]>([]);
  const [reports, setReports] = useState<{ report_id: number; name: string }[]>([]);
  const [reportId, setReportId] = useState<number | null>(null);
  const [reportName, setReportName] = useState("Untitled matrix report");
  const [defn, setDefn] = useState<Defn>({ columns: [], rows: [] });
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drill, setDrill] = useState<any | null>(null);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [dq, setDq] = useState<any | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [libMeasures, setLibMeasures] = useState<LibMeasure[]>([]);
  const [templates, setTemplates] = useState<{ template_key: string; name: string }[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);

  const fieldByKey = useMemo(() => Object.fromEntries(fieldsMeta.fields.map((f) => [f.key, f])), [fieldsMeta]);
  const numFields = useMemo(() => fieldsMeta.fields.filter((f) => f.type === "number"), [fieldsMeta]);

  const loadAll = useCallback(async () => {
    try {
      const [fr, rr, pr, mr, tr, dr] = await Promise.all([
        authFetch(mx("/fields")), authFetch(mx("/rules")), authFetch(mx("/reports")),
        authFetch(mx("/measures")), authFetch(mx("/templates")), authFetch(mx("/datasets"))]);
      setTemplates((await tr.json()).templates || []);
      setDatasets((await dr.json()).datasets || []);
      setFieldsMeta(await fr.json());
      setRules((await rr.json()).rules || []);
      setReports((await pr.json()).reports || []);
      setLibMeasures((await mr.json()).measures || []);
    } catch { setErr("Failed to load matrix metadata"); }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const openReport = async (id: number) => {
    const r = await authFetch(mx(`/reports/${id}`));
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Load failed"); return; }
    setReportId(id); setReportName(j.name); setDefn(j.definition); setResult(null);
    const s = await authFetch(mx(`/snapshots?report_id=${id}`));
    setSnaps((await s.json()).snapshots || []);
  };

  const saveReport = async () => {
    const r = await authFetch(mx(`/reports${reportId ? `?report_id=${reportId}` : ""}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: reportName, definition: defn }),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Save failed"); return; }
    if (!reportId) setReportId(j.report_id);
    loadAll();
  };

  const runReport = async () => {
    setBusy(true); setErr("");
    try {
      const r = await authFetch(mx("/run"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: defn, report_date: reportDate }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Run failed");
      setResult(j); setTab("run");
      try {
        const d = await authFetch(mx(`/dq?report_date=${reportDate}`));
        if (d.ok) setDq(await d.json());
      } catch { /* DQ panel simply hidden */ }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const drilldown = async (rowId: string, colKey: string) => {
    const r = await authFetch(mx("/cell"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition: defn, report_date: reportDate, row_id: rowId, column_key: colKey }),
    });
    const j = await r.json();
    if (r.ok) setDrill(j); else setErr(j.detail || "Drill-down failed");
  };

  const freeze = async () => {
    if (!reportId) { setErr("Save the report before freezing a snapshot"); return; }
    const r = await authFetch(mx("/snapshots"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: reportId, report_date: reportDate }),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Freeze failed"); return; }
    const s = await authFetch(mx(`/snapshots?report_id=${reportId}`));
    setSnaps((await s.json()).snapshots || []);
  };

  const exportXlsx = async () => {
    const r = await authFetch(mx("/export/xlsx"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition: defn, report_id: reportId ?? undefined, report_date: reportDate }),
    });
    if (!r.ok) { setErr((await r.json()).detail || "Export failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${reportName.replace(/[^\w -]/g, "_")}_${reportDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ------------------------------------------------- row-tree mutation */

  const mutateRows = (fn: (rows: Row[]) => Row[]) => setDefn((d) => ({ ...d, rows: fn(structuredClone(d.rows)) }));
  const findAnd = (rows: Row[], id: string, act: (arr: Row[], i: number) => void): boolean => {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { act(rows, i); return true; }
      if (rows[i].children && findAnd(rows[i].children!, id, act)) return true;
    }
    return false;
  };
  const insertTemplate = async (pid: string | null, key: string) => {
    if (!key) return;
    const r = await authFetch(mx(`/templates/${key}/instantiate`), { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Template failed"); return; }
    mutateRows((rows) => {
      if (!pid) { rows.push(...j.rows); return rows; }
      findAnd(rows, pid, (arr, i) => { arr[i].children = [...(arr[i].children || []), ...j.rows]; });
      return rows;
    });
  };

  const addChild = (pid: string | null) => mutateRows((rows) => {
    const row: Row = { id: uid(), name: "New row", children: [] };
    if (!pid) { rows.push(row); return rows; }
    findAnd(rows, pid, (arr, i) => { arr[i].children = [...(arr[i].children || []), row]; });
    return rows;
  });
  const patchRow = (id: string, patch: Partial<Row>) =>
    mutateRows((rows) => { findAnd(rows, id, (arr, i) => { arr[i] = { ...arr[i], ...patch }; }); return rows; });
  const deleteRow = (id: string) =>
    mutateRows((rows) => { findAnd(rows, id, (arr, i) => { arr.splice(i, 1); }); return rows; });

  /* ================================================================ render */

  const visibleRunRows = useMemo(() => {
    if (!result) return [];
    const out: RunRow[] = [];
    let hideDeeper: number | null = null;
    for (const r of result.rows) {
      if (hideDeeper !== null && r.depth > hideDeeper) continue;
      hideDeeper = null;
      out.push(r);
      if (collapsed.has(r.id)) hideDeeper = r.depth;
    }
    return out;
  }, [result, collapsed]);

  return (
    <div style={{ padding: "14px 20px", maxWidth: 1340, margin: "0 auto" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Scale size={17} style={{ color: "var(--steel)" }} />
        <input value={reportName} onChange={(e) => setReportName(e.target.value)}
               style={{ ...inp, width: 260, fontWeight: 800, fontSize: 13 }} />
        <select style={inp} value={reportId ?? ""} onChange={(e) => e.target.value ? openReport(Number(e.target.value)) : (setReportId(null), setDefn({ columns: [], rows: [] }), setResult(null))}>
          <option value="">— new report —</option>
          {reports.map((r) => <option key={r.report_id} value={r.report_id}>{r.name}</option>)}
        </select>
        {reportId && (
          <button style={btn()} title="Clone this report" onClick={async () => {
            const r = await authFetch(mx(`/reports/${reportId}/clone`), { method: "POST" });
            const j = await r.json();
            if (r.ok) { await loadAll(); openReport(j.report_id); } else setErr(j.detail || "Clone failed");
          }}><FileSpreadsheet size={13} /> Clone</button>
        )}
        <div style={{ flex: 1 }} />
        {(["rules", "design", "run", "measures", "data"] as const).map((t) => (
          <button key={t} style={{ ...btn(tab === t), textTransform: "capitalize" }} onClick={() => setTab(t)}>
            {t === "rules" ? <Shield size={13} /> : t === "design" ? <GitBranch size={13} /> : t === "measures" ? <Scale size={13} /> : t === "data" ? <FolderOpen size={13} /> : <Play size={13} />} {t}
          </button>
        ))}
        <button style={btn()} onClick={saveReport}><Save size={13} /> Save</button>
      </div>

      {err && (
        <div style={{ marginBottom: 10, padding: "7px 12px", borderRadius: 8, background: "rgba(229,83,75,.12)",
                      border: "1px solid rgba(229,83,75,.4)", color: "#e5534b", fontSize: 12, fontWeight: 600, display: "flex", gap: 8 }}>
          <span style={{ flex: 1 }}>{err}</span><X size={13} style={{ cursor: "pointer" }} onClick={() => setErr("")} />
        </div>
      )}

      {tab === "rules" && (
        <RulesTab rules={rules} fields={fieldsMeta.fields} operators={fieldsMeta.operators}
                  fieldByKey={fieldByKey} reportDate={reportDate} onChanged={loadAll} setErr={setErr} />
      )}

      {tab === "design" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 12 }}>
          {/* row hierarchy */}
          <div style={{ ...panel, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <GitBranch size={14} style={{ color: "var(--steel)" }} />
              <b style={{ fontSize: 12.5, flex: 1 }}>Row hierarchy — children inherit every ancestor rule</b>
              <button style={btn()} onClick={() => addChild(null)}><Plus size={12} /> Top row</button>
              <select style={{ ...inp, width: 220 }} value="" onChange={(e) => insertTemplate(null, e.target.value)}>
                <option value="">Insert section template…</option>
                {templates.map((t) => <option key={t.template_key} value={t.template_key}>{t.name}</option>)}
              </select>
            </div>
            <RowTree rows={defn.rows} depth={0} rules={rules} templates={templates}
                     patch={patchRow} addChild={addChild} del={deleteRow}
                     insertTemplate={insertTemplate}
                     saveTemplate={async (row) => {
                       const key = prompt("Template key (a-z, 0-9, _):");
                       if (!key) return;
                       const r = await authFetch(mx("/templates"), {
                         method: "POST", headers: { "Content-Type": "application/json" },
                         body: JSON.stringify({ template_key: key.replace(/[^a-z0-9_]/g, ""), name: row.name, rows: [row] }),
                       });
                       if (!r.ok) setErr((await r.json()).detail || "Save failed");
                       else { const t = await authFetch(mx("/templates")); setTemplates((await t.json()).templates || []); }
                     }} />
            {defn.rows.length === 0 && (
              <div style={{ color: "var(--ink-4)", fontSize: 12, padding: 16, textAlign: "center" }}>
                Add a top row (e.g. "Total Ongoing projects" → rule <i>ongoing</i>), then children like
                "Corporate" and delay buckets — each child adds its rule to the inherited chain.
              </div>
            )}
          </div>
          {/* columns */}
          <div style={{ ...panel, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <FileSpreadsheet size={14} style={{ color: "var(--steel)" }} />
              <b style={{ fontSize: 12.5, flex: 1 }}>Measure columns</b>
              <button style={btn()} onClick={() => setDefn((d) => ({ ...d, columns: [...d.columns, { key: uid(), name: "New measure", measure: { field: "scheme_id", agg: "count_distinct" } }] }))}>
                <Plus size={12} />
              </button>
            </div>
            {defn.columns.map((c, i) => (
              <div key={c.key} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, marginBottom: 6 }}>
                <input style={{ ...inp, width: "100%", marginBottom: 5, fontWeight: 700 }} value={c.name}
                       onChange={(e) => setDefn((d) => ({ ...d, columns: d.columns.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
                <select style={{ ...inp, width: "100%", marginBottom: 5 }} value={c.measure_key || "__inline__"}
                        onChange={(e) => setDefn((d) => ({ ...d, columns: d.columns.map((x, j) => j === i
                          ? (e.target.value === "__inline__"
                              ? { key: x.key, name: x.name, measure: x.measure || { field: "scheme_id", agg: "count_distinct" } }
                              : { key: x.key, name: x.name, measure_key: e.target.value })
                          : x) }))}>
                  <option value="__inline__">Inline measure…</option>
                  {libMeasures.map((m) => <option key={m.measure_key} value={m.measure_key}>{m.name} ({m.kind})</option>)}
                </select>
                {!c.measure_key && c.measure && (
                <div style={{ display: "flex", gap: 5 }}>
                  <select style={{ ...inp, flex: 1 }} value={c.measure.agg}
                          onChange={(e) => setDefn((d) => ({ ...d, columns: d.columns.map((x, j) => j === i ? { ...x, measure: { ...x.measure!, agg: e.target.value } } : x) }))}>
                    {AGGS.map((a) => <option key={a}>{a}</option>)}
                  </select>
                  <select style={{ ...inp, flex: 2 }} value={c.measure.field}
                          onChange={(e) => setDefn((d) => ({ ...d, columns: d.columns.map((x, j) => j === i ? { ...x, measure: { ...x.measure!, field: e.target.value } } : x) }))}>
                    {(c.measure.agg === "count" || c.measure.agg === "count_distinct" ? fieldsMeta.fields : numFields)
                      .map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>)}
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <Trash2 size={13} style={{ cursor: "pointer", color: "var(--ink-4)" }}
                          onClick={() => setDefn((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "measures" && (
        <MeasuresTab measures={libMeasures} numFields={numFields} fields={fieldsMeta.fields}
                     onChanged={loadAll} setErr={setErr} />
      )}

      {tab === "data" && (
        <DataTab datasets={datasets} onChanged={loadAll} setErr={setErr} reportDate={reportDate} />
      )}

      {tab === "run" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>Position as on</span>
            <input type="date" style={inp} value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            <button style={btn(true)} onClick={runReport} disabled={busy}>
              {busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} Calculate
            </button>
            {result && <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
              FY {result.fy} · population {result.population_count} schemes</span>}
            <div style={{ flex: 1 }} />
            <button style={btn()} onClick={exportXlsx}><FileSpreadsheet size={13} /> Export Excel</button>
            <button style={btn()} onClick={freeze}><Lock size={13} /> Freeze snapshot</button>
          </div>

          {result && (
            <>
              <div style={{ ...panel, overflow: "auto", marginBottom: 12 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, left: 0, zIndex: 2, background: "var(--panel-2)", padding: "8px 12px", textAlign: "left", color: "var(--ink-3)", fontWeight: 800, borderBottom: "1px solid var(--line)", minWidth: 280 }}>Category</th>
                      {defn.columns.map((c) => (
                        <th key={c.key} style={{ position: "sticky", top: 0, background: "var(--panel-2)", padding: "8px 12px", textAlign: "right", color: "var(--ink-3)", fontWeight: 800, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRunRows.map((r) => {
                      const hasKids = result.rows.some((x) => x.depth === r.depth + 1 &&
                        result.rows.indexOf(x) > result.rows.indexOf(r) &&
                        !result.rows.slice(result.rows.indexOf(r) + 1, result.rows.indexOf(x)).some((y) => y.depth <= r.depth));
                      return (
                        <tr key={r.id}>
                          <td style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)",
                                       paddingLeft: 12 + r.depth * 18, fontWeight: r.depth === 0 ? 800 : r.depth === 1 ? 700 : 500,
                                       color: r.depth <= 1 ? "var(--ink)" : "var(--ink-2)", whiteSpace: "nowrap", cursor: hasKids ? "pointer" : "default" }}
                              onClick={() => hasKids && setCollapsed((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
                            {hasKids ? (collapsed.has(r.id) ? <ChevronRight size={12} style={{ verticalAlign: -1 }} /> : <ChevronDown size={12} style={{ verticalAlign: -1 }} />) : null} {r.name}
                          </td>
                          {defn.columns.map((c) => (
                            <td key={c.key}
                                onClick={() => drilldown(r.id, c.key)}
                                title="Click for contributing schemes"
                                style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)", textAlign: "right",
                                         fontFamily: mono, color: "var(--ink-2)", cursor: "pointer" }}>
                              {fmt(r.cells[c.key])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* data-quality pre-flight (spec §11) */}
              {dq && (
                <div style={{ ...panel, padding: 12, marginBottom: 12,
                              borderColor: dq.error_violations > 0 ? "rgba(229,83,75,.5)" : "var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                    {dq.error_violations > 0
                      ? <AlertTriangle size={14} style={{ color: "#e5534b" }} />
                      : <Check size={14} style={{ color: "#3fb950" }} />}
                    <b style={{ fontSize: 12.5, flex: 1 }}>
                      Data quality — {dq.error_violations} error{dq.error_violations === 1 ? "" : "s"}, {dq.warning_violations} warning{dq.warning_violations === 1 ? "" : "s"}
                    </b>
                    {dq.error_violations > 0 && (
                      <span style={{ fontSize: 11, color: "#e5534b", fontWeight: 700 }}>
                        freezing gated — fix or override with reason
                      </span>
                    )}
                  </div>
                  {dq.checks.filter((c: any) => (c.violation_count || 0) > 0).map((c: any) => (
                    <div key={c.check_key} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px dashed var(--line)" }}>
                      <span style={{ fontWeight: 700, color: c.severity === "error" ? "#e5534b" : "#f0883e" }}>
                        [{c.severity}]
                      </span>{" "}
                      <span style={{ color: "var(--ink-2)" }}>{c.name}</span>
                      <span style={{ color: "var(--ink-4)" }}> — {c.violation_count} scheme(s): </span>
                      <span style={{ fontFamily: mono, fontSize: 11, color: "var(--ink-3)" }}>
                        {c.violations.slice(0, 6).map((v: any) => `${v.scheme_id} ${v.scheme_name}`).join(" · ")}
                        {c.violation_count > 6 ? " …" : ""}
                      </span>
                    </div>
                  ))}
                  {dq.checks.every((c: any) => !(c.violation_count || 0)) && (
                    <div style={{ fontSize: 12, color: "var(--ink-4)" }}>All {dq.checks.length} checks clean.</div>
                  )}
                </div>
              )}

              {/* reconciliation */}
              <div style={{ ...panel, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <Scale size={14} style={{ color: "var(--steel)" }} />
                  <b style={{ fontSize: 12.5 }}>Reconciliation — {result.reconciliation.filter((c) => c.passed).length}/{result.reconciliation.length} passed</b>
                </div>
                {result.reconciliation.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12, borderBottom: i < result.reconciliation.length - 1 ? "1px dashed var(--line)" : "none" }}>
                    {c.passed ? <Check size={13} style={{ color: "#3fb950" }} /> : <AlertTriangle size={13} style={{ color: "#e5534b" }} />}
                    <span style={{ fontWeight: 700, color: "var(--ink-2)" }}>{c.parent}</span>
                    <span style={{ color: "var(--ink-4)" }}>({c.type})</span>
                    <span style={{ flex: 1, textAlign: "right", fontFamily: mono, color: c.passed ? "var(--ink-3)" : "#e5534b" }}>
                      parent {c.parent_count} · children ∪ {c.children_union_count} — {c.detail}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* snapshots */}
          {snaps.length > 0 && (
            <div style={{ ...panel, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <Lock size={13} style={{ color: "var(--steel)" }} />
                <b style={{ fontSize: 12.5 }}>Frozen snapshots (immutable — later data changes never alter these)</b>
              </div>
              {snaps.map((s) => {
                const acts: Record<string, string[]> = { draft: ["submit"], submitted: ["approve", "reject"], approved: ["lock"], locked: [] };
                return (
                  <div key={s.snapshot_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-3)", padding: "4px 0" }}>
                    <span style={{ flex: 1 }}>
                      #{s.snapshot_id} · position {s.report_date} · FY {s.fy} ·{" "}
                      <b style={{ color: s.status === "locked" ? "var(--steel)" : s.status === "approved" ? "#3fb950" : "var(--ink-2)" }}>{s.status}</b>
                      {" "}· {new Date(s.created_at).toLocaleString("en-IN")}
                    </span>
                    {(acts[s.status] || []).map((a) => (
                      <button key={a} style={{ ...btn(), padding: "3px 8px", fontSize: 11 }}
                              onClick={async () => {
                                const reason = a === "reject" ? prompt("Rejection reason (mandatory):") : undefined;
                                if (a === "reject" && !reason) return;
                                const r = await authFetch(mx(`/snapshots/${s.snapshot_id}/transition`), {
                                  method: "POST", headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: a, reason }),
                                });
                                if (!r.ok) { setErr((await r.json()).detail || "Transition failed"); return; }
                                const l = await authFetch(mx(`/snapshots?report_id=${reportId}`));
                                setSnaps((await l.json()).snapshots || []);
                              }}>{a}</button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* drill-down modal (spec §5.9) */}
      {drill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 70, display: "grid", placeItems: "center" }}
             onClick={() => setDrill(null)}>
          <div style={{ ...panel, width: 620, maxHeight: "80vh", overflow: "auto", padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Eye size={14} style={{ color: "var(--steel)" }} />
              <b style={{ fontSize: 13, flex: 1 }}>{drill.row} × {drill.column}</b>
              <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 15 }}>{fmt(drill.value)}</span>
              <X size={15} style={{ cursor: "pointer" }} onClick={() => setDrill(null)} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginBottom: 8 }}>
              {drill.qualifying_count} qualifying scheme{drill.qualifying_count === 1 ? "" : "s"} — every figure traceable to source records
            </div>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead><tr>
                {["Scheme ID", "Scheme", "Contribution"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 2 ? "right" : "left", padding: "6px 8px", borderBottom: "1px solid var(--line)", color: "var(--ink-3)", fontWeight: 800 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {drill.schemes.map((s: any) => (
                  <tr key={s.scheme_id}>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--line)", fontFamily: mono }}>{s.scheme_id}</td>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--line)", color: "var(--ink-2)" }}>{s.scheme_name}</td>
                    <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono }}>{fmt(s.contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================ row tree */

function RowTree({ rows, depth, rules, templates, patch, addChild, del, insertTemplate, saveTemplate }: {
  rows: Row[]; depth: number; rules: Rule[]; templates: { template_key: string; name: string }[];
  patch: (id: string, p: Partial<Row>) => void;
  addChild: (pid: string) => void; del: (id: string) => void;
  insertTemplate: (pid: string, key: string) => void;
  saveTemplate: (row: Row) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.id}>
          <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "3px 0", paddingLeft: depth * 20 }}>
            <input style={{ ...inp, width: 190, fontWeight: depth === 0 ? 750 : 500 }} value={r.name}
                   onChange={(e) => patch(r.id, { name: e.target.value })} />
            <select style={{ ...inp, width: 170 }} value={r.rule || ""}
                    onChange={(e) => patch(r.id, { rule: e.target.value || undefined })}>
              <option value="">(no rule — pass-through)</option>
              {rules.map((x) => <option key={x.rule_key} value={x.rule_key}>{x.rule_name}</option>)}
            </select>
            <select style={{ ...inp, width: 175 }} value={r.recon || ""}
                    onChange={(e) => patch(r.id, { recon: e.target.value || null })}
                    title="Reconciliation check on this row's children">
              {RECONS.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
            </select>
            <button style={{ ...btn(), padding: "4px 7px" }} title="Add child" onClick={() => addChild(r.id)}><Plus size={11} /></button>
            <select style={{ ...inp, width: 34, padding: "4px 2px" }} value="" title="Insert template as children"
                    onChange={(e) => insertTemplate(r.id, e.target.value)}>
              <option value="">§</option>
              {templates.map((t) => <option key={t.template_key} value={t.template_key}>{t.name}</option>)}
            </select>
            <Save size={12} style={{ cursor: "pointer", color: "var(--ink-4)" }} onClick={() => saveTemplate(r)} />
            <Trash2 size={13} style={{ cursor: "pointer", color: "var(--ink-4)" }} onClick={() => del(r.id)} />
          </div>
          {r.children && r.children.length > 0 && (
            <RowTree rows={r.children} depth={depth + 1} rules={rules} templates={templates}
                     patch={patch} addChild={addChild} del={del}
                     insertTemplate={insertTemplate} saveTemplate={saveTemplate} />
          )}
        </div>
      ))}
    </>
  );
}

/* ================================================================ rules tab */

function RulesTab({ rules, fields, operators, fieldByKey, reportDate, onChanged, setErr }: {
  rules: Rule[]; fields: Field[]; operators: Record<string, string[]>;
  fieldByKey: Record<string, Field>; reportDate: string;
  onChanged: () => void; setErr: (s: string) => void;
}) {
  const [editing, setEditing] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [q, setQ] = useState("");

  const startNew = () => setEditing({
    rule_key: "", rule_name: "", condition: { op: "AND", conditions: [] }, version: 0,
  });

  const save = async () => {
    if (!editing?.rule_key || !editing.rule_name) { setErr("Rule key and name are required"); return; }
    const r = await authFetch(mx("/rules"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_key: editing.rule_key, rule_name: editing.rule_name,
                             description: editing.description, condition: editing.condition }),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Save failed"); return; }
    setEditing(null); setPreview(null); onChanged();
  };

  const runPreview = async () => {
    if (!editing) return;
    const r = await authFetch(mx("/rules/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condition: editing.condition, report_date: reportDate }),
    });
    const j = await r.json();
    if (!r.ok) { setErr(j.detail || "Preview failed"); return; }
    setPreview(j);
  };

  const conds: Cond[] = editing?.condition?.conditions || [];
  const setConds = (c: Cond[]) => editing && setEditing({ ...editing, condition: { ...editing.condition, conditions: c } });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
      {/* library */}
      <div style={{ ...panel, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <Shield size={14} style={{ color: "var(--steel)" }} />
          <b style={{ fontSize: 12.5, flex: 1 }}>Rule library</b>
          <button style={btn()} onClick={startNew}><Plus size={12} /> New</button>
        </div>
        <div style={{ position: "relative", marginBottom: 6 }}>
          <Search size={11} style={{ position: "absolute", left: 7, top: 8, color: "var(--ink-4)" }} />
          <input style={{ ...inp, paddingLeft: 22, width: "100%" }} placeholder="Find rule…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {rules.filter((r) => r.rule_name.toLowerCase().includes(q.toLowerCase())).map((r) => (
          <div key={r.rule_key} onClick={() => { setEditing(structuredClone(r)); setPreview(null); }}
               style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", marginBottom: 3,
                        border: `1px solid ${editing?.rule_key === r.rule_key ? "var(--steel)" : "var(--line)"}` }}>
            <div style={{ fontSize: 12, fontWeight: 750, color: "var(--ink)" }}>{r.rule_name}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: mono }}>{r.rule_key} · v{r.version}</div>
          </div>
        ))}
      </div>

      {/* editor */}
      <div style={{ ...panel, padding: 14 }}>
        {!editing ? (
          <div style={{ color: "var(--ink-4)", fontSize: 12.5, padding: 20 }}>
            Select a rule to edit, or create a new one. Rules are reusable across every matrix report;
            report rows reference them and children inherit the full ancestor chain automatically.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <input style={{ ...inp, width: 160, fontFamily: mono }} placeholder="rule_key" value={editing.rule_key}
                     disabled={editing.version > 0}
                     onChange={(e) => setEditing({ ...editing, rule_key: e.target.value.replace(/[^a-z0-9_]/g, "") })} />
              <input style={{ ...inp, flex: 1, minWidth: 180, fontWeight: 700 }} placeholder="Rule name" value={editing.rule_name}
                     onChange={(e) => setEditing({ ...editing, rule_name: e.target.value })} />
              <select style={{ ...inp, width: 80 }} value={editing.condition.op || "AND"}
                      onChange={(e) => setEditing({ ...editing, condition: { ...editing.condition, op: e.target.value } })}>
                {["AND", "OR", "NOT"].map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>

            {conds.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 5 }}>
                {"rule" in c && c.rule !== undefined ? (
                  <>
                    <span style={{ fontSize: 11, color: "var(--steel)", fontWeight: 800, width: 96 }}>RULE REF</span>
                    <select style={{ ...inp, flex: 1 }} value={c.rule}
                            onChange={(e) => setConds(conds.map((x, j) => j === i ? { rule: e.target.value } : x))}>
                      {rules.filter((r) => r.rule_key !== editing.rule_key)
                            .map((r) => <option key={r.rule_key} value={r.rule_key}>{r.rule_name}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <select style={{ ...inp, width: 200 }} value={c.field || ""}
                            onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, field: e.target.value, op: "=", value: "" } : x))}>
                      <option value="">field…</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <select style={{ ...inp, width: 110 }} value={c.op || "="}
                            onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
                      {(operators[fieldByKey[c.field || ""]?.type || "text"] || ["="]).map((o) => <option key={o}>{o}</option>)}
                    </select>
                    {!["is_null", "not_null"].includes(c.op || "") && (
                      typeof c.value === "object" && c.value?.token !== undefined ? (
                        <select style={{ ...inp, flex: 1 }} value={c.value.token}
                                onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, value: { token: e.target.value } } : x))}>
                          {TOKENS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      ) : (
                        <input style={{ ...inp, flex: 1 }} value={c.value ?? ""}
                               placeholder={fieldByKey[c.field || ""]?.type === "date" ? "YYYY-MM-DD" : "value"}
                               onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, value: fieldByKey[c.field || ""]?.type === "number" && e.target.value !== "" && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } : x))} />
                      )
                    )}
                    <button style={{ ...btn(), padding: "4px 7px", fontSize: 10.5 }}
                            title="Toggle period token (fy_start, report_date, …)"
                            onClick={() => setConds(conds.map((x, j) => j === i
                              ? { ...x, value: (typeof x.value === "object" && x.value?.token) ? "" : { token: "fy_start" } } : x))}>
                      FY
                    </button>
                  </>
                )}
                <X size={13} style={{ cursor: "pointer", color: "var(--ink-4)" }}
                   onClick={() => setConds(conds.filter((_, j) => j !== i))} />
              </div>
            ))}

            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button style={btn()} onClick={() => setConds([...conds, { field: "", op: "=", value: "" }])}>
                <Plus size={12} /> Condition
              </button>
              <button style={btn()} onClick={() => setConds([...conds, { rule: rules[0]?.rule_key || "" }])}>
                <Plus size={12} /> Rule reference
              </button>
              <div style={{ flex: 1 }} />
              <button style={btn()} onClick={runPreview}><Eye size={12} /> Preview @ {reportDate}</button>
              <button style={btn(true)} onClick={save}><Save size={12} /> Save {editing.version > 0 ? `(→ v${editing.version + 1})` : ""}</button>
            </div>

            {preview && (
              <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                <b style={{ fontSize: 12.5 }}>{preview.matching_count}</b>
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}> of {preview.population} schemes match</span>
                {preview.sample.map((s: any) => (
                  <div key={s.scheme_id} style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "2px 0", fontFamily: mono }}>
                    {s.scheme_id} · {s.scheme_name} · {s.scheme_type}/{s.status} · delay {s.delay_days}d
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


/* ================================================================ measures tab */

function MeasuresTab({ measures, numFields, fields, onChanged, setErr }: {
  measures: LibMeasure[]; numFields: Field[]; fields: Field[];
  onChanged: () => void; setErr: (s: string) => void;
}) {
  const [ed, setEd] = useState<LibMeasure | null>(null);
  const save = async () => {
    if (!ed) return;
    const r = await authFetch(mx("/measures"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ed),
    });
    if (!r.ok) { setErr((await r.json()).detail || "Save failed"); return; }
    setEd(null); onChanged();
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 12 }}>
      <div style={{ ...panel, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <Scale size={14} style={{ color: "var(--steel)" }} />
          <b style={{ fontSize: 12.5, flex: 1 }}>Measure library</b>
          <button style={btn()} onClick={() => setEd({ measure_key: "", name: "", kind: "agg", field: "scheme_id", agg: "count_distinct", decimals: 2 })}>
            <Plus size={12} /> New
          </button>
        </div>
        {measures.map((m) => (
          <div key={m.measure_key} onClick={() => setEd({ ...m })}
               style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", marginBottom: 3,
                        border: `1px solid ${ed?.measure_key === m.measure_key ? "var(--steel)" : "var(--line)"}` }}>
            <div style={{ fontSize: 12, fontWeight: 750 }}>{m.name} {m.unit ? <span style={{ color: "var(--ink-4)", fontWeight: 500 }}>({m.unit})</span> : null}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: mono }}>
              {m.measure_key} · {m.kind === "formula" ? m.expr : `${m.agg}(${m.field})`}
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...panel, padding: 14 }}>
        {!ed ? (
          <div style={{ color: "var(--ink-4)", fontSize: 12.5, padding: 20 }}>
            Select or create a measure. Formula measures may reference any other library
            measure by key (e.g. <code>fy_exp / be * 100</code>) — dependencies are computed
            automatically on each row's population.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <input style={{ ...inp, width: 150, fontFamily: mono }} placeholder="measure_key" value={ed.measure_key}
                     onChange={(e) => setEd({ ...ed, measure_key: e.target.value.replace(/[^a-z0-9_]/g, "") })} />
              <input style={{ ...inp, flex: 1, minWidth: 170, fontWeight: 700 }} placeholder="Name" value={ed.name}
                     onChange={(e) => setEd({ ...ed, name: e.target.value })} />
              <select style={{ ...inp, width: 96 }} value={ed.kind} onChange={(e) => setEd({ ...ed, kind: e.target.value })}>
                <option value="agg">agg</option><option value="formula">formula</option>
              </select>
            </div>
            {ed.kind === "agg" ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <select style={{ ...inp, width: 130 }} value={ed.agg || "sum"} onChange={(e) => setEd({ ...ed, agg: e.target.value })}>
                  {["sum", "count", "count_distinct", "avg", "min", "max", "median", "weighted_avg"].map((a) => <option key={a}>{a}</option>)}
                </select>
                <select style={{ ...inp, flex: 1 }} value={ed.field || ""} onChange={(e) => setEd({ ...ed, field: e.target.value })}>
                  {(ed.agg?.startsWith("count") ? fields : numFields).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                {ed.agg === "weighted_avg" && (
                  <select style={{ ...inp, width: 170 }} value={ed.weight_field || ""} onChange={(e) => setEd({ ...ed, weight_field: e.target.value })}>
                    <option value="">weight field…</option>
                    {numFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                )}
              </div>
            ) : (
              <input style={{ ...inp, width: "100%", fontFamily: mono, marginBottom: 8 }}
                     placeholder="formula, e.g. fy_exp / be * 100" value={ed.expr || ""}
                     onChange={(e) => setEd({ ...ed, expr: e.target.value })} />
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input style={{ ...inp, width: 110 }} placeholder="unit (₹ Cr, %)" value={ed.unit || ""}
                     onChange={(e) => setEd({ ...ed, unit: e.target.value })} />
              <input style={{ ...inp, width: 90 }} type="number" min={0} max={6} placeholder="decimals"
                     value={ed.decimals ?? 2} onChange={(e) => setEd({ ...ed, decimals: Number(e.target.value) })} />
              <div style={{ flex: 1 }} />
              <button style={btn(true)} onClick={save}><Save size={12} /> Save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================ data tab */

function DataTab({ datasets, onChanged, setErr, reportDate }: {
  datasets: any[]; onChanged: () => void; setErr: (s: string) => void; reportDate: string;
}) {
  const [ed, setEd] = useState<any | null>(null);
  const save = async () => {
    if (!ed) return;
    let fieldsJ, derivedJ;
    try { fieldsJ = JSON.parse(ed._fields); derivedJ = JSON.parse(ed._derived); }
    catch { setErr("Fields/derived must be valid JSON arrays"); return; }
    const r = await authFetch(mx(`/datasets?report_date=${reportDate}`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_key: ed.dataset_key, name: ed.name, base_sql: ed.base_sql,
                             id_field: ed.id_field, name_field: ed.name_field,
                             fields: fieldsJ, derived: derivedJ }),
    });
    if (!r.ok) { setErr((await r.json()).detail || "Save failed"); return; }
    setEd(null); onChanged();
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12 }}>
      <div style={{ ...panel, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <FolderOpen size={14} style={{ color: "var(--steel)" }} />
          <b style={{ fontSize: 12.5, flex: 1 }}>Datasets</b>
          <button style={btn()} onClick={() => setEd({ dataset_key: "", name: "", base_sql: "SELECT ...",
            id_field: "scheme_id", name_field: "scheme_name", _fields: "[]", _derived: "[]" })}>
            <Plus size={12} /> New
          </button>
        </div>
        {datasets.map((d) => (
          <div key={d.dataset_key}
               onClick={() => setEd({ ...d, _fields: JSON.stringify(d.fields, null, 1), _derived: JSON.stringify(d.derived, null, 1) })}
               style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", marginBottom: 3,
                        border: `1px solid ${ed?.dataset_key === d.dataset_key ? "var(--steel)" : "var(--line)"}` }}>
            <div style={{ fontSize: 12, fontWeight: 750 }}>{d.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: mono }}>
              {d.dataset_key} · {d.fields.length} fields · {d.derived.length} derived
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...panel, padding: 14 }}>
        {!ed ? (
          <div style={{ color: "var(--ink-4)", fontSize: 12.5, padding: 20 }}>
            Datasets are pure configuration: a SELECT (with :fy / :report_date parameters),
            a field registry, and derived-field formulas (priority chains like
            <code> coalesce(revised_completion, planned_completion)</code>). Saving dry-runs
            the SQL and validates every formula before accepting.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <input style={{ ...inp, width: 130, fontFamily: mono }} placeholder="dataset_key" value={ed.dataset_key}
                     onChange={(e) => setEd({ ...ed, dataset_key: e.target.value.replace(/[^a-z0-9_]/g, "") })} />
              <input style={{ ...inp, flex: 1, minWidth: 160, fontWeight: 700 }} placeholder="Name" value={ed.name}
                     onChange={(e) => setEd({ ...ed, name: e.target.value })} />
              <input style={{ ...inp, width: 110, fontFamily: mono }} value={ed.id_field}
                     onChange={(e) => setEd({ ...ed, id_field: e.target.value })} title="id field" />
              <input style={{ ...inp, width: 120, fontFamily: mono }} value={ed.name_field}
                     onChange={(e) => setEd({ ...ed, name_field: e.target.value })} title="name field" />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--ink-4)", textTransform: "uppercase", margin: "6px 0 4px" }}>Base SQL</div>
            <textarea style={{ ...inp, width: "100%", height: 150, fontFamily: mono, fontSize: 11, resize: "vertical" }}
                      value={ed.base_sql} onChange={(e) => setEd({ ...ed, base_sql: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--ink-4)", textTransform: "uppercase", marginBottom: 4 }}>Fields (JSON)</div>
                <textarea style={{ ...inp, width: "100%", height: 170, fontFamily: mono, fontSize: 10.5, resize: "vertical" }}
                          value={ed._fields} onChange={(e) => setEd({ ...ed, _fields: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--ink-4)", textTransform: "uppercase", marginBottom: 4 }}>Derived formulas (JSON)</div>
                <textarea style={{ ...inp, width: "100%", height: 170, fontFamily: mono, fontSize: 10.5, resize: "vertical" }}
                          value={ed._derived} onChange={(e) => setEd({ ...ed, _derived: e.target.value })} />
              </div>
            </div>
            <div style={{ textAlign: "right", marginTop: 8 }}>
              <button style={btn(true)} onClick={save}><Save size={12} /> Validate & save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
