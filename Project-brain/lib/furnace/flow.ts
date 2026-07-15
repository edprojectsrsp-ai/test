"use client";
/* ============================================================
   Flow logic — matched to the competitor's backend so the same
   reports fall out. Pure functions; no I/O.
   ============================================================ */
import { SCurvePoint } from "@/lib/furnace/api";

/* ---------- Physical progress (weighted_progress_percent) ----------
   weighted % = Σ ( weightFraction × qty/scope ) × 100 over activity rows.
   Falls back to Σqty / Σscope when no weights present. */
export interface WeightRow { weightPercent: number; scope: number; planned?: number; actual?: number; }
export function weightedProgressPercent(rows: WeightRow[], key: "planned" | "actual"): number {
  let weighted = 0, hasWeight = false;
  for (const r of rows) {
    const raw = +r.weightPercent || 0;
    const wf = raw > 1 ? raw / 100 : raw;
    if (wf <= 0) continue;
    hasWeight = true;
    const scope = +r.scope || 0, qty = +(r[key] as number) || 0;
    if (scope) weighted += wf * (qty / scope);
  }
  if (hasWeight) return weighted * 100;
  const totScope = rows.reduce((s, r) => s + (+r.scope || 0), 0);
  const totQty = rows.reduce((s, r) => s + (+(r[key] as number) || 0), 0);
  return totScope ? (totQty / totScope) * 100 : 0;
}

/* ---------- Multi-package overall S-curve rollup ----------
   Scheme curve(month) = Σ ( pkgWeightFraction × pkgCumPct ).
   Package weights normalized to sum 1. `priorFyActualPct` carries
   prior-FY cumulative actual forward (cross-FY revision). */
export interface PkgCurve { package_id: number; package_name: string; weight: number; points: SCurvePoint[]; priorFyActualPct?: number; }
export function rollupSchemeCurve(packages: PkgCurve[], todayIdx: number): { points: SCurvePoint[]; months: string[] } {
  if (!packages.length) return { points: [], months: [] };
  const months = packages[0].points.map((p) => p.month_date);
  const totW = packages.reduce((s, p) => s + (p.weight || 0), 0) || 1;
  const points: SCurvePoint[] = months.map((m, i) => {
    let plan = 0, act = 0;
    for (const pk of packages) {
      const wf = (pk.weight || 0) / totW;
      const pt = pk.points[i];
      const carry = pk.priorFyActualPct || 0;
      plan += wf * Math.min(100, (pt?.cumulative_planned_pct ?? 0) + carry);
      act += wf * Math.min(100, (pt?.cumulative_actual_pct ?? 0) + carry);
    }
    const isFc = i > todayIdx;
    return { month_date: m, cumulative_planned_pct: +plan.toFixed(1), cumulative_actual_pct: isFc ? null : +act.toFixed(1), is_forecast: isFc };
  });
  return { points, months };
}

/* ---------- CAPEX project financials (his exact rules) ---------- */
export interface CapexProjMonthly { be: number; actual: number; re?: number | null; }
export interface CapexProjInput { project_id: number; label: string; bucket: "Corporate AMR" | "Plant Level AMR"; gross_cost: number; expenditure_last_fy: number; months: CapexProjMonthly[]; }
export interface CapexProjFinancials {
  project_id: number; label: string; bucket: string;
  gross_cost: number; expenditure_last_fy: number;
  be_current_fy: number; re_current_fy: number | null; actual_current_fy: number;
  cumulative_cost: number; balance_plan: number; progress_pct: number;
  monthly_plan: number[]; monthly_actual: number[];
}
/** plan_type "RE" + effectiveIndex → months before effective use ACTUAL, from effective use RE. */
export function capexFinancials(input: CapexProjInput, planType: "BE" | "RE", effectiveIndex: number | null): CapexProjFinancials {
  let be = 0, re = 0, actual = 0, hasRe = false;
  const monthly_plan: number[] = [], monthly_actual: number[] = [];
  input.months.forEach((m, i) => {
    const beV = m.be || 0, acV = m.actual || 0, reV = m.re ?? null;
    be += beV; actual += acV;
    if (reV != null) hasRe = true;
    let planV = beV;
    if (planType === "RE" && effectiveIndex != null) {
      planV = i < effectiveIndex ? acV : (reV || 0); // ← autofill elapsed months from actuals
      re += planV;
    } else {
      re += reV || 0;
    }
    monthly_plan.push(planV); monthly_actual.push(acV);
  });
  const cumulative_cost = input.expenditure_last_fy + actual;
  const planTotal = planType === "RE" && effectiveIndex != null ? re : be;
  return {
    project_id: input.project_id, label: input.label, bucket: input.bucket,
    gross_cost: input.gross_cost, expenditure_last_fy: input.expenditure_last_fy,
    be_current_fy: be, re_current_fy: hasRe || (planType === "RE" && effectiveIndex != null) ? re : null,
    actual_current_fy: actual, cumulative_cost, balance_plan: input.gross_cost - cumulative_cost,
    progress_pct: planTotal ? +((actual / planTotal) * 100).toFixed(2) : 0,
    monthly_plan, monthly_actual,
  };
}

export const delayCat = (variance: number) => variance <= -10 ? "critical" : variance < -3 ? "moderate" : variance < 0 ? "minor" : "ok";
