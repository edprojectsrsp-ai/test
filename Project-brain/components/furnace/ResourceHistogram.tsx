"use client";
/**
 * ResourceHistogram — resource loading over time, with over-allocation
 * highlighted and one-click levelling.
 *
 * Shares the CPM's working-day unit axis so bars line up with the Gantt above,
 * and converts to dates only for the axis labels.
 */
import React, { useMemo, useState } from "react";
import { Button, Card, Chip } from "@/ui";
import { CpmActivity, CpmLink, CpmResult } from "@/lib/furnace/cpmEngine";
import { WorkCalendar } from "@/lib/furnace/workCalendar";
import {
  Assignment, LevellingResult, Resource, buildAllHistograms, levelResources,
  startsFromCpm,
} from "@/lib/furnace/resources";

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
  fontVariantNumeric: "tabular-nums",
};

const CHART_H = 108;
const PALETTE = ["#4d7ea8", "#7fa38b", "#b9a06a", "#8b7fa3", "#a37f7f"];

export default function ResourceHistogramPanel({
  activities, links, result, resources, assignments, calendar,
  onApplyLevelling,
}: {
  activities: CpmActivity[];
  links: CpmLink[];
  result: CpmResult;
  resources: Resource[];
  assignments: Assignment[];
  calendar: WorkCalendar;
  onApplyLevelling?: (starts: Record<string, number>) => void;
}) {
  const [leveled, setLeveled] = useState<LevellingResult | null>(null);
  const [showLeveled, setShowLeveled] = useState(false);

  const starts = useMemo(
    () => (showLeveled && leveled ? leveled.starts : startsFromCpm(result)),
    [showLeveled, leveled, result]);

  const histograms = useMemo(
    () => buildAllHistograms(activities, starts, assignments, resources),
    [activities, starts, assignments, resources]);

  const runLevelling = () => {
    const lv = levelResources(activities, links, result, assignments, resources);
    setLeveled(lv);
    setShowLeveled(true);
  };

  if (!resources.length) {
    return (
      <Card>
        <div style={{ fontSize: 12.5, color: "var(--steel-dim)" }}>
          No resources defined for this schedule. Resource loading and levelling
          become available once activities carry resource assignments.
        </div>
      </Card>
    );
  }

  const maxUnits = Math.max(1, ...histograms.map((h) => h.buckets.length));
  const pxPerUnit = Math.max(1.5, Math.min(9, 900 / maxUnits));
  const chartW = maxUnits * pxPerUnit;

  return (
    <Card pad={false}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "12px 14px", borderBottom: "1px solid var(--grid-line)",
      }}>
        <div>
          <span style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" }}>
            Resources
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            Loading &amp; levelling
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {histograms.some((h) => h.overallocatedUnits > 0) && !showLeveled && (
          <Chip tone="critical" dot>
            {histograms.reduce((n, h) => n + h.overallocatedUnits, 0)} over-allocated days
          </Chip>
        )}
        <Button onClick={runLevelling}>Level resources</Button>
        {leveled && (
          <Button onClick={() => setShowLeveled((v) => !v)}
            kind={showLeveled ? "accent" : "default"}>
            {showLeveled ? "Showing levelled" : "Showing current"}
          </Button>
        )}
        {leveled && showLeveled && onApplyLevelling && (
          <Button kind="accent" onClick={() => onApplyLevelling(leveled.starts)}>
            Apply to schedule
          </Button>
        )}
      </div>

      {leveled && showLeveled && (
        <div style={{
          padding: "10px 14px", display: "flex", gap: 14, flexWrap: "wrap",
          borderBottom: "1px solid var(--grid-line)", fontSize: 12,
        }}>
          <span><strong>{leveled.movedCount}</strong> activities moved</span>
          <span style={{ color: leveled.extensionUnits ? "var(--molten)" : "var(--verdigris)" }}>
            project {leveled.extensionUnits
              ? `extended ${leveled.extensionUnits} working days`
              : "not extended"}
          </span>
          {leveled.criticalDelays.length > 0 && (
            <span style={{ color: "var(--molten)" }}>
              {leveled.criticalDelays.length} delayed beyond float
            </span>
          )}
          {leveled.unresolved.length > 0 && (
            <span style={{ color: "var(--ember, #d08c2e)" }}>
              {leveled.unresolved.length} could not fit within capacity —
              demand exceeds what the resource can ever supply
            </span>
          )}
        </div>
      )}

      <div style={{ padding: "6px 14px 14px", overflowX: "auto" }}>
        {histograms.map((h, hi) => {
          const color = resources[hi]?.color ?? PALETTE[hi % PALETTE.length];
          const scaleMax = Math.max(h.peak, h.capacity) * 1.15 || 1;
          const y = (v: number) => CHART_H - (v / scaleMax) * CHART_H;
          const capY = y(h.capacity);

          return (
            <div key={h.resourceId} style={{ marginTop: hi ? 18 : 10 }}>
              <div style={{
                display: "flex", gap: 12, alignItems: "baseline",
                flexWrap: "wrap", marginBottom: 5,
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{h.resourceName}</span>
                <span style={{ ...mono, fontSize: 11, color: "var(--steel-dim)" }}>
                  capacity {h.capacity}{resources[hi]?.unit ? ` ${resources[hi].unit}` : ""}/day
                </span>
                <span style={{ ...mono, fontSize: 11, color: h.peak > h.capacity ? "var(--molten)" : "var(--steel-dim)" }}>
                  peak {h.peak}
                </span>
                <span style={{ ...mono, fontSize: 11, color: "var(--steel-dim)" }}>
                  {Math.round(h.utilisation * 100)}% utilised
                </span>
                {h.overallocatedUnits > 0 && (
                  <span style={{ ...mono, fontSize: 11, color: "var(--molten)", fontWeight: 700 }}>
                    {h.overallocatedUnits} days over
                  </span>
                )}
              </div>

              <svg width={chartW} height={CHART_H + 18} style={{ display: "block" }}>
                {/* capacity line */}
                <line x1={0} y1={capY} x2={chartW} y2={capY}
                  stroke="var(--molten)" strokeWidth={1.2} strokeDasharray="5 3" />
                <text x={2} y={capY - 3} fontSize={9.5} fill="var(--molten)"
                  style={mono as React.CSSProperties}>capacity</text>

                {h.buckets.map((b, i) => {
                  if (b.demand <= 0) return null;
                  const barH = CHART_H - y(b.demand);
                  // split the bar so the portion above capacity reads as spill
                  const okH = Math.min(b.demand, h.capacity);
                  const okBarH = CHART_H - y(okH);
                  return (
                    <g key={i}>
                      <rect x={i * pxPerUnit} y={CHART_H - okBarH}
                        width={Math.max(1, pxPerUnit - 0.4)} height={okBarH}
                        fill={color} opacity={0.9} />
                      {b.over && (
                        <rect x={i * pxPerUnit} y={CHART_H - barH}
                          width={Math.max(1, pxPerUnit - 0.4)} height={barH - okBarH}
                          fill="var(--molten)" opacity={0.95} />
                      )}
                    </g>
                  );
                })}

                <line x1={0} y1={CHART_H} x2={chartW} y2={CHART_H} stroke="var(--line)" />

                {/* month ticks along the unit axis */}
                {Array.from({ length: Math.floor(h.buckets.length / 21) + 1 }, (_, k) => {
                  const unit = k * 21;
                  if (unit >= h.buckets.length) return null;
                  const d = calendar.dateForUnit(unit);
                  return (
                    <text key={k} x={unit * pxPerUnit + 2} y={CHART_H + 12}
                      fontSize={9} fill="var(--steel-dim)" style={mono as React.CSSProperties}>
                      {d.toISOString().slice(2, 7)}
                    </text>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 14px 12px", fontSize: 11, color: "var(--steel-dim)" }}>
        Levelling uses the serial method — least float first — and never breaks
        logic: successors stay behind their predecessors. Optimal
        resource-constrained scheduling is NP-hard, so this is a heuristic, not
        a guaranteed shortest answer.
      </div>
    </Card>
  );
}
