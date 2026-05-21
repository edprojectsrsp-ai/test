"use client";
import { useState, useEffect, useCallback } from "react";
import { useMos } from "@/components/brain/MosContext";
import {
  Save, Plus, ArrowDownToLine, Lock, Unlock,
  Indent, Outdent, ArrowUp, ArrowDown, ShieldAlert,
  ChevronDown, ChevronRight, Trash2, RefreshCw, Copy,
  CalendarDays, LineChart, Wallet,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = "http://localhost:8000/api/v1";

// =============================================================================
// Types
// =============================================================================
type MonthValue = { be: number; re: number; actual: number };
type RowLevel = "Header" | "SubHeader" | "Item";
type PlanType = "BE" | "RE";
type TabKey = "BE" | "RE" | "ACTUALS";

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
  id: number;
  fy_year: string;
  plan_type: string;
  plan_version: string | null;
  plan_status: string;
  is_effective: boolean;
  effective_from_month: number | null;
  created_by: string | null;
  created_at: string | null;
  row_count: number;
};

type ActualsRow = {
  row_id: number;
  row_name: string;
  scheme_id: number | null;
  indent: number;
  months: Record<string, number>;
};

const MONTH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep",
                      "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
// month_no convention: 1=Jan...12=Dec; FY runs Apr(4) → Mar(3)
const FY_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

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
  const token = localStorage.getItem("brain_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getCurrentRole(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("brain_token");
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.role || null;
  } catch {
    return null;
  }
}

function recomputeRollups(rows: CapexRow[]): CapexRow[] {
  const out = [...rows];
  // Items: derive beFY/actualFY from months
  for (let i = 0; i < out.length; i++) {
    if (out[i].level !== "Item") continue;
    let be = 0, act = 0;
    for (let m = 1; m <= 12; m++) {
      const mv = out[i].months[m];
      if (mv) { be += mv.be || 0; act += mv.actual || 0; }
    }
    out[i].beFY = be;
    out[i].actualFY = act;
  }
  // Parents: sum direct children
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].level === "Item") continue;
    out[i].gross = 0; out[i].cumLast = 0; out[i].beFY = 0; out[i].actualFY = 0;
    const target = out[i].indent + 1;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].indent <= out[i].indent) break;
      if (out[j].indent === target) {
        out[i].gross += Number(out[j].gross) || 0;
        out[i].cumLast += Number(out[j].cumLast) || 0;
        out[i].beFY += Number(out[j].beFY) || 0;
        out[i].actualFY += Number(out[j].actualFY) || 0;
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
        months[m] = { be: Number(v.be) || 0, re: Number(v.re) || 0, actual: Number(v.actual) || 0 };
      }
    }
  }
  return {
    id: r.id, row_id: r.row_id,
    name: r.name, level: r.level as RowLevel, indent: r.indent || 0,
    gross: Number(r.gross) || 0, cumLast: Number(r.cumLast) || 0,
    beFY: Number(r.beFY) || 0, reFY: Number(r.reFY) || 0, actualFY: Number(r.actualFY) || 0,
    scheme_id: r.scheme_id ?? null, months,
    isEditable: r.isEditable !== false && r.level === "Item",
  };
}

// =============================================================================
// Main component
// =============================================================================
export default function CapexWorkspace() {
  const { speakAndChat } = useMos();
  const [tab, setTab] = useState<TabKey>("BE");
  const [fy, setFy] = useState("2026-27");
  const role = getCurrentRole();
  const isAdmin = role === "admin";

  // Ping on mount — surfaces "fail to fetch" immediately with a friendly toast
  useEffect(() => {
    fetch(`${API_BASE}/capex/ping`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        speakAndChat(`CAPEX backend reachable (${d.sprint})`, "📡");
      })
      .catch((e) => {
        speakAndChat(
          `Cannot reach CAPEX backend: ${e.message}. Is uvicorn running on :8000?`,
          "🚨",
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-8 text-white min-h-screen bg-[#050505]">
      {/* Top bar — shared across all tabs */}
      <div className="flex items-end justify-between mb-6 bg-zinc-900/40 p-6 rounded-3xl border border-white/5 backdrop-blur-md">
        <div>
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">
            CAPEX COMMAND
          </h1>
          <div className="flex gap-3 mt-3 items-center">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">FY</label>
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500"
            >
              <option>2026-27</option>
              <option>2027-28</option>
              <option>2025-26</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="inline-flex rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
          <TabButton
            active={tab === "BE"} onClick={() => setTab("BE")}
            icon={<LineChart size={14} />} label="BE Plan" color="cyan"
          />
          <TabButton
            active={tab === "RE"} onClick={() => setTab("RE")}
            icon={<RefreshCw size={14} />} label="RE Plan" color="amber"
          />
          <TabButton
            active={tab === "ACTUALS"} onClick={() => setTab("ACTUALS")}
            icon={<Wallet size={14} />} label="Actuals" color="emerald"
          />
        </div>
      </div>

      {tab === "BE" && <PlanEditor fy={fy} planType="BE" isAdmin={isAdmin} />}
      {tab === "RE" && <PlanEditor fy={fy} planType="RE" isAdmin={isAdmin} />}
      {tab === "ACTUALS" && <ActualsEditor fy={fy} isAdmin={isAdmin} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, color }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  color: "cyan" | "amber" | "emerald";
}) {
  const activeBg = {
    cyan: "bg-cyan-500/20 text-cyan-300",
    amber: "bg-amber-500/20 text-amber-300",
    emerald: "bg-emerald-500/20 text-emerald-300",
  }[color];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
        active ? activeBg : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon} {label}
    </button>
  );
}

// =============================================================================
// Plan editor — reused for both BE and RE tabs
// =============================================================================
function PlanEditor({ fy, planType, isAdmin }: {
  fy: string; planType: PlanType; isAdmin: boolean;
}) {
  const { speakAndChat } = useMos();
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [planVersion, setPlanVersion] = useState("v1");
  const [planStatus, setPlanStatus] = useState("Draft");
  const [effMonth, setEffMonth] = useState<number>(10);
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const isLocked = planStatus !== "Draft";
  const canEditRows = !isLocked;

  // Reset state when tab (planType) or FY changes
  useEffect(() => {
    setPlans([]); setPlanId(null); setRows([]);
    setPlanStatus("Draft"); setIsDirty(false);
    refreshPlanList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planType, fy]);

  const refreshPlanList = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const url = `${API_BASE}/capex/plans?fy_year=${encodeURIComponent(fy)}&plan_type=${planType}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: PlanListItem[] = await r.json();
      setPlans(data);
      if (data.length > 0) loadPlan(data[0].id);
    } catch (e: any) {
      speakAndChat(`Couldn't load ${planType} plans: ${e.message}`, "⚠️");
    } finally {
      setLoadingPlans(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, planType]);

  const loadPlan = async (id: number) => {
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPlanId(id);
      setPlanVersion(data.planVersion || "v1");
      setPlanStatus(data.status || "Draft");
      setEffMonth(data.effMonth || 10);
      setRows(recomputeRollups((data.rows || []).map(serverRowToLocal)));
      setIsDirty(false);
    } catch (e: any) {
      speakAndChat(`Failed to load plan: ${e.message}`, "❌");
    }
  };

  const buildPayload = () => ({
    fy, planType, planVersion, status: planStatus,
    effMonth: planType === "RE" ? effMonth : null,
    rows: rows.map((r) => ({
      name: r.name, level: r.level, indent: r.indent,
      gross: r.gross, cumLast: r.cumLast, beFY: r.beFY, reFY: r.reFY, actualFY: r.actualFY,
      scheme_id: r.scheme_id ?? null,
      months: Object.fromEntries(
        Object.entries(r.months).map(([k, v]) => [k, { be: v.be, re: v.re, actual: v.actual }]),
      ),
    })),
  });

  const handleSave = async () => {
    if (isLocked) { alert("Plan is locked. Ask an admin to unlock."); return; }
    if (rows.length === 0) { alert("Nothing to save."); return; }
    setIsSaving(true);
    try {
      const url = planId ? `${API_BASE}/capex/plans/${planId}` : `${API_BASE}/capex/plans`;
      const r = await fetch(url, {
        method: planId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(buildPayload()),
      });
      if (r.status === 423) {
        const d = await r.json().catch(() => ({}));
        alert(d.detail || "Plan locked.");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const saved = await r.json();
      setPlanId(saved.header?.id ?? planId);
      setPlanStatus(saved.status || "Draft");
      setIsDirty(false);
      speakAndChat(`${planType} plan saved`, "💾");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Save failed: ${e.message}`, "❌");
      alert(`Save failed:\n\n${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!planId) { alert("Save first."); return; }
    if (isDirty && confirm("Save unsaved changes first?")) await handleSave();
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${planId}/approve`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlanStatus("Approved");
      speakAndChat("Plan approved", "🔒");
      refreshPlanList();
    } catch (e: any) { speakAndChat(`Approve failed: ${e.message}`, "❌"); }
  };

  const handleUnlock = async () => {
    if (!planId || !isAdmin) return;
    if (!confirm("Unlock plan back to Draft?")) return;
    try {
      const r = await fetch(`${API_BASE}/capex/plans/${planId}/unlock`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlanStatus("Draft");
      speakAndChat("Plan unlocked", "🔓");
      refreshPlanList();
    } catch (e: any) { speakAndChat(`Unlock failed: ${e.message}`, "❌"); }
  };

  const handleNewPlan = () => {
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    setPlanId(null); setPlanVersion("v1"); setPlanStatus("Draft");
    setRows([]); setIsDirty(false);
  };

  const handleImportSchemes = async () => {
    if (isLocked) { alert("Plan locked."); return; }
    try {
      const r = await fetch(`${API_BASE}/schemes/all`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const schemes = await r.json();
      const imported: CapexRow[] = [{
        id: "hA", name: "A. Imported Schemes", level: "Header", indent: 0,
        gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
        months: getEmptyMonths(), isEditable: false,
      }];
      schemes.forEach((s: any) => {
        imported.push({
          id: `sch_${s.scheme_id}`,
          name: s.scheme_name || "Unnamed",
          level: "Item", indent: 1,
          gross: Number(s.sanctioned_cost_cr) || Number(s.estimated_cost_cr) || 0,
          cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
          scheme_id: s.scheme_id,
          months: getEmptyMonths(),
          isEditable: true,
        });
      });
      setRows(recomputeRollups(imported));
      setIsDirty(true);
      speakAndChat(`Imported ${schemes.length} schemes`, "✅");
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    }
  };

  const handleCellEdit = (i: number, field: "gross" | "cumLast", v: string) => {
    if (!rows[i].isEditable || !canEditRows) return;
    const next = [...rows];
    next[i][field] = Number(v) || 0;
    setRows(recomputeRollups(next));
    setIsDirty(true);
  };

  const handleMonthEdit = (i: number, m: number, kind: "be" | "re", v: string) => {
    if (!rows[i].isEditable || !canEditRows) return;
    const next = [...rows];
    next[i].months[m][kind] = Number(v) || 0;
    setRows(recomputeRollups(next));
    setIsDirty(true);
  };

  const handleIndent = (i: number) => {
    if (!canEditRows || i === 0) return;
    const next = [...rows];
    if (next[i].indent < 2 && next[i].indent < next[i - 1].indent + 1) {
      next[i].indent += 1;
      next[i].level = next[i].indent === 0 ? "Header" : next[i].indent === 1 ? "SubHeader" : "Item";
      next[i].isEditable = next[i].level === "Item";
      setRows(recomputeRollups(next));
      setIsDirty(true);
    }
  };

  const handleOutdent = (i: number) => {
    if (!canEditRows || rows[i].indent === 0) return;
    const next = [...rows];
    next[i].indent -= 1;
    next[i].level = next[i].indent === 0 ? "Header" : next[i].indent === 1 ? "SubHeader" : "Item";
    next[i].isEditable = next[i].level === "Item";
    setRows(recomputeRollups(next));
    setIsDirty(true);
  };

  const moveRow = (i: number, dir: "up" | "down") => {
    if (!canEditRows) return;
    if (dir === "up" && i === 0) return;
    if (dir === "down" && i === rows.length - 1) return;
    const next = [...rows];
    const j = dir === "up" ? i - 1 : i + 1;
    [next[i], next[j]] = [next[j], next[i]];
    setRows(recomputeRollups(next));
    setIsDirty(true);
  };

  const handleDeleteRow = (i: number) => {
    if (!canEditRows) return;
    if (!confirm(`Delete row "${rows[i].name}"?`)) return;
    setRows(recomputeRollups(rows.filter((_, x) => x !== i)));
    setIsDirty(true);
  };

  const isRowVisible = (i: number) => {
    for (let k = i - 1; k >= 0; k--) {
      if (rows[k].indent < rows[i].indent) {
        if (expanded[rows[k].id] === false) return false;
      }
    }
    return true;
  };

  const planColor = planType === "BE" ? "cyan" : "amber";
  const accentClass = planType === "BE" ? "text-cyan-400" : "text-amber-400";

  return (
    <div>
      {/* Plan picker + actions row */}
      <div className="mb-4 p-4 bg-zinc-900/30 border border-white/5 rounded-2xl backdrop-blur flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-bold">{planType} Plans</span>
        <select
          value={planId ?? ""}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (Number.isFinite(v)) loadPlan(v);
          }}
          disabled={loadingPlans}
          className={`p-1.5 text-xs rounded-lg bg-black/50 border border-${planColor}-500/40 outline-none focus:border-${planColor}-400 min-w-[280px]`}
        >
          <option value="">— Select or create new —</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id} · {p.plan_version} · {p.plan_status} ({p.row_count} rows)
            </option>
          ))}
        </select>
        <button onClick={refreshPlanList} title="Refresh"
                className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10">
          <RefreshCw size={12} className={loadingPlans ? "animate-spin" : ""} />
        </button>
        <button onClick={handleNewPlan}
                className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center gap-1">
          <Plus size={12} /> New
        </button>

        {planType === "RE" && (
          <select value={effMonth} onChange={(e) => { setEffMonth(Number(e.target.value)); setIsDirty(true); }}
                  disabled={isLocked}
                  className="p-1.5 text-xs rounded-lg bg-black/50 border border-amber-500/50 text-amber-400 outline-none">
            {FY_MONTH_ORDER.map((m, i) => (
              <option key={m} value={m}>Eff: {MONTH_LABELS[i]}</option>
            ))}
          </select>
        )}

        <div className="px-3 py-1.5 bg-zinc-950 rounded-lg text-xs font-bold border border-white/5">
          Status:&nbsp;
          <span className={planStatus === "Draft" ? "text-amber-400" : "text-emerald-400"}>{planStatus}</span>
        </div>
        {isDirty && (
          <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            unsaved
          </span>
        )}

        <div className="flex-1" />

        <button onClick={handleImportSchemes} disabled={isLocked}
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
            <Lock size={12} /> Approve
          </button>
        ) : (
          <button onClick={handleUnlock} disabled={!isAdmin}
                  title={isAdmin ? "Admin: unlock" : "Admin only"}
                  className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-2 border ${
                    isAdmin ? "bg-rose-900/40 hover:bg-rose-800 text-rose-300 border-rose-500/20" : "bg-zinc-900 text-zinc-600 border-white/5 cursor-not-allowed"
                  }`}>
            <Unlock size={12} /> {isAdmin ? "Unlock" : "Locked (Admin only)"}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="bg-zinc-900/30 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-2xl">
        {rows.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-zinc-400 mb-2">No data in this {planType} plan yet.</p>
            <button onClick={handleImportSchemes} disabled={isLocked}
                    className="px-6 py-3 bg-white text-black rounded-xl font-bold hover:bg-cyan-400 disabled:opacity-50">
              Import Schemes
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <th className="p-4 sticky left-0 bg-[#0c0c0c] z-30">Hierarchy</th>
                  <th className="p-4 text-right">Gross</th>
                  <th className="p-4 text-right">Cum. till last FY</th>
                  <th className={`p-4 text-right ${accentClass}`}>
                    {planType} (FY {fy})
                  </th>
                  {FY_MONTH_ORDER.map((m, i) => (
                    <th key={m} className="p-3 text-center bg-zinc-800/20 border-l border-white/5">
                      {MONTH_LABELS[i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (!isRowVisible(i)) return null;
                  const isCollapsible = row.level !== "Item";
                  const isExpanded = expanded[row.id] !== false;
                  return (
                    <tr key={row.id}
                        onMouseEnter={() => setHoveredRow(row.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        className={`border-b border-white/[0.03] hover:bg-white/[0.02] relative ${
                          row.level === "Header" ? "bg-zinc-900/50" : ""
                        }`}>
                      <td className="p-3 sticky left-0 bg-[#0c0c0c] z-20 border-r border-white/5"
                          style={{ paddingLeft: `${(row.indent * 1.5) + 1}rem` }}>
                        <div className="flex items-center gap-2">
                          {isCollapsible ? (
                            <button onClick={() => setExpanded((e) => ({ ...e, [row.id]: !isExpanded }))}
                                    className="text-cyan-500">
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          ) : (
                            <div className="w-3 h-3 border-l-2 border-b-2 border-zinc-800 -mt-1 ml-1" />
                          )}
                          <span className={
                            row.level === "Header" ? "text-white font-bold" :
                            row.level === "SubHeader" ? "text-zinc-300 font-semibold text-sm" :
                            "text-zinc-400 text-sm"
                          }>{row.name}</span>
                        </div>
                        <AnimatePresence>
                          {hoveredRow === row.id && canEditRows && (
                            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                                        className="absolute left-[100%] top-1/2 -translate-y-1/2 ml-2 flex gap-1 bg-zinc-800 p-1 rounded-xl border border-white/10 shadow-2xl z-50 backdrop-blur">
                              <button onClick={() => handleIndent(i)} className="p-1.5 hover:bg-cyan-600 rounded text-zinc-300"><Indent size={12} /></button>
                              <button onClick={() => handleOutdent(i)} className="p-1.5 hover:bg-cyan-600 rounded text-zinc-300"><Outdent size={12} /></button>
                              <button onClick={() => moveRow(i, "up")} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-300"><ArrowUp size={12} /></button>
                              <button onClick={() => moveRow(i, "down")} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-300"><ArrowDown size={12} /></button>
                              <button onClick={() => handleDeleteRow(i)} className="p-1.5 hover:bg-red-600/40 text-red-400 rounded"><Trash2 size={12} /></button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </td>
                      <td className="p-3 text-right">
                        {row.isEditable && canEditRows ? (
                          <input type="number" value={row.gross || ""}
                                 onChange={(e) => handleCellEdit(i, "gross", e.target.value)}
                                 className="w-20 bg-zinc-950 border border-zinc-700 rounded-md p-1 text-right text-xs font-mono outline-none focus:border-cyan-400" />
                        ) : (
                          <span className="text-zinc-400 font-mono text-xs">₹{row.gross.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {row.isEditable && canEditRows ? (
                          <input type="number" value={row.cumLast || ""}
                                 onChange={(e) => handleCellEdit(i, "cumLast", e.target.value)}
                                 className="w-20 bg-zinc-950 border border-zinc-700 rounded-md p-1 text-right text-xs font-mono outline-none focus:border-cyan-400" />
                        ) : (
                          <span className="text-zinc-500 font-mono text-xs">₹{row.cumLast.toFixed(2)}</span>
                        )}
                      </td>
                      <td className={`p-3 text-right font-mono text-xs font-bold ${accentClass}`}>
                        ₹{(planType === "BE" ? row.beFY : row.reFY).toFixed(2)}
                      </td>
                      {FY_MONTH_ORDER.map((m) => (
                        <td key={m} className="p-2 border-l border-white/5">
                          <input type="number"
                                 disabled={!row.isEditable || !canEditRows}
                                 value={row.months[m]?.[planType === "BE" ? "be" : "re"] || ""}
                                 onChange={(e) => handleMonthEdit(i, m, planType === "BE" ? "be" : "re", e.target.value)}
                                 className={`w-14 bg-zinc-950/50 border border-white/5 rounded-md p-1 text-xs text-center font-mono outline-none focus:border-${planColor}-500/50 ${accentClass} disabled:opacity-40`} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Actuals editor
// =============================================================================
function ActualsEditor({ fy, isAdmin }: { fy: string; isAdmin: boolean }) {
  const { speakAndChat } = useMos();
  const [selectedMonth, setSelectedMonth] = useState<number>(FY_MONTH_ORDER[0]);
  const [data, setData] = useState<{ rows: ActualsRow[]; locked_months: number[]; plan_id?: number; plan_type?: string; plan_version?: string; note?: string }>({
    rows: [], locked_months: [],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const isLocked = data.locked_months.includes(selectedMonth);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/capex/actuals?fy_year=${encodeURIComponent(fy)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      if (d.note) speakAndChat(d.note, "ℹ️");
    } catch (e: any) {
      speakAndChat(`Couldn't load actuals: ${e.message}`, "❌");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  const saveCell = async (row_id: number, amount: number) => {
    if (isLocked) { alert(`${MONTH_LABELS[FY_MONTH_ORDER.indexOf(selectedMonth)]} is locked.`); return; }
    setSaving((s) => ({ ...s, [row_id]: true }));
    try {
      const r = await fetch(`${API_BASE}/capex/actuals/cell`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ plan_row_id: row_id, month_no: selectedMonth, amount, fy_year: fy }),
      });
      if (r.status === 423) {
        const d = await r.json().catch(() => ({}));
        alert(d.detail || "Month locked.");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      // Update local cache
      setData((prev) => ({
        ...prev,
        rows: prev.rows.map((row) =>
          row.row_id === row_id ? { ...row, months: { ...row.months, [String(selectedMonth)]: amount } } : row,
        ),
      }));
    } catch (e: any) {
      speakAndChat(`Cell save failed: ${e.message}`, "❌");
    } finally {
      setSaving((s) => ({ ...s, [row_id]: false }));
    }
  };

  const toggleLock = async () => {
    if (!isAdmin) return;
    try {
      if (isLocked) {
        const r = await fetch(`${API_BASE}/capex/locks/${encodeURIComponent(fy)}/${selectedMonth}`, {
          method: "DELETE", headers: authHeaders(),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        speakAndChat(`${monthLabel(selectedMonth)} unlocked`, "🔓");
      } else {
        if (!confirm(`Lock ${monthLabel(selectedMonth)}? No further actuals can be entered until unlocked.`)) return;
        const r = await fetch(`${API_BASE}/capex/locks`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ fy_year: fy, month_no: selectedMonth }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        speakAndChat(`${monthLabel(selectedMonth)} locked`, "🔒");
      }
      load();
    } catch (e: any) {
      speakAndChat(`Lock toggle failed: ${e.message}`, "❌");
    }
  };

  return (
    <div>
      {/* Month selector */}
      <div className="mb-4 p-4 bg-zinc-900/30 border border-white/5 rounded-2xl backdrop-blur flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-1.5">
          <CalendarDays size={12} /> Month
        </span>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="p-1.5 text-xs rounded-lg bg-black/50 border border-emerald-500/40 outline-none focus:border-emerald-400 min-w-[140px]">
          {FY_MONTH_ORDER.map((m, i) => (
            <option key={m} value={m}>
              {MONTH_LABELS[i]} {data.locked_months.includes(m) ? "🔒" : ""}
            </option>
          ))}
        </select>
        {data.plan_id && (
          <span className="text-xs text-zinc-500">
            using plan #{data.plan_id} ({data.plan_type} · {data.plan_version})
          </span>
        )}
        <button onClick={load} disabled={loading}
                className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>

        <div className="flex-1" />

        {isLocked ? (
          <span className="px-3 py-1.5 text-xs bg-rose-500/10 text-rose-300 border border-rose-500/30 rounded-lg flex items-center gap-1.5">
            <Lock size={12} /> {monthLabel(selectedMonth)} locked
          </span>
        ) : (
          <span className="px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-lg flex items-center gap-1.5">
            <Unlock size={12} /> editable
          </span>
        )}

        <button onClick={toggleLock} disabled={!isAdmin}
                title={isAdmin ? (isLocked ? "Admin: unlock month" : "Admin: lock month") : "Admin only"}
                className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-2 border ${
                  isAdmin ? "bg-amber-900/40 hover:bg-amber-800 text-amber-300 border-amber-500/20" : "bg-zinc-900 text-zinc-600 border-white/5 cursor-not-allowed"
                }`}>
          {isLocked ? <Unlock size={12} /> : <Lock size={12} />}
          {isAdmin ? (isLocked ? "Unlock month" : "Lock month") : "Admin only"}
        </button>
      </div>

      {/* Rows */}
      <div className="bg-zinc-900/30 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-2xl">
        {data.rows.length === 0 ? (
          <div className="p-16 text-center text-zinc-500">
            {data.note || "No CAPEX plan rows for this FY yet. Create a BE plan first."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <th className="p-4">Scheme / Item</th>
                  <th className="p-4 text-right">Actual for {monthLabel(selectedMonth)} (₹ Cr)</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <ActualsRowEditor
                    key={row.row_id}
                    row={row}
                    selectedMonth={selectedMonth}
                    disabled={isLocked}
                    saving={saving[row.row_id] || false}
                    onSave={(amt) => saveCell(row.row_id, amt)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ActualsRowEditor({ row, selectedMonth, disabled, saving, onSave }: {
  row: ActualsRow; selectedMonth: number; disabled: boolean; saving: boolean;
  onSave: (amount: number) => void;
}) {
  const value = row.months[String(selectedMonth)] || 0;
  const [local, setLocal] = useState<string>(String(value));
  useEffect(() => { setLocal(String(value || "")); }, [value, selectedMonth]);

  const commit = () => {
    const n = Number(local);
    if (Number.isFinite(n) && n !== value) onSave(n);
  };

  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02]"
        style={{ paddingLeft: `${row.indent * 1.5}rem` }}>
      <td className="p-3 text-sm text-zinc-300"
          style={{ paddingLeft: `${(row.indent * 1.5) + 1}rem` }}>
        {row.row_name}
        {row.scheme_id != null && (
          <span className="ml-2 text-[10px] text-zinc-600 font-mono">#{row.scheme_id}</span>
        )}
      </td>
      <td className="p-3 text-right">
        <input
          type="number"
          value={local}
          disabled={disabled}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="0.00"
          className={`w-32 bg-zinc-950 border rounded-md p-1.5 text-right font-mono text-sm outline-none ${
            disabled ? "border-zinc-800 opacity-50 cursor-not-allowed" : "border-zinc-700 focus:border-emerald-400 text-emerald-300"
          } ${saving ? "border-amber-500/50" : ""}`}
        />
      </td>
    </tr>
  );
}

function monthLabel(m: number): string {
  const i = FY_MONTH_ORDER.indexOf(m);
  return i >= 0 ? MONTH_LABELS[i] : `Month ${m}`;
}
