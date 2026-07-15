"use client";

/**
 * Physical Progress Summary — portfolio view (friend-parity).
 * Every ongoing scheme with a locked+current plan: planned% vs actual%
 * (weighted, straight from the unified DPR summary), the per-activity
 * summary table and the month's manpower deployment averages.
 */

import { useEffect, useState } from "react";
import { BarChart2, Calendar, RefreshCw, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

type SummaryRow = {
  id: number | string;
  overall?: boolean;
  source?: string;
  parent?: string;
  category?: string;
  activity?: string;
  package?: string;
  scope?: number;
  uom?: string;
  weightPercent?: number;
  ftmPlan?: number;
  ftmActual?: number;
  currentFyPlan?: number;
  currentFyActual?: number;
  cumulativePlan?: number;
  cumulativeActual?: number;
  cumulativePlanPercent?: number;
  cumulativeActualPercent?: number;
  currentFyPlanPercent?: number;
  currentFyActualPercent?: number;
  lastFyActualPercent?: number;
};

type ManpowerTable = {
  monthLabel: string;
  filledDays: number;
  agencyName: string;
  rows: { slNo: string; agency: string; manpower: string; category: string; value: number }[];
};

type ProjectSummary = {
  id: number;
  projectName: string;
  uniqueId: string;
  grossCost: number;
  plannedPercent: number;
  actualPercent: number;
  planMonth?: string;
  nextPlanMonth?: string;
  summaryRows: SummaryRow[];
  manpowerPmcTable?: ManpowerTable;
  error?: string;
};

type Payload = { asOf: string; financialYear: string; projects: ProjectSummary[] };

const num = (v: number | undefined | null, d = 2) =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

function ProgressBar({ planned, actual }: { planned: number; actual: number }) {
  const cap = (v: number) => Math.min(100, Math.max(0, v));
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-cyan-300">Planned {num(planned)}%</span>
        <span className={actual >= planned ? "text-emerald-300" : "text-amber-300"}>
          Actual {num(actual)}%
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-zinc-800">
        <div className="absolute h-2.5 rounded-full bg-cyan-500/40" style={{ width: `${cap(planned)}%` }} />
        <div
          className={`absolute h-2.5 rounded-full ${actual >= planned ? "bg-emerald-400" : "bg-amber-400"}`}
          style={{ width: `${cap(actual)}%` }}
        />
      </div>
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const [open, setOpen] = useState(false);
  const activityRows = p.summaryRows.filter((r) => !r.overall);
  const overallRows = p.summaryRows.filter((r) => r.overall);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">{p.projectName}</h3>
          <p className="text-xs text-zinc-500">
            {p.uniqueId} · Gross Cost ₹{num(p.grossCost)} Cr
            {p.planMonth ? ` · Plan Month ${p.planMonth}` : ""}
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
        >
          {open ? "Hide Details" : "View Details"}
        </button>
      </div>
      <ProgressBar planned={p.plannedPercent} actual={p.actualPercent} />
      {p.error && <p className="mt-2 text-xs text-red-400">{p.error}</p>}

      {open && (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Activity</th>
                  <th className="px-2 py-2 text-right">Scope</th>
                  <th className="px-2 py-2 text-center">UoM</th>
                  <th className="px-2 py-2 text-right">Wt %</th>
                  <th className="px-2 py-2 text-right">FTM Plan</th>
                  <th className="px-2 py-2 text-right">FTM Actual</th>
                  <th className="px-2 py-2 text-right">FY Plan %</th>
                  <th className="px-2 py-2 text-right">FY Actual %</th>
                  <th className="px-2 py-2 text-right">Cum Plan %</th>
                  <th className="px-2 py-2 text-right">Cum Actual %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {activityRows.map((r) => (
                  <tr key={String(r.id)} className={r.source === "capex" ? "bg-amber-500/5" : ""}>
                    <td className="px-3 py-1.5 text-zinc-200">
                      {r.parent && r.parent !== r.activity ? `${r.parent} — ` : ""}
                      {r.activity || r.category}
                    </td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.scope)}</td>
                    <td className="px-2 py-1.5 text-center text-zinc-500">{r.uom || "—"}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.weightPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.ftmPlan)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.ftmActual)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.currentFyPlanPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.currentFyActualPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.cumulativePlanPercent)}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-emerald-300">{num(r.cumulativeActualPercent)}</td>
                  </tr>
                ))}
                {overallRows.map((r) => (
                  <tr key={String(r.id)} className="bg-violet-500/10 font-bold">
                    <td className="px-3 py-2 text-violet-300">{r.category || "Overall Physical Progress"}</td>
                    <td className="px-2 py-2 text-right text-zinc-300">{num(r.scope)}</td>
                    <td colSpan={6} />
                    <td className="px-2 py-2 text-right text-cyan-300">{num(r.cumulativePlanPercent)}</td>
                    <td className="px-2 py-2 text-right text-emerald-300">{num(r.cumulativeActualPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {p.manpowerPmcTable && (
            <div className="rounded-xl border border-zinc-800 p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold text-zinc-300">
                <Users className="h-4 w-4 text-teal-400" />
                Manpower — Month Average ({p.manpowerPmcTable.monthLabel}, DPR days: {p.manpowerPmcTable.filledDays})
              </p>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-800/70">
                  {p.manpowerPmcTable.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="w-8 px-2 py-1 text-zinc-500">{row.slNo}</td>
                      <td className="px-2 py-1 whitespace-pre-line text-zinc-300">{row.agency}</td>
                      <td className="px-2 py-1 text-zinc-400">{row.manpower}</td>
                      <td className="px-2 py-1 text-zinc-400">{row.category}</td>
                      <td className="px-2 py-1 text-right font-bold text-teal-300">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PhysicalProgressSummary() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API}/board/physical-progress-summary?as_of=${asOf}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [asOf]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white">
          <BarChart2 className="h-5 w-5 text-emerald-400" />
          Physical Progress Summary
          {data && <span className="text-sm font-normal text-zinc-500">FY {data.financialYear}</span>}
        </h2>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <Calendar className="h-4 w-4" /> As on
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400"
          />
        </label>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <RefreshCw className="h-4 w-4 animate-spin" /> Computing weighted progress across schemes…
        </p>
      )}
      {!loading && data && data.projects.length === 0 && (
        <p className="text-sm text-zinc-500">No ongoing scheme has a locked current plan yet.</p>
      )}
      {!loading && data?.projects.map((p) => <ProjectCard key={p.id} p={p} />)}
    </div>
  );
}
