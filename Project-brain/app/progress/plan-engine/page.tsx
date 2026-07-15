"use client";

/**
 * MASTER PLAN ENGINE — The Grid Planner
 * GOD MODE v2.1 — Sprint 2
 *
 * - Pick a package → planner opens
 * - Activity grid: rows = activities, cols = months
 * - Live weightage validation (must sum to 100)
 * - Live S-curve preview
 * - Lock / unlock as baseline
 * - Daily actual entry
 *
 * Place at: front/app/progress/plan-engine/page.tsx
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, Lock, Unlock, Save, ChevronDown, ChevronRight,
  Activity, Calendar, AlertTriangle, CheckCircle2, RefreshCw,
  TrendingUp, TrendingDown, Minus, Wand2,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Area, AreaChart } from "recharts";
import SeedActivitiesPanel from "@/components/plan/SeedActivitiesPanel";

const API = "http://localhost:8000/api/v1";

// =============================================================================
//   TYPES
// =============================================================================
interface Scheme { scheme_id: number; scheme_name: string; current_status: string; }
interface Package { package_id: number; package_no: number; package_name: string; }
interface Plan {
  progress_plan_id: number;
  package_id: number;
  plan_name: string;
  plan_version: number;
  plan_status: string;
  is_locked: boolean;
  financial_year: string;
  contract_start_month: string;
  expected_completion_month: string;
  activity_count: number;
  total_weightage: number;
  weightage_ok: boolean;
}
interface PlanActivity {
  plan_activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  weightage: number;
  actuals_till_last_fy: number;
  activity_start_date: string;
  activity_finish_date: string;
  display_order: number;
}
interface PlanFull {
  header: any;
  activities: PlanActivity[];
  months: string[];
  monthly_cells: Record<string, number>;
  actual_cells: Record<string, number>;
}

// =============================================================================
//   MAIN COMPONENT
// =============================================================================
export default function PlanEnginePage() {
  // Selection state
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [planData, setPlanData] = useState<PlanFull | null>(null);

  // Grid state (local edits before save)
  const [localCells, setLocalCells] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // UI state
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" | "info" } | null>(null);
  const [showActuals, setShowActuals] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [actualForm, setActualForm] = useState({ activity_id: 0, actual_date: new Date().toISOString().split("T")[0], actual_qty: 0, remarks: "" });

  // ---------------------------------------------------------------
  //  Initial: load schemes
  // ---------------------------------------------------------------
  useEffect(() => {
    fetch(`${API}/schemes/all`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setSchemes(data));
  }, []);

  // When scheme changes → load packages
  useEffect(() => {
    if (!selectedSchemeId) return;
    fetch(`${API}/schemes/${selectedSchemeId}/full`)
      .then((r) => r.json())
      .then((d) => {
        const pkgs = Array.isArray(d?.packages) ? d.packages : [];
        setPackages(pkgs);
        if (pkgs.length) setSelectedPackageId(pkgs[0].package_id);
        else { setSelectedPackageId(null); setPlans([]); setSelectedPlanId(null); setPlanData(null); }
      });
  }, [selectedSchemeId]);

  // When package changes → load plans
  useEffect(() => {
    if (!selectedPackageId) return;
    fetch(`${API}/plan-engine/packages/${selectedPackageId}/plans`)
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setPlans(arr);
        if (arr.length) setSelectedPlanId(arr[0].progress_plan_id);
        else { setSelectedPlanId(null); setPlanData(null); }
      });
  }, [selectedPackageId]);

  // When plan changes → load full data
  useEffect(() => {
    if (!selectedPlanId) return;
    loadPlanFull();
  }, [selectedPlanId]);

  const loadPlanFull = async () => {
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/full`);
    const d = await r.json();
    setPlanData(d);
    setLocalCells({ ...d.monthly_cells });
    setDirty(false);
  };

  // ---------------------------------------------------------------
  //  Calculations
  // ---------------------------------------------------------------
  const currentPlan = useMemo(
    () => plans.find((p) => p.progress_plan_id === selectedPlanId),
    [plans, selectedPlanId]
  );

  const totalWeightage = useMemo(() => {
    if (!planData) return 0;
    return planData.activities.reduce((sum, a) => sum + (a.weightage || 0), 0);
  }, [planData]);

  // Row sum per activity (sum of planned across all months)
  const rowSums = useMemo(() => {
    if (!planData) return {};
    const out: Record<number, number> = {};
    planData.activities.forEach((a) => {
      let s = 0;
      planData.months.forEach((m) => {
        s += localCells[`${a.plan_activity_id}|${m}`] || 0;
      });
      out[a.plan_activity_id] = s;
    });
    return out;
  }, [planData, localCells]);

  // S-curve data: cumulative planned + actual %
  const curveData = useMemo(() => {
    if (!planData) return [];
    const points: any[] = [];
    let cumPlan = 0, cumActual = 0;
    planData.months.forEach((m) => {
      let monthPlanPct = 0, monthActualPct = 0;
      planData.activities.forEach((a) => {
        const plan = localCells[`${a.plan_activity_id}|${m}`] || 0;
        const actual = planData.actual_cells[`${a.plan_activity_id}|${m}`] || 0;
        if (a.scope_qty > 0) {
          monthPlanPct += (plan / a.scope_qty) * (a.weightage / 100) * 100;
          monthActualPct += (actual / a.scope_qty) * (a.weightage / 100) * 100;
        }
      });
      cumPlan = Math.min(cumPlan + monthPlanPct, 100);
      cumActual = Math.min(cumActual + monthActualPct, 100);
      points.push({
        month: m.substring(0, 7),
        Planned: Math.round(cumPlan * 100) / 100,
        Actual: Math.round(cumActual * 100) / 100,
      });
    });
    return points;
  }, [planData, localCells]);

  // ---------------------------------------------------------------
  //  Actions
  // ---------------------------------------------------------------
  const showToast = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const createPlan = async (fields: any) => {
    const r = await fetch(`${API}/plan-engine/packages/${selectedPackageId}/plans`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const d = await r.json();
    if (r.ok) {
      showToast("Plan created");
      setShowCreatePlan(false);
      // reload plans
      const rr = await fetch(`${API}/plan-engine/packages/${selectedPackageId}/plans`);
      const data = await rr.json();
      setPlans(data);
      setSelectedPlanId(d.progress_plan_id);
    } else {
      showToast(d.detail || "Failed", "err");
    }
  };

  const addActivity = async () => {
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/activities`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activity_name: "New Activity",
        uom: "Nos", scope_qty: 0, weightage: 0,
      }),
    });
    if (r.ok) {
      showToast("Activity added");
      loadPlanFull();
    } else {
      const d = await r.json();
      showToast(d.detail || "Failed", "err");
    }
  };

  const updateActivity = async (aid: number, patch: any) => {
    const r = await fetch(`${API}/plan-engine/activities/${aid}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) loadPlanFull();
    else { const d = await r.json(); showToast(d.detail || "Failed", "err"); }
  };

  const deleteActivity = async (aid: number) => {
    if (!confirm("Delete this activity? All monthly cells will be lost.")) return;
    const r = await fetch(`${API}/plan-engine/activities/${aid}`, { method: "DELETE" });
    if (r.ok) { showToast("Deleted"); loadPlanFull(); }
    else { const d = await r.json(); showToast(d.detail || "Failed", "err"); }
  };

  const onCellChange = (aid: number, month: string, value: string) => {
    const key = `${aid}|${month}`;
    const num = parseFloat(value);
    setLocalCells((prev) => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
    setDirty(true);
  };

  const saveCells = async () => {
    if (!planData) return;
    setSaving(true);
    const cells: any[] = [];
    planData.activities.forEach((a) => {
      planData.months.forEach((m) => {
        cells.push({
          plan_activity_id: a.plan_activity_id,
          plan_month: m,
          planned_qty: localCells[`${a.plan_activity_id}|${m}`] || 0,
        });
      });
    });
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/cells`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells }),
    });
    if (r.ok) {
      showToast(`Saved ${cells.length} cells`);
      setDirty(false);
    } else {
      const d = await r.json();
      showToast(d.detail || "Save failed", "err");
    }
    setSaving(false);
  };

  const lockPlan = async () => {
    if (Math.abs(totalWeightage - 100) > 0.01) {
      showToast(`Weightage = ${totalWeightage.toFixed(2)}, must be 100`, "err");
      return;
    }
    if (!confirm("Lock this plan as the baseline? It can be unlocked later by admin.")) return;
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/lock`, { method: "POST" });
    if (r.ok) { showToast("Plan locked as baseline"); loadPlanFull();
      const rr = await fetch(`${API}/plan-engine/packages/${selectedPackageId}/plans`);
      setPlans(await rr.json());
    } else { const d = await r.json(); showToast(d.detail || "Lock failed", "err"); }
  };

  const autoDistribute = async () => {
    if (!confirm("Auto-distribute scope across months using appendix-2 commencement/completion dates? This will overwrite existing monthly cells.")) return;
    setDistributing(true);
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/auto-distribute`, { method: "POST" });
    const d = await r.json();
    if (r.ok) {
      showToast(`Distributed ${d.activities_distributed} activities (${d.cells_written} cells written)`, "ok");
      loadPlanFull();
    } else {
      showToast(d.detail || "Auto-distribute failed", "err");
    }
    setDistributing(false);
  };

  const unlockPlan = async () => {
    if (!confirm("Unlock this plan for editing? This will allow changes to baseline.")) return;
    const r = await fetch(`${API}/plan-engine/plans/${selectedPlanId}/unlock`, { method: "POST" });
    if (r.ok) {
      showToast("Plan unlocked");
      loadPlanFull();
      const rr = await fetch(`${API}/plan-engine/packages/${selectedPackageId}/plans`);
      setPlans(await rr.json());
    }
  };

  const submitActual = async () => {
    const r = await fetch(`${API}/plan-engine/activities/${actualForm.activity_id}/daily-actual`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actual_date: actualForm.actual_date,
        actual_qty: actualForm.actual_qty,
        remarks: actualForm.remarks,
      }),
    });
    if (r.ok) {
      showToast("Actual submitted");
      setShowActuals(false);
      setActualForm({ activity_id: 0, actual_date: new Date().toISOString().split("T")[0], actual_qty: 0, remarks: "" });
      loadPlanFull();
    }
  };

  const fmtMonth = (m: string) => {
    const d = new Date(m);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const isLocked = currentPlan?.is_locked || false;

  // ---------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      {/* TOAST */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl border font-medium ${
          toast.kind === "ok" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
          toast.kind === "err" ? "bg-red-500/10 border-red-500/30 text-red-300" :
          "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
        }`}>{toast.msg}</div>
      )}

      <div className="max-w-[1600px] mx-auto">
        {/* HEADER */}
        <div className="mb-8 border-b border-zinc-800 pb-6">
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            Master Plan Engine
          </h1>
          <p className="text-zinc-400 text-sm mt-2">
            Grid-based planner with weightage validation, S-curve preview, and daily actuals.
          </p>
        </div>

        {/* SELECTORS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Scheme */}
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block font-medium">Scheme</label>
            <select
              value={selectedSchemeId || ""}
              onChange={(e) => setSelectedSchemeId(parseInt(e.target.value) || null)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 outline-none"
            >
              <option value="">— Select Scheme —</option>
              {schemes.map((s) => (
                <option key={s.scheme_id} value={s.scheme_id}>
                  #{s.scheme_id} {s.scheme_name.substring(0, 50)}
                </option>
              ))}
            </select>
          </div>

          {/* Package */}
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block font-medium">
              Package
              {packages.length > 1 && (
                <span className="ml-2 px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded text-[9px] font-bold">
                  {packages.length} PACKAGES
                </span>
              )}
            </label>
            <select
              value={selectedPackageId || ""}
              onChange={(e) => setSelectedPackageId(parseInt(e.target.value) || null)}
              disabled={!packages.length}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 outline-none disabled:opacity-50"
            >
              <option value="">— Select Package —</option>
              {packages.map((p: any) => (
                <option key={p.package_id} value={p.package_id}>
                  #{p.package_no} {p.package_name.substring(0, 45)}{p.is_scheme_mirror ? " [mirror]" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Plan */}
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block font-medium">Plan Version</label>
            <div className="flex gap-2">
              <select
                value={selectedPlanId || ""}
                onChange={(e) => setSelectedPlanId(parseInt(e.target.value) || null)}
                disabled={!plans.length}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 outline-none disabled:opacity-50"
              >
                <option value="">— Select / Create —</option>
                {plans.map((p) => (
                  <option key={p.progress_plan_id} value={p.progress_plan_id}>
                    v{p.plan_version} {p.plan_name} {p.is_locked && "🔒"}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowCreatePlan(true)}
                disabled={!selectedPackageId}
                className="px-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* MULTI-PACKAGE OVERVIEW (shown when scheme has >1 packages) */}
        {selectedSchemeId && packages.length > 1 && (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Multi-Package Scheme</div>
                <h3 className="text-lg font-bold text-white">
                  {schemes.find((s) => s.scheme_id === selectedSchemeId)?.scheme_name}
                </h3>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-zinc-500 font-medium">Total Portfolio</div>
                <div className="font-bold text-cyan-400 text-lg">
                  ₹{packages.filter((p: any) => !p.is_scheme_mirror).reduce((s: number, p: any) => s + (p.package_value_cr || 0), 0).toFixed(2)} Cr
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {packages.filter((p: any) => !p.is_scheme_mirror).map((p: any) => (
                <button
                  key={p.package_id}
                  onClick={() => setSelectedPackageId(p.package_id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    p.package_id === selectedPackageId
                      ? "bg-cyan-500/10 border-cyan-500/40 ring-1 ring-cyan-500/30"
                      : "bg-zinc-950 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-mono text-zinc-500">#{p.package_no}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      p.package_status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                      p.package_status === "under_execution" ? "bg-amber-500/10 text-amber-400" :
                      p.package_status === "awarded" ? "bg-blue-500/10 text-blue-400" :
                      "bg-zinc-500/10 text-zinc-400"
                    }`}>
                      {p.package_status?.replace(/_/g, " ") || "planned"}
                    </span>
                  </div>
                  <div className="font-bold text-white text-sm mb-1 line-clamp-2">{p.package_name}</div>
                  {p.executing_agency && (
                    <div className="text-[11px] text-zinc-500 line-clamp-1 mb-1">🏢 {p.executing_agency}</div>
                  )}
                  {p.package_value_cr && (
                    <div className="text-xs text-cyan-400 font-bold">₹{Number(p.package_value_cr).toFixed(2)} Cr</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CREATE PLAN MODAL */}
        {showCreatePlan && (
          <CreatePlanModal
            onClose={() => setShowCreatePlan(false)}
            onCreate={createPlan}
          />
        )}

        {/* PLAN HEADER + STATUS BAR */}
        {planData && (
          <>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 mb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <div className="text-xs uppercase text-zinc-500 font-medium">Plan</div>
                    <div className="font-bold text-white">{planData.header.plan_name}</div>
                    <div className="text-xs text-zinc-500">v{planData.header.plan_version} · {planData.header.financial_year || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-zinc-500 font-medium">Range</div>
                    <div className="font-bold text-white text-sm">
                      {fmtMonth(planData.header.contract_start_month)} → {fmtMonth(planData.header.expected_completion_month)}
                    </div>
                    <div className="text-xs text-zinc-500">{planData.months.length} months</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-zinc-500 font-medium">Activities</div>
                    <div className="font-bold text-white">{planData.activities.length}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-zinc-500 font-medium">Weightage</div>
                    <div className={`font-bold ${Math.abs(totalWeightage - 100) < 0.01 ? "text-emerald-400" : "text-amber-400"}`}>
                      {totalWeightage.toFixed(2)}% / 100%
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isLocked ? (
                    <>
                      <span className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-bold flex items-center gap-2">
                        <Lock size={14} /> BASELINE LOCKED
                      </span>
                      <button
                        onClick={unlockPlan}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs flex items-center gap-2"
                      >
                        <Unlock size={14} /> Unlock
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={saveCells}
                        disabled={!dirty || saving}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 ${
                          dirty
                            ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                            : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                        }`}
                      >
                        <Save size={14} /> {saving ? "Saving..." : dirty ? "Save grid" : "All saved"}
                      </button>
                      <button
                        onClick={autoDistribute}
                        disabled={distributing}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Auto-distribute scope across months from appendix-2 schedule"
                      >
                        <Wand2 size={14} /> {distributing ? "Working..." : "Auto-distribute"}
                      </button>
                      <button
                        onClick={lockPlan}
                        disabled={Math.abs(totalWeightage - 100) > 0.01}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Lock size={14} /> Lock baseline
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setShowActuals(true)}
                    disabled={!isLocked}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs flex items-center gap-2 disabled:opacity-50"
                    title={isLocked ? "Add daily actual" : "Lock the plan first"}
                  >
                    <Activity size={14} /> Daily actual
                  </button>
                </div>
              </div>
            </div>

            {selectedPlanId && selectedPackageId && (
              <SeedActivitiesPanel
                planId={selectedPlanId}
                packageId={selectedPackageId}
                isLocked={planData?.header?.is_locked}
                onSeeded={() => loadPlanFull()}
              />
            )}

            {/* GRID + S-CURVE LAYOUT */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* GRID — 2 cols */}
              <div className="lg:col-span-2 bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead className="bg-zinc-900">
                      <tr>
                        <th className="sticky left-0 z-10 bg-zinc-900 px-3 py-2 text-left text-zinc-400 font-bold uppercase tracking-wider border-r border-zinc-800 min-w-[220px]">Activity</th>
                        <th className="px-2 py-2 text-zinc-400 font-bold uppercase">UOM</th>
                        <th className="px-2 py-2 text-zinc-400 font-bold uppercase">Scope</th>
                        <th className="px-2 py-2 text-zinc-400 font-bold uppercase">Wt %</th>
                        {planData.months.map((m) => (
                          <th key={m} className="px-2 py-2 text-zinc-400 font-bold whitespace-nowrap min-w-[80px]">{fmtMonth(m)}</th>
                        ))}
                        <th className="px-2 py-2 text-zinc-400 font-bold uppercase border-l border-zinc-800">Total</th>
                        <th className="px-1 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {planData.activities.map((a) => {
                        const rowSum = rowSums[a.plan_activity_id] || 0;
                        const scopeMatch = Math.abs(rowSum - a.scope_qty) < 0.01;
                        return (
                          <tr key={a.plan_activity_id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                            <td className="sticky left-0 z-10 bg-zinc-950 px-3 py-1.5 border-r border-zinc-800">
                              <input
                                type="text"
                                value={a.activity_name}
                                onChange={(e) => updateActivity(a.plan_activity_id, { activity_name: e.target.value })}
                                disabled={isLocked}
                                className="bg-transparent text-white outline-none w-full disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={a.uom}
                                onChange={(e) => updateActivity(a.plan_activity_id, { uom: e.target.value })}
                                disabled={isLocked}
                                className="bg-transparent text-zinc-300 outline-none w-12 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={a.scope_qty}
                                onChange={(e) => updateActivity(a.plan_activity_id, { scope_qty: parseFloat(e.target.value) || 0 })}
                                disabled={isLocked}
                                className="bg-transparent text-zinc-300 outline-none w-16 text-right disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={a.weightage}
                                onChange={(e) => updateActivity(a.plan_activity_id, { weightage: parseFloat(e.target.value) || 0 })}
                                disabled={isLocked}
                                className="bg-transparent text-amber-400 outline-none w-14 text-right disabled:cursor-not-allowed"
                              />
                            </td>
                            {planData.months.map((m) => {
                              const key = `${a.plan_activity_id}|${m}`;
                              const planVal = localCells[key] || 0;
                              const actualVal = planData.actual_cells[key] || 0;
                              return (
                                <td key={m} className="px-1 py-1 text-center relative">
                                  <input
                                    type="number"
                                    value={planVal || ""}
                                    onChange={(e) => onCellChange(a.plan_activity_id, m, e.target.value)}
                                    disabled={isLocked}
                                    placeholder="0"
                                    className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-200 outline-none w-[70px] text-right text-xs focus:border-cyan-500/50 disabled:cursor-not-allowed"
                                  />
                                  {actualVal > 0 && (
                                    <div className="text-[9px] text-emerald-400 mt-0.5">▲ {actualVal}</div>
                                  )}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-1.5 text-right font-bold border-l border-zinc-800 ${scopeMatch ? "text-emerald-400" : "text-amber-400"}`}>
                              {rowSum.toFixed(2)}
                            </td>
                            <td className="px-1 py-1.5">
                              {!isLocked && (
                                <button
                                  onClick={() => deleteActivity(a.plan_activity_id)}
                                  className="text-zinc-600 hover:text-red-400"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      <tr className="bg-zinc-900 font-bold">
                        <td className="sticky left-0 z-10 bg-zinc-900 px-3 py-2 text-zinc-300 border-r border-zinc-800">TOTAL</td>
                        <td></td><td></td>
                        <td className={`px-2 py-2 text-right ${Math.abs(totalWeightage - 100) < 0.01 ? "text-emerald-400" : "text-amber-400"}`}>{totalWeightage.toFixed(2)}</td>
                        {planData.months.map((m) => {
                          let monthTotal = 0;
                          planData.activities.forEach((a) => {
                            monthTotal += localCells[`${a.plan_activity_id}|${m}`] || 0;
                          });
                          return <td key={m} className="px-2 py-2 text-right text-zinc-400">{monthTotal.toFixed(2)}</td>;
                        })}
                        <td className="px-2 py-2 text-right text-zinc-400 border-l border-zinc-800">—</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!isLocked && (
                  <div className="p-3 border-t border-zinc-800">
                    <button
                      onClick={addActivity}
                      className="w-full py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-cyan-500/30 rounded-lg text-sm text-zinc-400 hover:text-cyan-400 flex items-center justify-center gap-2"
                    >
                      <Plus size={14} /> Add Activity Row
                    </button>
                  </div>
                )}
              </div>

              {/* S-CURVE — 1 col */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-white">S-Curve Preview</h3>
                  <span className="text-xs text-zinc-500">Cumulative %</span>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={curveData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="month" stroke="#71717a" style={{ fontSize: 10 }} />
                    <YAxis stroke="#71717a" style={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        background: "#0a0a0a",
                        border: "1px solid #27272a",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="Planned" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={2} />
                    <Area type="monotone" dataKey="Actual" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  <CurveStat label="Final Planned" value={curveData[curveData.length - 1]?.Planned || 0} color="cyan" />
                  <CurveStat label="Current Actual" value={curveData[curveData.length - 1]?.Actual || 0} color="emerald" />
                  <CurveStat
                    label="Deviation"
                    value={(curveData[curveData.length - 1]?.Planned || 0) - (curveData[curveData.length - 1]?.Actual || 0)}
                    color="amber"
                    showSign
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* DAILY ACTUAL MODAL */}
        {showActuals && planData && (
          <DailyActualModal
            activities={planData.activities}
            form={actualForm}
            setForm={setActualForm}
            onClose={() => setShowActuals(false)}
            onSubmit={submitActual}
          />
        )}

        {/* Empty state */}
        {selectedPackageId && plans.length === 0 && (
          <div className="text-center py-12 bg-zinc-900/30 border border-zinc-800 rounded-2xl">
            <Calendar size={48} className="mx-auto mb-4 text-zinc-700" />
            <h3 className="text-lg font-bold text-zinc-400 mb-2">No plans for this package yet</h3>
            <p className="text-sm text-zinc-500 mb-4">Click + to create the first plan version</p>
            <button onClick={() => setShowCreatePlan(true)} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold">
              Create First Plan
            </button>
          </div>
        )}

        {!selectedSchemeId && (
          <div className="text-center py-20 text-zinc-500">
            <Activity size={48} className="mx-auto mb-4 text-zinc-700" />
            <p>Select a scheme to begin planning</p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
//   SUB-COMPONENTS
// =============================================================================
function CreatePlanModal({ onClose, onCreate }: any) {
  const [fields, setFields] = useState({
    plan_name: "",
    financial_year: "FY26-27",
    contract_start_month: "",
    expected_completion_month: "",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
        <h3 className="text-xl font-bold mb-4">Create New Plan</h3>
        <div className="space-y-3">
          <FieldInput label="Plan Name" value={fields.plan_name} onChange={(v) => setFields({ ...fields, plan_name: v })} placeholder="Auto-generated if blank" />
          <FieldInput label="Financial Year" value={fields.financial_year} onChange={(v) => setFields({ ...fields, financial_year: v })} placeholder="FY26-27" />
          <FieldInput label="Contract Start Month" value={fields.contract_start_month} onChange={(v) => setFields({ ...fields, contract_start_month: v })} type="date" />
          <FieldInput label="Expected Completion Month" value={fields.expected_completion_month} onChange={(v) => setFields({ ...fields, expected_completion_month: v })} type="date" />
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Cancel</button>
          <button
            onClick={() => onCreate(fields)}
            disabled={!fields.contract_start_month || !fields.expected_completion_month}
            className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function DailyActualModal({ activities, form, setForm, onClose, onSubmit }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Activity size={20} /> Add Daily Actual
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">Activity</label>
            <select
              value={form.activity_id}
              onChange={(e) => setForm({ ...form, activity_id: parseInt(e.target.value) })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
            >
              <option value={0}>— Select Activity —</option>
              {activities.map((a: any) => (
                <option key={a.plan_activity_id} value={a.plan_activity_id}>
                  {a.activity_name} ({a.uom})
                </option>
              ))}
            </select>
          </div>
          <FieldInput label="Date" value={form.actual_date} onChange={(v) => setForm({ ...form, actual_date: v })} type="date" />
          <FieldInput label="Quantity Done" value={form.actual_qty} onChange={(v) => setForm({ ...form, actual_qty: parseFloat(v) || 0 })} type="number" />
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">Remarks</label>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              rows={2}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={!form.activity_id || form.actual_qty <= 0}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, type = "text", placeholder }: any) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 outline-none"
      />
    </div>
  );
}

function CurveStat({ label, value, color, showSign }: any) {
  const colorMap: any = {
    cyan: "text-cyan-400",
    emerald: "text-emerald-400",
    amber: value > 0 ? "text-red-400" : value < 0 ? "text-emerald-400" : "text-zinc-400",
  };
  const Icon = !showSign ? null : value > 0 ? TrendingDown : value < 0 ? TrendingUp : Minus;
  return (
    <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`font-bold ${colorMap[color]} flex items-center gap-1`}>
        {Icon && <Icon size={12} />}
        {showSign && value > 0 ? "+" : ""}{value.toFixed(2)}%
      </span>
    </div>
  );
}
