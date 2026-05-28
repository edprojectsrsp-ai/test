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

type PackageWeight = {
  package_id: number;
  package_name: string;
  weight: number;
  weight_source: string;
};

type SCurveResponse = {
  planned: SeriesPoint[];
  actual: SeriesPoint[];
  packages?: PackageWeight[];
  note?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8002";

const CAL_MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseLabel(label: string): { mon: string; yy: number } | null {
  const m = label.match(/^([A-Za-z]{3})(?:-(\d{2}))?$/);
  if (!m) return null;
  return { mon: m[1], yy: m[2] ? parseInt(m[2], 10) : 0 };
}

function sortKey(label: string): number {
  const p = parseLabel(label);
  if (!p) return Number.MAX_SAFE_INTEGER;
  const calMon = CAL_MONTH_INDEX[p.mon] ?? 0;
  return p.yy * 12 + calMon;
}

function mergeForChart(planned: SeriesPoint[], actual: SeriesPoint[]) {
  const plannedByMonth = new Map(planned.map((p) => [p.month, p.value]));
  const actualByMonth = new Map(actual.map((a) => [a.month, a.value]));

  const months = new Set<string>([
    ...plannedByMonth.keys(),
    ...actualByMonth.keys(),
  ]);

  const ordered = [...months].sort((a, b) => sortKey(a) - sortKey(b));

  return ordered.map((month) => ({
    month,
    Planned: plannedByMonth.get(month) ?? null,
    Actual: actualByMonth.get(month) ?? null,
  }));
}

export default function SCurveClient() {
  const params = useParams();
  const schemeId = typeof params?.scheme_id === "string" ? params.scheme_id : "";
  const [data, setData] = useState<SCurveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schemeId) return;
    setError(null);
    setData(null);
    fetch(`${API_BASE}/api/v1/s-curve/${schemeId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(() =>
        setError(
          "Could not load S-curve. Is the backend running and is there an active plan?"
        )
      );
  }, [schemeId]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return mergeForChart(data.planned ?? [], data.actual ?? []);
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

  const isEmpty = chartData.length === 0;

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

      {isEmpty ? (
        <div className="h-[300px] w-full bg-zinc-800/50 p-6 rounded-xl border border-zinc-700 flex items-center justify-center">
          <p className="text-zinc-400">
            {data.note === "no plan data yet"
              ? "No plan data for this scheme yet. Create a plan and enter actuals to see the curve."
              : "No data points to display."}
          </p>
        </div>
      ) : (
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
              <Line
                type="monotone"
                dataKey="Planned"
                stroke="#22d3ee"
                strokeWidth={3}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="Actual"
                stroke="#f43f5e"
                strokeWidth={3}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.packages && data.packages.length > 0 && (
        <div className="mt-6 bg-zinc-800/50 p-6 rounded-xl border border-zinc-700">
          <h2 className="text-lg font-semibold mb-3">
            Package Rollup ({data.packages.length} packages)
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-400 border-b border-zinc-700">
                <th className="py-2">Package</th>
                <th className="py-2">Weight</th>
                <th className="py-2">Weight source</th>
              </tr>
            </thead>
            <tbody>
              {data.packages.map((p) => (
                <tr key={p.package_id} className="border-b border-zinc-800">
                  <td className="py-2">{p.package_name}</td>
                  <td className="py-2">{p.weight.toLocaleString()}</td>
                  <td className="py-2 text-zinc-400">{p.weight_source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

