"use client";
/**
 * dcma.ts — full DCMA 14-Point Schedule Assessment, clean-room.
 *
 * cpmEngine's dcmaLite covers 10 structural checks. This completes the standard
 * set, including the four that reviewers actually quote in a schedule audit and
 * that dcmaLite could not compute without status/baseline data:
 *
 *   #9  Invalid dates      — actuals in the future, forecasts in the past
 *   #10 Resources          — activities with duration but no resource/cost
 *   #11 Missed tasks       — finished late against baseline, or overdue
 *   #12 Critical path test — inject 600d into a critical activity; if the
 *                            project finish does not move by ~600d the network
 *                            is broken (this is the real integrity test)
 *   #13 CPLI              — Critical Path Length Index, ≥0.95 passes
 *   #14 BEI               — Baseline Execution Index, ≥0.95 passes
 *
 * Thresholds follow the DCMA 14-Point standard as commonly applied. Checks that
 * lack the data to be computed return status "na" rather than a false pass —
 * silently passing an uncomputable check is how schedule audits get gamed.
 */
import { CpmActivity, CpmLink, CpmResult, runCpm } from "@/lib/furnace/cpmEngine";

export type CheckStatus = "pass" | "fail" | "na";

export interface DcmaPoint {
  id: string;
  point: number;
  name: string;
  threshold: string;
  status: CheckStatus;
  count: number;
  total: number;
  pct: number | null;
  value: number | null;      // for index checks (CPLI/BEI)
  offenders: string[];
  detail: string;
}

export interface DcmaReport {
  points: DcmaPoint[];
  passed: number;
  failed: number;
  notApplicable: number;
  score: number;             // % of applicable checks passed
  grade: "A" | "B" | "C" | "D" | "F";
}

/** Status fields an activity may carry; all optional so existing callers compile. */
export interface DcmaActivityExtras {
  actualStart?: string | null;
  actualFinish?: string | null;
  baselineFinish?: string | null;
  resourceCount?: number | null;
  cost?: number | null;
  isMilestone?: boolean;
  isLoE?: boolean;           // level-of-effort activities are exempt from several checks
}

export type DcmaActivity = CpmActivity & DcmaActivityExtras;

const DAY = 86400000;
const HIGH_FLOAT_D = 44;
const LONG_DURATION_D = 44;
const CRITICAL_TEST_INJECT_D = 600;

const pct = (count: number, total: number) => (total > 0 ? (count / total) * 100 : 0);
const codeOf = (a: DcmaActivity) => a.code || a.id;
const linkLabel = (l: CpmLink) => `${l.pred}\u2192${l.succ}`;

function point(
  p: number, id: string, name: string, threshold: string,
  count: number, total: number, limitPct: number | null,
  offenders: string[], detail: string,
): DcmaPoint {
  const percentage = total > 0 ? pct(count, total) : null;
  const status: CheckStatus =
    limitPct === null ? (count === 0 ? "pass" : "fail")
      : percentage === null ? "na"
        : percentage <= limitPct ? "pass" : "fail";
  return {
    id, point: p, name, threshold, status, count, total,
    pct: percentage === null ? null : Math.round(percentage * 10) / 10,
    value: null, offenders: offenders.slice(0, 8), detail,
  };
}

function indexPoint(
  p: number, id: string, name: string, threshold: string,
  value: number | null, min: number, detail: string,
): DcmaPoint {
  return {
    id, point: p, name, threshold,
    status: value === null ? "na" : value >= min ? "pass" : "fail",
    count: 0, total: 0, pct: null,
    value: value === null ? null : Math.round(value * 1000) / 1000,
    offenders: [], detail,
  };
}

/**
 * DCMA #12 — Critical Path Test.
 * Push a large duration into the first critical activity and re-run. A healthy
 * network propagates the whole delay to the project finish; if it absorbs any
 * of it, logic is broken somewhere downstream.
 */
export function criticalPathTest(
  acts: DcmaActivity[], links: CpmLink[], base: CpmResult, dataDate?: string,
): { ok: boolean; expected: number; observed: number; probe: string | null } {
  const probe = acts.find((a) => base.critical.has(a.id) && (a.progress ?? 0) < 100);
  if (!probe) return { ok: false, expected: 0, observed: 0, probe: null };
  const mutated = acts.map((a) =>
    a.id === probe.id ? { ...a, duration: a.duration + CRITICAL_TEST_INJECT_D } : a);
  // dataDate must be carried through or the probe run silently drops every
  // constraint and reports a broken network as healthy.
  const after = runCpm(mutated, links, { dataDate });
  const observed = after.projectDuration - base.projectDuration;
  // allow 1 day of rounding slack
  return {
    ok: Math.abs(observed - CRITICAL_TEST_INJECT_D) <= 1,
    expected: CRITICAL_TEST_INJECT_D,
    observed,
    probe: codeOf(probe),
  };
}

export function runDcma14(
  acts: DcmaActivity[],
  links: CpmLink[],
  result: CpmResult,
  opts: { dataDate?: string; baselineFinish?: string } = {},
): DcmaReport {
  const dataDate = opts.dataDate ? Date.parse(opts.dataDate) : Date.now();
  // LoE and completed milestones distort structural ratios; DCMA excludes them.
  const scope = acts.filter((a) => !a.isLoE);
  const n = scope.length;
  const linkTotal = links.length;

  const hasPred = new Set(links.map((l) => l.succ));
  const hasSucc = new Set(links.map((l) => l.pred));
  const incomplete = scope.filter((a) => (a.progress ?? 0) < 100);

  // ---- 1 Logic -------------------------------------------------------------
  const dangling = scope.filter((a) => !hasPred.has(a.id) || !hasSucc.has(a.id));
  const p1 = point(1, "logic", "Logic — missing predecessor or successor", "\u22645%",
    Math.max(0, dangling.length - 2), n, 5, dangling.map(codeOf),
    "Every activity except one true start and one true finish needs both a predecessor and a successor.");

  // ---- 2 Leads (negative lag) ---------------------------------------------
  const leads = links.filter((l) => l.lag < 0);
  const p2 = point(2, "leads", "Leads — negative lag", "0 allowed",
    leads.length, linkTotal, null, leads.map(linkLabel),
    "Negative lag lets work start before its predecessor finishes and hides true float.");

  // ---- 3 Lags --------------------------------------------------------------
  const lags = links.filter((l) => l.lag > 0);
  const p3 = point(3, "lags", "Lags", "\u22645% of links",
    lags.length, linkTotal, 5, lags.map(linkLabel),
    "Lag is often a substitute for a missing activity; excessive lag makes the network unauditable.");

  // ---- 4 Relationship types ------------------------------------------------
  const nonFs = links.filter((l) => l.type !== "FS");
  const p4 = point(4, "reltypes", "Relationship types — non-FS", "\u226510% must be FS",
    nonFs.length, linkTotal, 10, nonFs.map(linkLabel),
    "At least 90% of links should be Finish-to-Start; SS/FF pairs often mask undefined logic.");

  // ---- 5 Hard constraints --------------------------------------------------
  const hard = scope.filter((a) => a.constraint === "MSO" || a.constraint === "FNLT");
  const p5 = point(5, "constraints", "Hard constraints", "\u22645%",
    hard.length, n, 5, hard.map(codeOf),
    "Mandatory constraints override logic and prevent the network from reacting to delay.");

  // ---- 6 High float --------------------------------------------------------
  const highFloat = incomplete.filter((a) => (result.tf[a.id] ?? 0) > HIGH_FLOAT_D);
  const p6 = point(6, "highfloat", `High float (>${HIGH_FLOAT_D}d)`, "\u22645%",
    highFloat.length, incomplete.length, 5, highFloat.map(codeOf),
    "Float above two months usually indicates missing successor logic rather than genuine slack.");

  // ---- 7 Negative float ----------------------------------------------------
  const negFloat = incomplete.filter((a) => (result.tf[a.id] ?? 0) < 0);
  const p7 = point(7, "negfloat", "Negative float", "0 allowed",
    negFloat.length, incomplete.length, null, negFloat.map(codeOf),
    "Negative float means the schedule is already late against a constraint and needs re-planning.");

  // ---- 8 High duration -----------------------------------------------------
  const longDur = incomplete.filter((a) => a.duration > LONG_DURATION_D && !a.isMilestone);
  const p8 = point(8, "highduration", `High duration (>${LONG_DURATION_D}d)`, "\u22645%",
    longDur.length, incomplete.length, 5, longDur.map(codeOf),
    "Activities longer than one reporting quarter cannot be progressed meaningfully; break them down.");

  // ---- 9 Invalid dates -----------------------------------------------------
  const invalid = scope.filter((a) => {
    const as = a.actualStart ? Date.parse(a.actualStart) : null;
    const af = a.actualFinish ? Date.parse(a.actualFinish) : null;
    // actuals must not be in the future
    if (as !== null && as > dataDate) return true;
    if (af !== null && af > dataDate) return true;
    // an incomplete activity must not claim an actual finish
    if (af !== null && (a.progress ?? 0) < 100) return true;
    // a complete activity must have an actual finish
    if ((a.progress ?? 0) >= 100 && a.actualFinish === null) return true;
    return false;
  });
  const hasStatusData = scope.some((a) => a.actualStart || a.actualFinish);
  const p9 = hasStatusData
    ? point(9, "invaliddates", "Invalid dates", "0 allowed",
      invalid.length, n, null, invalid.map(codeOf),
      "Actual dates beyond the data date, or completed work without an actual finish, invalidate status.")
    : { ...point(9, "invaliddates", "Invalid dates", "0 allowed", 0, 0, null, [], "No actual-date data on this schedule."), status: "na" as CheckStatus };

  // ---- 10 Resources --------------------------------------------------------
  const hasResourceData = scope.some((a) => a.resourceCount != null || a.cost != null);
  const unresourced = scope.filter((a) =>
    !a.isMilestone && a.duration > 0 && !(a.resourceCount || 0) && !(a.cost || 0));
  const p10 = hasResourceData
    ? point(10, "resources", "Resources — activities without resource or cost", "0 allowed",
      unresourced.length, n, null, unresourced.map(codeOf),
      "Unresourced work cannot be levelled or earned against; every non-milestone task needs a resource or cost.")
    : { ...point(10, "resources", "Resources", "0 allowed", 0, 0, null, [], "Schedule is not resource-loaded."), status: "na" as CheckStatus };

  // ---- 11 Missed tasks -----------------------------------------------------
  const withBaseline = scope.filter((a) => a.baselineFinish);
  const missed = withBaseline.filter((a) => {
    const bl = Date.parse(a.baselineFinish!);
    if ((a.progress ?? 0) >= 100 && a.actualFinish) return Date.parse(a.actualFinish) > bl;
    return bl < dataDate; // should have finished by now and has not
  });
  const p11 = withBaseline.length
    ? point(11, "missedtasks", "Missed tasks vs baseline", "\u22645%",
      missed.length, withBaseline.length, 5, missed.map(codeOf),
      "Tasks that finished after baseline, or that should have finished by the data date and have not.")
    : { ...point(11, "missedtasks", "Missed tasks vs baseline", "\u22645%", 0, 0, 5, [], "No baseline finish dates to compare against."), status: "na" as CheckStatus };

  // ---- 12 Critical path test ----------------------------------------------
  const cpt = criticalPathTest(scope, links, result, opts.dataDate);
  const p12: DcmaPoint = {
    id: "criticalpath", point: 12, name: "Critical path test", threshold: "delay must propagate",
    status: cpt.probe === null ? "na" : cpt.ok ? "pass" : "fail",
    count: cpt.ok ? 0 : 1, total: 1, pct: null, value: cpt.observed,
    offenders: cpt.probe ? [cpt.probe] : [],
    detail: cpt.probe === null
      ? "No incomplete critical activity available to probe."
      : `Injected ${cpt.expected}d into ${cpt.probe}; project finish moved ${cpt.observed}d. ` +
        (cpt.ok ? "Network propagates delay correctly."
          : "Delay was absorbed \u2014 broken logic or a constraint is blocking propagation."),
  };

  // ---- 13 CPLI -------------------------------------------------------------
  // CPLI = (critical path length + total float to the finish milestone) / critical path length
  const cpl = result.projectDuration;
  const finishFloat = Math.min(
    0, ...scope.filter((a) => !hasSucc.has(a.id)).map((a) => result.tf[a.id] ?? 0));
  const cpli = cpl > 0 ? (cpl + finishFloat) / cpl : null;
  const p13 = indexPoint(13, "cpli", "CPLI — Critical Path Length Index", "\u22650.95",
    cpli, 0.95,
    cpli === null ? "No critical path length available."
      : `Critical path ${cpl}d with ${finishFloat}d float to completion. Below 0.95 means the finish date is not credible.`);

  // ---- 14 BEI --------------------------------------------------------------
  const baselineDue = withBaseline.filter((a) => Date.parse(a.baselineFinish!) <= dataDate);
  const actuallyDone = scope.filter((a) => a.actualFinish && Date.parse(a.actualFinish) <= dataDate);
  const bei = baselineDue.length ? actuallyDone.length / baselineDue.length : null;
  const p14 = indexPoint(14, "bei", "BEI — Baseline Execution Index", "\u22650.95",
    bei, 0.95,
    bei === null ? "No baseline finish dates due by the data date."
      : `${actuallyDone.length} of ${baselineDue.length} baseline-due activities are complete. Below 0.95 means work is being completed slower than baselined.`);

  const points = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14];
  const passed = points.filter((p) => p.status === "pass").length;
  const failed = points.filter((p) => p.status === "fail").length;
  const notApplicable = points.filter((p) => p.status === "na").length;
  const applicable = passed + failed;
  const score = applicable ? Math.round((passed / applicable) * 100) : 0;
  const grade: DcmaReport["grade"] =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return { points, passed, failed, notApplicable, score, grade };
}

/** CSV export for the audit pack the Ministry asks for. */
export function dcmaToCsv(report: DcmaReport): string {
  const rows = [
    ["Point", "Check", "Threshold", "Status", "Count", "Total", "Percent", "Value", "Offenders", "Detail"],
    ...report.points.map((p) => [
      String(p.point), p.name, p.threshold, p.status.toUpperCase(),
      String(p.count), String(p.total),
      p.pct === null ? "" : `${p.pct}%`,
      p.value === null ? "" : String(p.value),
      p.offenders.join(" "), p.detail,
    ]),
  ];
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}
