"use client";

/**
 * Plant Level AMR Dashboard â€” Sprint 17
 *
 * Read-only analytics over PLANT-type packages. Shows:
 *   - KPI cards (total projects, gross cost, overall progress, capex)
 *   - Status breakdown (Yet to Start / On Time / Delay <1Yr / >1Yr / Completed)
 *   - Project register table with delay categorization
 *   - Per-project monthly BE/RE/Actual capex (expandable)
 *
 * Route: /physical/plant/amr
 */

import { Fragment, useEffect, useState, useCallback } from "react";
import {
  Factory, TrendingUp, IndianRupee, AlertTriangle, CheckCircle2,
  Clock, CircleDashed, ChevronDown, ChevronRight, RefreshCw, MapPin,
} from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://localhost:8002/api/v1";

type Project = {
  package_id: number; scheme_id: number; scheme_name: string; amr_no: string | null;
  project_name: string; package_no: number; contractor_name: string | null;
  contract_no: string | null; gross_cost_cr: number;
  effective_date: string | null; scheduled_completion_date: string | null;
  expected_completion_date: string | null; actual_completion_date: string | null;
  physical_progress_percent: number; status: string; delay_days: number;
  delay_category: string; delay_reason: string | null; project_manager_name: string | null;
  monthly: { month: string; be: number; re: number | null; actual: number }[];
};

type Dashboard = {
  as_on: string; financial_year: string; financial_year_months: string[];
  re_months: string[]; projects: Project[];
  summary: {
    total_projects: number; total_gross_cost_cr: number;
    status_counts: Record<string, number>; status_gross_cost_cr: Record<string, number>;
    status_percent: Record<string, number>; overall_progress_percent: number;
    cumulative_be_cr: number; cumulative_re_cr: number; cumulative_actual_cr: number;
  };
};

const STATUS_COLORS: Record<string, string> = {
  "Yet to Start": "#71717a",
  "On Time": "#10b981",
  "Delay < 1 Yr": "#f59e0b",
  "Delay > 1 Yr": "#ef4444",
  "Completed": "#06b6d4",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  "Yet to Start": <CircleDashed size={14} />,
  "On Time": <CheckCircle2 size={14} />,
  "Delay < 1 Yr": <Clock size={14} />,
  "Delay > 1 Yr": <AlertTriangle size={14} />,
  "Completed": <CheckCircle2 size={14} />,
};

export default function PlantAmrDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [fy, setFy] = useState("2026-27");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`${API}/plant-amr/dashboard?financial_year=${encodeURIComponent(fy)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      setData(await r.json());
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  const projects = data?.projects ?? [];
  const filtered = statusFilter ? projects.filter((p) => p.status === statusFilter) : projects;

  const pieData = data ? Object.entries(data.summary.status_counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v })) : [];

  return (
    <div className="p-8 text-white min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.04)_0%,transparent_60%)]">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-3">
            <Factory className="text-cyan-400" /> Plant Level AMR
          </h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Plant-type packages (&lt; â‚¹30 Cr) Â· delay analytics Â· monthly capex
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Financial Year</label>
            <select value={fy} onChange={(e) => setFy(e.target.value)}
                    className="p-2 text-sm rounded-lg bg-zinc-900 border border-zinc-700 outline-none focus:border-cyan-500">
              <option>2026-27</option><option>2027-28</option><option>2025-26</option>
            </select>
          </div>
          <button onClick={load} disabled={loading}
                  className="p-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {err}
        </div>
      )}

      {!data && loading && <div className="animate-pulse text-cyan-400">Loading plant AMR dashboardâ€¦</div>}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard icon={<Factory size={18} />} label="Total Projects"
                     value={data.summary.total_projects.toString()} accent="cyan" />
            <KpiCard icon={<IndianRupee size={18} />} label="Total Gross Cost"
                     value={`â‚¹${data.summary.total_gross_cost_cr.toFixed(1)} Cr`} accent="emerald" />
            <KpiCard icon={<TrendingUp size={18} />} label="Overall Progress"
                     value={`${data.summary.overall_progress_percent}%`} accent="indigo" />
            <KpiCard icon={<IndianRupee size={18} />} label="Actual Capex (FY)"
                     value={`â‚¹${data.summary.cumulative_actual_cr.toFixed(1)} Cr`}
                     sub={`BE â‚¹${data.summary.cumulative_be_cr.toFixed(1)} Â· RE â‚¹${data.summary.cumulative_re_cr.toFixed(1)}`}
                     accent="amber" />
          </div>

          {/* Status row: pie + clickable status chips */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="text-sm font-bold text-zinc-300 mb-3">Status Distribution</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {pieData.map((e) => <Cell key={e.name} fill={STATUS_COLORS[e.name] || "#71717a"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="lg:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="text-sm font-bold text-zinc-300 mb-3">By Status (click to filter)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.keys(STATUS_COLORS).map((s) => {
                  const count = data.summary.status_counts[s] || 0;
                  const gross = data.summary.status_gross_cost_cr[s] || 0;
                  const pct = data.summary.status_percent[s] || 0;
                  const active = statusFilter === s;
                  return (
                    <button key={s} onClick={() => setStatusFilter(active ? null : s)}
                            className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${active ? "border-cyan-500/50 bg-cyan-500/5" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"}`}>
                      <div className="flex items-center gap-2">
                        <span style={{ color: STATUS_COLORS[s] }}>{STATUS_ICON[s]}</span>
                        <span className="text-sm text-zinc-300">{s}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold" style={{ color: STATUS_COLORS[s] }}>{count}</div>
                        <div className="text-[10px] text-zinc-500">â‚¹{gross.toFixed(1)} Cr Â· {pct}%</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Project register */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-300">
                Project Register
                {statusFilter && <span className="ml-2 text-xs text-cyan-400">Â· filtered: {statusFilter}</span>}
              </h3>
              <span className="text-xs text-zinc-500">{filtered.length} of {projects.length} projects Â· as on {data.as_on}</span>
            </div>

            {filtered.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 text-sm">
                {projects.length === 0 ? "No PLANT-type packages found." : "No projects match this filter."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/[0.03] text-zinc-500 text-[10px] uppercase tracking-widest">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">Project</th>
                      <th className="p-3">Contractor</th>
                      <th className="p-3 text-right">Gross â‚¹Cr</th>
                      <th className="p-3 text-center">Progress</th>
                      <th className="p-3">Scheduled</th>
                      <th className="p-3">Expected</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const isOpen = expanded[p.package_id];
                      return (
                        <Fragment key={p.package_id}>
                          <tr
                              onClick={() => setExpanded((e) => ({ ...e, [p.package_id]: !isOpen }))}
                              className="border-t border-white/5 hover:bg-white/[0.02] cursor-pointer">
                            <td className="p-3 text-zinc-500">
                              <div className="flex items-center gap-1">
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {i + 1}
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="text-zinc-200 font-medium">{p.project_name}</div>
                              <div className="text-[10px] text-zinc-600">{p.scheme_name} {p.amr_no ? `Â· ${p.amr_no}` : ""}</div>
                            </td>
                            <td className="p-3 text-zinc-400 text-xs">{p.contractor_name || "â€”"}</td>
                            <td className="p-3 text-right font-mono text-zinc-300">{p.gross_cost_cr.toFixed(2)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 min-w-[40px]">
                                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(p.physical_progress_percent, 100)}%` }} />
                                </div>
                                <span className="text-[10px] text-zinc-400 font-mono w-9 text-right">{p.physical_progress_percent}%</span>
                              </div>
                            </td>
                            <td className="p-3 text-xs text-zinc-400 font-mono">{p.scheduled_completion_date || "â€”"}</td>
                            <td className="p-3 text-xs font-mono">
                              <span className={p.delay_days > 0 ? "text-amber-400" : "text-zinc-400"}>
                                {p.expected_completion_date || "â€”"}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
                                    style={{ background: `${STATUS_COLORS[p.status]}1a`, color: STATUS_COLORS[p.status] }}>
                                {STATUS_ICON[p.status]} {p.status}
                                {p.delay_days > 0 && <span className="opacity-70">({p.delay_days}d)</span>}
                              </span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-zinc-950/60">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  <div className="text-xs space-y-1">
                                    <div className="text-zinc-500 uppercase tracking-wider text-[9px] mb-1">Details</div>
                                    <Detail label="Contract No" value={p.contract_no} />
                                    <Detail label="Effective" value={p.effective_date} />
                                    <Detail label="Completion" value={p.actual_completion_date} />
                                    <Detail label="PM" value={p.project_manager_name} />
                                    {p.delay_reason && <Detail label="Delay reason" value={p.delay_reason} />}
                                  </div>
                                  <div className="lg:col-span-2">
                                    <div className="text-zinc-500 uppercase tracking-wider text-[9px] mb-1">Monthly Capex (â‚¹ Cr)</div>
                                    <div className="overflow-x-auto">
                                      <table className="text-[10px] font-mono w-full">
                                        <thead className="text-zinc-600">
                                          <tr>
                                            <th className="p-1 text-left">Â·</th>
                                            {p.monthly.map((m) => <th key={m.month} className="p-1 text-center">{m.month}</th>)}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr><td className="p-1 text-cyan-400">BE</td>{p.monthly.map((m) => <td key={m.month} className="p-1 text-center text-cyan-300">{m.be || "Â·"}</td>)}</tr>
                                          <tr><td className="p-1 text-amber-400">RE</td>{p.monthly.map((m) => <td key={m.month} className="p-1 text-center text-amber-300">{m.re ?? "Â·"}</td>)}</tr>
                                          <tr><td className="p-1 text-emerald-400">Act</td>{p.monthly.map((m) => <td key={m.month} className="p-1 text-center text-emerald-300">{m.actual || "Â·"}</td>)}</tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  accent: "cyan" | "emerald" | "indigo" | "amber";
}) {
  const c = { cyan: "text-cyan-400", emerald: "text-emerald-400", indigo: "text-indigo-400", amber: "text-amber-400" }[accent];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className={`flex items-center gap-2 ${c} mb-2`}>{icon}<span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span></div>
      <div className="text-2xl font-black">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-1">{sub}</div>}
    </motion.div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-600">{label}</span>
      <span className="text-zinc-300 text-right">{value || "â€”"}</span>
    </div>
  );
}

