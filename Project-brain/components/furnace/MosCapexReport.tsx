"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, PageHeader, Select, Field, Segmented, Button, Chip, toast } from "@/ui";
import { getFyOptions, getCapexProjects, FY_MONTHS } from "@/lib/furnace/api";
import { capexFinancials, CapexProjFinancials, CapexProjInput } from "@/lib/furnace/flow";
import { exportCSV, printPDF } from "@/lib/furnace/export";

const cr = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN");
const PLAN_TYPES = [{ value: "BE", label: "BE plan" }, { value: "RE", label: "RE (revised)" }];

export default function MosCapexReport({ onBack }: { onBack?: () => void }) {
  const [fys, setFys] = useState<string[]>([]);
  const [fy, setFy] = useState("");
  const [projects, setProjects] = useState<CapexProjInput[]>([]);
  const [planType, setPlanType] = useState<"BE" | "RE">("RE");
  const [effMonth, setEffMonth] = useState("Jul");

  const currentFy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };
  useEffect(() => { getFyOptions().then((f) => { setFys(f); setFy(f.includes(currentFy()) ? currentFy() : (f[0] ?? "")); }); }, []);
  useEffect(() => { if (fy) getCapexProjects(fy).then(setProjects); }, [fy]);

  const effIdx = FY_MONTHS.indexOf(effMonth);
  const fin: CapexProjFinancials[] = useMemo(
    () => projects.map((p) => capexFinancials(p, planType, planType === "RE" ? effIdx : null)),
    [projects, planType, effIdx]);

  const buckets = useMemo(() => {
    const g: Record<string, CapexProjFinancials[]> = {};
    fin.forEach((r) => { (g[r.bucket] ||= []).push(r); });
    return Object.entries(g);
  }, [fin]);

  const grand = useMemo(() => fin.reduce((a, r) => ({
    gross: a.gross + r.gross_cost, last: a.last + r.expenditure_last_fy, be: a.be + r.be_current_fy,
    re: a.re + (r.re_current_fy ?? 0), actual: a.actual + r.actual_current_fy, cum: a.cum + r.cumulative_cost, bal: a.bal + r.balance_plan,
  }), { gross: 0, last: 0, be: 0, re: 0, actual: 0, cum: 0, bal: 0 }), [fin]);

  const COLS = ["Gross Cost", "Exp. till last FY", "BE (FY)", "RE (FY)", "Actual (FY)", "Cumulative", "Balance", "Prog %"];

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="MoS CAPEX" subtitle="Ministry-of-Steel monthly CAPEX statement · all values ₹ Cr"
        right={<>
          {onBack && <Button kind="ghost" onClick={onBack}>← Reports</Button>}
          <Field label="FY"><Select value={fy} onChange={setFy} options={fys.map((f) => ({ value: f, label: f }))} style={{ minWidth: 140 }} /></Field>
          <Field label="Plan"><Segmented options={PLAN_TYPES} value={planType} onChange={(v) => setPlanType(v as "BE" | "RE")} /></Field>
          {planType === "RE" && <Field label="RE effective"><Select value={effMonth} onChange={setEffMonth} options={FY_MONTHS.map((m) => ({ value: m, label: m }))} style={{ minWidth: 90 }} /></Field>}
          <Button onClick={printPDF}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>PDF
          </Button>
          <Button kind="steel" onClick={() => {
            const HEAD = ["Scheme", "Bucket", "Gross Cost (Cr)", "Cum. Expr. upto last FY", `BE ${fy}`, `RE ${fy}`, "Actual (FY)", "Cumulative Expr.", "Balance", "Progress %"];
            const body = fin.map((r) => [r.label, r.bucket, r.gross_cost, r.expenditure_last_fy, r.be_current_fy, r.re_current_fy ?? "", r.actual_current_fy, r.cumulative_cost, r.balance_plan, r.progress_pct]);
            exportCSV(`MoS_CAPEX_${fy}`, HEAD, body, `MoS CAPEX Statement — ${fy} — ${planType} plan (all values Rs Cr)`);
            toast("MoS CAPEX exported (Excel/CSV)");
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>Excel
          </Button>
          <ThemeToggle />
        </>} />

      {planType === "RE" && (
        <div style={{ fontSize: 11.5, color: "var(--slag)", background: "var(--slag-soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", margin: "12px 0" }}>
          RE rule applied: months before <b>{effMonth}</b> auto-fill from <b>actuals</b>; {effMonth} onward use the revised estimate.
        </div>
      )}

      <Card pad={false} style={{ marginTop: 12 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th("left", true)}>Scheme</th>
                {COLS.map((c) => <th key={c} style={th("right")}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {buckets.map(([bucket, rows]) => {
                const sub = rows.reduce((a, r) => ({
                  gross: a.gross + r.gross_cost, last: a.last + r.expenditure_last_fy, be: a.be + r.be_current_fy,
                  re: a.re + (r.re_current_fy ?? 0), actual: a.actual + r.actual_current_fy, cum: a.cum + r.cumulative_cost, bal: a.bal + r.balance_plan,
                }), { gross: 0, last: 0, be: 0, re: 0, actual: 0, cum: 0, bal: 0 });
                return (
                  <React.Fragment key={bucket}>
                    <tr><td colSpan={9} style={{ padding: "9px 14px", background: "var(--panel-2)", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--steel)" }}>{bucket}</td></tr>
                    {rows.map((r) => (
                      <tr key={r.project_id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "9px 14px", fontWeight: 600 }}>{r.label}</td>
                        <td style={tdN}>{cr(r.gross_cost)}</td>
                        <td style={tdN}>{cr(r.expenditure_last_fy)}</td>
                        <td style={tdN}>{cr(r.be_current_fy)}</td>
                        <td style={tdN}>{r.re_current_fy == null ? "—" : cr(r.re_current_fy)}</td>
                        <td style={{ ...tdN, color: "var(--ember)" }}>{cr(r.actual_current_fy)}</td>
                        <td style={tdN}>{cr(r.cumulative_cost)}</td>
                        <td style={{ ...tdN, color: r.balance_plan < 0 ? "var(--molten)" : "var(--ink-2)" }}>{cr(r.balance_plan)}</td>
                        <td style={{ ...tdN }}><Chip tone={r.progress_pct >= 90 ? "ok" : r.progress_pct >= 50 ? "moderate" : "critical"}>{r.progress_pct}%</Chip></td>
                      </tr>
                    ))}
                    <tr style={{ borderBottom: "1px solid var(--line-2)", background: "var(--panel-2)" }}>
                      <td style={{ padding: "8px 14px", fontWeight: 700, fontStyle: "italic" }}>{bucket} subtotal</td>
                      {[sub.gross, sub.last, sub.be, sub.re, sub.actual, sub.cum, sub.bal].map((v, i) => <td key={i} style={{ ...tdN, fontWeight: 700 }}>{cr(v)}</td>)}
                      <td />
                    </tr>
                  </React.Fragment>
                );
              })}
              <tr style={{ background: "var(--steel-soft)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 800 }}>GRAND TOTAL</td>
                {[grand.gross, grand.last, grand.be, grand.re, grand.actual, grand.cum, grand.bal].map((v, i) => <td key={i} style={{ ...tdN, fontWeight: 800, color: "var(--steel)" }}>{cr(v)}</td>)}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
const th = (align: "left" | "right", sticky = false): React.CSSProperties => ({ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", fontWeight: 600, textAlign: align, padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", position: sticky ? "sticky" : undefined, left: sticky ? 0 : undefined });
const tdN: React.CSSProperties = { padding: "9px 12px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace' };
