"use client";
/**
 * ScheduleChecker — DCMA 14-Point assessment panel for CPM Studio.
 *
 * Replaces the 10-check inline summary with the full standard, computed live in
 * the browser from the same network the Gantt is showing. The two additions
 * that matter to a reviewer are CPLI (is the finish date credible?) and BEI
 * (is work actually being completed at the baselined rate?) — those are the
 * numbers quoted in schedule audits, and they were previously only available
 * from an official backend run.
 *
 * Checks that lack the underlying data report N/A and are excluded from the
 * score, rather than passing by default.
 */
import React, { useMemo, useState } from "react";
import { Button, Card, Chip } from "@/ui";
import { downloadCSV } from "@/lib/furnace/gridApi";
import { CpmLink, CpmResult } from "@/lib/furnace/cpmEngine";
import { DcmaActivity, DcmaPoint, runDcma14 } from "@/lib/furnace/dcma";

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
  fontVariantNumeric: "tabular-nums",
};
const label: React.CSSProperties = {
  fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)",
};

const STATUS_TONE = {
  pass: { fg: "var(--verdigris)", bg: "transparent", mark: "\u2713" },
  fail: { fg: "var(--molten)", bg: "var(--molten-soft)", mark: "\u2717" },
  na: { fg: "var(--steel-dim)", bg: "transparent", mark: "\u2013" },
} as const;

function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const tone = score >= 90 ? "var(--verdigris)" : score >= 70 ? "var(--ember)" : "var(--molten)";
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8, padding: "8px 14px",
      borderRadius: "var(--r)", border: `1px solid ${tone}`, background: "var(--panel)",
    }}>
      <span style={{ ...mono, fontSize: 26, fontWeight: 800, color: tone, lineHeight: 1 }}>{grade}</span>
      <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: tone }}>{score}%</span>
    </div>
  );
}

export default function ScheduleChecker({
  activities, links, result, dataDate,
}: {
  activities: DcmaActivity[];
  links: CpmLink[];
  result: CpmResult;
  dataDate?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const report = useMemo(
    () => runDcma14(activities, links, result, { dataDate }),
    [activities, links, result, dataDate],
  );

  const exportCsv = () => {
    downloadCSV(
      "dcma-14-point",
      ["Point", "Check", "Threshold", "Status", "Count", "Total", "Percent", "Value", "Offenders", "Detail"],
      report.points.map((p) => [
        p.point, p.name, p.threshold, p.status.toUpperCase(),
        p.count, p.total,
        p.pct === null ? "" : `${p.pct}%`,
        p.value === null ? "" : p.value,
        p.offenders.join(" "), p.detail,
      ]),
      `DCMA 14-Point Assessment \u2014 score ${report.score}% (grade ${report.grade}) \u00b7 data date ${dataDate ?? "\u2014"}`,
    );
  };

  const row = (p: DcmaPoint) => {
    const tone = STATUS_TONE[p.status];
    const open = expanded === p.id;
    const metric =
      p.value !== null ? p.value.toFixed(2)
        : p.total ? `${p.count}/${p.total}${p.pct !== null ? ` (${p.pct}%)` : ""}`
          : String(p.count);
    return (
      <div key={p.id} style={{ borderBottom: "1px solid var(--grid-line)" }}>
        <button
          onClick={() => setExpanded(open ? null : p.id)}
          style={{
            display: "grid", gridTemplateColumns: "26px 1fr auto auto", gap: 10,
            alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer",
            padding: "8px 10px", background: tone.bg, border: "none", color: "inherit",
          }}
        >
          <span style={{ ...mono, fontSize: 11, color: "var(--steel-dim)" }}>{p.point}</span>
          <span style={{ fontSize: 12.5 }}>
            <span style={{ color: tone.fg, fontWeight: 800, marginRight: 6 }}>{tone.mark}</span>
            {p.name}
          </span>
          <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: tone.fg }}>{metric}</span>
          <span style={{ ...mono, fontSize: 11, color: "var(--steel-dim)" }}>{p.threshold}</span>
        </button>
        {open && (
          <div style={{ padding: "0 10px 10px 46px", fontSize: 12, color: "var(--steel-dim)" }}>
            <div style={{ lineHeight: 1.5 }}>{p.detail}</div>
            {p.offenders.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                {p.offenders.map((o) => (
                  <span key={o} style={{
                    ...mono, fontSize: 11, padding: "2px 7px", borderRadius: 999,
                    background: "var(--molten-soft)", color: "var(--molten)",
                  }}>{o}</span>
                ))}
                {p.count > p.offenders.length && (
                  <span style={{ ...mono, fontSize: 11, color: "var(--steel-dim)" }}>
                    +{p.count - p.offenders.length} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card pad={false}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "12px 14px", borderBottom: "1px solid var(--grid-line)",
      }}>
        <div>
          <span style={label}>Schedule Checker</span>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>DCMA 14-Point Assessment</div>
        </div>
        <span style={{ flex: 1 }} />
        <Chip tone="ok" dot>{report.passed} pass</Chip>
        <Chip tone={report.failed ? "critical" : "neutral"} dot>{report.failed} fail</Chip>
        {report.notApplicable > 0 && <Chip tone="neutral">{report.notApplicable} n/a</Chip>}
        <GradeBadge grade={report.grade} score={report.score} />
        <Button onClick={exportCsv}>Export audit CSV</Button>
      </div>

      <div>{report.points.map(row)}</div>

      {report.notApplicable > 0 && (
        <div style={{ padding: "9px 14px", fontSize: 11.5, color: "var(--steel-dim)" }}>
          {report.notApplicable} check(s) could not be computed from this schedule (missing baseline,
          actual dates or resource loading) and are excluded from the score rather than passed.
        </div>
      )}
    </Card>
  );
}
