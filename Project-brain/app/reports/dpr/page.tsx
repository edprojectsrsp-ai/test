"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { ClipboardList, AlertTriangle, Calendar, Activity, TrendingUp } from "lucide-react";

const API = "http://localhost:8000/api/v1";

function DprReportContent() {
  const searchParams = useSearchParams();
  const schemeId = searchParams.get("id") ?? "";

  const [packages, setPackages] = useState<any[]>([]);
  const [selPkg, setSelPkg] = useState<number | null>(null);
  const [selMonth, setSelMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [summary, setSummary] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const months: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 18; i++) {
    months.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
    });
    d.setMonth(d.getMonth() - 1);
  }

  // Load packages for scheme
  useEffect(() => {
    if (!schemeId) return;
    fetch(`${API}/dpr/scheme/${schemeId}/packages`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d) && d.length > 0) {
          setPackages(d);
          setSelPkg(d[0].package_id);
        }
      })
      .catch(() => {});
  }, [schemeId]);

  // Load DPR data when package/month changes
  useEffect(() => {
    if (!selPkg) return;
    setLoading(true); setError(null);
    Promise.all([
      fetch(`${API}/dpr/actuals/${selPkg}?month=${selMonth}`).then((r) => r.json()),
      fetch(`${API}/dpr/summary/${selPkg}?month=${selMonth}`).then((r) => r.json()),
      fetch(`${API}/dpr/packages/${selPkg}/activities`).then((r) => r.json()),
    ])
      .then(([acts, monthSummary, actList]) => {
        setRecent(Array.isArray(acts) ? acts : []);
        // summary: array of {activity_id, activity_name, month_actual, month_plan, cum_actual, scope_qty, progress_pct}
        setSummary(Array.isArray(monthSummary) ? monthSummary : []);
        setActivities(Array.isArray(actList) ? actList : []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selPkg, selMonth]);

  // summary is per-activity for selected month: {activity_name, month_actual, month_plan, cum_actual, scope_qty, progress_pct}
  // Chart data: activity vs month_actual vs month_plan
  const chartData = summary.map((s: any) => ({
    name: (s.activity_name || "").substring(0, 18),
    month_actual: parseFloat(s.month_actual || 0),
    month_plan: parseFloat(s.month_plan || 0),
    progress_pct: parseFloat(s.progress_pct || 0),
  }));

  // Activity stats for current month — join summary with activities list
  const activityStats = summary.length > 0 ? summary : activities.map((a: any) => {
    const entries = recent.filter((r: any) => r.activity_id === a.activity_id);
    const total = entries.reduce((s: number, e: any) => s + parseFloat(e.actual_qty || 0), 0);
    return { ...a, month_actual: total, month_plan: 0, cum_actual: 0, scope_qty: a.scope_qty, progress_pct: 0, entry_count: entries.length };
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ClipboardList className="text-amber-400" size={22} />
            DPR Analysis Report
          </h1>
          <p className="text-zinc-400 text-xs mt-0.5">Scheme #{schemeId} · Daily Progress Records</p>
        </div>
        <Link href="/reports" className="text-xs text-cyan-400 hover:text-cyan-300 underline">← Reports hub</Link>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 mb-5 flex flex-wrap items-center gap-3">
        {packages.length > 0 && (
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Package</label>
            <select value={selPkg ?? ""} onChange={(e) => setSelPkg(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/60">
              {packages.map((p) => (
                <option key={p.package_id} value={p.package_id}>{p.package_name || `Pkg #${p.package_id}`}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Month</label>
          <select value={selMonth} onChange={(e) => setSelMonth(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/60">
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {loading && <span className="text-xs text-zinc-500 animate-pulse ml-2">Loading…</span>}
      </div>

      {!schemeId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400 text-sm">
          No scheme selected. <Link href="/reports" className="underline">Go back.</Link>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {schemeId && (
        <div className="space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "DPR Entries (month)", value: recent.length, cls: "text-amber-400", icon: ClipboardList },
              { label: "Activities Tracked", value: activities.length, cls: "text-cyan-400", icon: Activity },
              { label: "Total Qty (month)", value: recent.reduce((s: number, r: any) => s + parseFloat(r.actual_qty || 0), 0).toFixed(1), cls: "text-emerald-400", icon: TrendingUp },
              { label: "Months of Data", value: summary.length, cls: "text-violet-400", icon: Calendar },
            ].map(({ label, value, cls, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center gap-2 mb-2"><Icon size={13} className={cls} /><span className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</span></div>
                <div className={`text-2xl font-bold ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Activity plan vs actual bar chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                <Activity size={14} className="text-amber-400" /> Activity Plan vs Actual — {selMonth}
              </h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" stroke="#71717a" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11 }} />
                  <Legend />
                  <Bar dataKey="month_plan" fill="#6366f1" name="Planned Qty" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="month_actual" fill="#f59e0b" name="Actual Qty" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Activity-wise summary table */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2">
              <Activity size={13} className="text-amber-400" />
              <span className="text-xs font-semibold text-zinc-300">Activity-wise Summary — {selMonth}</span>
            </div>
            {activityStats.length === 0 ? (
              <p className="px-4 py-6 text-xs text-zinc-500 text-center">No activities found for this package.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="bg-zinc-900/80">
                  <tr className="border-b border-zinc-700">
                    <th className="px-4 py-2 text-left text-zinc-400 font-bold">Activity</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Scope</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Month Plan</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Month Actual</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Cumulative</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Progress %</th>
                  </tr>
                </thead>
                <tbody>
                  {activityStats.map((a: any, i: number) => (
                    <tr key={a.activity_id || i} className={`border-b border-zinc-800/40 hover:bg-zinc-900/40 ${i % 2 ? "bg-zinc-900/10" : ""}`}>
                      <td className="px-4 py-2 text-zinc-200 max-w-[240px] truncate" title={a.activity_name}>{a.activity_name}</td>
                      <td className="px-4 py-2 text-zinc-400 text-right font-mono">{a.scope_qty ?? "—"}</td>
                      <td className="px-4 py-2 text-violet-400 text-right font-mono">{parseFloat(a.month_plan || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-amber-400 text-right font-mono font-bold">{parseFloat(a.month_actual || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-emerald-400 text-right font-mono">{parseFloat(a.cum_actual || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">
                        {a.progress_pct > 0 ? (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${a.progress_pct > 80 ? "bg-emerald-500/20 text-emerald-400" : a.progress_pct > 50 ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>
                            {parseFloat(a.progress_pct).toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent DPR entries */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2">
              <ClipboardList size={13} className="text-emerald-400" />
              <span className="text-xs font-semibold text-zinc-300">Recent DPR Entries — {selMonth}</span>
              <span className="ml-auto text-[10px] text-zinc-500">{recent.length} records</span>
            </div>
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-xs text-zinc-500 text-center">No DPR entries for this period.</p>
            ) : (
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-[11px]">
                  <thead className="bg-zinc-900/80 sticky top-0">
                    <tr className="border-b border-zinc-700">
                      <th className="px-3 py-2 text-left text-zinc-400 font-bold">Date</th>
                      <th className="px-3 py-2 text-left text-zinc-400 font-bold">Activity</th>
                      <th className="px-3 py-2 text-left text-zinc-400 font-bold">Area of Work</th>
                      <th className="px-3 py-2 text-right text-zinc-400 font-bold">Qty</th>
                      <th className="px-3 py-2 text-left text-zinc-400 font-bold">Remarks</th>
                      <th className="px-3 py-2 text-left text-zinc-400 font-bold">Via</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r: any, i: number) => (
                      <tr key={r.daily_actual_id || i} className={`border-b border-zinc-800/40 hover:bg-zinc-900/40 ${i % 2 ? "bg-zinc-900/10" : ""}`}>
                        <td className="px-3 py-1.5 text-zinc-400 font-mono whitespace-nowrap">{r.actual_date}</td>
                        <td className="px-3 py-1.5 text-zinc-200 max-w-[180px] truncate" title={r.activity_name}>{r.activity_name}</td>
                        <td className="px-3 py-1.5 text-zinc-400 max-w-[120px] truncate">{r.area_of_work || "—"}</td>
                        <td className="px-3 py-1.5 text-amber-400 text-right font-bold font-mono">{parseFloat(r.actual_qty || 0).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-zinc-500 max-w-[160px] truncate">{r.remarks || "—"}</td>
                        <td className="px-3 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${r.entered_via === "app" ? "bg-blue-500/20 text-blue-400" : r.entered_via === "dpr" ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>
                            {r.entered_via || "web"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DprReport() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 p-8 text-zinc-400">Loading DPR report…</div>}>
      <DprReportContent />
    </Suspense>
  );
}
