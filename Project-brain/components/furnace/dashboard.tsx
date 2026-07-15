"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Segmented, Kpi, Chip, Button, toast } from "@/ui";
import { getDashSummary, getSchemeCards, getCapexProjects, DashSummary, SchemeCard, STATUS_LABEL, STATUS_ORDER } from "@/lib/furnace/api";
import { capexFinancials } from "@/lib/furnace/flow";
import { exportCSV } from "@/lib/furnace/export";

const cr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const FYS = ["2026-2027", "2025-2026", "2024-2025"];
const DELAY = {
  on_time: { label: "On time", color: "var(--verdigris)" }, minor: { label: "Delay < 6 mo", color: "var(--slag)" },
  moderate: { label: "Delay 6–12 mo", color: "var(--ember)" }, critical: { label: "Delay > 1 yr", color: "var(--molten)" },
} as const;

export default function DashboardPage() {
  const [fy, setFy] = useState(FYS[0]);
  const [scope, setScope] = useState("all");
  const [sum, setSum] = useState<DashSummary | null>(null);
  const [cards, setCards] = useState<SchemeCard[]>([]);
  const [capexTot, setCapexTot] = useState({ be: 0, re: 0, actual: 0 });

  useEffect(() => {
    getDashSummary(fy).then(setSum);
    getSchemeCards(fy).then(setCards);
    getCapexProjects(fy).then((ps) => {
      let be = 0, re = 0, actual = 0;
      ps.forEach((p) => { const f = capexFinancials(p, "RE", 3); be += f.be_current_fy; re += f.re_current_fy ?? 0; actual += f.actual_current_fy; });
      setCapexTot({ be, re, actual });
    });
  }, [fy]);

  const filtered = useMemo(() => scope === "all" ? cards : cards.filter((c) => c.scheme_type === scope), [cards, scope]);

  // furnace heatbar: portfolio cost by delay category
  const heat = useMemo(() => {
    const g = { on_time: 0, minor: 0, moderate: 0, critical: 0 };
    filtered.forEach((c) => { g[c.delay.delay_category] += c.total_cost_cr; });
    const total = Object.values(g).reduce((a, b) => a + b, 0) || 1;
    const atRisk = g.moderate + g.critical;
    return { g, total, atRisk };
  }, [filtered]);

  const achievement = capexTot.be ? (capexTot.actual / capexTot.be) * 100 : 0;
  const corp = sum?.by_type["Corporate AMR"] ?? cards.filter((c) => c.scheme_type === "Corporate AMR").length;
  const plant = sum?.by_type["Plant Level AMR"] ?? cards.filter((c) => c.scheme_type === "Plant Level AMR").length;
  const schemeCount = scope === "all" ? (sum?.total_schemes ?? filtered.length) : filtered.length;

  const upcoming = useMemo(() => [...filtered]
    .filter((c) => c.schedule_finish)
    .sort((a, b) => (a.schedule_finish! < b.schedule_finish! ? -1 : 1)).slice(0, 5), [filtered]);

  const exportDashboard = () => {
    const rows = filtered.map((card) => [
      card.scheme_id,
      card.scheme_name,
      card.scheme_type,
      STATUS_LABEL[card.current_status] ?? card.current_status,
      card.total_cost_cr.toFixed(2),
      card.actual_cr.toFixed(2),
      card.achievement_pct.toFixed(1),
      card.delay.delay_category,
      card.delay.delay_months.toFixed(1),
      card.schedule_finish ?? "",
    ]);
    exportCSV(
      `furnace-dashboard-${fy}-${scope}`,
      ["Scheme ID", "Scheme Name", "Scheme Type", "Stage", "Total Cost (Cr)", "Actual (Cr)", "Achievement %", "Delay Category", "Delay Months", "Scheduled Finish"],
      rows,
      `Executive Dashboard - ${fy} - ${scope === "all" ? "All schemes" : scope}`,
    );
    toast("Executive dashboard exported (CSV)");
  };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Executive Dashboard" subtitle="Strategic CAPEX & physical performance · Corporate AMR monitoring"
        right={<>
          <Field label="Financial year"><Select value={fy} onChange={setFy} options={FYS.map((f) => ({ value: f, label: `FY ${f}` }))} style={{ minWidth: 140 }} /></Field>
          <Field label="Project-wise"><Segmented options={[{ value: "all", label: "All" }, { value: "Corporate AMR", label: "Corporate" }, { value: "Plant Level AMR", label: "Plant" }]} value={scope} onChange={setScope} /></Field>
          <Button kind="steel" onClick={exportDashboard}>Export</Button>
          <ThemeToggle />
        </>} />

      {/* FURNACE HEATBAR */}
      <div className="fz-eyebrow">Portfolio thermal state <span className="tag">capital by delay severity</span></div>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Capital at delay risk</div>
            <div className="fz-display" style={{ fontWeight: 900, fontSize: 38, lineHeight: 1, marginTop: 4, color: "var(--molten)" }}>{cr(heat.atRisk)}<span style={{ fontSize: 16, color: "var(--ink-3)" }}> Cr</span></div>
          </div>
          <div className="fz-mono" style={{ fontSize: 13, color: "var(--ink-2)", textAlign: "right" }}>Portfolio {cr(heat.total)} Cr · {filtered.length} schemes</div>
        </div>
        <div style={{ height: 42, borderRadius: 8, overflow: "hidden", display: "flex", border: "1px solid var(--line-2)" }}>
          {(["on_time", "minor", "moderate", "critical"] as const).map((k) => {
            const w = (heat.g[k] / heat.total) * 100;
            return w > 0 ? <div key={k} title={`${DELAY[k].label}: ${cr(heat.g[k])} Cr`} style={{ width: `${w}%`, background: DELAY[k].color, display: "grid", placeItems: "center", color: "rgba(0,0,0,.6)", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, fontWeight: 600 }}>{w >= 8 ? `${Math.round(w)}%` : ""}</div> : null;
          })}
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap" }}>
          {(["on_time", "minor", "moderate", "critical"] as const).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: DELAY[k].color }} />
              <span style={{ color: "var(--ink-2)" }}>{DELAY[k].label}</span>
              <span className="fz-mono" style={{ fontWeight: 600 }}>{cr(heat.g[k])} Cr</span>
            </span>
          ))}
        </div>
      </Card>

      {/* KPIs incl RE */}
      <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
        <Kpi label="CAPEX BE (FY)" value={cr(capexTot.be)} tone="steel" />
        <Kpi label="CAPEX RE (FY)" value={cr(capexTot.re)} tone="moderate" sub="revised estimate" />
        <Kpi label="Actual YTD" value={cr(capexTot.actual)} tone="moderate" />
        <Kpi label="Achievement" value={achievement.toFixed(1)} unit="%" tone="ok" />
        <Kpi label="Schemes" value={String(schemeCount)} tone="neutral" sub={<>Corp <b>{corp}</b> · Plant <b>{plant}</b></>} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        {/* DELAY TREND by stage */}
        <div>
          <div className="fz-eyebrow">Delay trend by stage</div>
          <Card pad={false}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["Stage", "Schemes", "On time", "< 1 yr", "> 1 yr"].map((h, i) =>
                <th key={h} style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", fontWeight: 600, textAlign: i ? "right" : "left", padding: "10px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
              <tbody>
                {STATUS_ORDER.filter((s) => (sum?.by_status[s] ?? 0) > 0).map((s) => {
                  const inStage = filtered.filter((c) => c.current_status === s);
                  const onT = inStage.filter((c) => c.delay.delay_category === "on_time").length;
                  const lt1 = inStage.filter((c) => ["minor", "moderate"].includes(c.delay.delay_category)).length;
                  const gt1 = inStage.filter((c) => c.delay.delay_category === "critical").length;
                  return (
                    <tr key={s} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{STATUS_LABEL[s]}</td>
                      <td style={tdN}>{sum?.by_status[s] ?? inStage.length}</td>
                      <td style={{ ...tdN, color: "var(--verdigris)" }}>{onT || "·"}</td>
                      <td style={{ ...tdN, color: "var(--ember)" }}>{lt1 || "·"}</td>
                      <td style={{ ...tdN, color: "var(--molten)" }}>{gt1 || "·"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>

        {/* UPCOMING lookahead */}
        <div>
          <div className="fz-eyebrow">Upcoming completions</div>
          <Card pad={false}>
            {upcoming.map((c) => (
              <div key={c.scheme_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.scheme_name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{STATUS_LABEL[c.current_status]} · {cr(c.total_cost_cr)} Cr</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="fz-mono" style={{ fontSize: 12 }}>{c.schedule_finish ? new Date(c.schedule_finish).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : "—"}</div>
                  <Chip tone={c.delay.delay_category === "critical" ? "critical" : c.delay.delay_category === "moderate" ? "moderate" : c.delay.delay_category === "minor" ? "minor" : "ok"} style={{ marginTop: 3 }}>{c.delay.delay_months ? `${c.delay.delay_months}mo late` : "on time"}</Chip>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
const tdN: React.CSSProperties = { padding: "9px 14px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: "var(--ink-2)" };
