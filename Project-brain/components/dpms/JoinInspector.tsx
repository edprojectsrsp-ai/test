"use client";
/**
 * JoinInspector — what you see after linking two tables on the breadboard.
 *
 * The canvas could already draw a line between two columns, but a line that
 * matches 4% of rows looks exactly like one that matches 99%. Building a master
 * table on the former silently produces a report with most of the project
 * missing, and nothing on screen said so.
 *
 * This panel answers three questions in order: is this join real (health), what
 * does the joined row actually look like (preview, columns grouped by source
 * table), and which rows failed to match (orphans — the fastest way to spot a
 * prefix or a wrong id system).
 */
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { DpmsRelationship, LinkSample } from "@/lib/dpms";
import {
  VERDICT_COLOR, VERDICT_LABEL, analyseJoin, orphanRows, splitColumns,
} from "@/lib/dpmsJoin";

const mono: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontVariantNumeric: "tabular-nums",
};

const CHILD_TINT = "#eff6ff";
const PARENT_TINT = "#f0fdf4";

const btn: React.CSSProperties = {
  padding: "5px 11px", borderRadius: 8, fontSize: 12, fontWeight: 700,
  border: "1px solid var(--line)", background: "var(--panel)",
  color: "var(--ink)", cursor: "pointer",
};

function Metric({ label, value, tone, hint }: {
  label: string; value: string; tone?: string; hint?: string;
}) {
  return (
    <div title={hint} style={{
      padding: "7px 11px", borderRadius: 10, background: "var(--panel-2, #f8fafc)",
      border: "1px solid var(--line)", minWidth: 96,
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4,
        color: "var(--ink-4, #7c8798)" }}>{label}</div>
      <div style={{ ...mono, fontSize: 15, fontWeight: 800, marginTop: 2,
        color: tone || "var(--ink)" }}>{value}</div>
    </div>
  );
}

export default function JoinInspector({
  rel, sample, onClose, onApprove, onReverse, onDelete, busy,
}: {
  rel: DpmsRelationship;
  sample: LinkSample;
  onClose: () => void;
  onApprove?: () => void;
  onReverse?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState<"joined" | "orphans">("joined");

  const health = useMemo(
    () => analyseJoin(sample as any, {
      containment: rel.containment, parent_coverage: rel.parent_coverage,
    }),
    [sample, rel]);
  const cols = useMemo(() => splitColumns(sample as any), [sample]);
  const orphans = useMemo(() => orphanRows(sample as any, 25), [sample]);

  const rows = tab === "joined" ? (sample.rows ?? []) : orphans;
  const ordered = [...cols.child, ...cols.parent, ...cols.other];
  const pct = health.matchRate === null ? null : Math.round(health.matchRate * 100);

  const tintFor = (c: string) =>
    cols.child.includes(c) ? CHILD_TINT
      : cols.parent.includes(c) ? PARENT_TINT : "transparent";

  return (
    <div style={{
      borderTop: "1px solid var(--line)", background: "#fff",
      display: "flex", flexDirection: "column", maxHeight: 430,
    }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
        <span style={{ ...mono, fontSize: 12.5, fontWeight: 850 }}>
          <span style={{ background: CHILD_TINT, padding: "2px 6px", borderRadius: 5 }}>
            {rel.child_table}.{rel.child_col}
          </span>
          {" → "}
          <span style={{ background: PARENT_TINT, padding: "2px 6px", borderRadius: 5 }}>
            {rel.parent_table}.{rel.parent_col}
          </span>
        </span>
        <span style={{
          fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999,
          color: "#fff", background: VERDICT_COLOR[health.verdict],
        }}>{VERDICT_LABEL[health.verdict]}</span>
        {rel.source === "manual" && (
          <span style={{ fontSize: 11, color: "var(--ink-4,#7c8798)" }}>manual link</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          {onApprove && rel.status !== "approved" && (
            <button style={{ ...btn, borderColor: "#0a8f5b", color: "#0a8f5b" }}
              onClick={onApprove} disabled={busy}>Approve</button>
          )}
          {onReverse && <button style={btn} onClick={onReverse} disabled={busy}>Reverse</button>}
          {onDelete && (
            <button style={{ ...btn, borderColor: "#c02b3c", color: "#c02b3c" }}
              onClick={onDelete} disabled={busy}>Delete</button>
          )}
          <button style={btn} onClick={onClose} aria-label="Close">
            <X size={13} style={{ verticalAlign: "-2px" }} />
          </button>
        </div>
      </div>

      {/* health */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
          <Metric label="Match rate" value={pct === null ? "—" : `${pct}%`}
            tone={VERDICT_COLOR[health.verdict]}
            hint="Share of sampled child rows that found a parent row." />
          <Metric label="Matched" value={String(health.matchedRows)}
            hint="Sampled rows that joined successfully." />
          <Metric label="Orphans" value={String(health.orphanRows)}
            tone={health.orphanRows ? "#c02b3c" : undefined}
            hint="Child rows with no matching parent. These vanish from an inner join." />
          <Metric label="Empty keys" value={String(health.nullKeys)}
            tone={health.nullKeys ? "#b25e00" : undefined}
            hint="Rows whose key is blank — they can never join." />
          <Metric label="Cardinality" value={health.cardinality}
            tone={health.cardinality === "N:N" || health.cardinality === "1:N"
              ? "#b25e00" : undefined}
            hint="child:parent. N:1 is the ordinary foreign key. 1:N and N:N multiply rows." />
          <Metric label="Sampled" value={String(health.sampleRows)}
            hint="Rows examined. Figures are estimates from this sample, not the full table." />
        </div>

        {pct !== null && (
          <div style={{ marginTop: 9 }}>
            <div style={{ height: 7, borderRadius: 999, background: "#eef1f5", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%",
                background: VERDICT_COLOR[health.verdict] }} />
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4,#7c8798)", marginTop: 4 }}>
              {health.matchedRows} of {health.sampleRows - health.nullKeys} usable sampled rows
              joined · estimated from a {health.sampleRows}-row sample, not the full table
            </div>
          </div>
        )}

        {health.notes.map((n, i) => (
          <div key={i} style={{
            marginTop: 7, fontSize: 11.5, lineHeight: 1.45, padding: "6px 9px",
            borderRadius: 8, background: "#fff8ec", border: "1px solid #f0d4a8",
            color: "#8a5a00",
          }}>{n}</div>
        ))}
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px 0" }}>
        {([["joined", `Joined rows (${sample.rows?.length ?? 0})`],
           ["orphans", `Unmatched (${orphans.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              ...btn,
              background: tab === id ? "var(--ink,#0f172a)" : "var(--panel)",
              color: tab === id ? "#fff" : "var(--ink)",
              borderColor: tab === id ? "var(--ink,#0f172a)" : "var(--line)",
            }}>{label}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-4,#7c8798)",
          alignSelf: "center" }}>
          <span style={{ background: CHILD_TINT, padding: "1px 5px", borderRadius: 4 }}>
            {rel.child_table}
          </span>{" "}
          <span style={{ background: PARENT_TINT, padding: "1px 5px", borderRadius: 4 }}>
            {rel.parent_table}
          </span>
        </span>
      </div>

      {/* rows */}
      <div style={{ overflow: "auto", padding: "8px 12px 12px", flex: 1 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-4,#7c8798)", padding: "10px 2px" }}>
            {tab === "orphans"
              ? "Every sampled row found a parent — no unmatched rows in this sample."
              : "No rows returned for this join."}
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
            <thead>
              <tr>
                {ordered.map((c) => (
                  <th key={c} style={{
                    textAlign: "left", padding: "5px 9px", position: "sticky", top: 0,
                    borderBottom: "1px solid #e2e8f0", background: tintFor(c) || "#fff",
                    whiteSpace: "nowrap", fontWeight: 800,
                  }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {ordered.map((c) => {
                    const empty = row[c] === null || row[c] === undefined || row[c] === "";
                    return (
                      <td key={c} style={{
                        padding: "4px 9px", borderBottom: "1px solid #f1f5f9",
                        whiteSpace: "nowrap",
                        color: empty ? "#c02b3c" : undefined,
                        fontStyle: empty ? "italic" : undefined,
                      }}>{empty ? "—" : String(row[c])}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
