"use client";
import React, { useState } from "react";
import { Button, Chip, Segmented, Select, Field, toast } from "@/ui";
import { DprSource, DprDerived, getDprDaily, analyzeDpr, applyDprActuals, freezeDprMonth } from "@/lib/furnace/api";
import { aggregateDailyToMonthly, deriveFromDaily, validateDerived, ValidatedRow, confidenceTone } from "@/lib/furnace/dprAnalysis";

const SOURCES = [
  { value: "daily", label: "From daily entries" },
  { value: "upload", label: "Upload DPR" },
  { value: "ai", label: "AI analyse" },
];
const MONTHS = ["2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11"];

/** Analysis & auto-refill provision: derive monthly actuals from a DPR source,
 *  review/override, apply to the plan, then freeze the month as baseline. */
export function DprAutofill({ packageId }: { packageId: number }) {
  const [source, setSource] = useState<DprSource>("daily");
  const [month, setMonth] = useState(MONTHS[0]);
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [frozen, setFrozen] = useState(false);
  const [busy, setBusy] = useState(false);

  const analyse = async () => {
    setBusy(true);
    let derived: DprDerived[];
    if (source === "daily") {
      const daily = await getDprDaily(packageId, month);
      const monthly = aggregateDailyToMonthly(daily, month);
      // prev_actual would come from frozen history; analyzeDpr mock carries it, so blend:
      const seeded = await analyzeDpr(packageId, month, "daily");
      derived = deriveFromDaily(seeded.map((s) => ({ ...s })), monthly).map((d, i) => ({ ...d, prev_actual: seeded[i].prev_actual }));
    } else {
      derived = await analyzeDpr(packageId, month, source);
    }
    const validated = validateDerived(derived);
    setRows(validated);
    setInclude(Object.fromEntries(validated.map((r) => [r.activity_id, true])));
    setOverrides({});
    setFrozen(false); setBusy(false);
    toast(`Analysed ${validated.length} activities from ${source === "ai" ? "AI" : source}`);
  };

  const effQty = (r: ValidatedRow) => (overrides[r.activity_id] != null && overrides[r.activity_id] !== "" ? parseFloat(overrides[r.activity_id]) || 0 : r.derived_qty);

  const apply = async () => {
    const payload = rows.filter((r) => include[r.activity_id]).map((r) => ({ activity_id: r.activity_id, actual_qty: effQty(r) }));
    const res = await applyDprActuals(packageId, month, payload);
    toast(`Applied ${res.applied} actuals to ${month}`);
  };
  const freeze = async () => {
    await applyDprActuals(packageId, month, rows.filter((r) => include[r.activity_id]).map((r) => ({ activity_id: r.activity_id, actual_qty: effQty(r) })));
    await freezeDprMonth(packageId, month); setFrozen(true);
    toast(`${month} frozen — now the baseline for the next revision`);
  };

  const th: React.CSSProperties = { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", fontWeight: 600, textAlign: "left", padding: "10px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
  const tdN: React.CSSProperties = { padding: "7px 12px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: "var(--ink-2)" };
  const lowConf = rows.filter((r) => r.confidence < 0.75).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <Field label="Source"><Segmented options={SOURCES} value={source} onChange={(v) => setSource(v as DprSource)} /></Field>
        <Field label="Month"><Select value={month} onChange={setMonth} options={MONTHS.map((m) => ({ value: m, label: m }))} style={{ minWidth: 120 }} /></Field>
        {source === "upload" && <Button onClick={() => toast("Choose a DPR file… (xlsx / pdf / csv)")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0-12 4 4m-4-4-4 4M4 21h16" /></svg>Choose file
        </Button>}
        <div style={{ flex: 1 }} />
        <Button kind="steel" onClick={analyse} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          {busy ? "Analysing…" : "Analyse"}
        </Button>
      </div>

      {source === "ai" && (
        <div style={{ padding: "8px 16px", fontSize: 11.5, color: "var(--steel)", background: "var(--steel-soft)", borderBottom: "1px solid var(--line)" }}>
          AI analyse routes to your multi-provider RAG service — extracts progress from free-text/scanned DPRs and maps to activities. Always shown for review before apply.
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ padding: 44, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>Pick a source and Analyse to derive this month's actuals.</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <Chip tone="neutral">{rows.length} activities</Chip>
            {lowConf > 0 && <Chip tone="moderate" dot>{lowConf} low-confidence — review</Chip>}
            {rows.some((r) => r.capped) && <Chip tone="critical" dot>capped to scope</Chip>}
            <div style={{ flex: 1 }} />
            <Button onClick={apply} disabled={frozen}>Apply to plan</Button>
            <Button kind="accent" onClick={freeze} disabled={frozen}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              {frozen ? "Frozen" : "Freeze month"}
            </Button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>
                <th style={{ ...th, width: 30 }} />
                <th style={th}>Activity</th><th style={{ ...th, textAlign: "right" }}>Prev actual</th>
                <th style={{ ...th, textAlign: "right" }}>Derived</th><th style={{ ...th, textAlign: "right" }}>Override</th>
                <th style={{ ...th, textAlign: "right" }}>Cumulative</th><th style={{ ...th, textAlign: "right" }}>Prog %</th>
                <th style={th}>Source · confidence</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const eff = effQty(r); const cum = r.prev_actual + eff; const pct = r.scope_qty ? +((cum / r.scope_qty) * 100).toFixed(1) : 0;
                  return (
                    <tr key={r.activity_id} style={{ borderBottom: "1px solid var(--line)", opacity: include[r.activity_id] ? 1 : 0.45 }}>
                      <td style={{ padding: "7px 12px" }}><input type="checkbox" checked={!!include[r.activity_id]} onChange={(e) => setInclude((s) => ({ ...s, [r.activity_id]: e.target.checked }))} /></td>
                      <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.activity_name}<div style={{ fontSize: 10, color: "var(--ink-4)", fontFamily: '"IBM Plex Mono", monospace' }}>scope {r.scope_qty} {r.uom}</div></td>
                      <td style={tdN}>{r.prev_actual.toLocaleString("en-IN")}</td>
                      <td style={{ ...tdN, color: r.capped ? "var(--molten)" : "var(--ember)" }}>{r.derived_qty.toLocaleString("en-IN")}{r.capped ? " ⚠" : ""}</td>
                      <td style={{ padding: "4px 12px", textAlign: "right" }}>
                        <input value={overrides[r.activity_id] ?? ""} placeholder="—" onChange={(e) => setOverrides((s) => ({ ...s, [r.activity_id]: e.target.value }))} inputMode="decimal"
                          style={{ width: 76, background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)", borderRadius: 6, padding: "5px 6px", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, textAlign: "right", outline: "none" }} />
                      </td>
                      <td style={tdN}>{cum.toLocaleString("en-IN")}</td>
                      <td style={tdN}>{pct}%</td>
                      <td style={{ padding: "7px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {r.source === "daily" ? <Chip tone="ok">Daily</Chip> : r.source === "upload" ? <Chip tone="steel">Upload</Chip> : <Chip tone="steel">AI</Chip>}
                          {r.source !== "daily" && <Chip tone={confidenceTone(r.confidence)}>{Math.round(r.confidence * 100)}%</Chip>}
                          <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{r.matched}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {frozen && <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--verdigris)", background: "var(--verdigris-soft)" }}>{month} actuals frozen — preserved read-only as the baseline for the next plan revision.</div>}
        </>
      )}
    </div>
  );
}
