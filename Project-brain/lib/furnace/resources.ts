/**
 * resources.ts — resource loading, histogram and levelling.
 *
 * Everything works in the same integer working-day units as cpmEngine, so a
 * "period" here is one working day and lines up exactly with es/ef. Dates only
 * appear at the display boundary, through WorkCalendar.
 *
 * Levelling uses the serial method (the heuristic P6 and MS Project both use
 * by default): order activities by priority, then place each at the earliest
 * unit where its predecessors are satisfied *and* every resource it needs has
 * spare capacity for the whole of its duration. Optimal resource-constrained
 * scheduling is NP-hard, so a heuristic is the honest choice — but it must be
 * a heuristic that never violates logic, which is asserted in the tests.
 */
import { CpmActivity, CpmLink, CpmResult } from "@/lib/furnace/cpmEngine";

export interface Resource {
  id: string;
  name: string;
  /** Units available per working day. */
  capacity: number;
  unit?: string;          // "men", "cum/day", "T/day"
  color?: string;
}

export interface Assignment {
  activityId: string;
  resourceId: string;
  /** Units consumed per working day while the activity is in progress. */
  perDay: number;
}

export interface HistogramBucket {
  unit: number;
  demand: number;
  capacity: number;
  over: boolean;
  activityIds: string[];
}

export interface ResourceHistogram {
  resourceId: string;
  resourceName: string;
  capacity: number;
  buckets: HistogramBucket[];
  peak: number;
  peakUnit: number;
  totalDemand: number;          // resource-days
  overallocatedUnits: number;
  utilisation: number;          // 0..1 against capacity over the span
}

export interface LevellingResult {
  /** activityId -> new start unit. */
  starts: Record<string, number>;
  /** activityId -> units of delay applied. */
  delays: Record<string, number>;
  originalDuration: number;
  leveledDuration: number;
  extensionUnits: number;
  movedCount: number;
  /** Activities delayed beyond their float, i.e. the new critical drivers. */
  criticalDelays: string[];
  unresolved: string[];         // could never fit; see notes
}

const byId = <T extends { id: string }>(xs: T[]) =>
  xs.reduce<Record<string, T>>((m, x) => { m[x.id] = x; return m; }, {});

/**
 * Demand per unit for one resource, given a start-unit map.
 *
 * An activity occupies units start .. start+duration-1, matching the engine's
 * exclusive-end convention (ef = es + duration).
 */
export function buildHistogram(
  activities: CpmActivity[],
  starts: Record<string, number>,
  assignments: Assignment[],
  resource: Resource,
  horizon?: number,
): ResourceHistogram {
  const acts = byId(activities);
  const relevant = assignments.filter((a) => a.resourceId === resource.id);

  let maxUnit = 0;
  relevant.forEach((as) => {
    const act = acts[as.activityId];
    if (!act) return;
    const s = starts[as.activityId] ?? 0;
    maxUnit = Math.max(maxUnit, s + Math.max(0, act.duration));
  });
  const span = Math.max(1, horizon ?? maxUnit);

  const demand = new Array(span).fill(0);
  const who: string[][] = Array.from({ length: span }, () => []);

  relevant.forEach((as) => {
    const act = acts[as.activityId];
    if (!act || act.duration <= 0) return;      // milestones consume nothing
    const s = Math.max(0, starts[as.activityId] ?? 0);
    for (let u = s; u < s + act.duration && u < span; u++) {
      demand[u] += as.perDay;
      who[u].push(as.activityId);
    }
  });

  const buckets: HistogramBucket[] = demand.map((d, u) => ({
    unit: u,
    demand: Math.round(d * 100) / 100,
    capacity: resource.capacity,
    over: d > resource.capacity + 1e-9,
    activityIds: who[u],
  }));

  const peak = demand.length ? Math.max(...demand) : 0;
  const totalDemand = demand.reduce((a, b) => a + b, 0);
  const activeUnits = demand.filter((d) => d > 0).length;

  return {
    resourceId: resource.id,
    resourceName: resource.name,
    capacity: resource.capacity,
    buckets,
    peak: Math.round(peak * 100) / 100,
    peakUnit: demand.indexOf(peak),
    totalDemand: Math.round(totalDemand * 100) / 100,
    overallocatedUnits: buckets.filter((b) => b.over).length,
    utilisation: activeUnits && resource.capacity
      ? Math.min(1, totalDemand / (activeUnits * resource.capacity))
      : 0,
  };
}

export function buildAllHistograms(
  activities: CpmActivity[],
  starts: Record<string, number>,
  assignments: Assignment[],
  resources: Resource[],
  horizon?: number,
): ResourceHistogram[] {
  return resources.map((r) =>
    buildHistogram(activities, starts, assignments, r, horizon));
}

/** Earliest start for `act` given already-placed predecessors, per link type. */
function earliestFromLogic(
  actId: string,
  duration: number,
  links: CpmLink[],
  starts: Record<string, number>,
  durations: Record<string, number>,
): number {
  let earliest = 0;
  links.filter((l) => l.succ === actId).forEach((l) => {
    const ps = starts[l.pred];
    if (ps === undefined) return;
    const pd = durations[l.pred] ?? 0;
    const pf = ps + pd;
    const lag = l.lag ?? 0;
    switch (l.type) {
      case "FS": earliest = Math.max(earliest, pf + lag); break;
      case "SS": earliest = Math.max(earliest, ps + lag); break;
      case "FF": earliest = Math.max(earliest, pf + lag - duration); break;
      case "SF": earliest = Math.max(earliest, ps + lag - duration); break;
    }
  });
  return Math.max(0, earliest);
}

/**
 * Serial resource levelling.
 *
 * Priority order is least-total-float first (critical work keeps its slot),
 * then earliest early start, then longest duration — the same tie-breaking P6
 * applies. Activities with float absorb delay before the project end moves.
 *
 * `maxExtension` caps how far the project may stretch; anything that still
 * cannot fit is reported in `unresolved` and left at its logic-earliest start
 * rather than being pushed out indefinitely. Silently extending a Ministry
 * schedule by years to satisfy a mistyped capacity would be worse than saying
 * it does not fit.
 */
export function levelResources(
  activities: CpmActivity[],
  links: CpmLink[],
  result: CpmResult,
  assignments: Assignment[],
  resources: Resource[],
  opts: { maxExtension?: number } = {},
): LevellingResult {
  const acts = byId(activities);
  const durations: Record<string, number> = {};
  activities.forEach((a) => { durations[a.id] = Math.max(0, a.duration); });

  const resById = byId(resources);
  const assignsByAct = assignments.reduce<Record<string, Assignment[]>>((m, a) => {
    (m[a.activityId] ??= []).push(a);
    return m;
  }, {});

  const originalDuration = result.projectDuration;
  const maxExtension = opts.maxExtension ?? Math.max(365, originalDuration);
  const horizon = originalDuration + maxExtension + 1;

  // usage[resourceId][unit]
  const usage: Record<string, number[]> = {};
  resources.forEach((r) => { usage[r.id] = new Array(horizon).fill(0); });

  const order = [...activities].sort((a, b) => {
    const fa = result.tf[a.id] ?? 0, fb = result.tf[b.id] ?? 0;
    if (fa !== fb) return fa - fb;
    const ea = result.es[a.id] ?? 0, eb = result.es[b.id] ?? 0;
    if (ea !== eb) return ea - eb;
    return (b.duration ?? 0) - (a.duration ?? 0);
  });

  const starts: Record<string, number> = {};
  const delays: Record<string, number> = {};
  const unresolved: string[] = [];

  // Predecessors must be placed first or earliestFromLogic sees nothing.
  const placed = new Set<string>();
  const queue = [...order];
  let guard = queue.length * queue.length + 100;

  while (queue.length && guard-- > 0) {
    const act = queue.shift()!;
    const preds = links.filter((l) => l.succ === act.id).map((l) => l.pred);
    if (preds.some((p) => acts[p] && !placed.has(p))) {
      queue.push(act);               // wait for predecessors
      continue;
    }

    const dur = durations[act.id];
    const logicEarliest = earliestFromLogic(act.id, dur, links, starts, durations);
    const mine = assignsByAct[act.id] ?? [];

    let unit = logicEarliest;
    let fits = false;
    const limit = Math.min(horizon - dur - 1, logicEarliest + maxExtension);

    if (dur <= 0 || mine.length === 0) {
      fits = true;                   // milestones and unresourced work never block
    } else {
      for (; unit <= limit; unit++) {
        fits = mine.every((as) => {
          const res = resById[as.resourceId];
          if (!res) return true;     // unknown resource cannot constrain
          const use = usage[as.resourceId];
          for (let u = unit; u < unit + dur; u++) {
            if ((use[u] ?? 0) + as.perDay > res.capacity + 1e-9) return false;
          }
          return true;
        });
        if (fits) break;
      }
    }

    if (!fits) {
      unresolved.push(act.id);
      unit = logicEarliest;
    }

    starts[act.id] = unit;
    delays[act.id] = unit - (result.es[act.id] ?? unit);
    mine.forEach((as) => {
      const use = usage[as.resourceId];
      if (!use) return;
      for (let u = unit; u < unit + dur; u++) use[u] = (use[u] ?? 0) + as.perDay;
    });
    placed.add(act.id);
  }

  // anything the guard left unplaced keeps its CPM start
  activities.forEach((a) => {
    if (starts[a.id] === undefined) {
      starts[a.id] = result.es[a.id] ?? 0;
      delays[a.id] = 0;
      if (!unresolved.includes(a.id)) unresolved.push(a.id);
    }
  });

  const leveledDuration = Math.max(
    0, ...activities.map((a) => (starts[a.id] ?? 0) + durations[a.id]));
  const criticalDelays = activities
    .filter((a) => (delays[a.id] ?? 0) > (result.tf[a.id] ?? 0))
    .map((a) => a.id);

  return {
    starts,
    delays,
    originalDuration,
    leveledDuration,
    extensionUnits: Math.max(0, leveledDuration - originalDuration),
    movedCount: activities.filter((a) => (delays[a.id] ?? 0) > 0).length,
    criticalDelays,
    unresolved,
  };
}

/** Convenience: are any resources over-allocated at the given starts? */
export function hasOverallocation(
  activities: CpmActivity[],
  starts: Record<string, number>,
  assignments: Assignment[],
  resources: Resource[],
): boolean {
  return buildAllHistograms(activities, starts, assignments, resources)
    .some((h) => h.overallocatedUnits > 0);
}

/** Starts map straight from a CPM result, for the un-levelled view. */
export function startsFromCpm(result: CpmResult): Record<string, number> {
  return { ...result.es };
}
