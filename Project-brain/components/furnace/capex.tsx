"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Segmented, Kpi, Chip } from "@/ui";
import { getFyOptions, getCapexPlans, getCapexActuals, CapexPlan, CapexRow } from "@/lib/furnace/api";
import { CapexActuals } from "@/plan/CapexActuals";

const VIEWS = [{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "fy", label: "FY Summary" }];
const MODES = [{ value: "plan", label: "Plan view" }, { value: "actuals", label: "Actuals entry" }];
const cr = (n: number) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN") + " Cr";

export default function CapexPage() {
  const [fys, setFys] = useState<string[]>([]);
  const [fy, setFy] = useState("");
  const [plans, setPlans] = useState<CapexPlan[]>([]);
  const [planId, setPlanId] = useState(0);
  const [months, setMonths] = useState<string[]>([]);
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [view, setView] = useState("monthly");
  const [mode, setMode] = useState("plan");

  useEffect(() => { getFyOptions().then((f) => { setFys(f); if (f[0]) setFy(f[0]); }); }, []);
  useEffect(() => { if (fy) getCapexPlans(fy).then((p) => { setPlans(p); const act = p.find((x) => x.is_active) ?? p[0]; if (act) setPlanId(act.capex_plan_id); }); }, [fy]);
  useEffect(() => { if (fy) getCapexActuals(fy).then((d) => { setMonths(d.months); setRows(d.rows); }); }, [fy]);

  const plan = plans.find((p) => p.capex_plan_id === planId);

  const totals = useMemo(() => {
    let be = 0, actual = 0;
    rows.forEach((r) => r.months.forEach((m) => { be += m.be; actual += m.actual; }));
    return { be, actual, variance: actual - be, progress: be ? (actual / be) * 100 : 0 };
  }, [rows]);

  // aggregate columns by view
  const cols = useMemo(() => {
    if (view === "fy") return [{ label: "FY Total", idxs: months.map((_, i) => i) }];
    if (view === "quarterly") return [0, 1, 2, 3].map((q) => ({ label: `Q${q + 1}`, idxs: [q * 3, q * 3 + 1, q * 3 + 2] }));
    return months.map((m, i) => ({ label: m, idxs: [i] }));
  }, [view, months]);

  const cellVal = (r: CapexRow, idxs: number[], key: "be" | "actual") =>
    idxs.reduce((s, i) => s + (r.months[i]?.[key] ?? 0), 0);

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="CAPEX Planning Management" subtitle="BE / RE plan vs actual · variance tracking"
        right={<>
          <Field label="Financial Year"><Select value={fy} onChange={setFy} options={fys.map((f) => ({ value: f, label: f }))} style={{ minWidth: 150 }} /></Field>
          <Field label="Plan Version"><Select value={planId} onChange={(v) => setPlanId(+v)} options={plans.map((p) => ({ value: p.capex_plan_id, label: `${p.plan_version} (${p.plan_type})` }))} style={{ minWidth: 190 }} /></Field>
          <ThemeToggle />
        </>} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 4px" }}>
        {plan && <Chip tone={plan.is_active ? "ok" : "neutral"} dot={plan.is_active}>{plan.is_active ? "Active plan" : "Inactive"}</Chip>}
        {plan && <Chip tone="steel">{plan.plan_type}</Chip>}
        <Segmented options={MODES} value={mode} onChange={setMode} />
        <div style={{ flex: 1 }} />
        {mode === "plan" && <Segmented options={VIEWS} value={view} onChange={setView} />}
      </div>

      {mode === "actuals" ? (
        <Card pad={false} style={{ marginTop: 14 }}><CapexActuals fy={fy} /></Card>
      ) : (
      <>
      <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
        <Kpi label="FY Plan (BE)" value={cr(totals.be)} tone="steel" />
        <Kpi label="Actual till date" value={cr(totals.actual)} tone="moderate" />
        <Kpi label="Variance (BE−Act)" value={cr(totals.variance)} tone={totals.variance < 0 ? "critical" : "ok"} />
        <Kpi label="Progress (BE)" value={`${totals.progress.toFixed(1)}`} unit="%" tone="ok" />
      </div>

      <Card pad={false}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={thStyle("left", true)}>Scheme</th>
                {cols.map((c) => <th key={c.label} colSpan={2} style={{ ...thStyle("center"), borderLeft: "1px solid var(--line)" }}>{c.label}</th>)}
              </tr>
              <tr>
                {cols.map((c) => <React.Fragment key={c.label}>
                  <th style={{ ...thStyle("right"), borderLeft: "1px solid var(--line)" }}>BE</th>
                  <th style={thStyle("right")}>Act</th>
                </React.Fragment>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600, position: "sticky", left: 0, background: "var(--panel)" }}>{r.label}</td>
                  {cols.map((c) => {
                    const be = cellVal(r, c.idxs, "be"), act = cellVal(r, c.idxs, "actual");
                    return <React.Fragment key={c.label}>
                      <td style={{ ...tdNum, borderLeft: "1px solid var(--line)" }}>{be.toLocaleString("en-IN")}</td>
                      <td style={{ ...tdNum, color: act < be ? "var(--ember)" : "var(--verdigris)" }}>{act ? act.toLocaleString("en-IN") : "·"}</td>
                    </React.Fragment>;
                  })}
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

const thStyle = (align: "left" | "right" | "center", sticky = false): React.CSSProperties => ({
  fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", fontWeight: 600,
  textAlign: align, padding: "9px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)",
  position: sticky ? "sticky" : undefined, left: sticky ? 0 : undefined, whiteSpace: "nowrap",
});
const tdNum: React.CSSProperties = { padding: "10px 12px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace' };
