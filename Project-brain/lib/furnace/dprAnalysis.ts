"use client";
/* ============================================================
   DPR analysis & auto-refill logic (spec-conformant).
   - aggregateDailyToMonthly: contractor/daily entries → month qty.
   - validateDerived: enforce actual_to_date + derived ≤ scope (100%).
   - The AI / multi-format extractor is a server call (analyzeDpr);
     this module is the deterministic fallback + validation layer.
   ============================================================ */
import { DprDerived } from "@/lib/furnace/api";

export interface DailyEntry { activity_id: number; actual_date: string; actual_qty: number; }

/** Sum daily entries within `month` (YYYY-MM) per activity. */
export function aggregateDailyToMonthly(entries: DailyEntry[], month: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of entries) {
    if (!e.actual_date.startsWith(month)) continue;
    out[e.activity_id] = (out[e.activity_id] || 0) + (+e.actual_qty || 0);
  }
  return out;
}

/** Build derived rows from daily aggregation (the "daily" source path). */
export function deriveFromDaily(
  activities: { activity_id: number; activity_name: string; uom: string; scope_qty: number; prev_actual?: number }[],
  monthly: Record<number, number>,
): DprDerived[] {
  return activities.map((a) => ({
    activity_id: a.activity_id, activity_name: a.activity_name, uom: a.uom, scope_qty: a.scope_qty,
    prev_actual: a.prev_actual ?? 0, derived_qty: monthly[a.activity_id] || 0,
    confidence: 1, source: "daily", matched: `${Object.keys(monthly).length ? "daily entries" : "no entries"}`,
  }));
}

/** Spec gate: prev_actual + derived must not exceed scope (capped + flagged). */
export interface ValidatedRow extends DprDerived { capped: boolean; cumulative: number; progress_pct: number; }
export function validateDerived(rows: DprDerived[]): ValidatedRow[] {
  return rows.map((r) => {
    const room = Math.max(0, r.scope_qty - r.prev_actual);
    const capped = r.derived_qty > room + 1e-6;
    const derived = capped ? room : r.derived_qty;
    const cumulative = r.prev_actual + derived;
    return { ...r, derived_qty: derived, capped, cumulative, progress_pct: r.scope_qty ? +((cumulative / r.scope_qty) * 100).toFixed(1) : 0 };
  });
}

export const confidenceTone = (c: number) => (c >= 0.9 ? "ok" : c >= 0.75 ? "minor" : "moderate") as "ok";
