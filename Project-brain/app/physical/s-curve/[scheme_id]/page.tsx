"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
  const extras = [...months].filter((m) => !FY_MONTH_ORDER.includes(m as (typeof FY_MONTH_ORDER)[number]));
  extras.sort();

  return [...ordered, ...extras].map((month) => ({
    month,
    Planned: plannedByMonth.get(month) ?? 0,
    Actual: actualByMonth.get(month) ?? 0,
  }));
}

export default function SCurvePage() {
  const params = useParams();
  const schemeId = typeof params?.scheme_id === "string" ? params.scheme_id : "";
  const [data, setData] = useState<SCurveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schemeId) return;
    setError(null);
    setData(null);
    fetch(`http://localhost:8000/api/v1/s-curve/${schemeId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(() => setError("Could not load S-curve. Is the backend running and is there an active plan?"));
  }, [schemeId]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return mergeForChart(data.planned, data.actual);
  }, [data]);

  if (!schemeId) {
    return <div className="p-10 text-white">Invalid scheme.</div>;
  }

  if (error) {
    return (
      <div className="p-8 bg-zinc-900 min-h-screen text-white">
        <p className="text-rose-400 mb-4">{error}</p>
        <Link href="/physical" className="text-cyan-400 underline">
          Back to Physical Progress
        </Link>
      </div>
    );
  }

  if (!data) {
    return <div className="p-10 text-white">Loading S-Curve...</div>;
  }

  return (
    <div className="p-8 bg-zinc-900 min-h-screen text-white">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">S-Curve Analysis: Scheme #{schemeId}</h1>
        <Link
          href="/physical"
          className="text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-800 rounded-lg px-4 py-2"
        >
          Back to hub
        </Link>
      </div>
      <div className="h-[500px] w-full bg-zinc-800/50 p-6 rounded-xl border border-zinc-700">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="month" stroke="#888" />
            <YAxis stroke="#888" domain={[0, 100]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#000",
                border: "1px solid #22d3ee",
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="Planned" stroke="#22d3ee" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="Actual" stroke="#f43f5e" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
