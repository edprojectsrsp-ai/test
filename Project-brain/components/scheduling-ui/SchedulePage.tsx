// SchedulePage.tsx — top-level composition: toolbar + tabs (Schedule / Delay /
// DCMA), with the Schedule tab a synced split of ScheduleGrid + GanttChart.
//
// Data-agnostic: pass a SchedulePayload (+ optional delay/dcma reports). With no
// props it renders the bundled mock data, so it works in a preview/Storybook.

import React, { useMemo, useRef, useState } from "react";
import { theme } from "./theme";
import { ScheduleGrid } from "./ScheduleGrid";
import { GanttChart } from "./GanttChart";
import { DelayDashboard } from "./DelayDashboard";
import { DcmaScorecard } from "./DcmaScorecard";
import { buildRows, scheduleSpan } from "./rows";
import type { SchedulePayload, DelayReport, DcmaReport } from "./types";
import { mockSchedule, mockDelay, mockDcma } from "./mockData";

interface Props {
  schedule?: SchedulePayload;
  delay?: DelayReport | null;
  dcma?: DcmaReport | null;
  onExport?: (fmt: "csv" | "xlsx" | "pdf") => void;
  onActivitySelect?: (activityCode: string) => void;
}

type Tab = "schedule" | "delay" | "dcma";
const ZOOMS = [
  { label: "Month", dayW: 6 },
  { label: "Week", dayW: 16 },
  { label: "Day", dayW: 34 },
];

export const SchedulePage: React.FC<Props> = ({
  schedule,
  delay,
  dcma,
  onExport,
  onActivitySelect,
}) => {
  const resolvedSchedule = schedule ?? mockSchedule;
  const resolvedDelay = delay ?? (schedule ? { project_finish_variance_wd: null, delayed_count: 0, critical_delay_count: 0, rows: [] } : mockDelay);
  const resolvedDcma = dcma ?? (schedule ? { checks: [], score: 0, passed_count: 0, applicable_count: 0 } : mockDcma);
  const [tab, setTab] = useState<Tab>("schedule");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1); // index into ZOOMS
  const [showBaseline, setShowBaseline] = useState(true);

  const gridScroll = useRef<HTMLDivElement>(null);
  const ganttScroll = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const rows = useMemo(() => buildRows(resolvedSchedule, collapsed), [resolvedSchedule, collapsed]);
  const span = useMemo(() => scheduleSpan(resolvedSchedule), [resolvedSchedule]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // vertical scroll sync between grid and gantt
  const syncScroll = (from: "grid" | "gantt") => () => {
    if (syncing.current) return;
    syncing.current = true;
    const src = from === "grid" ? gridScroll.current : ganttScroll.current;
    const dst = from === "grid" ? ganttScroll.current : gridScroll.current;
    if (src && dst) dst.scrollTop = src.scrollTop;
    requestAnimationFrame(() => (syncing.current = false));
  };

  return (
    <div style={{ fontFamily: theme.font.ui, color: theme.color.ink, background: theme.color.canvas, height: "100%", display: "flex", flexDirection: "column", minHeight: 600 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 18px", background: theme.color.panel, borderBottom: `1px solid ${theme.color.line}` }}>
          <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{resolvedSchedule.project.name}</div>
          <div style={{ fontSize: 11, color: theme.color.muted, fontFamily: theme.font.mono }}>
            start {resolvedSchedule.project.start_date} · data date {resolvedSchedule.project.data_date ?? "—"} · {resolvedSchedule.activities.length} activities
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Tabs tab={tab} setTab={setTab} />
        <div style={{ width: 1, height: 24, background: theme.color.line }} />
        <button style={btn(false)} onClick={() => onExport?.("xlsx")}>Excel</button>
        <button style={btn(false)} onClick={() => onExport?.("pdf")}>PDF</button>
      </div>

      {/* sub-toolbar (schedule tab only) */}
      {tab === "schedule" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 18px", background: theme.color.canvasAlt, borderBottom: `1px solid ${theme.color.line}`, fontSize: 12 }}>
          <Legend />
          <div style={{ flex: 1 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: theme.color.slate }}>
            <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
            Baseline
          </label>
          <div style={{ display: "flex", border: `1px solid ${theme.color.lineStrong}`, borderRadius: theme.radius.sm, overflow: "hidden" }}>
            {ZOOMS.map((z, i) => (
              <button key={z.label} onClick={() => setZoom(i)}
                style={{ border: "none", padding: "4px 10px", fontSize: 11, cursor: "pointer", background: zoom === i ? theme.color.teal : theme.color.panel, color: zoom === i ? "#fff" : theme.color.slate, fontWeight: zoom === i ? 700 : 400 }}>
                {z.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {tab === "schedule" && (
          <div style={{ display: "flex", height: "100%" }}>
            <div ref={gridScroll} onScroll={syncScroll("grid")}
              style={{ overflow: "auto", borderRight: `2px solid ${theme.color.lineStrong}`, flexShrink: 0, maxWidth: "46%" }}>
              <ScheduleGrid rows={rows} collapsed={collapsed} onToggle={toggle} onSelect={(code) => { setSelected(code); onActivitySelect?.(code); }} selected={selected} />
            </div>
            <div ref={ganttScroll} onScroll={syncScroll("gantt")} style={{ overflow: "auto", flex: 1 }}>
              <GanttChart rows={rows} span={span} relationships={resolvedSchedule.relationships}
                dataDate={resolvedSchedule.project.data_date} dayW={ZOOMS[zoom].dayW} showBaseline={showBaseline} />
            </div>
          </div>
        )}
        {tab === "delay" && <div style={{ padding: 18, overflow: "auto", height: "100%" }}><DelayDashboard report={resolvedDelay} /></div>}
        {tab === "dcma" && <div style={{ padding: 18, overflow: "auto", height: "100%" }}><DcmaScorecard report={resolvedDcma} /></div>}
      </div>
    </div>
  );
};

const Tabs: React.FC<{ tab: Tab; setTab: (t: Tab) => void }> = ({ tab, setTab }) => {
  const items: [Tab, string][] = [["schedule", "Schedule"], ["delay", "Delay"], ["dcma", "DCMA"]];
  return (
    <div style={{ display: "flex", gap: 2, background: theme.color.canvas, padding: 2, borderRadius: theme.radius.md }}>
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          style={{ border: "none", cursor: "pointer", padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: theme.radius.sm, background: tab === k ? theme.color.panel : "transparent", color: tab === k ? theme.color.tealDark : theme.color.muted, boxShadow: tab === k ? theme.shadow.card : "none" }}>
          {label}
        </button>
      ))}
    </div>
  );
};

const Legend: React.FC = () => {
  const item = (color: string, label: string, kind: "bar" | "diamond" | "ghost" = "bar") => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: theme.color.muted, fontSize: 11 }}>
      {kind === "diamond" ? (
        <span style={{ width: 9, height: 9, background: color, transform: "rotate(45deg)", display: "inline-block" }} />
      ) : (
        <span style={{ width: 16, height: kind === "ghost" ? 4 : 9, background: color, borderRadius: 2, display: "inline-block" }} />
      )}
      {label}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      {item(theme.color.critical, "Critical path")}
      {item(theme.color.teal, "Activity")}
      {item(theme.color.baseline, "Baseline", "ghost")}
      {item(theme.color.teal, "Milestone", "diamond")}
    </div>
  );
};

const btn = (primary: boolean): React.CSSProperties => ({
  border: `1px solid ${primary ? theme.color.teal : theme.color.lineStrong}`,
  background: primary ? theme.color.teal : theme.color.panel,
  color: primary ? "#fff" : theme.color.slate,
  padding: "6px 12px", borderRadius: theme.radius.sm, fontSize: 12, fontWeight: 600, cursor: "pointer",
});
