"use client";

/**
 * DPR "Summary" tab (friend-parity): scheme-level weighted summary from the
 * unified progress service — activity rows + Capex row + Overall Progress row,
 * with the month's manpower deployment averages. Same numbers as the dashboard
 * and reports because they all call the same backend service.
 */

import { useEffect, useState } from "react";
import { BarChart2, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

const num = (v: any, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

export default function SchemeSummaryTab({ schemeId }: { schemeId: number }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API}/board/scheme-summary/${schemeId}?month=${month}`)
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [schemeId, month]);

  const rows = data?.summary?.summaryRows || [];
  const overall = rows.filter((r: any) => r.overall);
  const detail = rows.filter((r: any) => !r.overall);
  const manpower = data?.manpowerDeploymentSummary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <BarChart2 className="h-4 w-4 text-violet-400" /> Physical Progress Summary
          {data && (
            <span className="text-xs font-normal text-zinc-500">
              {data.summary?.financialYearLabel} · Plan month {data.planMonth}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex gap-4 text-xs">
              <span className="text-cyan-300">Planned: <b>{num(data.plannedPercent)}%</b></span>
              <span className="text-emerald-300">Actual: <b>{num(data.actualPercent)}%</b></span>
            </div>
          )}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white outline-none" />
        </div>
      </div>

      {loading && <p className="text-sm text-zinc-500">Computing weighted summary…</p>}

      {!loading && data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Activity</th>
                  <th className="px-2 py-2 text-right">Scope</th>
                  <th className="px-2 py-2 text-center">UoM</th>
                  <th className="px-2 py-2 text-right">Wt %</th>
                  <th className="px-2 py-2 text-right">Till Last FY</th>
                  <th className="px-2 py-2 text-right">FTM Plan</th>
                  <th className="px-2 py-2 text-right">FTM Actual</th>
                  <th className="px-2 py-2 text-right">Next Month Plan</th>
                  <th className="px-2 py-2 text-right">FY Plan %</th>
                  <th className="px-2 py-2 text-right">FY Actual %</th>
                  <th className="px-2 py-2 text-right">Cum Plan %</th>
                  <th className="px-2 py-2 text-right">Cum Actual %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {detail.map((r: any) => (
                  <tr key={String(r.id)} className={r.source === "capex" ? "bg-amber-500/5" : ""}>
                    <td className="px-3 py-1.5 text-zinc-200">
                      {r.parent && r.parent !== r.activity ? `${r.parent} — ` : ""}{r.activity || r.category}
                    </td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.scope)}</td>
                    <td className="px-2 py-1.5 text-center text-zinc-500">{r.uom || "—"}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.weightPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.lastFyActual)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.ftmPlan)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.ftmActual)}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.nextMonthPlan)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.currentFyPlanPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.currentFyActualPercent)}</td>
                    <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.cumulativePlanPercent)}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-emerald-300">{num(r.cumulativeActualPercent)}</td>
                  </tr>
                ))}
                {overall.map((r: any) => (
                  <tr key={String(r.id)} className="bg-violet-500/10 font-bold">
                    <td className="px-3 py-2 text-violet-300">Overall Progress</td>
                    <td className="px-2 py-2 text-right text-zinc-300">{num(r.scope)}</td>
                    <td colSpan={8} />
                    <td className="px-2 py-2 text-right text-cyan-300">{num(r.cumulativePlanPercent)}</td>
                    <td className="px-2 py-2 text-right text-emerald-300">{num(r.cumulativeActualPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {manpower && (
            <div className="rounded-xl border border-zinc-800 p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold text-zinc-300">
                <Users className="h-4 w-4 text-teal-400" />
                Manpower — Month Average ({manpower.monthLabel}, DPR days: {manpower.filledDays})
              </p>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-800/60">
                  {(manpower.rows || []).map((row: any, i: number) => (
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
        </>
      )}
    </div>
  );
}
