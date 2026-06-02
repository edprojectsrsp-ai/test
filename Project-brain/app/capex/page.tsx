"use client";
import { useState, useEffect, useCallback } from "react";
import { useMos } from "@/components/brain/MosContext";
import {
  Save, Plus, ArrowDownToLine, Lock, Unlock,
  Indent, Outdent, ArrowUp, ArrowDown,
  ChevronDown, ChevronRight, Trash2, RefreshCw,
  CalendarDays, LineChart, Wallet, Sparkles, History, BarChart2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = "http://localhost:8002/api/v1";

// =============================================================================
// Types
// =============================================================================
type MonthValue = { be: number; re: number; actual: number; _re_auto_filled?: boolean };
type RowLevel = "Header" | "SubHeader" | "Item" | "Package";
type PlanType = "BE" | "RE";
type TabKey = "BE" | "RE" | "ACTUALS" | "SUMMARY";

type CapexRow = {
  id: string;
  row_id?: number;
  name: string;
  level: RowLevel;
  indent: number;
  gross: number;
  cumLast: number;
  beFY: number;
  reFY: number;
  actualFY: number;
  scheme_id?: number | null;
  months: Record<number, MonthValue>;
  isEditable: boolean;
};

type PlanListItem = {
  id: number; fy_year: string; plan_type: string; plan_version: string | null;
  plan_status: string; effective_from_month: number | null; row_count: number;
};

type ActualsRow = {
  row_id: number; row_name: string; row_level: string;
  scheme_id: number | null; indent: number; months: Record<string, number>;
};

const MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const FY_MONTH_ORDER = [4,5,6,7,8,9,10,11,12,1,2,3];

// =============================================================================
// Helpers
// =============================================================================
const getEmptyMonths = (): Record<number, MonthValue> => {
  const m: Record<number, MonthValue> = {};
  for (let i = 1; i <= 12; i++) m[i] = { be: 0, re: 0, actual: 0 };
  return m;
};

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("brain_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Cumulative-through-month for a leaf row, in FY order. For RE plans the
 *  pre-effective months already carry actual values (auto-filled server-side),
 *  so a simple running sum of the chosen field gives the right cumulative. */
function cumulativeThrough(row: CapexRow, monthNo: number, field: "be" | "re" | "actual"): number {
  let sum = 0;
  for (const m of FY_MONTH_ORDER) {
    sum += row.months[m]?.[field] || 0;
    if (m === monthNo) break;
  }
  return sum;
}

function recomputeRollups(rows: CapexRow[]): CapexRow[] {
  const out = [...rows];
  // Leaf rows (Item with no children, or Package): derive FY totals from months
  for (let i = 0; i < out.length; i++) {
    if (out[i].level !== "Item" && out[i].level !== "Package") continue;
    // An Item with Package children should sum from packages, not its own months.
    const hasChildren = i + 1 < out.length && out[i + 1].indent > out[i].indent;
    if (out[i].level === "Item" && hasChildren) continue;
    let be = 0, re = 0, act = 0;
    for (let m = 1; m <= 12; m++) {
      const mv = out[i].months[m];
      if (mv) { be += mv.be || 0; re += mv.re || 0; act += mv.actual || 0; }
    }
    out[i].beFY = be; out[i].reFY = re; out[i].actualFY = act;
  }
  // Roll up parents (Header / SubHeader / Item-with-children) from direct children
  for (let i = out.length - 1; i >= 0; i--) {
    const isParent = out[i].level === "Header" || out[i].level === "SubHeader"
      || (out[i].level === "Item" && i + 1 < out.length && out[i + 1].indent > out[i].indent);
    if (!isParent) continue;
    out[i].gross = 0; out[i].cumLast = 0; out[i].beFY = 0; out[i].reFY = 0; out[i].actualFY = 0;
    const target = out[i].indent + 1;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].indent <= out[i].indent) break;
      if (out[j].indent === target) {
        out[i].gross += out[j].gross || 0;
        out[i].cumLast += out[j].cumLast || 0;
        out[i].beFY += out[j].beFY || 0;
        out[i].reFY += out[j].reFY || 0;
        out[i].actualFY += out[j].actualFY || 0;
      }
    }
  }
  return out;
}

function serverRowToLocal(r: any): CapexRow {
  const months = getEmptyMonths();
  if (r.months && typeof r.months === "object") {
    for (const [k, v] of Object.entries<any>(r.months)) {
      const m = Number(k);
      if (m >= 1 && m <= 12) {
        months[m] = {
          be: Number(v.be) || 0, re: Number(v.re) || 0, actual: Number(v.actual) || 0,
          _re_auto_filled: !!v._re_auto_filled,
        };
      }
    }
  }
  return {
    id: r.id, row_id: r.row_id, name: r.name, level: r.level as RowLevel,
    indent: r.indent || 0, gross: Number(r.gross) || 0, cumLast: Number(r.cumLast) || 0,
    beFY: Number(r.beFY) || 0, reFY: Number(r.reFY) || 0, actualFY: Number(r.actualFY) || 0,
    scheme_id: r.scheme_id ?? null, months,
    isEditable: r.isEditable !== false && (r.level === "Item" || r.level === "Package"),
  };
}

// Header scaffold for import (A / B1-B3 / C / D1-D4)
function buildHeaderScaffold(): { key: string; name: string; level: RowLevel; indent: number }[] {
  return [
    { key: "A",   name: "A. MEP Schemes",                          level: "Header", indent: 0 },
    { key: "B",   name: "B. AMR Schemes",                          level: "Header", indent: 0 },
    { key: "B1",  name: "B1. Completed Corporate AMR (>30 Cr)",    level: "SubHeader", indent: 1 },
    { key: "B2",  name: "B2. Ongoing Corporate AMR (>30 Cr)",      level: "SubHeader", indent: 1 },
    { key: "B3",  name: "B3. Plant Level AMR (<30 Cr)",            level: "SubHeader", indent: 1 },
    { key: "C",   name: "C. Capital Repairs / Spares",             level: "Header", indent: 0 },
    { key: "D",   name: "D. Allocation for New / Upcoming",        level: "Header", indent: 0 },
    { key: "D1",  name: "D1. Order Placed this FY",                level: "SubHeader", indent: 1 },
    { key: "D2",  name: "D2. Under Tendering",                     level: "SubHeader", indent: 1 },
    { key: "D3",  name: "D3. Under Stage-I",                       level: "SubHeader", indent: 1 },
    { key: "D4",  name: "D4. Under Formulation",                   level: "SubHeader", indent: 1 },
  ];
}

function classifyScheme(stype: string, status: string): string {
  const t = (stype || "").toUpperCase().trim();
  const s = (status || "").toUpperCase().trim();
  if (t === "MEP") return "A";
  if (t === "DUMMY") return "C";
  if (t === "PLANT") return "B3";
  if (t === "CORPORATE") {
    if (s === "CLOSED") return "B1";
    if (s === "ONGOING") return "B2";
  }
  // Pipeline statuses â†’ D buckets (any scheme type)
  if (s === "UNDER_TENDERING" || s === "UNDER_STAGE2") return "D2";
  if (s === "UNDER_STAGE1") return "D3";
  if (s === "UNDER_FORMULATION") return "D4";
  if (s === "ONGOING") return "B2";   // fallback
  if (s === "CLOSED") return "B1";
  return "D4";
}

// =============================================================================
// Top-level component
// =============================================================================
export default function CapexWorkspace() {
  const { speakAndChat } = useMos();
  const [tab, setTab] = useState<TabKey>("BE");
  const [fy, setFy] = useState("2026-27");
  const [fyOptions, setFyOptions] = useState<string[]>(["2026-27"]);

  useEffect(() => {
    // ping
    fetch(`${API_BASE}/capex/ping`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => speakAndChat(`CAPEX backend reachable (${d.sprint})`, "ðŸ“¡"))
      .catch((e) => speakAndChat(`Cannot reach CAPEX backend: ${e.message}. Is uvicorn on :8002?`, "ðŸš¨"));
    // fy options
    fetch(`${API_BASE}/capex/fy-options`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.fy_options) && d.fy_options.length) {
          setFyOptions(d.fy_options);
          if (!d.fy_options.includes(fy)) setFy(d.fy_options[0]);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-8 text-white min-h-screen bg-[#050505]">
      <div className="flex items-end justify-between mb-6 bg-zinc-900/40 p-6 rounded-3xl border border-white/5 backdrop-blur-md">
        <div>
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">
            CAPEX COMMAND
          </h1>
          <div className="flex gap-3 mt-3 items-center">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Financial Year</label>
            <select value={fy} onChange={(e) => setFy(e.target.value)}
                    className="p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500 min-w-[110px]">
              {fyOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="inline-flex rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
          <TabButton active={tab === "BE"} onClick={() => setTab("BE")} icon={<LineChart size={14} />} label="BE Plan" color="cyan" />
          <TabButton active={tab === "RE"} onClick={() => setTab("RE")} icon={<RefreshCw size={14} />} label="RE Plan" color="amber" />
          <TabButton active={tab === "ACTUALS"} onClick={() => setTab("ACTUALS")} icon={<Wallet size={14} />} label="Actuals" color="emerald" />
          <TabButton active={tab === "SUMMARY"} onClick={() => setTab("SUMMARY")} icon={<BarChart2 size={14} />} label="Summary" color="violet" />
        </div>
      </div>

      {tab === "BE" && <PlanEditor key={`be-${fy}`} fy={fy} planType="BE" />}
      {tab === "RE" && <PlanEditor key={`re-${fy}`} fy={fy} planType="RE" />}
      {tab === "ACTUALS" && <ActualsEditor key={`act-${fy}`} fy={fy} />}
      {tab === "SUMMARY" && <CapexSummaryView fy={fy} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, color }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  color: "cyan" | "amber" | "emerald" | "violet";
}) {
  const bg = {
    cyan: "bg-cyan-500/20 text-cyan-300",
    amber: "bg-amber-500/20 text-amber-300",
    emerald: "bg-emerald-500/20 text-emerald-300",
    violet: "bg-violet-500/20 text-violet-300",
  }[color];
  return (
    <button onClick={onClick}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${active ? bg : "text-zinc-400 hover:text-zinc-200"}`}>
      {icon} {label}
    </button>
  );
}

// =============================================================================
// CAPEX Summary View — corporate all-schemes table
// =============================================================================
function CapexSummaryView({ fy }: { fy: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/dashboard/corporate-capex`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [fy]);

  if (loading) return <div className="py-20 text-center text-zinc-500 text-sm animate-pulse">Loading corporate CAPEX…</div>;
  if (!data) return <div className="py-20 text-center text-red-400 text-sm">Failed to load CAPEX summary.</div>;

  const types = ["ALL", ...Array.from(new Set<string>(data.schemes.map((s: any) => s.scheme_type)))];
  const filtered = data.schemes.filter((s: any) => {
    const matchSearch = !search || s.scheme_name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "ALL" || s.scheme_type === typeFilter;
    return matchSearch && matchType;
  });

  const fmt = (v: number) => v > 0 ? `₹${v.toFixed(2)}` : "—";

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Schemes", value: data.schemes.length, color: "text-zinc-300" },
          { label: "Portfolio Sanctioned", value: `₹${data.total.sanctioned_cost_cr.toFixed(0)} Cr`, color: "text-cyan-300" },
          { label: `BE — ${fy}`, value: `₹${data.total.be_fy.toFixed(2)} Cr`, color: "text-amber-300" },
          { label: `RE — ${fy}`, value: `₹${data.total.re_fy.toFixed(2)} Cr`, color: "text-blue-300" },
          { label: "Actuals FY", value: `₹${data.total.actuals_fy.toFixed(2)} Cr`, color: "text-emerald-300" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-white/5 bg-zinc-900/50 p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
            <div className={`text-lg font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scheme…"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/60 w-64"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/60">
          {types.map((t) => <option key={t} value={t}>{t === "ALL" ? "All Types" : t}</option>)}
        </select>
        <span className="text-xs text-zinc-500 ml-auto">{filtered.length} of {data.schemes.length} schemes</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/30 overflow-hidden backdrop-blur">
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="bg-zinc-900/80 sticky top-0">
              <tr>
                {["#", "Scheme Name", "Type", "Sanctioned (Cr)", "Till Last FY", "BE FY", "RE FY", "Actuals FY", "Total Spent", "% Spent", "Var vs BE"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wide whitespace-nowrap border-b border-zinc-800">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any, i: number) => (
                <tr key={s.scheme_id} className={`border-b border-zinc-800/40 hover:bg-zinc-800/30 ${i % 2 ? "bg-zinc-900/10" : ""}`}>
                  <td className="px-3 py-2 text-zinc-500 font-mono">{s.scheme_id}</td>
                  <td className="px-3 py-2 text-zinc-200 max-w-[260px] truncate" title={s.scheme_name}>{s.scheme_name}</td>
                  <td className="px-3 py-2 text-zinc-400 capitalize">{s.scheme_type}</td>
                  <td className="px-3 py-2 text-zinc-300 text-right font-mono">{fmt(s.sanctioned_cost_cr)}</td>
                  <td className="px-3 py-2 text-zinc-400 text-right font-mono">{fmt(s.cum_last_fy)}</td>
                  <td className="px-3 py-2 text-amber-400 text-right font-mono">{fmt(s.be_fy)}</td>
                  <td className="px-3 py-2 text-blue-400 text-right font-mono">{fmt(s.re_fy)}</td>
                  <td className="px-3 py-2 text-emerald-400 text-right font-mono">{fmt(s.actuals_fy)}</td>
                  <td className="px-3 py-2 text-violet-400 text-right font-mono">{fmt(s.total_spent)}</td>
                  <td className="px-3 py-2 text-right">
                    {s.pct_spent > 0 ? (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${s.pct_spent > 90 ? "bg-red-500/20 text-red-400" : s.pct_spent > 70 ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                        {s.pct_spent}%
                      </span>
                    ) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold font-mono ${s.variance_be < 0 ? "text-emerald-400" : s.variance_be > 0 ? "text-red-400" : "text-zinc-600"}`}>
                    {s.variance_be !== 0 ? (s.variance_be > 0 ? `+${s.variance_be}` : s.variance_be) : "—"}
                  </td>
                </tr>
              ))}
              {/* Portfolio total row */}
              <tr className="bg-zinc-800/40 font-bold border-t-2 border-zinc-600">
                <td className="px-3 py-2.5 text-zinc-200 uppercase tracking-wider" colSpan={3}>PORTFOLIO TOTAL</td>
                <td className="px-3 py-2.5 text-zinc-200 text-right font-mono">{fmt(data.total.sanctioned_cost_cr)}</td>
                <td className="px-3 py-2.5 text-zinc-400 text-right font-mono">{fmt(data.total.cum_last_fy)}</td>
                <td className="px-3 py-2.5 text-amber-300 text-right font-mono">{fmt(data.total.be_fy)}</td>
                <td className="px-3 py-2.5 text-blue-300 text-right font-mono">{fmt(data.total.re_fy)}</td>
                <td className="px-3 py-2.5 text-emerald-300 text-right font-mono">{fmt(data.total.actuals_fy)}</td>
                <td className="px-3 py-2.5 text-violet-300 text-right font-mono">{fmt(data.total.total_spent)}</td>
                <td className="px-3 py-2.5" colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Plan editor (BE & RE)
// =============================================================================
function PlanEditor({ fy, planType }: { fy: string; planType: PlanType }) {
  const { speakAndChat } = useMos();
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [planStatus, setPlanStatus] = useState("Draft");
  const [effMonth, setEffMonth] = useState<number>(10);
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);

  const isLocked = planStatus !== "Draft";
  const canEdit = !isLocked;
  const fieldKey: "be" | "re" = planType === "BE" ? "be" : "re";

  useEffect(() => { refreshPlanList(); /* eslint-disable-next-line */ }, []);

  const refreshPlanList = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const r = await fetch(`${API_BASE}/capex/plans?fy_year=${encodeURIComponent(fy)}&plan_type=${planType}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: PlanListItem[] = await r.json();
      setPlans(data);
      if (data.length > 0) loadPlan(data[0].id);
      else { setPlanId(null); setRows([]); setPlanStatus("Draft"); }
    } catch (e: any) {
      speakAndChat(`Couldn't load ${planType} plan: ${e.message}`, "âš ï¸");
    } finally { setLoadingPlans(false); }
    // eslint-disable-next-line
  }, [fy, planType]);

  const loadPlan = async (id: number) => {
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setPlanId(id);
      setPlanStatus(d.status || "Draft");
      setEffMonth(d.effMonth || 10);
      setRows(recomputeRollups((d.rows || []).map(serverRowToLocal)));
      setIsDirty(false);
    } catch (e: any) { speakAndChat(`Load failed: ${e.message}`, "âŒ"); }
  };

  const buildPayload = () => ({
    fy, planType, planVersion: "v1", status: planStatus,
    effMonth: planType === "RE" ? effMonth : null,
    rows: rows.map((r) => ({
      name: r.name, level: r.level, indent: r.indent,
      gross: r.gross, cumLast: r.cumLast, beFY: r.beFY, reFY: r.reFY, actualFY: r.actualFY,
      scheme_id: r.scheme_id ?? null,
      months: Object.fromEntries(Object.entries(r.months).map(([k, v]) => [k, { be: v.be, re: v.re, actual: v.actual }])),
    })),
  });

  const handleSave = async () => {
    if (isLocked) { alert("Locked. Use Override Unlock."); return; }
    if (rows.length === 0) { alert("Nothing to save."); return; }
    setIsSaving(true);
    try {
      const url = planId ? `${API_BASE}/capex/plans/${planId}` : `${API_BASE}/capex/plans`;
      const r = await fetch(url, {
        method: planId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(buildPayload()),
      });
      if (r.status === 409) {
        const d = await r.json().catch(() => ({}));
        alert(d.detail || `A ${planType} plan already exists for ${fy}.`);
        refreshPlanList();
        return;
      }
      if (r.status === 423) { const d = await r.json().catch(() => ({})); alert(d.detail || "Locked."); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const saved = await r.json();
      setPlanId(saved.header?.id ?? planId);
      setPlanStatus(saved.status || "Draft");
      setRows(recomputeRollups((saved.rows || []).map(serverRowToLocal)));
      setIsDirty(false);
      speakAndChat(`${planType} plan saved`, "ðŸ’¾");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Save failed: ${e.message}`, "âŒ");
      alert(`Save failed:\n\n${e.message}`);
    } finally { setIsSaving(false); }
  };

  const handleApprove = async () => {
    if (!planId) { alert("Save first."); return; }
    if (isDirty && confirm("Save unsaved changes first?")) await handleSave();
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${planId}/approve`, { method: "POST", headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlanStatus("Approved"); speakAndChat("Plan approved & locked", "ðŸ”’"); refreshPlanList();
    } catch (e: any) { speakAndChat(`Approve failed: ${e.message}`, "âŒ"); }
  };

  const handleOverrideUnlock = async () => {
    if (!planId) return;
    if (!confirm("Override unlock this approved plan back to Draft?")) return;
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${planId}/unlock`, { method: "POST", headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlanStatus("Draft"); speakAndChat("Override unlock â€” now editable", "ðŸ”“"); refreshPlanList();
    } catch (e: any) { speakAndChat(`Unlock failed: ${e.message}`, "âŒ"); }
  };

  const handleNewPlan = () => {
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    setPlanId(null); setPlanStatus("Draft"); setRows([]); setIsDirty(false);
  };

  // Import schemes â†’ build full A/B/C/D hierarchy with package sub-rows
  const handleImport = async () => {
    if (isLocked) { alert("Locked."); return; }
    try {
      const r = await fetch(`${API_BASE}/capex/import-source`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { schemes } = await r.json();

      // For BE of a new FY, fetch rollover so cumulative-till-last-FY auto-fills
      let rollover: Record<string, number> = {};
      if (planType === "BE") {
        try {
          const rr = await fetch(`${API_BASE}/capex/rollover/${encodeURIComponent(fy)}`);
          if (rr.ok) {
            const rd = await rr.json();
            rollover = rd.by_scheme || {};
            if (rd.note) speakAndChat(rd.note, "â†©ï¸");
          }
        } catch { /* rollover is best-effort */ }
      }

      const scaffold = buildHeaderScaffold();
      const bucketed: Record<string, any[]> = {};
      schemes.forEach((s: any) => {
        const bucket = classifyScheme(s.scheme_type, s.current_status);
        (bucketed[bucket] = bucketed[bucket] || []).push(s);
      });

      const out: CapexRow[] = [];
      const pushHeader = (h: { name: string; level: RowLevel; indent: number }) =>
        out.push({ id: `h_${h.name}`, name: h.name, level: h.level, indent: h.indent,
          gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0, months: getEmptyMonths(), isEditable: false });

      for (const h of scaffold) {
        pushHeader(h);
        const schemesHere = bucketed[h.key] || [];
        const itemIndent = h.indent + 1;
        for (const s of schemesHere) {
          const cumFromRollover = rollover[String(s.scheme_id)] ?? 0;
          const hasPkgs = (s.packages || []).length > 0;
          out.push({
            id: `sch_${s.scheme_id}`, name: s.scheme_name || "Unnamed", level: "Item", indent: itemIndent,
            gross: Number(s.sanctioned_cost_cr) || Number(s.estimated_cost_cr) || 0,
            cumLast: hasPkgs ? 0 : cumFromRollover,
            beFY: 0, reFY: 0, actualFY: 0, scheme_id: s.scheme_id,
            months: getEmptyMonths(), isEditable: !hasPkgs,
          });
          // Package sub-rows
          for (const p of (s.packages || [])) {
            out.push({
              id: `pkg_${p.package_id}`, name: `  ${p.package_no ? p.package_no + ". " : ""}${p.package_name}`,
              level: "Package", indent: itemIndent + 1,
              gross: Number(p.package_value_cr) || Number(p.package_estimate_cr) || 0,
              cumLast: 0, beFY: 0, reFY: 0, actualFY: 0, scheme_id: s.scheme_id,
              months: getEmptyMonths(), isEditable: true,
            });
          }
        }
      }

      setRows(recomputeRollups(out));
      setIsDirty(true);
      speakAndChat(`Imported ${schemes.length} schemes into A/B/C/D headers`, "âœ…");
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    }
  };

  // Cell + month editors
  const handleCellEdit = (i: number, f: "gross" | "cumLast", v: string) => {
    if (!rows[i].isEditable || !canEdit) return;
    const next = [...rows]; next[i][f] = Number(v) || 0;
    setRows(recomputeRollups(next)); setIsDirty(true);
  };
  const handleMonthEdit = (i: number, m: number, v: string) => {
    if (!rows[i].isEditable || !canEdit) return;
    // RE pre-effective months are auto-filled from actuals â†’ not user editable
    if (planType === "RE" && rows[i].months[m]?._re_auto_filled) {
      speakAndChat("Pre-effective RE auto-fills from Actuals â€” not editable", "ðŸ”’");
      return;
    }
    const next = [...rows]; next[i].months[m][fieldKey] = Number(v) || 0;
    setRows(recomputeRollups(next)); setIsDirty(true);
  };

  const handleIndent = (i: number) => {
    if (!canEdit || i === 0) return;
    const next = [...rows];
    if (next[i].indent < 3 && next[i].indent < next[i - 1].indent + 1) {
      next[i].indent += 1;
      next[i].level = (["Header","SubHeader","Item","Package"] as RowLevel[])[Math.min(next[i].indent, 3)];
      next[i].isEditable = next[i].level === "Item" || next[i].level === "Package";
      setRows(recomputeRollups(next)); setIsDirty(true);
    }
  };
  const handleOutdent = (i: number) => {
    if (!canEdit || rows[i].indent === 0) return;
    const next = [...rows]; next[i].indent -= 1;
    next[i].level = (["Header","SubHeader","Item","Package"] as RowLevel[])[Math.min(next[i].indent, 3)];
    next[i].isEditable = next[i].level === "Item" || next[i].level === "Package";
    setRows(recomputeRollups(next)); setIsDirty(true);
  };
  const moveRow = (i: number, d: "up" | "down") => {
    if (!canEdit) return;
    if (d === "up" && i === 0) return;
    if (d === "down" && i === rows.length - 1) return;
    const next = [...rows]; const j = d === "up" ? i - 1 : i + 1;
    [next[i], next[j]] = [next[j], next[i]];
    setRows(recomputeRollups(next)); setIsDirty(true);
  };
  const handleDelete = (i: number) => {
    if (!canEdit) return;
    if (!confirm(`Delete "${rows[i].name}"?`)) return;
    setRows(recomputeRollups(rows.filter((_, x) => x !== i))); setIsDirty(true);
  };

  const isRowVisible = (i: number) => {
    for (let k = i - 1; k >= 0; k--) {
      if (rows[k].indent < rows[i].indent && expanded[rows[k].id] === false) return false;
    }
    return true;
  };

  const accent = planType === "BE" ? "text-cyan-400" : "text-amber-400";
  const accentBorder = planType === "BE" ? "focus:border-cyan-500/50" : "focus:border-amber-500/50";

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 p-4 bg-zinc-900/30 border border-white/5 rounded-2xl backdrop-blur flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{planType} Plan Â· {fy}</span>
        {plans.length > 0 && (
          <select value={planId ?? ""} onChange={(e) => { const v = parseInt(e.target.value); if (Number.isFinite(v)) loadPlan(v); }}
                  className="p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none min-w-[200px]">
            {plans.map((p) => <option key={p.id} value={p.id}>#{p.id} Â· {p.plan_status} ({p.row_count} rows)</option>)}
          </select>
        )}
        <button onClick={refreshPlanList} title="Refresh" className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10">
          <RefreshCw size={12} className={loadingPlans ? "animate-spin" : ""} />
        </button>
        {planId && (
          <button onClick={handleNewPlan} className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center gap-1">
            <Plus size={12} /> New
          </button>
        )}

        {planType === "RE" && (
          <select value={effMonth} onChange={(e) => { setEffMonth(Number(e.target.value)); setIsDirty(true); }}
                  disabled={isLocked}
                  className="p-1.5 text-xs rounded-lg bg-black/50 border border-amber-500/50 text-amber-400 outline-none">
            {FY_MONTH_ORDER.map((m, i) => <option key={m} value={m}>Effective: {MONTH_LABELS[i]}</option>)}
          </select>
        )}

        <div className="px-3 py-1.5 bg-zinc-950 rounded-lg text-xs font-bold border border-white/5">
          Status: <span className={planStatus === "Draft" ? "text-amber-400" : planStatus === "Approved" ? "text-emerald-400" : "text-zinc-400"}>{planStatus}</span>
        </div>
        {isDirty && <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">unsaved</span>}

        <button onClick={() => setShowCumulative((v) => !v)}
                className={`px-2 py-1.5 text-xs rounded-lg border flex items-center gap-1 ${showCumulative ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" : "bg-zinc-800 text-zinc-400 border-white/10"}`}>
          <History size={12} /> Cumulative
        </button>

        <div className="flex-1" />

        <button onClick={handleImport} disabled={isLocked}
                className="flex items-center gap-2 px-3 py-1.5 bg-white text-black rounded-lg font-bold hover:bg-cyan-400 text-xs disabled:opacity-50">
          <ArrowDownToLine size={12} /> Import Schemes
        </button>
        <button onClick={handleSave} disabled={isSaving || isLocked}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-lg flex items-center gap-2 text-xs disabled:opacity-50">
          <Save size={12} /> {isSaving ? "Saving..." : "Save"}
        </button>
        {planStatus === "Draft" ? (
          <button onClick={handleApprove}
                  className="px-3 py-1.5 text-xs bg-purple-900/40 hover:bg-purple-800 text-purple-400 rounded-lg flex items-center gap-2 border border-purple-500/20">
            <Lock size={12} /> Approve & Lock
          </button>
        ) : (
          <button onClick={handleOverrideUnlock}
                  className="px-3 py-1.5 text-xs bg-rose-900/40 hover:bg-rose-800 text-rose-300 rounded-lg flex items-center gap-2 border border-rose-500/20">
            <Unlock size={12} /> Override Unlock
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="bg-zinc-900/30 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-2xl">
        {rows.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-zinc-400 mb-2">No {planType} plan for {fy} yet.</p>
            <button onClick={handleImport} disabled={isLocked}
                    className="px-6 py-3 bg-white text-black rounded-xl font-bold hover:bg-cyan-400 disabled:opacity-50">
              Import Schemes
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <th className="p-3 sticky left-0 bg-[#0c0c0c] z-30">Hierarchy</th>
                  <th className="p-3 text-right">Gross</th>
                  <th className="p-3 text-right">Cum. till last FY</th>
                  <th className={`p-3 text-right ${accent}`}>{planType} FY Total</th>
                  {FY_MONTH_ORDER.map((m, i) => (
                    <th key={m} className="p-2 text-center bg-zinc-800/20 border-l border-white/5">{MONTH_LABELS[i]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (!isRowVisible(i)) return null;
                  const isParent = row.level === "Header" || row.level === "SubHeader"
                    || (row.level === "Item" && i + 1 < rows.length && rows[i + 1].indent > row.indent);
                  const isExpanded = expanded[row.id] !== false;
                  return (
                    <tr key={row.id} onMouseEnter={() => setHoveredRow(row.id)} onMouseLeave={() => setHoveredRow(null)}
                        className={`border-b border-white/[0.03] hover:bg-white/[0.02] relative ${row.level === "Header" ? "bg-zinc-900/50" : row.level === "Package" ? "bg-white/[0.01]" : ""}`}>
                      <td className="p-2.5 sticky left-0 bg-[#0c0c0c] z-20 border-r border-white/5" style={{ paddingLeft: `${row.indent * 1.3 + 0.75}rem` }}>
                        <div className="flex items-center gap-2">
                          {isParent ? (
                            <button onClick={() => setExpanded((e) => ({ ...e, [row.id]: !isExpanded }))} className="text-cyan-500">
                              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          ) : <div className="w-3" />}
                          <span className={
                            row.level === "Header" ? "text-white font-bold" :
                            row.level === "SubHeader" ? "text-zinc-300 font-semibold text-sm" :
                            row.level === "Package" ? "text-zinc-500 text-xs italic" : "text-zinc-400 text-sm"
                          }>{row.name}</span>
                          {row.level === "Package" && <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-500">pkg</span>}
                        </div>
                        <AnimatePresence>
                          {hoveredRow === row.id && canEdit && (
                            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                                        className="absolute left-[100%] top-1/2 -translate-y-1/2 ml-2 flex gap-1 bg-zinc-800 p-1 rounded-xl border border-white/10 shadow-2xl z-50">
                              <button onClick={() => handleIndent(i)} className="p-1.5 hover:bg-cyan-600 rounded text-zinc-300"><Indent size={12} /></button>
                              <button onClick={() => handleOutdent(i)} className="p-1.5 hover:bg-cyan-600 rounded text-zinc-300"><Outdent size={12} /></button>
                              <button onClick={() => moveRow(i, "up")} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-300"><ArrowUp size={12} /></button>
                              <button onClick={() => moveRow(i, "down")} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-300"><ArrowDown size={12} /></button>
                              <button onClick={() => handleDelete(i)} className="p-1.5 hover:bg-red-600/40 text-red-400 rounded"><Trash2 size={12} /></button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </td>
                      <td className="p-2 text-right">
                        {row.isEditable && canEdit ? (
                          <input type="number" value={row.gross || ""} onChange={(e) => handleCellEdit(i, "gross", e.target.value)}
                                 className={`w-20 bg-zinc-950 border border-zinc-700 rounded-md p-1 text-right text-xs font-mono outline-none ${accentBorder}`} />
                        ) : <span className="text-zinc-400 font-mono text-xs">â‚¹{row.gross.toFixed(2)}</span>}
                      </td>
                      <td className="p-2 text-right">
                        {row.isEditable && canEdit ? (
                          <input type="number" value={row.cumLast || ""} onChange={(e) => handleCellEdit(i, "cumLast", e.target.value)}
                                 className={`w-20 bg-zinc-950 border border-zinc-700 rounded-md p-1 text-right text-xs font-mono outline-none ${accentBorder}`} />
                        ) : <span className="text-zinc-500 font-mono text-xs">â‚¹{row.cumLast.toFixed(2)}</span>}
                      </td>
                      <td className={`p-2 text-right font-mono text-xs font-bold ${accent}`}>
                        â‚¹{(planType === "BE" ? row.beFY : row.reFY).toFixed(2)}
                      </td>
                      {FY_MONTH_ORDER.map((m) => {
                        const mv = row.months[m];
                        const autoFilled = planType === "RE" && mv?._re_auto_filled;
                        const cum = showCumulative && row.isEditable
                          ? cumulativeThrough(row, m, fieldKey) : null;
                        return (
                          <td key={m} className="p-1.5 border-l border-white/5">
                            <input type="number"
                                   disabled={!row.isEditable || !canEdit || autoFilled}
                                   value={mv?.[fieldKey] || ""}
                                   onChange={(e) => handleMonthEdit(i, m, e.target.value)}
                                   title={autoFilled ? "Auto-filled from Actual (pre-effective RE)" : ""}
                                   className={`w-14 rounded-md p-1 text-xs text-center font-mono outline-none disabled:opacity-40 ${
                                     autoFilled ? "bg-amber-950/40 border border-amber-500/20 text-amber-300/70" : `bg-zinc-950/50 border border-white/5 ${accent} ${accentBorder}`
                                   }`} />
                            {cum !== null && (
                              <div className="text-[8px] text-indigo-400/70 text-center font-mono mt-0.5">Î£{cum.toFixed(1)}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {planType === "RE" && (
        <p className="mt-3 text-xs text-zinc-500 flex items-center gap-1.5">
          <Sparkles size={12} className="text-amber-400" />
          RE rule: months before the effective month auto-fill from Actuals (amber cells, locked). Cumulative = Actuals till effective + RE after.
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Actuals editor (unchanged structure from Half A, supports Package rows)
// =============================================================================
function ActualsEditor({ fy }: { fy: string }) {
  const { speakAndChat } = useMos();
  const [selectedMonth, setSelectedMonth] = useState<number>(FY_MONTH_ORDER[0]);
  const [data, setData] = useState<{ rows: ActualsRow[]; locked_months: number[]; plan_id?: number; plan_type?: string; plan_version?: string; note?: string }>({ rows: [], locked_months: [] });
  const [loading, setLoading] = useState(false);
  const isLocked = data.locked_months.includes(selectedMonth);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/capex/actuals?fy_year=${encodeURIComponent(fy)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      if (d.note) speakAndChat(d.note, "â„¹ï¸");
    } catch (e: any) { speakAndChat(`Couldn't load actuals: ${e.message}`, "âŒ"); }
    finally { setLoading(false); }
    // eslint-disable-next-line
  }, [fy]);
  useEffect(() => { load(); }, [load]);

  const saveCell = async (row_id: number, amount: number) => {
    if (isLocked) { alert(`${monthLabel(selectedMonth)} is locked.`); return; }
    try {
      const r = await fetch(`${API_BASE}/capex/actuals/cell`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ plan_row_id: row_id, month_no: selectedMonth, amount, fy_year: fy }),
      });
      if (r.status === 423) { const d = await r.json().catch(() => ({})); alert(d.detail || "Locked."); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      setData((p) => ({ ...p, rows: p.rows.map((row) => row.row_id === row_id ? { ...row, months: { ...row.months, [String(selectedMonth)]: amount } } : row) }));
    } catch (e: any) { speakAndChat(`Cell save failed: ${e.message}`, "âŒ"); }
  };

  const toggleLock = async () => {
    try {
      if (isLocked) {
        const r = await fetch(`${API_BASE}/capex/locks/${encodeURIComponent(fy)}/${selectedMonth}`, { method: "DELETE", headers: authHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        speakAndChat(`${monthLabel(selectedMonth)} unlocked`, "ðŸ”“");
      } else {
        if (!confirm(`Lock ${monthLabel(selectedMonth)}? No further actuals until unlocked.`)) return;
        const r = await fetch(`${API_BASE}/capex/locks`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ fy_year: fy, month_no: selectedMonth }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        speakAndChat(`${monthLabel(selectedMonth)} locked`, "ðŸ”’");
      }
      load();
    } catch (e: any) { speakAndChat(`Lock toggle failed: ${e.message}`, "âŒ"); }
  };

  // Running cumulative across the selected + prior months (FY order)
  const cumulativeForRow = (row: ActualsRow): number => {
    let sum = 0;
    for (const m of FY_MONTH_ORDER) { sum += row.months[String(m)] || 0; if (m === selectedMonth) break; }
    return sum;
  };

  return (
    <div>
      <div className="mb-4 p-4 bg-zinc-900/30 border border-white/5 rounded-2xl backdrop-blur flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-1.5"><CalendarDays size={12} /> Month</span>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="p-1.5 text-xs rounded-lg bg-black/50 border border-emerald-500/40 outline-none min-w-[130px]">
          {FY_MONTH_ORDER.map((m, i) => <option key={m} value={m}>{MONTH_LABELS[i]} {data.locked_months.includes(m) ? "ðŸ”’" : ""}</option>)}
        </select>
        {data.plan_id && <span className="text-xs text-zinc-500">plan #{data.plan_id} ({data.plan_type})</span>}
        <button onClick={load} disabled={loading} className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10"><RefreshCw size={12} className={loading ? "animate-spin" : ""} /></button>
        <div className="flex-1" />
        {isLocked
          ? <span className="px-3 py-1.5 text-xs bg-rose-500/10 text-rose-300 border border-rose-500/30 rounded-lg flex items-center gap-1.5"><Lock size={12} /> {monthLabel(selectedMonth)} locked</span>
          : <span className="px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-lg flex items-center gap-1.5"><Unlock size={12} /> editable</span>}
        <button onClick={toggleLock}
                className="px-3 py-1.5 text-xs bg-amber-900/40 hover:bg-amber-800 text-amber-300 rounded-lg flex items-center gap-2 border border-amber-500/20">
          {isLocked ? <Unlock size={12} /> : <Lock size={12} />} {isLocked ? "Unlock month" : "Lock month"}
        </button>
      </div>

      <div className="bg-zinc-900/30 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-2xl">
        {data.rows.length === 0 ? (
          <div className="p-16 text-center text-zinc-500">{data.note || "No CAPEX plan rows for this FY. Create a BE plan first."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <th className="p-4">Scheme / Package</th>
                  <th className="p-4 text-right">Actual {monthLabel(selectedMonth)} (â‚¹ Cr)</th>
                  <th className="p-4 text-right text-indigo-400">Cumulative till {monthLabel(selectedMonth)}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <ActualRow key={row.row_id} row={row} selectedMonth={selectedMonth} disabled={isLocked}
                             cumulative={cumulativeForRow(row)} onSave={(amt) => saveCell(row.row_id, amt)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ActualRow({ row, selectedMonth, disabled, cumulative, onSave }: {
  row: ActualsRow; selectedMonth: number; disabled: boolean; cumulative: number; onSave: (amount: number) => void;
}) {
  const value = row.months[String(selectedMonth)] || 0;
  const [local, setLocal] = useState(String(value || ""));
  useEffect(() => { setLocal(String(value || "")); }, [value, selectedMonth]);
  const commit = () => { const n = Number(local); if (Number.isFinite(n) && n !== value) onSave(n); };
  const isPkg = row.row_level === "Package";
  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02]">
      <td className="p-3 text-sm" style={{ paddingLeft: `${row.indent * 1.3 + 1}rem` }}>
        <span className={isPkg ? "text-zinc-500 text-xs italic" : "text-zinc-300"}>{row.row_name}</span>
        {row.scheme_id != null && !isPkg && <span className="ml-2 text-[10px] text-zinc-600 font-mono">#{row.scheme_id}</span>}
        {isPkg && <span className="ml-2 text-[9px] px-1 rounded bg-zinc-800 text-zinc-500">pkg</span>}
      </td>
      <td className="p-3 text-right">
        <input type="number" value={local} disabled={disabled}
               onChange={(e) => setLocal(e.target.value)} onBlur={commit}
               onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
               placeholder="0.00"
               className={`w-28 bg-zinc-950 border rounded-md p-1.5 text-right font-mono text-sm outline-none ${disabled ? "border-zinc-800 opacity-50" : "border-zinc-700 focus:border-emerald-400 text-emerald-300"}`} />
      </td>
      <td className="p-3 text-right font-mono text-sm text-indigo-300">â‚¹{cumulative.toFixed(2)}</td>
    </tr>
  );
}

function monthLabel(m: number): string {
  const i = FY_MONTH_ORDER.indexOf(m);
  return i >= 0 ? MONTH_LABELS[i] : `M${m}`;
}

