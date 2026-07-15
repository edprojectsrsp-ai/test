// rows.ts — flatten WBS + activities into a single ordered row list so the
// grid and the Gantt stay in lock-step (same order, same row height).

import type { Activity, WbsNode, SchedulePayload } from "./types";

export interface DisplayRow {
  kind: "wbs" | "activity";
  depth: number;
  wbs?: WbsNode;
  activity?: Activity;
  // for wbs rows: rolled-up span across child activities
  rollupStart?: string | null;
  rollupFinish?: string | null;
}

export function buildRows(
  data: SchedulePayload,
  collapsed: Set<string> = new Set()
): DisplayRow[] {
  const byParent = new Map<string | null, WbsNode[]>();
  for (const w of data.wbs) {
    const k = w.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(w);
  }
  for (const list of byParent.values()) list.sort((x, y) => x.seq - y.seq || x.code.localeCompare(y.code));

  const actsByWbs = new Map<string | null, Activity[]>();
  for (const a of data.activities) {
    const k = a.wbs_id ?? null;
    if (!actsByWbs.has(k)) actsByWbs.set(k, []);
    actsByWbs.get(k)!.push(a);
  }
  for (const list of actsByWbs.values())
    list.sort((x, y) => (x.early_start ?? "").localeCompare(y.early_start ?? "") || x.code.localeCompare(y.code));

  const rows: DisplayRow[] = [];

  const minMax = (acts: Activity[]) => {
    let s: string | null = null;
    let f: string | null = null;
    for (const a of acts) {
      if (a.early_start && (!s || a.early_start < s)) s = a.early_start;
      if (a.early_finish && (!f || a.early_finish > f)) f = a.early_finish;
    }
    return { s, f };
  };

  const walk = (parent: string | null, depth: number) => {
    for (const w of byParent.get(parent) ?? []) {
      const childActs = actsByWbs.get(w.id) ?? [];
      const { s, f } = minMax(childActs);
      rows.push({ kind: "wbs", depth, wbs: w, rollupStart: s, rollupFinish: f });
      if (!collapsed.has(w.id)) {
        for (const a of childActs) rows.push({ kind: "activity", depth: depth + 1, activity: a });
        walk(w.id, depth + 1);
      }
    }
  };
  walk(null, 0);

  // activities with no WBS go at the end
  for (const a of actsByWbs.get(null) ?? [])
    rows.push({ kind: "activity", depth: 0, activity: a });

  return rows;
}

// date span across all activities, padded a few days each side
export function scheduleSpan(data: SchedulePayload): { min: Date; max: Date } {
  let min: string | null = data.project.start_date;
  let max: string | null = null;
  for (const a of data.activities) {
    const lo = a.bl_start && a.bl_start < (a.early_start ?? "9999") ? a.bl_start : a.early_start;
    const hi = a.bl_finish && a.bl_finish > (a.early_finish ?? "") ? a.bl_finish : a.early_finish;
    if (lo && (!min || lo < min)) min = lo;
    if (hi && (!max || hi > max)) max = hi;
  }
  const minD = new Date((min ?? "2026-01-01") + "T00:00:00");
  const maxD = new Date((max ?? "2026-12-31") + "T00:00:00");
  minD.setDate(minD.getDate() - 3);
  maxD.setDate(maxD.getDate() + 3);
  return { min: minD, max: maxD };
}
