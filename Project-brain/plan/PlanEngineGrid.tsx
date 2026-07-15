"use client";
import React, { useMemo, useState } from "react";
import { PlanActivity } from "@/lib/furnace/api";
import { Button, Chip, toast } from "@/ui";

const COLORS = ["var(--steel-deep)", "var(--steel-dim)", "var(--steel)", "var(--verdigris)", "var(--slag)", "var(--ember)", "var(--molten)", "var(--steel-2)"];

export function PlanEngineGrid({
  activities, locked, onChange, onLock, onRegenerate,
}: {
  activities: PlanActivity[];
  locked: boolean;
  onChange: (next: PlanActivity[]) => void;
  onLock: (lock: boolean) => void;
  onRegenerate: () => void;
}) {
  const [nextId, setNextId] = useState(() => Math.max(0, ...activities.map((a) => a.activity_id)) + 1);
  const total = useMemo(() => activities.reduce((s, a) => s + (+a.weightage || 0), 0), [activities]);
  const ok = Math.abs(total - 100) < 0.01;

  const patch = (i: number, f: keyof PlanActivity, v: string) => {
    const next = activities.map((a, idx) => idx === i
      ? { ...a, [f]: f === "scope_qty" || f === "weightage" ? parseFloat(v) || 0 : v } : a);
    onChange(next);
  };
  const remove = (i: number) => { onChange(activities.filter((_, idx) => idx !== i)); toast("Activity removed"); };
  const add = () => {
    onChange([...activities, { activity_id: nextId, activity_name: "New activity", uom: "Nos", scope_qty: 0, weightage: 0 }]);
    setNextId((n) => n + 1); toast("Activity added — set weightage");
  };
  const tryLock = () => {
    if (!locked && !ok) { toast("Weightage must total 100% before locking baseline"); return; }
    onLock(!locked);
  };
  const regen = () => { if (!ok) { toast("Balance weightage to 100% first"); return; } onRegenerate(); };

  const cell: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)", borderRadius: 7, padding: "6px 8px", font: "inherit", fontSize: 12.5, outline: "none" };
  const numCell: React.CSSProperties = { ...cell, fontFamily: '"IBM Plex Mono", monospace', textAlign: "right" };

  return (
    <div>
      {locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", fontSize: 12, color: "var(--slag)", background: "var(--slag-soft)", borderBottom: "1px solid var(--line)", borderRadius: "10px 10px 0 0" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          Baseline locked — activities frozen. Unlock (admin) to edit.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 200, height: 8, borderRadius: 5, background: "var(--panel-3)", overflow: "hidden", display: "flex", border: "1px solid var(--line)" }}>
            {activities.map((a, i) => <span key={a.activity_id} style={{ width: `${a.weightage}%`, height: "100%", background: COLORS[i % COLORS.length] }} />)}
          </div>
          <Chip tone={ok ? "ok" : "critical"} style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{(+total.toFixed(1))}%</Chip>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>total weightage</span>
        </div>
        <div style={{ flex: 1 }} />
        <Button kind="steel" onClick={regen}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>
          Regenerate S-Curve
        </Button>
        <Button onClick={tryLock} style={locked ? { background: "var(--ember-soft)", borderColor: "var(--ember)", color: "var(--ember)" } : {}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          {locked ? "Baseline locked" : "Lock baseline"}
        </Button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Activity", "UoM", "Scope qty", "Weightage %", "Share", ""].map((h, i) => (
                <th key={h} style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--ink-3)", fontWeight: 600, textAlign: i >= 2 && i <= 3 ? "right" : "left", padding: "11px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activities.map((a, i) => {
              const share = total ? Math.round((a.weightage / total) * 100) : 0;
              return (
                <tr key={a.activity_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 14px" }}>
                    <input disabled={locked} value={a.activity_name} onChange={(e) => patch(i, "activity_name", e.target.value)}
                      style={{ ...cell, width: "100%", fontWeight: 600, border: "1px solid transparent", background: "transparent" }} />
                  </td>
                  <td style={{ padding: "5px 14px" }}><input disabled={locked} value={a.uom} onChange={(e) => patch(i, "uom", e.target.value)} style={{ ...cell, width: 70 }} /></td>
                  <td style={{ padding: "5px 14px", textAlign: "right" }}><input disabled={locked} value={a.scope_qty} onChange={(e) => patch(i, "scope_qty", e.target.value)} inputMode="decimal" style={{ ...numCell, width: 90 }} /></td>
                  <td style={{ padding: "5px 14px", textAlign: "right" }}><input disabled={locked} value={a.weightage} onChange={(e) => patch(i, "weightage", e.target.value)} inputMode="decimal" style={{ ...numCell, width: 76 }} /></td>
                  <td style={{ padding: "5px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 4, background: "var(--panel-3)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${share}%`, background: COLORS[i % COLORS.length], transition: ".3s" }} />
                      </div>
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: "var(--ink-3)", width: 38, textAlign: "right" }}>{share}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "5px 14px", textAlign: "right" }}>
                    {!locked && (
                      <button onClick={() => remove(i)} title="Remove" style={{ background: "transparent", border: 0, color: "var(--ink-4)", cursor: "pointer", padding: 6, borderRadius: 6 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div style={{ padding: "12px 14px" }}>
          <button onClick={add} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px dashed var(--line-2)", color: "var(--ink-3)", borderRadius: 9, padding: "9px 14px", font: "600 12.5px Inter", cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>Add activity
          </button>
        </div>
      )}
    </div>
  );
}
