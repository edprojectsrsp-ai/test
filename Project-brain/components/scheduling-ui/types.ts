// types.ts — shapes returned by /api/scheduling/* (mirror of the backend)

export type RelType = "FS" | "SS" | "FF" | "SF";

export type ActivityStatus =
  | "not_started"
  | "in_progress"
  | "completed";

export interface ProjectInfo {
  id: string;
  name: string;
  start_date: string | null; // ISO date
  data_date: string | null;
}

export interface WbsNode {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  seq: number;
}

export interface Activity {
  id: string;
  code: string;
  name: string;
  wbs_id: string | null;
  duration: number; // working days
  remaining_duration: number | null;
  percent_complete: number; // 0..100
  is_milestone: boolean;
  status: ActivityStatus | null;
  actual_start: string | null;
  actual_finish: string | null;
  early_start: string | null;
  early_finish: string | null;
  late_start: string | null;
  late_finish: string | null;
  total_float: number | null;
  free_float: number | null;
  is_critical: boolean;
  constraint_type: string | null;
  constraint_date: string | null;
  agency: string | null;
  discipline: string | null;
  package: string | null;
  area: string | null;
  // optional baseline bar (populated client-side from a delay/baseline fetch)
  bl_start?: string | null;
  bl_finish?: string | null;
}

export interface Relationship {
  predecessor: string; // activity code
  successor: string;
  rel_type: RelType;
  lag: number;
}

export interface SchedulePayload {
  project: ProjectInfo;
  wbs: WbsNode[];
  activities: Activity[];
  relationships: Relationship[];
}

// ---- delay ---------------------------------------------------------------
export type DelayClass =
  | "ahead"
  | "on_track"
  | "slipping"
  | "critical_delay";

export interface DelayRow {
  activity_id: string; // code
  name: string;
  bl_finish: string | null;
  cur_finish: string | null;
  finish_var_wd: number | null; // +ve = late
  total_float: number | null;
  classification: DelayClass;
  reason: string;
  group?: Record<string, string>;
}

export interface DelayReport {
  project_finish_variance_wd: number | null;
  delayed_count: number;
  critical_delay_count: number;
  rows: DelayRow[];
}

// ---- DCMA ----------------------------------------------------------------
export interface DcmaCheck {
  number: number;
  name: string;
  metric: string;
  threshold: string;
  passed: boolean;
  affected: number;
  total: number;
  observation: string;
  suggestion: string;
}

export interface DcmaReport {
  checks: DcmaCheck[];
  score: number; // %
  passed_count: number;
  applicable_count: number;
}

// ---- dashboard -----------------------------------------------------------
export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  category: string;
  severity: AlertSeverity;
  activity_code?: string;
  message: string;
}

export interface DashboardCards {
  health: "good" | "watch" | "poor";
  critical_count: number;
  delayed_milestones: number;
  needs_update: number;
  negative_float: number;
}

export interface DashboardPayload {
  cards: DashboardCards;
  alerts: Alert[];
}
