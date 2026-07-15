"use client";
import React, { useEffect, useState } from "react";
import { Button, Chip, Field, toast } from "@/ui";
import { DprDailyActivity, getDprByDate, saveDprDaily } from "@/lib/furnace/api";

const sourceChip = (v?: string | null) =>
  v === "app" ? <Chip tone="steel">📱 App</Chip> : v === "web" ? <Chip tone="ok">Web</Chip> : v === "dpr" ? <Chip tone="neutral">DPR</Chip> : <Chip tone="neutral">—</Chip>;

/** Enter actual qty + remarks for each activity on a given date.
 *  Writes daily_actuals (entered_via=web). Loads existing entries for the date. */
export function DprDaily({ packageId }: { packageId: number }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [acts, setActs] = useState<DprDailyActivity[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});

  const load = () => {
    if (!packageId) return;
    getDprByDate(packageId, date).then((rows) => {
      setActs(rows);
      const q: Record<number, string> = {}, rm: Record<number, string> = {};
      rows.forEach((a) => { if (a.actual_qty > 0) q[a.activity_id] = String(a.actual_qty); if (a.remarks) rm[a.activity_id] = a.remarks; });
      setQty(q); setRemarks(rm);
    });
  };
  useEffect(load, [packageId, date]);

  const saveOne = async (a: DprDailyActivity) => {
    await saveDprDaily({ package_id: packageId, activity_id: a.activity_id, actual_date: date, actual_qty: parseFloat(qty[a.activity_id] || "0"), remarks: remarks[a.activity_id] || null });
    toast(`Saved ${a.activity_name} for ${date}`);
  };
  const saveAll = async () => {
    for (const a of acts) if (qty[a.activity_id] != null) await saveDprDaily({ package_id: packageId, activity_id: a.activity_id, actual_date: date, actual_qty: parseFloat(qty[a.activity_id] || "0"), remarks: remarks[a.activity_id] || null });
    toast(`Daily entry saved for ${date}`); load();
  };

  const inp: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)", borderRadius: 7, padding: "6px 8px", font: "inherit", fontSize: 12.5, outline: "none" };
  const th: React.CSSProperties = { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)", fontWeight: 600, textAlign: "left", padding: "10px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <Field label="Entry date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, colorScheme: "light dark" }} />
        </Field>
        <div style={{ flex: 1 }} />
        <Button kind="steel" onClick={saveAll}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 4h11l3 3v13H5z" /><path d="M9 4v5h6" /></svg>
          Save daily entry
        </Button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Activity", "UoM", "Actual qty", "Remarks", "Source", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {acts.map((a) => (
              <tr key={a.activity_id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 14px", fontWeight: 600 }}>{a.activity_name}<div style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: '"IBM Plex Mono", monospace' }}>scope {a.scope_qty}</div></td>
                <td style={{ padding: "8px 14px", color: "var(--ink-3)" }}>{a.uom}</td>
                <td style={{ padding: "6px 14px" }}><input value={qty[a.activity_id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [a.activity_id]: e.target.value }))} inputMode="decimal" placeholder="0" style={{ ...inp, width: 96, textAlign: "right", fontFamily: '"IBM Plex Mono", monospace' }} /></td>
                <td style={{ padding: "6px 14px" }}><input value={remarks[a.activity_id] ?? ""} onChange={(e) => setRemarks((r) => ({ ...r, [a.activity_id]: e.target.value }))} placeholder="—" style={{ ...inp, width: "100%", minWidth: 180 }} /></td>
                <td style={{ padding: "8px 14px" }}>{sourceChip(a.entered_via)}</td>
                <td style={{ padding: "8px 14px", textAlign: "right" }}><button onClick={() => saveOne(a)} style={{ background: "var(--panel-3)", border: "1px solid var(--line-2)", color: "var(--ink-2)", borderRadius: 7, padding: "5px 10px", font: "600 11.5px Inter", cursor: "pointer" }}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 16px", fontSize: 11.5, color: "var(--ink-3)" }}>App-entered rows come from the native mobile diary; DPR rows from monthly entry; Web rows from this screen.</div>
    </div>
  );
}
