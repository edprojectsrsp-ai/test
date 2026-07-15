"use client";

import type { CapexProjInput, PkgCurve } from "@/lib/furnace/flow";

export const API_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE) || "http://localhost:8000/api/v1";

export const MOCK =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_PB_MOCK === "1";

function cloneMock<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function liveJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function get<T>(path: string, mock: T, normalize?: (data: any) => T): Promise<T> {
  if (MOCK) return cloneMock(mock);
  try {
    const data = await liveJson(path);
    return normalize ? normalize(data) : (data as T);
  } catch {
    return cloneMock(mock);
  }
}

async function send<T>(method: string, path: string, body: unknown, mock: T, normalize?: (data: any) => T): Promise<T> {
  if (MOCK) return cloneMock(mock);
  try {
    const data = await liveJson(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    return normalize ? normalize(data) : (data as T);
  } catch {
    return cloneMock(mock);
  }
}

function fyValue(v?: string): string {
  return String(v ?? "").replace(/^FY\s+/i, "").trim();
}

function normalizeSchemeType(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Plant Level AMR";
  const key = raw.toLowerCase();
  if (key.startsWith("corporate")) return "Corporate AMR";
  if (key.startsWith("plant")) return "Plant Level AMR";
  return raw;
}

function isoMonth(value: string): string {
  if (!value) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const label = /^([A-Za-z]{3})-(\d{2})$/.exec(value);
  if (label) {
    const monthMap: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };
    const month = monthMap[label[1]] ?? 1;
    const year = 2000 + Number(label[2]);
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }
  return value;
}

function normalizeCurvePoints(
  planned: Array<{ month?: string; value?: number }>,
  actual: Array<{ month?: string; value?: number }>,
): SCurvePoint[] {
  const months = planned.map((row) => row.month ?? "").filter(Boolean);
  const actualMap = new Map(actual.map((row) => [row.month ?? "", +(row.value ?? 0)]));
  let latestActualIdx = -1;
  months.forEach((month, idx) => {
    if ((actualMap.get(month) ?? 0) > 0) latestActualIdx = idx;
  });

  return months.map((month, idx) => ({
    month_date: isoMonth(month),
    cumulative_planned_pct: +(planned[idx]?.value ?? 0),
    cumulative_actual_pct: latestActualIdx >= 0 && idx > latestActualIdx ? null : +(actualMap.get(month) ?? 0),
    is_forecast: latestActualIdx >= 0 && idx > latestActualIdx,
  }));
}

function summarizeCurve(packageId: number, packageName: string, points: SCurvePoint[], extras?: Partial<PkgData>): PkgData {
  const todayIdx = points.reduce((acc, point, idx) => point.cumulative_actual_pct != null ? idx : acc, 0);
  const planned = points[todayIdx]?.cumulative_planned_pct ?? 0;
  const actual = points[todayIdx]?.cumulative_actual_pct ?? 0;
  return {
    package_id: packageId,
    package_name: packageName,
    points,
    today_planned_pct: planned,
    today_actual_pct: actual,
    today_variance_pct: +((actual ?? 0) - (planned ?? 0)).toFixed(1),
    forecast_completion_date: extras?.forecast_completion_date ?? null,
    forecast_method: extras?.forecast_method ?? null,
    forecast_confidence_pct: extras?.forecast_confidence_pct ?? null,
    forecast_explainer: extras?.forecast_explainer ?? null,
    baseline_finish_date: extras?.baseline_finish_date ?? null,
  };
}

/* ---------- shared ---------- */
export interface Scheme { scheme_id: number; scheme_name: string; current_status?: string; scheme_type?: string; }
export interface Package { package_id: number; package_no: number; package_name: string; }

export const getSchemes = () =>
  get<Scheme[]>("/schemes/all", MOCK_SCHEMES, (data) => {
    const rows = Array.isArray(data) ? data : Array.isArray(data?.schemes) ? data.schemes : [];
    return rows.map((row: any) => ({
      scheme_id: +(row.scheme_id ?? row.id ?? 0),
      scheme_name: row.scheme_name ?? row.name ?? `Scheme ${row.scheme_id ?? row.id ?? ""}`.trim(),
      current_status: row.current_status ?? row.status,
      scheme_type: normalizeSchemeType(row.scheme_type ?? row.type),
    })).filter((row: Scheme) => row.scheme_id > 0);
  });

export const getPackages = (schemeId: number) =>
  get<Package[]>(`/dpr/scheme/${schemeId}/packages`, MOCK_PACKAGES, (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any, idx: number) => ({
      package_id: +(row.package_id ?? 0),
      package_no: +(row.package_no ?? idx + 1),
      package_name: row.package_name ?? row.plan_name ?? `Package ${idx + 1}`,
    })).filter((row: Package) => row.package_id > 0);
  });

/* ---------- S-curve ---------- */
export interface SCurvePoint { month_date: string; cumulative_planned_pct: number; cumulative_actual_pct: number | null; is_forecast: boolean; }
export interface PkgData {
  package_id: number;
  package_name: string;
  points: SCurvePoint[];
  today_planned_pct: number | null;
  today_actual_pct: number | null;
  today_variance_pct: number | null;
  forecast_completion_date: string | null;
  forecast_method: string | null;
  forecast_confidence_pct: number | null;
  forecast_explainer: string | null;
  baseline_finish_date?: string | null;
}

export const getSCurve = (packageId: number) =>
  get<PkgData>(`/s-curve/package/${packageId}`, MOCK_SCURVE(packageId), (data) => {
    if (Array.isArray(data?.points)) {
      return summarizeCurve(+(data.package_id ?? packageId), data.package_name ?? "", data.points);
    }
    return summarizeCurve(
      +(data?.package_id ?? packageId),
      data?.package_name ?? "",
      normalizeCurvePoints(data?.planned ?? [], data?.actual ?? []),
    );
  });

/* ---------- Plan engine ---------- */
export interface Plan {
  progress_plan_id: number;
  plan_no?: number;
  plan_label?: string;
  plan_status: string;
  is_locked: boolean;
  total_weightage: number;
  weightage_ok: boolean;
}

export interface PlanActivity {
  activity_id: number;
  plan_activity_id?: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  weightage: number;
  contract_start_month?: string;
  expected_completion_month?: string;
}

export interface PlanFull {
  plan: Plan;
  activities: PlanActivity[];
  months?: string[];
  monthly_cells?: Record<string, number>;
  actual_cells?: Record<string, number>;
}

export const getPlans = (packageId: number) =>
  get<Plan[]>(`/plan-engine/packages/${packageId}/plans`, MOCK_PLANS, (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any, idx: number) => ({
      progress_plan_id: +(row.progress_plan_id ?? row.plan_id ?? 0),
      plan_no: +(row.plan_version ?? idx + 1),
      plan_label: row.plan_label ?? row.plan_name ?? `Plan ${row.plan_version ?? idx + 1}`,
      plan_status: String(row.plan_status ?? "draft"),
      is_locked: Boolean(row.is_locked),
      total_weightage: +(row.total_weightage ?? 0),
      weightage_ok: Boolean(row.weightage_ok ?? Math.abs((row.total_weightage ?? 0) - 100) < 0.01),
    }));
  });

export const getPlanFull = (planId: number) =>
  get<PlanFull>(`/plan-engine/plans/${planId}/full`, MOCK_PLAN_FULL, (data) => {
    const header = data?.plan ?? data?.header ?? {};
    const activities = Array.isArray(data?.activities) ? data.activities : [];
    return {
      plan: {
        progress_plan_id: +(header.progress_plan_id ?? header.plan_id ?? planId),
        plan_no: +(header.plan_version ?? 1),
        plan_label: header.plan_label ?? header.plan_name ?? `Plan ${header.plan_version ?? ""}`.trim(),
        plan_status: String(header.plan_status ?? "draft"),
        is_locked: Boolean(header.is_locked),
        total_weightage: +(header.total_weightage ?? activities.reduce((sum: number, row: any) => sum + +(row.weightage ?? row.weight_pct ?? 0), 0)),
        weightage_ok: Boolean(header.weightage_ok ?? true),
      },
      activities: activities.map((row: any) => ({
        activity_id: +(row.activity_id ?? row.plan_activity_id ?? 0),
        plan_activity_id: +(row.plan_activity_id ?? row.activity_id ?? 0),
        activity_name: row.activity_name ?? "Activity",
        uom: row.uom ?? "",
        scope_qty: +(row.scope_qty ?? 0),
        weightage: +(row.weightage ?? row.weight_pct ?? 0),
        contract_start_month: row.contract_start_month ?? row.planned_start_date ?? row.activity_start_date,
        expected_completion_month: row.expected_completion_month ?? row.planned_finish_date ?? row.activity_finish_date,
      })),
      months: Array.isArray(data?.months) ? data.months.map((month: string) => month.slice(0, 7)) : [],
      monthly_cells: data?.monthly_cells ?? {},
      actual_cells: data?.actual_cells ?? {},
    };
  });

export const saveActivities = (planId: number, activities: PlanActivity[]) =>
  send<{ ok: boolean }>("PUT", `/plan-engine/plans/${planId}/activities`, { activities }, { ok: true }, (data) => ({ ok: Boolean(data?.ok ?? true) }));

export const lockPlan = (planId: number, lock: boolean) =>
  send<{ is_locked: boolean }>("POST", `/plan-engine/plans/${planId}/${lock ? "lock" : "unlock"}`, {}, { is_locked: lock }, (data) => ({
    is_locked: Boolean(data?.is_locked ?? lock),
  }));

export const savePlanCells = (planId: number, cells: { plan_activity_id: number; plan_month: string; planned_qty: number }[]) =>
  send<{ saved: number }>("PUT", `/plan-engine/plans/${planId}/cells`, { cells }, { saved: cells.length }, (data) => ({
    saved: +(data?.saved ?? data?.cells_written ?? cells.length),
  }));

export const autoDistribute = (planId: number) =>
  send<{ activities_distributed: number; cells_written: number }>(
    "POST",
    `/plan-engine/plans/${planId}/auto-distribute`,
    {},
    { activities_distributed: MOCK_PLAN_FULL.activities.length, cells_written: MOCK_PLAN_FULL.activities.length * 6 },
  );

/* ---------- CAPEX ---------- */
export interface CapexPlan { capex_plan_id: number; fy_year: string; plan_type: "BE" | "RE"; plan_version: string; is_active: boolean; }
export interface CapexRow { row_id?: number; label: string; months: { be: number; actual: number }[]; }
export interface CapexWorkspace { rows: CapexRow[]; months: string[]; locked_months: number[]; plan_type: string; plan_version: string; note?: string; }

export const FY_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export const getFyOptions = () =>
  get<string[]>("/capex/fy-options", MOCK_FY, (data) => {
    const rows = Array.isArray(data) ? data : Array.isArray(data?.fy_options) ? data.fy_options : [];
    return rows.map((row: string) => fyValue(row)).filter(Boolean);
  });

export const getCapexPlans = (fy: string) =>
  get<CapexPlan[]>(`/capex/plans?fy_year=${encodeURIComponent(fy)}`, MOCK_CAPEX_PLANS(fy), (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any, idx: number) => ({
      capex_plan_id: +(row.capex_plan_id ?? row.id ?? 0),
      fy_year: fyValue(row.fy_year ?? fy),
      plan_type: (row.plan_type ?? "BE") as "BE" | "RE",
      plan_version: row.plan_version ?? `v${idx + 1}`,
      is_active: Boolean(row.is_active ?? row.is_effective ?? idx === 0),
    }));
  });

function normalizeCapexRows(rows: any[]): CapexRow[] {
  return rows.map((row: any) => ({
    row_id: +(row.row_id ?? 0),
    label: row.row_name ?? row.label ?? "Row",
    months: FY_MONTHS.map((_label, idx) => {
      const monthNo = idx + 1;
      const cell = row.months?.[String(monthNo)] ?? row.months?.[monthNo] ?? row.months?.[idx] ?? {};
      return { be: +(cell.be ?? 0), actual: +(cell.actual ?? 0) };
    }),
  }));
}

export const getCapexActuals = (fy: string) =>
  get<{ rows: CapexRow[]; months: string[] }>(`/capex/actuals?fy_year=${encodeURIComponent(fy)}`, MOCK_CAPEX_DATA, (data) => ({
    months: FY_MONTHS,
    rows: Array.isArray(data?.rows) ? normalizeCapexRows(data.rows) : cloneMock(MOCK_CAPEX_DATA.rows),
  }));

export const getCapexWorkspace = (fy: string) =>
  get<CapexWorkspace>(`/capex/actuals?fy_year=${encodeURIComponent(fy)}`, {
    ...MOCK_CAPEX_DATA,
    locked_months: [1, 2],
    plan_type: "RE",
    plan_version: "Revised Plan",
    note: "Months before the effective month auto-fill from actuals.",
  }, (data) => ({
    months: FY_MONTHS,
    rows: Array.isArray(data?.rows) ? normalizeCapexRows(data.rows) : cloneMock(MOCK_CAPEX_DATA.rows),
    locked_months: Array.isArray(data?.locked_months) ? data.locked_months.map((row: any) => +row) : [1, 2],
    plan_type: data?.plan_type ?? "RE",
    plan_version: data?.plan_version ?? "Revised Plan",
    note: data?.note ?? "Months before the effective month auto-fill from actuals.",
  }));

export const saveCapexCell = (fy: string, rowId: number, monthNo: number, actual: number) =>
  send<{ ok: boolean }>("PUT", `/capex/actuals/cell`, { fy_year: fy, plan_row_id: rowId, month_no: monthNo, amount: actual }, { ok: true }, () => ({ ok: true }));

export const lockCapexMonth = (fy: string, monthNo: number) =>
  send<{ locked: boolean }>("POST", `/capex/locks`, { fy_year: fy, month_no: monthNo }, { locked: true }, () => ({ locked: true }));

export const unlockCapexMonth = (fy: string, monthNo: number) =>
  send<{ locked: boolean }>("DELETE", `/capex/locks/${encodeURIComponent(fy)}/${monthNo}`, null, { locked: false }, () => ({ locked: false }));

/* ---------- DPR ---------- */
export interface DprActivity {
  activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  planned_qty: number;
  actual_qty: number;
  progress_pct: number;
  entered_via?: "app" | "dpr" | "web" | null;
}

export interface DprDailyActivity {
  activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  actual_qty: number;
  remarks: string;
  entered_via?: "app" | "dpr" | "web" | null;
}

export const getDprActivities = (packageId: number) =>
  get<DprActivity[]>(`/dpr/packages/${packageId}/activities`, MOCK_DPR, (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any) => ({
      activity_id: +(row.activity_id ?? 0),
      activity_name: row.activity_name ?? "Activity",
      uom: row.uom ?? "",
      scope_qty: +(row.scope_qty ?? 0),
      planned_qty: +(row.month_plan ?? row.planned_qty ?? 0),
      actual_qty: +(row.month_actual ?? row.actual_qty ?? 0),
      progress_pct: +(row.progress_pct ?? 0),
      entered_via: row.entered_via ?? null,
    }));
  });

export const getDprSummary = (packageId: number, month: string) =>
  get<{ planned_pct: number; actual_pct: number; variance_pct: number; entries: number }>(
    `/dpr/summary/${packageId}?month=${month}`,
    { planned_pct: 78, actual_pct: 52, variance_pct: -26, entries: 7 },
    (data) => {
      const rows = Array.isArray(data) ? data : [];
      const totals = rows.reduce((acc: any, row: any) => {
        acc.scope += +(row.scope_qty ?? 0);
        acc.plan += +(row.month_plan ?? row.planned_qty ?? 0);
        acc.actual += +(row.month_actual ?? row.actual_qty ?? 0);
        acc.entries += +(row.month_actual ?? row.actual_qty ?? 0) > 0 ? 1 : 0;
        return acc;
      }, { scope: 0, plan: 0, actual: 0, entries: 0 });
      const plannedPct = totals.scope ? +(totals.plan / totals.scope * 100).toFixed(1) : 0;
      const actualPct = totals.scope ? +(totals.actual / totals.scope * 100).toFixed(1) : 0;
      return {
        planned_pct: plannedPct,
        actual_pct: actualPct,
        variance_pct: +(actualPct - plannedPct).toFixed(1),
        entries: totals.entries,
      };
    },
  );

export const saveDprActual = (packageId: number, activityId: number, qty: number, month: string) =>
  send<{ ok: boolean }>("POST", `/dpr/actuals`, {
    package_id: packageId,
    entries: [{ activity_id: activityId, actual_date: `${month}-01`, actual_qty: qty, entered_via: "web" }],
  }, { ok: true }, () => ({ ok: true }));

export const getDprByDate = (packageId: number, date: string) =>
  get<DprDailyActivity[]>(
    `/dpr/actuals/${packageId}/date/${date}`,
    MOCK_DPR.map((row) => ({
      activity_id: row.activity_id,
      activity_name: row.activity_name,
      uom: row.uom,
      scope_qty: row.scope_qty,
      actual_qty: 0,
      remarks: "",
      entered_via: row.entered_via,
    })),
    (data) => {
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row: any) => ({
        activity_id: +(row.activity_id ?? 0),
        activity_name: row.activity_name ?? "Activity",
        uom: row.uom ?? "",
        scope_qty: +(row.scope_qty ?? 0),
        actual_qty: +(row.actual_qty ?? 0),
        remarks: row.remarks ?? "",
        entered_via: row.entered_via ?? null,
      }));
    },
  );

export const saveDprDaily = (p: { package_id: number; activity_id: number; actual_date: string; actual_qty: number; remarks: string | null }) =>
  send<{ ok: boolean }>("POST", `/dpr/actuals`, {
    package_id: p.package_id,
    entries: [{ activity_id: p.activity_id, actual_date: p.actual_date, actual_qty: p.actual_qty, remarks: p.remarks, entered_via: "web" }],
  }, { ok: true }, () => ({ ok: true }));

/* ---------- Reports ---------- */
export interface ReportDef { id: string; group: string; name: string; desc: string; path: string; }

export const REPORTS: ReportDef[] = [
  { id: "mos-capex", group: "Corporate Office", name: "MoS CAPEX", desc: "Monthly CAPEX overview.", path: "/reports/table?id=mos-capex" },
  { id: "phys-fin", group: "Corporate Office", name: "Physical & Financial Progress", desc: "CAPEX projects physical + financial progress.", path: "/reports/table?id=phys-fin" },
  { id: "capex-pmc", group: "Corporate Office", name: "CAPEX PMC Report", desc: "Project Monitoring Cell CAPEX report.", path: "/reports/table?id=capex-pmc" },
  { id: "pmc-phys", group: "PMC", name: "Physical Progress PMC", desc: "Project-wise PMC physical + financial progress.", path: "/reports/table?id=pmc-phys" },
  { id: "s-curve", group: "Progress", name: "S-Curve Report", desc: "Plan vs actual cumulative curve with forecast.", path: "/reports/s-curve" },
  { id: "dpr", group: "Progress", name: "DPR Summary", desc: "Daily progress entries, package-wise.", path: "/reports/dpr" },
  { id: "package-n", group: "Progress", name: "Package-N Report", desc: "Per-package consolidated PDF.", path: "/reports/package-n" },
];

export const getSchemeCurve = (schemeId: number) =>
  get<PkgCurve[]>(`/s-curve/${schemeId}/packages`, MOCK_SCHEME_CURVE(), (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any) => ({
      package_id: +(row.package_id ?? 0),
      package_name: row.package_name ?? "Package",
      weight: +(row.weight ?? 1),
      points: Array.isArray(row.points) ? row.points.map((point: any) => ({
        month_date: isoMonth(point.month_date ?? point.month ?? ""),
        cumulative_planned_pct: +(point.cumulative_planned_pct ?? point.value ?? 0),
        cumulative_actual_pct: point.cumulative_actual_pct == null ? null : +(point.cumulative_actual_pct ?? 0),
        is_forecast: Boolean(point.is_forecast),
      })) : [],
    }));
  });

export const getCapexProjects = (fy: string) =>
  get<CapexProjInput[]>(`/capex/projects?fy_year=${encodeURIComponent(fy)}`, MOCK_CAPEX_PROJECTS, (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any) => ({
      project_id: +(row.project_id ?? row.scheme_id ?? 0),
      label: row.label ?? row.scheme_name ?? `Project ${row.project_id ?? row.scheme_id ?? ""}`.trim(),
      bucket: row.bucket === "Corporate AMR" ? "Corporate AMR" : "Plant Level AMR",
      gross_cost: +(row.gross_cost ?? 0),
      expenditure_last_fy: +(row.expenditure_last_fy ?? 0),
      months: Array.isArray(row.months) ? row.months.map((month: any) => ({
        be: +(month.be ?? 0),
        actual: +(month.actual ?? 0),
        re: month.re == null ? null : +(month.re ?? 0),
      })) : [],
    }));
  });

/* ---------- DPR analysis ---------- */
export type DprSource = "daily" | "upload" | "ai";

export interface DprDerived {
  activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  prev_actual: number;
  derived_qty: number;
  confidence: number;
  source: DprSource;
  matched: string;
  frozen?: boolean;
}

export const getDprDaily = (packageId: number, month: string) =>
  get<{ activity_id: number; actual_date: string; actual_qty: number }[]>(`/dpr/actuals/${packageId}?month=${month}`, MOCK_DAILY(month));

export const analyzeDpr = (packageId: number, month: string, source: DprSource, payload?: string) =>
  send<DprDerived[]>("POST", `/dpr/analyze`, { package_id: packageId, month, source, payload }, MOCK_DERIVED(source));

export const applyDprActuals = (packageId: number, month: string, rows: { activity_id: number; actual_qty: number }[]) =>
  send<{ applied: number }>("POST", `/dpr/actuals/apply`, { package_id: packageId, month, rows }, { applied: rows.length });

export const freezeDprMonth = (packageId: number, month: string) =>
  send<{ frozen: boolean }>("POST", `/dpr/freeze`, { package_id: packageId, month }, { frozen: true });

/* ---------- approvals ---------- */
export type StageKey = "formulation" | "stage1" | "tendering" | "stage2";

export interface StageEntry {
  id: number;
  revision_no: number;
  revision_label: string;
  is_current: boolean;
  fields: Record<string, string | number | null>;
  remarks: string;
}

export interface SchemeApprovals {
  scheme_id: number;
  current_status: string;
  stages: Record<StageKey, StageEntry[]>;
}

export const STATUS_ORDER = ["under_formulation", "under_stage1", "under_tendering", "under_stage2", "ongoing", "completed"];
export const STATUS_LABEL: Record<string, string> = {
  under_formulation: "Formulation",
  under_stage1: "Stage-1",
  under_tendering: "Tendering",
  under_stage2: "Stage-2",
  ongoing: "Execution",
  completed: "Completed",
  on_hold: "On hold",
};

export const getSchemeApprovals = (schemeId: number) =>
  get<SchemeApprovals>(`/schemes/${schemeId}/approvals`, MOCK_APPROVALS(schemeId));

export const addStageRevision = (schemeId: number, stage: StageKey, payload: { fields: Record<string, unknown>; remarks: string; revision_label: string }) =>
  send<{ id: number }>("POST", `/schemes/${schemeId}/approvals/${stage}`, payload, { id: Math.floor(Math.random() * 1e6) });

export const changeStage = (schemeId: number, new_status: string, remark: string) =>
  send<{ current_status: string }>("POST", `/schemes/${schemeId}/change-stage`, { new_status, remark }, { current_status: new_status });

/* ---------- Dashboard ---------- */
export interface DashSummary {
  total_schemes: number;
  total_cost_cr: number;
  current_fy: string;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  delay_summary: { on_time: number; minor: number; moderate: number; critical: number };
}

export interface SchemeCard {
  scheme_id: number;
  scheme_name: string;
  scheme_type: string;
  current_status: string;
  total_cost_cr: number;
  actual_cr: number;
  achievement_pct: number;
  delay: { delay_months: number; delay_category: "on_time" | "minor" | "moderate" | "critical" };
  schedule_finish?: string | null;
}

export const getDashSummary = (fy?: string) =>
  get<DashSummary>(`/dashboard/summary${fy ? `?fy=${fy}` : ""}`, MOCK_SUMMARY, (data) => {
    const byType = Object.entries(data?.by_type ?? {}).reduce<Record<string, number>>((acc, [key, value]) => {
      const normalized = normalizeSchemeType(key);
      acc[normalized] = (acc[normalized] ?? 0) + +(value ?? 0);
      return acc;
    }, {});
    return {
      total_schemes: +(data?.total_schemes ?? 0),
      total_cost_cr: +(data?.total_cost_cr ?? 0),
      current_fy: fyValue(data?.current_fy ?? fy ?? MOCK_SUMMARY.current_fy),
      by_status: data?.by_status ?? {},
      by_type: byType,
      delay_summary: data?.delay_summary ?? MOCK_SUMMARY.delay_summary,
    };
  });

export const getSchemeCards = (fy?: string) =>
  get<SchemeCard[]>(`/dashboard/scheme-cards${fy ? `?fy=${fy}` : ""}`, MOCK_CARDS, (data) => {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any) => ({
      scheme_id: +(row.scheme_id ?? row.id ?? 0),
      scheme_name: row.scheme_name ?? row.name ?? "Scheme",
      scheme_type: normalizeSchemeType(row.scheme_type ?? row.type),
      current_status: row.current_status ?? row.status ?? "under_formulation",
      total_cost_cr: +(row.total_cost_cr ?? row.cost_cr ?? row.estimated_cost_cr ?? 0),
      actual_cr: +(row.actual_cr ?? 0),
      achievement_pct: +(row.achievement_pct ?? 0),
      delay: {
        delay_months: +(row.delay?.delay_months ?? 0),
        delay_category: (row.delay?.delay_category ?? "on_time") as "on_time" | "minor" | "moderate" | "critical",
      },
      schedule_finish: row.schedule_finish ?? row.scheduled_completion ?? null,
    }));
  });

/* ===================== MOCKS ===================== */
const MOCK_SCHEMES: Scheme[] = [
  { scheme_id: 1, scheme_name: "Coke Oven Battery #7 Rebuild", current_status: "ongoing", scheme_type: "Corporate AMR" },
  { scheme_id: 2, scheme_name: "New Plate Mill (5m)", current_status: "ongoing", scheme_type: "Corporate AMR" },
  { scheme_id: 3, scheme_name: "Blast Furnace #5 Upgradation", current_status: "under_tendering", scheme_type: "Corporate AMR" },
];

const MOCK_PACKAGES: Package[] = [
  { package_id: 11, package_no: 1, package_name: "Civil & Structural" },
  { package_id: 12, package_no: 2, package_name: "Mechanical" },
  { package_id: 13, package_no: 3, package_name: "Electrical & Instrumentation" },
];

function MOCK_SCURVE(packageId: number): PkgData {
  const months = ["2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07"];
  const planned = [2, 6, 13, 24, 38, 53, 67, 78, 86, 92, 96, 98, 99, 100, 100, 100];
  const actual = [2, 4, 9, 16, 25, 34, 44, 52];
  const forecast = [52, 59.2, 66.4, 73.6, 80.8, 88, 95.2, 100];
  const points: SCurvePoint[] = months.map((month, idx) => ({
    month_date: `${month}-01`,
    cumulative_planned_pct: planned[idx],
    cumulative_actual_pct: idx < actual.length ? actual[idx] : null,
    is_forecast: false,
  }));
  for (let idx = 7; idx <= 14; idx += 1) {
    points[idx] = {
      month_date: `${months[idx]}-01`,
      cumulative_planned_pct: planned[idx],
      cumulative_actual_pct: forecast[idx - 7],
      is_forecast: idx > 7,
    };
  }
  return {
    package_id: packageId,
    package_name: "Civil & Structural",
    points,
    today_planned_pct: 78,
    today_actual_pct: 52,
    today_variance_pct: -26,
    forecast_completion_date: "2026-06-30",
    forecast_method: "linear regression",
    forecast_confidence_pct: 74,
    forecast_explainer: "Projected from the last 8 months.",
    baseline_finish_date: "2026-05-31",
  };
}

const MOCK_PLANS: Plan[] = [
  { progress_plan_id: 101, plan_no: 2, plan_label: "Plan v2 (Original)", plan_status: "draft", is_locked: false, total_weightage: 100, weightage_ok: true },
  { progress_plan_id: 100, plan_no: 1, plan_label: "Plan v1 (Superseded)", plan_status: "locked", is_locked: true, total_weightage: 100, weightage_ok: true },
];

const PLAN_MONTHS = ["2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03"];

const RAW_ACTS = [
  { activity_id: 1, activity_name: "Site clearance & enabling works", uom: "Lot", scope_qty: 1, weightage: 6, s: 0, e: 1 },
  { activity_id: 2, activity_name: "Civil foundation & pile cap", uom: "Cum", scope_qty: 4200, weightage: 18, s: 1, e: 4 },
  { activity_id: 3, activity_name: "Structural steel erection", uom: "MT", scope_qty: 3100, weightage: 22, s: 3, e: 7 },
  { activity_id: 4, activity_name: "Refractory lining", uom: "Sqm", scope_qty: 1800, weightage: 14, s: 5, e: 8 },
  { activity_id: 5, activity_name: "Mechanical equipment install", uom: "Nos", scope_qty: 46, weightage: 20, s: 6, e: 10 },
  { activity_id: 6, activity_name: "Electrical & instrumentation", uom: "Lot", scope_qty: 1, weightage: 12, s: 8, e: 11 },
  { activity_id: 7, activity_name: "Testing & commissioning", uom: "Lot", scope_qty: 1, weightage: 8, s: 10, e: 11 },
];

function buildCells(actualThroughIdx = 7) {
  const planned: Record<string, number> = {};
  const actual: Record<string, number> = {};
  RAW_ACTS.forEach((row) => {
    const span = row.e - row.s + 1;
    const perMonth = row.scope_qty / span;
    for (let idx = row.s; idx <= row.e; idx += 1) {
      const month = PLAN_MONTHS[idx];
      if (!month) continue;
      planned[`${row.activity_id}|${month}`] = Math.round(perMonth * 100) / 100;
      if (idx <= actualThroughIdx) actual[`${row.activity_id}|${month}`] = Math.round(perMonth * 0.78 * 100) / 100;
    }
  });
  return { planned, actual };
}

const MOCK_CELLS = buildCells();

const MOCK_PLAN_FULL: PlanFull = {
  plan: MOCK_PLANS[0],
  months: PLAN_MONTHS,
  monthly_cells: MOCK_CELLS.planned,
  actual_cells: MOCK_CELLS.actual,
  activities: RAW_ACTS.map((row) => ({
    activity_id: row.activity_id,
    plan_activity_id: row.activity_id,
    activity_name: row.activity_name,
    uom: row.uom,
    scope_qty: row.scope_qty,
    weightage: row.weightage,
    contract_start_month: PLAN_MONTHS[row.s],
    expected_completion_month: PLAN_MONTHS[row.e],
  })),
};

const MOCK_FY = ["2026-2027", "2025-2026", "2024-2025"];

function MOCK_CAPEX_PLANS(fy: string): CapexPlan[] {
  return [
    { capex_plan_id: 1, fy_year: fy, plan_type: "BE", plan_version: "Original Plan", is_active: true },
    { capex_plan_id: 2, fy_year: fy, plan_type: "RE", plan_version: "Revised Plan", is_active: false },
  ];
}

const MOCK_CAPEX_DATA = {
  months: FY_MONTHS,
  rows: [
    { row_id: 1, label: "COB-7", months: [125,180,140,150,140,195,175,175,175,225,220,250].map((be, idx) => ({ be, actual: idx < 2 ? [265,299][idx] : 0 })) },
    { row_id: 2, label: "New Plate Mill", months: [90,120,110,140,160,180,200,210,220,240,250,260].map((be) => ({ be, actual: Math.round(be * 0.7) })) },
  ] as CapexRow[],
};

const MOCK_DPR: DprActivity[] = MOCK_PLAN_FULL.activities.map((row, idx) => ({
  activity_id: row.activity_id,
  activity_name: row.activity_name,
  uom: row.uom,
  scope_qty: row.scope_qty,
  planned_qty: Math.round(row.scope_qty * [0.9, 0.8, 0.6, 0.4, 0.3, 0.2, 0][idx]),
  actual_qty: Math.round(row.scope_qty * [0.85, 0.7, 0.45, 0.25, 0.15, 0.05, 0][idx]),
  progress_pct: [88, 72, 46, 25, 14, 5, 0][idx],
  entered_via: (["dpr", "app", "app", "dpr", "app", "dpr", "app"] as const)[idx],
}));

function MOCK_SCHEME_CURVE(): PkgCurve[] {
  const months = ["2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07"];
  const make = (planned: number[], actual: number[]) => months.map((month, idx) => ({
    month_date: `${month}-01`,
    cumulative_planned_pct: planned[idx],
    cumulative_actual_pct: idx < actual.length ? actual[idx] : null,
    is_forecast: idx >= actual.length,
  }));
  return [
    { package_id: 11, package_name: "Civil & Structural", weight: 40, points: make([3,9,18,30,44,58,70,80,87,92,96,98,99,100,100,100], [3,7,14,24,36,47,57,66]) },
    { package_id: 12, package_name: "Mechanical", weight: 35, points: make([1,3,8,16,27,40,53,64,74,82,89,94,97,99,100,100], [1,2,5,11,19,28,37,45]) },
    { package_id: 13, package_name: "Electrical & Instrumentation", weight: 25, points: make([0,1,3,7,13,22,33,45,57,68,78,87,93,97,99,100], [0,1,2,4,8,14,21,29]) },
  ];
}

const MOCK_CAPEX_PROJECTS: CapexProjInput[] = [
  {
    project_id: 1,
    label: "COB-7 · Coke Oven Battery #7",
    bucket: "Corporate AMR",
    gross_cost: 2840,
    expenditure_last_fy: 1180,
    months: [125,180,140,150,140,195,175,175,175,225,220,250].map((be, idx) => ({ be, actual: idx < 3 ? [120,165,150][idx] : 0, re: idx >= 3 ? Math.round(be * 0.9) : null })),
  },
  {
    project_id: 2,
    label: "New Plate Mill (5m)",
    bucket: "Corporate AMR",
    gross_cost: 6120,
    expenditure_last_fy: 3200,
    months: [90,120,110,140,160,180,200,210,220,240,250,260].map((be, idx) => ({ be, actual: idx < 3 ? [85,110,100][idx] : 0, re: idx >= 3 ? Math.round(be * 1.05) : null })),
  },
  {
    project_id: 3,
    label: "Sinter Plant III",
    bucket: "Plant Level AMR",
    gross_cost: 1740,
    expenditure_last_fy: 210,
    months: [40,55,60,70,80,90,95,100,100,110,110,120].map((be, idx) => ({ be, actual: idx < 3 ? [42,56,61][idx] : 0, re: null })),
  },
];

function MOCK_DAILY(month: string) {
  const out: { activity_id: number; actual_date: string; actual_qty: number }[] = [];
  MOCK_DPR.forEach((row, idx) => {
    for (let day = 1; day <= 6; day += 1) {
      out.push({
        activity_id: row.activity_id,
        actual_date: `${month}-${String(day * 4).padStart(2, "0")}`,
        actual_qty: Math.round((row.scope_qty * [0.02, 0.015, 0.01, 0.008, 0.005, 0, 0][idx]) || 0),
      });
    }
  });
  return out;
}

function MOCK_DERIVED(source: DprSource): DprDerived[] {
  return MOCK_DPR.map((row, idx) => ({
    activity_id: row.activity_id,
    activity_name: row.activity_name,
    uom: row.uom,
    scope_qty: row.scope_qty,
    prev_actual: Math.round(row.scope_qty * [0.7, 0.55, 0.35, 0.18, 0.1, 0.02, 0][idx]),
    derived_qty: Math.round(row.scope_qty * [0.08, 0.07, 0.06, 0.04, 0.03, 0.02, 0][idx]),
    confidence: source === "ai"
      ? [0.92, 0.88, 0.81, 0.74, 0.7, 0.6, 0.5][idx]
      : source === "upload"
        ? [0.99, 0.97, 0.95, 0.9, 0.85, 0.8, 0.7][idx]
        : 1,
    source,
    matched: source === "daily"
      ? "6 daily entries"
      : source === "upload"
        ? `row ${idx + 3} of sheet Progress`
        : `"${row.activity_name.split(" ")[0]}" + qty token`,
  }));
}

function MOCK_APPROVALS(schemeId: number): SchemeApprovals {
  return {
    scheme_id: schemeId,
    current_status: "under_stage2",
    stages: {
      formulation: [
        {
          id: 1,
          revision_no: 0,
          revision_label: "R0",
          is_current: false,
          remarks: "Initial DPR by MECON.",
          fields: {
            consultant_name: "MECON Ltd",
            consultant_acceptance_date: "2024-04-12",
            draft_fr_ts_date: "2024-06-20",
            final_fr_ts_ce_ec_date: "2024-08-05",
            pre_nit_meeting_date: "2024-08-22",
            plant_pag_meeting_date: "2024-09-10",
            dic_approval_date: "2024-09-28",
            forwarded_to_corporate_date: "2024-10-05",
            cost_gross_cr: 2710,
          },
        },
        {
          id: 2,
          revision_no: 1,
          revision_label: "R1",
          is_current: true,
          remarks: "Cost revised after scope addition.",
          fields: {
            consultant_name: "MECON Ltd",
            final_fr_ts_ce_ec_date: "2024-11-15",
            dic_approval_date: "2024-12-02",
            forwarded_to_corporate_date: "2024-12-08",
            cost_gross_cr: 2840,
          },
        },
      ],
      stage1: [
        {
          id: 3,
          revision_no: 0,
          revision_label: "R0",
          is_current: true,
          remarks: "Board approved with conditions.",
          fields: {
            cod_date: "2025-01-10",
            independent_financial_appraisal_date: "2025-01-25",
            corporate_pag_date: "2025-02-08",
            chairman_approval_date: "2025-02-20",
            pcsb_date: "2025-03-04",
            sail_board_date: "2025-03-18",
            sanction_date: "2025-03-28",
            order_date: "2025-04-05",
            cost_gross_cr: 2840,
            implementation_period_months: 30,
          },
        },
      ],
      tendering: [
        {
          id: 4,
          revision_no: 0,
          revision_label: "Cycle-1",
          is_current: false,
          remarks: "Single offer, retendered.",
          fields: {
            nit_number: "RSP/COB7/2025/01",
            pr_initiation_date: "2025-04-15",
            pr_approval_date: "2025-04-28",
            nit_date: "2025-05-10",
            pre_bid_date: "2025-05-24",
            tod_original_date: "2025-06-14",
            offers_received_count: 1,
            estimated_value_cr: 1850,
            cancellation_date: "2025-06-30",
          },
        },
        {
          id: 5,
          revision_no: 1,
          revision_label: "Cycle-2",
          is_current: true,
          remarks: "3 offers, under evaluation.",
          fields: {
            nit_number: "RSP/COB7/2025/02",
            nit_date: "2025-07-08",
            pre_bid_date: "2025-07-22",
            tod_original_date: "2025-08-12",
            offers_received_count: 3,
            estimated_value_cr: 1850,
            awarded_value_cr: 1792,
          },
        },
      ],
      stage2: [
        {
          id: 6,
          revision_no: 0,
          revision_label: "R0",
          is_current: true,
          remarks: "Firmed-up cost within Stage-1 +3%.",
          fields: {
            draft_board_note_date: "2025-09-05",
            proposal_to_co_date: "2025-09-18",
            pag_date: "2025-10-02",
            chairman_approval_date: "2025-10-16",
            pcsb_date: "2025-10-28",
            empowered_committee_date: "2025-11-08",
            sanction_date: "2025-11-20",
            order_date: "2025-11-28",
            cod_date: "2025-12-01",
            firmed_up_cost_gross_cr: 2925,
            variance_vs_stage1_pct: 3,
          },
        },
      ],
    },
  };
}

const MOCK_SUMMARY: DashSummary = {
  total_schemes: 50,
  total_cost_cr: 5763.87,
  current_fy: "2026-2027",
  by_status: { under_formulation: 6, under_stage1: 8, under_tendering: 7, under_stage2: 9, ongoing: 14, completed: 6 },
  by_type: { "Corporate AMR": 10, "Plant Level AMR": 40 },
  delay_summary: { on_time: 35, minor: 6, moderate: 5, critical: 4 },
};

const MOCK_CARDS: SchemeCard[] = [
  { scheme_id: 1, scheme_name: "Coke Oven Battery #7 Rebuild", scheme_type: "Corporate AMR", current_status: "under_stage2", total_cost_cr: 2840, actual_cr: 1612, achievement_pct: 62, delay: { delay_months: 18, delay_category: "critical" }, schedule_finish: "2026-05-31" },
  { scheme_id: 2, scheme_name: "New Plate Mill (5m)", scheme_type: "Corporate AMR", current_status: "ongoing", total_cost_cr: 6120, actual_cr: 3890, achievement_pct: 71, delay: { delay_months: 7, delay_category: "moderate" }, schedule_finish: "2026-09-30" },
  { scheme_id: 3, scheme_name: "Sinter Plant III Modernisation", scheme_type: "Plant Level AMR", current_status: "ongoing", total_cost_cr: 1740, actual_cr: 1530, achievement_pct: 89, delay: { delay_months: 0, delay_category: "on_time" }, schedule_finish: "2026-07-31" },
  { scheme_id: 4, scheme_name: "Blast Furnace #5 Upgradation", scheme_type: "Corporate AMR", current_status: "under_tendering", total_cost_cr: 3960, actual_cr: 240, achievement_pct: 9, delay: { delay_months: 3, delay_category: "minor" }, schedule_finish: "2027-03-31" },
  { scheme_id: 5, scheme_name: "Captive Power Plant Phase II", scheme_type: "Corporate AMR", current_status: "under_stage2", total_cost_cr: 4500, actual_cr: 520, achievement_pct: 12, delay: { delay_months: 14, delay_category: "critical" }, schedule_finish: "2026-08-31" },
  { scheme_id: 6, scheme_name: "Pellet Plant #2", scheme_type: "Corporate AMR", current_status: "ongoing", total_cost_cr: 3380, actual_cr: 2030, achievement_pct: 60, delay: { delay_months: 5, delay_category: "moderate" }, schedule_finish: "2026-06-30" },
];
