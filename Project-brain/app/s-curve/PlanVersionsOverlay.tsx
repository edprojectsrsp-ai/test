"use client";

/**
 * S-curve plan-versions overlay (friend-parity): plot Original Plan vs each
 * Revision on one chart, with an activity filter (Overall / per activity).
 * Data comes from the unified progress service via /board/project-details.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { GitBranch } from "lucide-react";

const API = "http://localhost:8000/api/v1";
/* Soft premium pastels (readable on white) */
const COLORS = ["#0891b2", "#7c3aed", "#d97706", "#db2777", "#059669", "#2563eb"];

type TrendRow = { month: string; cumulativePlanPercent: number; cumulativeActualPercent: number };
type PlanOption = {
  planName: string; financialYear: string; planVersion: string; isActive: boolean;
  months: string[]; trend: TrendRow[];
  activityOptions: string[]; activityTrends: Record<string, TrendRow[]>;
};

export default function PlanVersionsOverlay({ schemeId }: { schemeId: number }) {
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activity, setActivity] = useState("Overall");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API}/board/project-details/${schemeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const all: PlanOption[] = d?.scurve?.plans || [];
        setPlans(all);
        const active = all.filter((p) => p.isActive).map((p) => p.planName);
        setSelected(active.length ? active : all.slice(0, 1).map((p) => p.planName));
        setActivity("Overall");
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [schemeId]);

  const shown = plans.filter((p) => selected.includes(p.planName));
  const activityOptions = useMemo(() => {
    const set = new Set<string>(["Overall"]);
    shown.forEach((p) => (p.activityOptions || []).forEach((a) => set.add(a)));
    return Array.from(set);
  }, [shown]);

  const chartData = useMemo(() => {
    const map = new Map<string, any>();
    const order: string[] = [];
    shown.forEach((p, pi) => {
      const trend = (p.activityTrends || {})[activity] || p.trend || [];
      trend.forEach((row) => {
        if (!map.has(row.month)) { map.set(row.month, { month: row.month }); order.push(row.month); }
        const e = map.get(row.month);
        e[`plan_${pi}`] = row.cumulativePlanPercent;
        e[`actual_${pi}`] = row.cumulativeActualPercent;
      });
    });
    return order.map((m) => map.get(m));
  }, [shown, activity]);

  if (!schemeId || (!loading && plans.length === 0)) return null;

  return (
    <div
      className="ui-card card-3d"
      style={{
        marginTop: 16,
        borderRadius: 18,
        border: "1px solid #e2e8f0",
        background: "linear-gradient(180deg, #ffffff 0%, #faf5ff 100%)",
        padding: "18px 20px 14px",
        boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 14px 36px -20px rgba(124,58,237,.16)",
      }}
    >
      <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 12, borderBottom: "1px solid #ede9fe" }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 750, color: "#0a0a0a" }}>
          <GitBranch size={14} color="#7c3aed" /> Plan Versions Overlay
          {loading && <span style={{ fontSize: 12, fontWeight: 600, color: "#52525b" }}>loading…</span>}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            style={{
              borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff",
              padding: "8px 12px", fontSize: 12, fontWeight: 650, color: "#0a0a0a", outline: "none",
            }}
          >
            {activityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {plans.map((p) => {
            const on = selected.includes(p.planName);
            return (
              <button
                key={p.planName}
                type="button"
                onClick={() => setSelected((cur) =>
                  cur.includes(p.planName) ? cur.filter((n) => n !== p.planName) : [...cur, p.planName])}
                style={{
                  borderRadius: 10, border: on ? "1px solid #c4b5fd" : "1px solid #e2e8f0",
                  background: on ? "#f5f3ff" : "#fff",
                  color: on ? "#6d28d9" : "#52525b",
                  padding: "7px 12px", fontSize: 11, fontWeight: 750, cursor: "pointer",
                }}
              >
                {p.financialYear} · {p.planVersion}{p.isActive ? " ●" : ""}
              </button>
            );
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 4" stroke="#e8eef6" vertical={false} />
          <XAxis dataKey="month" stroke="#e2e8f0" tick={{ fontSize: 11, fill: "#171717", fontWeight: 600 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
          <YAxis domain={[0, 100]} stroke="#e2e8f0" tick={{ fontSize: 11, fill: "#171717", fontWeight: 600 }} unit="%" axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff", border: "1px solid #cfe0ec", borderRadius: 12,
              fontSize: 12, color: "#0a0a0a", fontWeight: 600,
              boxShadow: "0 12px 28px -12px rgba(15,23,42,.18)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#0a0a0a", fontWeight: 650 }} />
          {shown.map((p, pi) => [
            <Line key={`p${pi}`} type="monotone" dataKey={`plan_${pi}`} name={`${p.planVersion} Plan`}
              stroke={COLORS[pi % COLORS.length]} strokeDasharray="6 3" dot={false} strokeWidth={2} />,
            <Line key={`a${pi}`} type="monotone" dataKey={`actual_${pi}`} name={`${p.planVersion} Actual`}
              stroke={COLORS[pi % COLORS.length]} dot={{ r: 2.5, stroke: "#fff", strokeWidth: 1.5 }} strokeWidth={2.5} />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
