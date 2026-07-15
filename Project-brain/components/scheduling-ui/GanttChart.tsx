// GanttChart.tsx — SVG Gantt synced to the schedule grid.
//
// Renders, per activity row: a baseline ghost bar (thin, beneath), the current
// bar (progress-filled), milestones as diamonds, FS/SS/FF/SF dependency arrows,
// the critical path in brand teal, and a data-date / today line. Working-day
// weekends are shaded. Designed to share row height + order with ScheduleGrid.

import React, { useMemo } from "react";
import { theme, isWeekend, parseISO } from "./theme";
import type { DisplayRow } from "./rows";
import type { Relationship, Activity } from "./types";

interface Props {
  rows: DisplayRow[];
  span: { min: Date; max: Date };
  relationships: Relationship[];
  dataDate?: string | null;
  dayW?: number; // px per calendar day
  rowH?: number;
  showBaseline?: boolean;
}

const ROLLUP_H = 6;
const BAR_H = 13;
const BASE_H = 4;

export const GanttChart: React.FC<Props> = ({
  rows,
  span,
  relationships,
  dataDate,
  dayW = theme.size.dayW,
  rowH = theme.size.rowH,
  showBaseline = true,
}) => {
  const totalDays = Math.max(1, Math.round((span.max.getTime() - span.min.getTime()) / 86_400_000));
  const width = totalDays * dayW;
  const height = rows.length * rowH;

  const x = (d: Date | null) => (d ? Math.round(((d.getTime() - span.min.getTime()) / 86_400_000) * dayW) : 0);

  // row lookup for arrow endpoints (by activity code)
  const rowByCode = useMemo(() => {
    const m = new Map<string, { i: number; act: Activity }>();
    rows.forEach((r, i) => {
      if (r.kind === "activity" && r.activity) m.set(r.activity.code, { i, act: r.activity });
    });
    return m;
  }, [rows]);

  // month/week header ticks
  const ticks = useMemo(() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    const d = new Date(span.min);
    d.setHours(0, 0, 0, 0);
    while (d <= span.max) {
      const isMonthStart = d.getDate() === 1;
      const isMonday = d.getDay() === 1;
      if (isMonthStart || isMonday) {
        out.push({
          x: x(d),
          label: isMonthStart
            ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
            : d.toLocaleDateString("en-GB", { day: "2-digit" }),
          major: isMonthStart,
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [span, dayW]);

  // weekend shading rects
  const weekends = useMemo(() => {
    const out: { x: number; w: number }[] = [];
    const d = new Date(span.min);
    while (d <= span.max) {
      if (isWeekend(d)) out.push({ x: x(d), w: dayW });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [span, dayW]);

  const barY = (i: number) => i * rowH + (rowH - BAR_H) / 2;

  // ---- dependency arrow paths ------------------------------------------
  const arrows = useMemo(() => {
    const paths: { d: string; crit: boolean }[] = [];
    for (const r of relationships) {
      const p = rowByCode.get(r.predecessor);
      const s = rowByCode.get(r.successor);
      if (!p || !s) continue;
      const crit = p.act.is_critical && s.act.is_critical;
      const pStart = x(parseISO(p.act.early_start));
      const pEnd = x(parseISO(p.act.early_finish)) + dayW;
      const sStart = x(parseISO(s.act.early_start));
      const sEnd = x(parseISO(s.act.early_finish)) + dayW;
      const py = barY(p.i) + BAR_H / 2;
      const sy = barY(s.i) + BAR_H / 2;

      let x1 = pEnd, x2 = sStart; // FS default
      if (r.rel_type === "SS") { x1 = pStart; x2 = sStart; }
      else if (r.rel_type === "FF") { x1 = pEnd; x2 = sEnd; }
      else if (r.rel_type === "SF") { x1 = pStart; x2 = sEnd; }

      const mid = x1 + 8;
      const d =
        r.rel_type === "FS"
          ? `M${x1},${py} L${mid},${py} L${mid},${sy} L${x2 - 6},${sy}`
          : `M${x1},${py} L${x1},${(py + sy) / 2} L${x2},${(py + sy) / 2} L${x2},${sy + (sy > py ? -6 : 6)}`;
      paths.push({ d, crit });
    }
    return paths;
  }, [relationships, rowByCode, dayW]);

  const ddX = dataDate ? x(parseISO(dataDate)) : null;

  return (
    <div style={{ overflow: "auto", background: theme.color.panel }}>
      <svg width={width} height={height + 34} style={{ display: "block", fontFamily: theme.font.mono }}>
        {/* weekend shading */}
        {weekends.map((w, i) => (
          <rect key={`we${i}`} x={w.x} y={34} width={w.w} height={height} fill={theme.color.gridWeekend} />
        ))}

        {/* header band */}
        <rect x={0} y={0} width={width} height={34} fill={theme.color.canvasAlt} />
        <line x1={0} y1={34} x2={width} y2={34} stroke={theme.color.lineStrong} />
        {ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={t.x} y1={t.major ? 0 : 18} x2={t.x} y2={height + 34}
              stroke={t.major ? theme.color.lineStrong : theme.color.line}
              strokeWidth={t.major ? 1 : 0.5} />
            <text x={t.x + 3} y={t.major ? 13 : 30}
              fontSize={t.major ? 11 : 9}
              fontWeight={t.major ? 700 : 400}
              fill={t.major ? theme.color.slate : theme.color.muted}>
              {t.label}
            </text>
          </g>
        ))}

        {/* row striping */}
        {rows.map((r, i) =>
          i % 2 === 1 ? (
            <rect key={`rs${i}`} x={0} y={34 + i * rowH} width={width} height={rowH} fill={theme.color.canvasAlt} opacity={0.5} />
          ) : null
        )}

        {/* dependency arrows (under bars) */}
        <g transform="translate(0,34)">
          {arrows.map((a, i) => (
            <path key={`ar${i}`} d={a.d} fill="none"
              stroke={a.crit ? theme.color.critical : theme.color.lineStrong}
              strokeWidth={a.crit ? 1.4 : 1}
              markerEnd={`url(#${a.crit ? "ah-crit" : "ah"})`} opacity={0.85} />
          ))}
        </g>

        <defs>
          {["ah", "ah-crit"].map((id) => (
            <marker key={id} id={id} viewBox="0 0 8 8" refX="6" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,1 L7,4 L0,7 Z" fill={id === "ah-crit" ? theme.color.critical : theme.color.lineStrong} />
            </marker>
          ))}
        </defs>

        {/* bars */}
        <g transform="translate(0,34)">
          {rows.map((r, i) => {
            if (r.kind === "wbs") {
              const s = parseISO(r.rollupStart ?? null);
              const f = parseISO(r.rollupFinish ?? null);
              if (!s || !f) return null;
              const xs = x(s), xf = x(f) + dayW;
              const y = i * rowH + (rowH - ROLLUP_H) / 2;
              return (
                <g key={`w${i}`}>
                  <rect x={xs} y={y} width={Math.max(2, xf - xs)} height={ROLLUP_H} rx={1} fill={theme.color.slate} />
                  <path d={`M${xs},${y + ROLLUP_H} l4,4 l0,-4 Z`} fill={theme.color.slate} />
                  <path d={`M${xf},${y + ROLLUP_H} l-4,4 l0,-4 Z`} fill={theme.color.slate} />
                </g>
              );
            }
            const act = r.activity!;
            const y = barY(i);

            // milestone diamond
            if (act.is_milestone) {
              const mx = x(parseISO(act.early_start));
              const my = y + BAR_H / 2;
              const fill = act.is_critical ? theme.color.critical : theme.color.slate;
              return (
                <g key={`m${i}`}>
                  <path d={`M${mx},${my - 7} l7,7 l-7,7 l-7,-7 Z`} fill={fill} stroke="#fff" strokeWidth={1} />
                  <text x={mx + 11} y={my + 3.5} fontSize={10} fill={theme.color.slate}>◆ {act.name}</text>
                </g>
              );
            }

            const xs = x(parseISO(act.early_start));
            const xf = x(parseISO(act.early_finish)) + dayW;
            const w = Math.max(3, xf - xs);
            const fill = act.is_critical ? theme.color.critical : theme.color.teal;
            const progW = (w * Math.min(100, act.percent_complete)) / 100;

            return (
              <g key={`b${i}`}>
                {/* baseline ghost */}
                {showBaseline && act.bl_start && act.bl_finish && (() => {
                  const bxs = x(parseISO(act.bl_start));
                  const bxf = x(parseISO(act.bl_finish)) + dayW;
                  return (
                    <rect x={bxs} y={y + BAR_H + 1} width={Math.max(2, bxf - bxs)} height={BASE_H}
                      rx={1} fill={theme.color.baseline} />
                  );
                })()}
                {/* current bar */}
                <rect x={xs} y={y} width={w} height={BAR_H} rx={2} fill={fill} opacity={0.28} />
                <rect x={xs} y={y} width={progW} height={BAR_H} rx={2} fill={fill} />
                <rect x={xs} y={y} width={w} height={BAR_H} rx={2} fill="none" stroke={fill} strokeWidth={1} />
                {/* label */}
                <text x={xf + 6} y={y + BAR_H - 2.5} fontSize={10} fill={theme.color.slate}>
                  {act.name}
                  {act.total_float != null && act.total_float < 0 && (
                    <tspan fill={theme.color.negFloat} fontWeight={700}> ({act.total_float}d)</tspan>
                  )}
                </text>
              </g>
            );
          })}

          {/* data-date line */}
          {ddX != null && (
            <g>
              <line x1={ddX} y1={-34} x2={ddX} y2={height} stroke={theme.color.today} strokeWidth={1.4} strokeDasharray="4 3" />
              <rect x={ddX - 18} y={-32} width={36} height={13} rx={2} fill={theme.color.today} />
              <text x={ddX} y={-22} fontSize={9} fill="#fff" textAnchor="middle" fontWeight={700}>DATA</text>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};
