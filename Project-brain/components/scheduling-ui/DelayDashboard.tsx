// DelayDashboard.tsx — summary cards + variance bar chart + drill-down table.

import React, { useMemo, useState } from "react";
import { theme, delayColor, fmtDate } from "./theme";
import type { DelayReport, DelayRow } from "./types";

const CLASS_LABEL: Record<string, string> = {
  ahead: "Ahead", on_track: "On track", slipping: "Slipping", critical_delay: "Critical delay",
};

export const DelayDashboard: React.FC<{ report: DelayReport }> = ({ report }) => {
  const [sortKey, setSortKey] = useState<"finish_var_wd" | "total_float">("finish_var_wd");

  const sorted = useMemo(() => {
    return [...report.rows].sort((a, b) => (b[sortKey] ?? -999) - (a[sortKey] ?? -999));
  }, [report.rows, sortKey]);

  const maxVar = Math.max(1, ...report.rows.map((r) => Math.abs(r.finish_var_wd ?? 0)));

  const counts = useMemo(() => {
    const c: Record<string, number> = { ahead: 0, on_track: 0, slipping: 0, critical_delay: 0 };
    report.rows.forEach((r) => { c[r.classification] = (c[r.classification] ?? 0) + 1; });
    return c;
  }, [report.rows]);

  return (
    <div style={{ fontFamily: theme.font.ui, color: theme.color.ink }}>
      {/* summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Card label="Project finish variance"
          value={`${(report.project_finish_variance_wd ?? 0) > 0 ? "+" : ""}${report.project_finish_variance_wd ?? "—"} wd`}
          tone={(report.project_finish_variance_wd ?? 0) > 0 ? "bad" : "good"} />
        <Card label="Activities delayed" value={String(report.delayed_count)} tone={report.delayed_count ? "warn" : "good"} />
        <Card label="Critical delays" value={String(report.critical_delay_count)} tone={report.critical_delay_count ? "bad" : "good"} />
      </div>

      {/* class distribution */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["critical_delay", "slipping", "on_track", "ahead"] as const).map((k) => (
          <div key={k} style={{ flex: 1, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.md, padding: "8px 10px", background: theme.color.panel }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: delayColor(k) }} />
              <span style={{ fontSize: 11, color: theme.color.muted }}>{CLASS_LABEL[k]}</span>
            </div>
            <div style={{ fontFamily: theme.font.mono, fontSize: 20, fontWeight: 700, marginTop: 2 }}>{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* variance table */}
      <div style={{ border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.md, overflow: "hidden" }}>
        <div style={{ display: "flex", height: 32, alignItems: "center", background: theme.color.canvasAlt, borderBottom: `1px solid ${theme.color.lineStrong}`, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: theme.color.muted }}>
          <div style={{ width: 48, padding: "0 8px" }}>ID</div>
          <div style={{ width: 180, padding: "0 8px" }}>Activity</div>
          <div style={{ flex: 1, minWidth: 200, padding: "0 8px" }}>Finish variance (working days)</div>
          <div style={{ width: 70, padding: "0 8px", textAlign: "right", cursor: "pointer" }} onClick={() => setSortKey("finish_var_wd")}>Var ⌄</div>
          <div style={{ width: 56, padding: "0 8px", textAlign: "right", cursor: "pointer" }} onClick={() => setSortKey("total_float")}>Float</div>
          <div style={{ width: 110, padding: "0 8px" }}>Class</div>
          <div style={{ flex: 1.2, minWidth: 160, padding: "0 8px" }}>Reason</div>
        </div>
        {sorted.map((r, i) => <Row key={r.activity_id} r={r} maxVar={maxVar} alt={i % 2 === 1} />)}
      </div>
    </div>
  );
};

const Row: React.FC<{ r: DelayRow; maxVar: number; alt: boolean }> = ({ r, maxVar, alt }) => {
  const v = r.finish_var_wd ?? 0;
  const pct = (Math.abs(v) / maxVar) * 100;
  const col = delayColor(r.classification);
  const mono: React.CSSProperties = { fontFamily: theme.font.mono, fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ display: "flex", alignItems: "center", height: 34, fontSize: 12, borderBottom: `1px solid ${theme.color.line}`, background: alt ? theme.color.canvasAlt : theme.color.panel }}>
      <div style={{ width: 48, padding: "0 8px", ...mono, color: theme.color.muted }}>{r.activity_id}</div>
      <div style={{ width: 180, padding: "0 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
      <div style={{ flex: 1, minWidth: 200, padding: "0 8px" }}>
        <div style={{ position: "relative", height: 14, background: theme.color.canvas, borderRadius: 3 }}>
          {/* center zero line */}
          <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: theme.color.lineStrong }} />
          <div style={{
            position: "absolute", top: 0, height: 14, borderRadius: 3, background: col, opacity: 0.85,
            left: v >= 0 ? "50%" : `${50 - pct / 2}%`, width: `${pct / 2}%`,
          }} />
        </div>
      </div>
      <div style={{ width: 70, padding: "0 8px", textAlign: "right", ...mono, fontWeight: 700, color: v > 0 ? theme.color.negFloat : v < 0 ? theme.color.ahead : theme.color.muted }}>
        {v > 0 ? "+" : ""}{v}
      </div>
      <div style={{ width: 56, padding: "0 8px", textAlign: "right", ...mono, color: (r.total_float ?? 1) < 0 ? theme.color.negFloat : theme.color.slate }}>{r.total_float ?? "—"}</div>
      <div style={{ width: 110, padding: "0 8px" }}>
        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: col, background: col + "1A" }}>
          {CLASS_LABEL[r.classification]}
        </span>
      </div>
      <div style={{ flex: 1.2, minWidth: 160, padding: "0 8px", fontSize: 11, color: theme.color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.reason || "—"}</div>
    </div>
  );
};

const Card: React.FC<{ label: string; value: string; tone: "good" | "warn" | "bad" }> = ({ label, value, tone }) => {
  const col = tone === "good" ? theme.color.ahead : tone === "warn" ? theme.color.nearCritical : theme.color.negFloat;
  return (
    <div style={{ minWidth: 168, border: `1px solid ${theme.color.line}`, borderLeft: `3px solid ${col}`, borderRadius: theme.radius.md, padding: "10px 14px", background: theme.color.panel, boxShadow: theme.shadow.card }}>
      <div style={{ fontSize: 11, color: theme.color.muted }}>{label}</div>
      <div style={{ fontFamily: theme.font.mono, fontSize: 22, fontWeight: 700, color: col, marginTop: 2 }}>{value}</div>
    </div>
  );
};
