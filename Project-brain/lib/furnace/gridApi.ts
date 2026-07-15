"use client";
// gridApi.ts — data layer for CapexGrid v2 / Command Dashboard v2 / Reports Hub v2.
// Self-contained (does not touch api.ts). Live endpoints with rich mock fallback,
// so every module demos fully offline and hydrates live when NEXT_PUBLIC_PB_MOCK=0.

export const API_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE) || "http://127.0.0.1:8000/api/v1";
export const MOCK =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_PB_MOCK === "1";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function live(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, init);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}
async function get<T>(path: string, mock: T, norm?: (d: any) => T): Promise<T> {
  if (MOCK) return clone(mock);
  try { const d = await live(path); return norm ? norm(d) : (d as T); } catch { return clone(mock); }
}
async function send<T>(method: string, path: string, body: unknown, mock: T): Promise<T> {
  if (MOCK) return clone(mock);
  try {
    return (await live(path, { method, headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) })) as T;
  } catch (e) { throw e; }
}

// ---------------------------------------------------------------- CAPEX GRID
export const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
export const QUARTERS: { key: string; months: number[] }[] = [
  { key: "Q1", months: [1, 2, 3] }, { key: "Q2", months: [4, 5, 6] },
  { key: "Q3", months: [7, 8, 9] }, { key: "Q4", months: [10, 11, 12] },
];
const calendarToFiscal = (month: number) => ((month + 8) % 12) + 1;
const fiscalToCalendar = (month: number) => ((month + 2) % 12) + 1;
export interface GridMonthCell { be: number; re: number; actual: number; }
export interface GridRow {
  row_id: number; name: string; indent: number; level: "Header" | "SubHeader" | "Item" | "Package";
  gross: number; cum_last_fy: number; be_fy: number; re_fy: number;
  months: Record<string, GridMonthCell>; // "1".."12" (Apr=1)
}
export interface GridPlanRef { id: number; fy: string; type: "BE" | "RE"; version: string; status: string; effMonth: number | null; }
export interface GridPlan extends GridPlanRef { rows: GridRow[]; lockedMonths: number[]; }

const normRow = (r: any): GridRow => ({
  row_id: +(r.row_id ?? r.id ?? 0),
  name: String(r.name ?? r.row_name ?? ""),
  indent: +(r.indent ?? r.indent_level ?? 0),
  level: (r.level ?? r.row_level ?? "Item") as GridRow["level"],
  gross: +(r.gross ?? r.gross_cost ?? 0),
  cum_last_fy: +(r.cum_last_fy ?? r.cumulative_exp_till_last_fy ?? 0),
  be_fy: +(r.be_fy ?? 0), re_fy: +(r.re_fy ?? 0),
  months: Object.fromEntries(Object.entries(r.months ?? {}).map(([k, v]: [string, any]) => [String(calendarToFiscal(+k)), {
    be: +(v?.be ?? 0), re: +(v?.re ?? 0), actual: +(v?.actual ?? 0),
  }])),
});
const normPlanRef = (p: any): GridPlanRef => ({
  id: +(p.id ?? p.plan_id ?? 0), fy: String(p.fy ?? p.fy_year ?? ""),
  type: (String(p.type ?? p.plan_type ?? "BE").toUpperCase() === "RE" ? "RE" : "BE"),
  version: String(p.version ?? p.plan_version ?? "v1"),
  status: String(p.status ?? p.plan_status ?? "Draft"),
  effMonth: (p.effMonth ?? p.effective_from_month) == null ? null : calendarToFiscal(+(p.effMonth ?? p.effective_from_month)),
});

function mockRows(): GridRow[] {
  let id = 0; const nid = () => ++id;
  const M = (b: number[], a: number[], reFrom = 7): Record<string, GridMonthCell> =>
    Object.fromEntries(FY_MONTHS.map((_, i) => [String(i + 1), {
      be: b[i] ?? 0, re: i + 1 >= reFrom ? Math.round((b[i] ?? 0) * 1.08 * 100) / 100 : 0, actual: a[i] ?? 0,
    }]));
  const spread = (t: number, upto = 12) => FY_MONTHS.map((_, i) => (i < upto ? Math.round((t / upto) * 100) / 100 : 0));
  const rows: GridRow[] = [];
  const H = (name: string): GridRow => ({ row_id: nid(), name, indent: 0, level: "Header", gross: 0, cum_last_fy: 0, be_fy: 0, re_fy: 0, months: {} });
  const S = (name: string): GridRow => ({ ...H(name), row_id: nid(), indent: 1, level: "SubHeader" });
  const I = (name: string, gross: number, cum: number, be: number, actMonths: number, indent = 2): GridRow => ({
    row_id: nid(), name, indent, level: "Item", gross, cum_last_fy: cum, be_fy: be, re_fy: Math.round(be * 1.08 * 100) / 100,
    months: M(spread(be), spread(be * 0.92, actMonths).map((v, i) => (i < actMonths ? v : 0))),
  });
  rows.push(H("Coke Ovens & By-Products"));
  rows.push(S("COB-7 Rebuilding (₹4,789 Cr)"));
  rows.push(I("Pkg-74 · Battery Proper & Refractories", 2600, 610, 480, 3));
  rows.push(I("Pkg-75 · Coal Handling & Charging", 1250, 240, 210, 3));
  rows.push(I("Pkg-76 · By-Product Plant Revamp", 939, 110, 145, 2));
  rows.push(H("Sinter Plant"));
  rows.push(S("SP-3 Augmentation"));
  rows.push(I("Sinter Machine Upgrade", 820, 205, 160, 3));
  rows.push(I("ESP & Waste-Gas Circuit", 310, 45, 78, 2));
  rows.push(H("Blast Furnace"));
  rows.push(S("BF-5 Capital Repair Cat-II"));
  rows.push(I("Refractory & Cooling Elements", 640, 92, 130, 3));
  rows.push(I("Top Charging System", 405, 30, 88, 1));
  rows.push(H("Mills & Finishing"));
  rows.push(S("Plate Mill Modernisation"));
  rows.push(I("Reheating Furnace-3", 512, 140, 96, 3));
  rows.push(I("Level-2 Automation", 148, 12, 44, 2));
  return rows;
}
const MOCK_PLANS: GridPlan[] = [
  { id: 1, fy: "2026-27", type: "BE", version: "Original Plan", status: "Approved", effMonth: null, rows: mockRows(), lockedMonths: [1, 2] },
  { id: 2, fy: "2026-27", type: "RE", version: "Revision 1", status: "Draft", effMonth: 7, rows: mockRows(), lockedMonths: [1, 2] },
];

export const getGridFyOptions = () =>
  get<string[]>("/capex/fy-options", ["2026-27", "2025-26"], (d) => (Array.isArray(d) ? d.map(String) : Array.isArray(d?.fy_options) ? d.fy_options.map(String) : ["2026-27"]));

export const getGridPlans = (fy: string) =>
  get<GridPlanRef[]>(`/capex/plans?fy_year=${encodeURIComponent(fy)}`, MOCK_PLANS.map(({ rows, lockedMonths, ...p }) => p), (d) =>
    (Array.isArray(d) ? d : d?.plans ?? []).map(normPlanRef));

export const getGridPlan = (planId: number) =>
  get<GridPlan>(`/capex/plans/${planId}`, MOCK_PLANS.find((p) => p.id === planId) ?? MOCK_PLANS[0], (d) => ({
    ...normPlanRef(d), rows: (d.rows ?? []).map(normRow),
    lockedMonths: (d.locked_months ?? d.lockedMonths ?? []).map((month: number) => calendarToFiscal(+month)),
  }));

export const saveActualCell = (fy: string, planRowId: number, monthNo: number, amount: number) =>
  send<{ ok: boolean }>("PUT", "/capex/actuals/cell", { fy_year: fy, plan_row_id: planRowId, month_no: fiscalToCalendar(monthNo), amount }, { ok: true });

export const toggleMonthLock = (fy: string, monthNo: number, lock: boolean) =>
  lock
    ? send<{ ok: boolean }>("POST", "/capex/locks", { fy_year: fy, month_no: fiscalToCalendar(monthNo) }, { ok: true })
    : send<{ ok: boolean }>("DELETE", `/capex/locks/${encodeURIComponent(fy)}/${fiscalToCalendar(monthNo)}`, null, { ok: true });

export const approvePlan = (planId: number) => send<{ ok: boolean }>("POST", `/capex/plans/${planId}/approve`, {}, { ok: true });
export const unlockPlan = (planId: number) => send<{ ok: boolean }>("POST", `/capex/plans/${planId}/unlock`, {}, { ok: true });
export const createRePlan = (fy: string, version: string, effMonth: number, rows: unknown[]) =>
  send<GridPlanRef>("POST", "/capex/plans", { fy, planType: "RE", planVersion: version, effMonth: fiscalToCalendar(effMonth), rows }, { id: 2, fy, type: "RE", version, status: "Draft", effMonth });

// ------------------------------------------------------------ COMMAND DASHBOARD
export interface CmdMonth { month: string; be: number; re: number; actual: number; planProjects: { name: string; amount: number }[]; actualProjects: { name: string; amount: number }[]; }
export interface CmdStatusRow { label: string; count: number; cost: number; tone: "ok" | "warn" | "hot" | "done"; }
export interface CmdMilestone { label: string; parent: string; start: string; finish: string; expectedFinish: string; weight: number; }
export interface CmdCurvePoint { month: string; cumPlan: number; cumActual: number | null; }
export interface CmdScheme {
  scheme_id: number; name: string; type: string; cost: number; achievement: number; status: string;
  registration: string; fyStart: string; scheduleFinish: string; expectedFinish: string;
  milestones: CmdMilestone[]; curve: CmdCurvePoint[]; remarks: { month: string; text: string }[];
  dpr: { category: string; plan: number; actual: number }[];
}
export interface CmdSummary {
  fy: string; totalCost: number; be: number; re: number; actual: number; effectivePlanType: "BE" | "RE";
  corp: { n: number; cost: number }; plant: { n: number; cost: number };
  completed: { n: number; cost: number }; scheduledThisFy: { n: number; cost: number }; upcoming: { n: number; cost: number };
  statusRows: CmdStatusRow[]; trend: CmdMonth[]; schemes: CmdScheme[];
}

function mockSummary(fy: string): CmdSummary {
  const be = [92, 96, 104, 118, 122, 130, 128, 134, 126, 138, 142, 155];
  const ac = [78, 88, 111, 98, 0, 0, 0, 0, 0, 0, 0, 0];
  const mk = (name: string, plan: number, act: number) => ({ name, amount: plan || act });
  const trend: CmdMonth[] = FY_MONTHS.map((m, i) => ({
    month: `${m}-${i < 9 ? fy.slice(2, 4) : String(+fy.slice(0, 4) + 1).slice(2)}`,
    be: be[i], re: i >= 6 ? Math.round(be[i] * 1.08) : 0, actual: ac[i],
    planProjects: [mk("COB-7 Rebuilding", be[i] * 0.5, 0), mk("SP-3 Augmentation", be[i] * 0.3, 0), mk("BF-5 Cap Repair", be[i] * 0.2, 0)],
    actualProjects: ac[i] ? [mk("COB-7 Rebuilding", 0, ac[i] * 0.55), mk("SP-3 Augmentation", 0, ac[i] * 0.28), mk("BF-5 Cap Repair", 0, ac[i] * 0.17)] : [],
  }));
  const curve = (shift = 0): CmdCurvePoint[] => {
    let p = 0, a = 0;
    return trend.map((t, i) => { p = Math.min(100, p + 8.3); a = i < 4 ? Math.min(100, a + 7.2 - shift) : a; return { month: t.month, cumPlan: Math.round(p * 10) / 10, cumActual: i < 4 ? Math.round(a * 10) / 10 : null }; });
  };
  const ms = (label: string, parent: string, s: string, f: string, ef: string, w: number): CmdMilestone => ({ label, parent, start: s, finish: f, expectedFinish: ef, weight: w });
  const schemes: CmdScheme[] = [
    {
      scheme_id: 74, name: "COB-7 Rebuilding", type: "Corporate AMR", cost: 4789, achievement: 41.8, status: "Delay < 1 Yr",
      registration: "2024-08-12", fyStart: "2026-04-01", scheduleFinish: "2027-09-30", expectedFinish: "2027-12-15",
      milestones: [
        ms("Battery Proper Civil", "Pkg-74", "2026-04-01", "2026-11-30", "2027-01-20", 22),
        ms("Refractory Erection", "Pkg-74", "2026-08-01", "2027-05-31", "2027-07-15", 30),
        ms("Coal Tower & Charging", "Pkg-75", "2026-05-15", "2027-02-28", "2027-02-28", 18),
        ms("BP Plant Revamp", "Pkg-76", "2026-07-01", "2027-08-31", "2027-11-30", 20),
        ms("Heating & Commissioning", "Pkg-74", "2027-06-01", "2027-09-30", "2027-12-15", 10),
      ],
      curve: curve(0),
      remarks: [
        { month: "Apr-26", text: "Battery civil 62% · refractory bricks 1st lot received." },
        { month: "May-26", text: "Coal tower steel erection resumed post monsoon prep." },
        { month: "Jun-26", text: "BP plant vendor drawings approved · site mobilised." },
        { month: "Jul-26", text: "Refractory erection front opened on 4 ovens." },
      ],
      dpr: [
        { category: "Civil & Structural", plan: 100, actual: 91 },
        { category: "Refractory", plan: 100, actual: 74 },
        { category: "Mechanical Erection", plan: 100, actual: 68 },
        { category: "Electrical & C&I", plan: 100, actual: 52 },
      ],
    },
    {
      scheme_id: 61, name: "SP-3 Augmentation", type: "Corporate AMR", cost: 1130, achievement: 55.4, status: "On Time",
      registration: "2025-01-20", fyStart: "2026-04-01", scheduleFinish: "2027-03-31", expectedFinish: "2027-03-31",
      milestones: [
        ms("Sinter M/c Structurals", "Machine", "2026-04-01", "2026-12-31", "2026-12-31", 40),
        ms("ESP Internals", "Environment", "2026-06-01", "2027-01-31", "2027-01-31", 35),
        ms("Trials & PG Test", "Commissioning", "2027-01-01", "2027-03-31", "2027-03-31", 25),
      ],
      curve: curve(-0.6),
      remarks: [{ month: "Jun-26", text: "ESP shell 80% · sinter cooler fabrication ahead of plan." }],
      dpr: [
        { category: "Structural", plan: 100, actual: 96 },
        { category: "Environment (ESP)", plan: 100, actual: 82 },
      ],
    },
    {
      scheme_id: 47, name: "BF-5 Capital Repair Cat-II", type: "Plant Level AMR", cost: 1045, achievement: 28.1, status: "Delay > 1 Yr",
      registration: "2024-03-02", fyStart: "2026-04-01", scheduleFinish: "2026-12-31", expectedFinish: "2028-02-28",
      milestones: [
        ms("Shell & Cooling", "Furnace Proper", "2026-04-01", "2026-09-30", "2027-08-31", 55),
        ms("Top Charging", "Charging", "2026-06-01", "2026-12-31", "2028-02-28", 45),
      ],
      curve: curve(1.4),
      remarks: [{ month: "May-26", text: "Top charging vendor re-tender · 9 month impact flagged." }],
      dpr: [{ category: "Furnace Proper", plan: 100, actual: 61 }, { category: "Charging System", plan: 100, actual: 22 }],
    },
  ];
  return {
    fy, totalCost: 12480, be: be.reduce((a, b) => a + b, 0), re: 1512, actual: ac.reduce((a, b) => a + b, 0), effectivePlanType: "BE",
    corp: { n: 46, cost: 9860 }, plant: { n: 28, cost: 2620 },
    completed: { n: 6, cost: 812 }, scheduledThisFy: { n: 17, cost: 3410 }, upcoming: { n: 9, cost: 1105 },
    statusRows: [
      { label: "On Time", count: 41, cost: 6120, tone: "ok" },
      { label: "Delay < 1 Year", count: 19, cost: 3480, tone: "warn" },
      { label: "Delay > 1 Year", count: 8, cost: 2068, tone: "hot" },
      { label: "Completed this FY", count: 6, cost: 812, tone: "done" },
    ],
    trend, schemes,
  };
}

export const getCommandSummary = (fy: string) =>
  get<CmdSummary>(`/dashboard/command?fy=${encodeURIComponent(fy)}`, mockSummary(fy), (d) => ({ ...mockSummary(fy), ...d }));

// ----------------------------------------------------------------- REPORTS HUB
export interface ReportCard { id: string; group: string; name: string; desc: string; exports: ("xlsx" | "docx" | "pdf" | "csv")[]; }
export const REPORT_CARDS: ReportCard[] = [
  { id: "mos-capex", group: "Corporate Office (MoS)", name: "MoS CAPEX Format", desc: "Ministry of Steel monthly CAPEX — BE/RE/Actual, cumulative & achievement, scheme-wise.", exports: ["xlsx", "docx", "pdf"] },
  { id: "phys-fin", group: "Corporate Office (MoS)", name: "Physical & Financial Progress", desc: "CAPEX projects — physical % vs financial % with variance flags for the FY.", exports: ["xlsx", "docx", "pdf"] },
  { id: "capex-pmc", group: "Corporate Office (MoS)", name: "CAPEX PMC Report", desc: "PMC consolidated CAPEX with reconciliation to books of account.", exports: ["xlsx", "pdf"] },
  { id: "pmc-phys", group: "PMC", name: "Physical Progress PMC", desc: "Project-wise PMC physical + financial with milestone commentary.", exports: ["xlsx", "docx", "pdf"] },
  { id: "s-curve", group: "Progress", name: "Weighted S-Curve", desc: "Plan vs actual cumulative curve, package-weighted, with forecast band.", exports: ["xlsx", "pdf", "csv"] },
  { id: "dpr", group: "Progress", name: "DPR Summary", desc: "Daily progress rollup, package-wise, month cut-off aware.", exports: ["xlsx", "csv"] },
  { id: "capex-recon", group: "Progress", name: "CAPEX Reconciliation", desc: "Plan vs actuals vs books — drill to row level differences.", exports: ["xlsx", "pdf"] },
  { id: "custom-ai", group: "AI", name: "Custom Report (Brain)", desc: "Describe any report in plain words — the AI plans safe SQL and renders table + chart.", exports: ["xlsx", "pdf"] },
];
export interface ReportPreview { title: string; fy: string; generated: string; columns: string[]; rows: (string | number)[][]; footnote?: string; }

function mockPreview(id: string, fy: string): ReportPreview {
  const gen = new Date().toISOString().slice(0, 16).replace("T", " ");
  if (id === "phys-fin" || id === "pmc-phys") return {
    title: id === "phys-fin" ? "Physical & Financial Progress of CAPEX Projects" : "Physical Progress — PMC", fy, generated: gen,
    columns: ["Sl", "Scheme", "Sanctioned Cost (₹Cr)", "Cum Exp (₹Cr)", "Fin %", "Phy %", "Variance (pp)", "Status"],
    rows: [
      [1, "COB-7 Rebuilding", 4789.0, 2002.4, 41.8, 46.2, "+4.4", "Delay < 1 Yr"],
      [2, "SP-3 Augmentation", 1130.0, 626.0, 55.4, 57.1, "+1.7", "On Time"],
      [3, "BF-5 Capital Repair Cat-II", 1045.0, 293.6, 28.1, 24.3, "−3.8", "Delay > 1 Yr"],
      [4, "Plate Mill Modernisation", 660.0, 214.5, 32.5, 35.0, "+2.5", "On Time"],
    ],
    footnote: "Physical % is weighted by Appendix-2 activity weightages; financial % on sanctioned cost.",
  };
  if (id === "s-curve") return {
    title: "Weighted S-Curve — Portfolio", fy, generated: gen,
    columns: ["Month", "Monthly Plan %", "Monthly Actual %", "Cum Plan %", "Cum Actual %", "Variance (pp)"],
    rows: [["Apr-26", 8.3, 7.1, 8.3, 7.1, "−1.2"], ["May-26", 8.3, 8.0, 16.6, 15.1, "−1.5"], ["Jun-26", 8.3, 9.4, 24.9, 24.5, "−0.4"], ["Jul-26", 8.3, 8.6, 33.2, 33.1, "−0.1"]],
  };
  return {
    title: "MoS CAPEX Format", fy, generated: gen,
    columns: ["Sl", "Head / Scheme", "Gross Cost", "Cum till last FY", `BE ${fy}`, `RE ${fy}`, "Actual (YTD)", "Achv %"],
    rows: [
      [1, "Coke Ovens — COB-7", 4789.0, 960.0, 835.0, 901.8, 375.0, 44.9],
      [2, "Sinter Plant — SP-3", 1130.0, 250.0, 238.0, 257.0, 131.9, 55.4],
      [3, "Blast Furnace — BF-5", 1045.0, 122.0, 218.0, 235.4, 61.3, 28.1],
      [4, "Mills — Plate Mill Mod.", 660.0, 152.0, 140.0, 151.2, 45.5, 32.5],
      ["", "TOTAL", 7624.0, 1484.0, 1431.0, 1545.4, 613.7, 42.9],
    ],
    footnote: "₹ Cr · RE effective Oct-26 · Actuals reconciled to books till previous month cut-off.",
  };
}
export const getReportPreview = async (id: string, fy: string): Promise<ReportPreview> => {
  if (MOCK || id === "custom-ai") return clone(mockPreview(id, fy));
  const data = await live(`/report-docs/preview?id=${encodeURIComponent(id)}&fy=${encodeURIComponent(fy)}`);
  return { ...mockPreview(id, fy), ...data };
};

export const reportExportUrl = (id: string, fy: string, fmt: string) =>
  `${API_BASE}/report-docs/export?id=${encodeURIComponent(id)}&fy=${encodeURIComponent(fy)}&fmt=${fmt}`;

// ----------------------------------------------------------------- utilities
export const inr = (n: number, dp = 1) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const crShort = (n: number) => (Math.abs(n) >= 1000 ? `${inr(n / 1000, 2)}k` : inr(n, 1));

export function downloadCSV(name: string, header: string[], rows: (string | number)[][], title?: string) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [...(title ? [title, ""] : []), header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}
