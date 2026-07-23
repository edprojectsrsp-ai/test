"use client";
/**
 * BaselineGantt — current schedule with baseline bars overlaid, P6/SYNCHRO style.
 *
 * The multi-baseline matrix gives the numbers; this gives the shape. Each row
 * shows the live bar with up to three baseline bars beneath it and the slip
 * shaded between baseline finish and current finish, so a planner sees at a
 * glance which work has drifted and by how much.
 *
 * Rendered as plain SVG over lib/furnace/ganttGeometry rather than as an
 * overlay on gantt-task-react: that library exposes no per-row secondary bar,
 * and reverse-engineering its date-to-x internals would misalign every
 * baseline bar the moment the library changed — misleading variance is worse
 * than none.
 *
 * Consumes the same payload as MultiBaselinePanel (the backend compare
 * endpoint), so opening both costs one fetch.
 */
import React, { useMemo, useRef, useState } from "react";
import { Button, Card } from "@/ui";
import {
  BarRect, TimeScale, ZoomMode, barRect, buildTimeScale, dayDelta, varianceRect,
} from "@/lib/furnace/ganttGeometry";

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
  fontVariantNumeric: "tabular-nums",
};

const ROW_H = 30;
const BAR_H = 13;
const BL_H = 5;
const LABEL_W = 240;
const HEADER_H = 34;

// Up to three baselines stay legible stacked under a 30px row; beyond that the
// matrix is the right tool, so extra baselines are dropped from the drawing.
const MAX_BASELINE_BARS = 3;
const BASELINE_COLORS = ["#8b9dc3", "#b9a06a", "#7fa38b"];

export interface GanttCell {
  bl_start: string | null;
  bl_finish: string | null;
  finish_var_days: number | null;
  went_critical: boolean;
  status: "on_track" | "slipped" | "ahead" | "added";
}
export interface GanttRow {
  code: string;
  name: string;
  current_start?: string | null;
  current_finish: string | null;
  current_critical: boolean;
  percent_complete: number;
  worst_slip_days: number;
  wbs?: string | null;
  cells: Record<string, GanttCell>;
}
export interface GanttBaseline {
  baseline_id: number;
  name: string;
  project_finish: string | null;
}

export default function BaselineGantt({
  rows, baselines, dataDate, title = "Baseline comparison",
}: {
  rows: GanttRow[];
  baselines: GanttBaseline[];
  dataDate?: string | null;
  title?: string;
}) {
  const [zoom, setZoom] = useState<ZoomMode>("week");
  const [slippedOnly, setSlippedOnly] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; row: GanttRow } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(
    () => (slippedOnly ? rows.filter((r) => r.worst_slip_days > 0) : rows),
    [rows, slippedOnly]);

  const drawnBaselines = baselines.slice(0, MAX_BASELINE_BARS);

  const scale: TimeScale = useMemo(() => {
    const dates: (string | null | undefined)[] = [dataDate];
    rows.forEach((r) => {
      dates.push(r.current_start, r.current_finish);
      Object.values(r.cells).forEach((c) => dates.push(c.bl_start, c.bl_finish));
    });
    return buildTimeScale(dates, zoom, { padDays: zoom === "day" ? 3 : 10 });
  }, [rows, dataDate, zoom]);

  const height = HEADER_H + shown.length * ROW_H + 8;
  const todayX = scale.x(dataDate ?? undefined);

  const bar = (r: BarRect | null, y: number, h: number, fill: string,
               key: string, opacity = 1, rx = 2) =>
    r && (
      <rect key={key} x={r.x} y={y} width={r.width} height={h}
        fill={fill} opacity={opacity} rx={rx} />
    );

  return (
    <Card pad={false}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "12px 14px", borderBottom: "1px solid var(--grid-line)",
      }}>
        <div>
          <span style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" }}>
            Schedule
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{title}</div>
        </div>
        <span style={{ flex: 1 }} />
        {(["day", "week", "month", "quarter"] as ZoomMode[]).map((z) => (
          <Button key={z} onClick={() => setZoom(z)} kind={zoom === z ? "accent" : "default"}>
            {z[0].toUpperCase() + z.slice(1)}
          </Button>
        ))}
        <Button onClick={() => setSlippedOnly((v) => !v)} kind={slippedOnly ? "accent" : "default"}>
          Slipped only
        </Button>
      </div>

      {/* legend */}
      <div style={{
        display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center",
        padding: "8px 14px", fontSize: 11.5, color: "var(--steel-dim)",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width={22} height={10}><rect width={22} height={10} rx={2} fill="#4d7ea8" /></svg>
          Current
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width={22} height={10}><rect width={22} height={10} rx={2} fill="#e2502a" /></svg>
          Critical
        </span>
        {drawnBaselines.map((b, i) => (
          <span key={b.baseline_id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width={22} height={6}>
              <rect width={22} height={6} rx={1.5} fill={BASELINE_COLORS[i]} />
            </svg>
            {b.name}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width={22} height={10}>
            <rect width={22} height={10} fill="#e2502a" opacity={0.22} />
          </svg>
          Slip vs baseline
        </span>
        {baselines.length > MAX_BASELINE_BARS && (
          <span>Showing {MAX_BASELINE_BARS} of {baselines.length} baselines — use the matrix for the rest.</span>
        )}
      </div>

      <div style={{ display: "flex", borderTop: "1px solid var(--grid-line)" }}>
        {/* frozen label column */}
        <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1px solid var(--line)" }}>
          <div style={{
            height: HEADER_H, borderBottom: "1px solid var(--line)",
            display: "flex", alignItems: "center", padding: "0 10px",
            fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase",
            color: "var(--steel-dim)", background: "var(--panel)",
          }}>
            Activity
          </div>
          {shown.map((r) => (
            <div key={r.code} style={{
              height: ROW_H, display: "flex", alignItems: "center", gap: 8,
              padding: "0 10px", borderBottom: "1px solid var(--grid-line)",
              background: r.current_critical ? "var(--molten-soft)" : undefined,
            }}>
              <span style={{ ...mono, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{r.code}</span>
              <span style={{
                fontSize: 11.5, color: "var(--steel-dim)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={r.name}>{r.name}</span>
              {r.worst_slip_days > 0 && (
                <span style={{ ...mono, fontSize: 10.5, fontWeight: 700,
                  color: "var(--molten)", marginLeft: "auto", flexShrink: 0 }}>
                  +{r.worst_slip_days}d
                </span>
              )}
            </div>
          ))}
        </div>

        {/* scrollable timeline */}
        <div ref={scrollRef} style={{ overflowX: "auto", flex: 1, position: "relative" }}>
          <svg width={scale.width} height={height} style={{ display: "block" }}>
            {/* gridlines + axis */}
            {scale.ticks.map((t, i) => (
              <g key={i}>
                <line x1={t.x} y1={0} x2={t.x} y2={height}
                  stroke={t.major ? "var(--line)" : "var(--grid-line)"}
                  strokeWidth={t.major ? 1 : 0.5} />
                <text x={t.x + 3} y={13} fontSize={t.major ? 10.5 : 9.5}
                  fill="var(--steel-dim)"
                  fontWeight={t.major ? 700 : 400}
                  style={mono as React.CSSProperties}>
                  {t.label}
                </text>
              </g>
            ))}
            <line x1={0} y1={HEADER_H - 0.5} x2={scale.width} y2={HEADER_H - 0.5}
              stroke="var(--line)" />

            {/* data date */}
            {todayX !== null && (
              <g>
                <line x1={todayX} y1={HEADER_H} x2={todayX} y2={height}
                  stroke="var(--ember, #d08c2e)" strokeWidth={1.5} strokeDasharray="4 3" />
                <text x={todayX + 4} y={HEADER_H + 10} fontSize={9.5}
                  fill="var(--ember, #d08c2e)" style={mono as React.CSSProperties}>
                  data date
                </text>
              </g>
            )}

            {shown.map((row, ri) => {
              const top = HEADER_H + ri * ROW_H;
              const barY = top + 4;
              const cur = barRect(scale, row.current_start, row.current_finish);
              const nBl = drawnBaselines.length;

              return (
                <g key={row.code}
                  onMouseEnter={(e) => setHover({ x: e.nativeEvent.offsetX, y: top, row })}
                  onMouseLeave={() => setHover(null)}>
                  {/* row hit area + banding */}
                  <rect x={0} y={top} width={scale.width} height={ROW_H}
                    fill={row.current_critical ? "var(--molten)" : "transparent"}
                    opacity={row.current_critical ? 0.05 : 0} />

                  {/* slip shading against the worst baseline drawn */}
                  {drawnBaselines.map((b) => {
                    const cell = row.cells[String(b.baseline_id)];
                    if (!cell || cell.status === "added") return null;
                    const v = varianceRect(scale, cell.bl_finish, row.current_finish);
                    if (!v) return null;
                    return (
                      <rect key={`v${b.baseline_id}`} x={v.x} y={barY}
                        width={v.width} height={BAR_H + nBl * (BL_H + 1)}
                        fill={v.direction === "slip" ? "#e2502a" : "#3f8f6b"}
                        opacity={0.18} />
                    );
                  })}

                  {/* current bar with progress fill */}
                  {cur && (
                    <>
                      {bar(cur, barY, BAR_H,
                        row.current_critical ? "#e2502a" : "#4d7ea8", "cur", 1, 2.5)}
                      {row.percent_complete > 0 && bar(
                        { ...cur, width: cur.width * Math.min(100, row.percent_complete) / 100 },
                        barY, BAR_H, row.current_critical ? "#8f2c0e" : "#2c4f74",
                        "prog", 1, 2.5)}
                      {cur.clippedRight && (
                        <polygon
                          points={`${cur.x + cur.width},${barY} ${cur.x + cur.width + 5},${barY + BAR_H / 2} ${cur.x + cur.width},${barY + BAR_H}`}
                          fill={row.current_critical ? "#e2502a" : "#4d7ea8"} />
                      )}
                    </>
                  )}

                  {/* baseline bars stacked beneath */}
                  {drawnBaselines.map((b, i) => {
                    const cell = row.cells[String(b.baseline_id)];
                    if (!cell || cell.status === "added") return null;
                    const r = barRect(scale, cell.bl_start, cell.bl_finish);
                    return bar(r, barY + BAR_H + 1 + i * (BL_H + 1), BL_H,
                      BASELINE_COLORS[i], `bl${b.baseline_id}`, 0.95, 1.5);
                  })}

                  {/* went-critical marker */}
                  {cur && drawnBaselines.some(
                    (b) => row.cells[String(b.baseline_id)]?.went_critical) && (
                    <text x={cur.x - 9} y={barY + BAR_H - 2} fontSize={11}
                      fill="var(--molten)">◆</text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* tooltip */}
          {hover && (
            <div style={{
              position: "absolute", left: Math.max(4, hover.x + 12), top: hover.y + 26,
              zIndex: 20, pointerEvents: "none", background: "var(--panel)",
              border: "1px solid var(--line)", borderRadius: "var(--r)",
              boxShadow: "var(--shadow)", padding: "8px 11px", minWidth: 210,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                <span style={mono}>{hover.row.code}</span> · {hover.row.name}
              </div>
              <div style={{ ...mono, fontSize: 11, color: "var(--steel-dim)", marginTop: 3 }}>
                {hover.row.current_start?.slice(0, 10) ?? "—"} → {hover.row.current_finish?.slice(0, 10) ?? "—"}
                {"  "}({Math.round(hover.row.percent_complete)}%)
              </div>
              <div style={{ marginTop: 6, borderTop: "1px solid var(--grid-line)", paddingTop: 5 }}>
                {drawnBaselines.map((b, i) => {
                  const cell = hover.row.cells[String(b.baseline_id)];
                  if (!cell) return null;
                  const v = cell.status === "added" ? null
                    : cell.finish_var_days ?? dayDelta(hover.row.current_finish, cell.bl_finish);
                  return (
                    <div key={b.baseline_id} style={{
                      display: "flex", justifyContent: "space-between", gap: 12,
                      fontSize: 11.5, marginTop: 2,
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <svg width={10} height={5}>
                          <rect width={10} height={5} rx={1} fill={BASELINE_COLORS[i]} />
                        </svg>
                        {b.name}
                      </span>
                      <span style={{
                        ...mono, fontWeight: 700,
                        color: cell.status === "added" ? "var(--steel-dim)"
                          : v === null || v === 0 ? "var(--ink-2)"
                            : v > 0 ? "var(--molten)" : "var(--verdigris)",
                      }}>
                        {cell.status === "added" ? "not baselined"
                          : v === null ? "—" : v > 0 ? `+${v}d` : `${v}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 && (
        <div style={{ padding: 18, fontSize: 12, color: "var(--verdigris)" }}>
          {rows.length ? "Nothing has slipped against the selected baselines."
            : "No activities to display."}
        </div>
      )}
    </Card>
  );
}
