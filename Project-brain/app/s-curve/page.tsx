"use client";
import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { motion } from "framer-motion";
import { TrendingUp, AlertTriangle, Calendar, Target, Activity, Package, Building2 } from "lucide-react";

const API = "http://localhost:8002";

type Point = { month: string; value: number };
type PkgData = {
  package_id: number; package_name: string;
  points: { month_date: string; cumulative_planned_pct: number; cumulative_actual_pct: number | null; is_forecast: boolean }[];
  today_planned_pct: number | null; today_actual_pct: number | null;
  today_variance_pct: number | null;
  forecast_completion_date: string | null; forecast_method: string | null;
  forecast_confidence_pct: number | null; forecast_explainer: string | null;
};
type SchemeData = { planned: Point[]; actual: Point[]; packages: { package_id: number; package_name: string }[]; note?: string };

function toDate(label: string): number {
  const [mon, yr] = label.split("-");
  const idx = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  return new Date(2000 + parseInt(yr || "0"), (idx as any)[mon] ?? 0, 1).getTime();
}

function mergeSchemePoints(planned: Point[], actual: Point[]) {
  const map = new Map<string, { month: string; planned: number; actual: number | null }>();
  for (const p of planned) map.set(p.month, { month: p.month, planned: p.value, actual: null });
  for (const a of actual) {
    const ex = map.get(a.month);
    if (ex) ex.actual = a.value; else map.set(a.month, { month: a.month, planned: 0, actual: a.value });
  }
  return Array.from(map.values()).sort((a, b) => toDate(a.month) - toDate(b.month));
}

export default function SCurvePage() {
  const [viewMode, setViewMode] = useState<"package" | "scheme">("package");

  // Package mode state
  const [packageId, setPackageId] = useState<number>(1);
  const [packages, setPackages] = useState<{ package_id: number; package_name: string; scheme_name: string }[]>([]);
  const [pkgData, setPkgData] = useState<PkgData | null>(null);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);

  // Scheme mode state
  const [schemes, setSchemes] = useState<{ id: number; name: string }[]>([]);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [schemeData, setSchemeData] = useState<SchemeData | null>(null);
  const [schemeLoading, setSchemeLoading] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);

  // Load packages list
  useEffect(() => {
    fetch(`${API}/api/v1/portfolio/packages`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setPackages(d.packages || d))
      .catch(() => setPackages([]));
    // Load schemes
    fetch(`${API}/api/v1/dashboard/scheme-cards`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setSchemes(d.map((s: any) => ({ id: s.id, name: s.name }))); })
      .catch(() => {});
  }, []);

  // Load package S-curve
  useEffect(() => {
    if (viewMode !== "package" || !packageId) return;
    setPkgLoading(true); setPkgError(null);
    fetch(`${API}/api/v1/progress/s-curve/${packageId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setPkgData)
      .catch(e => setPkgError(String(e)))
      .finally(() => setPkgLoading(false));
  }, [packageId, viewMode]);

  // Load scheme S-curve
  useEffect(() => {
    if (viewMode !== "scheme" || !schemeId) return;
    setSchemeLoading(true); setSchemeError(null);
    fetch(`${API}/api/v1/s-curve/${schemeId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setSchemeData)
      .catch(e => setSchemeError(String(e)))
      .finally(() => setSchemeLoading(false));
  }, [schemeId, viewMode]);

  // Package chart data
  const pkgChartData = useMemo(() => (pkgData?.points || []).map(p => ({
    month: p.month_date.slice(0, 7),
    planned: p.cumulative_planned_pct,
    actual: p.is_forecast ? null : p.cumulative_actual_pct,
    forecast: p.is_forecast ? p.cumulative_actual_pct : null,
  })), [pkgData]);

  // Scheme chart data
  const schemeChartData = useMemo(() => {
    if (!schemeData) return [];
    return mergeSchemePoints(schemeData.planned, schemeData.actual);
  }, [schemeData]);

  const variance = pkgData?.today_variance_pct ?? 0;
  const varCls = variance < -10 ? "text-red-400" : variance < -3 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-1">
            <TrendingUp className="w-7 h-7 text-indigo-400" />
            <h1 className="text-2xl font-bold">S-Curve — Plan vs Actual</h1>
          </div>
          <p className="text-zinc-400 text-sm mb-5">Cumulative progress with linear-regression forecast</p>
        </motion.div>

        {/* View toggle + selectors */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 mb-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">View</label>
            <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
              <button onClick={() => setViewMode("package")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === "package" ? "bg-indigo-500/20 text-indigo-300" : "text-zinc-400 hover:text-zinc-200"}`}>
                <Package size={12} /> Package Level
              </button>
              <button onClick={() => setViewMode("scheme")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === "scheme" ? "bg-cyan-500/20 text-cyan-300" : "text-zinc-400 hover:text-zinc-200"}`}>
                <Building2 size={12} /> Scheme Level
              </button>
            </div>
          </div>

          {viewMode === "package" && (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Package</label>
              <select value={packageId} onChange={e => setPackageId(Number(e.target.value))}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500/60 min-w-[260px]">
                {packages.map(p => (
                  <option key={p.package_id} value={p.package_id}>{p.scheme_name} — {p.package_name}</option>
                ))}
                {packages.length === 0 && <option value={1}>Package #1</option>}
              </select>
            </div>
          )}

          {viewMode === "scheme" && (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Scheme</label>
              <select value={schemeId ?? ""} onChange={e => setSchemeId(Number(e.target.value) || null)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-500/60 min-w-[300px]">
                <option value="">— Select Scheme —</option>
                {schemes.map(s => <option key={s.id} value={s.id}>#{s.id} · {s.name.substring(0, 60)}</option>)}
              </select>
            </div>
          )}

          {(pkgLoading || schemeLoading) && <span className="text-xs text-zinc-500 animate-pulse">Loading…</span>}
        </div>

        {/* Package mode */}
        {viewMode === "package" && (
          <>
            {pkgError && <div className="text-red-400 text-sm mb-4">Error: {pkgError}</div>}
            {pkgData && (
              <>
                <div className="grid grid-cols-4 gap-3 mb-5">
                  {[
                    { label: "Planned (today)", value: `${pkgData.today_planned_pct?.toFixed(1) ?? "—"}%`, icon: Target, cls: "text-indigo-400" },
                    { label: "Actual (today)", value: `${pkgData.today_actual_pct?.toFixed(1) ?? "—"}%`, icon: Activity, cls: "text-emerald-400" },
                    { label: "Variance", value: `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`, icon: AlertTriangle, cls: varCls },
                    { label: "Forecast Completion", value: pkgData.forecast_completion_date ?? "Need ≥3 data points", icon: Calendar, cls: "text-purple-400" },
                  ].map(({ label, value, icon: Icon, cls }) => (
                    <div key={label} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2"><Icon size={14} className={cls} /><span className="text-[10px] text-zinc-500 uppercase">{label}</span></div>
                      <div className={`text-xl font-bold ${cls}`}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 mb-5">
                  <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                    <TrendingUp size={14} className="text-indigo-400" /> Cumulative S-Curve (Package Level)
                    <span className="ml-auto text-[10px] text-zinc-500">{pkgChartData.length} months</span>
                  </h2>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={pkgChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="month" stroke="#71717a" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} stroke="#71717a" tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: string) => [`${Number(v).toFixed(1)}%`, n]} />
                      <Legend />
                      <ReferenceLine y={100} stroke="#52525b" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="planned" stroke="#a78bfa" fill="#a78bfa22" strokeWidth={2} dot={false} name="Planned %" />
                      <Line type="monotone" dataKey="actual" stroke="#34d399" strokeWidth={2.5} dot={{ fill: "#34d399", r: 3 }} connectNulls={false} name="Actual %" />
                      <Line type="monotone" dataKey="forecast" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Forecast %" connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {pkgData.forecast_explainer && (
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity size={14} className="text-amber-400" />
                      <h3 className="text-sm font-semibold">Forecast Explanation</h3>
                      {pkgData.forecast_confidence_pct != null && (
                        <span className="ml-auto text-xs text-zinc-400">Confidence: <strong className="text-zinc-200">{pkgData.forecast_confidence_pct}%</strong></span>
                      )}
                    </div>
                    <p className="text-zinc-300 text-sm">{pkgData.forecast_explainer}</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Scheme mode */}
        {viewMode === "scheme" && (
          <>
            {!schemeId && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400 text-sm">Select a scheme above to view its rolled-up S-curve.</div>}
            {schemeError && <div className="text-red-400 text-sm mb-4">Error: {schemeError}</div>}
            {schemeData?.note && schemeChartData.length === 0 && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-8 text-center text-zinc-500 text-sm">
                No plan data for this scheme yet. Create and lock a plan in Plan Engine.
              </div>
            )}
            {schemeChartData.length > 0 && (
              <>
                {/* Stats */}
                {(() => {
                  const last = [...schemeChartData].reverse().find(p => p.actual != null);
                  const curr = schemeChartData.find(p => p.month === new Date().toISOString().slice(0, 7)) ?? schemeChartData[schemeChartData.length - 1];
                  const var_ = last ? ((last.actual ?? 0) - last.planned) : 0;
                  const varCls2 = var_ >= 0 ? "text-emerald-400" : var_ >= -5 ? "text-amber-400" : "text-red-400";
                  return (
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                        <div className="text-[10px] text-zinc-500 uppercase mb-2">Planned (latest)</div>
                        <div className="text-2xl font-bold text-violet-400">{curr?.planned.toFixed(1) ?? "—"}%</div>
                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                        <div className="text-[10px] text-zinc-500 uppercase mb-2">Actual (latest)</div>
                        <div className={`text-2xl font-bold text-emerald-400`}>{last ? `${(last.actual ?? 0).toFixed(1)}%` : "—"}</div>
                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                        <div className="text-[10px] text-zinc-500 uppercase mb-2">Variance</div>
                        <div className={`text-2xl font-bold ${varCls2}`}>{last ? `${var_ >= 0 ? "+" : ""}${var_.toFixed(1)}%` : "—"}</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                    <Building2 size={14} className="text-cyan-400" /> Scheme-Level Rolled-Up S-Curve
                    <span className="ml-auto text-[10px] text-zinc-500">{schemeChartData.length} months</span>
                  </h2>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={schemeChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="month" stroke="#71717a" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} stroke="#71717a" tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: string) => [`${Number(v).toFixed(1)}%`, n]} />
                      <Legend />
                      <ReferenceLine y={100} stroke="#52525b" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="planned" stroke="#a78bfa" fill="#a78bfa22" strokeWidth={2} dot={false} name="Planned %" />
                      <Line type="monotone" dataKey="actual" stroke="#34d399" strokeWidth={2.5} dot={{ fill: "#34d399", r: 3 }} connectNulls={false} name="Actual %" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Package breakdown */}
                {schemeData.packages && schemeData.packages.length > 1 && (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                    <p className="text-[10px] text-zinc-500 uppercase mb-2">Packages in this scheme ({schemeData.packages.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {schemeData.packages.map((p: any) => (
                        <span key={p.package_id} className="px-2 py-1 rounded-lg bg-zinc-800 text-xs text-zinc-300 border border-zinc-700">
                          {p.package_name || `Pkg #${p.package_id}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ icon, label, value, className = "", small = false }: {
  icon: React.ReactNode; label: string; value: string; className?: string; small?: boolean;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-[10px] text-zinc-400 uppercase">{label}</span></div>
      <div className={`${small ? "text-base" : "text-2xl"} font-bold ${className}`}>{value}</div>
    </div>
  );
}
