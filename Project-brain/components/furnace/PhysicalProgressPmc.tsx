"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, PageHeader, Select, Field, Button, Chip, Kpi, toast } from "@/ui";
import { getSchemes, getSchemeCurve, getFyOptions, getCapexProjects, Scheme } from "@/lib/furnace/api";
import { rollupSchemeCurve, capexFinancials, delayCat, PkgCurve, CapexProjInput } from "@/lib/furnace/flow";
import { exportCSV, printPDF } from "@/lib/furnace/export";

const cr = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN");
const toneOf = (c: string) => (c === "critical" ? "critical" : c === "moderate" ? "moderate" : c === "minor" ? "minor" : "ok") as "ok";

export default function PhysicalProgressPmc({ onBack }: { onBack?: () => void }) {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState(0);
  const [pkgs, setPkgs] = useState<PkgCurve[]>([]);
  const [fy, setFy] = useState("");
  const [projects, setProjects] = useState<CapexProjInput[]>([]);

  const currentFy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };
  useEffect(() => {
    getSchemes().then((s) => {
      setSchemes(s);
      // COB-7 (74) carries the richest progress dataset — open on real data
      const preferred = s.find((x) => x.scheme_id === 74) ?? s[0];
      if (preferred) setSchemeId(preferred.scheme_id);
    });
    getFyOptions().then((f) => setFy(f.includes(currentFy()) ? currentFy() : (f[0] ?? "")));
  }, []);
  useEffect(() => { if (schemeId) getSchemeCurve(schemeId).then(setPkgs); }, [schemeId]);
  useEffect(() => { if (fy) getCapexProjects(fy).then(setProjects); }, [fy]);

  // "today" = last month with any actual across packages
  const todayIdx = useMemo(() => {
    if (!pkgs.length) return 0;
    return pkgs[0].points.reduce((acc, _p, i) => pkgs.some((pk) => (pk.points[i]?.cumulative_actual_pct ?? null) != null) ? i : acc, 0);
  }, [pkgs]);

  const rollup = useMemo(() => rollupSchemeCurve(pkgs, todayIdx), [pkgs, todayIdx]);
  const overallPlanned = rollup.points[todayIdx]?.cumulative_planned_pct ?? 0;
  const overallActual = rollup.points[todayIdx]?.cumulative_actual_pct ?? 0;
  const overallVar = +(overallActual - overallPlanned).toFixed(1);

  const totW = pkgs.reduce((s, p) => s + p.weight, 0) || 1;
  const fin = useMemo(() => projects.map((p) => capexFinancials(p, "BE", null)), [projects]);
  const finTot = fin.reduce((a, r) => ({ gross: a.gross + r.gross_cost, cum: a.cum + r.cumulative_cost, bal: a.bal + r.balance_plan }), { gross: 0, cum: 0, bal: 0 });
  const finPct = finTot.gross ? +((finTot.cum / finTot.gross) * 100).toFixed(1) : 0;

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Physical Progress — PMC" subtitle="Multi-package weighted physical progress + financial progress"
        right={<>
          {onBack && <Button kind="ghost" onClick={onBack}>← Reports</Button>}
          <Field label="Scheme"><Select value={schemeId} onChange={(v) => setSchemeId(+v)} options={schemes.map((s) => ({ value: s.scheme_id, label: s.scheme_name }))} style={{ minWidth: 230 }} /></Field>
          <Button onClick={printPDF}>PDF</Button>
          <Button kind="steel" onClick={() => {
            const HEAD = ["Package", "Weight %", "Planned %", "Actual %", "Variance %", "Contribution %"];
            const totW2 = pkgs.reduce((s, p) => s + p.weight, 0) || 1;
            const body = pkgs.map((pk) => {
              const p = pk.points[todayIdx]?.cumulative_planned_pct ?? 0, a = pk.points[todayIdx]?.cumulative_actual_pct ?? 0;
              return [pk.package_name, +(pk.weight / totW2 * 100).toFixed(0), p, a, +(a - p).toFixed(1), +((pk.weight / totW2) * a).toFixed(1)];
            });
            body.push(["WEIGHTED OVERALL", 100, overallPlanned, overallActual, overallVar, overallActual]);
            exportCSV(`Physical_Progress_PMC`, HEAD, body, `Physical Progress PMC — weighted package rollup`);
            toast("PMC report exported (Excel/CSV)");
          }}>Excel</Button>
          <ThemeToggle />
        </>} />

      <div style={{ display: "flex", gap: 12, margin: "16px 0", flexWrap: "wrap" }}>
        <Kpi label="Physical · planned" value={`${overallPlanned}`} unit="%" tone="steel" />
        <Kpi label="Physical · actual" value={`${overallActual}`} unit="%" tone="moderate" />
        <Kpi label="Physical variance" value={`${overallVar > 0 ? "+" : ""}${overallVar}`} unit="%" tone={toneOf(delayCat(overallVar))} />
        <Kpi label="Financial progress" value={`${finPct}`} unit="%" tone="ok" />
      </div>

      <div className="fz-eyebrow">Package-wise physical <span className="tag">weighted_progress_percent · Σ(weight × actual/scope)</span></div>
      <Card pad={false}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Package", "Weight", "Planned %", "Actual %", "Variance", "Contribution", "Status"].map((h, i) =>
            <th key={h} style={th(i === 0 ? "left" : "right")}>{h}</th>)}</tr></thead>
          <tbody>
            {pkgs.map((pk) => {
              const p = pk.points[todayIdx]?.cumulative_planned_pct ?? 0;
              const a = pk.points[todayIdx]?.cumulative_actual_pct ?? 0;
              const v = +(a - p).toFixed(1);
              const contrib = +((pk.weight / totW) * a).toFixed(1);
              return (
                <tr key={pk.package_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{pk.package_name}</td>
                  <td style={tdN}>{(pk.weight / totW * 100).toFixed(0)}%</td>
                  <td style={tdN}>{p}%</td>
                  <td style={{ ...tdN, color: "var(--ember)" }}>{a}%</td>
                  <td style={{ ...tdN, color: v <= -10 ? "var(--molten)" : v < 0 ? "var(--ember)" : "var(--verdigris)" }}>{v > 0 ? "+" : ""}{v}%</td>
                  <td style={tdN}>{contrib}%</td>
                  <td style={{ ...tdN }}><Chip tone={toneOf(delayCat(v))} dot>{v <= -10 ? "Critical" : v < -3 ? "Behind" : v < 0 ? "Minor" : "On track"}</Chip></td>
                </tr>
              );
            })}
            <tr style={{ background: "var(--steel-soft)" }}>
              <td style={{ padding: "10px 14px", fontWeight: 800 }}>WEIGHTED OVERALL</td>
              <td style={{ ...tdN, fontWeight: 800 }}>100%</td>
              <td style={{ ...tdN, fontWeight: 800 }}>{overallPlanned}%</td>
              <td style={{ ...tdN, fontWeight: 800, color: "var(--ember)" }}>{overallActual}%</td>
              <td style={{ ...tdN, fontWeight: 800 }}>{overallVar > 0 ? "+" : ""}{overallVar}%</td>
              <td style={{ ...tdN, fontWeight: 800 }}>{overallActual}%</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="fz-eyebrow">Financial progress <span className="tag">cumulative = last-FY exp + actual · balance = gross − cumulative</span></div>
      <Card pad={false}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Scheme", "Gross cost", "Exp. last FY", "Actual FY", "Cumulative", "Balance", "Fin %"].map((h, i) =>
            <th key={h} style={th(i === 0 ? "left" : "right")}>{h}</th>)}</tr></thead>
          <tbody>
            {fin.map((r) => {
              const pct = r.gross_cost ? +((r.cumulative_cost / r.gross_cost) * 100).toFixed(1) : 0;
              return (
                <tr key={r.project_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{r.label}</td>
                  <td style={tdN}>{cr(r.gross_cost)}</td>
                  <td style={tdN}>{cr(r.expenditure_last_fy)}</td>
                  <td style={{ ...tdN, color: "var(--ember)" }}>{cr(r.actual_current_fy)}</td>
                  <td style={tdN}>{cr(r.cumulative_cost)}</td>
                  <td style={{ ...tdN, color: r.balance_plan < 0 ? "var(--molten)" : "var(--ink-2)" }}>{cr(r.balance_plan)}</td>
                  <td style={tdN}><Chip tone={pct >= 70 ? "ok" : pct >= 40 ? "moderate" : "critical"}>{pct}%</Chip></td>
                </tr>
              );
            })}
            <tr style={{ background: "var(--steel-soft)" }}>
              <td style={{ padding: "10px 14px", fontWeight: 800 }}>TOTAL</td>
              <td style={{ ...tdN, fontWeight: 800 }}>{cr(finTot.gross)}</td>
              <td /><td />
              <td style={{ ...tdN, fontWeight: 800 }}>{cr(finTot.cum)}</td>
              <td style={{ ...tdN, fontWeight: 800 }}>{cr(finTot.bal)}</td>
              <td style={{ ...tdN, fontWeight: 800, color: "var(--steel)" }}>{finPct}%</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
const th = (align: "left" | "right"): React.CSSProperties => ({ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", fontWeight: 600, textAlign: align, padding: "10px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
const tdN: React.CSSProperties = { padding: "10px 14px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: "var(--ink-2)" };
