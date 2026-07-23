/**
 * ganttGeometry.ts — pure date/pixel maths for the baseline comparison Gantt.
 *
 * Kept free of React and of gantt-task-react on purpose. Overlaying baseline
 * bars onto that library would mean replicating its private date-to-x
 * internals, and a version bump that shifted them by a few pixels would
 * silently misalign every baseline bar — worse than showing none, because the
 * variance would look real. Owning the scale means alignment is guaranteed and
 * the maths is unit-testable without a DOM.
 */

export type ZoomMode = "day" | "week" | "month" | "quarter";

export interface Tick {
  x: number;
  label: string;
  major: boolean;
}

export interface TimeScale {
  min: number;              // epoch ms of the left edge
  max: number;              // epoch ms of the right edge
  width: number;            // total drawable width in px
  pxPerDay: number;
  x: (d: Date | string | number | null | undefined) => number | null;
  ticks: Tick[];
}

export const DAY_MS = 86400000;

const PX_PER_DAY: Record<ZoomMode, number> = {
  day: 26,
  week: 7,
  month: 2.4,
  quarter: 0.9,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Midnight UTC of the day containing `ms`, so bar edges land on day boundaries. */
function floorDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function addMonthsUtc(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

function buildTicks(min: number, max: number, mode: ZoomMode, pxPerDay: number): Tick[] {
  const ticks: Tick[] = [];
  const xOf = (ms: number) => ((ms - min) / DAY_MS) * pxPerDay;

  if (mode === "day" || mode === "week") {
    // weekly gridlines, month boundaries major
    const startDow = new Date(min).getUTCDay();
    let cursor = min + ((7 - startDow) % 7) * DAY_MS;
    let lastMonth = -1;
    while (cursor <= max) {
      const d = new Date(cursor);
      const month = d.getUTCMonth();
      const major = month !== lastMonth;
      lastMonth = month;
      ticks.push({
        x: xOf(cursor),
        label: major ? `${MONTHS[month]} ${String(d.getUTCFullYear()).slice(2)}`
          : `${d.getUTCDate()}`,
        major,
      });
      cursor += 7 * DAY_MS;
    }
    return ticks;
  }

  // month / quarter: one tick per month, quarter boundaries major
  let cursor = Date.UTC(new Date(min).getUTCFullYear(), new Date(min).getUTCMonth(), 1);
  if (cursor < min) cursor = addMonthsUtc(cursor, 1);
  const step = mode === "quarter" ? 3 : 1;
  while (cursor <= max) {
    const d = new Date(cursor);
    const month = d.getUTCMonth();
    const major = month % 3 === 0;
    ticks.push({
      x: xOf(cursor),
      label: major && month === 0 ? `${d.getUTCFullYear()}`
        : `${MONTHS[month]}${major ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}`,
      major,
    });
    cursor = addMonthsUtc(cursor, step);
  }
  return ticks;
}

/**
 * Build a scale spanning every supplied date, with padding either side so bars
 * never touch the edge. Invalid and null dates are ignored rather than
 * collapsing the range to the epoch.
 */
export function buildTimeScale(
  dates: (Date | string | number | null | undefined)[],
  mode: ZoomMode = "week",
  opts: { padDays?: number; minWidth?: number } = {},
): TimeScale {
  const padDays = opts.padDays ?? 7;
  const valid = dates.map(toMs).filter((m): m is number => m !== null);

  let min: number, max: number;
  if (valid.length === 0) {
    // no dates at all: show a neutral month around today rather than 1970
    const today = floorDay(Date.now());
    min = today - 15 * DAY_MS;
    max = today + 15 * DAY_MS;
  } else {
    min = floorDay(Math.min(...valid)) - padDays * DAY_MS;
    max = floorDay(Math.max(...valid)) + padDays * DAY_MS;
    if (max <= min) max = min + 30 * DAY_MS;   // single-date schedules
  }

  const pxPerDay = PX_PER_DAY[mode];
  const spanDays = (max - min) / DAY_MS;
  const width = Math.max(opts.minWidth ?? 320, spanDays * pxPerDay);

  const x = (d: Date | string | number | null | undefined): number | null => {
    const ms = toMs(d);
    if (ms === null) return null;
    return ((ms - min) / DAY_MS) * pxPerDay;
  };

  return { min, max, width, pxPerDay, x, ticks: buildTicks(min, max, mode, pxPerDay) };
}

export interface BarRect {
  x: number;
  width: number;
  clippedLeft: boolean;
  clippedRight: boolean;
}

/**
 * Rectangle for a bar between two dates, clamped to the scale.
 *
 * A zero-length or reversed span still yields a visible sliver (minWidth) — a
 * milestone or a same-day activity must not vanish, and a reversed pair means
 * bad data the planner needs to see rather than a bar that silently disappears.
 */
export function barRect(
  scale: TimeScale,
  start: Date | string | number | null | undefined,
  end: Date | string | number | null | undefined,
  minWidth = 3,
): BarRect | null {
  const s = toMs(start);
  const e = toMs(end);
  if (s === null && e === null) return null;
  const from = Math.min(s ?? e!, e ?? s!);
  const to = Math.max(s ?? e!, e ?? s!);

  const clippedLeft = from < scale.min;
  const clippedRight = to > scale.max;
  const cl = Math.max(from, scale.min);
  const cr = Math.min(to, scale.max);
  if (cr < cl) return null;                       // entirely outside the window

  const x = scale.x(cl)!;
  const width = Math.max(minWidth, scale.x(cr)! - x);
  return { x, width, clippedLeft, clippedRight };
}

/** Whole days between two dates; positive means `later` is after `earlier`. */
export function dayDelta(
  later: Date | string | number | null | undefined,
  earlier: Date | string | number | null | undefined,
): number | null {
  const a = toMs(later);
  const b = toMs(earlier);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY_MS);
}

/**
 * The shaded span between a baseline finish and the current finish — the
 * visual the whole panel exists for. Returns null when there is no variance
 * or either date is unknown.
 */
export function varianceRect(
  scale: TimeScale,
  baselineFinish: Date | string | number | null | undefined,
  currentFinish: Date | string | number | null | undefined,
): (BarRect & { direction: "slip" | "gain" }) | null {
  const b = toMs(baselineFinish);
  const c = toMs(currentFinish);
  if (b === null || c === null || b === c) return null;
  const rect = barRect(scale, Math.min(b, c), Math.max(b, c), 2);
  if (!rect) return null;
  return { ...rect, direction: c > b ? "slip" : "gain" };
}
