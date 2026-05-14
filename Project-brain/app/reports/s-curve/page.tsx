"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import NeuralAssistant from "@/components/NeuralAssistant";

type SeriesPoint = { month: string; value: number };

type SCurveResponse = {
  planned: SeriesPoint[];
  actual: SeriesPoint[];
};

const FY_MONTH_ORDER = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
] as const;

function mergeForChart(planned: SeriesPoint[], actual: SeriesPoint[]) {
  const plannedByMonth = new Map(planned.map((p) => [p.month, p.value]));
  const actualByMonth = new Map(actual.map((a) => [a.month, a.value]));
  const months = new Set<string>([...plannedByMonth.keys(), ...actualByMonth.keys()]);
  const ordered = FY_MONTH_ORDER.filter((m) => months.has(m));
  const extras = [...months].filter(
    (m) => !FY_MONTH_ORDER.includes(m as (typeof FY_MONTH_ORDER)[number])
  );
  extras.sort();
  return [...ordered, ...extras].map((month) => ({
    month,
    Planned: plannedByMonth.get(month) ?? 0,
    Actual: actualByMonth.get(month) ?? 0,
  }));
}

export default function SCurveDashboard() {
  const searchParams = useSearchParams();
  const scheme = searchParams.get("id") ?? "1";
  const [data, setData] = useState<SCurveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scheme) return;
    setError(null);
    setData(null);
    fetch(`http://localhost:8000/api/v1/s-curve/${scheme}`)
      .then((res) => {
        if (res.status === 404) {
          throw new Error("No active corporate plan for this scheme.");
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load S-curve"));
  }, [scheme]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return mergeForChart(data.planned, data.actual);
  }, [data]);

  return (
    <div className="p-8 neural-bg min-h-screen text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold text-cyan-400">Project S-Curve Analytics</h1>
        <Link href="/reports" className="text-sm text-cyan-400 hover:text-cyan-300 underline">
          Reports hub
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-input p-6 rounded-2xl h-[500px]">
          {error ? (
            <p className="text-rose-400">{error}</p>
          ) : !data ? (
            <p className="text-zinc-400">Loading scheme #{scheme}…</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#000", border: "1px solid #22d3ee" }}
                />
                <Legend />
                <Line type="monotone" dataKey="Planned" stroke="#22d3ee" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="Actual" stroke="#f43f5e" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-input p-6 rounded-2xl">
          <h2 className="text-xl font-semibold mb-4">AI DPR Insights</h2>
          <div className="space-y-4 text-sm text-zinc-300">
            <p>Analyzing scheme #{scheme} progress…</p>
            <p className="p-3 bg-zinc-800 rounded-lg border-l-4 border-amber-500">
              Notice: compare planned vs actual from the live S-curve endpoint once actuals are
              captured in corporate actuals.
            </p>
          </div>
        </div>
      </div>

      <NeuralAssistant />
    </div>
  );
}
