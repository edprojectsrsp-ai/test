"use client";

/**
 * Billing Schedule — milestone-based billing & payment tracking.
 * Matches the friend's "Billing Schedule & PV / Consumption Monitoring" window.
 */

import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  Plus,
  Receipt,
  Save,
  Trash2,
  TrendingUp,
} from "lucide-react";

const API = "http://localhost:8000/api/v1";

// ─────────────────────── types ────────────────────────────────────────────────

type Scheme  = { id: number; scheme_name: string };
type Package = { package_id: number; package_name: string; package_value_cr: number; milestone_count: number; billed_cr: number };
type Summary = {
  package_name: string; contractor_name: string; loa_number: string;
  loa_date: string; contract_value_cr: number; schedule_total_cr: number;
  billed_cr: number; paid_cr: number; balance_cr: number;
  billed_pct: number; paid_pct: number;
  total_milestones: number; billed_count: number; paid_count: number; overdue_count: number;
};
type Milestone = {
  billing_schedule_id: number;
  milestone_no: number;
  description: string;
  scheduled_amount_cr: number;
  scheduled_date: string | null;
  actual_amount_cr: number | null;
  actual_billed_date: string | null;
  payment_received_date: string | null;
  is_billed: boolean;
  is_paid: boolean;
  status: "paid" | "billed" | "overdue" | "pending";
  remarks: string | null;
  appendix2_item_name: string | null;
};
type NewMilestone = {
  milestone_no: string;
  description: string;
  scheduled_amount_cr: string;
  scheduled_date: string;
  remarks: string;
};

// ─────────────────────── page ─────────────────────────────────────────────────

export default function BillingPage() {
  const [schemes, setSchemes]         = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [packages, setPackages]       = useState<Package[]>([]);
  const [selectedPkg, setSelectedPkg] = useState("");
  const [summary, setSummary]         = useState<Summary | null>(null);
  const [milestones, setMilestones]   = useState<Milestone[]>([]);
  const [loading, setLoading]         = useState(false);
  const [showAdd, setShowAdd]         = useState(false);
  const [editRow, setEditRow]         = useState<number | null>(null);

  // Add form
  const blank: NewMilestone = { milestone_no: "", description: "", scheduled_amount_cr: "", scheduled_date: "", remarks: "" };
  const [addForm, setAddForm]   = useState<NewMilestone>(blank);
  const [addSaving, setAddSaving] = useState(false);

  // Edit inline state (only amounts/dates/flags)
  const [editData, setEditData] = useState<Partial<Milestone>>({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/schemes/all`)
      .then(r => r.json())
      .then((d: any[]) => {
        const active = d.filter(s => s.current_status !== "closed");
        setSchemes(active);
        // COB-7 (scheme 74) carries the richest billing/progress dataset —
        // default there so the page opens with real milestones, not blanks.
        const preferred = active.find(s => s.id === 74) ?? active[0];
        if (preferred) setSelectedScheme(String(preferred.id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedScheme) return;
    setPackages([]);
    setSelectedPkg("");
    setSummary(null);
    setMilestones([]);
    fetch(`${API}/billing/scheme/${selectedScheme}/packages`)
      .then(r => r.json())
      .then((d: Package[]) => {
        setPackages(d);
        if (d.length) {
          // Prefer the package that actually has billing milestones so the
          // page opens on real data instead of an empty first-in-list pick.
          const richest = [...d].sort((a, b) => (b.milestone_count ?? 0) - (a.milestone_count ?? 0))[0];
          setSelectedPkg(String(richest.package_id));
        }
      })
      .catch(() => {});
  }, [selectedScheme]);

  useEffect(() => {
    if (!selectedPkg) return;
    loadData();
  }, [selectedPkg]);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/billing/packages/${selectedPkg}/summary`).then(r => r.json()),
      fetch(`${API}/billing/packages/${selectedPkg}`).then(r => r.json()),
    ])
      .then(([s, m]) => {
        setSummary(s);
        setMilestones(Array.isArray(m) ? m : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleAdd = async () => {
    if (!addForm.description || !addForm.scheduled_amount_cr) {
      alert("Description and scheduled amount are required.");
      return;
    }
    setAddSaving(true);
    try {
      const r = await fetch(`${API}/billing/packages/${selectedPkg}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestone_no:        parseInt(addForm.milestone_no) || milestones.length + 1,
          description:         addForm.description,
          scheduled_amount_cr: parseFloat(addForm.scheduled_amount_cr),
          scheduled_date:      addForm.scheduled_date || null,
          remarks:             addForm.remarks || null,
        }),
      });
      if (r.ok) {
        setAddForm(blank);
        setShowAdd(false);
        loadData();
      } else {
        alert("Failed to add milestone.");
      }
    } finally {
      setAddSaving(false);
    }
  };

  const handleUpdate = async (id: number) => {
    setEditSaving(true);
    try {
      const r = await fetch(`${API}/billing/milestones/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      if (r.ok) {
        setEditRow(null);
        setEditData({});
        loadData();
      } else {
        alert("Update failed.");
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this milestone?")) return;
    await fetch(`${API}/billing/milestones/${id}`, { method: "DELETE" });
    loadData();
  };

  const startEdit = (m: Milestone) => {
    setEditRow(m.billing_schedule_id);
    setEditData({
      actual_amount_cr:     m.actual_amount_cr ?? undefined,
      actual_billed_date:   m.actual_billed_date ?? undefined,
      payment_received_date: m.payment_received_date ?? undefined,
      is_billed:            m.is_billed,
      is_paid:              m.is_paid,
      remarks:              m.remarks ?? undefined,
    });
  };

  const statusBadge = (s: Milestone["status"]) => {
    const map: Record<string, string> = {
      paid:    "bg-green-500/20 text-green-400 border-green-500/30",
      billed:  "bg-blue-500/20 text-blue-400 border-blue-500/30",
      overdue: "bg-red-500/20 text-red-400 border-red-500/30",
      pending: "bg-zinc-700 text-zinc-400 border-zinc-600",
    };
    const icons: Record<string, ReactNode> = {
      paid:    <CheckCircle2 className="h-3 w-3" />,
      billed:  <Receipt className="h-3 w-3" />,
      overdue: <AlertTriangle className="h-3 w-3" />,
      pending: <Clock className="h-3 w-3" />,
    };
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${map[s]}`}>
        {icons[s]} {s}
      </span>
    );
  };

  const fmt = (v: number | null | undefined) =>
    v != null ? `₹ ${Number(v).toFixed(2)} Cr` : "—";
  const fmtD = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-1 flex items-center gap-3 text-4xl font-bold">
            <CreditCard className="h-8 w-8 text-emerald-400" />
            Billing Schedule
          </h1>
          <p className="text-zinc-400">Milestone billing & payment monitoring</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={selectedScheme}
            onChange={e => setSelectedScheme(e.target.value)}
            className="min-w-[260px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
          >
            {schemes.map(s => (
              <option key={s.id} value={s.id}>[{s.id}] {s.scheme_name}</option>
            ))}
          </select>
          {packages.length > 0 && (
            <select
              value={selectedPkg}
              onChange={e => setSelectedPkg(e.target.value)}
              className="min-w-[180px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
            >
              {packages.map(p => (
                <option key={p.package_id} value={p.package_id}>{p.package_name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-emerald-400">
          <Loader2 className="h-6 w-6 animate-spin" /> Loading billing data…
        </div>
      )}

      {!loading && summary && (
        <>
          {/* KPI Cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { label: "Contract Value", value: fmt(summary.contract_value_cr), color: "text-zinc-300" },
              { label: "Schedule Total", value: fmt(summary.schedule_total_cr), color: "text-blue-300" },
              { label: "Billed Till Date", value: `${fmt(summary.billed_cr)}\n${summary.billed_pct}%`, color: "text-cyan-300" },
              { label: "Paid Till Date", value: `${fmt(summary.paid_cr)}\n${summary.paid_pct}%`, color: "text-green-300" },
              { label: "Balance Billing", value: fmt(summary.balance_cr), color: "text-amber-300" },
              { label: "Total Milestones", value: String(summary.total_milestones), color: "text-zinc-300" },
              { label: "Billed", value: String(summary.billed_count), color: "text-cyan-300" },
              { label: "Overdue", value: String(summary.overdue_count), color: summary.overdue_count > 0 ? "text-red-400" : "text-zinc-500" },
            ].map(card => (
              <div key={card.label} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="mb-1 text-xs text-zinc-500">{card.label}</p>
                <p className={`whitespace-pre-line text-sm font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Contractor info */}
          {(summary.contractor_name || summary.loa_number) && (
            <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-4 text-sm">
              {summary.contractor_name && (
                <span className="text-zinc-300">Contractor: <span className="font-bold text-white">{summary.contractor_name}</span></span>
              )}
              {summary.loa_number && (
                <span className="text-zinc-300">LOA: <span className="font-bold text-white">{summary.loa_number}</span></span>
              )}
              {summary.loa_date && (
                <span className="text-zinc-300">LOA Date: <span className="font-bold text-white">{fmtD(summary.loa_date)}</span></span>
              )}
            </div>
          )}

          {/* Progress bars */}
          <div className="mb-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="flex items-center gap-2 font-semibold"><TrendingUp className="h-4 w-4 text-emerald-400" />Billing Progress</h3>
            {[
              { label: "Billed %", pct: summary.billed_pct, color: "from-cyan-500 to-blue-500" },
              { label: "Paid %",   pct: summary.paid_pct,   color: "from-green-500 to-emerald-500" },
            ].map(b => (
              <div key={b.label} className="flex items-center gap-4">
                <span className="w-20 text-xs text-zinc-400">{b.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(b.pct, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={`h-full rounded-full bg-gradient-to-r ${b.color}`}
                  />
                </div>
                <span className="w-12 text-right text-sm font-bold text-white">{b.pct}%</span>
              </div>
            ))}
          </div>

          {/* Milestone table */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
              <h3 className="flex items-center gap-2 font-semibold">
                <FileText className="h-5 w-5 text-emerald-400" />
                Milestones
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  {milestones.length}
                </span>
              </h3>
              <button
                onClick={() => setShowAdd(v => !v)}
                className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/20"
              >
                <Plus className="h-4 w-4" /> Add Milestone
              </button>
            </div>

            {/* Add form */}
            <AnimatePresence>
              {showAdd && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-zinc-800 bg-zinc-950/60"
                >
                  <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-5">
                    <input
                      type="number"
                      placeholder="S.No."
                      value={addForm.milestone_no}
                      onChange={e => setAddForm(f => ({ ...f, milestone_no: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      placeholder="Description *"
                      value={addForm.description}
                      onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                      className="col-span-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount (Cr) *"
                      value={addForm.scheduled_amount_cr}
                      onChange={e => setAddForm(f => ({ ...f, scheduled_amount_cr: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      type="date"
                      value={addForm.scheduled_date}
                      onChange={e => setAddForm(f => ({ ...f, scheduled_date: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      placeholder="Remarks"
                      value={addForm.remarks}
                      onChange={e => setAddForm(f => ({ ...f, remarks: e.target.value }))}
                      className="col-span-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                    <div className="col-span-2 flex gap-2 md:col-span-3">
                      <button
                        onClick={handleAdd}
                        disabled={addSaving}
                        className="flex items-center gap-2 rounded-xl bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-60"
                      >
                        {addSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </button>
                      <button
                        onClick={() => { setShowAdd(false); setAddForm(blank); }}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                    <th className="px-4 py-3 text-left">S.No</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right">Sched. Amount</th>
                    <th className="px-4 py-3 text-center">Sched. Date</th>
                    <th className="px-4 py-3 text-right">Actual Amount</th>
                    <th className="px-4 py-3 text-center">Billed Date</th>
                    <th className="px-4 py-3 text-center">Paid Date</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-zinc-500">
                        No milestones yet. Click "Add Milestone" to start.
                      </td>
                    </tr>
                  ) : milestones.map(m => (
                    <tr key={m.billing_schedule_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="px-4 py-3 text-zinc-400">{m.milestone_no}</td>
                      <td className="px-4 py-3 font-medium text-white">
                        {m.description}
                        {m.appendix2_item_name && (
                          <span className="ml-2 text-xs text-zinc-500">({m.appendix2_item_name})</span>
                        )}
                        {m.remarks && <p className="text-xs text-zinc-500">{m.remarks}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-blue-300">{fmt(m.scheduled_amount_cr)}</td>
                      <td className="px-4 py-3 text-center text-zinc-400">{fmtD(m.scheduled_date)}</td>

                      {/* Editable cells */}
                      {editRow === m.billing_schedule_id ? (
                        <>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={editData.actual_amount_cr ?? ""}
                              onChange={e => setEditData(d => ({ ...d, actual_amount_cr: e.target.value ? parseFloat(e.target.value) : undefined }))}
                              className="w-24 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs outline-none"
                              placeholder="Amount Cr"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="date"
                              value={editData.actual_billed_date ?? ""}
                              onChange={e => setEditData(d => ({ ...d, actual_billed_date: e.target.value || undefined }))}
                              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs outline-none"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="date"
                              value={editData.payment_received_date ?? ""}
                              onChange={e => setEditData(d => ({ ...d, payment_received_date: e.target.value || undefined }))}
                              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs outline-none"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-2 text-xs">
                              <label className="flex items-center gap-1 text-cyan-400">
                                <input type="checkbox" checked={editData.is_billed ?? false}
                                  onChange={e => setEditData(d => ({ ...d, is_billed: e.target.checked }))} />
                                Billed
                              </label>
                              <label className="flex items-center gap-1 text-green-400">
                                <input type="checkbox" checked={editData.is_paid ?? false}
                                  onChange={e => setEditData(d => ({ ...d, is_paid: e.target.checked }))} />
                                Paid
                              </label>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleUpdate(m.billing_schedule_id)}
                                disabled={editSaving}
                                className="rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
                              >
                                {editSaving ? "…" : "Save"}
                              </button>
                              <button
                                onClick={() => { setEditRow(null); setEditData({}); }}
                                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-right font-mono text-green-300">{fmt(m.actual_amount_cr)}</td>
                          <td className="px-4 py-3 text-center text-zinc-400">{fmtD(m.actual_billed_date)}</td>
                          <td className="px-4 py-3 text-center text-zinc-400">{fmtD(m.payment_received_date)}</td>
                          <td className="px-4 py-3 text-center">{statusBadge(m.status)}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => startEdit(m)}
                                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:text-white"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(m.billing_schedule_id)}
                                className="rounded-lg p-1 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !summary && selectedPkg && (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 py-20 text-center text-zinc-500">
          No billing data for this package yet. Add milestones to start tracking.
        </div>
      )}
    </div>
  );
}
