/**
 * delayAnalysis.ts — Project Brain forensic delay analysis engine.
 *
 * Clean-room, dependency-free TypeScript. Implements the five recognised
 * methods (SCL Delay & Disruption Protocol / AACE RP 29R-03 families):
 *
 *   1. asPlannedVsAsBuilt  — observational, retrospective ("post-mortem"):
 *      planned vs actual dates, per-activity variance, as-built critical
 *      chain, driving-delay ranking.
 *   2. impactedAsPlanned   — modelled, prospective, additive: delay events
 *      inserted cumulatively into the BASELINE; each event's impact is the
 *      completion delta it causes.
 *   3. collapsedAsBuilt    — modelled, retrospective, subtractive ("but-for"):
 *      remove a party's events from the AS-BUILT and collapse; the finish
 *      improvement is that party's responsibility.
 *   4. windowAnalysis      — contemporaneous period analysis: cut the project
 *      into windows at update points; forecast completion at each boundary
 *      from a statused schedule; attribute each window's slip to the events
 *      occurring in it on the then-critical path.
 *   5. timeImpactAnalysis  — TIA: status the schedule at a data date, insert
 *      the fragnet, measure the completion delta.
 *
 * Statusing convention (no contemporaneous update files needed):
 *   at time t — finished activities use actuals; in-progress use elapsed
 *   actual + planned remaining; unstarted use planned durations. This is the
 *   standard reconstruction when only baseline + as-built are available.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type LinkType = "FS" | "SS" | "FF" | "SF";
export type Party = "employer" | "contractor" | "neutral";

export interface Link { id: string; type?: LinkType; lag?: number }

export interface Activity {
  id: string;
  name?: string;
  dur: number;                 // planned duration (working days)
  preds?: Link[];
}

export interface Actuals {
  [activityId: string]: { start: number; finish: number };
}

export interface DelayEvent {
  id: string;
  name: string;
  party: Party;
  activityId: string;          // the activity it delayed
  days: number;                // delay magnitude
  atDay?: number;              // when it occurred (project day) — used by windows/TIA
}

export interface CpmDates {
  es: number; ef: number; ls: number; lf: number; tf: number; critical: boolean;
}

export interface CpmResult {
  dates: Record<string, CpmDates>;
  finish: number;
  criticalPath: string[];      // in topological order
}

/* ------------------------------------------------------------------ *
 * Core CPM — full precedence (FS/SS/FF/SF + lag)
 * ------------------------------------------------------------------ */

function topo(acts: Activity[]): string[] {
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const a of acts) { indeg.set(a.id, 0); succ.set(a.id, []); }
  for (const a of acts) {
    for (const p of a.preds ?? []) {
      if (!indeg.has(p.id)) throw new Error(`unknown predecessor "${p.id}" of "${a.id}"`);
      indeg.set(a.id, (indeg.get(a.id) ?? 0) + 1);
      succ.get(p.id)!.push(a.id);
    }
  }
  const q: string[] = [];
  indeg.forEach((v, k) => { if (v === 0) q.push(k); });
  const order: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const s of succ.get(u)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) q.push(s);
    }
  }
  if (order.length !== acts.length) throw new Error("cycle in activity network");
  return order;
}

export function cpm(acts: Activity[], durOverride?: Record<string, number>): CpmResult {
  const byId = new Map(acts.map(a => [a.id, a]));
  const dur = (id: string) => Math.max(0, durOverride?.[id] ?? byId.get(id)!.dur);
  const order = topo(acts);

  const es = new Map<string, number>(), ef = new Map<string, number>();
  for (const id of order) {
    const a = byId.get(id)!;
    let start = 0;
    for (const l of a.preds ?? []) {
      const t = l.type ?? "FS", lag = l.lag ?? 0;
      const pes = es.get(l.id)!, pef = ef.get(l.id)!;
      const d = dur(id);
      let cand = 0;
      if (t === "FS") cand = pef + lag;
      else if (t === "SS") cand = pes + lag;
      else if (t === "FF") cand = pef + lag - d;
      else cand = pes + lag - d;                       // SF
      start = Math.max(start, cand);
    }
    es.set(id, start);
    ef.set(id, start + dur(id));
  }
  let finish = 0;
  for (const id of order) finish = Math.max(finish, ef.get(id)!);

  // backward pass
  const succLinks = new Map<string, { id: string; type: LinkType; lag: number }[]>();
  for (const id of order) succLinks.set(id, []);
  for (const a of acts) {
    for (const l of a.preds ?? []) {
      succLinks.get(l.id)!.push({ id: a.id, type: l.type ?? "FS", lag: l.lag ?? 0 });
    }
  }
  const ls = new Map<string, number>(), lf = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const d = dur(id);
    let late = finish;
    for (const s of succLinks.get(id)!) {
      const sls = ls.get(s.id)!, slf = lf.get(s.id)!;
      let cand: number;
      if (s.type === "FS") cand = sls - s.lag;                 // constrains my LF
      else if (s.type === "SS") cand = sls - s.lag + d;        // constrains my LS → LF = LS + d
      else if (s.type === "FF") cand = slf - s.lag;
      else cand = slf - s.lag + d;                             // SF constrains my LS
      late = Math.min(late, cand);
    }
    lf.set(id, late);
    ls.set(id, late - d);
  }

  const dates: Record<string, CpmDates> = {};
  const criticalPath: string[] = [];
  for (const id of order) {
    const tf = ls.get(id)! - es.get(id)!;
    const critical = Math.abs(tf) < 1e-9;
    dates[id] = { es: es.get(id)!, ef: ef.get(id)!, ls: ls.get(id)!, lf: lf.get(id)!, tf, critical };
    if (critical) criticalPath.push(id);
  }
  return { dates, finish, criticalPath };
}

/* ------------------------------------------------------------------ *
 * Statused schedule at time t (shared by windows & TIA)
 * ------------------------------------------------------------------ */

export function statusedForecast(
  acts: Activity[], asBuilt: Actuals, t: number,
): { finish: number; cpmResult: CpmResult; durAtT: Record<string, number>; fixedStart: Record<string, number> } {
  // Build effective durations + start constraints reflecting knowledge at t.
  const durAtT: Record<string, number> = {};
  const fixedStart: Record<string, number> = {};
  for (const a of acts) {
    const ab = asBuilt[a.id];
    if (ab && ab.finish <= t) {                     // completed before t → actual
      durAtT[a.id] = ab.finish - ab.start;
      fixedStart[a.id] = ab.start;
    } else if (ab && ab.start <= t) {               // in progress at t
      const elapsed = t - ab.start;
      const remaining = Math.max(0, a.dur - elapsed);
      durAtT[a.id] = elapsed + remaining;
      fixedStart[a.id] = ab.start;
    } else {
      durAtT[a.id] = a.dur;                          // future → planned
    }
  }
  // CPM with start floors for actually-started activities.
  const byId = new Map(acts.map(a => [a.id, a]));
  const order = topo(acts);
  const es = new Map<string, number>(), ef = new Map<string, number>();
  for (const id of order) {
    const a = byId.get(id)!;
    let start = fixedStart[id] ?? 0;
    if (!(id in fixedStart)) {
      for (const l of a.preds ?? []) {
        const tp = l.type ?? "FS", lag = l.lag ?? 0;
        const pes = es.get(l.id)!, pef = ef.get(l.id)!;
        const d = durAtT[id];
        let cand = 0;
        if (tp === "FS") cand = pef + lag;
        else if (tp === "SS") cand = pes + lag;
        else if (tp === "FF") cand = pef + lag - d;
        else cand = pes + lag - d;
        start = Math.max(start, cand);
      }
      start = Math.max(start, 0);
      // unstarted work cannot begin in the past
      start = Math.max(start, Math.min(t, start) === start && start < t ? t : start);
      if (start < t) start = t;
    }
    es.set(id, start);
    ef.set(id, start + durAtT[id]);
  }
  let finish = 0;
  for (const id of order) finish = Math.max(finish, ef.get(id)!);
  const cpmResult = cpm(acts, durAtT);
  return { finish, cpmResult, durAtT, fixedStart };
}

/* ------------------------------------------------------------------ *
 * Method 1 — As-Planned vs As-Built (observational post-mortem)
 * ------------------------------------------------------------------ */

export interface APABRow {
  id: string; name: string;
  plannedStart: number; plannedFinish: number;
  actualStart: number | null; actualFinish: number | null;
  startVar: number | null; finishVar: number | null;
  ownSlip: number | null;              // actual dur - planned dur
  plannedCritical: boolean; asBuiltCritical: boolean;
}

export interface APABResult {
  method: "as_planned_vs_as_built";
  rows: APABRow[];
  plannedFinish: number;
  asBuiltFinish: number;
  projectSlip: number;
  drivingChain: string[];              // as-built critical chain, start→finish
  narrative: string[];
}

export function asPlannedVsAsBuilt(acts: Activity[], asBuilt: Actuals): APABResult {
  const base = cpm(acts);
  const byId = new Map(acts.map(a => [a.id, a]));
  let abFinish = 0;
  for (const a of acts) {
    const ab = asBuilt[a.id];
    if (ab) abFinish = Math.max(abFinish, ab.finish);
  }
  // As-built critical chain: walk back from the last finisher through the
  // predecessor that controlled (pred.actualFinish drove succ.actualStart).
  const TOL = 0.51;
  let cursor: string | null = acts
    .filter(a => asBuilt[a.id])
    .sort((x, y) => asBuilt[y.id].finish - asBuilt[x.id].finish)[0]?.id ?? null;
  const chain: string[] = [];
  const inChain = new Set<string>();
  while (cursor !== null && !inChain.has(cursor)) {
    const cur: string = cursor;
    chain.push(cur); inChain.add(cur);
    const a = byId.get(cur)!;
    const abS = asBuilt[cur];
    let driver: string | null = null;
    let best = -Infinity;
    for (const l of a.preds ?? []) {
      const pab = asBuilt[l.id];
      if (!pab) continue;
      if (Math.abs(pab.finish - abS.start) <= TOL || pab.finish >= abS.start - TOL) {
        if (pab.finish > best) { best = pab.finish; driver = l.id; }
      }
    }
    cursor = driver;
  }
  chain.reverse();

  const rows: APABRow[] = acts.map(a => {
    const d = base.dates[a.id];
    const ab = asBuilt[a.id];
    return {
      id: a.id, name: a.name ?? a.id,
      plannedStart: d.es, plannedFinish: d.ef,
      actualStart: ab ? ab.start : null, actualFinish: ab ? ab.finish : null,
      startVar: ab ? ab.start - d.es : null,
      finishVar: ab ? ab.finish - d.ef : null,
      ownSlip: ab ? (ab.finish - ab.start) - a.dur : null,
      plannedCritical: d.critical,
      asBuiltCritical: inChain.has(a.id),
    };
  });
  const slip = abFinish - base.finish;
  const drivers = rows
    .filter(r => r.asBuiltCritical && (r.ownSlip ?? 0) > 0)
    .sort((x, y) => (y.ownSlip ?? 0) - (x.ownSlip ?? 0));
  const narrative = [
    `Planned completion day ${base.finish}; as-built completion day ${abFinish} — project slip ${slip} day(s).`,
    `As-built critical chain: ${chain.join(" → ")}.`,
    ...drivers.slice(0, 3).map(r =>
      `${r.name} consumed ${r.ownSlip} extra day(s) on the driving chain (planned ${byId.get(r.id)!.dur}d, actual ${(r.actualFinish! - r.actualStart!)}d).`),
  ];
  return { method: "as_planned_vs_as_built", rows, plannedFinish: base.finish,
           asBuiltFinish: abFinish, projectSlip: slip, drivingChain: chain, narrative };
}

/* ------------------------------------------------------------------ *
 * Method 2 — Impacted As-Planned (additive)
 * ------------------------------------------------------------------ */

export interface IAPStep {
  event: DelayEvent; finishBefore: number; finishAfter: number; impact: number;
}

export interface IAPResult {
  method: "impacted_as_planned";
  baselineFinish: number;
  impactedFinish: number;
  totalImpact: number;
  steps: IAPStep[];
  byParty: Record<Party, number>;
  narrative: string[];
}

export function impactedAsPlanned(acts: Activity[], events: DelayEvent[]): IAPResult {
  const base = cpm(acts);
  const durOv: Record<string, number> = {};
  for (const a of acts) durOv[a.id] = a.dur;
  let prevFinish = base.finish;
  const steps: IAPStep[] = [];
  const byParty: Record<Party, number> = { employer: 0, contractor: 0, neutral: 0 };
  const ordered = [...events].sort((x, y) => (x.atDay ?? 0) - (y.atDay ?? 0));
  for (const ev of ordered) {
    if (!(ev.activityId in durOv)) throw new Error(`event ${ev.id}: unknown activity ${ev.activityId}`);
    durOv[ev.activityId] += ev.days;
    const r = cpm(acts, durOv);
    const impact = r.finish - prevFinish;
    steps.push({ event: ev, finishBefore: prevFinish, finishAfter: r.finish, impact });
    byParty[ev.party] += impact;
    prevFinish = r.finish;
  }
  const narrative = [
    `Baseline completion day ${base.finish}; impacted completion day ${prevFinish} (+${prevFinish - base.finish}).`,
    ...steps.map(s =>
      `${s.event.name} (${s.event.party}, ${s.event.days}d on ${s.event.activityId}) → +${s.impact} day(s) to completion${s.impact < s.event.days ? " (partially absorbed by float)" : ""}.`),
    `Attribution — Employer ${byParty.employer}d · Contractor ${byParty.contractor}d · Neutral ${byParty.neutral}d.`,
  ];
  return { method: "impacted_as_planned", baselineFinish: base.finish,
           impactedFinish: prevFinish, totalImpact: prevFinish - base.finish,
           steps, byParty, narrative };
}

/* ------------------------------------------------------------------ *
 * Method 3 — Collapsed As-Built (but-for, subtractive)
 * ------------------------------------------------------------------ */

export interface CollapseScenario {
  removedParty: Party | "all";
  collapsedFinish: number;
  saved: number;                        // as-built finish − collapsed finish
}

export interface CollapsedResult {
  method: "collapsed_as_built";
  asBuiltFinish: number;
  scenarios: CollapseScenario[];
  byParty: Record<Party, number>;       // days saved but-for each party
  narrative: string[];
}

export function collapsedAsBuilt(
  acts: Activity[], asBuilt: Actuals, events: DelayEvent[],
): CollapsedResult {
  // As-built model: actual durations with the baseline logic.
  const abDur: Record<string, number> = {};
  for (const a of acts) {
    const ab = asBuilt[a.id];
    abDur[a.id] = ab ? ab.finish - ab.start : a.dur;
  }
  const abFinish = cpm(acts, abDur).finish;

  function collapse(remove: (e: DelayEvent) => boolean): number {
    const d = { ...abDur };
    for (const ev of events) {
      if (remove(ev)) d[ev.activityId] = Math.max(0, d[ev.activityId] - ev.days);
    }
    return cpm(acts, d).finish;
  }

  const parties: Party[] = ["employer", "contractor", "neutral"];
  const scenarios: CollapseScenario[] = parties.map(p => {
    const f = collapse(e => e.party === p);
    return { removedParty: p, collapsedFinish: f, saved: abFinish - f };
  });
  const all = collapse(() => true);
  scenarios.push({ removedParty: "all", collapsedFinish: all, saved: abFinish - all });

  const byParty: Record<Party, number> = { employer: 0, contractor: 0, neutral: 0 };
  for (const s of scenarios) {
    if (s.removedParty !== "all") byParty[s.removedParty] = s.saved;
  }
  const narrative = [
    `As-built completion day ${abFinish}.`,
    ...parties.map(p =>
      `But-for ${p} delay events, the project collapses to day ${scenarios.find(s => s.removedParty === p)!.collapsedFinish} — ${byParty[p]} day(s) attributable to ${p}.`),
    `Removing ALL events collapses to day ${all}${Math.abs(all - cpm(acts).finish) < 1e-9 ? " (matches the baseline — event set fully explains the slip)" : ""}.`,
  ];
  return { method: "collapsed_as_built", asBuiltFinish: abFinish, scenarios, byParty, narrative };
}

/* ------------------------------------------------------------------ *
 * Method 4 — Window / contemporaneous period analysis
 * ------------------------------------------------------------------ */

export interface WindowRow {
  from: number; to: number;
  forecastAtStart: number; forecastAtEnd: number;
  slip: number;
  attributed: { event: DelayEvent; days: number }[];
  byParty: Record<Party, number>;
  unexplained: number;
  criticalAtEnd: string[];
}

export interface WindowsResult {
  method: "window_analysis";
  windows: WindowRow[];
  totalSlip: number;
  byParty: Record<Party, number>;
  unexplained: number;
  narrative: string[];
}

export function windowAnalysis(
  acts: Activity[], asBuilt: Actuals, events: DelayEvent[],
  boundaries: number[],
): WindowsResult {
  const bs = [...boundaries].sort((a, b) => a - b);
  const windows: WindowRow[] = [];
  const totalByParty: Record<Party, number> = { employer: 0, contractor: 0, neutral: 0 };
  let unexplainedTotal = 0;

  for (let i = 0; i < bs.length - 1; i++) {
    const t0 = bs[i], t1 = bs[i + 1];
    const f0 = statusedForecast(acts, asBuilt, t0);
    const f1 = statusedForecast(acts, asBuilt, t1);
    const slip = f1.finish - f0.finish;
    const critical = new Set(f1.cpmResult.criticalPath);
    const inWin = events.filter(e =>
      (e.atDay ?? 0) >= t0 && (e.atDay ?? 0) < t1 && critical.has(e.activityId));
    const evDays = inWin.reduce((s, e) => s + e.days, 0);
    const scale = evDays > 0 ? Math.min(1, Math.max(0, slip) / evDays) : 0;
    const attributed = inWin.map(e => ({ event: e, days: +(e.days * scale).toFixed(2) }));
    const byParty: Record<Party, number> = { employer: 0, contractor: 0, neutral: 0 };
    for (const a of attributed) byParty[a.event.party] += a.days;
    const unexplained = +(Math.max(0, slip) - attributed.reduce((s, a) => s + a.days, 0)).toFixed(2);
    for (const p of Object.keys(byParty) as Party[]) totalByParty[p] += byParty[p];
    unexplainedTotal += unexplained;
    windows.push({
      from: t0, to: t1, forecastAtStart: f0.finish, forecastAtEnd: f1.finish,
      slip, attributed, byParty, unexplained,
      criticalAtEnd: f1.cpmResult.criticalPath,
    });
  }
  const totalSlip = windows.reduce((s, w) => s + w.slip, 0);
  const narrative = [
    `${windows.length} window(s); cumulative slip ${totalSlip} day(s) (forecast day ${windows[0]?.forecastAtStart} → ${windows[windows.length - 1]?.forecastAtEnd}).`,
    ...windows.map(w =>
      `Window ${w.from}–${w.to}: slip ${w.slip}d (${w.attributed.map(a => `${a.event.name} ${a.days}d`).join(", ") || "no critical events"}${w.unexplained > 0 ? `, unexplained ${w.unexplained}d` : ""}).`),
    `Attribution — Employer ${totalByParty.employer.toFixed(1)}d · Contractor ${totalByParty.contractor.toFixed(1)}d · Neutral ${totalByParty.neutral.toFixed(1)}d · Unexplained ${unexplainedTotal.toFixed(1)}d.`,
  ];
  return { method: "window_analysis", windows, totalSlip, byParty: totalByParty,
           unexplained: unexplainedTotal, narrative };
}

/* ------------------------------------------------------------------ *
 * Method 5 — Time Impact Analysis (fragnet at data date)
 * ------------------------------------------------------------------ */

export interface TIAResult {
  method: "time_impact_analysis";
  dataDate: number;
  forecastWithout: number;
  forecastWith: number;
  impact: number;
  fragnet: DelayEvent;
  criticalAfter: string[];
  narrative: string[];
}

export function timeImpactAnalysis(
  acts: Activity[], asBuilt: Actuals, fragnet: DelayEvent, dataDate: number,
): TIAResult {
  const before = statusedForecast(acts, asBuilt, dataDate);
  // insert fragnet: extend the impacted activity's remaining duration
  const dur = { ...before.durAtT };
  if (!(fragnet.activityId in dur)) throw new Error(`fragnet targets unknown activity ${fragnet.activityId}`);
  dur[fragnet.activityId] += fragnet.days;
  const after = cpm(acts, dur);
  // completion must respect statused starts too — approximate with max()
  const withFinish = Math.max(after.finish, before.finish);
  const impact = withFinish - before.finish;
  const narrative = [
    `Data date day ${dataDate}: forecast completion day ${before.finish}.`,
    `Inserting fragnet "${fragnet.name}" (${fragnet.party}, ${fragnet.days}d on ${fragnet.activityId}) moves forecast to day ${withFinish}.`,
    `Time impact: ${impact} day(s)${impact < fragnet.days ? " (partially absorbed by float)" : ""} — prima facie EOT entitlement if the event is excusable.`,
  ];
  return { method: "time_impact_analysis", dataDate, forecastWithout: before.finish,
           forecastWith: withFinish, impact, fragnet,
           criticalAfter: after.criticalPath, narrative };
}
