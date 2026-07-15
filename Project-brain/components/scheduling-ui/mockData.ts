// mockData.ts — representative data so the UI renders without a backend.
// Mirrors examples/demo.py so the preview matches the engine output.

import type {
  SchedulePayload,
  DelayReport,
  DcmaReport,
  DashboardPayload,
} from "./types";

export const mockSchedule: SchedulePayload = {
  project: {
    id: "demo",
    name: "RSP — Coke Oven Battery #6 Rebuild",
    start_date: "2026-06-22",
    data_date: "2026-07-10",
  },
  wbs: [
    { id: "w1", code: "1", name: "Civil & Foundation", parent_id: null, seq: 1 },
    { id: "w2", code: "2", name: "Structural & MEP", parent_id: null, seq: 2 },
    { id: "w3", code: "3", name: "Commissioning", parent_id: null, seq: 3 },
  ],
  activities: [
    a("A", "Site mobilization", "w1", 5, "2026-06-22", "2026-06-26", 100, false, true),
    a("B", "Excavation", "w1", 10, "2026-06-29", "2026-07-10", 60, false, true),
    a("C", "Foundation", "w1", 8, "2026-07-13", "2026-07-22", 0, false, true),
    m("M1", "Foundation complete", "w1", "2026-07-23", true),
    a("D", "Structure erection", "w2", 15, "2026-07-24", "2026-08-13", 0, false, true),
    a("E", "MEP rough-in", "w2", 12, "2026-07-31", "2026-08-17", 0, false, false, 2),
    a("F", "Finishes & handover", "w3", 6, "2026-08-18", "2026-08-25", 0, false, true),
  ],
  relationships: [
    rel("A", "B"),
    rel("B", "C"),
    rel("C", "M1"),
    rel("M1", "D"),
    rel("C", "D", "SS", 2),
    rel("D", "E", "SS", 5),
    rel("D", "F"),
    rel("E", "F"),
  ],
};

// attach baseline bars (slightly earlier than current → visible slip)
const baseline: Record<string, [string, string]> = {
  A: ["2026-06-22", "2026-06-26"],
  B: ["2026-06-29", "2026-07-09"],
  C: ["2026-07-10", "2026-07-21"],
  D: ["2026-07-22", "2026-08-11"],
  E: ["2026-07-29", "2026-08-13"],
  F: ["2026-08-14", "2026-08-21"],
};
mockSchedule.activities.forEach((act) => {
  const b = baseline[act.code];
  if (b) {
    act.bl_start = b[0];
    act.bl_finish = b[1];
  }
});

export const mockDelay: DelayReport = {
  project_finish_variance_wd: 1,
  delayed_count: 3,
  critical_delay_count: 3,
  rows: [
    drow("B", "Excavation", "2026-07-09", "2026-07-10", 1, 0, "critical_delay", "Monsoon — 1 day rain stoppage"),
    drow("C", "Foundation", "2026-07-21", "2026-07-22", 1, 0, "critical_delay", "Rebar delivery slip"),
    drow("D", "Structure erection", "2026-08-11", "2026-08-13", 2, 0, "critical_delay", "Crane mobilization delay"),
    drow("E", "MEP rough-in", "2026-08-13", "2026-08-17", 2, 4, "slipping", ""),
    drow("F", "Finishes & handover", "2026-08-21", "2026-08-25", 2, 0, "critical_delay", ""),
    drow("A", "Site mobilization", "2026-06-26", "2026-06-26", 0, 0, "on_track", ""),
  ],
};

export const mockDcma: DcmaReport = {
  score: 79,
  passed_count: 11,
  applicable_count: 14,
  checks: [
    chk(1, "Logic", "0.0%", "< 5%", true, 0, 8, "All activities have predecessor and successor.", ""),
    chk(2, "Leads (negative lag)", "0", "= 0", true, 0, 8, "No negative lags found.", ""),
    chk(3, "Lags", "25.0%", "< 5%", false, 2, 8, "2 relationships use a positive lag.", "Replace lags with explicit activities where possible."),
    chk(4, "Relationship types (FS)", "75.0%", "≥ 90% FS", false, 2, 8, "Only 75% of links are Finish-to-Start.", "Prefer FS links; justify SS/FF in the basis of schedule."),
    chk(5, "Hard constraints", "0.0%", "< 5%", true, 0, 7, "No hard date constraints.", ""),
    chk(6, "High float (>44wd)", "0.0%", "< 5%", true, 0, 7, "No excessive float.", ""),
    chk(7, "Negative float", "0", "= 0", true, 0, 7, "No negative float.", ""),
    chk(8, "High duration (>44wd)", "0.0%", "< 5%", true, 0, 7, "No over-long activities.", ""),
    chk(9, "Invalid dates", "0", "= 0", true, 0, 7, "No actuals in the future / forecasts in the past.", ""),
    chk(10, "Resources", "—", "info", true, 0, 7, "Informational — resource loading not assessed.", ""),
    chk(11, "Missed tasks", "0.0%", "< 5%", true, 0, 7, "No tasks behind baseline finish.", ""),
    chk(12, "Critical path test", "pass", "integrity", true, 0, 0, "Injected delay propagated to project finish.", ""),
    chk(13, "CPLI", "0.98", "≥ 0.95", true, 0, 0, "Critical Path Length Index healthy.", ""),
    chk(14, "BEI", "0.92", "≥ 0.95", false, 0, 0, "Baseline Execution Index below target.", "Accelerate near-term work to recover the index."),
  ],
};

export const mockDashboard: DashboardPayload = {
  cards: { health: "watch", critical_count: 6, delayed_milestones: 0, needs_update: 2, negative_float: 0 },
  alerts: [
    { category: "critical_lookahead", severity: "warning", activity_code: "C", message: "Foundation starts within the look-ahead window and is on the critical path." },
    { category: "overdue_update", severity: "info", activity_code: "B", message: "Excavation is in progress past the data date — confirm % complete." },
    { category: "unresolved_hindrance", severity: "warning", activity_code: "B", message: "Open hindrance: monsoon stoppage, responsibility = weather." },
  ],
};

// ---- builders ------------------------------------------------------------
function a(
  code: string, name: string, wbs: string, dur: number,
  es: string, ef: string, pct: number, ms: boolean, crit: boolean, tf = 0
) {
  return {
    id: code, code, name, wbs_id: wbs, duration: dur,
    remaining_duration: null, percent_complete: pct, is_milestone: ms,
    status: (pct >= 100 ? "completed" : pct > 0 ? "in_progress" : "not_started") as any,
    actual_start: pct > 0 ? es : null, actual_finish: pct >= 100 ? ef : null,
    early_start: es, early_finish: ef, late_start: es, late_finish: ef,
    total_float: tf, free_float: tf, is_critical: crit,
    constraint_type: "NONE", constraint_date: null,
    agency: null, discipline: null, package: null, area: null,
  };
}
function m(code: string, name: string, wbs: string, date: string, crit: boolean) {
  return { ...a(code, name, wbs, 0, date, date, 0, true, crit), };
}
function rel(predecessor: string, successor: string, rel_type: any = "FS", lag = 0) {
  return { predecessor, successor, rel_type, lag };
}
function drow(
  activity_id: string, name: string, bl: string, cur: string,
  v: number, tf: number, cls: any, reason: string
) {
  return { activity_id, name, bl_finish: bl, cur_finish: cur, finish_var_wd: v, total_float: tf, classification: cls, reason };
}
function chk(
  number: number, name: string, metric: string, threshold: string,
  passed: boolean, affected: number, total: number, observation: string, suggestion: string
) {
  return { number, name, metric, threshold, passed, affected, total, observation, suggestion };
}
