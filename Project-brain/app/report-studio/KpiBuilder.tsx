"use client";

/**
 * Report Studio — KPI / Metric Builder.
 *
 * Self-service analytics over a curated set of safe datasets (schemes,
 * packages, activities, actuals, delays, capex, contracts, documents). Pick a
 * dataset, choose dimensions to group by and measures to aggregate, add custom
 * formulas (e.g. completed/total*100) and nested AND/OR filters, then render as
 * a KPI card, table, bar/line/pie chart — and save it as a reusable metric.
 * All SQL is compiled server-side against the registry (/api/v1/report-studio).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BarChart3, Filter, Hash, LineChart as LineIcon, Percent, PieChart as PieIcon,
  Play, Plus, Save, Sigma, Table2, Trash2, X, Loader2, Pin,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rs = (p: string) => `${API}/report-studio${p}`;
const CHART_COLORS = ["#6ea8fe", "#f0883e", "#3fb950", "#e5534b", "#a371f7", "#f2cc60", "#39c5cf", "#db61a2"];

type Field = { key: string; label: string; type: string; default_agg?: string };
type Dataset = { key: string; label: string; dimensions: Field[]; measures: Field[] };
type MeasureSel = { field: string; agg?: string; alias?: string };
type Computed = { alias: string; expression: string };
type Cond = { field: string; op: string; value: any };
type Column = { key: string; label: string; type: string };
type Viz = "kpi" | "table" | "bar" | "line" | "pie";
type SavedMetric = { metric_id: number; name: string; dataset: string; viz: Viz; folder?: string; is_pinned: boolean };

const OPS: { v: string; label: string; needsValue: boolean }[] = [
  { v: "=", label: "=", needsValue: true }, { v: "!=", label: "≠", needsValue: true },
  { v: ">", label: ">", needsValue: true }, { v: ">=", label: "≥", needsValue: true },
  { v: "<", label: "<", needsValue: true }, { v: "<=", label: "≤", needsValue: true },
  { v: "contains", label: "contains", needsValue: true },
  { v: "starts_with", label: "starts with", needsValue: true },
  { v: "in", label: "in (a,b,c)", needsValue: true },
  { v: "is_null", label: "is empty", needsValue: false },
  { v: "not_null", label: "is not empty", needsValue: false },
  { v: "is_true", label: "is true", needsValue: false },
  { v: "is_false", label: "is false", needsValue: false },
];
const AGGS = ["sum", "avg", "min", "max", "count", "count_distinct"];

// theme helpers
const panel = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 } as const;
const chip = (active?: boolean) => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 7,
  border: "1px solid var(--line)", background: active ? "var(--steel-soft)" : "var(--panel-2)",
  color: active ? "var(--steel)" : "var(--ink-3)", fontSize: 12, cursor: "pointer", fontWeight: 650,
});
const btn = (kind: "primary" | "ghost" = "ghost"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8,
  border: "1px solid var(--line)", cursor: "pointer", fontSize: 13, fontWeight: 700,
  background: kind === "primary" ? "var(--steel)" : "var(--panel)",
  color: kind === "primary" ? "#fff" : "var(--ink-2)",
});
const inp: React.CSSProperties = {
  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7,
  padding: "5px 8px", fontSize: 12, color: "var(--ink)",
};
const secLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
  color: "var(--ink-4)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
};

function fmtNum(v: any, type: string): string {
  if (v == null) return "—";
  if (typeof v !== "number") return String(v);
  if (type === "money") return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (type === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return v.toLocaleString("en-IN");
}

export default function KpiBuilder() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dsKey, setDsKey] = useState<string>("");
  const [dims, setDims] = useState<string[]>([]);
  const [measures, setMeasures] = useState<MeasureSel[]>([]);
  const [computed, setComputed] = useState<Computed[]>([]);
  const [conds, setConds] = useState<Cond[]>([]);
  const [filterOp, setFilterOp] = useState<"AND" | "OR">("AND");
  const [viz, setViz] = useState<Viz>("table");
  const [limit, setLimit] = useState(200);

  const [cols, setCols] = useState<Column[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState<SavedMetric[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  const ds = useMemo(() => datasets.find((d) => d.key === dsKey), [datasets, dsKey]);

  const refreshSaved = useCallback(() => {
    authFetch(rs("/metrics")).then((r) => r.json()).then((j) => setSaved(j.metrics || [])).catch(() => {});
  }, []);

  useEffect(() => {
    authFetch(rs("/datasets")).then((r) => r.json()).then((j) => {
      setDatasets(j.datasets || []);
      if (j.datasets?.[0]) setDsKey(j.datasets[0].key);
    }).catch(() => setErr("Failed to load datasets"));
    refreshSaved();
  }, [refreshSaved]);

  // reset selections when dataset changes
  useEffect(() => { setDims([]); setMeasures([]); setComputed([]); setConds([]); setCols([]); setRows([]); }, [dsKey]);

  const spec = useMemo(() => ({
    dataset: dsKey,
    dimensions: dims,
    measures,
    computed: computed.filter((c) => c.alias && c.expression),
    filters: conds.length ? { op: filterOp, conditions: conds.map(normalizeCond) } : null,
    limit,
  }), [dsKey, dims, measures, computed, conds, filterOp, limit]);

  const run = useCallback(async () => {
    if (!dsKey) return;
    setBusy(true); setErr("");
    try {
      const r = await authFetch(rs("/query"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Query failed");
      setCols(j.columns || []); setRows(j.rows || []);
    } catch (e: any) { setErr(String(e.message || e)); setCols([]); setRows([]); }
    finally { setBusy(false); }
  }, [spec, dsKey]);

  const saveMetric = async () => {
    if (!saveName.trim()) return;
    const r = await authFetch(rs("/metrics"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: saveName, dataset: dsKey, spec, viz }),
    });
    if (r.ok) { setShowSave(false); setSaveName(""); refreshSaved(); }
    else setErr((await r.json()).detail || "Save failed");
  };

  const loadMetric = async (id: number) => {
    const r = await authFetch(rs(`/metrics/${id}`)); const m = await r.json();
    setDsKey(m.dataset);
    // spec applies after dataset-reset effect; defer to next tick
    setTimeout(() => {
      const s = m.spec || {};
      setDims(s.dimensions || []); setMeasures(s.measures || []); setComputed(s.computed || []);
      setConds((s.filters?.conditions || []).map((c: any) => ({ ...c, value: Array.isArray(c.value) ? c.value.join(",") : c.value })));
      setFilterOp((s.filters?.op as any) || "AND"); setLimit(s.limit || 200); setViz(m.viz || "table");
    }, 0);
  };

  const delMetric = async (id: number) => { await authFetch(rs(`/metrics/${id}`), { method: "DELETE" }); refreshSaved(); };

  const toggleDim = (k: string) => setDims((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);
  const toggleMeasure = (f: Field) => setMeasures((p) =>
    p.some((m) => m.field === f.key) ? p.filter((m) => m.field !== f.key) : [...p, { field: f.key, agg: f.default_agg }]);

  const numericCols = cols.filter((c) => ["int", "number", "money"].includes(c.type));
  const dimCols = cols.filter((c) => !["int", "number", "money"].includes(c.type));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, padding: "14px 24px 40px" }}>
      {/* ---------------- left rail: dataset + fields + saved ---------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...panel, padding: 12 }}>
          <div style={secLabel}><Table2 size={12} /> Dataset</div>
          <select value={dsKey} onChange={(e) => setDsKey(e.target.value)} style={{ ...inp, width: "100%" }}>
            {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>

        {ds && (
          <div style={{ ...panel, padding: 12 }}>
            <div style={secLabel}><Hash size={12} /> Dimensions — group / filter</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {ds.dimensions.map((f) => (
                <span key={f.key} style={chip(dims.includes(f.key))} onClick={() => toggleDim(f.key)}>{f.label}</span>
              ))}
            </div>
            <div style={secLabel}><Sigma size={12} /> Measures — aggregate</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {ds.measures.map((f) => (
                <span key={f.key} style={chip(measures.some((m) => m.field === f.key))} onClick={() => toggleMeasure(f)}>{f.label}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...panel, padding: 12, flex: 1, minHeight: 120, overflowY: "auto" }}>
          <div style={secLabel}><Save size={12} /> Saved metrics</div>
          {saved.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>None yet — build one and Save.</div>}
          {saved.map((m) => (
            <div key={m.metric_id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <button onClick={() => loadMetric(m.metric_id)} style={{ ...btn("ghost"), flex: 1, justifyContent: "space-between", padding: "5px 9px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{m.is_pinned && <Pin size={11} />}{m.name}</span>
                <span style={{ fontSize: 10, color: "var(--ink-4)" }}>{m.viz}</span>
              </button>
              <button onClick={() => delMetric(m.metric_id)} style={{ ...btn("ghost"), padding: "5px 7px", color: "var(--slag)" }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- main: builder + results ---------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {/* selected measures with agg + computed formulas */}
        <div style={{ ...panel, padding: 12 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={secLabel}><Sigma size={12} /> Aggregations</div>
              {measures.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Pick a measure on the left.</div>}
              {measures.map((m, i) => (
                <div key={m.field} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 12, flex: 1, color: "var(--ink-2)" }}>{ds?.measures.find((x) => x.key === m.field)?.label}</span>
                  <select value={m.agg} onChange={(e) => setMeasures((p) => p.map((x, j) => j === i ? { ...x, agg: e.target.value } : x))} style={{ ...inp, padding: "3px 6px" }}>
                    {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={secLabel}><Percent size={12} /> Custom formulas
                <button onClick={() => setComputed((p) => [...p, { alias: "", expression: "" }])} style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }}><Plus size={12} /></button>
              </div>
              {computed.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <input placeholder="name" value={c.alias} onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, alias: e.target.value } : x))} style={{ ...inp, width: 90 }} />
                  <span style={{ color: "var(--ink-4)" }}>=</span>
                  <input placeholder="completed_count/activity_count*100" value={c.expression} onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, expression: e.target.value } : x))} style={{ ...inp, flex: 1 }} />
                  <button onClick={() => setComputed((p) => p.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: "3px 5px" }}><X size={12} /></button>
                </div>
              ))}
              {computed.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 3 }}>
                  Use measure keys: {ds?.measures.map((m) => m.key).join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* filters */}
        <div style={{ ...panel, padding: 12 }}>
          <div style={secLabel}>
            <Filter size={12} /> Filters
            <select value={filterOp} onChange={(e) => setFilterOp(e.target.value as any)} style={{ ...inp, padding: "2px 6px", marginLeft: 8 }}>
              <option value="AND">match ALL (AND)</option>
              <option value="OR">match ANY (OR)</option>
            </select>
            <button onClick={() => setConds((p) => [...p, { field: ds?.dimensions[0]?.key || "", op: "=", value: "" }])} style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }}><Plus size={12} /> Add</button>
          </div>
          {conds.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>No filters — showing all rows.</div>}
          {conds.map((c, i) => {
            const opDef = OPS.find((o) => o.v === c.op);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <select value={c.field} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} style={{ ...inp }}>
                  {ds?.dimensions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select value={c.op} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, op: e.target.value } : x))} style={{ ...inp }}>
                  {OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {opDef?.needsValue && (
                  <input value={c.value ?? ""} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" style={{ ...inp, flex: 1 }} />
                )}
                <button onClick={() => setConds((p) => p.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: "3px 6px" }}><X size={12} /></button>
              </div>
            );
          })}
        </div>

        {/* toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={run} disabled={busy} style={btn("primary")}>
            {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run
          </button>
          <div style={{ display: "flex", gap: 4, ...panel, padding: 3 }}>
            {([["table", Table2], ["bar", BarChart3], ["line", LineIcon], ["pie", PieIcon], ["kpi", Hash]] as const).map(([v, Icon]) => (
              <button key={v} onClick={() => setViz(v)} title={v} style={{ ...btn(viz === v ? "primary" : "ghost"), padding: "5px 8px", border: "none" }}><Icon size={14} /></button>
            ))}
          </div>
          <label style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 5 }}>
            limit <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...inp, width: 70 }} />
          </label>
          <button onClick={() => setShowSave(true)} disabled={!cols.length} style={{ ...btn("ghost"), marginLeft: "auto" }}><Save size={14} /> Save metric</button>
          {rows.length > 0 && <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{rows.length} rows</span>}
        </div>

        {err && <div style={{ ...panel, padding: "8px 12px", color: "var(--slag)", fontSize: 12, borderColor: "var(--slag)" }}>{err}</div>}

        {/* results */}
        <div style={{ ...panel, padding: 14, minHeight: 260 }}>
          {cols.length === 0 ? (
            <div style={{ color: "var(--ink-4)", fontSize: 13, textAlign: "center", padding: 60 }}>
              Choose a dataset, dimensions and measures, then <b>Run</b>. Add a custom formula like
              <code style={{ margin: "0 5px", color: "var(--steel)" }}>completed_count/activity_count*100</code> for a computed KPI.
            </div>
          ) : viz === "kpi" ? <KpiCards cols={numericCols} rows={rows} /> :
             viz === "table" ? <ResultTable cols={cols} rows={rows} /> :
             <ChartView viz={viz} cols={cols} dimCols={dimCols} numericCols={numericCols} rows={rows} />}
        </div>
      </div>

      {/* save modal */}
      {showSave && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ ...panel, padding: 18, width: 360 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <b style={{ color: "var(--ink)" }}>Save metric</b>
              <button onClick={() => setShowSave(false)} style={btn("ghost")}><X size={14} /></button>
            </div>
            <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Metric name" style={{ ...inp, width: "100%", marginBottom: 10 }} />
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 12 }}>Saved as <b>{viz}</b> on <b>{ds?.label}</b>. Reusable as a dashboard card.</div>
            <button onClick={saveMetric} style={{ ...btn("primary"), width: "100%", justifyContent: "center" }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeCond(c: Cond) {
  if (c.op === "in") return { ...c, value: String(c.value).split(",").map((s) => s.trim()).filter(Boolean) };
  return c;
}

function KpiCards({ cols, rows }: { cols: Column[]; rows: any[] }) {
  if (!rows.length) return <Empty />;
  const r = rows[0];
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {cols.map((c) => (
        <div key={c.key} style={{ ...panel, padding: "16px 22px", minWidth: 170, background: "var(--panel-2)" }}>
          <div style={{ fontSize: 11, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>{c.label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--steel)", marginTop: 4 }}>{fmtNum(r[c.key], c.type)}</div>
        </div>
      ))}
    </div>
  );
}

function ResultTable({ cols, rows }: { cols: Column[]; rows: any[] }) {
  if (!rows.length) return <Empty />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map((c) => <th key={c.key} style={{ textAlign: ["int", "number", "money"].includes(c.type) ? "right" : "left", padding: "7px 10px", borderBottom: "2px solid var(--line)", color: "var(--ink-3)", fontWeight: 700, whiteSpace: "nowrap" }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              {cols.map((c) => <td key={c.key} style={{ textAlign: ["int", "number", "money"].includes(c.type) ? "right" : "left", padding: "6px 10px", color: "var(--ink-2)", whiteSpace: "nowrap" }}>{fmtNum(r[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartView({ viz, dimCols, numericCols, rows }: { viz: Viz; cols: Column[]; dimCols: Column[]; numericCols: Column[]; rows: any[] }) {
  if (!rows.length) return <Empty />;
  if (!numericCols.length) return <div style={{ color: "var(--ink-4)", padding: 40, textAlign: "center" }}>Charts need at least one numeric measure.</div>;
  const xKey = dimCols[0]?.key || "_";
  const data = rows.map((r) => ({ ...r, _: "" }));
  const axisStyle = { fill: "var(--ink-4)", fontSize: 11 };
  return (
    <ResponsiveContainer width="100%" height={340}>
      {viz === "pie" ? (
        <PieChart>
          <Pie data={data} dataKey={numericCols[0].key} nameKey={xKey} outerRadius={130} label>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      ) : viz === "line" ? (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey={xKey} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip />
          {numericCols.map((c, i) => <Line key={c.key} type="monotone" dataKey={c.key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart>
      ) : (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey={xKey} tick={axisStyle} /><YAxis tick={axisStyle} /><Tooltip />
          {numericCols.map((c, i) => <Bar key={c.key} dataKey={c.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

function Empty() { return <div style={{ color: "var(--ink-4)", padding: 40, textAlign: "center", fontSize: 13 }}>No rows for this query.</div>; }
