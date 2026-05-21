"use client";
import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, Area, ComposedChart
} from "recharts";
import { motion } from "framer-motion";
import { TrendingUp, AlertTriangle, Calendar, Target, Activity } from "lucide-react";

const API = "http://localhost:8000";

type SCurvePoint = {
  month_date: string;
  cumulative_planned_pct: number;
  cumulative_actual_pct: number | null;
  is_forecast: boolean;
};

type SCurveData = {
  package_id: number;
  package_name: string;
  scheme_name: string;
  points: SCurvePoint[];
  today_planned_pct: number | null;
  today_actual_pct: number | null;
  today_variance_pct: number | null;
  forecast_completion_date: string | null;
  forecast_method: string | null;
  forecast_confidence_pct: number | null;
  forecast_explainer: string | null;
};

export default function SCurvePage() {
  const [packageId, setPackageId] = useState<number>(1);
  const [packages, setPackages] = useState<{ package_id: number; package_name: string; scheme_name: string }[]>([]);
  const [data, setData] = useState<SCurveData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/portfolio/packages`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setPackages(d.packages || d))
      .catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (!packageId) return;
    setLoading(true); setError(null);
    fetch(`${API}/api/v1/progress/s-curve/${packageId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [packageId]);

  const chartData = (data?.points || []).map(p => ({
    month: p.month_date.slice(0, 7),
    planned: p.cumulative_planned_pct,
    actual: p.is_forecast ? null : p.cumulative_actual_pct,
    forecast: p.is_forecast ? p.cumulative_actual_pct : null,
  }));

  const variance = data?.today_variance_pct ?? 0;
  const varianceColor = variance < -10 ? "text-red-400" : variance < -3 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-8 h-8 text-indigo-400" />
            <h1 className="text-3xl font-bold">S-Curve Predict</h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">SPRINT 5 · PREDICT</span>
          </div>
          <p className="text-zinc-400 mb-6">
            Cumulative progress curve with linear-regression forecast. Friend's app shows tables; we show the future.
          </p>
        </motion.div>

        <div className="mb-6">
          <label className="block text-sm text-zinc-400 mb-1">Package</label>
          <select
            value={packageId}
            onChange={e => setPackageId(Number(e.target.value))}
            className="w-full md:w-96 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100"
          >
            {packages.map(p => (
              <option key={p.package_id} value={p.package_id}>
                {p.scheme_name} — {p.package_name}
              </option>
            ))}
            {packages.length === 0 && <option value={1}>Package #1</option>}
          </select>
        </div>

        {loading && <div className="text-zinc-400">Loading S-curve...</div>}
        {error && <div className="text-red-400">Error: {error}</div>}

        {data && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card icon={<Target className="w-5 h-5 text-indigo-400" />} label="Planned (today)"
                    value={`${data.today_planned_pct?.toFixed(1) ?? "—"}%`} />
              <Card icon={<Activity className="w-5 h-5 text-emerald-400" />} label="Actual (today)"
                    value={`${data.today_actual_pct?.toFixed(1) ?? "—"}%`} />
              <Card icon={<AlertTriangle className={`w-5 h-5 ${varianceColor}`} />} label="Variance"
                    value={`${variance > 0 ? "+" : ""}${variance.toFixed(1)}%`} className={varianceColor} />
              <Card icon={<Calendar className="w-5 h-5 text-purple-400" />} label="Forecast Completion"
                    value={data.forecast_completion_date ?? "Need ≥3 data points"} small />
            </div>

            {/* Chart */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                        className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Cumulative S-Curve</h2>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="month" stroke="#71717a" />
                  <YAxis domain={[0, 100]} stroke="#71717a" label={{ value: "%", position: "insideLeft", fill: "#71717a" }} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }} />
                  <Legend />
                  <ReferenceLine y={100} stroke="#a78bfa" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="planned" stroke="#a78bfa" strokeWidth={2}
                        dot={{ fill: "#a78bfa", r: 3 }} name="Planned" />
                  <Line type="monotone" dataKey="actual" stroke="#34d399" strokeWidth={2}
                        dot={{ fill: "#34d399", r: 3 }} name="Actual" />
                  <Line type="monotone" dataKey="forecast" stroke="#fbbf24" strokeWidth={2}
                        strokeDasharray="5 5" dot={{ fill: "#fbbf24", r: 3 }} name="Forecast" />
                </ComposedChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Forecast explainer */}
            {data.forecast_explainer && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-semibold">Forecast Explanation</h3>
                  {data.forecast_confidence_pct !== null && (
                    <span className="ml-auto text-sm text-zinc-400">
                      Confidence: <strong className="text-zinc-200">{data.forecast_confidence_pct}%</strong>
                    </span>
                  )}
                </div>
                <p className="text-zinc-300">{data.forecast_explainer}</p>
              </div>
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
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-sm text-zinc-400">{label}</span></div>
      <div className={`${small ? "text-lg" : "text-2xl"} font-bold ${className}`}>{value}</div>
    </div>
  );
}
