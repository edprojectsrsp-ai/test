"use client";

/**
 * THE VAULT — Project Brain Scheme Detail Page
 * GOD MODE v2.1 — Sprint 1
 *
 * 8-tab lifecycle view with auto-pilot status, custom fields, granular save.
 * Replaces: front/app/view/[id]/page.tsx
 */

import React, { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Save, Briefcase, FileText, Anchor, Activity,
  CheckSquare, Zap, Layers, AlertTriangle, ClipboardList,
  Plus, Lock, Unlock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API = "http://localhost:8000/api/v1/schemes";

// =============================================================================
//   STATUS LEVELS & TAB CONFIG
// =============================================================================
const STATUS_LEVELS: Record<string, number> = {
  under_formulation: 0,
  under_stage1: 1,
  under_tendering: 2,
  under_stage2: 3,
  ongoing: 4,
  on_hold: 4,
  closed: 5,
  dropped: 5,
};

type TabId =
  | "core" | "formulation" | "stage1" | "stage2"
  | "packages" | "tendering" | "contracts" | "completion" | "monitoring";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  reqLevel: number;
}

const TABS: TabDef[] = [
  { id: "core",        label: "Core Info",       icon: <ClipboardList size={18} />, reqLevel: 0 },
  { id: "formulation", label: "Formulation",     icon: <FileText size={18} />,      reqLevel: 0 },
  { id: "stage1",      label: "Stage-I",         icon: <Briefcase size={18} />,     reqLevel: 1 },
  { id: "packages",    label: "Packages",        icon: <Layers size={18} />,        reqLevel: 1 },
  { id: "tendering",   label: "Tendering",       icon: <FileText size={18} />,      reqLevel: 2 },
  { id: "stage2",      label: "Stage-II",        icon: <Anchor size={18} />,        reqLevel: 3 },
  { id: "contracts",   label: "Contracts",       icon: <Activity size={18} />,      reqLevel: 4 },
  { id: "completion",  label: "Completion",      icon: <CheckSquare size={18} />,   reqLevel: 4 },
  { id: "monitoring",  label: "Monitoring",      icon: <AlertTriangle size={18} />, reqLevel: 0 },
];

// =============================================================================
//   AUTO-PILOT FIELD → STATUS MAPPING
// =============================================================================
const AUTO_PILOT_RULES: { section: string; field: string; status: string }[] = [
  { section: "stage1",     field: "sanction_date",         status: "under_stage1" },
  { section: "tendering",  field: "nit_date",              status: "under_tendering" },
  { section: "stage2",     field: "sanction_date",         status: "under_stage2" },
  { section: "contracts",  field: "effective_date",        status: "ongoing" },
  { section: "completion", field: "commissioning_date",    status: "closed" },
];

// =============================================================================
//   MAIN COMPONENT
// =============================================================================
export default function VaultPage() {
  const { id } = useParams();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>("core");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<any>(null);
  const [autoPilot, setAutoPilot] = useState(true);
  const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
  const [activePackageId, setActivePackageId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  // -----------------------------------------------------------------
  //  Fetch
  // -----------------------------------------------------------------
  useEffect(() => {
    fetch(`${API}/${id}/full`)
      .then((r) => r.json())
      .then((d) => {
        if (d.detail) throw new Error(d.detail);
        setData(d);
        if (d.packages?.length) setActivePackageId(d.packages[0].package_id);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setToast({ msg: `Load failed: ${e.message}`, kind: "err" });
        setLoading(false);
      });
  }, [id]);

  // -----------------------------------------------------------------
  //  Field update — works for both section-level and package-scoped
  // -----------------------------------------------------------------
  const updateField = (section: string, field: string, value: any, packageId?: number) => {
    setDirtySections((prev) => new Set(prev).add(section));

    setData((prev: any) => {
      const next = { ...prev };

      // Section that is a list keyed by package (tendering/contracts/completion)
      if (["tendering", "contracts", "completion"].includes(section) && packageId !== undefined) {
        next[section] = next[section].map((row: any) =>
          row.package_id === packageId ? { ...row, [field]: value } : row
        );
      } else if (section === "packages" && packageId !== undefined) {
        next.packages = next.packages.map((p: any) =>
          p.package_id === packageId ? { ...p, [field]: value } : p
        );
      } else {
        next[section] = { ...(next[section] || {}), [field]: value };
      }

      // Auto-pilot: lift status based on date entries
      if (autoPilot && value) {
        for (const rule of AUTO_PILOT_RULES) {
          if (rule.section === section && rule.field === field) {
            const cur = next.core?.current_status || "under_formulation";
            if (STATUS_LEVELS[cur] < STATUS_LEVELS[rule.status]) {
              next.core = { ...next.core, current_status: rule.status };
              setDirtySections((p) => new Set(p).add("core"));
            }
          }
        }
      }

      return next;
    });
  };

  // -----------------------------------------------------------------
  //  Save current section
  // -----------------------------------------------------------------
  const saveSection = async (section: string) => {
    setSaving(true);
    try {
      let payload: any = data[section];

      // For list-style sections, save the active package row
      if (["contracts", "completion"].includes(section)) {
        const row = data[section].find((r: any) => r.package_id === activePackageId);
        if (!row) throw new Error("No row to save");
        payload = row;
      }
      if (section === "packages" && activePackageId) {
        const p = data.packages.find((x: any) => x.package_id === activePackageId);
        if (!p) throw new Error("No package selected");
        payload = { ...p };
        section = "package"; // backend uses singular for granular package save
      }

      const r = await fetch(`${API}/${id}/section/${section}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.detail || "Save failed");

      setDirtySections((prev) => {
        const next = new Set(prev);
        next.delete(section === "package" ? "packages" : section);
        return next;
      });
      setToast({ msg: `${section} saved`, kind: "ok" });
      setTimeout(() => setToast(null), 2500);
    } catch (e: any) {
      setToast({ msg: e.message, kind: "err" });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------
  //  Save all dirty sections
  // -----------------------------------------------------------------
  const saveAll = async () => {
    if (dirtySections.size === 0) return;
    for (const s of Array.from(dirtySections)) {
      await saveSection(s);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-cyan-400 animate-pulse">Initializing Vault...</div>
      </div>
    );
  }

  if (!data?.core) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-red-400">Scheme not found. <button onClick={() => router.push("/view")} className="text-cyan-400 underline">Back to list</button></div>
      </div>
    );
  }

  const currentLevel = STATUS_LEVELS[data.core.current_status] ?? 0;
  const activeTabDef = TABS.find((t) => t.id === activeTab)!;
  const isLocked = currentLevel < activeTabDef.reqLevel;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl border font-medium ${
              toast.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto p-8">
        {/* ================= HEADER ================= */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 pb-6 border-b border-zinc-800 gap-4">
          <div className="flex-1">
            <button
              onClick={() => router.push("/view")}
              className="flex items-center gap-2 text-zinc-400 hover:text-cyan-400 mb-4 text-sm transition-colors"
            >
              <ArrowLeft size={16} /> Back to Master Registry
            </button>
            <h1 className="text-3xl font-black text-white">{data.core.scheme_name}</h1>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-400 font-mono">
                #{data.core.scheme_id}
              </span>
              <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-xs uppercase tracking-wide text-zinc-300">
                {data.core.scheme_type}
              </span>
              {data.core.amr_no && (
                <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-400">
                  {data.core.amr_no}
                </span>
              )}

              {/* Status badge */}
              <select
                disabled={autoPilot}
                value={data.core.current_status}
                onChange={(e) => updateField("core", "current_status", e.target.value)}
                className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all ${
                  autoPilot ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                } ${getStatusStyle(data.core.current_status)}`}
              >
                {Object.keys(STATUS_LEVELS).map((s) => (
                  <option key={s} value={s} className="bg-zinc-900 text-white">
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>

              {/* Auto-pilot toggle */}
              <button
                onClick={() => setAutoPilot((p) => !p)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  autoPilot
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                <Zap size={12} className={autoPilot ? "animate-pulse" : ""} />
                {autoPilot ? "Auto-Pilot" : "Manual"}
              </button>
            </div>
          </div>

          <button
            onClick={saveAll}
            disabled={saving || dirtySections.size === 0}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${
              dirtySections.size > 0
                ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
            }`}
          >
            <Save size={18} />
            {saving ? "Saving..." : dirtySections.size > 0 ? `Save ${dirtySections.size} change${dirtySections.size > 1 ? "s" : ""}` : "All Saved"}
          </button>
        </div>

        {/* ================= BODY ================= */}
        <div className="flex flex-col md:flex-row gap-8">
          {/* THE SMART PIPELINE (Left Sidebar) */}
          <nav className="w-full md:w-72 shrink-0 flex flex-col relative">
            {/* The vertical connection line */}
            <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-zinc-800 z-0" />

            {TABS.map((t) => {
              const locked = currentLevel < t.reqLevel;
              const active = activeTab === t.id;
              const isDirty = dirtySections.has(t.id);

              return (
                <div key={t.id} className="relative z-10 flex items-center mb-2">
                  <button
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-4 w-full px-4 py-3 rounded-2xl font-medium transition-all duration-300 text-left ${
                      active
                        ? "bg-zinc-800 shadow-xl border border-zinc-700 scale-105 ml-2"
                        : "hover:bg-zinc-900/80 hover:translate-x-2 border border-transparent"
                    }`}
                  >
                    {/* Status indicator node — glowing green if level reached */}
                    <div
                      className={`flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 transition-all ${
                        !locked
                          ? "bg-emerald-500 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                          : "bg-zinc-950 border-zinc-700"
                      }`}
                    >
                      {!locked && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>

                    {/* Label + locked hint */}
                    <div className="flex flex-col items-start flex-1 min-w-0">
                      <span
                        className={`text-sm flex items-center gap-2 w-full ${
                          locked ? "text-zinc-500" : "text-white"
                        }`}
                      >
                        <span className={locked ? "text-zinc-600" : active ? "text-cyan-400" : "text-zinc-400"}>
                          {t.icon}
                        </span>
                        <span className="flex-1 truncate">{t.label}</span>
                        {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />}
                      </span>
                      {locked && (
                        <span className="text-[10px] text-zinc-600 mt-0.5 uppercase tracking-wider">
                          Locked (Future Phase)
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Active Tab Content with Lock overlay */}
          <div className="flex-1 relative">
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl min-h-[500px] overflow-hidden relative">
              {/* SMART LOCK OVERLAY */}
              <AnimatePresence>
                {isLocked && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-md rounded-3xl border border-zinc-800/50"
                  >
                    <Lock size={48} className="text-zinc-600 mb-4" />
                    <h3 className="text-2xl font-bold text-white mb-2">Phase Locked</h3>
                    <p className="text-zinc-400 text-center max-w-sm mb-6">
                      This project is currently{" "}
                      <span className="text-cyan-400 capitalize">
                        {data.core.current_status?.replace(/_/g, " ")}
                      </span>
                      . Advance status or override to edit this phase.
                    </p>
                    <button
                      onClick={() => {
                        setAutoPilot(false);
                        const targetStatus = Object.keys(STATUS_LEVELS).find(
                          (k) => STATUS_LEVELS[k] === activeTabDef.reqLevel
                        );
                        if (targetStatus) updateField("core", "current_status", targetStatus);
                      }}
                      className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-cyan-600 text-white rounded-xl transition-all font-medium border border-zinc-700 hover:border-cyan-500"
                    >
                      <Unlock size={18} /> Force Unlock Phase
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {!isLocked && (
                <TabRouter
                  tab={activeTab}
                  data={data}
                  updateField={updateField}
                  activePackageId={activePackageId}
                  setActivePackageId={setActivePackageId}
                  saveSection={saveSection}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//   TAB ROUTER
// =============================================================================
function TabRouter({ tab, data, updateField, activePackageId, setActivePackageId, saveSection }: any) {
  switch (tab) {
    case "core":        return <CoreTab        data={data.core}        update={(f: string, v: any) => updateField("core", f, v)} />;
    case "formulation": return <FormulationTab data={data.formulation} update={(f: string, v: any) => updateField("formulation", f, v)} />;
    case "stage1":      return <Stage1Tab      data={data.stage1}      update={(f: string, v: any) => updateField("stage1", f, v)} />;
    case "stage2":      return <Stage2Tab      data={data.stage2}      update={(f: string, v: any) => updateField("stage2", f, v)} />;
    case "packages":    return <PackagesTab    data={data.packages}    activePackageId={activePackageId} setActivePackageId={setActivePackageId} update={(f: string, v: any, pid: number) => updateField("packages", f, v, pid)} />;
    case "tendering":   return <TenderingTab   data={data.tendering}   packages={data.packages} />;
    case "contracts":   return <ContractsTab   data={data.contracts}   packages={data.packages} activePackageId={activePackageId} setActivePackageId={setActivePackageId} update={(f: string, v: any, pid: number) => updateField("contracts", f, v, pid)} />;
    case "completion":  return <CompletionTab  data={data.completion}  packages={data.packages} activePackageId={activePackageId} setActivePackageId={setActivePackageId} update={(f: string, v: any, pid: number) => updateField("completion", f, v, pid)} />;
    case "monitoring":  return <MonitoringTab  data={data.monitoring}  saveSection={saveSection} />;
    default: return null;
  }
}

// =============================================================================
//   TABS — light, simple, do the job
// =============================================================================
function CoreTab({ data, update }: any) {
  return (
    <div>
      <SectionTitle title="Core Information" subtitle="Master record for the scheme" />
      <FieldGrid>
        <Field label="Scheme Name"             value={data.scheme_name}             onChange={(v) => update("scheme_name", v)} colSpan={2} />
        <Field label="Scheme Type"             value={data.scheme_type}             onChange={(v) => update("scheme_type", v)}             type="select" options={["corporate","plant","dummy"]} />
        <Field label="WBS Element"             value={data.wbs_element}             onChange={(v) => update("wbs_element", v)} />
        <Field label="IPM/FA Code"             value={data.ipm_fa_code}             onChange={(v) => update("ipm_fa_code", v)} />
        <Field label="AMR Number"              value={data.amr_no}                  onChange={(v) => update("amr_no", v)} />
        <Field label="Estimated Cost (Cr)"     value={data.estimated_cost_cr}       onChange={(v) => update("estimated_cost_cr", parseFloat(v) || null)} type="number" />
        <Field label="Sanctioned Cost (Cr)"    value={data.sanctioned_cost_cr}      onChange={(v) => update("sanctioned_cost_cr", parseFloat(v) || null)} type="number" />
        <Field label="Anticipated Cost (Cr)"   value={data.anticipated_cost_cr}     onChange={(v) => update("anticipated_cost_cr", parseFloat(v) || null)} type="number" />
        <Field label="Scheme Owner"            value={data.scheme_owner_name}       onChange={(v) => update("scheme_owner_name", v)} />
        <Field label="Owner Designation"       value={data.scheme_owner_designation} onChange={(v) => update("scheme_owner_designation", v)} />
        <Field label="Steering Committee Chair" value={data.steering_committee_chair} onChange={(v) => update("steering_committee_chair", v)} />
        <Field label="Finance Controller"      value={data.finance_controller}      onChange={(v) => update("finance_controller", v)} />
      </FieldGrid>
    </div>
  );
}

function FormulationTab({ data, update }: any) {
  return (
    <div>
      <SectionTitle title="Formulation" subtitle="DPR preparation, consultant engagement, pre-NIT" />
      <FieldGrid>
        <Field label="Consultant Name"            value={data.consultant_name}             onChange={(v) => update("consultant_name", v)} colSpan={2} />
        <Field label="Consultant Acceptance Date" value={data.consultant_acceptance_date}  onChange={(v) => update("consultant_acceptance_date", v)} type="date" />
        <Field label="Draft FR/TS Date"           value={data.draft_fr_ts_date}            onChange={(v) => update("draft_fr_ts_date", v)} type="date" />
        <Field label="Final FR/TS (CE/EC) Date"   value={data.final_fr_ts_ce_ec_date}      onChange={(v) => update("final_fr_ts_ce_ec_date", v)} type="date" />
        <Field label="Pre-NIT Meeting Date"       value={data.pre_nit_meeting_date}        onChange={(v) => update("pre_nit_meeting_date", v)} type="date" />
        <Field label="Plant PAG Meeting Date"     value={data.plant_pag_meeting_date}      onChange={(v) => update("plant_pag_meeting_date", v)} type="date" />
        <Field label="DIC Approval Date"          value={data.dic_approval_date}           onChange={(v) => update("dic_approval_date", v)} type="date" />
        <Field label="Forwarded to Corporate"     value={data.forwarded_to_corporate_date} onChange={(v) => update("forwarded_to_corporate_date", v)} type="date" />
        <Field label="Cost (Gross, Cr)"           value={data.cost_gross_cr}               onChange={(v) => update("cost_gross_cr", parseFloat(v) || null)} type="number" />
        <Field label="Cost (Net of ITC, Cr)"      value={data.cost_net_itc_cr}             onChange={(v) => update("cost_net_itc_cr", parseFloat(v) || null)} type="number" />
        <Field label="Pre-NIT Participants"       value={data.pre_nit_participants}        onChange={(v) => update("pre_nit_participants", v)} colSpan={2} type="textarea" />
        <Field label="Remarks"                    value={data.remarks}                     onChange={(v) => update("remarks", v)} colSpan={2} type="textarea" />
      </FieldGrid>
    </div>
  );
}

function Stage1Tab({ data, update }: any) {
  return (
    <div>
      <SectionTitle title="Stage-I Approvals" subtitle="COD, Financial Appraisal, PAG, Chairman, PCSB, SAIL Board" />
      <FieldGrid>
        <Field label="COD Date"                          value={data.cod_date}                          onChange={(v) => update("cod_date", v)} type="date" />
        <Field label="Independent Financial Appraisal"   value={data.independent_financial_appraisal_date} onChange={(v) => update("independent_financial_appraisal_date", v)} type="date" />
        <Field label="Corporate PAG Date"                value={data.corporate_pag_date}                onChange={(v) => update("corporate_pag_date", v)} type="date" />
        <Field label="Chairman Approval Date"            value={data.chairman_approval_date}            onChange={(v) => update("chairman_approval_date", v)} type="date" />
        <Field label="PCSB Date"                         value={data.pcsb_date}                         onChange={(v) => update("pcsb_date", v)} type="date" />
        <Field label="SAIL Board Date"                   value={data.sail_board_date}                   onChange={(v) => update("sail_board_date", v)} type="date" />
        <Field label="Sanction Date 🚀"                  value={data.sanction_date}                     onChange={(v) => update("sanction_date", v)} type="date" />
        <Field label="Order Date"                        value={data.order_date}                        onChange={(v) => update("order_date", v)} type="date" />
        <Field label="Cost (Gross, Cr)"                  value={data.cost_gross_cr}                     onChange={(v) => update("cost_gross_cr", parseFloat(v) || null)} type="number" />
        <Field label="Cost (Net of ITC, Cr)"             value={data.cost_net_itc_cr}                   onChange={(v) => update("cost_net_itc_cr", parseFloat(v) || null)} type="number" />
        <Field label="Implementation Period (months)"    value={data.implementation_period_months}      onChange={(v) => update("implementation_period_months", parseInt(v) || null)} type="number" />
        <Field label="Remarks"                           value={data.remarks}                           onChange={(v) => update("remarks", v)} colSpan={2} type="textarea" />
      </FieldGrid>
    </div>
  );
}

function Stage2Tab({ data, update }: any) {
  return (
    <div>
      <SectionTitle title="Stage-II Sanction" subtitle="Firmed-up cost, variances, board approval" />
      <FieldGrid>
        <Field label="Draft Board Note Date"            value={data.draft_board_note_date}        onChange={(v) => update("draft_board_note_date", v)} type="date" />
        <Field label="Proposal to CO Date"              value={data.proposal_to_co_date}          onChange={(v) => update("proposal_to_co_date", v)} type="date" />
        <Field label="Firmed-up Cost (Net ITC, Cr)"     value={data.firmed_up_cost_net_itc_cr}    onChange={(v) => update("firmed_up_cost_net_itc_cr", parseFloat(v) || null)} type="number" />
        <Field label="Firmed-up Cost (Gross, Cr)"       value={data.firmed_up_cost_gross_cr}      onChange={(v) => update("firmed_up_cost_gross_cr", parseFloat(v) || null)} type="number" />
        <Field label="Consultant Estimate (Cr)"         value={data.consultant_estimate_cr}       onChange={(v) => update("consultant_estimate_cr", parseFloat(v) || null)} type="number" />
        <Field label="Variance vs Stage-I (%)"          value={data.variance_vs_stage1_pct}       onChange={(v) => update("variance_vs_stage1_pct", parseFloat(v) || null)} type="number" />
        <Field label="Variance vs Consultant (%)"       value={data.variance_vs_consultant_pct}   onChange={(v) => update("variance_vs_consultant_pct", parseFloat(v) || null)} type="number" />
        <Field label="COD Date"                         value={data.cod_date}                     onChange={(v) => update("cod_date", v)} type="date" />
        <Field label="PAG Date"                         value={data.pag_date}                     onChange={(v) => update("pag_date", v)} type="date" />
        <Field label="Chairman Approval"                value={data.chairman_approval_date}       onChange={(v) => update("chairman_approval_date", v)} type="date" />
        <Field label="PCSB Date"                        value={data.pcsb_date}                    onChange={(v) => update("pcsb_date", v)} type="date" />
        <Field label="SAIL Board Date"                  value={data.sail_board_date}              onChange={(v) => update("sail_board_date", v)} type="date" />
        <Field label="Empowered Committee Date"         value={data.empowered_committee_date}     onChange={(v) => update("empowered_committee_date", v)} type="date" />
        <Field label="Sanction Date 🚀"                 value={data.sanction_date}                onChange={(v) => update("sanction_date", v)} type="date" />
        <Field label="Order Date"                       value={data.order_date}                   onChange={(v) => update("order_date", v)} type="date" />
        <Field label="Remarks"                          value={data.remarks}                      onChange={(v) => update("remarks", v)} colSpan={2} type="textarea" />
      </FieldGrid>
    </div>
  );
}

function PackagesTab({ data, activePackageId, setActivePackageId, update }: any) {
  const active = data.find((p: any) => p.package_id === activePackageId);
  return (
    <div>
      <SectionTitle title="Packages" subtitle={`${data.length} package${data.length !== 1 ? "s" : ""} in this scheme`} />

      {/* Package selector pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {data.map((p: any) => (
          <button
            key={p.package_id}
            onClick={() => setActivePackageId(p.package_id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              p.package_id === activePackageId
                ? "bg-cyan-600 text-white"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            #{p.package_no} {p.package_name?.slice(0, 30)}{p.package_name?.length > 30 ? "…" : ""}
            {p.is_scheme_mirror && <span className="ml-2 text-[10px] opacity-60">[mirror]</span>}
          </button>
        ))}
        <button className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 border border-dashed border-zinc-700 text-zinc-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all">
          <Plus size={14} className="inline mr-1" /> Add Package
        </button>
      </div>

      {active && (
        <FieldGrid>
          <Field label="Package Name"          value={active.package_name}        onChange={(v) => update("package_name", v, active.package_id)} colSpan={2} />
          <Field label="Package Status"        value={active.package_status}      onChange={(v) => update("package_status", v, active.package_id)} type="select" options={["planned","tendering","awarded","executing","commissioned","closed","on_hold","cancelled"]} />
          <Field label="Package Type"          value={active.package_type}        onChange={(v) => update("package_type", v, active.package_id)} />
          <Field label="Package Estimate (Cr)" value={active.package_estimate_cr} onChange={(v) => update("package_estimate_cr", parseFloat(v) || null, active.package_id)} type="number" />
          <Field label="Package Value (Cr)"    value={active.package_value_cr}    onChange={(v) => update("package_value_cr", parseFloat(v) || null, active.package_id)} type="number" />
          <Field label="Project Manager"       value={active.project_manager_name} onChange={(v) => update("project_manager_name", v, active.package_id)} />
          <Field label="PM Email"              value={active.project_manager_email} onChange={(v) => update("project_manager_email", v, active.package_id)} />
          <Field label="PM Phone"              value={active.project_manager_phone} onChange={(v) => update("project_manager_phone", v, active.package_id)} />
          <Field label="Executing Agency"      value={active.executing_agency}    onChange={(v) => update("executing_agency", v, active.package_id)} />
          <Field label="Consultant"            value={active.consultant_name}     onChange={(v) => update("consultant_name", v, active.package_id)} />
          <Field label="PMC"                   value={active.consultant_pmc}      onChange={(v) => update("consultant_pmc", v, active.package_id)} />
          <Field label="Section In-Charge"     value={active.section_in_charge}   onChange={(v) => update("section_in_charge", v, active.package_id)} />
          <Field label="Safety Officer"        value={active.safety_officer}      onChange={(v) => update("safety_officer", v, active.package_id)} />
          <Field label="Quality Officer"       value={active.quality_officer}     onChange={(v) => update("quality_officer", v, active.package_id)} />
          <Field label="Site Location"         value={active.site_location}       onChange={(v) => update("site_location", v, active.package_id)} />
          <Field label="Start Date (Actual)"   value={active.start_date_actual}   onChange={(v) => update("start_date_actual", v, active.package_id)} type="date" />
          <Field label="Package Scope"         value={active.package_scope}       onChange={(v) => update("package_scope", v, active.package_id)} colSpan={2} type="textarea" />
          <Field label="Remarks"               value={active.remarks}             onChange={(v) => update("remarks", v, active.package_id)} colSpan={2} type="textarea" />
        </FieldGrid>
      )}
    </div>
  );
}

function TenderingTab({ data, packages }: any) {
  return (
    <div>
      <SectionTitle title="Tendering" subtitle={`${data.length} tender cycle${data.length !== 1 ? "s" : ""} across all packages`} />
      <div className="space-y-3">
        {data.length === 0 && (
          <div className="text-zinc-500 text-sm italic">No tender cycles recorded yet. Add one from the package detail to start the tendering process.</div>
        )}
        {data.map((c: any) => (
          <div key={c.tender_cycle_id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-bold text-white">{c.package_name}</div>
                <div className="text-xs text-zinc-500">Cycle #{c.cycle_no} {c.cycle_label && `· ${c.cycle_label}`}</div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs uppercase tracking-wider ${
                c.cycle_status === "awarded" ? "bg-emerald-500/10 text-emerald-400" :
                c.cycle_status === "cancelled" ? "bg-red-500/10 text-red-400" :
                "bg-amber-500/10 text-amber-400"
              }`}>{c.cycle_status}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-zinc-500">NIT No: </span><span className="text-white">{c.nit_number || "—"}</span></div>
              <div><span className="text-zinc-500">NIT Date: </span><span className="text-white">{c.nit_date || "—"}</span></div>
              <div><span className="text-zinc-500">Mode: </span><span className="text-white">{c.mode_of_tender || "—"}</span></div>
              <div><span className="text-zinc-500">Offers: </span><span className="text-white">{c.offers_received_count ?? "—"}</span></div>
              <div><span className="text-zinc-500">TOD: </span><span className="text-white">{c.tod_original_date || "—"}</span></div>
              <div><span className="text-zinc-500">Extensions: </span><span className="text-white">{c.tod_extensions?.length ?? 0}</span></div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500 mt-6">
        💡 Inline editing of tender cycles coming in Sprint 2 (TOD Tracking page).
      </p>
    </div>
  );
}

function ContractsTab({ data, packages, activePackageId, setActivePackageId, update }: any) {
  const active = data.find((c: any) => c.package_id === activePackageId);
  return (
    <div>
      <SectionTitle title="Contracts" subtitle={`${data.length} contract${data.length !== 1 ? "s" : ""}`} />

      <div className="flex flex-wrap gap-2 mb-6">
        {packages.map((p: any) => {
          const has = data.some((c: any) => c.package_id === p.package_id);
          return (
            <button
              key={p.package_id}
              onClick={() => setActivePackageId(p.package_id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                p.package_id === activePackageId
                  ? "bg-cyan-600 text-white"
                  : has ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500 border border-dashed border-zinc-700"
              }`}
            >
              #{p.package_no}
            </button>
          );
        })}
      </div>

      {!active && (
        <div className="text-zinc-500 text-sm italic mb-6">
          No contract on this package yet. Filling fields below will create one.
        </div>
      )}

      <FieldGrid>
        <Field label="Contract No"               value={active?.contract_no || ""}             onChange={(v) => update("contract_no", v, activePackageId)} />
        <Field label="Contractor Name"           value={active?.contractor_name || ""}         onChange={(v) => update("contractor_name", v, activePackageId)} colSpan={2} />
        <Field label="LOA Date"                  value={active?.loa_date || ""}                onChange={(v) => update("loa_date", v, activePackageId)} type="date" />
        <Field label="Contract Signing Date"     value={active?.contract_signing_date || ""}   onChange={(v) => update("contract_signing_date", v, activePackageId)} type="date" />
        <Field label="Effective Date 🚀"         value={active?.effective_date || ""}          onChange={(v) => update("effective_date", v, activePackageId)} type="date" />
        <Field label="Scheduled Completion"      value={active?.scheduled_completion_date || ""} onChange={(v) => update("scheduled_completion_date", v, activePackageId)} type="date" />
        <Field label="Likely Completion"         value={active?.likely_completion_date || ""}  onChange={(v) => update("likely_completion_date", v, activePackageId)} type="date" />
        <Field label="Cost (Net ITC, Cr)"        value={active?.contract_cost_net_itc_cr || ""} onChange={(v) => update("contract_cost_net_itc_cr", parseFloat(v) || null, activePackageId)} type="number" />
        <Field label="Cost (Gross, Cr)"          value={active?.contract_cost_gross_cr || ""}  onChange={(v) => update("contract_cost_gross_cr", parseFloat(v) || null, activePackageId)} type="number" />
        <Field label="Delay Reason"              value={active?.delay_reason || ""}            onChange={(v) => update("delay_reason", v, activePackageId)} colSpan={2} type="textarea" />
        <Field label="Remarks"                   value={active?.remarks || ""}                 onChange={(v) => update("remarks", v, activePackageId)} colSpan={2} type="textarea" />
      </FieldGrid>
    </div>
  );
}

function CompletionTab({ data, packages, activePackageId, setActivePackageId, update }: any) {
  const active = data.find((c: any) => c.package_id === activePackageId);
  return (
    <div>
      <SectionTitle title="Completion" subtitle="PAC, Commissioning, FAC, Closure" />

      <div className="flex flex-wrap gap-2 mb-6">
        {packages.map((p: any) => {
          const has = data.some((c: any) => c.package_id === p.package_id);
          return (
            <button
              key={p.package_id}
              onClick={() => setActivePackageId(p.package_id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                p.package_id === activePackageId
                  ? "bg-cyan-600 text-white"
                  : has ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500 border border-dashed border-zinc-700"
              }`}
            >
              #{p.package_no}
            </button>
          );
        })}
      </div>

      <FieldGrid>
        <Field label="PAC Date"                       value={active?.pac_date || ""}                       onChange={(v) => update("pac_date", v, activePackageId)} type="date" />
        <Field label="Commissioning Date 🚀"          value={active?.commissioning_date || ""}             onChange={(v) => update("commissioning_date", v, activePackageId)} type="date" />
        <Field label="Delay Analysis Approval"        value={active?.delay_analysis_approval_date || ""}   onChange={(v) => update("delay_analysis_approval_date", v, activePackageId)} type="date" />
        <Field label="Contract Amendment Issue"       value={active?.contract_amendment_issue_date || ""}  onChange={(v) => update("contract_amendment_issue_date", v, activePackageId)} type="date" />
        <Field label="PG Date"                        value={active?.pg_date || ""}                        onChange={(v) => update("pg_date", v, activePackageId)} type="date" />
        <Field label="FAC Date"                       value={active?.fac_date || ""}                       onChange={(v) => update("fac_date", v, activePackageId)} type="date" />
        <Field label="FAC Payment Date"               value={active?.fac_payment_date || ""}               onChange={(v) => update("fac_payment_date", v, activePackageId)} type="date" />
        <Field label="Closure Date"                   value={active?.closure_date || ""}                   onChange={(v) => update("closure_date", v, activePackageId)} type="date" />
        <Field label="Remarks"                        value={active?.remarks || ""}                        onChange={(v) => update("remarks", v, activePackageId)} colSpan={2} type="textarea" />
      </FieldGrid>
    </div>
  );
}

function MonitoringTab({ data, saveSection }: any) {
  const [newLog, setNewLog] = useState({
    log_date: new Date().toISOString().split("T")[0],
    reason_for_delay: "",
    issues: "",
    action_taken: "",
    progress_status: "",
  });

  return (
    <div>
      <SectionTitle title="Monitoring Log" subtitle="Track issues, delays, and corrective actions" />

      {/* Add new log */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 mb-6">
        <div className="text-xs uppercase text-zinc-400 mb-3 font-bold">Add New Entry</div>
        <FieldGrid>
          <Field label="Date"              value={newLog.log_date}         onChange={(v) => setNewLog({ ...newLog, log_date: v })} type="date" />
          <Field label="Progress Status"   value={newLog.progress_status}  onChange={(v) => setNewLog({ ...newLog, progress_status: v })} />
          <Field label="Reason for Delay"  value={newLog.reason_for_delay} onChange={(v) => setNewLog({ ...newLog, reason_for_delay: v })} colSpan={2} type="textarea" />
          <Field label="Issues"            value={newLog.issues}           onChange={(v) => setNewLog({ ...newLog, issues: v })} colSpan={2} type="textarea" />
          <Field label="Action Taken"      value={newLog.action_taken}     onChange={(v) => setNewLog({ ...newLog, action_taken: v })} colSpan={2} type="textarea" />
        </FieldGrid>
        <button
          onClick={async () => {
            const r = await fetch(`${API}/${window.location.pathname.split("/")[2]}/section/monitoring`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newLog),
            });
            if (r.ok) {
              window.location.reload();
            }
          }}
          className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-bold"
        >
          <Plus size={14} className="inline mr-1" /> Add Log Entry
        </button>
      </div>

      {/* Existing logs */}
      <div className="space-y-3">
        <div className="text-xs uppercase text-zinc-400 font-bold mb-2">History ({data.length})</div>
        {data.map((l: any) => (
          <div key={l.log_id} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-cyan-400 font-mono text-xs">{l.log_date}</span>
              <span className="text-zinc-500 text-xs">{l.progress_status || "—"}</span>
            </div>
            {l.reason_for_delay && <div className="text-zinc-300 mb-1"><span className="text-zinc-500 text-xs uppercase mr-2">Delay:</span> {l.reason_for_delay}</div>}
            {l.issues && <div className="text-zinc-300 mb-1"><span className="text-zinc-500 text-xs uppercase mr-2">Issues:</span> {l.issues}</div>}
            {l.action_taken && <div className="text-zinc-300"><span className="text-zinc-500 text-xs uppercase mr-2">Action:</span> {l.action_taken}</div>}
          </div>
        ))}
        {data.length === 0 && <div className="text-zinc-500 italic text-sm">No monitoring entries yet.</div>}
      </div>
    </div>
  );
}

// =============================================================================
//   PRIMITIVES
// =============================================================================
function SectionTitle({ title, subtitle }: any) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-black text-white">{title}</h2>
      {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function FieldGrid({ children }: any) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

function Field({ label, value, onChange, type = "text", options, colSpan = 1 }: any) {
  const v = value ?? "";
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : ""}>
      <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5 font-medium">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={v}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
        />
      ) : type === "select" ? (
        <select
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
        >
          <option value="">— Select —</option>
          {options.map((o: string) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
        />
      )}
    </div>
  );
}

function getStatusStyle(status: string): string {
  const map: Record<string, string> = {
    ongoing:            "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    under_tendering:    "bg-amber-500/10 text-amber-300 border-amber-500/30",
    under_stage1:       "bg-blue-500/10 text-blue-300 border-blue-500/30",
    under_stage2:       "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
    under_formulation:  "bg-purple-500/10 text-purple-300 border-purple-500/30",
    closed:             "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
    on_hold:            "bg-orange-500/10 text-orange-300 border-orange-500/30",
    dropped:            "bg-red-500/10 text-red-300 border-red-500/30",
  };
  return map[status] || "bg-zinc-500/10 text-zinc-300 border-zinc-500/30";
}