/**
 * workCalendar.ts — working-time calendar for the browser CPM engine.
 *
 * A deliberate mirror of the backend's app/core/calendar.py. The backend CPM
 * runs in integer *working-day units* and converts units to dates only at the
 * boundary; the browser engine ran the same unit maths but mapped units to
 * dates by plain addition, so every bar drew straight through weekends and
 * holidays. On a five-day calendar a 100-unit activity is 140 calendar days,
 * meaning the client Gantt could show a finish two months earlier than the
 * official backend run for the same schedule.
 *
 * Conventions match the backend exactly (and therefore P6 / MS Project):
 *   - a "unit" is one whole working day
 *   - an activity of duration D starting at unit s occupies s .. s+D-1,
 *     so a one-day task starting Monday also finishes Monday
 *   - working_weekdays uses ISO numbering, Mon=1 .. Sun=7
 *
 * All dates are handled in UTC. Local-time arithmetic would shift a day either
 * side of a DST boundary and quietly move activities by one day twice a year.
 */

export const DAY_MS = 86400000;

export interface WorkCalendarSpec {
  name?: string;
  /** ISO weekday numbers that are working days. Mon=1 .. Sun=7. */
  workingWeekdays?: number[];
  /** ISO date strings ("2026-01-26") that are non-working. */
  holidays?: string[];
  /** ISO date strings forced to be working even if weekend or holiday. */
  exceptionsWork?: string[];
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

/** Midnight UTC of the day containing `ms`. */
function floorDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function isoKey(ms: number): string {
  return new Date(floorDay(ms)).toISOString().slice(0, 10);
}

/** ISO weekday (Mon=1 .. Sun=7) for a UTC timestamp. */
function isoWeekday(ms: number): number {
  const jsDay = new Date(ms).getUTCDay();   // Sun=0 .. Sat=6
  return jsDay === 0 ? 7 : jsDay;
}

export function parseDate(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? floorDay(value) : null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : floorDay(ms);
}

export class WorkCalendar {
  readonly name: string;
  private readonly weekdays: Set<number>;
  private readonly holidays: Set<string>;
  private readonly exceptions: Set<string>;

  /** unit index -> epoch ms, built lazily and extended on demand. */
  private unitToMs: number[] = [];
  private anchorMs: number | null = null;

  constructor(spec: WorkCalendarSpec = {}) {
    this.name = spec.name ?? "Standard 5-Day";
    const wd = spec.workingWeekdays?.length ? spec.workingWeekdays : DEFAULT_WEEKDAYS;
    this.weekdays = new Set(wd.filter((d) => d >= 1 && d <= 7));
    // A calendar with no working days would hang every stepping loop below.
    if (this.weekdays.size === 0) DEFAULT_WEEKDAYS.forEach((d) => this.weekdays.add(d));
    this.holidays = new Set((spec.holidays ?? []).map((h) => h.slice(0, 10)));
    this.exceptions = new Set((spec.exceptionsWork ?? []).map((h) => h.slice(0, 10)));
  }

  static standard5Day(): WorkCalendar {
    return new WorkCalendar();
  }

  static continuous(): WorkCalendar {
    return new WorkCalendar({ name: "7-Day Continuous", workingWeekdays: [1, 2, 3, 4, 5, 6, 7] });
  }

  isWorkingDay(value: Date | string | number): boolean {
    const ms = parseDate(value);
    if (ms === null) return false;
    const key = isoKey(ms);
    if (this.exceptions.has(key)) return true;
    if (this.holidays.has(key)) return false;
    return this.weekdays.has(isoWeekday(ms));
  }

  firstWorkingOnOrAfter(ms: number): number {
    let d = floorDay(ms);
    for (let guard = 0; guard < 3660 && !this.isWorkingDay(d); guard++) d += DAY_MS;
    return d;
  }

  firstWorkingOnOrBefore(ms: number): number {
    let d = floorDay(ms);
    for (let guard = 0; guard < 3660 && !this.isWorkingDay(d); guard++) d -= DAY_MS;
    return d;
  }

  nextWorkingDay(ms: number): number {
    return this.firstWorkingOnOrAfter(floorDay(ms) + DAY_MS);
  }

  prevWorkingDay(ms: number): number {
    return this.firstWorkingOnOrBefore(floorDay(ms) - DAY_MS);
  }

  /** Set the unit-0 anchor. Snaps forward to the first working day, as the backend does. */
  setAnchor(value: Date | string | number): void {
    const ms = parseDate(value);
    if (ms === null) return;
    const anchor = this.firstWorkingOnOrAfter(ms);
    if (anchor !== this.anchorMs) {
      this.anchorMs = anchor;
      this.unitToMs = [anchor];
    }
  }

  private ensureAnchor(): number {
    if (this.anchorMs === null) this.setAnchor(Date.now());
    return this.anchorMs!;
  }

  /**
   * Date for a working-day unit index. Units may be negative (a constraint or
   * actual date before the anchor), which is why the backward branch exists.
   */
  dateForUnit(unit: number): Date {
    return new Date(this.msForUnit(unit));
  }

  msForUnit(unit: number): number {
    const anchor = this.ensureAnchor();
    const n = Math.round(unit);
    if (n < 0) {
      let ms = anchor;
      for (let i = 0; i < -n; i++) ms = this.prevWorkingDay(ms);
      return ms;
    }
    // cache grows forward only; typical schedules reuse the same prefix
    while (this.unitToMs.length <= n) {
      const last = this.unitToMs[this.unitToMs.length - 1];
      this.unitToMs.push(this.nextWorkingDay(last));
    }
    return this.unitToMs[n];
  }

  /** Working-day unit index for a date, relative to the anchor. */
  unitForDate(value: Date | string | number | null | undefined): number | null {
    const ms = parseDate(value);
    if (ms === null) return null;
    const anchor = this.ensureAnchor();
    if (ms === anchor) return 0;
    if (ms > anchor) {
      // count working days in (anchor, ms]
      let count = 0;
      let cursor = anchor;
      for (let guard = 0; guard < 200000 && cursor < ms; guard++) {
        cursor = this.nextWorkingDay(cursor);
        if (cursor <= ms) count++;
      }
      return count;
    }
    let count = 0;
    let cursor = anchor;
    for (let guard = 0; guard < 200000 && cursor > ms; guard++) {
      cursor = this.prevWorkingDay(cursor);
      if (cursor >= ms) count--;
    }
    return count;
  }

  /**
   * Inclusive count of working days in [start, end]; negative if reversed.
   * Matches the backend's working_days_between.
   */
  workingDaysBetween(
    start: Date | string | number,
    end: Date | string | number,
  ): number {
    const a = parseDate(start);
    const b = parseDate(end);
    if (a === null || b === null) return 0;
    if (a > b) return -this.workingDaysBetween(end, start);
    let count = 0;
    let cursor = a;
    for (let guard = 0; guard < 200000 && cursor <= b; guard++) {
      if (this.isWorkingDay(cursor)) count++;
      cursor += DAY_MS;
    }
    return count;
  }

  /** Date `n` working days from `start`, counting start as unit 0. */
  addWorkingDays(start: Date | string | number, n: number): Date {
    const s = parseDate(start);
    if (s === null) return new Date(NaN);
    let ms = this.firstWorkingOnOrAfter(s);
    const step = n >= 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(Math.round(n)); i++) {
      ms = step > 0 ? this.nextWorkingDay(ms) : this.prevWorkingDay(ms);
    }
    return new Date(ms);
  }

  /**
   * Bar end date for a Gantt, in exclusive-end form.
   *
   * The engine's EF is exclusive (es + duration), but the last worked day is
   * unit ef-1. Drawing a bar to date(ef) would stretch it across whatever
   * non-working days follow, so the bar ends the day after the last worked
   * day and a Friday finish stops at Saturday rather than running to Monday.
   */
  barEndForUnit(efUnit: number): Date {
    const lastWorked = this.msForUnit(Math.max(0, Math.round(efUnit) - 1));
    return new Date(lastWorked + DAY_MS);
  }
}

/** Convenience: build from whatever a schedule payload happens to carry. */
export function calendarFromSchedule(net: {
  workingWeekdays?: number[];
  holidays?: string[];
  exceptionsWork?: string[];
  calendarName?: string;
} | null | undefined): WorkCalendar {
  if (!net) return WorkCalendar.standard5Day();
  return new WorkCalendar({
    name: net.calendarName,
    workingWeekdays: net.workingWeekdays,
    holidays: net.holidays,
    exceptionsWork: net.exceptionsWork,
  });
}
