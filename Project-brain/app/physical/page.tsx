"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  LayoutGrid,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useMos } from "@/components/brain/MosContext";

export default function PhysicalProgressHub() {
  const router = useRouter();
  const { focusField, speakAndChat } = useMos();
  const [activeModule, setActiveModule] = useState<"none" | "corporate">("none");

  // Corporate State
  const [corpView, setCorpView] = useState<"dash" | "plan_create" | "actual_entry">("dash");
  const [corpScheme, setCorpScheme] = useState("");
  const [corpFY, setCorpFY] = useState("2026-27");
  const [corpMonth, setCorpMonth] = useState("");

  // Appendix 2 Excel Grid State (Corporate Plan)
  const [planStatus, setPlanStatus] = useState<"Draft" | "Active">("Draft");
  const [activities, setActivities] = useState<any[]>([]);
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

  const totalWeightage = activities.reduce((sum, act) => sum + (parseFloat(act.weightage) || 0), 0);

  // --- Corporate Logic Functions ---
  const updateActivity = (idx: number, patch: Record<string, any>) => {
    setActivities((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const handleLoadCorporateData = () => {
    if (!corpScheme || !corpFY || !corpMonth) return speakAndChat("Select Scheme, FY, and Month to load data.", "⚠️");
    speakAndChat("Loading active plan and calculating variance...", "🔄");
  };

  const handleValidatePlan = () => {
    if (totalWeightage > 100)
      speakAndChat(`Validation Error: Total weightage is ${totalWeightage}%. It cannot exceed 100%.`, "❌");
    else if (totalWeightage < 100)
      speakAndChat(
        `Validation Warning: Total weightage is ${totalWeightage}%. You must reach 100% to activate. Draft saved.`,
        "⚠️"
      );
    else speakAndChat("Validation Success: Weightage is exactly 100%. No errors found. Ready for activation.", "✅");
  };

  const handleActivatePlan = () => {
    if (totalWeightage !== 100) return speakAndChat("Cannot activate. Total weightage must be exactly 100%.", "❌");
    setPlanStatus("Active");
    speakAndChat("Plan Activated! Version 1 locked. You can now enter actuals.", "🚀");
  };

  return (
    <div className="mx-auto max-w-7xl pb-32 text-[var(--ink)]">
      <h1 className="mb-8 flex items-center gap-4 font-[Space_Grotesk] text-5xl font-bold">
        <Activity className="h-10 w-10 text-[var(--steel)]" />
        Physical Progress Command Center
      </h1>

      {activeModule === "none" && (
        <div className="grid grid-cols-2 gap-8 mt-12">
          <Link
            href="/progress/corporate"
            className="group relative block overflow-hidden rounded-3xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] p-10 text-left shadow-[var(--shadow)] transition-all hover:-translate-y-1 hover:border-[var(--steel)] hover:shadow-[var(--shadow-lg)]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[color-mix(in_srgb,var(--steel)_16%,transparent)] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <LayoutGrid className="mb-6 h-12 w-12 text-[var(--steel)]" />
            <h2 className="mb-2 text-3xl font-bold text-[var(--ink)]">Corporate AMR Progress</h2>
            <p className="text-[var(--ink-3)]">
              Activity-wise planning, Appendix 2 Excel grid, and exact weightage tracking.
            </p>
          </Link>

          <button onClick={() => {
              speakAndChat("Plant AMR Progress selected. Routing to the bulk workspace.", "🌱");
              router.push('/physical/plant');
            }}
            className="group relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] p-10 text-left shadow-[var(--shadow)] transition-all hover:-translate-y-1 hover:border-[var(--verdigris)] hover:shadow-[var(--shadow-lg)]">
            <div className="absolute inset-0 bg-gradient-to-br from-[color-mix(in_srgb,var(--verdigris)_16%,transparent)] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <Activity className="mb-6 h-12 w-12 text-[var(--verdigris)]" />
            <h2 className="mb-2 text-3xl font-bold text-[var(--ink)]">Plant AMR Progress</h2>
            <p className="text-[var(--ink-3)]">Simplified month-wise cumulative tracking. Bulk Excel-style grid entry.</p>
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {activeModule === "corporate" && corpView === "dash" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-black/50 border border-zinc-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-6">
              <h2 className="text-3xl font-bold text-cyan-400">Corporate Dashboard</h2>
              <button onClick={() => setActiveModule("none")} className="text-zinc-500 hover:text-white">
                Back to Hub
              </button>
            </div>

            <div className="grid grid-cols-3 gap-6 mb-10">
              <select
                value={corpScheme}
                onChange={(e) => setCorpScheme(e.target.value)}
                onFocus={(e) => focusField(e, "Select the Corporate Scheme.", "🔍")}
                className="glass-input rounded-xl px-5 py-4 text-white outline-none appearance-none"
              >
                <option value="" className="text-black">
                  -- Select Scheme --
                </option>
                <option value="1" className="text-black">
                  Blast Furnace #3 Mod
                </option>
              </select>
              <select
                value={corpFY}
                onChange={(e) => setCorpFY(e.target.value)}
                className="glass-input rounded-xl px-5 py-4 text-white outline-none appearance-none"
              >
                <option value="2026-27" className="text-black">
                  FY 2026-27
                </option>
              </select>
              <input
                type="month"
                value={corpMonth}
                onChange={(e) => setCorpMonth(e.target.value)}
                className="glass-input rounded-xl px-5 py-4 text-white outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <button
                onClick={handleLoadCorporateData}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-4 rounded-xl font-bold transition-all"
              >
                Load Data
              </button>
              <button
                onClick={() => {
                  setCorpView("plan_create");
                  speakAndChat("Opening Appendix 2 Excel Interface for Plan Creation.", "📝");
                }}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 shadow-[0_0_15px_rgba(34,211,238,0.3)]"
              >
                <FileSpreadsheet className="w-5 h-5" /> Create Plan
              </button>
              <button
                onClick={() =>
                  speakAndChat(
                    "Modify Plan: Select Minor Edit (updates current version) or Create Revised Plan (new version).",
                    "⚙️"
                  )
                }
                className="bg-amber-600 hover:bg-amber-500 text-white px-8 py-4 rounded-xl font-bold"
              >
                Modify Plan
              </button>
              <button
                onClick={() =>
                  speakAndChat("Opening Actuals Entry Grid. Values cannot be less than previous month.", "📊")
                }
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded-xl font-bold"
              >
                Enter Actual
              </button>
            </div>
          </motion.div>
        )}

        {activeModule === "corporate" && corpView === "plan_create" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-black/60 border border-zinc-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-cyan-400">Plan Creation Window (Appendix 2)</h2>
                <span
                  className={`text-xs px-3 py-1 rounded-full mt-2 inline-block ${
                    planStatus === "Draft"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  }`}
                >
                  Status: {planStatus}
                </span>
              </div>
              <div
                className={`px-4 py-2 rounded-xl font-bold font-mono text-lg border ${
                  totalWeightage === 100
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                    : "bg-zinc-900 border-zinc-700 text-white"
                }`}
              >
                Σ Weightage: {totalWeightage}%
              </div>
            </div>

            <div className="overflow-x-auto border border-zinc-800 rounded-xl mb-6 custom-scrollbar bg-zinc-950">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="p-3 sticky left-0 bg-zinc-900 z-10 w-48 border-r border-zinc-800">
                      Activity Name
                    </th>
                    <th className="p-3 border-r border-zinc-800 w-20">UOM</th>
                    <th className="p-3 border-r border-zinc-800 w-24">Scope</th>
                    <th className="p-3 border-r border-zinc-800 w-24">Weightage (%)</th>
                    {months.map((m) => (
                      <th key={m} className="p-3 border-r border-zinc-800 text-center w-20">
                        {m}
                      </th>
                    ))}
                    <th className="p-3 text-center w-12">Act</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {activities.map((act, idx) => (
                    <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="p-0 sticky left-0 z-10 bg-zinc-950 border-r border-zinc-800">
                        <input
                          type="text"
                          value={act.name}
                          disabled={planStatus === "Active"}
                          className="w-full h-full bg-transparent p-3 outline-none focus:bg-zinc-900"
                          placeholder="e.g. Excavation"
                        />
                      </td>
                      <td className="p-0 border-r border-zinc-800">
                        <input
                          type="text"
                          disabled={planStatus === "Active"}
                          className="w-full h-full bg-transparent p-3 outline-none focus:bg-zinc-900 text-center"
                          placeholder="Cum"
                        />
                      </td>
                      <td className="p-0 border-r border-zinc-800">
                        <input
                          type="number"
                          disabled={planStatus === "Active"}
                          className="w-full h-full bg-transparent p-3 outline-none focus:bg-zinc-900 text-right font-mono text-cyan-400"
                          placeholder="0"
                        />
                      </td>
                      <td className="p-0 border-r border-zinc-800">
                        <input
                          type="number"
                          value={act.weightage}
                          disabled={planStatus === "Active"}
                          onChange={(e) => updateActivity(idx, { weightage: e.target.value })}
                          className="w-full h-full bg-transparent p-3 outline-none focus:bg-zinc-900 text-right font-mono text-amber-400"
                          placeholder="0"
                        />
                      </td>
                      {months.map((m) => (
                        <td key={m} className="p-0 border-r border-zinc-800">
                          <input
                            type="number"
                            disabled={planStatus === "Active"}
                            className="w-full h-full bg-transparent p-3 outline-none focus:bg-zinc-900 text-right font-mono text-zinc-300"
                            placeholder="-"
                          />
                        </td>
                      ))}
                      <td className="p-2 text-center">
                        <button
                          onClick={() => {
                            if (planStatus === "Active") return speakAndChat("Cannot delete in Active Plan.", "❌");
                            setActivities(activities.filter((_, i) => i !== idx));
                          }}
                          className="text-red-500 hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center">
              <button
                onClick={() =>
                  setActivities([
                    ...activities,
                    {
                      name: "",
                      uom: "",
                      scope: "",
                      weightage: "",
                    }
                  ])
                }
                disabled={planStatus === "Active"}
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-2 font-bold px-4 py-2 border border-dashed border-cyan-400/50 rounded-lg"
              >
                <Plus className="w-4 h-4" /> Add Activity
              </button>

              <div className="flex gap-3">
                <button onClick={() => setCorpView("dash")} className="text-zinc-400 hover:text-white px-6 py-3">
                  Cancel
                </button>
                <button
                  onClick={() => speakAndChat("Draft Saved without strict validation.", "💾")}
                  disabled={planStatus === "Active"}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2"
                >
                  <Save className="w-4 h-4" /> Save Draft
                </button>
                <button
                  onClick={handleValidatePlan}
                  className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" /> Validate
                </button>
                <button
                  onClick={handleActivatePlan}
                  disabled={planStatus === "Active"}
                  className="bg-emerald-600 disabled:opacity-50 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" /> Activate Plan
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
