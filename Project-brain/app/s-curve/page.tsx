"use client";
import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { motion } from "framer-motion";
import { TrendingUp, AlertTriangle, Calendar, Target, Activity, Package, Building2 } from "lucide-react";
import PlanVersionsOverlay from "./PlanVersionsOverlay";

const API = "http://localhost:8000";

/* Premium light palette — soft pastels, black labels */
const C = {
  bg: "#f7fafc",
  panel: "#ffffff",
  panelSoft: "#f0fdf4",
  border: "#e2e8f0",
  borderSoft: "#dbeafe",
  ink: "#0a0a0a",
  ink2: "#171717",
  muted: "#52525b",
  plan: "#3b82f6",
  planFill: "rgba(147, 197, 253, 0.28)",
  actual: "#059669",
  actualDot: "#10b981",
  forecast: "#d97706",
  grid: "#e8eef6",
  tick: "#171717",
  tipBg: "#ffffff",
  tipBorder: "#cfe0ec",
};

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

function varTone(v: number) {
  if (v >= 0) return { color: "#047857", bg: "#ecfdf5", border: "#a7f3d0" };
  if (v >= -5) return { color: "#b45309", bg: "#fefce8", border: "#fde68a" };
  return { color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" };
}

function KpiCard({
  label, value, icon: Icon, accent, soft,
}: {
  label: string; value: string; icon: React.ElementType; accent: string; soft: string;
}) {
  return (
    <div
      className="ui-card card-3d"
      style={{
        background: `linear-gradient(165deg, #ffffff 0%, ${soft} 100%)`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "16px 18px",
        boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 12px 28px -18px rgba(37,99,235,.16)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 28, height: 28, borderRadius: 10, display: "grid", placeItems: "center",
            background: soft, color: accent, border: `1px solid ${accent}33`,
          }}
        >
          <Icon size={14} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>
          {label}
        </span>
      </div>
      <div
        className="fz-display"
        style={{ fontSize: 22, fontWeight: 800, color: accent, letterSpacing: "-0.02em", lineHeight: 1.1 }}
      >
        {value}
      </div>
    </div>
  );
}

function ChartShell({ title, icon: Icon, count, children }: {
  title: string; icon: React.ElementType; count: number; children: React.ReactNode;
}) {
  return (
    <div
      className="ui-card card-3d"
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        padding: "18px 20px 14px",
        marginBottom: 20,
        boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 14px 36px -20px rgba(37,99,235,.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.borderSoft}` }}>
        <Icon size={16} color={C.plan} />
        <h2 className="fz-display" style={{ fontSize: 16, fontWeight: 750, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
          {title}
        </h2>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 650, color: C.muted, fontFamily: "var(--font-mono), monospace" }}>
          {count} months
        </span>
      </div>
      {children}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", paddingTop: 10, fontSize: 12, fontWeight: 650, color: C.ink }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: C.plan }} /> Planned
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: C.actual }} /> Actual
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 0, borderTop: `2.5px dashed ${C.forecast}` }} /> Forecast
        </span>
      </div>
    </div>
  );
}

const tipStyle = {
  backgroundColor: C.tipBg,
  border: `1px solid ${C.tipBorder}`,
  borderRadius: 12,
  fontSize: 12,
  color: C.ink,
  boxShadow: "0 12px 28px -12px rgba(15,23,42,.18)",
  fontWeight: 600,
};

export default function SCurvePage() {
  const [viewMode, setViewMode] = useState<"package" | "scheme">("package");
  const [packageId, setPackageId] = useState<number>(1);
  const [packages, setPackages] = useState<{ package_id: number; package_name: string; scheme_name: string }[]>([]);
  const [pkgData, setPkgData] = useState<PkgData | null>(null);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [schemes, setSchemes] = useState<{ id: number; name: string }[]>([]);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [schemeData, setSchemeData] = useState<SchemeData | null>(null);
  const [schemeLoading, setSchemeLoading] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/portfolio/packages`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setPackages(d.packages || d))
      .catch(() => setPackages([]));
    fetch(`${API}/api/v1/dashboard/scheme-cards`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setSchemes(d.map((s: any) => ({ id: s.id, name: s.name }))); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (viewMode !== "package" || !packageId) return;
    setPkgLoading(true); setPkgError(null);
    fetch(`${API}/api/v1/progress/s-curve/${packageId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setPkgData)
      .catch(e => setPkgError(String(e)))
      .finally(() => setPkgLoading(false));
  }, [packageId, viewMode]);

  useEffect(() => {
    if (viewMode !== "scheme" || !schemeId) return;
    setSchemeLoading(true); setSchemeError(null);
    fetch(`${API}/api/v1/s-curve/${schemeId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setSchemeData)
      .catch(e => setSchemeError(String(e)))
      .finally(() => setSchemeLoading(false));
  }, [schemeId, viewMode]);

  const pkgChartData = useMemo(() => (pkgData?.points || []).map(p => ({
    month: p.month_date.slice(0, 7),
    planned: p.cumulative_planned_pct,
    actual: p.is_forecast ? null : p.cumulative_actual_pct,
    forecast: p.is_forecast ? p.cumulative_actual_pct : null,
  })), [pkgData]);

  const schemeChartData = useMemo(() => {
    if (!schemeData) return [];
    return mergeSchemePoints(schemeData.planned, schemeData.actual);
  }, [schemeData]);

  const variance = pkgData?.today_variance_pct ?? 0;
  const vt = varTone(variance);

  const selectStyle: React.CSSProperties = {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: C.ink,
    outline: "none",
    minWidth: 260,
    boxShadow: "0 1px 2px rgba(15,23,42,.04)",
  };

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.ink, padding: 24 }}>
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <span
              style={{
                width: 40, height: 40, borderRadius: 14, display: "grid", placeItems: "center",
                background: "linear-gradient(145deg, #eff6ff, #ecfdf5)",
                border: `1px solid ${C.borderSoft}`,
                color: C.plan,
                boxShadow: "0 8px 20px -12px rgba(37,99,235,.35)",
              }}
            >
              <TrendingUp className="w-5 h-5" />
            </span>
            <h1 className="fz-display" style={{ fontSize: 28, fontWeight: 800, color: C.ink, margin: 0, letterSpacing: "-0.03em" }}>
              S-Curve — Plan vs Actual
            </h1>
          </div>
          <p style={{ color: C.muted, fontSize: 14, fontWeight: 550, marginBottom: 20, marginLeft: 52 }}>
            Cumulative progress with linear-regression forecast · executive view
          </p>
        </motion.div>

        {/* Controls */}
        <div
          className="ui-card"
          style={{
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            background: "linear-gradient(180deg, #ffffff, #f0fdf4)",
            padding: 18,
            marginBottom: 20,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 16,
            boxShadow: "0 1px 0 rgba(255,255,255,.9) inset, 0 10px 24px -16px rgba(5,150,105,.12)",
          }}
        >
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 6 }}>
              View
            </label>
            <div
              className="inline-flex"
              style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: "#fff", padding: 3, gap: 2 }}
            >
              <button
                type="button"
                onClick={() => setViewMode("package")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                  background: viewMode === "package" ? "#eff6ff" : "transparent",
                  color: viewMode === "package" ? "#1d4ed8" : C.muted,
                  boxShadow: viewMode === "package" ? "0 4px 12px -6px rgba(37,99,235,.4)" : "none",
                }}
              >
                <Package size={13} /> Package Level
              </button>
              <button
                type="button"
                onClick={() => setViewMode("scheme")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                  background: viewMode === "scheme" ? "#ecfeff" : "transparent",
                  color: viewMode === "scheme" ? "#0e7490" : C.muted,
                  boxShadow: viewMode === "scheme" ? "0 4px 12px -6px rgba(8,145,178,.35)" : "none",
                }}
              >
                <Building2 size={13} /> Scheme Level
              </button>
            </div>
          </div>

          {viewMode === "package" && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 6 }}>
                Package
              </label>
              <select value={packageId} onChange={e => setPackageId(Number(e.target.value))} style={selectStyle}>
                {packages.map(p => (
                  <option key={p.package_id} value={p.package_id}>{p.scheme_name} — {p.package_name}</option>
                ))}
                {packages.length === 0 && <option value={1}>Package #1</option>}
              </select>
            </div>
          )}

          {viewMode === "scheme" && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, display: "block", marginBottom: 6 }}>
                Scheme
              </label>
              <select value={schemeId ?? ""} onChange={e => setSchemeId(Number(e.target.value) || null)} style={{ ...selectStyle, minWidth: 300 }}>
                <option value="">— Select Scheme —</option>
                {schemes.map(s => <option key={s.id} value={s.id}>#{s.id} · {s.name.substring(0, 60)}</option>)}
              </select>
            </div>
          )}

          {(pkgLoading || schemeLoading) && (
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Loading…</span>
          )}
        </div>

        {viewMode === "package" && (
          <>
            {pkgError && (
              <div style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
                Error: {pkgError}
              </div>
            )}
            {pkgData && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
                  <KpiCard label="Planned (today)" value={`${pkgData.today_planned_pct?.toFixed(1) ?? "—"}%`} icon={Target} accent="#2563eb" soft="#eff6ff" />
                  <KpiCard label="Actual (today)" value={`${pkgData.today_actual_pct?.toFixed(1) ?? "—"}%`} icon={Activity} accent="#059669" soft="#ecfdf5" />
                  <KpiCard
                    label="Variance"
                    value={`${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`}
                    icon={AlertTriangle}
                    accent={vt.color}
                    soft={vt.bg}
                  />
                  <KpiCard
                    label="Forecast Completion"
                    value={pkgData.forecast_completion_date ?? "Need ≥3 points"}
                    icon={Calendar}
                    accent="#7c3aed"
                    soft="#f5f3ff"
                  />
                </div>

                <ChartShell title="Cumulative S-Curve (Package Level)" icon={TrendingUp} count={pkgChartData.length}>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={pkgChartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="scPlanFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#dbeafe" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 4" stroke={C.grid} vertical={false} />
                      <XAxis
                        dataKey="month"
                        stroke={C.border}
                        tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }}
                        axisLine={{ stroke: C.border }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        stroke={C.border}
                        tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: "%", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11, fontWeight: 700 }}
                      />
                      <Tooltip contentStyle={tipStyle} formatter={(v: any, n: string) => [`${Number(v).toFixed(1)}%`, n]} />
                      <Legend wrapperStyle={{ color: C.ink, fontWeight: 650, fontSize: 12 }} />
                      <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="planned" stroke={C.plan} fill="url(#scPlanFill)" strokeWidth={2.6} dot={false} name="Planned %" />
                      <Line type="monotone" dataKey="actual" stroke={C.actual} strokeWidth={3} dot={{ fill: C.actualDot, r: 3.5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} name="Actual %" />
                      <Line type="monotone" dataKey="forecast" stroke={C.forecast} strokeWidth={2.2} strokeDasharray="6 5" dot={false} name="Forecast %" connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartShell>

                {pkgData.forecast_explainer && (
                  <div
                    className="ui-card"
                    style={{
                      background: "linear-gradient(165deg, #fffbeb, #ffffff)",
                      border: "1px solid #fde68a",
                      borderRadius: 16,
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Activity size={14} color="#d97706" />
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 750, color: C.ink }}>Forecast Explanation</h3>
                      {pkgData.forecast_confidence_pct != null && (
                        <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted, fontWeight: 600 }}>
                          Confidence: <strong style={{ color: C.ink }}>{pkgData.forecast_confidence_pct}%</strong>
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, color: C.ink2, fontSize: 14, fontWeight: 500, lineHeight: 1.55 }}>
                      {pkgData.forecast_explainer}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {viewMode === "scheme" && (
          <>
            {!schemeId && (
              <div style={{ borderRadius: 14, border: "1px solid #fde68a", background: "#fefce8", padding: 16, color: "#b45309", fontSize: 14, fontWeight: 600 }}>
                Select a scheme above to view its rolled-up S-curve.
              </div>
            )}
            {schemeError && (
              <div style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
                Error: {schemeError}
              </div>
            )}
            {schemeData?.note && schemeChartData.length === 0 && (
              <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: "#fff", padding: 32, textAlign: "center", color: C.muted, fontSize: 14, fontWeight: 550 }}>
                No plan data for this scheme yet. Create and lock a plan in Plan Engine.
              </div>
            )}
            {schemeChartData.length > 0 && (
              <>
                {(() => {
                  const last = [...schemeChartData].reverse().find(p => p.actual != null);
                  const curr = schemeChartData.find(p => p.month === new Date().toISOString().slice(0, 7)) ?? schemeChartData[schemeChartData.length - 1];
                  const var_ = last ? ((last.actual ?? 0) - last.planned) : 0;
                  const vt2 = varTone(var_);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
                      <KpiCard label="Planned (latest)" value={`${curr?.planned.toFixed(1) ?? "—"}%`} icon={Target} accent="#7c3aed" soft="#f5f3ff" />
                      <KpiCard label="Actual (latest)" value={last ? `${(last.actual ?? 0).toFixed(1)}%` : "—"} icon={Activity} accent="#059669" soft="#ecfdf5" />
                      <KpiCard label="Variance" value={last ? `${var_ >= 0 ? "+" : ""}${var_.toFixed(1)}%` : "—"} icon={AlertTriangle} accent={vt2.color} soft={vt2.bg} />
                    </div>
                  );
                })()}

                <ChartShell title="Scheme-Level Rolled-Up S-Curve" icon={Building2} count={schemeChartData.length}>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={schemeChartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="scSchemePlan" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#dbeafe" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 4" stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" stroke={C.border} tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }} axisLine={{ stroke: C.border }} tickLine={false} />
                      <YAxis domain={[0, 100]} stroke={C.border} tick={{ fontSize: 11, fill: C.tick, fontWeight: 600 }} axisLine={false} tickLine={false}
                        label={{ value: "%", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11, fontWeight: 700 }} />
                      <Tooltip contentStyle={tipStyle} formatter={(v: any, n: string) => [`${Number(v).toFixed(1)}%`, n]} />
                      <Legend wrapperStyle={{ color: C.ink, fontWeight: 650, fontSize: 12 }} />
                      <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="planned" stroke={C.plan} fill="url(#scSchemePlan)" strokeWidth={2.6} dot={false} name="Planned %" />
                      <Line type="monotone" dataKey="actual" stroke={C.actual} strokeWidth={3} dot={{ fill: C.actualDot, r: 3.5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} name="Actual %" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartShell>

                <PlanVersionsOverlay schemeId={schemeId ?? 0} />

                {schemeData.packages && schemeData.packages.length > 1 && (
                  <div
                    style={{
                      marginTop: 16, borderRadius: 16, border: `1px solid ${C.border}`,
                      background: "linear-gradient(180deg, #ffffff, #ecfdf5)", padding: 16,
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
                      Packages in this scheme ({schemeData.packages.length})
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {schemeData.packages.map((p: any) => (
                        <span
                          key={p.package_id}
                          style={{
                            padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 650,
                            background: "#fff", color: C.ink, border: `1px solid ${C.border}`,
                          }}
                        >
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
