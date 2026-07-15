"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Kpi, Chip, Input, Segmented, toast } from "@/ui";
import { getSchemes, getPackages, getDprActivities, getDprSummary, saveDprActual, Scheme, Package, DprActivity } from "@/lib/furnace/api";
import { DprDaily } from "@/plan/DprDaily";
import { DprAutofill } from "@/plan/DprAutofill";

const MONTHS = ["2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11"];
const MODES = [{ value: "monthly", label: "Monthly summary" }, { value: "daily", label: "Daily entry" }, { value: "auto", label: "Analyse & auto-fill" }];

export default function DprPage() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [schemeId, setSchemeId] = useState(0);
  const [pkgId, setPkgId] = useState(0);
  const [month, setMonth] = useState(MONTHS[0]);
  const [acts, setActs] = useState<DprActivity[]>([]);
  const [summary, setSummary] = useState<{ planned_pct: number; actual_pct: number; variance_pct: number; entries: number } | null>(null);
  const [mode, setMode] = useState("monthly");

  useEffect(() => { getSchemes().then((s) => { setSchemes(s); if (s[0]) setSchemeId(s[0].scheme_id); }); }, []);
  useEffect(() => { if (schemeId) getPackages(schemeId).then((p) => { setPackages(p); if (p[0]) setPkgId(p[0].package_id); }); }, [schemeId]);
  useEffect(() => { if (pkgId) { getDprActivities(pkgId).then(setActs); getDprSummary(pkgId, month).then(setSummary); } }, [pkgId, month]);

  const vTone = summary && summary.variance_pct <= -10 ? "critical" : summary && summary.variance_pct < -3 ? "moderate" : "ok";

  const setActual = (i: number, v: string) => {
    const qty = parseFloat(v) || 0;
    setActs((prev) => prev.map((a, idx) => {
      if (idx !== i) return a;
      const progress = a.scope_qty ? Math.min(100, Math.round((qty / a.scope_qty) * 100)) : 0;
      return { ...a, actual_qty: qty, progress_pct: progress };
    }));
  };
  const commit = (a: DprActivity) => { void saveDprActual(pkgId, a.activity_id, a.actual_qty, month); toast(`Saved ${a.activity_name}`); };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Daily Progress (DPR)" subtitle="Activity-wise physical progress entry · package-level"
        right={<>
          <Field label="Scheme"><Select value={schemeId} onChange={(v) => setSchemeId(+v)} options={schemes.map((s) => ({ value: s.scheme_id, label: s.scheme_name }))} style={{ minWidth: 220 }} /></Field>
          <Field label="Package"><Select value={pkgId} onChange={(v) => setPkgId(+v)} options={packages.map((p) => ({ value: p.package_id, label: p.package_name }))} style={{ minWidth: 180 }} /></Field>
          <Field label="Month"><Select value={month} onChange={setMonth} options={MONTHS.map((m) => ({ value: m, label: m }))} style={{ minWidth: 120 }} /></Field>
          <ThemeToggle />
        </>} />

      <div style={{ display: "flex", alignItems: "center", margin: "16px 0 0" }}>
        <Segmented options={MODES} value={mode} onChange={setMode} />
      </div>

      {mode === "auto" ? (
        <Card pad={false} style={{ marginTop: 14 }}><DprAutofill packageId={pkgId} /></Card>
      ) : mode === "daily" ? (
        <Card pad={false} style={{ marginTop: 14 }}><DprDaily packageId={pkgId} /></Card>
      ) : (
      <>
      <div style={{ display: "flex", gap: 12, margin: "16px 0", flexWrap: "wrap" }}>
        <Kpi label="Planned %" value={`${summary?.planned_pct ?? 0}`} unit="%" tone="steel" />
        <Kpi label="Actual %" value={`${summary?.actual_pct ?? 0}`} unit="%" tone="moderate" />
        <Kpi label="Variance" value={`${summary && summary.variance_pct > 0 ? "+" : ""}${summary?.variance_pct ?? 0}`} unit="%" tone={vTone as "ok"} />
        <Kpi label="Entries" value={`${summary?.entries ?? 0}`} tone="neutral" />
      </div>

      <div className="fz-eyebrow">Activity entry <span className="tag">edit actual qty · progress recomputes from scope</span></div>
      <Card pad={false}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>{["Activity", "UoM", "Scope", "Planned", "Actual", "Progress", "Source", ""].map((h, i) =>
                <th key={h} style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)", fontWeight: 600, textAlign: i >= 2 && i <= 4 ? "right" : "left", padding: "10px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {acts.map((a, i) => (
                <tr key={a.activity_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 14px", fontWeight: 600 }}>{a.activity_name}</td>
                  <td style={{ padding: "8px 14px", color: "var(--ink-3)" }}>{a.uom}</td>
                  <td style={tdNum}>{a.scope_qty.toLocaleString("en-IN")}</td>
                  <td style={tdNum}>{a.planned_qty.toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 14px", textAlign: "right" }}>
                    <Input value={a.actual_qty} onChange={(v) => setActual(i, v)} mono align="right" style={{ width: 96 }} />
                  </td>
                  <td style={{ padding: "8px 14px", minWidth: 140 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 4, background: "var(--panel-3)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${a.progress_pct}%`, background: a.progress_pct > 80 ? "var(--verdigris)" : a.progress_pct > 50 ? "var(--ember)" : "var(--steel)" }} />
                      </div>
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, width: 38, textAlign: "right", color: "var(--ink-2)" }}>{a.progress_pct}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 14px" }}>
                    {a.entered_via === "app" ? <Chip tone="steel">📱 App</Chip> : a.entered_via === "dpr" ? <Chip tone="neutral">DPR</Chip> : <Chip tone="neutral">—</Chip>}
                  </td>
                  <td style={{ padding: "8px 14px", textAlign: "right" }}>
                    <button onClick={() => commit(a)} title="Save" style={{ background: "var(--panel-3)", border: "1px solid var(--line-2)", color: "var(--ink-2)", borderRadius: 7, padding: "5px 10px", font: "600 11.5px Inter", cursor: "pointer" }}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}
    </div>
  );
}
const tdNum: React.CSSProperties = { padding: "8px 14px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: "var(--ink-2)" };
