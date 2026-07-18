"use client";

/**
 * Report Studio — Power BI–style Matrix / Query Builder.
 *
 * Mental model (same as Power BI Matrix visual, not Excel cell editor):
 *   Fields catalog  →  Rows / Columns (pivot) / Values / Filters / Sort wells
 *   Calculated measures (formulas over measure keys, DAX-like arithmetic)
 *   Live SQL compile on the server against the semantic registry
 *   Visuals: matrix table · bar · line · pie · KPI cards
 *   Save metric · Add section to multi-page report · Export CSV · Inspect code
 *
 * True Excel cell-by-cell design is a separate path (golden templates / sheet
 * designer). This builder owns self-serve analytics and CAPEX matrix packs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef, SortingState, flexRender,
  getCoreRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDownAZ, BarChart3, BookOpen, Braces, Calendar, CheckSquare, Code2,
  Copy, Download, Filter as FilterIcon, FunctionSquare, GripVertical, Hash,
  LineChart as LineIcon, Loader2, PieChart as PieIcon, Play, Plus, Rows3,
  Save, Search, Sigma, Sparkles, Table2, Type, X, Columns3, Wand2,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rs = (p: string) => `${API}/report-studio${p}`;
const CHART_COLORS = ["#6ea8fe", "#f0883e", "#3fb950", "#e5534b", "#a371f7", "#f2cc60", "#39c5cf", "#db61a2"];

type Field = { key: string; label: string; type: string; default_agg?: string };
type Dataset = { key: string; label: string; dimensions: Field[]; measures: Field[] };
type MeasureSel = { field: string; agg: string; alias?: string };
type Computed = { alias: string; expression: string };
type Cond = { field: string; op: string; value: any };
type SortSel = { by: string; dir: "asc" | "desc" };
type Column = { key: string; label: string; type: string };
type Viz = "table" | "bar" | "line" | "pie" | "kpi";
type PanelMode = "build" | "presets" | "code";
type DragPayload = { kind: "dim" | "measure"; key: string; label: string; type: string; default_agg?: string };

const NUMERIC = ["int", "number", "money"];
const isNum = (t: string) => NUMERIC.includes(t);

const OPS: Record<string, { v: string; label: string; needsValue: boolean }[]> = {
  text: [
    { v: "in", label: "is one of (select)", needsValue: true }, { v: "not_in", label: "is not one of (select)", needsValue: true },
    { v: "=", label: "equals", needsValue: true }, { v: "!=", label: "not equals", needsValue: true },
    { v: "contains", label: "contains", needsValue: true }, { v: "starts_with", label: "starts with", needsValue: true },
    { v: "is_null", label: "is empty", needsValue: false }, { v: "not_null", label: "is not empty", needsValue: false },
  ],
  number: [
    { v: "=", label: "=", needsValue: true }, { v: "!=", label: "≠", needsValue: true },
    { v: ">", label: ">", needsValue: true }, { v: ">=", label: "≥", needsValue: true },
    { v: "<", label: "<", needsValue: true }, { v: "<=", label: "≤", needsValue: true },
    { v: "between", label: "between (a,b)", needsValue: true },
    { v: "in", label: "is one of (select)", needsValue: true }, { v: "not_in", label: "is not one of (select)", needsValue: true },
    { v: "is_null", label: "is empty", needsValue: false }, { v: "not_null", label: "is not empty", needsValue: false },
  ],
  date: [
    { v: "not_null", label: "is not empty (non-blank)", needsValue: false }, { v: "is_null", label: "is empty (blank)", needsValue: false },
    { v: "this_fy", label: "this FY (Apr–Mar)", needsValue: false }, { v: "last_fy", label: "last FY", needsValue: false },
    { v: "ytd", label: "FY to date", needsValue: false }, { v: "this_quarter", label: "this quarter (FY)", needsValue: false },
    { v: "this_month", label: "this month", needsValue: false },
    { v: "=", label: "on", needsValue: true }, { v: ">=", label: "on/after", needsValue: true },
    { v: "<=", label: "on/before", needsValue: true }, { v: "between", label: "between (a,b)", needsValue: true },
    { v: "in", label: "is one of (select)", needsValue: true }, { v: "not_in", label: "is not one of (select)", needsValue: true },
  ],
  bool: [
    { v: "is_true", label: "is true", needsValue: false }, { v: "is_false", label: "is false", needsValue: false },
  ],
};
const opsFor = (type: string) => OPS[isNum(type) ? "number" : type] || OPS.text;
const AGGS = ["sum", "avg", "min", "max", "count", "count_distinct"];

/** Common CAPEX / progress formulas (measure keys must exist on the active dataset). */
const FORMULA_TEMPLATES: { name: string; alias: string; expression: string; needs: string[] }[] = [
  { name: "% of BE spent", alias: "pct_of_be", expression: "actual/be*100", needs: ["actual", "be"] },
  { name: "BE − Actual (var)", alias: "be_minus_actual", expression: "be-actual", needs: ["be", "actual"] },
  { name: "RE − Actual (var)", alias: "re_minus_actual", expression: "re-actual", needs: ["re", "actual"] },
  { name: "Balance to complete", alias: "balance", expression: "gross-exp_last_fy-actual_fy", needs: ["gross", "exp_last_fy", "actual_fy"] },
  { name: "Cum exp = last + FY", alias: "cum_exp", expression: "exp_last_fy+actual_fy", needs: ["exp_last_fy", "actual_fy"] },
  { name: "% of BE (pf)", alias: "pct_be_fy", expression: "actual_fy/be_fy*100", needs: ["actual_fy", "be_fy"] },
  { name: "Physical plan vs act", alias: "phys_var", expression: "phys_fy_plan-phys_fy_actual", needs: ["phys_fy_plan", "phys_fy_actual"] },
  { name: "Plan vs Actual qty %", alias: "qty_achv_pct", expression: "actual_qty/plan_qty*100", needs: ["actual_qty", "plan_qty"] },
];

type Preset = {
  id: string;
  title: string;
  blurb: string;
  dataset: string;
  apply: () => {
    rowDims: string[];
    pivotOn: string;
    rowTotal: boolean;
    quarterTotals: boolean;
    grandTotal: boolean;
    values: MeasureSel[];
    computed: Computed[];
    conds: Cond[];
    filterOp: "AND" | "OR";
    sort: SortSel[];
    viz: Viz;
  };
};

const PRESETS: Preset[] = [
  {
    id: "mos-cat",
    title: "MoS category overview",
    blurb: "Projects / cost / CAPEX by MoS category (1a…3b) — Word overview spirit.",
    dataset: "pf_projects",
    apply: () => ({
      rowDims: ["mos_category"],
      pivotOn: "",
      rowTotal: true,
      quarterTotals: false,
      grandTotal: true,
      values: [
        { field: "project_count", agg: "count_distinct" },
        { field: "gross", agg: "sum" },
        { field: "exp_last_fy", agg: "sum" },
        { field: "be_fy", agg: "sum" },
        { field: "actual_fy", agg: "sum" },
        { field: "total_exp", agg: "sum" },
      ],
      computed: [],
      conds: [],
      filterOp: "AND",
      sort: [{ by: "mos_category", dir: "asc" }],
      viz: "table",
    }),
  },
  {
    id: "mos-delay",
    title: "Ongoing delay profile",
    blurb: "On Time / Delay <1 / >1 with project count and cost.",
    dataset: "pf_projects",
    apply: () => ({
      rowDims: ["delay_bucket"],
      pivotOn: "",
      rowTotal: true,
      quarterTotals: false,
      grandTotal: true,
      values: [
        { field: "project_count", agg: "count_distinct" },
        { field: "gross", agg: "sum" },
        { field: "total_exp", agg: "sum" },
      ],
      computed: [],
      conds: [{ field: "status", op: "in", value: "ongoing,on_hold" }],
      filterOp: "AND",
      sort: [{ by: "delay_bucket", dir: "asc" }],
      viz: "table",
    }),
  },
  {
    id: "pf-ge50",
    title: "≥ ₹50 Cr project register",
    blurb: "Scheme rows with dates, physical %, CAPEX — Physical & Financial detail.",
    dataset: "pf_projects",
    apply: () => ({
      rowDims: ["scheme_name", "approval_date", "award_date", "original_completion", "anticipated_completion", "reason"],
      pivotOn: "",
      rowTotal: true,
      quarterTotals: false,
      grandTotal: false,
      values: [
        { field: "gross", agg: "sum" },
        { field: "phys_last_fy", agg: "avg" },
        { field: "phys_fy_plan", agg: "avg" },
        { field: "phys_fy_actual", agg: "avg" },
        { field: "exp_last_fy", agg: "sum" },
        { field: "be_fy", agg: "sum" },
        { field: "actual_fy", agg: "sum" },
        { field: "total_exp", agg: "sum" },
      ],
      computed: [{ alias: "balance", expression: "gross-exp_last_fy-actual_fy" }],
      conds: [
        { field: "status", op: "in", value: "ongoing,on_hold" },
        { field: "cost_band", op: "starts_with", value: "A" },
      ],
      filterOp: "AND",
      sort: [{ by: "gross", dir: "desc" }],
      viz: "table",
    }),
  },
  {
    id: "capex-month",
    title: "CAPEX month-wise matrix",
    blurb: "Head/scheme × months BE / RE / Actual with row totals (Excel #3 spirit).",
    dataset: "capex_monthly",
    apply: () => ({
      rowDims: ["row_name"],
      pivotOn: "month_label",
      rowTotal: true,
      quarterTotals: false,
      grandTotal: true,
      values: [
        { field: "be", agg: "sum" },
        { field: "re", agg: "sum" },
        { field: "actual", agg: "sum" },
      ],
      computed: [],
      conds: [],
      filterOp: "AND",
      sort: [],
      viz: "table",
    }),
  },
  {
    id: "be-vs-act-q",
    title: "BE vs Actual by month + quarters",
    blurb: "Portfolio BE/Actual pivoted by month with Q1–Q4 totals (Word overview).",
    dataset: "capex_monthly",
    apply: () => ({
      rowDims: [],
      pivotOn: "month_label",
      rowTotal: true,
      quarterTotals: true,
      grandTotal: false,
      values: [
        { field: "be", agg: "sum" },
        { field: "actual", agg: "sum" },
      ],
      computed: [],
      conds: [],
      filterOp: "AND",
      sort: [],
      viz: "table",
    }),
  },
  {
    id: "new-projects",
    title: "New projects under consideration",
    blurb: "Filter MoS 3a/3b with cost and FY CAPEX.",
    dataset: "pf_projects",
    apply: () => ({
      rowDims: ["mos_category", "scheme_name", "approval_date", "award_date"],
      pivotOn: "",
      rowTotal: true,
      quarterTotals: false,
      grandTotal: true,
      values: [
        { field: "gross", agg: "sum" },
        { field: "be_fy", agg: "sum" },
        { field: "actual_fy", agg: "sum" },
      ],
      computed: [],
      conds: [{ field: "mos_category", op: "starts_with", value: "3" }],
      filterOp: "AND",
      sort: [{ by: "mos_category", dir: "asc" }],
      viz: "table",
    }),
  },
];

// ---- theme helpers -------------------------------------------------------- //
const panel = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 } as const;
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
  color: "var(--ink-4)", marginBottom: 7, display: "flex", alignItems: "center", gap: 6,
};
const ck: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-3)" };

function TypeIcon({ type }: { type: string }) {
  const s = 12;
  if (type === "date") return <Calendar size={s} />;
  if (type === "bool") return <CheckSquare size={s} />;
  if (isNum(type)) return <Hash size={s} />;
  return <Type size={s} />;
}

function fmtNum(v: any, type: string): string {
  if (v == null || v === "") return "—";
  if (typeof v !== "number") return String(v);
  if (type === "money") return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (type === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return v.toLocaleString("en-IN");
}

function cellColor(v: any, type: string, key: string): string | undefined {
  if (typeof v !== "number" || !isNum(type)) return undefined;
  const k = key.toLowerCase();
  if (k.includes("var") || k.includes("minus") || k.includes("balance") || k.includes("slip")) {
    if (v < 0) return "var(--slag, #e5534b)";
    if (v > 0 && (k.includes("balance") || k.includes("var"))) return "var(--ok, #3fb950)";
  }
  if ((k.includes("pct") || k.includes("phys") || k.includes("%")) && v < 50) return "var(--slag, #e5534b)";
  return undefined;
}

// ========================================================================== //
export default function PowerBuilder() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dsKey, setDsKey] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<PanelMode>("build");

  const [rowDims, setRowDims] = useState<string[]>([]);
  const [pivotOn, setPivotOn] = useState("");
  const [rowTotal, setRowTotal] = useState(true);
  const [quarterTotals, setQuarterTotals] = useState(false);
  const [grandTotal, setGrandTotal] = useState(false);
  const [values, setValues] = useState<MeasureSel[]>([]);
  const [computed, setComputed] = useState<Computed[]>([]);
  const [conds, setConds] = useState<Cond[]>([]);
  const [filterOp, setFilterOp] = useState<"AND" | "OR">("AND");
  const [sorts, setSorts] = useState<SortSel[]>([]);
  const [limit, setLimit] = useState(500);
  const [viz, setViz] = useState<Viz>("table");
  // Live preview defaults OFF — otherwise every drag/click/keystroke fires a DB
  // query and the panel feels like it is hanging on big datasets. Opt-in.
  const [autoRun, setAutoRun] = useState(false);
  const [condFmt, setCondFmt] = useState(true);

  const [cols, setCols] = useState<Column[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [showAddTo, setShowAddTo] = useState(false);
  const [dragOver, setDragOver] = useState("");
  const [formulaFocus, setFormulaFocus] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const [slicerDim, setSlicerDim] = useState("");
  const [slicerVals, setSlicerVals] = useState<string[]>([]);
  const pendingPreset = useRef<ReturnType<Preset["apply"]> | null>(null);
  const skipNextReset = useRef(false);

  const ds = useMemo(() => datasets.find((d) => d.key === dsKey), [datasets, dsKey]);
  const measureKeys = useMemo(() => (ds?.measures || []).map((m) => m.key), [ds]);

  const applyQueryState = useCallback((a: ReturnType<Preset["apply"]>) => {
    setRowDims(a.rowDims);
    setPivotOn(a.pivotOn);
    setRowTotal(a.rowTotal);
    setQuarterTotals(a.quarterTotals);
    setGrandTotal(a.grandTotal);
    setValues(a.values);
    setComputed(a.computed);
    setConds(a.conds);
    setFilterOp(a.filterOp);
    setSorts(a.sort);
    setViz(a.viz);
    setCols([]); setRows([]); setSql("");
    setSlicerDim(""); setSlicerVals([]);
    setErr("");
  }, []);

  useEffect(() => {
    authFetch(rs("/datasets")).then((r) => r.json()).then((j) => {
      setDatasets(j.datasets || []);
      if (j.datasets?.[0]) setDsKey(j.datasets[0].key);
    }).catch(() => setErr("Failed to load datasets"));
  }, []);

  useEffect(() => {
    if (skipNextReset.current) {
      skipNextReset.current = false;
      const a = pendingPreset.current;
      pendingPreset.current = null;
      if (a) applyQueryState(a);
      return;
    }
    setRowDims([]); setPivotOn(""); setValues([]); setComputed([]); setConds([]);
    setSorts([]); setCols([]); setRows([]); setSql(""); setGrandTotal(false);
    setQuarterTotals(false); setErr(""); setSlicerDim(""); setSlicerVals([]);
  }, [dsKey, applyQueryState]);

  const dimByKey = useMemo(() => Object.fromEntries((ds?.dimensions || []).map((d) => [d.key, d])), [ds]);
  const measByKey = useMemo(() => Object.fromEntries((ds?.measures || []).map((m) => [m.key, m])), [ds]);

  const dimensions = useMemo(() => {
    const arr = [...rowDims];
    if (pivotOn && !arr.includes(pivotOn)) arr.push(pivotOn);
    return arr;
  }, [rowDims, pivotOn]);

  const spec = useMemo(() => ({
    dataset: dsKey,
    dimensions,
    measures: values.map((m) => ({
      field: m.field,
      agg: m.agg,
      ...(m.alias ? { alias: m.alias } : {}),
    })),
    computed: computed.filter((c) => c.alias && c.expression),
    filters: (() => {
      // drop member filters that have no values picked yet (an empty `in` list
      // would otherwise match nothing and blank the whole result)
      const active = conds.map(normalizeCond).filter((c) =>
        !((c.op === "in" || c.op === "not_in") && Array.isArray(c.value) && c.value.length === 0));
      return active.length ? { op: filterOp, conditions: active } : null;
    })(),
    sort: sorts.filter((s) => s.by),
    limit,
    pivot: pivotOn ? { on: pivotOn, row_total: rowTotal, quarter_totals: quarterTotals } : null,
    grand_total: grandTotal,
  }), [dsKey, dimensions, values, computed, conds, filterOp, sorts, limit, pivotOn, rowTotal, quarterTotals, grandTotal]);

  const hasQuery = dimensions.length > 0 || values.length > 0 || computed.some((c) => c.alias && c.expression);

  const run = useCallback(async () => {
    if (!dsKey || !hasQuery) { setCols([]); setRows([]); setSql(""); return; }
    setBusy(true); setErr("");
    try {
      const r = await authFetch(rs("/query"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail) || "Query failed");
      setCols(j.columns || []); setRows(j.rows || []); setSql(j.sql || "");
    } catch (e: any) { setErr(String(e.message || e)); setCols([]); setRows([]); setSql(""); }
    finally { setBusy(false); }
  }, [spec, dsKey, hasQuery]);

  const timer = useRef<any>(null);
  useEffect(() => {
    if (!autoRun) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { run(); }, 350);
    return () => clearTimeout(timer.current);
  }, [spec, autoRun, run]);

  // ---- drag/drop ---------------------------------------------------------- //
  const onDragStart = (e: React.DragEvent, p: DragPayload) => {
    e.dataTransfer.setData("application/json", JSON.stringify(p));
    e.dataTransfer.effectAllowed = "copy";
  };
  const readPayload = (e: React.DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; }
  };
  const allowDrop = (zone: string) => (e: React.DragEvent) => { e.preventDefault(); setDragOver(zone); };

  const dropRows = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver("");
    const p = readPayload(e); if (!p || p.kind !== "dim") return;
    setRowDims((prev) => prev.includes(p.key) ? prev : [...prev, p.key]);
  };
  const dropPivot = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver("");
    const p = readPayload(e); if (!p || p.kind !== "dim") return;
    setPivotOn(p.key);
  };
  const dropValues = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver("");
    const p = readPayload(e); if (!p || p.kind !== "measure") return;
    setValues((prev) => prev.some((m) => m.field === p.key) ? prev : [...prev, { field: p.key, agg: p.default_agg || "sum" }]);
  };
  const dropFilter = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver("");
    const p = readPayload(e); if (!p) return;
    const f = p.kind === "dim" ? dimByKey[p.key] : measByKey[p.key];
    const type = f?.type || "text";
    setConds((prev) => [...prev, { field: p.key, op: opsFor(type)[0].v, value: "" }]);
  };

  // One-click "show only specific values of this field": ensures a member-select
  // (in) filter exists for the field so its checkbox picker appears in Filters.
  const addMemberFilter = (field: string) => {
    setConds((prev) => prev.some((c) => c.field === field && (c.op === "in" || c.op === "not_in"))
      ? prev
      : [...prev, { field, op: "in", value: [] }]);
  };

  const applyPreset = (p: Preset) => {
    if (!datasets.some((d) => d.key === p.dataset)) {
      setErr(`Dataset "${p.dataset}" not available`);
      return;
    }
    const a = p.apply();
    setMode("build");
    if (dsKey === p.dataset) {
      applyQueryState(a);
      return;
    }
    pendingPreset.current = a;
    skipNextReset.current = true;
    setDsKey(p.dataset);
  };

  const insertIntoFormula = (measureKey: string) => {
    if (formulaFocus == null) {
      setComputed((p) => [...p, { alias: measureKey.includes("/") ? "calc" : `calc_${measureKey}`, expression: measureKey }]);
      setFormulaFocus(computed.length);
      return;
    }
    setComputed((p) => p.map((c, i) => i === formulaFocus
      ? { ...c, expression: (c.expression || "") + measureKey }
      : c));
  };

  const addFormulaTemplate = (t: typeof FORMULA_TEMPLATES[0]) => {
    if (!t.needs.every((k) => measureKeys.includes(k))) {
      setErr(`Formula "${t.name}" needs measures: ${t.needs.join(", ")} — not all present on this dataset.`);
      return;
    }
    setComputed((p) => p.some((c) => c.alias === t.alias) ? p : [...p, { alias: t.alias, expression: t.expression }]);
    setErr("");
  };

  const availableTemplates = FORMULA_TEMPLATES.filter((t) => t.needs.every((k) => measureKeys.includes(k)));

  const q = search.trim().toLowerCase();
  const dimList = (ds?.dimensions || []).filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q));
  const measList = (ds?.measures || []).filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q));

  const numericCols = cols.filter((c) => isNum(c.type));
  const dimCols = cols.filter((c) => !isNum(c.type));

  // slicer options from result rows
  const slicerOptions = useMemo(() => {
    if (!slicerDim || !rows.length) return [] as string[];
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.__total__) return;
      const v = r[slicerDim];
      if (v != null && v !== "") set.add(String(v));
    });
    return Array.from(set).sort();
  }, [slicerDim, rows]);

  const displayRows = useMemo(() => {
    if (!slicerDim || !slicerVals.length) return rows;
    return rows.filter((r) => r.__total__ || slicerVals.includes(String(r[slicerDim] ?? "")));
  }, [rows, slicerDim, slicerVals]);

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1200);
    } catch { /* ignore */ }
  };

  const exportCsv = () => {
    if (!cols.length) return;
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = cols.map((c) => esc(c.label)).join(",");
    const body = displayRows.map((r) => cols.map((c) => esc(r[c.key])).join(",")).join("\n");
    const blob = new Blob([head + "\n" + body], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_studio_${dsKey || "query"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sortTargets = useMemo(() => {
    // can sort by selected dims + measure aliases + computed aliases (pre-pivot)
    const out: { key: string; label: string }[] = [];
    rowDims.forEach((k) => out.push({ key: k, label: dimByKey[k]?.label || k }));
    if (pivotOn) out.push({ key: pivotOn, label: dimByKey[pivotOn]?.label || pivotOn });
    values.forEach((m) => {
      const alias = m.alias || m.field;
      out.push({ key: alias, label: m.alias || measByKey[m.field]?.label || m.field });
    });
    computed.filter((c) => c.alias).forEach((c) => out.push({ key: c.alias, label: c.alias }));
    return out;
  }, [rowDims, pivotOn, values, computed, dimByKey, measByKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 22px 44px" }}>
      {/* top chrome */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>Matrix Builder</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-4)", maxWidth: 520 }}>
          Power BI–style: fields → wells → formulas → filters. Not Excel cell edit —
          each value is a measure (SUM/AVG/…) or calculated field.
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, ...panel, padding: 3 }}>
          {([
            ["build", BookOpen, "Build"],
            ["presets", Sparkles, "Presets"],
            ["code", Code2, "Code"],
          ] as const).map(([m, Icon, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{ ...btn(mode === m ? "primary" : "ghost"), padding: "5px 10px", border: "none" }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "presets" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => applyPreset(p)}
              style={{ ...panel, padding: 14, textAlign: "left", cursor: "pointer", background: "var(--panel-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Wand2 size={14} style={{ color: "var(--steel)" }} />
                <b style={{ fontSize: 13, color: "var(--ink)" }}>{p.title}</b>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{p.blurb}</div>
              <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 8 }}>dataset · {p.dataset}</div>
            </button>
          ))}
        </div>
      )}

      {mode === "code" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ ...panel, padding: 12, minHeight: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Braces size={14} /> <b style={{ fontSize: 12 }}>Query spec (JSON)</b>
              <button onClick={() => copyText("spec", JSON.stringify(spec, null, 2))} style={{ ...btn("ghost"), marginLeft: "auto", padding: "3px 8px" }}>
                <Copy size={12} /> {copied === "spec" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre style={{ margin: 0, fontSize: 11, color: "var(--ink-2)", overflow: "auto", maxHeight: 420, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(spec, null, 2)}
            </pre>
          </div>
          <div style={{ ...panel, padding: 12, minHeight: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Code2 size={14} /> <b style={{ fontSize: 12 }}>Compiled SQL</b>
              <button onClick={() => copyText("sql", sql || "")} disabled={!sql} style={{ ...btn("ghost"), marginLeft: "auto", padding: "3px 8px" }}>
                <Copy size={12} /> {copied === "sql" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre style={{ margin: 0, fontSize: 11, color: "var(--ink-2)", overflow: "auto", maxHeight: 420, whiteSpace: "pre-wrap" }}>
              {sql || (busy ? "Running…" : "Run a query to see SQL. Identifiers are whitelisted; values are bound parameters.")}
            </pre>
          </div>
        </div>
      )}

      {mode === "build" && (
        <div style={{ display: "grid", gridTemplateColumns: "260px 320px 1fr", gap: 12, alignItems: "start" }}>
          {/* ================= LEFT: dataset + field catalog ================= */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 12 }}>
            <div style={{ ...panel, padding: 12 }}>
              <div style={secLabel}><Table2 size={12} /> Data source</div>
              <select value={dsKey} onChange={(e) => setDsKey(e.target.value)} style={{ ...inp, width: "100%" }}>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>

            <div style={{ ...panel, padding: 12 }}>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: "var(--ink-4)" }} />
                <input placeholder="Search fields…" value={search} onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inp, width: "100%", paddingLeft: 26 }} />
              </div>

              <div style={secLabel}><Type size={12} /> Dimensions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12, maxHeight: 200, overflowY: "auto" }}>
                {dimList.map((f) => (
                  <FieldRow key={f.key} f={f} kind="dim"
                    active={rowDims.includes(f.key) || pivotOn === f.key}
                    onDragStart={onDragStart}
                    onClick={() => setRowDims((p) => p.includes(f.key) ? p.filter((x) => x !== f.key) : [...p, f.key])} />
                ))}
                {dimList.length === 0 && <Muted>No matching fields.</Muted>}
              </div>

              <div style={secLabel}><Sigma size={12} /> Measures</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
                {measList.map((f) => (
                  <FieldRow key={f.key} f={f} kind="measure"
                    active={values.some((m) => m.field === f.key)}
                    onDragStart={onDragStart}
                    onClick={() => setValues((p) => p.some((m) => m.field === f.key) ? p.filter((m) => m.field !== f.key) : [...p, { field: f.key, agg: f.default_agg || "sum" }])} />
                ))}
                {measList.length === 0 && <Muted>No matching fields.</Muted>}
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 10, lineHeight: 1.4 }}>
                Drag into wells, or click to toggle. Click a measure chip under Formulas to insert its key into the active formula.
              </div>
            </div>
          </div>

          {/* ================= MIDDLE: wells ================= */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "sticky", top: 12, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
            <Well title="Rows" icon={<Rows3 size={12} />} zone="rows" dragOver={dragOver}
              onDrop={dropRows} onDragOver={allowDrop("rows")} onDragLeave={() => setDragOver("")}
              hint="Dimensions → group rows (Power BI Rows well)">
              {rowDims.map((k) => (
                <Pill key={k} label={dimByKey[k]?.label || k} type={dimByKey[k]?.type}
                  filtered={conds.some((c) => c.field === k && (c.op === "in" || c.op === "not_in"))}
                  onFilter={() => addMemberFilter(k)}
                  onRemove={() => setRowDims((p) => p.filter((x) => x !== k))}
                  onMoveLeft={() => setRowDims((p) => moveItem(p, k, -1))}
                  onMoveRight={() => setRowDims((p) => moveItem(p, k, 1))} />
              ))}
            </Well>

            <Well title="Columns (pivot)" icon={<Columns3 size={12} />} zone="pivot" dragOver={dragOver}
              onDrop={dropPivot} onDragOver={allowDrop("pivot")} onDragLeave={() => setDragOver("")}
              hint="One dimension → matrix columns (e.g. Month)">
              {pivotOn && (
                <Pill label={dimByKey[pivotOn]?.label || pivotOn} type={dimByKey[pivotOn]?.type}
                  filtered={conds.some((c) => c.field === pivotOn && (c.op === "in" || c.op === "not_in"))}
                  onFilter={() => addMemberFilter(pivotOn)}
                  onRemove={() => setPivotOn("")} />
              )}
              {pivotOn && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 11, color: "var(--ink-3)", width: "100%" }}>
                  <label style={ck}><input type="checkbox" checked={rowTotal} onChange={(e) => setRowTotal(e.target.checked)} /> Row total</label>
                  <label style={ck}><input type="checkbox" checked={quarterTotals} onChange={(e) => setQuarterTotals(e.target.checked)} /> FY quarter totals</label>
                </div>
              )}
            </Well>

            <Well title="Values" icon={<Sigma size={12} />} zone="values" dragOver={dragOver}
              onDrop={dropValues} onDragOver={allowDrop("values")} onDragLeave={() => setDragOver("")}
              hint="Measures → SUM / AVG / … (Power BI Values)">
              {values.map((m, i) => (
                <div key={m.field} style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%", marginBottom: 4, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12, flex: 1, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 5 }}>
                      <Hash size={11} /> {measByKey[m.field]?.label || m.field}
                    </span>
                    <select value={m.agg} onChange={(e) => setValues((p) => p.map((x, j) => j === i ? { ...x, agg: e.target.value } : x))}
                      style={{ ...inp, padding: "2px 5px" }} title="Aggregation">
                      {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <button onClick={() => setValues((p) => p.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: "2px 5px" }}><X size={11} /></button>
                  </div>
                  <input
                    placeholder="alias (optional display name)"
                    value={m.alias || ""}
                    onChange={(e) => setValues((p) => p.map((x, j) => j === i ? { ...x, alias: e.target.value || undefined } : x))}
                    style={{ ...inp, fontSize: 11, padding: "3px 6px" }}
                  />
                </div>
              ))}
            </Well>

            {/* calculated fields — formula assistant */}
            <div style={{ ...panel, padding: 11 }}>
              <div style={secLabel}>
                <FunctionSquare size={12} /> Formulas (calculated measures)
                <button onClick={() => { setComputed((p) => [...p, { alias: "", expression: "" }]); setFormulaFocus(computed.length); }}
                  style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }}><Plus size={12} /></button>
              </div>
              <Muted>Like DAX measures: only measure keys + − * / ( ). Example: <code style={{ color: "var(--steel)" }}>actual/be*100</code></Muted>

              {availableTemplates.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0" }}>
                  {availableTemplates.map((t) => (
                    <button key={t.alias} onClick={() => addFormulaTemplate(t)} title={t.expression}
                      style={{ ...btn("ghost"), padding: "3px 8px", fontSize: 11 }}>
                      <Wand2 size={10} /> {t.name}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {measureKeys.map((k) => (
                  <button key={k} type="button" onClick={() => insertIntoFormula(k)}
                    style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 5, cursor: "pointer",
                      border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--steel)", fontWeight: 700,
                    }}
                    title={`Insert ${k} into focused formula`}>
                    {k}
                  </button>
                ))}
              </div>

              {computed.length === 0 && <Muted>No calculated fields yet.</Muted>}
              {computed.map((c, i) => (
                <div key={i} style={{
                  marginBottom: 8, padding: 8, borderRadius: 8,
                  border: formulaFocus === i ? "1px solid var(--steel)" : "1px solid var(--line)",
                  background: formulaFocus === i ? "var(--steel-soft)" : "var(--panel-2)",
                }}
                  onClick={() => setFormulaFocus(i)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <input placeholder="name" value={c.alias}
                      onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, alias: e.target.value } : x))}
                      onFocus={() => setFormulaFocus(i)}
                      style={{ ...inp, width: 100 }} />
                    <span style={{ color: "var(--ink-4)" }}>=</span>
                    <button onClick={(e) => { e.stopPropagation(); setComputed((p) => p.filter((_, j) => j !== i)); if (formulaFocus === i) setFormulaFocus(null); }}
                      style={{ ...btn("ghost"), padding: "3px 4px", marginLeft: "auto" }}><X size={11} /></button>
                  </div>
                  <input placeholder="expression e.g. actual/be*100" value={c.expression}
                    onChange={(e) => setComputed((p) => p.map((x, j) => j === i ? { ...x, expression: e.target.value } : x))}
                    onFocus={() => setFormulaFocus(i)}
                    style={{ ...inp, width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
                </div>
              ))}
            </div>

            {/* filters */}
            <div style={{ ...panel, padding: 11 }} onDrop={dropFilter} onDragOver={allowDrop("filters")} onDragLeave={() => setDragOver("")}
              className={dragOver === "filters" ? "rs-drop-active" : undefined}>
              <div style={secLabel}>
                <FilterIcon size={12} /> Filters
                <select value={filterOp} onChange={(e) => setFilterOp(e.target.value as any)} style={{ ...inp, padding: "1px 5px", marginLeft: 6 }}>
                  <option value="AND">ALL (AND)</option><option value="OR">ANY (OR)</option>
                </select>
                <button onClick={() => setConds((p) => [...p, { field: ds?.dimensions[0]?.key || "", op: "=", value: "" }])}
                  style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }}><Plus size={12} /></button>
              </div>
              {conds.length === 0 && <Muted>Drag a field here. Filters apply before aggregation (like Power BI report filters).</Muted>}
              {conds.map((c, i) => {
                const f = dimByKey[c.field] || measByKey[c.field];
                const type = f?.type || "text";
                const ops = opsFor(type);
                const opDef = ops.find((o) => o.v === c.op) || ops[0];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5, flexWrap: "wrap" }}>
                    <select value={c.field} onChange={(e) => {
                      const nf = dimByKey[e.target.value] || measByKey[e.target.value];
                      setConds((p) => p.map((x, j) => j === i ? { field: e.target.value, op: opsFor(nf?.type || "text")[0].v, value: "" } : x));
                    }} style={{ ...inp, maxWidth: 120 }}>
                      <optgroup label="Dimensions">{ds?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>
                    </select>
                    <select value={c.op} onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, op: e.target.value, value: (e.target.value === "in" || e.target.value === "not_in") ? [] : "" } : x))} style={inp}>
                      {ops.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                    {opDef.needsValue && (c.op === "in" || c.op === "not_in") && dimByKey[c.field] ? (
                      <MemberPicker dataset={dsKey} field={c.field} fieldLabel={f?.label || c.field}
                        selected={Array.isArray(c.value) ? c.value : (c.value ? String(c.value).split(",").map((s) => s.trim()).filter(Boolean) : [])}
                        onChange={(vals) => setConds((p) => p.map((x, j) => j === i ? { ...x, value: vals } : x))} />
                    ) : opDef.needsValue && (
                      <input value={Array.isArray(c.value) ? c.value.join(",") : (c.value ?? "")} type={type === "date" ? "date" : "text"}
                        onChange={(e) => setConds((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                        placeholder={c.op === "between" ? "a,b" : "value"} style={{ ...inp, flex: 1, minWidth: 72 }} />
                    )}
                    <button onClick={() => setConds((p) => p.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: "3px 5px" }}><X size={11} /></button>
                    {REL_DATE_OPS.includes(c.op) && (() => {
                      const r = relDateRange(c.op);
                      return r ? <span style={{ fontSize: 10, color: "var(--ink-4)", flexBasis: "100%" }}>= {r[0]} → {r[1]}</span> : null;
                    })()}
                  </div>
                );
              })}
            </div>

            {/* sort */}
            <div style={{ ...panel, padding: 11 }}>
              <div style={secLabel}>
                <ArrowDownAZ size={12} /> Sort
                <button onClick={() => setSorts((p) => [...p, { by: sortTargets[0]?.key || "", dir: "desc" }])}
                  style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }} disabled={!sortTargets.length}><Plus size={12} /></button>
              </div>
              {sorts.length === 0 && <Muted>Default: first measure descending. Add explicit sort levels.</Muted>}
              {sorts.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 4, marginBottom: 5, alignItems: "center" }}>
                  <select value={s.by} onChange={(e) => setSorts((p) => p.map((x, j) => j === i ? { ...x, by: e.target.value } : x))} style={{ ...inp, flex: 1 }}>
                    {sortTargets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <select value={s.dir} onChange={(e) => setSorts((p) => p.map((x, j) => j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x))} style={inp}>
                    <option value="asc">↑ asc</option>
                    <option value="desc">↓ desc</option>
                  </select>
                  <button onClick={() => setSorts((p) => p.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: "3px 5px" }}><X size={11} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* ================= RIGHT: toolbar + results ================= */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={run} disabled={busy} style={btn("primary")}>
                {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-3)" }}>
                <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} /> Live
              </label>
              <div style={{ display: "flex", gap: 3, ...panel, padding: 3 }}>
                {([["table", Table2], ["bar", BarChart3], ["line", LineIcon], ["pie", PieIcon], ["kpi", Hash]] as const).map(([v, Icon]) => (
                  <button key={v} onClick={() => setViz(v)} title={v} style={{ ...btn(viz === v ? "primary" : "ghost"), padding: "5px 8px", border: "none" }}><Icon size={14} /></button>
                ))}
              </div>
              <label style={ck}>
                <input type="checkbox" checked={grandTotal} onChange={(e) => setGrandTotal(e.target.checked)} /> Grand total
              </label>
              <label style={ck}>
                <input type="checkbox" checked={condFmt} onChange={(e) => setCondFmt(e.target.checked)} /> Cond. format
              </label>
              <label style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 5 }}>
                limit <input type="number" value={limit} min={1} max={5000} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...inp, width: 66 }} />
              </label>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={exportCsv} disabled={!cols.length} style={btn("ghost")}><Download size={13} /> CSV</button>
                <button onClick={() => setShowSave(true)} disabled={!cols.length} style={btn("ghost")}><Save size={13} /> Save metric</button>
                <button onClick={() => setShowAddTo(true)} disabled={!cols.length} style={btn("ghost")}><Plus size={13} /> Add to report</button>
              </div>
            </div>

            {/* client slicer */}
            {cols.length > 0 && dimCols.length > 0 && (
              <div style={{ ...panel, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-4)" }}>Slicer</span>
                <select value={slicerDim} onChange={(e) => { setSlicerDim(e.target.value); setSlicerVals([]); }} style={{ ...inp, minWidth: 140 }}>
                  <option value="">— off —</option>
                  {dimCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                {slicerDim && slicerOptions.slice(0, 24).map((v) => {
                  const on = slicerVals.includes(v);
                  return (
                    <button key={v} onClick={() => setSlicerVals((p) => on ? p.filter((x) => x !== v) : [...p, v])}
                      style={{
                        ...btn(on ? "primary" : "ghost"), padding: "3px 8px", fontSize: 11,
                      }}>{v}</button>
                  );
                })}
                {slicerDim && slicerVals.length > 0 && (
                  <button onClick={() => setSlicerVals([])} style={{ ...btn("ghost"), padding: "3px 8px", fontSize: 11 }}>Clear</button>
                )}
              </div>
            )}

            {err && <div style={{ ...panel, padding: "8px 12px", color: "var(--slag, #e5534b)", fontSize: 12, borderColor: "var(--slag, #e5534b)" }}>{err}</div>}

            <div style={{ ...panel, padding: 0, minHeight: 320, overflow: "hidden" }}>
              {!hasQuery ? (
                <Splash />
              ) : cols.length === 0 ? (
                <div style={{ color: "var(--ink-4)", fontSize: 13, textAlign: "center", padding: 70 }}>
                  {busy ? "Running…" : "No rows for this query."}
                </div>
              ) : viz === "kpi" ? <KpiCards cols={numericCols} rows={displayRows} /> :
                 viz === "table" ? <ResultGrid cols={cols} rows={displayRows} condFmt={condFmt} /> :
                 <ChartView viz={viz} dimCols={dimCols} numericCols={numericCols} rows={displayRows} />}
            </div>
            {cols.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--ink-4)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>{displayRows.filter((r) => !r.__total__).length} rows · {cols.length} columns</span>
                {sql && <button onClick={() => setMode("code")} style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 11 }}><Code2 size={11} /> View SQL</button>}
              </div>
            )}
          </div>
        </div>
      )}

      {showSave && <SaveModal spec={spec} viz={viz} dsLabel={ds?.label || ""} onClose={() => setShowSave(false)} />}
      {showAddTo && <AddToReportModal spec={spec} onClose={() => setShowAddTo(false)} />}
    </div>
  );
}

function moveItem<T>(arr: T[], item: T, dir: -1 | 1): T[] {
  const i = arr.indexOf(item);
  if (i < 0) return arr;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.4, marginBottom: 4 }}>{children}</div>;
}

function FieldRow({ f, kind, active, onDragStart, onClick }: {
  f: Field; kind: "dim" | "measure"; active: boolean;
  onDragStart: (e: React.DragEvent, p: DragPayload) => void; onClick: () => void;
}) {
  return (
    <div draggable onDragStart={(e) => onDragStart(e, { kind, key: f.key, label: f.label, type: f.type, default_agg: f.default_agg })}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, cursor: "grab",
        border: "1px solid " + (active ? "var(--steel)" : "var(--line)"),
        background: active ? "var(--steel-soft)" : "var(--panel-2)",
        color: active ? "var(--steel)" : "var(--ink-2)", fontSize: 12, fontWeight: 600,
      }}
      title={`${f.key} · ${f.type}${f.default_agg ? " · " + f.default_agg : ""}`}>
      <GripVertical size={11} style={{ color: "var(--ink-4)", flexShrink: 0 }} />
      <span style={{ color: "var(--ink-4)", display: "flex" }}><TypeIcon type={f.type} /></span>
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</span>
    </div>
  );
}

function Well({ title, icon, zone, dragOver, hint, children, onDrop, onDragOver, onDragLeave }: {
  title: string; icon: React.ReactNode; zone: string; dragOver: string; hint: string;
  children: React.ReactNode; onDrop: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void;
}) {
  const active = dragOver === zone;
  const empty = !children || (Array.isArray(children) && children.filter(Boolean).length === 0);
  return (
    <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
      style={{
        ...panel, padding: 11,
        borderColor: active ? "var(--steel)" : "var(--line)",
        background: active ? "var(--steel-soft)" : "var(--panel)",
        transition: "background .12s, border-color .12s",
      }}>
      <div style={secLabel}>{icon} {title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 30, alignItems: "center" }}>
        {empty ? <span style={{ fontSize: 11, color: "var(--ink-4)", fontStyle: "italic" }}>{hint}</span> : children}
      </div>
    </div>
  );
}

function Pill({ label, type, filtered, onFilter, onRemove, onMoveLeft, onMoveRight }: {
  label: string; type?: string; filtered?: boolean; onFilter?: () => void; onRemove: () => void;
  onMoveLeft?: () => void; onMoveRight?: () => void;
}) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 7,
      border: "1px solid var(--steel)", background: "var(--steel-soft)", color: "var(--steel)", fontSize: 12, fontWeight: 650,
    }}>
      {type && <TypeIcon type={type} />}{label}
      {onMoveLeft && <button type="button" onClick={onMoveLeft} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", padding: 0, fontSize: 10 }} title="Move left">‹</button>}
      {onMoveRight && <button type="button" onClick={onMoveRight} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", padding: 0, fontSize: 10 }} title="Move right">›</button>}
      {onFilter && (
        <span onClick={onFilter} title="Show only specific values (member filter)"
          style={{ display: "inline-flex", cursor: "pointer", opacity: filtered ? 1 : 0.55 }}>
          <FilterIcon size={12} />
        </span>
      )}
      <X size={12} style={{ cursor: "pointer" }} onClick={onRemove} />
    </span>
  );
}

function Splash() {
  return (
    <div style={{ color: "var(--ink-4)", fontSize: 13, textAlign: "center", padding: "56px 28px", lineHeight: 1.75 }}>
      <BarChart3 size={30} style={{ opacity: 0.4, marginBottom: 10 }} />
      <div><b style={{ color: "var(--ink-2)" }}>Build like Power BI Matrix</b> — not Excel cell-by-cell.</div>
      <div style={{ fontSize: 12, marginTop: 8, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
        1. Pick a dataset · 2. Rows + Values · 3. optional Columns (pivot) · 4. Formulas · 5. Filters<br />
        Or open <b style={{ color: "var(--steel)" }}>Presets</b> for MoS / CAPEX starter queries.
      </div>
      <div style={{ fontSize: 11.5, marginTop: 12, opacity: 0.9 }}>
        Formulas use measure keys: <code style={{ color: "var(--steel)" }}>actual/be*100</code> ·
        Code tab shows JSON + compiled SQL.
      </div>
    </div>
  );
}

function ResultGrid({ cols, rows, condFmt }: { cols: Column[]; rows: any[]; condFmt: boolean }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const totalRows = rows.filter((r) => r.__total__);
  const dataRows = rows.filter((r) => !r.__total__);

  const columns = useMemo<ColumnDef<any>[]>(() => cols.map((c) => ({
    accessorKey: c.key,
    header: c.label,
    cell: (info) => {
      const v = info.getValue();
      const color = condFmt ? cellColor(v, c.type, c.key) : undefined;
      return <span style={{ color }}>{fmtNum(v, c.type)}</span>;
    },
    meta: { type: c.type },
    sortingFn: isNum(c.type) ? "basic" : "alphanumeric",
  })), [cols, condFmt]);

  const table = useReactTable({
    data: dataRows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const type = (h.column.columnDef.meta as any)?.type || "text";
                const sorted = h.column.getIsSorted();
                return (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                    style={{
                      textAlign: isNum(type) ? "right" : "left", padding: "8px 11px", cursor: "pointer",
                      borderBottom: "2px solid var(--line)", color: "var(--ink-3)", fontWeight: 700,
                      whiteSpace: "nowrap", background: "var(--panel)", userSelect: "none",
                    }}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : ""}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
              {r.getVisibleCells().map((cell) => {
                const type = (cell.column.columnDef.meta as any)?.type || "text";
                return (
                  <td key={cell.id} style={{ textAlign: isNum(type) ? "right" : "left", padding: "6px 11px", color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
          {totalRows.map((tr, i) => (
            <tr key={"t" + i} style={{ borderBottom: "1px solid var(--line)", background: "var(--steel-soft)", fontWeight: 800 }}>
              {cols.map((c) => {
                const v = tr[c.key];
                const color = condFmt ? cellColor(v, c.type, c.key) : undefined;
                return (
                  <td key={c.key} style={{ textAlign: isNum(c.type) ? "right" : "left", padding: "7px 11px", color: color || "var(--ink)", whiteSpace: "nowrap", fontWeight: 800 }}>
                    {fmtNum(v, c.type)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCards({ cols, rows }: { cols: Column[]; rows: any[] }) {
  if (!rows.length) return null;
  const r = rows.find((x) => x.__total__) || rows[0];
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: 16 }}>
      {cols.map((c) => (
        <div key={c.key} style={{ ...panel, padding: "16px 22px", minWidth: 170, background: "var(--panel-2)" }}>
          <div style={{ fontSize: 11, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>{c.label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--steel)", marginTop: 4 }}>{fmtNum(r[c.key], c.type)}</div>
        </div>
      ))}
    </div>
  );
}

function ChartView({ viz, dimCols, numericCols, rows }: { viz: Viz; dimCols: Column[]; numericCols: Column[]; rows: any[] }) {
  if (!numericCols.length) return <div style={{ color: "var(--ink-4)", padding: 40, textAlign: "center" }}>Charts need at least one numeric value.</div>;
  const data = rows.filter((r) => !r.__total__);
  const xKey = dimCols[0]?.key || "_";
  const axisStyle = { fill: "var(--ink-4)", fontSize: 11 };
  return (
    <div style={{ padding: 14 }}>
      <ResponsiveContainer width="100%" height={360}>
        {viz === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey={numericCols[0].key} nameKey={xKey} outerRadius={140} label>
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
    </div>
  );
}

/** Searchable checkbox picker of a dimension's real distinct DB values. */
function MemberPicker({ dataset, field, fieldLabel, selected, onChange }: {
  dataset: string; field: string; fieldLabel: string; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<any>(null);

  const load = useCallback((term: string) => {
    setLoading(true);
    const url = rs(`/field-values?dataset=${encodeURIComponent(dataset)}&field=${encodeURIComponent(field)}&limit=500${term ? `&search=${encodeURIComponent(term)}` : ""}`);
    authFetch(url).then((r) => r.json()).then((j) => setOpts((j.values || []).map((v: any) => String(v))))
      .catch(() => setOpts([])).finally(() => setLoading(false));
  }, [dataset, field]);

  useEffect(() => { if (open && opts.length === 0) load(""); }, [open, load, opts.length]);
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(search), 300);
    return () => clearTimeout(timer.current);
  }, [search, open, load]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const label = selected.length === 0 ? "Select…" : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div ref={boxRef} style={{ position: "relative", flex: 1, minWidth: 120 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={selected.join(", ")}
        style={{ ...inp, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
        <CheckSquare size={12} style={{ color: "var(--steel)", flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: selected.length ? "var(--ink)" : "var(--ink-4)" }}>{label}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, minWidth: 240, maxWidth: 340,
          ...panel, padding: 8, boxShadow: "0 10px 30px rgba(0,0,0,.35)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Search size={12} style={{ color: "var(--ink-4)" }} />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${fieldLabel}…`}
              style={{ ...inp, flex: 1, padding: "4px 6px" }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, fontSize: 10.5 }}>
            <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...opts])))} style={{ ...btn("ghost"), padding: "2px 7px", fontSize: 10.5 }}>Select all shown</button>
            <button type="button" onClick={() => onChange([])} style={{ ...btn("ghost"), padding: "2px 7px", fontSize: 10.5 }}>Clear</button>
            <span style={{ marginLeft: "auto", color: "var(--ink-4)", alignSelf: "center" }}>{selected.length} sel</span>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
            {loading && <div style={{ fontSize: 11, color: "var(--ink-4)", padding: 6 }}>Loading…</div>}
            {!loading && opts.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-4)", padding: 6 }}>No values.</div>}
            {opts.map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 5px", borderRadius: 5, cursor: "pointer", fontSize: 12, color: "var(--ink-2)", background: selected.includes(v) ? "var(--steel-soft)" : "transparent" }}>
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const REL_DATE_OPS = ["this_fy", "last_fy", "ytd", "this_quarter", "this_month"];

/** Translate a relative-date op (this FY, etc.) into a concrete [start, end] range. Fiscal year = Apr–Mar. */
function relDateRange(op: string): [string, string] | null {
  const now = new Date();
  const Y = now.getFullYear(), M = now.getMonth() + 1, D = now.getDate();
  const fyStart = M >= 4 ? Y : Y - 1;                        // year the current FY began
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
  const f = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  switch (op) {
    case "this_fy": return [f(fyStart, 4, 1), f(fyStart + 1, 3, 31)];
    case "last_fy": return [f(fyStart - 1, 4, 1), f(fyStart, 3, 31)];
    case "ytd": return [f(fyStart, 4, 1), f(Y, M, D)];
    case "this_month": return [f(Y, M, 1), f(Y, M, lastDay(Y, M))];
    case "this_quarter": {
      if (M >= 4 && M <= 6) return [f(fyStart, 4, 1), f(fyStart, 6, 30)];
      if (M >= 7 && M <= 9) return [f(fyStart, 7, 1), f(fyStart, 9, 30)];
      if (M >= 10 && M <= 12) return [f(fyStart, 10, 1), f(fyStart, 12, 31)];
      return [f(fyStart + 1, 1, 1), f(fyStart + 1, 3, 31)];
    }
  }
  return null;
}

function normalizeCond(c: Cond) {
  const toList = (v: any) => Array.isArray(v) ? v : String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (REL_DATE_OPS.includes(c.op)) {
    const r = relDateRange(c.op);
    return r ? { field: c.field, op: "between", value: r } : { field: c.field, op: "not_null", value: null };
  }
  if (c.op === "in" || c.op === "not_in") return { ...c, value: toList(c.value) };
  if (c.op === "between") return { ...c, value: toList(c.value) };
  return c;
}

function SaveModal({ spec, viz, dsLabel, onClose }: { spec: any; viz: Viz; dsLabel: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    const r = await authFetch(rs("/metrics"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dataset: spec.dataset, spec, viz }),
    });
    if (r.ok) onClose(); else { setErr((await r.json()).detail || "Save failed"); setBusy(false); }
  };
  return (
    <Modal title="Save metric" onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Metric name" style={{ ...inp, width: "100%", marginBottom: 10 }} />
      <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 12 }}>Saved as <b>{viz}</b> on <b>{dsLabel}</b> — reusable as a dashboard card.</div>
      {err && <div style={{ fontSize: 12, color: "var(--slag, #e5534b)", marginBottom: 8 }}>{err}</div>}
      <button onClick={save} disabled={busy} style={{ ...btn("primary"), width: "100%", justifyContent: "center" }}>
        {busy ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save
      </button>
    </Modal>
  );
}

function AddToReportModal({ spec, onClose }: { spec: any; onClose: () => void }) {
  const [reports, setReports] = useState<{ report_id: number; name: string }[]>([]);
  const [target, setTarget] = useState("new");
  const [newName, setNewName] = useState("My Custom Report");
  const [title, setTitle] = useState("New section");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { authFetch(rs("/reports")).then((r) => r.json()).then((j) => setReports(j.reports || [])).catch(() => {}); }, []);

  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      const section = { title, spec };
      if (target === "new") {
        const r = await authFetch(rs("/reports"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName, sections: [section] }),
        });
        if (!r.ok) throw new Error((await r.json()).detail || "Create failed");
      } else {
        const r0 = await authFetch(rs(`/reports/${target}`)); const doc = await r0.json();
        if (!r0.ok) throw new Error(doc.detail || "Load failed");
        const r = await authFetch(rs(`/reports/${target}`), {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: doc.name, description: doc.description, category: doc.category, sections: [...(doc.sections || []), section] }),
        });
        if (!r.ok) throw new Error((await r.json()).detail || "Update failed");
      }
      setMsg("Saved as template ✓ — open Report Studio → Templates to run anytime with live figures."); setTimeout(onClose, 1100);
    } catch (e: any) { setMsg(String(e.message || e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="Save as report template section" onClose={onClose}>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 10, lineHeight: 1.45 }}>
        Stores the <b>query design</b> (fields, formulas, filters) — not a snapshot.
        Regenerating later always pulls updated figures.
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 6 }}>Section title</div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, width: "100%", marginBottom: 10 }} />
      <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 6 }}>Target report</div>
      <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inp, width: "100%", marginBottom: 10 }}>
        <option value="new">➕ Create new report…</option>
        {reports.map((r) => <option key={r.report_id} value={String(r.report_id)}>{r.name}</option>)}
      </select>
      {target === "new" && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Report name" style={{ ...inp, width: "100%", marginBottom: 10 }} />}
      {msg && <div style={{ fontSize: 12, color: msg.startsWith("Added") ? "var(--steel)" : "var(--slag, #e5534b)", marginBottom: 8 }}>{msg}</div>}
      <button onClick={submit} disabled={busy} style={{ ...btn("primary"), width: "100%", justifyContent: "center" }}>
        {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add section
      </button>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ ...panel, padding: 18, width: 400, maxWidth: "92vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <b style={{ color: "var(--ink)" }}>{title}</b>
          <button onClick={onClose} style={btn("ghost")}><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
