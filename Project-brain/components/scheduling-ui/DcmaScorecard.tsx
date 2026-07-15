// DcmaScorecard.tsx — overall score ring + 14 check tiles.

import React from "react";
import { theme } from "./theme";
import type { DcmaReport, DcmaCheck } from "./types";

export const DcmaScorecard: React.FC<{ report: DcmaReport }> = ({ report }) => {
  return (
    <div style={{ fontFamily: theme.font.ui, color: theme.color.ink }}>
      <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 20 }}>
        <Ring value={report.score} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: theme.color.muted }}>
            DCMA 14-Point Assessment
          </div>
          <div style={{ fontFamily: theme.font.mono, fontSize: 28, fontWeight: 700, color: theme.color.tealDark, marginTop: 2 }}>
            {report.passed_count}<span style={{ color: theme.color.muted, fontSize: 18 }}>/{report.applicable_count}</span>
            <span style={{ fontSize: 14, color: theme.color.muted, fontWeight: 400, marginLeft: 8 }}>checks passed</span>
          </div>
          <div style={{ fontSize: 12, color: theme.color.muted, marginTop: 4, maxWidth: 360 }}>
            Industry conformance test for schedule quality. Failed checks list the metric, the threshold, and a corrective suggestion.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 10 }}>
        {report.checks.map((c) => <Tile key={c.number} c={c} />)}
      </div>
    </div>
  );
};

const Ring: React.FC<{ value: number }> = ({ value }) => {
  const r = 38, c = 2 * Math.PI * r;
  const col = value >= 90 ? theme.color.pass : value >= 70 ? theme.color.nearCritical : theme.color.fail;
  return (
    <svg width={96} height={96} style={{ flexShrink: 0 }}>
      <circle cx={48} cy={48} r={r} fill="none" stroke={theme.color.line} strokeWidth={9} />
      <circle cx={48} cy={48} r={r} fill="none" stroke={col} strokeWidth={9}
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
        strokeLinecap="round" transform="rotate(-90 48 48)" />
      <text x={48} y={47} textAnchor="middle" fontFamily={theme.font.mono} fontSize={22} fontWeight={700} fill={col}>
        {Math.round(value)}
      </text>
      <text x={48} y={63} textAnchor="middle" fontSize={10} fill={theme.color.muted}>SCORE</text>
    </svg>
  );
};

const Tile: React.FC<{ c: DcmaCheck }> = ({ c }) => {
  const info = c.threshold === "info";
  const col = info ? theme.color.muted : c.passed ? theme.color.pass : theme.color.fail;
  return (
    <div style={{
      border: `1px solid ${c.passed || info ? theme.color.line : theme.color.fail}`,
      background: c.passed || info ? theme.color.panel : "#FCEEED",
      borderRadius: theme.radius.md, padding: 11, boxShadow: theme.shadow.card,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
          <span style={{ fontFamily: theme.font.mono, fontSize: 11, color: theme.color.muted }}>
            {String(c.number).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {c.name}
          </span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: col, whiteSpace: "nowrap" }}>
          {info ? "INFO" : c.passed ? "PASS" : "FAIL"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 7, fontFamily: theme.font.mono, fontSize: 11 }}>
        <span style={{ color: col, fontWeight: 700 }}>{c.metric}</span>
        <span style={{ color: theme.color.muted }}>vs {c.threshold}</span>
      </div>
      <div style={{ fontSize: 11, color: theme.color.slate, marginTop: 6, lineHeight: 1.35 }}>
        {c.observation}
      </div>
      {!c.passed && c.suggestion && (
        <div style={{ fontSize: 11, color: theme.color.tealDark, marginTop: 5, lineHeight: 1.35, borderTop: `1px dashed ${theme.color.line}`, paddingTop: 5 }}>
          → {c.suggestion}
        </div>
      )}
    </div>
  );
};
