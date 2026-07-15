"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckSquare, Plus, RefreshCw, ChevronDown, ChevronRight,
  FileText, Truck, ClipboardList, Building2, Save, Trash2
} from "lucide-react";

const API = "http://localhost:8000/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

type Scheme = {
  scheme_id: number;
  scheme_name: string;
  current_status: string;
  scheme_type: string;
  total_cost: number;
  scheduled_completion: string;
  expected_completion: string;
};

type Milestone = {
  id: number;
  milestone_name: string;
  category: string;
  planned_date: string | null;
  actual_date: string | null;
  is_completed: boolean;
  completion_pct: number;
  responsible_person: string | null;
  remarks: string | null;
  display_order: number;
};

type TOD = {
  id: number;
  tod_number: number;
  expected_date: string | null;
  actual_date: string | null;
  tod_value_cr: number | null;
  remarks: string | null;
  is_received: boolean;
};

type Appendix2Row = {
  id?: number;
  s_no: string;
  category: string;
  item: string;
  commencement_months: number | null;
  completion_months: number | null;
  schedule_start: string | null;
  schedule_finish: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "contract", label: "Contract Details", icon: Building2 },
  { id: "appendix", label: "Appendix-II", icon: FileText },
  { id: "tod", label: "TOD Tracking", icon: Truck },
  { id: "checklist", label: "Execution Checklist", icon: ClipboardList },
] as const;

type TabId = typeof TABS[number]["id"];

const CATEGORY_COLORS: Record<string, string> = {
  "Pre-Construction": "border-blue-500/40 text-blue-400",
  "Procurement": "border-violet-500/40 text-violet-400",
  "Installation": "border-cyan-500/40 text-cyan-400",
  "Commissioning": "border-emerald-500/40 text-emerald-400",
  "Closure": "border-orange-500/40 text-orange-400",
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ExecutionPage({ initialTab = "contract" }: { initialTab?: TabId } = {}) {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // Checklist state
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<Milestone>>({});

  // TOD state
  const [tods, setTods] = useState<TOD[]>([]);
  const [loadingTod, setLoadingTod] = useState(false);
  const [newTod, setNewTod] = useState({ expected_date: "", tod_value_cr: "", remarks: "" });
  const [addingTod, setAddingTod] = useState(false);

  // Appendix-II state
  const [appendixRows, setAppendixRows] = useState<Appendix2Row[]>([]);
  const [loadingAppendix, setLoadingAppendix] = useState(false);
  const [savingAppendix, setSavingAppendix] = useState(false);

  // Load schemes on mount
  useEffect(() => {
    fetch(`${API}/view/all`)
      .then((r) => r.json())
      .then((data: Scheme[]) => {
        setSchemes(data);
        if (data.length > 0) setSelectedId(String(data[0].scheme_id));
      })
      .catch(console.error);
  }, []);

  // Load data when scheme or tab changes
  useEffect(() => {
    if (!selectedId) return;
    if (activeTab === "checklist") loadMilestones();
    if (activeTab === "tod") loadTods();
    if (activeTab === "appendix") loadAppendix();
  }, [selectedId, activeTab]);

  const selectedScheme = schemes.find((s) => String(s.scheme_id) === selectedId);

  // ── Checklist ────────────────────────────────────────────────────────────────

  const loadMilestones = async () => {
    setLoadingChecklist(true);
    try {
      const res = await fetch(`${API}/execution/${selectedId}`);
      setMilestones(res.ok ? await res.json() : []);
    } catch {
      setMilestones([]);
    } finally {
      setLoadingChecklist(false);
    }
  };

  const initFromTemplate = async () => {
    if (!confirm("Initialize milestones from default template?")) return;
    const res = await fetch(
      `${API}/execution/create-from-template?scheme_id=${selectedId}`,
      { method: "POST" }
    );
    if (res.ok) loadMilestones();
    else alert("Failed to initialize from template.");
  };

  const saveEdit = async (id: number) => {
    const payload: Record<string, unknown> = { ...editValues };
    if (!payload.actual_date) delete payload.actual_date;
    await fetch(`${API}/execution/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditing(null);
    loadMilestones();
  };

  const overallPct = milestones.length
    ? Math.round(milestones.reduce((s, m) => s + (m.completion_pct ?? 0), 0) / milestones.length)
    : 0;

  // ── TOD ──────────────────────────────────────────────────────────────────────

  const loadTods = async () => {
    setLoadingTod(true);
    try {
      const res = await fetch(`${API}/tods/${selectedId}`);
      setTods(res.ok ? await res.json() : []);
    } catch {
      setTods([]);
    } finally {
      setLoadingTod(false);
    }
  };

  const createTod = async () => {
    setAddingTod(true);
    try {
      const res = await fetch(`${API}/tods/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheme_id: Number(selectedId),
          tod_number: tods.length + 1,
          expected_date: newTod.expected_date || null,
          tod_value_cr: newTod.tod_value_cr ? Number(newTod.tod_value_cr) : null,
          remarks: newTod.remarks || null,
        }),
      });
      if (res.ok) {
        setNewTod({ expected_date: "", tod_value_cr: "", remarks: "" });
        loadTods();
      }
    } finally {
      setAddingTod(false);
    }
  };

  // ── Appendix-II ──────────────────────────────────────────────────────────────

  const loadAppendix = async () => {
    setLoadingAppendix(true);
    try {
      const res = await fetch(`${API}/appendix2/${selectedId}`);
      setAppendixRows(res.ok ? await res.json() : []);
    } catch {
      setAppendixRows([]);
    } finally {
      setLoadingAppendix(false);
    }
  };

  const saveAppendix = async () => {
    setSavingAppendix(true);
    try {
      await fetch(`${API}/appendix2/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme_id: Number(selectedId), rows: appendixRows }),
      });
    } finally {
      setSavingAppendix(false);
    }
  };

  const addAppendixRow = () => {
    setAppendixRows((r) => [
      ...r,
      { s_no: "", category: "", item: "", commencement_months: null, completion_months: null, schedule_start: null, schedule_finish: null },
    ]);
  };

  const updateAppendixCell = (idx: number, field: keyof Appendix2Row, value: string) => {
    setAppendixRows((rows) =>
      rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              [field]:
                field === "commencement_months" || field === "completion_months"
                  ? value === "" ? null : Number(value)
                  : value === "" ? null : value,
            }
          : r
      )
    );
  };

  const removeAppendixRow = (idx: number) => {
    setAppendixRows((r) => r.filter((_, i) => i !== idx));
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-8 pt-10 text-white bg-zinc-950">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">
            <CheckSquare className="h-8 w-8 text-emerald-400 shrink-0" style={{ WebkitTextFillColor: "initial" }} />
            Execution Tracker
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Contract details, milestones, TOD &amp; Appendix-II</p>
        </div>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-[320px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-semibold outline-none focus:border-emerald-400 text-sm"
        >
          {schemes.map((s) => (
            <option key={s.scheme_id} value={s.scheme_id}>
              [{s.scheme_id}] {s.scheme_name}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: CONTRACT DETAILS ─────────────────────────────────────────────── */}
      {activeTab === "contract" && selectedScheme && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Scheme overview */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Scheme Name", value: selectedScheme.scheme_name },
              { label: "Type", value: selectedScheme.scheme_type },
              { label: "Status", value: selectedScheme.current_status },
              { label: "Total Cost", value: selectedScheme.total_cost ? `₹${selectedScheme.total_cost.toLocaleString("en-IN")} Cr` : "—" },
              { label: "Scheduled Completion", value: selectedScheme.scheduled_completion || "—" },
              { label: "Expected Completion", value: selectedScheme.expected_completion || "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
                <p className="text-xs text-zinc-500 mb-1">{label}</p>
                <p className="text-sm font-semibold text-white capitalize">{value}</p>
              </div>
            ))}
          </div>

          {/* Contract Details form */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="text-sm font-bold text-zinc-300 mb-5 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" /> Contract &amp; Contractor Information
            </h3>
            <div className="grid grid-cols-2 gap-5">
              {[
                { label: "Contractor Name", field: "contractor_name", type: "text", placeholder: "Enter contractor name" },
                { label: "LOA Date", field: "loa_date", type: "date", placeholder: "" },
                { label: "Effective Date", field: "effective_date", type: "date", placeholder: "" },
                { label: "Schedule (months)", field: "schedule_months", type: "number", placeholder: "e.g. 24" },
                { label: "Expected TOD Date", field: "expected_tod_date", type: "date", placeholder: "" },
                { label: "Final TOD Date", field: "final_tod_date", type: "date", placeholder: "" },
                { label: "COD Date", field: "cod_date", type: "date", placeholder: "" },
                { label: "DIC Recommendation Date", field: "dic_recommendation_date", type: "date", placeholder: "" },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className="text-xs text-zinc-500 block mb-1">{label}</label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400 transition-colors"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-zinc-500 block mb-1">Dropped Reason</label>
                <input
                  type="text"
                  placeholder="If project dropped, reason..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-4 flex-wrap">
              {[
                "Tender Cancelled",
                "Stage-1 Cost Cleared",
                "Stage-2 Cost Cleared",
                "COD Cleared",
                "Completion Marked",
                "Commissioned",
                "Project Dropped",
              ].map((flag) => (
                <label key={flag} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="checkbox" className="accent-emerald-500 w-4 h-4" />
                  {flag}
                </label>
              ))}
            </div>
            <p className="mt-4 text-xs text-zinc-600">
              Note: These fields will be persisted once the scheme detail update API is connected.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── TAB: APPENDIX-II ─────────────────────────────────────────────────── */}
      {activeTab === "appendix" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" /> Appendix-II — Contract Schedule
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={addAppendixRow}
                  className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Row
                </button>
                <button
                  onClick={saveAppendix}
                  disabled={savingAppendix}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {savingAppendix ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
            {loadingAppendix ? (
              <div className="py-12 text-center text-cyan-400 animate-pulse text-sm">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-zinc-900 text-zinc-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 w-8">#</th>
                      <th className="px-4 py-3 w-16">S.No</th>
                      <th className="px-4 py-3 w-32">Category</th>
                      <th className="px-4 py-3 min-w-[200px]">Item</th>
                      <th className="px-4 py-3 text-right">Comm. Mo.</th>
                      <th className="px-4 py-3 text-right">Compl. Mo.</th>
                      <th className="px-4 py-3">Start</th>
                      <th className="px-4 py-3">Finish</th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {appendixRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-zinc-600">
                          No rows yet. Click "Add Row" to start.
                        </td>
                      </tr>
                    ) : (
                      appendixRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="px-4 py-2 text-zinc-600">{idx + 1}</td>
                          {(["s_no", "category", "item"] as const).map((f) => (
                            <td key={f} className="px-2 py-1.5">
                              <input
                                type="text"
                                value={(row[f] as string) ?? ""}
                                onChange={(e) => updateAppendixCell(idx, f, e.target.value)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white outline-none focus:border-cyan-400"
                              />
                            </td>
                          ))}
                          {(["commencement_months", "completion_months"] as const).map((f) => (
                            <td key={f} className="px-2 py-1.5">
                              <input
                                type="number"
                                value={row[f] ?? ""}
                                onChange={(e) => updateAppendixCell(idx, f, e.target.value)}
                                className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white text-right outline-none focus:border-cyan-400"
                              />
                            </td>
                          ))}
                          {(["schedule_start", "schedule_finish"] as const).map((f) => (
                            <td key={f} className="px-2 py-1.5">
                              <input
                                type="date"
                                value={row[f] ?? ""}
                                onChange={(e) => updateAppendixCell(idx, f, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-white outline-none focus:border-cyan-400"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            <button onClick={() => removeAppendixRow(idx)} className="text-zinc-600 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── TAB: TOD TRACKING ────────────────────────────────────────────────── */}
      {activeTab === "tod" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Add TOD */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-bold text-zinc-300 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" /> Add New TOD
            </h3>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Expected Date</label>
                <input
                  type="date"
                  value={newTod.expected_date}
                  onChange={(e) => setNewTod((v) => ({ ...v, expected_date: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Value (Cr)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={newTod.tod_value_cr}
                  onChange={(e) => setNewTod((v) => ({ ...v, tod_value_cr: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Remarks</label>
                <input
                  type="text"
                  placeholder="Optional..."
                  value={newTod.remarks}
                  onChange={(e) => setNewTod((v) => ({ ...v, remarks: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                />
              </div>
              <button
                onClick={createTod}
                disabled={addingTod}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm font-bold text-white transition-colors disabled:opacity-50"
              >
                {addingTod ? "Adding…" : "Add TOD"}
              </button>
            </div>
          </div>

          {/* TOD Table */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                <Truck className="w-4 h-4 text-cyan-400" /> Transfer of Delivery Milestones
              </h3>
              <button
                onClick={loadTods}
                className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {loadingTod ? (
              <div className="py-12 text-center text-cyan-400 animate-pulse text-sm">Loading…</div>
            ) : tods.length === 0 ? (
              <div className="py-12 text-center text-zinc-600 text-sm">No TODs created yet.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900 text-zinc-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">TOD No.</th>
                    <th className="px-5 py-3">Expected Date</th>
                    <th className="px-5 py-3">Actual Date</th>
                    <th className="px-5 py-3 text-right">Value (Cr)</th>
                    <th className="px-5 py-3">Remarks</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {tods.map((tod) => (
                    <tr key={tod.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-5 py-4 font-bold text-cyan-400">TOD-{tod.tod_number}</td>
                      <td className="px-5 py-4 text-zinc-400">{tod.expected_date ?? "—"}</td>
                      <td className="px-5 py-4 text-emerald-400">{tod.actual_date ?? "—"}</td>
                      <td className="px-5 py-4 text-right font-medium">
                        {tod.tod_value_cr != null ? `₹${tod.tod_value_cr.toFixed(2)} Cr` : "—"}
                      </td>
                      <td className="px-5 py-4 text-zinc-500 text-xs">{tod.remarks ?? "—"}</td>
                      <td className="px-5 py-4">
                        {tod.is_received ? (
                          <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400 font-medium">
                            Received
                          </span>
                        ) : (
                          <span className="rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400 font-medium">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>
      )}

      {/* ── TAB: EXECUTION CHECKLIST ─────────────────────────────────────────── */}
      {activeTab === "checklist" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Overall progress bar */}
          <div className="flex items-center gap-6">
            <div className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-zinc-400">Overall Execution Progress</span>
                <span className="text-2xl font-bold text-emerald-400">{overallPct}%</span>
              </div>
              <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${overallPct}%` }}
                  transition={{ duration: 0.6 }}
                />
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {milestones.filter((m) => m.is_completed).length} of {milestones.length} milestones completed
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={loadMilestones}
                className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
              {milestones.length === 0 && (
                <button
                  onClick={initFromTemplate}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-3 text-sm font-bold text-white transition-colors"
                >
                  <Plus className="w-4 h-4" /> Init from Template
                </button>
              )}
            </div>
          </div>

          {loadingChecklist ? (
            <div className="py-20 text-center text-emerald-400 animate-pulse">Loading milestones…</div>
          ) : milestones.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-16 text-center">
              <CheckSquare className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <p className="text-zinc-400 text-lg mb-2">No milestones set up yet</p>
              <p className="text-zinc-600 text-sm">Click "Init from Template" to create standard construction milestones</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...new Set(milestones.map((m) => m.category))].map((cat) => {
                const items = milestones.filter((m) => m.category === cat);
                const prog = Math.round(items.reduce((s, m) => s + (m.completion_pct ?? 0), 0) / items.length);
                const isCollapsed = collapsed[cat];
                const colorClass = CATEGORY_COLORS[cat] ?? "border-zinc-600 text-zinc-400";
                const [borderCls, textCls] = colorClass.split(" ");

                return (
                  <motion.div
                    key={cat}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border bg-zinc-900/50 overflow-hidden ${borderCls}`}
                  >
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isCollapsed ? <ChevronRight className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                        <span className={`font-bold text-base ${textCls}`}>{cat}</span>
                        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                          {items.filter((m) => m.is_completed).length}/{items.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-32 h-2 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${prog}%` }} />
                        </div>
                        <span className="text-sm font-semibold text-zinc-300 w-10 text-right">{prog}%</span>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div className="border-t border-zinc-800/50">
                        {items.map((m) => (
                          <div key={m.id} className="px-6 py-4 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/20 transition-colors">
                            {editing === m.id ? (
                              <div className="space-y-3">
                                <p className="font-medium text-white">{m.milestone_name}</p>
                                <div className="grid grid-cols-3 gap-3">
                                  <div>
                                    <label className="text-xs text-zinc-500 block mb-1">Completion %</label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={editValues.completion_pct ?? 0}
                                      onChange={(e) => setEditValues((v) => ({ ...v, completion_pct: Number(e.target.value) }))}
                                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-zinc-500 block mb-1">Actual Date</label>
                                    <input
                                      type="date"
                                      value={editValues.actual_date ?? ""}
                                      onChange={(e) => setEditValues((v) => ({ ...v, actual_date: e.target.value }))}
                                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                                    />
                                  </div>
                                  <div className="flex items-end pb-2">
                                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                                      <input
                                        type="checkbox"
                                        checked={editValues.is_completed ?? false}
                                        onChange={(e) =>
                                          setEditValues((v) => ({
                                            ...v,
                                            is_completed: e.target.checked,
                                            completion_pct: e.target.checked ? 100 : v.completion_pct,
                                          }))
                                        }
                                        className="accent-emerald-500"
                                      />
                                      Mark Completed
                                    </label>
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  placeholder="Remarks..."
                                  value={editValues.remarks ?? ""}
                                  onChange={(e) => setEditValues((v) => ({ ...v, remarks: e.target.value }))}
                                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => saveEdit(m.id)}
                                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-sm font-semibold transition-colors"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditing(null)}
                                    className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-4">
                                <div
                                  className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                                    m.is_completed ? "bg-emerald-500 border-emerald-500" : "border-zinc-600"
                                  }`}
                                >
                                  {m.is_completed && <span className="text-white text-xs">✓</span>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium ${m.is_completed ? "line-through text-zinc-500" : "text-white"}`}>
                                    {m.milestone_name}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1">
                                    {m.planned_date && (
                                      <span className="text-xs text-zinc-500">
                                        Plan: {new Date(m.planned_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                      </span>
                                    )}
                                    {m.actual_date && (
                                      <span className="text-xs text-emerald-400">
                                        Actual: {new Date(m.actual_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                      </span>
                                    )}
                                    {m.remarks && <span className="text-xs text-zinc-600 truncate">{m.remarks}</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="w-20 h-1.5 rounded-full bg-zinc-800">
                                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.completion_pct}%` }} />
                                  </div>
                                  <span className="text-xs text-zinc-400 w-8 text-right">{m.completion_pct}%</span>
                                  <button
                                    onClick={() => {
                                      setEditing(m.id);
                                      setEditValues({ completion_pct: m.completion_pct, actual_date: m.actual_date ?? "", is_completed: m.is_completed, remarks: m.remarks ?? "" });
                                    }}
                                    className="text-xs text-zinc-600 hover:text-cyan-400 transition-colors px-2 py-1 rounded border border-transparent hover:border-zinc-700"
                                  >
                                    Edit
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
