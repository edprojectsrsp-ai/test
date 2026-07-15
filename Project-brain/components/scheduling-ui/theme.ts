// theme.ts — design tokens for the scheduling UI.
// Inline-style friendly (no Tailwind / CSS-module assumptions) so the
// components drop into any React app.

export const theme = {
  color: {
    // brand
    teal: "var(--steel)",
    tealDark: "var(--steel-deep)",
    tealSoft: "var(--steel-soft)",
    // chrome / neutrals (graphite scale)
    ink: "var(--ink)",
    slate: "var(--ink-2)",
    muted: "var(--ink-3)",
    line: "var(--line)",
    lineStrong: "var(--line-2)",
    panel: "var(--panel)",
    canvas: "var(--bg)",
    canvasAlt: "var(--panel-2)",
    // status
    critical: "var(--steel)", // critical path uses brand steel
    nearCritical: "var(--ember)",
    negFloat: "var(--molten)",
    ahead: "var(--verdigris)",
    onTrack: "var(--steel-2)",
    slipping: "var(--ember)",
    critDelay: "var(--molten)",
    // baseline ghost bar
    baseline: "var(--ink-4)",
    pass: "var(--verdigris)",
    fail: "var(--molten)",
    gridWeekend: "var(--panel-3)",
    today: "var(--molten)",
  },
  font: {
    ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    // tabular monospace for every number/date cell — the professional-tool tell
    mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  },
  radius: { sm: 4, md: 6, lg: 10 },
  shadow: {
    card: "0 1px 2px rgba(16,32,31,.06), 0 1px 3px rgba(16,32,31,.04)",
    pop: "0 8px 24px rgba(16,32,31,.12)",
  },
  size: {
    rowH: 30, // grid + Gantt row height (kept in lock-step)
    headerH: 56,
    dayW: 16, // px per working day at zoom=1 (week zoom)
  },
} as const;

export const delayColor = (c: string): string => {
  switch (c) {
    case "ahead":
      return theme.color.ahead;
    case "on_track":
      return theme.color.onTrack;
    case "slipping":
      return theme.color.slipping;
    case "critical_delay":
      return theme.color.critDelay;
    default:
      return theme.color.muted;
  }
};

export const healthColor = (h: string): string =>
  h === "good" ? theme.color.ahead : h === "watch" ? theme.color.nearCritical : theme.color.negFloat;

// ---- working-day date helpers (calendar-agnostic display math) -----------
// Mirrors the backend convention for *rendering* only. The authoritative
// CPM math lives server-side; this just maps dates onto an x-axis.

export const parseISO = (s: string | null | undefined): Date | null =>
  s ? new Date(s + "T00:00:00") : null;

export const fmtDate = (s: string | null | undefined): string => {
  const d = parseISO(s ?? null);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const dayDiff = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

export const isWeekend = (d: Date): boolean => {
  const g = d.getDay();
  return g === 0 || g === 6;
};
