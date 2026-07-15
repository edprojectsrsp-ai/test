"use client";
import React, { useMemo } from "react";
import { PlanActivity, PkgData, savePlanCells, autoDistribute } from "@/lib/furnace/api";
import { Button, toast } from "@/ui";

export const monthLabel = (m: string) => {
  const d = new Date(m.length === 7 ? m + "-01" : m);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};
const key = (aid: number, m: string) => `${aid}|${m}`;
const norm = (m: string) => m.slice(0, 7);

/** Cumulative S-curve derived from monthly planned/actual cells, using your formula:
 *  monthPct += (qty / scope_qty) * (weightage/100) * 100 ; cumulative capped at 100. */
export function computeCurve(
  activities: PlanActivity[], months: string[],
  planned: Record<string, number>, actual: Record<string, number>, todayIdx: number,
): PkgData {
  let cumP = 0, cumA = 0;
  const points = months.map((m, i) => {
    let mp = 0, ma = 0;
    activities.forEach((a) => {
      const aid = a.plan_activity_id ?? a.activity_id;
      const p = planned[key(aid, norm(m))] ?? planned[key(aid, m)] ?? 0;
      const ac = actual[key(aid, norm(m))] ?? actual[key(aid, m)] ?? 0;
      if (a.scope_qty > 0) { mp += (p / a.scope_qty) * (a.weightage / 100) * 100; ma += (ac / a.scope_qty) * (a.weightage / 100) * 100; }
    });
    cumP = Math.min(cumP + mp, 100); cumA = Math.min(cumA + ma, 100);
    const isFc = i > todayIdx;
    return { month_date: norm(m) + "-01", cumulative_planned_pct: +cumP.toFixed(1), cumulative_actual_pct: isFc ? null : +cumA.toFixed(1), is_forecast: isFc };
  });
  const tp = points[todayIdx]?.cumulative_planned_pct ?? 0;
  const ta = points[todayIdx]?.cumulative_actual_pct ?? 0;
  return {
    package_id: 0, package_name: "", points,
    today_planned_pct: tp, today_actual_pct: ta, today_variance_pct: +(ta - tp).toFixed(1),
    forecast_completion_date: null, forecast_method: "from plan cells", forecast_confidence_pct: null, forecast_explainer: null,
  };
}

export function PlanGrid({
  planId, activities, months, planned, actual, locked, onChange, onAfterServer,
}: {
  planId: number; activities: PlanActivity[]; months: string[];
  planned: Record<string, number>; actual: Record<string, number>; locked: boolean;
  onChange: (next: Record<string, number>) => void;
  onAfterServer: () => void;
}) {
  const rowTotal = (a: PlanActivity) => {
    const aid = a.plan_activity_id ?? a.activity_id;
    return months.reduce((s, m) => s + (planned[key(aid, norm(m))] ?? planned[key(aid, m)] ?? 0), 0);
  };

  const monthly = useMemo(() => months.map((m) => {
    let mp = 0;
    activities.forEach((a) => { const aid = a.plan_activity_id ?? a.activity_id; const p = planned[key(aid, norm(m))] ?? planned[key(aid, m)] ?? 0; if (a.scope_qty) mp += (p / a.scope_qty) * (a.weightage / 100) * 100; });
    return mp;
  }), [months, activities, planned]);
  const cumulative = useMemo(() => { let c = 0; return monthly.map((mp) => (c = Math.min(c + mp, 100))); }, [monthly]);

  const setCell = (aid: number, m: string, v: string) => {
    onChange({ ...planned, [key(aid, norm(m))]: parseFloat(v) || 0 });
  };
  const save = async () => {
    const cells = activities.flatMap((a) => {
      const aid = a.plan_activity_id ?? a.activity_id;
      return months.map((m) => ({ plan_activity_id: aid, plan_month: norm(m), planned_qty: planned[key(aid, norm(m))] ?? planned[key(aid, m)] ?? 0 }));
    });
    const r = await savePlanCells(planId, cells); toast(`Saved ${r.saved} cells`); onAfterServer();
  };
  const distribute = async () => {
    const r = await autoDistribute(planId);
    toast(`Distributed ${r.activities_distributed} activities (${r.cells_written} cells)`); onAfterServer();
  };

  const th: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", fontWeight: 600, padding: "8px 8px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
  const cellInput: React.CSSProperties = { width: 58, background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 6, padding: "5px 6px", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, textAlign: "right", outline: "none" };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Monthly scope distribution → drives the S-curve</span>
        <div style={{ flex: 1 }} />
        <Button onClick={distribute} disabled={locked} title="Spread scope across each activity's commencement→completion window">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          Auto-distribute
        </Button>
        <Button kind="steel" onClick={save} disabled={locked}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 4h11l3 3v13H5z" /><path d="M9 4v5h6" /></svg>
          Save cells
        </Button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>Activity</th>
              {months.map((m) => <th key={m} style={{ ...th, textAlign: "right" }}>{monthLabel(m)}</th>)}
              <th style={{ ...th, textAlign: "right" }}>Σ</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => {
              const aid = a.plan_activity_id ?? a.activity_id;
              const sum = rowTotal(a); const over = sum > a.scope_qty + 0.5;
              return (
                <tr key={aid} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 10px", fontWeight: 600, position: "sticky", left: 0, background: "var(--panel)", whiteSpace: "nowrap" }}>
                    {a.activity_name}
                    <div style={{ fontSize: 10, color: "var(--ink-4)", fontFamily: '"IBM Plex Mono", monospace' }}>scope {a.scope_qty} {a.uom}</div>
                  </td>
                  {months.map((m) => {
                    const inWindow = (!a.contract_start_month || norm(m) >= norm(a.contract_start_month)) && (!a.expected_completion_month || norm(m) <= norm(a.expected_completion_month));
                    return (
                      <td key={m} style={{ padding: "3px 5px", textAlign: "right" }}>
                        <input disabled={locked} value={planned[key(aid, norm(m))] ?? planned[key(aid, m)] ?? ""}
                          onChange={(e) => setCell(aid, m, e.target.value)} inputMode="decimal"
                          style={{ ...cellInput, opacity: inWindow ? 1 : 0.4, borderColor: inWindow ? "var(--line)" : "transparent" }} />
                      </td>
                    );
                  })}
                  <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: over ? "var(--molten)" : "var(--ink-3)" }} title={over ? "Exceeds scope qty" : ""}>{Math.round(sum * 10) / 10}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--line-2)" }}>
              <td style={{ padding: "8px 10px", fontWeight: 600, position: "sticky", left: 0, background: "var(--panel-2)" }}>Planned %</td>
              {monthly.map((mp, i) => <td key={i} style={{ padding: "8px 5px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: "var(--steel)" }}>{mp ? mp.toFixed(1) : "·"}</td>)}
              <td />
            </tr>
            <tr>
              <td style={{ padding: "6px 10px", fontWeight: 600, position: "sticky", left: 0, background: "var(--panel-2)", color: "var(--ink-3)" }}>Cumulative %</td>
              {cumulative.map((c, i) => <td key={i} style={{ padding: "6px 5px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: "var(--ink-2)" }}>{c.toFixed(1)}</td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
