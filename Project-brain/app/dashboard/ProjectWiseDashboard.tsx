"use client";

/**
 * Project Wise Dashboard — single-scheme drill-down (friend-parity).
 * Month dropdown drives everything:
 *   · multi-version S-curve overlay (Original Plan vs Revisions) with
 *     per-activity trend filter (Overall / each activity)
 *   · CAPEX plan-vs-actual monthly bars
 *   · DPR weighted summary table (same numbers as the DPR Summary tab)
 *   · monthly remarks keyword scan (started / completed / under progress)
 *   · manpower month-average table
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Bar, BarChart,
} from "recharts";
import { Activity, IndianRupee, MessageSquare, TrendingUp, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

type TrendRow = {
  month: string;
  monthlyPlanQty: number; monthlyActualQty: number;
  monthlyPlanPercent: number; monthlyActualPercent: number;
  cumulativePlanPercent: number; cumulativeActualPercent: number;
};

type PlanOption = {
  planName: string; financialYear: string; planVersion: string;
  isActive: boolean; totalScope: number; months: string[];
  trend: TrendRow[];
  activityOptions: string[];
  activityTrends: Record<string, TrendRow[]>;
};

type Detail = {
  projectId: number; financialYear: string; selectedMonth: string;
  capex: {
    grossCost: number; actualTillLastFy: number; beCurrentFy: number; reCurrentFy: number;
    monthly: { month: string; monthKey: string; plan: number; actual: number }[];
  };
  scurve: { planName: string; months: string[]; trend: any[]; plans: PlanOption[] };
  monthlyRemarkSummary: { month: string; started: number; completed: number; underProgress: number; remarks: any[] }[];
  selectedMonthRemarks: { date: string; activity: string; remark: string; matches: string[] }[];
  dprSummary: { totals: any; summaryRows: any[] };
  plannedPercent: number; actualPercent: number;
  manpowerPmcTable: { monthLabel: string; filledDays: number; rows: any[] };
};

const num = (v: any, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

const LINE_COLORS = ["#22d3ee", "#a78bfa", "#f59e0b", "#f472b6", "#34d399", "#60a5fa"];

export default function ProjectWiseDashboard({
  schemeId, month,
}: { schemeId: number; month: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState("Overall");

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API}/board/project-details/${schemeId}?month=${month}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        const active = (d.scurve?.plans || []).filter((p: PlanOption) => p.isActive).map((p: PlanOption) => p.planName);
        setSelectedPlans(active.length ? active : (d.scurve?.plans || []).slice(0, 1).map((p: PlanOption) => p.planName));
        setActivityFilter("Overall");
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [schemeId, month]);

  const plans = detail?.scurve?.plans || [];
  const shownPlans = plans.filter((p) => selectedPlans.includes(p.planName));
  const activityOptions = useMemo(() => {
    const set = new Set<string>(["Overall"]);
    shownPlans.forEach((p) => (p.activityOptions || []).forEach((a) => set.add(a)));
    return Array.from(set);
  }, [shownPlans]);

  // merge selected plans' trends into one chart dataset keyed by month
  const chartData = useMemo(() => {
    const monthSet = new Map<string, any>();
    const order: string[] = [];
    shownPlans.forEach((p, pi) => {
      const trend = (p.activityTrends || {})[activityFilter] || p.trend || [];
      trend.forEach((row) => {
        if (!monthSet.has(row.month)) { monthSet.set(row.month, { month: row.month }); order.push(row.month); }
        const entry = monthSet.get(row.month);
        entry[`plan_${pi}`] = row.cumulativePlanPercent;
        entry[`actual_${pi}`] = row.cumulativeActualPercent;
      });
    });
    return order.map((m) => monthSet.get(m));
  }, [shownPlans, activityFilter]);

  if (!schemeId) return <p className="text-sm text-zinc-500">Select a scheme above.</p>;
  if (loading || !detail) return <p className="text-sm text-zinc-500">Loading project details…</p>;

  const overall = (detail.dprSummary?.summaryRows || []).find((r) => r.overall);
  const rows = (detail.dprSummary?.summaryRows || []).filter((r) => !r.overall);

  return (
    <div className="space-y-6">
      {/* headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Planned Progress", value: `${num(detail.plannedPercent)}%`, cls: "text-cyan-300" },
          { label: "Actual Progress", value: `${num(detail.actualPercent)}%`, cls: "text-emerald-300" },
          { label: "Gross Cost", value: `₹${num(detail.capex?.grossCost)} Cr`, cls: "text-amber-300" },
          { label: "Exp. till last FY", value: `₹${num(detail.capex?.actualTillLastFy)} Cr`, cls: "text-violet-300" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k.label}</p>
            <p className={`text-2xl font-bold ${k.cls}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* S-curve overlay */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <TrendingUp className="h-4 w-4 text-violet-400" /> S-Curve — Plan Versions Overlay
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white outline-none"
            >
              {activityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {plans.map((p) => (
              <button
                key={p.planName}
                onClick={() =>
                  setSelectedPlans((cur) =>
                    cur.includes(p.planName) ? cur.filter((n) => n !== p.planName) : [...cur, p.planName])}
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                  selectedPlans.includes(p.planName)
                    ? "border-violet-500/60 bg-violet-500/20 text-violet-200"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p.financialYear} · {p.planVersion}{p.isActive ? " ●" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: "#09090b", border: "1px solid #3f3f46", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {shownPlans.map((p, pi) => [
                <Line key={`p${pi}`} type="monotone" dataKey={`plan_${pi}`} name={`${p.planVersion} Plan`}
                  stroke={LINE_COLORS[pi % LINE_COLORS.length]} strokeDasharray="6 3" dot={false} strokeWidth={2} />,
                <Line key={`a${pi}`} type="monotone" dataKey={`actual_${pi}`} name={`${p.planVersion} Actual`}
                  stroke={LINE_COLORS[pi % LINE_COLORS.length]} dot={{ r: 2 }} strokeWidth={2.5} />,
              ])}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* CAPEX monthly */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <IndianRupee className="h-4 w-4 text-amber-400" /> CAPEX — Monthly Plan vs Actual (₹ Cr)
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={detail.capex?.monthly || []} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="monthKey" tick={{ fill: "#71717a", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "#09090b", border: "1px solid #3f3f46", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="plan" name="Plan" fill="#22d3ee" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DPR summary table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Activity className="h-4 w-4 text-emerald-400" /> Physical & Financial Progress — {detail.selectedMonth}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Activity</th>
                <th className="px-2 py-2 text-right">Scope</th>
                <th className="px-2 py-2 text-center">UoM</th>
                <th className="px-2 py-2 text-right">Till Last FY %</th>
                <th className="px-2 py-2 text-right">FTM Plan %</th>
                <th className="px-2 py-2 text-right">FTM Actual %</th>
                <th className="px-2 py-2 text-right">FY Plan %</th>
                <th className="px-2 py-2 text-right">FY Actual %</th>
                <th className="px-2 py-2 text-right">Cum Plan %</th>
                <th className="px-2 py-2 text-right">Cum Actual %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((r: any) => (
                <tr key={String(r.id)} className={r.source === "capex" ? "bg-amber-500/5" : ""}>
                  <td className="px-3 py-1.5 text-zinc-200">{r.activity || r.category}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.scope)}</td>
                  <td className="px-2 py-1.5 text-center text-zinc-500">{r.uom || "—"}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-400">{num(r.lastFyActualPercent)}</td>
                  <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.ftmPlanPercent)}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.ftmActualPercent)}</td>
                  <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.currentFyPlanPercent)}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-300">{num(r.currentFyActualPercent)}</td>
                  <td className="px-2 py-1.5 text-right text-cyan-300">{num(r.cumulativePlanPercent)}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-emerald-300">{num(r.cumulativeActualPercent)}</td>
                </tr>
              ))}
              {overall && (
                <tr className="bg-violet-500/10 font-bold">
                  <td className="px-3 py-2 text-violet-300">Overall Progress</td>
                  <td className="px-2 py-2 text-right text-zinc-300">{num(overall.scope)}</td>
                  <td colSpan={6} />
                  <td className="px-2 py-2 text-right text-cyan-300">{num(overall.cumulativePlanPercent)}</td>
                  <td className="px-2 py-2 text-right text-emerald-300">{num(overall.cumulativeActualPercent)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* remarks keyword scan */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <MessageSquare className="h-4 w-4 text-pink-400" /> Monthly Site Remarks Summary
          </h3>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-1.5 text-left">Month</th>
                <th className="px-2 py-1.5 text-right">Started</th>
                <th className="px-2 py-1.5 text-right">Completed</th>
                <th className="px-2 py-1.5 text-right">Under Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {(detail.monthlyRemarkSummary || []).map((m) => (
                <tr key={m.month} className={m.month === detail.selectedMonth ? "bg-pink-500/10" : ""}>
                  <td className="px-2 py-1.5 text-zinc-300">{m.month}</td>
                  <td className="px-2 py-1.5 text-right text-cyan-300">{m.started}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-300">{m.completed}</td>
                  <td className="px-2 py-1.5 text-right text-amber-300">{m.underProgress}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.selectedMonthRemarks?.length > 0 && (
            <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto">
              {detail.selectedMonthRemarks.map((r, i) => (
                <p key={i} className="rounded-lg bg-zinc-950 px-3 py-1.5 text-[11px] text-zinc-400">
                  <span className="text-zinc-500">{r.date}</span>{" "}
                  <span className="font-bold text-zinc-300">{r.activity}:</span> {r.remark}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* manpower table */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <Users className="h-4 w-4 text-teal-400" />
            Manpower — Month Average ({detail.manpowerPmcTable?.monthLabel}, DPR days: {detail.manpowerPmcTable?.filledDays ?? 0})
          </h3>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-zinc-800/60">
              {(detail.manpowerPmcTable?.rows || []).map((row: any, i: number) => (
                <tr key={i}>
                  <td className="w-8 px-2 py-1.5 text-zinc-500">{row.slNo}</td>
                  <td className="px-2 py-1.5 whitespace-pre-line text-zinc-300">{row.agency}</td>
                  <td className="px-2 py-1.5 text-zinc-400">{row.manpower}</td>
                  <td className="px-2 py-1.5 text-zinc-400">{row.category}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-teal-300">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
