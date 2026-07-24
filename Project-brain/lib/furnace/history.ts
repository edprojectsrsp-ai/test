/**
 * history.ts — undo/redo for schedule edits.
 *
 * A planner dragging bars on a live CPM needs to be able to back out: one bad
 * drag reflows the whole downstream network, and without undo the only
 * recovery is reloading and losing every other change.
 *
 * Snapshot-based rather than command-based. Schedule edits already trigger a
 * full CPM re-run, so a snapshot of the activity/link arrays costs about the
 * same as the recompute it accompanies, and it cannot drift out of sync the
 * way an inverse-command list can when a new edit type is added later.
 *
 * Coalescing exists because a drag fires continuously: without it, one bar
 * movement would push fifty entries and undo would crawl back pixel by pixel.
 * Consecutive edits with the same `mergeKey` inside `coalesceMs` collapse into
 * one entry, so undo steps match what the user perceives as one action.
 */

export interface HistoryEntry<T> {
  state: T;
  label: string;
  at: number;
  mergeKey?: string;
}

export interface HistoryOptions {
  /** Entries kept in each direction. */
  limit?: number;
  /** Window within which same-key edits merge into one entry. */
  coalesceMs?: number;
}

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: HistoryEntry<T> | null = null;
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(initial?: T, label = "Initial", opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 50;
    this.coalesceMs = opts.coalesceMs ?? 600;
    if (initial !== undefined) {
      this.current = { state: initial, label, at: Date.now() };
    }
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get depth(): number { return this.past.length; }
  get redoDepth(): number { return this.future.length; }
  get state(): T | null { return this.current?.state ?? null; }

  /** Label of the edit that undo would reverse. */
  get undoLabel(): string | null { return this.current?.label ?? null; }
  /** Label of the edit that redo would reapply. */
  get redoLabel(): string | null {
    return this.future.length ? this.future[this.future.length - 1].label : null;
  }

  /**
   * Record a new state. Any redo branch is discarded, matching every editor a
   * user has ever used: editing after undo abandons the abandoned future.
   */
  push(state: T, label: string, mergeKey?: string, now = Date.now()): void {
    if (this.current === null) {
      this.current = { state, label, at: now, mergeKey };
      return;
    }
    const mergeable =
      mergeKey !== undefined &&
      this.current.mergeKey === mergeKey &&
      now - this.current.at <= this.coalesceMs;

    if (mergeable) {
      // keep the original label and timestamp anchor: this is still the same
      // user action, just a later frame of it
      this.current = { state, label: this.current.label, at: this.current.at, mergeKey };
      this.future = [];
      return;
    }

    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = { state, label, at: now, mergeKey };
    this.future = [];
  }

  undo(): T | null {
    if (!this.past.length || !this.current) return null;
    this.future.push(this.current);
    if (this.future.length > this.limit) this.future.shift();
    this.current = this.past.pop()!;
    return this.current.state;
  }

  redo(): T | null {
    if (!this.future.length || !this.current) return null;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = this.future.pop()!;
    return this.current.state;
  }

  /** Drop all history, keeping the current state as the new origin. */
  reset(state?: T, label = "Reset"): void {
    this.past = [];
    this.future = [];
    if (state !== undefined) this.current = { state, label, at: Date.now() };
  }

  /** Recent labels, newest first — for a history dropdown. */
  labels(n = 10): string[] {
    const out: string[] = [];
    if (this.current) out.push(this.current.label);
    for (let i = this.past.length - 1; i >= 0 && out.length < n; i--) {
      out.push(this.past[i].label);
    }
    return out;
  }
}

/**
 * Is this keyboard event an undo/redo shortcut?
 * Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo (Windows and Mac both).
 * Returns null when the event is anything else, or when focus is in a text
 * field — the browser's own undo must win there.
 */
export function historyShortcut(e: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  target?: unknown;
}): "undo" | "redo" | null {
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | undefined;
  const tag = el?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
    return null;
  }
  if (!e.ctrlKey && !e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}
