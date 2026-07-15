"use client";
import React, { useEffect, useState } from "react";
import { Button, Chip, Select, Field, toast } from "@/ui";
import { CapexWorkspace, FY_MONTHS, getCapexWorkspace, saveCapexCell, lockCapexMonth, unlockCapexMonth } from "@/lib/furnace/api";

/** Editable actuals workspace: pick a month, edit per-scheme actuals,
 *  lock/unlock the month. Locked months render amber + read-only. */
export function CapexActuals({ fy }: { fy: string }) {
  const [ws, setWs] = useState<CapexWorkspace | null>(null);
  const [monthNo, setMonthNo] = useState(3); // default Jun (idx 2 -> month_no 3)
  const [edits, setEdits] = useState<Record<string, number>>({});

  const load = () => { if (fy) getCapexWorkspace(fy).then((w) => { setWs(w); setEdits({}); }); };
  useEffect(load, [fy]);

  if (!ws) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>Loading actuals…</div>;
  const mi = monthNo - 1;
  const isLocked = ws.locked_months.includes(monthNo);

  const cellVal = (rowId: number, rowLabel: string) => {
    const k = `${rowId}|${monthNo}`;
    if (k in edits) return edits[k];
    const row = ws.rows.find((r) => r.label === rowLabel);
    return row?.months[mi]?.actual ?? 0;
  };
  const setCell = (rowId: number, v: string) => setEdits((e) => ({ ...e, [`${rowId}|${monthNo}`]: parseFloat(v) || 0 }));
  const saveAll = async () => {
    if (isLocked) { toast(`${FY_MONTHS[mi]} is locked`); return; }
    const keys = Object.keys(edits).filter((k) => k.endsWith(`|${monthNo}`));
    for (const k of keys) await saveCapexCell(fy, Number(k.split("|")[0]), monthNo, edits[k]);
    toast(`Saved ${keys.length} cell(s) for ${FY_MONTHS[mi]}`); load();
  };
  const toggleLock = async () => {
    if (isLocked) { await unlockCapexMonth(fy, monthNo); toast(`${FY_MONTHS[mi]} unlocked`); }
    else { await lockCapexMonth(fy, monthNo); toast(`${FY_MONTHS[mi]} locked — no further actuals`); }
    load();
  };

  const th: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", fontWeight: 600, padding: "9px 10px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <Field label="Effective month">
          <Select value={monthNo} onChange={(v) => setMonthNo(+v)}
            options={FY_MONTHS.map((m, i) => ({ value: i + 1, label: `${m}${ws.locked_months.includes(i + 1) ? " 🔒" : ""}` }))} style={{ minWidth: 130 }} />
        </Field>
        {isLocked
          ? <Chip tone="critical" dot>{FY_MONTHS[mi]} locked</Chip>
          : <Chip tone="ok" dot>editable</Chip>}
        <div style={{ flex: 1 }} />
        <Button onClick={toggleLock} style={isLocked ? { borderColor: "var(--molten)", color: "var(--molten)" } : {}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" />{isLocked ? <path d="M8 11V8a4 4 0 0 1 7-2.5" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}</svg>
          {isLocked ? "Unlock month" : "Lock month"}
        </Button>
        <Button kind="steel" onClick={saveAll} disabled={isLocked}>Save actuals</Button>
      </div>
      {ws.note && <div style={{ padding: "8px 16px", fontSize: 11.5, color: "var(--slag)", background: "var(--slag-soft)", borderBottom: "1px solid var(--line)" }}>{ws.note}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", position: "sticky", left: 0 }}>Scheme</th>
              {FY_MONTHS.map((m, i) => {
                const locked = ws.locked_months.includes(i + 1), active = i + 1 === monthNo;
                return <th key={m} style={{ ...th, textAlign: "right", color: active ? "var(--steel)" : locked ? "var(--ember)" : "var(--ink-3)", background: active ? "var(--steel-soft)" : "var(--panel-2)" }}>{m}{locked ? " 🔒" : ""}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {ws.rows.map((r) => (
              <tr key={r.label} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600, position: "sticky", left: 0, background: "var(--panel)", whiteSpace: "nowrap" }}>{r.label}</td>
                {FY_MONTHS.map((m, i) => {
                  const locked = ws.locked_months.includes(i + 1), active = i + 1 === monthNo;
                  const baseActual = r.months[i]?.actual ?? 0;
                  if (active && !locked) {
                    return <td key={m} style={{ padding: "4px 6px", textAlign: "right", background: "var(--steel-soft)" }}>
                      <input value={cellVal(r.row_id ?? 0, r.label)} onChange={(e) => setCell(r.row_id ?? 0, e.target.value)} inputMode="decimal"
                        style={{ width: 64, background: "var(--panel)", border: "1px solid var(--steel-dim)", color: "var(--ink)", borderRadius: 6, padding: "5px 6px", fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5, textAlign: "right", outline: "none" }} />
                    </td>;
                  }
                  return <td key={m} style={{ padding: "8px 10px", textAlign: "right", fontFamily: '"IBM Plex Mono", monospace', color: locked ? "var(--ember)" : "var(--ink-3)", background: locked ? "var(--ember-soft)" : undefined }}>{baseActual ? baseActual.toLocaleString("en-IN") : "·"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
