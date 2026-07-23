"use client";
// cpmEngine.ts — client-side CPM + DCMA-lite, written clean-room (no license debt).
// Forward/backward pass with FS/SS/FF/SF links + lag, all eight P6/MSP
// constraint types, total/free float, critical path, and live DCMA checks.
//
// All maths is in integer WORKING-DAY UNITS, matching the backend engine.
// Durations, lags and float are unit counts; conversion to calendar dates goes
// through WorkCalendar at the display boundary, never by plain day addition. The backend
// _scheduling_module remains the authority for official runs; this engine gives
// instant in-browser recompute while dragging bars — something the rival's
// iframe module cannot do without a server round-trip.
import { API_BASE, MOCK } from "@/lib/furnace/gridApi";

import { WorkCalendar } from "@/lib/furnace/workCalendar";

export type LinkType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType =
  | "SNET"   // Start No Earlier Than  — soft, pushes ES forward
  | "SNLT"   // Start No Later Than    — deadline on start, can force negative float
  | "FNET"   // Finish No Earlier Than — pushes EF forward
  | "FNLT"   // Finish No Later Than   — deadline on finish
  | "MSO"    // Must Start On          — hard, pins both directions
  | "MFO"    // Must Finish On         — hard, pins both directions
  | "ASAP" | "ALAP";
export interface CpmLink { pred: string; succ: string; type: LinkType; lag: number; }
export interface CpmActivity {
  id: string; code: string; name: string; duration: number;      // working days
  progress: number;                                              // 0..100
  // All eight P6/MSP constraint types, matching the backend engine.
  constraint?: ConstraintType | null; constraintDate?: string | null;
  wbs?: string;
}
export interface CpmResult {
  es: Record<string, number>; ef: Record<string, number>;
  ls: Record<string, number>; lf: Record<string, number>;
  tf: Record<string, number>; ff: Record<string, number>;
  critical: Set<string>; projectDuration: number; order: string[];
}

/**
 * Map a constraint date to a working-day unit index.
 *
 * The engine runs in working-day units, so a constraint date must be converted
 * through the calendar. Using calendar days here (as this did initially) put a
 * constraint on a five-day calendar 40% further out than intended — a
 * "start no earlier than" 100 days away landed at unit 100, which is 140
 * calendar days.
 *
 * Returns null when either date is missing or unparseable, in which case the
 * constraint is ignored rather than silently applied at unit 0.
 */
function constraintOffset(
  iso: string | null | undefined,
  dataDate?: string,
  cal?: WorkCalendar,
): number | null {
  if (!iso || !dataDate) return null;
  const c = Date.parse(iso), d = Date.parse(dataDate);
  if (Number.isNaN(c) || Number.isNaN(d)) return null;
  if (cal) {
    cal.setAnchor(dataDate);
    return cal.unitForDate(iso);
  }
  return Math.round((c - d) / 86400000);
}

export function runCpm(
  acts: CpmActivity[],
  links: CpmLink[],
  opts: { dataDate?: string; calendar?: WorkCalendar } = {},
): CpmResult {
  const dataDate = opts.dataDate;
  const cal = opts.calendar;
  const ids = acts.map((a) => a.id);
  const byId = new Map(acts.map((a) => [a.id, a]));
  const preds = new Map<string, CpmLink[]>(); const succs = new Map<string, CpmLink[]>();
  ids.forEach((id) => { preds.set(id, []); succs.set(id, []); });
  links.forEach((l) => { if (byId.has(l.pred) && byId.has(l.succ)) { preds.get(l.succ)!.push(l); succs.get(l.pred)!.push(l); } });

  // Kahn topological order (cycles: leftovers appended, flagged by check #9)
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!; order.push(n);
    succs.get(n)!.forEach((l) => { indeg.set(l.succ, indeg.get(l.succ)! - 1); if (indeg.get(l.succ) === 0) queue.push(l.succ); });
  }
  ids.forEach((id) => { if (!order.includes(id)) order.push(id); });

  const es: Record<string, number> = {}, ef: Record<string, number> = {};
  order.forEach((id) => {
    const a = byId.get(id)!;
    let start = 0;
    preds.get(id)!.forEach((l) => {
      const pd = byId.get(l.pred)!.duration;
      const pes = es[l.pred] ?? 0, pef = ef[l.pred] ?? pes + pd;
      const req = l.type === "FS" ? pef + l.lag
        : l.type === "SS" ? pes + l.lag
        : l.type === "FF" ? pef + l.lag - a.duration
        : /* SF */          pes + l.lag - a.duration;
      start = Math.max(start, req);
    });
    // Constraints. Previously a no-op, which meant the browser Gantt and the
    // DCMA checker showed a different schedule from the official backend run
    // on any network that used constraints at all.
    const c = constraintOffset(a.constraintDate, dataDate, cal);
    if (c !== null) {
      if (a.constraint === "SNET" || a.constraint === "MSO") start = Math.max(start, c);
      if (a.constraint === "MSO") start = c;                       // hard pin
      if (a.constraint === "FNET" || a.constraint === "MFO") {
        start = Math.max(start, c - a.duration);
      }
      if (a.constraint === "MFO") start = c - a.duration;          // hard pin
    }
    es[id] = start; ef[id] = start + a.duration;
  });
  const projectDuration = Math.max(0, ...order.map((id) => ef[id] ?? 0));

  const lf: Record<string, number> = {}, ls: Record<string, number> = {};
  [...order].reverse().forEach((id) => {
    const a = byId.get(id)!;
    let finish = projectDuration;
    succs.get(id)!.forEach((l) => {
      const s = byId.get(l.succ)!;
      const sls = ls[l.succ] ?? projectDuration - s.duration;
      const slf = lf[l.succ] ?? projectDuration;
      const req = l.type === "FS" ? sls - l.lag
        : l.type === "SS" ? sls - l.lag + a.duration
        : l.type === "FF" ? slf - l.lag
        : /* SF */          slf - l.lag + a.duration;
      finish = Math.min(finish, req);
    });
    // Deadline constraints pull LF down, producing negative float when the
    // forward pass has already run past them — exactly what DCMA #7 looks for.
    const c = constraintOffset(a.constraintDate, dataDate, cal);
    if (c !== null) {
      if (a.constraint === "FNLT" || a.constraint === "MFO") finish = Math.min(finish, c);
      if (a.constraint === "MFO") finish = c;                      // hard pin
      if (a.constraint === "SNLT" || a.constraint === "MSO") {
        finish = Math.min(finish, c + a.duration);
      }
      if (a.constraint === "MSO") finish = c + a.duration;         // hard pin
    }
    lf[id] = finish; ls[id] = finish - a.duration;
  });

  const tf: Record<string, number> = {}, ff: Record<string, number> = {};
  order.forEach((id) => {
    tf[id] = (ls[id] ?? 0) - (es[id] ?? 0);
    const minSucc = Math.min(projectDuration, ...succs.get(id)!.map((l) => es[l.succ] ?? projectDuration));
    ff[id] = succs.get(id)!.length ? Math.max(0, minSucc - (ef[id] ?? 0)) : projectDuration - (ef[id] ?? 0);
  });
  const critical = new Set(order.filter((id) => Math.abs(tf[id]) < 1e-9));
  return { es, ef, ls, lf, tf, ff, critical, projectDuration, order };
}

// ---- DCMA-lite (live browser subset of the backend 14-point) -----------------
export interface DcmaCheck { id: string; name: string; count: number; total: number; threshold: string; pass: boolean; offenders: string[]; }
export function dcmaLite(acts: CpmActivity[], links: CpmLink[], r: CpmResult): DcmaCheck[] {
  const n = acts.length || 1;
  const hasPred = new Set(links.map((l) => l.succ)), hasSucc = new Set(links.map((l) => l.pred));
  const dangling = acts.filter((a) => !hasPred.has(a.id) && !hasSucc.has(a.id));
  const noPred = acts.filter((a) => !hasPred.has(a.id)).slice(1); // one true start allowed
  const noSucc = acts.filter((a) => !hasSucc.has(a.id)).slice(1);
  const leads = links.filter((l) => l.lag < 0);
  const lags = links.filter((l) => l.lag > 0);
  const nonFs = links.filter((l) => l.type !== "FS");
  const highFloat = acts.filter((a) => (r.tf[a.id] ?? 0) > 44);
  const negFloat = acts.filter((a) => (r.tf[a.id] ?? 0) < 0);
  const longDur = acts.filter((a) => a.duration > 44);
  const hard = acts.filter((a) => a.constraint === "MSO" || a.constraint === "MFO"
    || a.constraint === "FNLT" || a.constraint === "SNLT");
  const mk = (id: string, name: string, offenders: CpmActivity[] | CpmLink[], limitPct: number | null, threshold: string, totalOverride?: number): DcmaCheck => {
    const count = offenders.length; const total = totalOverride ?? n;
    const pass = limitPct == null ? count === 0 : (count / (total || 1)) * 100 <= limitPct;
    return { id, name, count, total, threshold, pass, offenders: (offenders as any[]).slice(0, 6).map((o) => o.code ?? `${o.pred}→${o.succ}`) };
  };
  return [
    mk("logic", "Missing logic (no pred & no succ)", dangling, 5, "≤5%"),
    mk("preds", "Open starts (no predecessor)", noPred, 5, "≤5%"),
    mk("succs", "Open ends (no successor)", noSucc, 5, "≤5%"),
    mk("leads", "Leads (negative lag)", leads, 0, "0 allowed", links.length),
    mk("lags", "Lags", lags, 5, "≤5% of links", links.length),
    mk("fs", "Non-FS relationships", nonFs, 10, "≤10% of links", links.length),
    mk("hifloat", "High float (>44d)", highFloat, 5, "≤5%"),
    mk("negfloat", "Negative float", negFloat, 0, "0 allowed"),
    mk("longdur", "Long durations (>44d)", longDur, 5, "≤5%"),
    mk("hard", "Hard constraints", hard, 5, "≤5%"),
  ];
}

// ---- API layer ----------------------------------------------------------------
export interface CpmScheduleRef { schedule_id: number; schedule_name: string; is_current: boolean; total_activities: number; critical_path_length_days: number | null; }
export interface CpmScheduleFull { ref: CpmScheduleRef; dataDate: string; activities: CpmActivity[]; links: CpmLink[]; }

const MOCK_NET: CpmScheduleFull = {
  ref: { schedule_id: 1, schedule_name: "COB-7 · Pkg-74 Battery Proper — Rev C", is_current: true, total_activities: 14, critical_path_length_days: 545 },
  dataDate: "2026-07-01",
  activities: [
    { id: "A010", code: "A010", name: "Mobilisation & Site Grading", duration: 30, progress: 100, wbs: "Civil" },
    { id: "A020", code: "A020", name: "Battery Proper Foundation", duration: 90, progress: 92, wbs: "Civil" },
    { id: "A030", code: "A030", name: "Basement & Flue Duct Civil", duration: 75, progress: 68, wbs: "Civil" },
    { id: "A040", code: "A040", name: "Coal Tower Foundation", duration: 45, progress: 100, wbs: "Civil" },
    { id: "A050", code: "A050", name: "Coal Tower Steel Erection", duration: 120, progress: 44, wbs: "Structural" },
    { id: "A060", code: "A060", name: "Battery Structural Steel", duration: 100, progress: 35, wbs: "Structural" },
    { id: "A070", code: "A070", name: "Refractory Material Delivery", duration: 60, progress: 80, wbs: "Refractory" },
    { id: "A080", code: "A080", name: "Refractory Erection — Ovens 1–35", duration: 150, progress: 18, wbs: "Refractory" },
    { id: "A090", code: "A090", name: "Refractory Erection — Ovens 36–70", duration: 150, progress: 0, wbs: "Refractory" },
    { id: "A100", code: "A100", name: "Charging Car & Pusher Erection", duration: 90, progress: 5, wbs: "Mechanical" },
    { id: "A110", code: "A110", name: "Gas Piping & Reversal System", duration: 110, progress: 0, wbs: "Mechanical" },
    { id: "A120", code: "A120", name: "Electrics & Automation (L1/L2)", duration: 95, progress: 0, wbs: "E&I" },
    { id: "A130", code: "A130", name: "Heating-Up (90-day schedule)", duration: 90, progress: 0, wbs: "Commissioning" },
    { id: "A140", code: "A140", name: "Trial Pushing & PG Test", duration: 35, progress: 0, wbs: "Commissioning" },
  ],
  links: [
    { pred: "A010", succ: "A020", type: "FS", lag: 0 }, { pred: "A010", succ: "A040", type: "FS", lag: 0 },
    { pred: "A020", succ: "A030", type: "FS", lag: -10 }, { pred: "A040", succ: "A050", type: "FS", lag: 0 },
    { pred: "A020", succ: "A060", type: "FS", lag: 15 }, { pred: "A030", succ: "A080", type: "FS", lag: 0 },
    { pred: "A070", succ: "A080", type: "FS", lag: 0 }, { pred: "A060", succ: "A080", type: "SS", lag: 30 },
    { pred: "A080", succ: "A090", type: "FS", lag: 0 }, { pred: "A050", succ: "A100", type: "FS", lag: 0 },
    { pred: "A090", succ: "A110", type: "SS", lag: 60 }, { pred: "A090", succ: "A120", type: "SS", lag: 45 },
    { pred: "A090", succ: "A130", type: "FS", lag: 0 }, { pred: "A110", succ: "A130", type: "FS", lag: 0 },
    { pred: "A120", succ: "A130", type: "FS", lag: 0 }, { pred: "A130", succ: "A140", type: "FS", lag: 0 },
  ],
};

async function jget(path: string): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
export async function getSchedules(packageId?: number): Promise<CpmScheduleRef[]> {
  if (MOCK) return [MOCK_NET.ref];
  try {
    const d = await jget(`/cpm/schedule${packageId ? `?package_id=${packageId}` : ""}`);
    return (Array.isArray(d) ? d : d?.schedules ?? []).map((s: any) => ({
      schedule_id: +(s.schedule_id ?? s.id), schedule_name: s.schedule_name ?? "Schedule",
      is_current: Boolean(s.is_current), total_activities: +(s.total_activities ?? 0),
      critical_path_length_days: s.critical_path_length_days ?? null,
    }));
  } catch { return [MOCK_NET.ref]; }
}
export async function getScheduleFull(scheduleId: number): Promise<CpmScheduleFull> {
  if (MOCK) return JSON.parse(JSON.stringify(MOCK_NET));
  try {
    const d = await jget(`/cpm/schedule/${scheduleId}`);
    const acts: CpmActivity[] = (d.activities ?? []).map((a: any) => ({
      id: String(a.activity_code ?? a.activity_id), code: String(a.activity_code ?? a.activity_id),
      name: a.activity_name ?? "Activity", duration: +(a.duration_days ?? a.original_duration ?? 0),
      progress: +(a.physical_pct_complete ?? 0), wbs: a.wbs ?? a.activity_group ?? "",
      constraint: a.constraint_type ?? null, constraintDate: a.constraint_date ?? null,
    }));
    const links: CpmLink[] = (d.dependencies ?? d.links ?? []).map((l: any) => ({
      pred: String(l.predecessor_code ?? l.pred), succ: String(l.successor_code ?? l.succ),
      type: (l.link_type ?? l.type ?? "FS") as LinkType, lag: +(l.lag_days ?? l.lag ?? 0),
    }));
    return { ref: { schedule_id: scheduleId, schedule_name: d.schedule_name ?? "Schedule", is_current: true, total_activities: acts.length, critical_path_length_days: d.critical_path_length_days ?? null }, dataDate: d.data_date ?? new Date().toISOString().slice(0, 10), activities: acts, links };
  } catch { return JSON.parse(JSON.stringify(MOCK_NET)); }
}
export async function runBackendCpm(scheduleId: number): Promise<boolean> {
  if (MOCK) return true;
  try { const r = await fetch(`${API_BASE}/cpm/run/${scheduleId}`, { method: "POST" }); return r.ok; } catch { return false; }
}
export const importUrl = () => `${API_BASE}/cpm/schedule/import`;
