# Scheduling UI — Frontend Handoff

TypeScript + React components for the Scheduling & Project Control Module, built to drop
into an existing Next.js 16 / React 19 app (e.g. Project Brain). No Tailwind or CSS-module
build config required — styling is via a shared token object (`theme.ts`) and inline
styles, so the components are portable as-is.

A rendered preview of all of this (built from these exact files) ships as
`schedule_ui_preview.html` at the package root — open it in any browser.

## Files

| File | What it is |
|---|---|
| `types.ts` | TS interfaces mirroring the `/api/scheduling/*` JSON |
| `theme.ts` | design tokens (brand teal, status colors, type scale) + date helpers |
| `api.ts` | `SchedulingApi` — typed fetch client for every endpoint |
| `rows.ts` | `buildRows()` — flattens WBS + activities into one ordered list (keeps grid & Gantt in lock-step) |
| `ScheduleGrid.tsx` | spreadsheet panel: WBS tree, expand/collapse, columns, critical accents, status pills |
| `GanttChart.tsx` | SVG Gantt: current + baseline ghost bars, progress fill, milestones, FS/SS/FF/SF arrows, data-date line, weekend shading |
| `DelayDashboard.tsx` | summary cards + variance bar chart + drill-down table by delay class |
| `DcmaScorecard.tsx` | score ring + 14 pass/fail check tiles with suggestions |
| `SchedulePage.tsx` | top-level composition — toolbar, tabs, synced split of grid + Gantt |
| `mockData.ts` | representative data so everything renders with no backend |
| `index.ts` | barrel exports |

## Quick use

```tsx
// app/projects/[id]/schedule/page.tsx  (Next.js, client component)
"use client";
import { useEffect, useState } from "react";
import { SchedulePage, SchedulingApi } from "@/scheduling-ui";
import type { SchedulePayload, DelayReport, DcmaReport } from "@/scheduling-ui";

const api = new SchedulingApi(process.env.NEXT_PUBLIC_SCHED_BASE ?? "");

export default function Page({ params }: { params: { id: string } }) {
  const [data, setData] = useState<SchedulePayload>();
  const [delay, setDelay] = useState<DelayReport>();
  const [dcma, setDcma] = useState<DcmaReport>();

  useEffect(() => {
    (async () => {
      await api.runCpm(params.id);                  // refresh cached CPM fields
      setData(await api.getSchedule(params.id));
      setDcma(await api.runDcma(params.id));
      // setDelay(await api.getDelay(params.id, baselineId));  // once a baseline exists
    })();
  }, [params.id]);

  if (!data) return <div>Loading schedule…</div>;
  return (
    <SchedulePage
      schedule={data}
      delay={delay}
      dcma={dcma}
      onExport={(fmt) => window.open(api.exportReportUrl(params.id, fmt))}
    />
  );
}
```

With **no props**, `<SchedulePage />` renders the bundled mock data — handy for a route
stub or Storybook while the backend is wired up.

## Notes

- **Grid ↔ Gantt sync** is by shared `DisplayRow[]` (same order) + equal row height
  (`theme.size.rowH`) + vertical scroll mirroring in `SchedulePage`. If you swap the grid
  for a heavier data-grid (AG Grid / TanStack), keep the row height and order aligned with
  the Gantt or they'll drift.
- **Baseline bars** read `activity.bl_start` / `bl_finish`. The schedule endpoint doesn't
  populate these; merge them client-side from a baseline/delay fetch (see `mockData.ts`).
- **Inline edits**: `ScheduleGrid` exposes `onSelect`; wire a detail drawer or inline
  editor to `api.updateProgress(activityId, {...})`, then re-fetch the schedule.
- The Gantt is a single SVG — fine up to a few thousand rows. For very large schedules,
  windowing (render only visible rows) is the Phase-2 step.

## Typecheck

```bash
# from this folder, with typescript + @types/react installed
npx tsc --noEmit --jsx react-jsx --strict --moduleResolution Bundler *.ts *.tsx
```

All components pass `tsc --strict`.
