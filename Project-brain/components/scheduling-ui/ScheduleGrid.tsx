// ScheduleGrid.tsx — the spreadsheet panel. WBS tree with expand/collapse,
// configurable columns, critical/near-critical row accents, status pills,
// tabular monospace numerals. Row order/height match the Gantt exactly.

import React from "react";
import { theme, fmtDate } from "./theme";
import type { DisplayRow } from "./rows";

export type ColKey =
  | "code" | "name" | "dur" | "es" | "ef" | "ls" | "lf"
  | "tf" | "ff" | "pct" | "status";

const COLS: { key: ColKey; label: string; w: number; align?: "left" | "right" | "center" }[] = [
  { key: "code", label: "ID", w: 52 },
  { key: "name", label: "Activity", w: 220, align: "left" },
  { key: "dur", label: "Dur", w: 44, align: "right" },
  { key: "es", label: "Start", w: 64, align: "right" },
  { key: "ef", label: "Finish", w: 64, align: "right" },
  { key: "tf", label: "TF", w: 40, align: "right" },
  { key: "pct", label: "%", w: 44, align: "right" },
  { key: "status", label: "Status", w: 92, align: "center" },
];

interface Props {
  rows: DisplayRow[];
  columns?: { key: ColKey; label: string; w: number; align?: "left" | "right" | "center" }[];
  collapsed: Set<string>;
  onToggle: (wbsId: string) => void;
  onSelect?: (code: string) => void;
  selected?: string | null;
  rowH?: number;
}

export const ScheduleGrid: React.FC<Props> = ({
  rows, columns = COLS, collapsed, onToggle, onSelect, selected, rowH = theme.size.rowH,
}) => {
  const totalW = columns.reduce((s, c) => s + c.w, 0);

  return (
    <div style={{ minWidth: totalW, fontFamily: theme.font.ui, fontSize: 12, color: theme.color.ink }}>
      {/* header */}
      <div style={{
        display: "flex", height: 34, alignItems: "center",
        background: theme.color.canvasAlt, borderBottom: `1px solid ${theme.color.lineStrong}`,
        position: "sticky", top: 0, zIndex: 2,
      }}>
        {columns.map((c) => (
          <div key={c.key} style={{
            width: c.w, padding: "0 8px", fontSize: 10.5, fontWeight: 700,
            letterSpacing: 0.4, textTransform: "uppercase", color: theme.color.muted,
            textAlign: c.align ?? "left",
          }}>{c.label}</div>
        ))}
      </div>

      {/* rows */}
      {rows.map((r, i) => {
        const isWbs = r.kind === "wbs";
        const act = r.activity;
        const sel = act && selected === act.code;
        const crit = act?.is_critical;
        const nearCrit = act && !crit && act.total_float != null && act.total_float > 0 && act.total_float <= 5;
        const neg = act && act.total_float != null && act.total_float < 0;

        return (
          <div
            key={i}
            onClick={() => act && onSelect?.(act.code)}
            style={{
              display: "flex", height: rowH, alignItems: "center",
              borderBottom: `1px solid ${theme.color.line}`,
              background: sel ? theme.color.tealSoft : i % 2 ? theme.color.canvasAlt : theme.color.panel,
              cursor: act ? "pointer" : "default",
              borderLeft: crit ? `3px solid ${theme.color.critical}` : neg ? `3px solid ${theme.color.negFloat}` : nearCrit ? `3px solid ${theme.color.nearCritical}` : "3px solid transparent",
            }}
          >
            {columns.map((c) => (
              <Cell key={c.key} col={c} row={r} isWbs={isWbs} onToggle={onToggle} />
            ))}
          </div>
        );
      })}
    </div>
  );
};

const Cell: React.FC<{
  col: { key: ColKey; w: number; align?: "left" | "right" | "center" };
  row: DisplayRow;
  isWbs: boolean;
  onToggle: (id: string) => void;
}> = ({ col, row, isWbs, onToggle }) => {
  const mono: React.CSSProperties = { fontFamily: theme.font.mono, fontVariantNumeric: "tabular-nums" };
  const base: React.CSSProperties = {
    width: col.w, padding: "0 8px", textAlign: col.align ?? "left",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };

  if (isWbs) {
    const w = row.wbs!;
    if (col.key === "name") {
      return (
        <div style={{ ...base, paddingLeft: 8 + row.depth * 14, fontWeight: 700, color: theme.color.slate, display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={(e) => { e.stopPropagation(); onToggle(w.id); }}
            style={{ border: "none", background: "none", cursor: "pointer", color: theme.color.muted, fontSize: 10, width: 12 }}>
            ▾
          </button>
          <span>{w.code} · {w.name}</span>
        </div>
      );
    }
    if (col.key === "es") return <div style={{ ...base, ...mono, color: theme.color.muted }}>{fmtDate(row.rollupStart)}</div>;
    if (col.key === "ef") return <div style={{ ...base, ...mono, color: theme.color.muted }}>{fmtDate(row.rollupFinish)}</div>;
    return <div style={base} />;
  }

  const a = row.activity!;
  switch (col.key) {
    case "code":
      return <div style={{ ...base, ...mono, color: theme.color.muted, paddingLeft: 8 + row.depth * 14 }}>{a.code}</div>;
    case "name":
      return (
        <div style={{ ...base, paddingLeft: 8 + row.depth * 14, display: "flex", alignItems: "center", gap: 6 }}>
          {a.is_milestone && <span style={{ color: theme.color.teal }}>◆</span>}
          <span style={{ fontWeight: a.is_critical ? 600 : 400 }}>{a.name}</span>
        </div>
      );
    case "dur":
      return <div style={{ ...base, ...mono }}>{a.is_milestone ? "—" : a.duration}</div>;
    case "es":
      return <div style={{ ...base, ...mono }}>{fmtDate(a.early_start)}</div>;
    case "ef":
      return <div style={{ ...base, ...mono }}>{fmtDate(a.early_finish)}</div>;
    case "ls":
      return <div style={{ ...base, ...mono, color: theme.color.muted }}>{fmtDate(a.late_start)}</div>;
    case "lf":
      return <div style={{ ...base, ...mono, color: theme.color.muted }}>{fmtDate(a.late_finish)}</div>;
    case "tf":
      return (
        <div style={{ ...base, ...mono, color: a.total_float != null && a.total_float < 0 ? theme.color.negFloat : a.is_critical ? theme.color.critical : theme.color.ink, fontWeight: a.is_critical || (a.total_float ?? 1) < 0 ? 700 : 400 }}>
          {a.total_float ?? "—"}
        </div>
      );
    case "ff":
      return <div style={{ ...base, ...mono, color: theme.color.muted }}>{a.free_float ?? "—"}</div>;
    case "pct":
      return <div style={{ ...base, ...mono }}>{a.is_milestone ? "—" : `${Math.round(a.percent_complete)}`}</div>;
    case "status":
      return <div style={base}><StatusPill a={a} /></div>;
    default:
      return <div style={base} />;
  }
};

const StatusPill: React.FC<{ a: DisplayRow["activity"] }> = ({ a }) => {
  if (!a) return null;
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    completed: { bg: "#E4F1E9", fg: theme.color.ahead, label: "Done" },
    in_progress: { bg: theme.color.tealSoft, fg: theme.color.tealDark, label: "Active" },
    not_started: { bg: "#EFF2F1", fg: theme.color.muted, label: "Planned" },
  };
  const s = map[a.status ?? "not_started"] ?? map.not_started;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10,
      fontWeight: 700, background: s.bg, color: s.fg,
    }}>{s.label}</span>
  );
};
