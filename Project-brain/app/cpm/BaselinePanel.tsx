"use client";

/**
 * BaselinePanel — UI for the P1 backend (/cpm baselines, variance, XER export).
 *
 * · Capture named baselines (unlimited, P6-style) — recalculates CPM first
 * · Pick any baseline → variance grid vs the current schedule
 * · TanStack table: sortable, colour-coded slippage, went-critical badge,
 *   added/removed rows; summary strip with project-finish variance
 * · One-click Primavera .xer export of the live schedule
 *
 * Self-contained: drop <BaselinePanel scheduleId={id} /> anywhere.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel,
  SortingState, useReactTable,
} from "@tanstack/react-table";
import {
  AlertTriangle, ArrowDownUp, CircleDot, Download, GitCommitHorizontal,
  Loader2, Plus, Save,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const cp = (p: string) => `${API}/cpm${p}`;
const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";

type Baseline = {
  baseline_id: number; name: string; note?: string;
  project_finish?: string; created_by?: string; created_at: string;
  activity_count: number;
};
type VarAct = {
  activity_id: number; code: string; name: string; status: string;
  baseline_start?: string; current_start?: string; start_var_days?: number | null;
  baseline_finish?: string; current_finish?: string; finish_var_days?: number | null;
  duration_var_days?: number; float_var_days?: number;
  baseline_critical?: boolean; current_critical?: boolean; went_critical?: boolean;
};
type Variance = {
  baseline: { name: string; project_finish?: string };
  current_project_finish?: string;
  project_finish_variance_days?: number | null;
  slipped_activities: number; went_critical: string[];
  added: string[]; removed: string[]; activities: VarAct[];
};

const panel: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 };
const inp: React.CSSProperties = { background: "var(--panel-2)", border: "1px solid var(--line)",
  borderRadius: 7, color: "var(--ink)", fontSize: 12, padding: "5px 8px", outline: "none" };
const btn = (primary = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
  padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
  border: "1px solid var(--line)", background: primary ? "var(--steel)" : "transparent",
  color: primary ? "#fff" : "var(--ink-2)",
});

const varColor = (d?: number | null) =>
  d == null ? "var(--ink-4)" : d > 0 ? "#e5534b" : d < 0 ? "#3fb950" : "var(--ink-3)";
const sign = (d?: number | null) => (d == null ? "—" : d > 0 ? `+${d}` : `${d}`);

const col = createColumnHelper<VarAct>();

export default function BaselinePanel({ scheduleId }: { scheduleId: number }) {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [variance, setVariance] = useState<Variance | null>(null);
  const [name, setName] = useState("Baseline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "finish_var_days", desc: true }]);

  const loadBaselines = useCallback(async () => {
    try {
      const r = await authFetch(cp(`/baselines/${scheduleId}`));
      const j = await r.json();
      setBaselines(j.baselines || []);
    } catch { setErr("Failed to load baselines"); }
  }, [scheduleId]);
  useEffect(() => { loadBaselines(); }, [loadBaselines]);

  const capture = async () => {
    setBusy(true); setErr("");
    try {
      const r = await authFetch(cp(`/baselines/${scheduleId}`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, run_cpm_first: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Capture failed");
      await loadBaselines();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const loadVariance = async (bid: number) => {
    setBusy(true); setErr(""); setActiveId(bid);
    try {
      const r = await authFetch(cp(`/baselines/${scheduleId}/${bid}/variance`));
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Variance failed");
      setVariance(j);
    } catch (e: any) { setErr(e.message); setVariance(null); } finally { setBusy(false); }
  };

  const exportXer = async () => {
    const r = await authFetch(cp(`/export-xer/${scheduleId}`));
    if (!r.ok) { setErr("Export failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `schedule_${scheduleId}.xer`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const columns = useMemo(() => [
    col.accessor("code", { header: "Code",
      cell: (i) => <span style={{ fontFamily: mono, fontWeight: 700 }}>{i.getValue()}</span> }),
    col.accessor("name", { header: "Activity" }),
    col.accessor("status", { header: "Status",
      cell: (i) => {
        const s = i.getValue();
        const tone = s === "added" ? "#3fb950" : s === "removed" ? "#e5534b"
          : s === "changed" ? "#f0883e" : "var(--ink-4)";
        return <span style={{ color: tone, fontWeight: 600 }}>{s}</span>;
      } }),
    col.accessor("start_var_days", { header: "Start Δ",
      cell: (i) => <span style={{ fontFamily: mono, color: varColor(i.getValue()) }}>{sign(i.getValue())}</span>,
      sortUndefined: "last" }),
    col.accessor("finish_var_days", { header: "Finish Δ",
      cell: (i) => <span style={{ fontFamily: mono, fontWeight: 700, color: varColor(i.getValue()) }}>{sign(i.getValue())}</span>,
      sortUndefined: "last" }),
    col.accessor("duration_var_days", { header: "Duration Δ",
      cell: (i) => <span style={{ fontFamily: mono, color: varColor(i.getValue()) }}>{sign(i.getValue())}</span>,
      sortUndefined: "last" }),
    col.accessor("float_var_days", { header: "Float Δ",
      cell: (i) => {
        const v = i.getValue();
        // float erosion (negative) is the bad direction here
        return <span style={{ fontFamily: mono, color: v == null ? "var(--ink-4)" : v < 0 ? "#e5534b" : v > 0 ? "#3fb950" : "var(--ink-3)" }}>{sign(v)}</span>;
      }, sortUndefined: "last" }),
    col.accessor("current_critical", { header: "Critical",
      cell: (i) => {
        const r = i.row.original;
        if (r.went_critical) return <span style={{ color: "#e5534b", fontWeight: 700, fontSize: 11 }}>▲ now critical</span>;
        return i.getValue() ? <CircleDot size={12} style={{ color: "var(--steel)" }} /> : null;
      } }),
  ], []);

  const table = useReactTable({
    data: variance?.activities ?? [], columns,
    state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12 }}>
      {/* baselines list + capture */}
      <div style={{ ...panel, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <GitCommitHorizontal size={14} style={{ color: "var(--steel)" }} />
          <b style={{ fontSize: 12.5, flex: 1 }}>Baselines</b>
          <button style={btn()} onClick={exportXer} title="Export live schedule as Primavera .xer">
            <Download size={12} /> XER
          </button>
        </div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          <input style={{ ...inp, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Baseline name" />
          <button style={btn(true)} onClick={capture} disabled={busy}>
            {busy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} Capture
          </button>
        </div>
        {baselines.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-4)", padding: "8px 2px" }}>
            No baselines yet. Capturing runs CPM first, then snapshots every
            activity's dates, float and criticality.
          </div>
        )}
        {baselines.map((b) => (
          <div key={b.baseline_id} onClick={() => loadVariance(b.baseline_id)}
               style={{ padding: "7px 9px", borderRadius: 7, cursor: "pointer", marginBottom: 3,
                        border: `1px solid ${activeId === b.baseline_id ? "var(--steel)" : "var(--line)"}` }}>
            <div style={{ fontSize: 12, fontWeight: 750 }}>{b.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: mono }}>
              {b.activity_count} acts · finish {b.project_finish || "—"}
              {b.created_by ? ` · ${b.created_by}` : ""}
            </div>
          </div>
        ))}
      </div>

      {/* variance grid */}
      <div style={{ ...panel, padding: 12 }}>
        {err && (
          <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 7,
                        background: "rgba(229,83,75,.12)", border: "1px solid rgba(229,83,75,.4)",
                        color: "#e5534b", fontSize: 12, fontWeight: 600 }}>{err}</div>
        )}
        {!variance ? (
          <div style={{ color: "var(--ink-4)", fontSize: 12.5, padding: 20 }}>
            Select a baseline to see per-activity variance against the current
            schedule — start/finish/duration slippage, float erosion, and any
            activities that have gone critical.
          </div>
        ) : (
          <>
            {/* summary strip */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10,
                          paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
              <Stat label="Project finish Δ" value={sign(variance.project_finish_variance_days)}
                    color={varColor(variance.project_finish_variance_days)} big />
              <Stat label="Baseline → Current"
                    value={`${variance.baseline.project_finish || "—"} → ${variance.current_project_finish || "—"}`} />
              <Stat label="Slipped" value={variance.slipped_activities}
                    color={variance.slipped_activities > 0 ? "#e5534b" : "var(--ink-3)"} />
              {variance.went_critical.length > 0 && (
                <Stat label="Newly critical" value={variance.went_critical.join(", ")} color="#e5534b" />
              )}
              {variance.added.length > 0 && <Stat label="Added" value={variance.added.join(", ")} color="#3fb950" />}
              {variance.removed.length > 0 && <Stat label="Removed" value={variance.removed.join(", ")} color="#e5534b" />}
            </div>

            {(variance.went_critical.length > 0 || (variance.project_finish_variance_days || 0) > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                            fontSize: 12, color: "#f0883e" }}>
                <AlertTriangle size={13} />
                {(variance.project_finish_variance_days || 0) > 0
                  ? `Project completion has slipped ${variance.project_finish_variance_days} day(s) since this baseline.`
                  : "Critical path composition has changed since this baseline."}
              </div>
            )}

            <div style={{ overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                            style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap",
                                     borderBottom: "1px solid var(--line)", color: "var(--ink-3)",
                                     fontWeight: 800, cursor: "pointer", userSelect: "none" }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ??
                           (h.column.getCanSort() ? <ArrowDownUp size={9} style={{ opacity: .4, marginLeft: 3 }} /> : "")}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} style={{ background: row.original.went_critical ? "rgba(229,83,75,.06)" : undefined }}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} style={{ padding: "5px 8px", borderBottom: "1px solid var(--line)",
                                                   color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, big }: {
  label: string; value: string | number; color?: string; big?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase",
                    letterSpacing: .4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: big ? 18 : 13, fontWeight: 800, fontFamily: mono,
                    color: color || "var(--ink)" }}>{value}</div>
    </div>
  );
}
