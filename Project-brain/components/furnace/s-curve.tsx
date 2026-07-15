"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Chip, Segmented } from "@/ui";
import { SCurveChart } from "@/charts/SCurveChart";
import { getSchemes, getPackages, getSCurve, getSchemeCurve, Scheme, Package, PkgData } from "@/lib/furnace/api";
import { rollupSchemeCurve, PkgCurve } from "@/lib/furnace/flow";

const SCOPE = [{ value: "package", label: "Package" }, { value: "scheme", label: "Scheme rollup" }];

export default function SCurvePage() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [schemeId, setSchemeId] = useState<number>(0);
  const [pkgId, setPkgId] = useState<number>(0);
  const [data, setData] = useState<PkgData | null>(null);
  const [scope, setScope] = useState("package");
  const [schemePkgs, setSchemePkgs] = useState<PkgCurve[]>([]);

  useEffect(() => { getSchemes().then((s) => { setSchemes(s); if (s[0]) setSchemeId(s[0].scheme_id); }); }, []);
  useEffect(() => { if (schemeId) { getPackages(schemeId).then((p) => { setPackages(p); if (p[0]) setPkgId(p[0].package_id); }); getSchemeCurve(schemeId).then(setSchemePkgs); } }, [schemeId]);
  useEffect(() => { if (pkgId) getSCurve(pkgId).then(setData); }, [pkgId]);

  // multi-package weighted rollup → scheme-level S-curve
  const rolled = useMemo<PkgData | null>(() => {
    if (scope !== "scheme" || !schemePkgs.length) return null;
    const todayIdx = schemePkgs[0].points.reduce((acc, _p, i) => schemePkgs.some((pk) => (pk.points[i]?.cumulative_actual_pct ?? null) != null) ? i : acc, 0);
    const { points } = rollupSchemeCurve(schemePkgs, todayIdx);
    const tp = points[todayIdx]?.cumulative_planned_pct ?? 0, ta = points[todayIdx]?.cumulative_actual_pct ?? 0;
    return { package_id: 0, package_name: "Scheme rollup", points, today_planned_pct: tp, today_actual_pct: ta, today_variance_pct: +(ta - tp).toFixed(1), forecast_completion_date: null, forecast_method: "weighted package rollup", forecast_confidence_pct: null, forecast_explainer: null };
  }, [scope, schemePkgs]);

  const shown = scope === "scheme" ? rolled : data;

  const variance = shown?.today_variance_pct ?? 0;
  const vTone = variance <= -10 ? "critical" : variance < -3 ? "moderate" : "ok";
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—";

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Progress S-Curve" subtitle="Cumulative plan vs actual · linear-regression forecast"
        right={<>
          <Field label="Scheme"><Select value={schemeId} onChange={(v) => setSchemeId(+v)} options={schemes.map((s) => ({ value: s.scheme_id, label: s.scheme_name }))} style={{ minWidth: 240 }} /></Field>
          <Field label="Scope"><Segmented options={SCOPE} value={scope} onChange={setScope} /></Field>
          {scope === "package" && <Field label="Package"><Select value={pkgId} onChange={(v) => setPkgId(+v)} options={packages.map((p) => ({ value: p.package_id, label: `${p.package_no}. ${p.package_name}` }))} style={{ minWidth: 200 }} /></Field>}
          <ThemeToggle />
        </>} />

      {scope === "scheme" && schemePkgs.length > 0 && (
        <div style={{ display: "flex", gap: 8, margin: "14px 0 0", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Weighted rollup of</span>
          {schemePkgs.map((pk) => {
            const totW = schemePkgs.reduce((s, p) => s + p.weight, 0) || 1;
            return <Chip key={pk.package_id} tone="steel">{pk.package_name} · {(pk.weight / totW * 100).toFixed(0)}%</Chip>;
          })}
        </div>
      )}

      <div className="fz-eyebrow">S-Curve <span className="tag">baseline vs actual vs forecast</span></div>
      <Card pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0 }} className="fz-scurve-grid">
          <div style={{ padding: "20px 10px 14px 20px", position: "relative" }}>
            <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "var(--ink-2)", marginBottom: 8, flexWrap: "wrap" }}>
              <Legend color="var(--steel-dim)">Planned (baseline)</Legend>
              <Legend color="var(--molten)">Actual</Legend>
              <Legend dash>Forecast</Legend>
              <Legend swatch="rgba(255,79,26,.3)">Slippage</Legend>
            </div>
            {shown ? <SCurveChart data={shown} /> : <Loading />}
          </div>
          <div style={{ borderLeft: "1px solid var(--line)", padding: "20px", display: "flex", flexDirection: "column", gap: 14, background: "var(--panel-2)" }}>
            <Read k="Today · Planned" v={`${shown?.today_planned_pct ?? 0}%`} />
            <Read k="Today · Actual" v={`${shown?.today_actual_pct ?? 0}%`} />
            <div style={{ height: 1, background: "var(--line)" }} />
            <Read k="Variance" v={`${variance > 0 ? "+" : ""}${variance}%`} tone={vTone} />
            <div style={{ background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 11, padding: "13px 14px" }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ember)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>
                Forecast completion
              </div>
              <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, fontSize: 18, marginTop: 7 }}>{fmtDate(shown?.forecast_completion_date)}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
                Method: <b style={{ color: "var(--ink-2)" }}>{shown?.forecast_method ?? "—"}</b><br />
                vs baseline <b style={{ color: "var(--ink-2)", fontFamily: '"IBM Plex Mono", monospace' }}>{fmtDate(shown?.baseline_finish_date)}</b>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: "var(--panel-3)", overflow: "hidden", marginTop: 9 }}>
                <div style={{ height: "100%", width: `${shown?.forecast_confidence_pct ?? 0}%`, background: "linear-gradient(90deg,var(--ember),var(--slag))" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>Confidence <b style={{ color: "var(--ink-2)", fontFamily: '"IBM Plex Mono", monospace' }}>{shown?.forecast_confidence_pct ?? "—"}%</b></div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Legend({ children, color, dash, swatch }: { children: React.ReactNode; color?: string; dash?: boolean; swatch?: string }) {
  return <span><i style={{ display: "inline-block", width: 14, height: dash ? 0 : 3, borderTop: dash ? "2px dashed var(--ember)" : undefined, background: swatch ?? color, borderRadius: 2, marginRight: 6, verticalAlign: "middle" }} />{children}</span>;
}
function Read({ k, v, tone }: { k: string; v: string; tone?: "ok" | "moderate" | "critical" }) {
  const color = tone === "critical" ? "var(--molten)" : tone === "moderate" ? "var(--ember)" : tone === "ok" ? "var(--verdigris)" : "var(--ink)";
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)" }}>{k}</div>
      <div className="fz-display" style={{ fontWeight: 800, fontSize: 26, marginTop: 3, color }}>{v}</div>
    </div>
  );
}
function Loading() { return <div style={{ height: 300, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 }}>Loading curve…</div>; }
