"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, AlertTriangle, Activity, Calendar, Target, Package } from "lucide-react";

const API = "http://localhost:8000/api/v1";

const C = {
  bg: "#f7fafc",
  panel: "#ffffff",
  border: "#e2e8f0",
  borderSoft: "#dbeafe",
  ink: "#0a0a0a",
  ink2: "#171717",
  muted: "#52525b",
  plan: "#3b82f6",
  actual: "#059669",
  grid: "#e8eef6",
  tick: "#171717",
};

function currentFinancialYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

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

function varTone(v: number) {
  if (v >= 0) return { color: "#047857", bg: "#ecfdf5" };
  if (v >= -5) return { color: "#b45309", bg: "#fefce8" };
  return { color: "#b91c1c", bg: "#fef2f2" };
}

function SCurveReportContent() {
  const searchParams = useSearchParams();
  const schemeId = searchParams.get("id") ?? "";

  const [view, setView] = useState<"scheme" | "package">("scheme");
  const [schemeData, setSchemeData] = useState<SCurveResp | null>(null);
  const [packages, setPackages] = useState<{ package_id: number; package_name: string }[]>([]);
  const [selPkgId, setSelPkgId] = useState<number | null>(null);
  const [pkgData, setPkgData] = useState<PkgSCurveResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schemeId) return;
    setLoading(true); setError(null);
    fetch(`${API}/s-curve/fy/${schemeId}?fy=${currentFinancialYear()}`)
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

  const today = new Date();
  const todayLabel = `${today.toLocaleString("en-IN", { month: "short" })}-${String(today.getFullYear()).slice(2)}`;
  const todayPoint = chartData.find((p) => p.month === todayLabel) ?? chartData[chartData.length - 1];
  const planned = todayPoint?.planned ?? 0;
  const actual = todayPoint?.actual ?? planned;
  const variance = (actual ?? 0) - planned;
  const vt = varTone(variance);
  const lastActual = [...chartData].reverse().find((p) => p.actual != null);

  const tipStyle = {
    backgroundColor: "#ffffff",
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    fontSize: 12,
    color: C.ink,
    boxShadow: "0 12px 28px -12px rgba(15,23,42,.18)",
    fontWeight: 600,
  };

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.ink, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 className="fz-display" style={{ fontSize: 24, fontWeight: 800, color: C.ink, margin: 0, display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.02em" }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, display: "grid", placeItems: "center", background: "#ecfeff", color: "#0891b2", border: "1px solid #a5f3fc" }}>
              <TrendingUp size={18} />
            </span>
            S-Curve — Plan vs Actual
          </h1>
          <p style={{ color: C.muted, fontSize: 13, fontWeight: 550, marginTop: 6, marginLeft: 46 }}>
            Scheme #{schemeId} · Cumulative progress %
          </p>
        </div>
        <Link href="/reports" style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", textDecoration: "underline" }}>
          ← Reports hub
        </Link>
      </div>

      <div
        className="ui-card"
        style={{
          borderRadius: 16, border: `1px solid ${C.border}`, background: "linear-gradient(180deg,#fff,#f0fdf4)",
          padding: 14, marginBottom: 20, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
        }}
      >
        <div className="inline-flex" style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: "#fff", padding: 3 }}>
          {(["scheme", "package"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                background: view === v ? "#ecfeff" : "transparent",
                color: view === v ? "#0e7490" : C.muted,
                textTransform: "capitalize",
              }}
            >
              {v === "scheme" ? "Scheme (rolled up)" : "Per Package"}
            </button>
          ))}
        </div>

        {view === "package" && packages.length > 0 && (
          <select
            value={selPkgId ?? ""}
            onChange={(e) => setSelPkgId(Number(e.target.value))}
            style={{
              background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, color: C.ink, outline: "none",
            }}
          >
            {packages.map((p) => (
              <option key={p.package_id} value={p.package_id}>{p.package_name || `Pkg #${p.package_id}`}</option>
            ))}
          </select>
        )}

        {loading && <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Loading…</span>}
      </div>

      {error && (
        <div style={{ borderRadius: 12, border: "1px solid #fecaca", background: "#fef2f2", padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!schemeId && (
        <div style={{ borderRadius: 12, border: "1px solid #fde68a", background: "#fefce8", padding: 14, color: "#b45309", fontSize: 14, fontWeight: 600 }}>
          No scheme selected. <Link href="/reports" style={{ textDecoration: "underline", color: "#b45309" }}>Go back to Reports hub.</Link>
        </div>
      )}

      {activeData && chartData.length === 0 && (
        <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: "#fff", padding: 32, textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 550 }}>
          No plan data found for this scheme. Create and lock a plan in the Plan Engine first.
        </div>
      )}

      {chartData.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Planned (current)", value: `${planned.toFixed(1)}%`, icon: Target, accent: "#7c3aed", soft: "#f5f3ff" },
              { label: "Actual (current)", value: lastActual ? `${(lastActual.actual ?? 0).toFixed(1)}%` : "—", icon: Activity, accent: "#059669", soft: "#ecfdf5" },
              { label: "Variance", value: `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`, icon: AlertTriangle, accent: vt.color, soft: vt.bg },
              { label: "Last Data Point", value: lastActual?.month ?? "—", icon: Calendar, accent: "#2563eb", soft: "#eff6ff" },
            ].map(({ label, value, icon: Icon, accent, soft }) => (
              <div
                key={label}
                className="ui-card card-3d"
                style={{
                  borderRadius: 16, border: `1px solid ${C.border}`,
                  background: `linear-gradient(165deg, #fff, ${soft})`, padding: 16,
                  boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 12px 28px -18px rgba(37,99,235,.14)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Icon size={14} color={accent} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted }}>{label}</span>
                </div>
                <div className="fz-display" style={{ fontSize: 20, fontWeight: 800, color: accent }}>{value}</div>
              </div>
            ))}
          </div>

          <div
            className="ui-card card-3d"
            style={{
              borderRadius: 18, border: `1px solid ${C.border}`,
              background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
              padding: "18px 20px 14px", marginBottom: 20,
              boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 14px 36px -20px rgba(37,99,235,.18)",
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 750, color: C.ink, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, borderBottom: `1px solid ${C.borderSoft}` }}>
              <TrendingUp size={14} color={C.plan} />
              Cumulative S-Curve (0–100%)
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 650, color: C.muted }}>{chartData.length} data points</span>
            </h2>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="repScPlan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#dbeafe" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke={C.grid} vertical={false} />
                <XAxis dataKey="month" stroke={C.border} tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis domain={[0, 100]} stroke={C.border} tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }} axisLine={false} tickLine={false}
                  label={{ value: "%", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11, fontWeight: 700 }} />
                <Tooltip contentStyle={tipStyle} formatter={(val: any, name: string) => [`${Number(val).toFixed(1)}%`, name]} />
                <Legend wrapperStyle={{ color: C.ink, fontWeight: 650, fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "100%", fill: C.muted, fontSize: 10 }} />
                <Area type="monotone" dataKey="planned" stroke={C.plan} fill="url(#repScPlan)" strokeWidth={2.6} dot={false} name="Planned %" />
                <Line type="monotone" dataKey="actual" stroke={C.actual} strokeWidth={3}
                  dot={{ fill: "#10b981", r: 3.5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} name="Actual %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly table — light green zebra */}
          <div
            className="ui-card"
            style={{
              borderRadius: 16, border: `1px solid ${C.border}`, background: "#fff", overflow: "hidden",
              boxShadow: "0 1px 0 rgba(255,255,255,.9) inset, 0 10px 24px -16px rgba(5,150,105,.12)",
            }}
          >
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #f0f9ff, #f0fdf4)" }}>
              <Package size={13} color="#7c3aed" />
              <span style={{ fontSize: 13, fontWeight: 750, color: C.ink }}>Monthly Data Table</span>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 280 }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Month", "Planned %", "Actual %", "Variance", "Status"].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          position: "sticky", top: 0, zIndex: 2,
                          background: "#f0f9ff", color: C.ink, fontWeight: 800,
                          padding: "12px 14px", textAlign: i === 0 || i === 4 ? "left" : "right",
                          borderBottom: "2px solid #bfdbfe", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 11,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row, i) => {
                    const act = row.actual;
                    const var_ = act != null ? act - row.planned : null;
                    const even = i % 2 === 1;
                    return (
                      <tr key={row.month}>
                        <td style={{ padding: "10px 14px", color: C.ink, fontWeight: 650, fontFamily: "var(--font-mono), monospace", background: even ? "#f0fdf4" : "#fff", borderBottom: "1px solid #e5eef6" }}>
                          {row.month}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#2563eb", fontWeight: 700, fontFamily: "var(--font-mono), monospace", background: even ? "#f0fdf4" : "#fff", borderBottom: "1px solid #e5eef6" }}>
                          {row.planned.toFixed(1)}%
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono), monospace", background: even ? "#f0fdf4" : "#fff", borderBottom: "1px solid #e5eef6" }}>
                          {act != null
                            ? <span style={{ color: "#059669", fontWeight: 700 }}>{act.toFixed(1)}%</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{
                          padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono), monospace", fontWeight: 750,
                          color: var_ == null ? C.muted : var_ >= 0 ? "#047857" : "#b91c1c",
                          background: even ? "#f0fdf4" : "#fff", borderBottom: "1px solid #e5eef6",
                        }}>
                          {var_ != null ? `${var_ >= 0 ? "+" : ""}${var_.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "10px 14px", background: even ? "#f0fdf4" : "#fff", borderBottom: "1px solid #e5eef6" }}>
                          {var_ == null ? <span style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>No data</span> :
                            var_ >= 0 ? <span style={{ padding: "3px 8px", borderRadius: 999, background: "#ecfdf5", color: "#047857", fontSize: 11, fontWeight: 750, border: "1px solid #a7f3d0" }}>On Track</span> :
                            var_ >= -5 ? <span style={{ padding: "3px 8px", borderRadius: 999, background: "#fefce8", color: "#b45309", fontSize: 11, fontWeight: 750, border: "1px solid #fde68a" }}>At Risk</span> :
                            <span style={{ padding: "3px 8px", borderRadius: 999, background: "#fef2f2", color: "#b91c1c", fontSize: 11, fontWeight: 750, border: "1px solid #fecaca" }}>Behind</span>}
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

export default function SCurveReport() {
  return (
    <Suspense fallback={<div className="min-h-screen p-8" style={{ background: "#f7fafc", color: "#52525b", fontWeight: 600 }}>Loading S-curve report…</div>}>
      <SCurveReportContent />
    </Suspense>
  );
}
