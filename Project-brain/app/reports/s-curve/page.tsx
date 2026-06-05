"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, AlertTriangle, Activity, Calendar, Target, Package } from "lucide-react";

const API = "http://localhost:8002/api/v1";

type Point = { month: string; value: number };
type SCurveResp = {
  planned: Point[];
  actual: Point[];
  packages?: { package_id: number; package_name: string; planned: Point[]; actual: Point[] }[];
  note?: string;
};
type PkgSCurveResp = {
  package_id: number;
  package_name: string;
  planned: Point[];
  actual: Point[];
};

function mergePoints(planned: Point[], actual: Point[]) {
  const map = new Map<string, { month: string; planned: number; actual: number | null }>();
  for (const p of planned) map.set(p.month, { month: p.month, planned: p.value, actual: null });
  for (const a of actual) {
    const ex = map.get(a.month);
    if (ex) ex.actual = a.value;
    else map.set(a.month, { month: a.month, planned: 0, actual: a.value });
  }
  // Sort by calendar order: months come as "Apr-24", "May-24", etc.
  const sorted = Array.from(map.values()).sort((a, b) => {
    const toDate = (s: string) => {
      const [mon, yr] = s.split("-");
      const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      return new Date(2000 + parseInt(yr || "0"), (months as any)[mon] ?? 0, 1).getTime();
    };
    return toDate(a.month) - toDate(b.month);
  });
  return sorted;
}

export default function SCurveReport() {
  const searchParams = useSearchParams();
  const schemeId = searchParams.get("id") ?? "";

  const [view, setView] = useState<"scheme" | "package">("scheme");
  const [schemeData, setSchemeData] = useState<SCurveResp | null>(null);
  const [packages, setPackages] = useState<{ package_id: number; package_name: string }[]>([]);
  const [selPkgId, setSelPkgId] = useState<number | null>(null);
  const [pkgData, setPkgData] = useState<PkgSCurveResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load scheme-level S-curve
  useEffect(() => {
    if (!schemeId) return;
    setLoading(true); setError(null);
    fetch(`${API}/s-curve/${schemeId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((d) => {
        setSchemeData(d);
        if (Array.isArray(d.packages) && d.packages.length > 0) {
          setPackages(d.packages.map((p: any) => ({ package_id: p.package_id, package_name: p.package_name })));
          setSelPkgId(d.packages[0].package_id);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [schemeId]);

  // Load package-level S-curve when package changes
  useEffect(() => {
    if (!selPkgId || view !== "package") return;
    setLoading(true);
    fetch(`${API}/s-curve/package/${selPkgId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setPkgData)
      .catch(() => setPkgData(null))
      .finally(() => setLoading(false));
  }, [selPkgId, view]);

  const activeData = view === "scheme" ? schemeData : pkgData;

  const chartData = useMemo(() => {
    if (!activeData) return [];
    return mergePoints(activeData.planned, activeData.actual);
  }, [activeData]);

  // Current month stats
  const today = new Date();
  const todayLabel = `${today.toLocaleString("en-IN", { month: "short" })}-${String(today.getFullYear()).slice(2)}`;
  const todayPoint = chartData.find((p) => p.month === todayLabel) ?? chartData[chartData.length - 1];
  const planned = todayPoint?.planned ?? 0;
  const actual = todayPoint?.actual ?? planned;
  const variance = (actual ?? 0) - planned;
  const varCls = variance >= 0 ? "text-emerald-400" : variance >= -5 ? "text-amber-400" : "text-red-400";

  // Last actual point
  const lastActual = [...chartData].reverse().find((p) => p.actual != null);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="text-cyan-400" size={22} />
            S-Curve — Plan vs Actual
          </h1>
          <p className="text-zinc-400 text-xs mt-0.5">Scheme #{schemeId} · Cumulative progress %</p>
        </div>
        <Link href="/reports" className="text-xs text-cyan-400 hover:text-cyan-300 underline">← Reports hub</Link>
      </div>

      {/* View toggle + package selector */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
          {(["scheme", "package"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors capitalize ${view === v ? "bg-cyan-500/20 text-cyan-300" : "text-zinc-400 hover:text-zinc-200"}`}>
              {v === "scheme" ? "Scheme (rolled up)" : "Per Package"}
            </button>
          ))}
        </div>

        {view === "package" && packages.length > 0 && (
          <select value={selPkgId ?? ""} onChange={(e) => setSelPkgId(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/60">
            {packages.map((p) => (
              <option key={p.package_id} value={p.package_id}>{p.package_name || `Pkg #${p.package_id}`}</option>
            ))}
          </select>
        )}

        {loading && <span className="text-xs text-zinc-500 animate-pulse">Loading…</span>}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-5 flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!schemeId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400 text-sm">
          No scheme selected. <Link href="/reports" className="underline">Go back to Reports hub.</Link>
        </div>
      )}

      {activeData && chartData.length === 0 && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-8 text-center text-zinc-500 text-sm">
          No plan data found for this scheme. Create and lock a plan in the Plan Engine first.
        </div>
      )}

      {chartData.length > 0 && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Planned (current)", value: `${planned.toFixed(1)}%`, icon: Target, cls: "text-violet-400" },
              { label: "Actual (current)", value: lastActual ? `${(lastActual.actual ?? 0).toFixed(1)}%` : "—", icon: Activity, cls: "text-emerald-400" },
              { label: "Variance", value: `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`, icon: AlertTriangle, cls: varCls },
              { label: "Last Data Point", value: lastActual?.month ?? "—", icon: Calendar, cls: "text-zinc-300" },
            ].map(({ label, value, icon: Icon, cls }) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className={cls} />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</span>
                </div>
                <div className={`text-xl font-bold ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Main Chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 mb-5">
            <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-cyan-400" />
              Cumulative S-Curve (0–100%)
              <span className="ml-auto text-[10px] text-zinc-500">{chartData.length} data points</span>
            </h2>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" stroke="#71717a" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} stroke="#71717a" tick={{ fontSize: 11 }}
                  label={{ value: "%", angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  formatter={(val: any, name: string) => [`${Number(val).toFixed(1)}%`, name]}
                />
                <Legend />
                <ReferenceLine y={100} stroke="#52525b" strokeDasharray="4 4" label={{ value: "100%", fill: "#52525b", fontSize: 10 }} />
                {/* Planned area */}
                <Area type="monotone" dataKey="planned" stroke="#a78bfa" fill="#a78bfa22"
                  strokeWidth={2} dot={false} name="Planned %" />
                {/* Actual line */}
                <Line type="monotone" dataKey="actual" stroke="#34d399" strokeWidth={2.5}
                  dot={{ fill: "#34d399", r: 3 }} connectNulls={false} name="Actual %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly table */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2">
              <Package size={13} className="text-violet-400" />
              <span className="text-xs font-semibold text-zinc-300">Monthly Data Table</span>
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-[11px]">
                <thead className="bg-zinc-900/80 sticky top-0">
                  <tr className="border-b border-zinc-700">
                    <th className="px-4 py-2 text-left text-zinc-400 font-bold">Month</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Planned %</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Actual %</th>
                    <th className="px-4 py-2 text-right text-zinc-400 font-bold">Variance</th>
                    <th className="px-4 py-2 text-left text-zinc-400 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row, i) => {
                    const act = row.actual;
                    const var_ = act != null ? act - row.planned : null;
                    return (
                      <tr key={row.month} className={`border-b border-zinc-800/40 hover:bg-zinc-900/40 ${i % 2 ? "bg-zinc-900/10" : ""}`}>
                        <td className="px-4 py-1.5 text-zinc-300 font-mono">{row.month}</td>
                        <td className="px-4 py-1.5 text-violet-400 text-right font-mono">{row.planned.toFixed(1)}%</td>
                        <td className="px-4 py-1.5 text-right font-mono">
                          {act != null ? <span className="text-emerald-400">{act.toFixed(1)}%</span> : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className={`px-4 py-1.5 text-right font-mono font-bold ${var_ == null ? "text-zinc-600" : var_ >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {var_ != null ? `${var_ >= 0 ? "+" : ""}${var_.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-1.5">
                          {var_ == null ? <span className="text-zinc-600 text-[9px]">No data</span> :
                            var_ >= 0 ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">On Track</span> :
                            var_ >= -5 ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-bold">At Risk</span> :
                            <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-bold">Behind</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
