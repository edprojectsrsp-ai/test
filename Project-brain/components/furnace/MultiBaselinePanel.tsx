"use client";
/**
 * MultiBaselinePanel — compare the live schedule against several baselines at
 * once, P6/SYNCHRO style.
 *
 * The single-baseline variance grid answers "how far from plan". This answers
 * the question actually asked at a review: we have slipped against the
 * original, but are we holding the rebaseline the client approved? One column
 * per baseline, worst slip at the top, so the damage is visible immediately.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, Chip } from "@/ui";

// Chart view shares this panel's fetch — opening both costs one request.
const BaselineGantt = dynamic(() => import("@/components/furnace/BaselineGantt"), { ssr: false });

const API = (process.env.NEXT_PUBLIC_API_BASE
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || "http://127.0.0.1:8000/api/scheduling").replace(/\/$/, "");

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
  fontVariantNumeric: "tabular-nums",
};
const th: React.CSSProperties = {
  padding: "6px 10px", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase",
  color: "var(--steel-dim)", borderBottom: "1px solid var(--line)",
  background: "var(--panel)", position: "sticky", top: 0, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "5px 10px", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5,
};

type Baseline = {
  baseline_id: number; name: string;
  project_finish: string | null; created_at: string | null; activity_count: number;
};
type Cell = {
  bl_start: string | null; bl_finish: string | null;
  start_var_days: number | null; finish_var_days: number | null;
  duration_var_days: number | null; went_critical: boolean;
  status: "on_track" | "slipped" | "ahead" | "added";
};
type Row = {
  code: string; name: string;
  current_start: string | null; current_finish: string | null;
  current_critical: boolean; percent_complete: number;
  worst_slip_days: number; cells: Record<string, Cell>;
};
type Summary = {
  baseline_id: number; name: string; project_finish: string | null;
  current_project_finish: string | null; project_finish_variance_days: number | null;
  slipped: number; ahead: number; on_track: number; added: number;
  removed: string[]; went_critical: string[];
};

const STATUS_COLOR = {
  slipped: "var(--molten)",
  ahead: "var(--verdigris)",
  on_track: "var(--ink-2)",
  added: "var(--steel-dim)",
} as const;

const fmtVar = (d: number | null) =>
  d === null ? "\u2014" : d === 0 ? "0" : d > 0 ? `+${d}d` : `${d}d`;

export default function MultiBaselinePanel({ projectId }: { projectId: number | string }) {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [tolerance, setTolerance] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slippedOnly, setSlippedOnly] = useState(false);
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const [dataDate, setDataDate] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/projects/${projectId}/baselines`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((b: Baseline[]) => {
        setBaselines(b);
        // default to the two most recent — the usual original vs rebaseline read
        setSelected(b.slice(0, 2).map((x) => x.baseline_id));
      })
      .catch(() => setError("Could not load baselines"));
  }, [projectId]);

  const compare = useCallback(async () => {
    if (!selected.length) return;
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({
        baseline_ids: selected.join(","),
        slip_tolerance_days: String(tolerance),
      });
      const r = await fetch(`${API}/projects/${projectId}/baselines/compare?${qs}`,
        { cache: "no-store" });
      if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
      const data = await r.json();
      setRows(data.activities || []);
      setSummaries(data.baselines || []);
      setDataDate(data.data_date ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [projectId, selected, tolerance]);

  useEffect(() => { compare(); }, [compare]);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id)
      : s.length >= 6 ? s : [...s, id]));

  const visible = useMemo(
    () => (slippedOnly ? rows.filter((r) => r.worst_slip_days > 0) : rows),
    [rows, slippedOnly]);

  const exportCsv = () => {
    const header = ["Code", "Activity", "% Complete", "Current Finish",
      ...summaries.flatMap((s) => [`${s.name} Finish`, `${s.name} Var (d)`])];
    const body = visible.map((r) => [
      r.code, r.name, r.percent_complete, r.current_finish ?? "",
      ...summaries.flatMap((s) => {
        const c = r.cells[String(s.baseline_id)];
        return [c?.bl_finish ?? "", c?.finish_var_days ?? ""];
      }),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((c) => {
        const v = String(c ?? "");
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "multi-baseline-comparison.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card pad={false}>
      <div style={{
        padding: "12px 14px", borderBottom: "1px solid var(--grid-line)",
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      }}>
        <div>
          <span style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" }}>
            Baselines
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            Multi-baseline comparison
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Slip tolerance
          <input type="number" min={0} max={90} value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value) || 0)}
            style={{ ...mono, width: 62, padding: "4px 7px", borderRadius: 7,
              border: "1px solid var(--line)", background: "var(--panel-2)",
              color: "var(--ink)", fontSize: 12 }} />
          d
        </label>
        <Button onClick={() => setMode("chart")} kind={mode === "chart" ? "accent" : "default"}>Chart</Button>
        <Button onClick={() => setMode("table")} kind={mode === "table" ? "accent" : "default"}>Table</Button>
        {mode === "table" && (
          <Button onClick={() => setSlippedOnly((v) => !v)}
            kind={slippedOnly ? "accent" : "default"}>Slipped only</Button>
        )}
        <Button onClick={exportCsv}>CSV</Button>
      </div>

      {/* baseline picker */}
      <div style={{ padding: "10px 14px", display: "flex", gap: 7, flexWrap: "wrap" }}>
        {baselines.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--steel-dim)" }}>
            No baselines captured yet. Capture one to start tracking variance.
          </span>
        )}
        {baselines.map((b) => {
          const on = selected.includes(b.baseline_id);
          return (
            <button key={b.baseline_id} onClick={() => toggle(b.baseline_id)}
              title={b.created_at ? `Captured ${b.created_at.slice(0, 10)} · ${b.activity_count} activities` : undefined}
              style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                cursor: "pointer", background: on ? "var(--steel-soft)" : "transparent",
                color: on ? "var(--ink)" : "var(--steel-dim)",
                border: `1px solid ${on ? "var(--steel)" : "var(--line)"}`,
              }}>
              {b.name}
              <span style={{ ...mono, marginLeft: 6, color: "var(--steel-dim)" }}>
                {b.project_finish ? b.project_finish.slice(0, 10) : "\u2014"}
              </span>
            </button>
          );
        })}
        {selected.length >= 6 && (
          <span style={{ fontSize: 11, color: "var(--steel-dim)", alignSelf: "center" }}>
            Maximum 6 baselines
          </span>
        )}
      </div>

      {/* per-baseline summary strip */}
      {summaries.length > 0 && (
        <div style={{
          display: "flex", gap: 10, flexWrap: "wrap",
          padding: "0 14px 12px", alignItems: "stretch",
        }}>
          {summaries.map((s) => {
            const v = s.project_finish_variance_days;
            const tone = v === null ? "var(--steel-dim)"
              : v > 0 ? "var(--molten)" : v < 0 ? "var(--verdigris)" : "var(--ink-2)";
            return (
              <div key={s.baseline_id} style={{
                flex: "1 1 200px", padding: "9px 12px", borderRadius: "var(--r)",
                border: "1px solid var(--line)", background: "var(--panel-2)",
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}>{s.name}</div>
                <div style={{ ...mono, fontSize: 19, fontWeight: 800, color: tone, marginTop: 3 }}>
                  {fmtVar(v)}
                </div>
                <div style={{ fontSize: 11, color: "var(--steel-dim)", marginTop: 3 }}>
                  project finish vs baseline
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                  <Chip tone={s.slipped ? "critical" : "neutral"}>{s.slipped} slipped</Chip>
                  {s.ahead > 0 && <Chip tone="ok">{s.ahead} ahead</Chip>}
                  {s.added > 0 && <Chip tone="neutral">{s.added} new</Chip>}
                  {s.removed.length > 0 && <Chip tone="neutral">{s.removed.length} removed</Chip>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--molten)" }}>{error}</div>
      )}
      {loading && (
        <div style={{ padding: "14px", fontSize: 12, color: "var(--steel-dim)" }}>Comparing…</div>
      )}

      {!loading && mode === "chart" && rows.length > 0 && (
        <div style={{ padding: "0 14px 14px" }}>
          <BaselineGantt rows={rows as any} baselines={summaries} dataDate={dataDate}
            title="Current schedule vs baselines" />
        </div>
      )}

      {/* matrix */}
      {!loading && mode === "table" && visible.length > 0 && (
        <div style={{ overflow: "auto", maxHeight: 460 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Code</th>
                <th style={{ ...th, textAlign: "left" }}>Activity</th>
                <th style={{ ...th, textAlign: "right" }}>%</th>
                <th style={{ ...th, textAlign: "right" }}>Current finish</th>
                {summaries.map((s) => (
                  <th key={s.baseline_id} colSpan={2}
                    style={{ ...th, textAlign: "center", borderLeft: "1px solid var(--line)" }}>
                    {s.name}
                  </th>
                ))}
              </tr>
              <tr>
                <th style={th} /><th style={th} /><th style={th} /><th style={th} />
                {summaries.map((s) => (
                  <React.Fragment key={s.baseline_id}>
                    <th style={{ ...th, textAlign: "right", borderLeft: "1px solid var(--line)" }}>Finish</th>
                    <th style={{ ...th, textAlign: "right" }}>Var</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.code} style={{
                  background: r.current_critical ? "var(--molten-soft)" : undefined,
                }}>
                  <td style={{ ...td, ...mono, fontWeight: 600 }}>{r.code}</td>
                  <td style={{ ...td, maxWidth: 260, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>
                    {r.name}
                  </td>
                  <td style={{ ...td, ...mono, textAlign: "right" }}>{Math.round(r.percent_complete)}</td>
                  <td style={{ ...td, ...mono, textAlign: "right" }}>
                    {r.current_finish?.slice(0, 10) ?? "\u2014"}
                  </td>
                  {summaries.map((s) => {
                    const c = r.cells[String(s.baseline_id)];
                    if (!c) return <React.Fragment key={s.baseline_id}>
                      <td style={{ ...td, borderLeft: "1px solid var(--line)" }} /><td style={td} />
                    </React.Fragment>;
                    return (
                      <React.Fragment key={s.baseline_id}>
                        <td style={{ ...td, ...mono, textAlign: "right",
                          borderLeft: "1px solid var(--line)", color: "var(--steel-dim)" }}>
                          {c.status === "added" ? "new" : c.bl_finish?.slice(0, 10) ?? "\u2014"}
                        </td>
                        <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 700,
                          color: STATUS_COLOR[c.status] }}
                          title={c.went_critical ? "Became critical since this baseline" : undefined}>
                          {c.status === "added" ? "\u2014" : fmtVar(c.finish_var_days)}
                          {c.went_critical && <span style={{ marginLeft: 4 }}>\u25c6</span>}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && mode === "table" && rows.length > 0 && visible.length === 0 && (
        <div style={{ padding: 16, fontSize: 12, color: "var(--verdigris)" }}>
          Nothing has slipped against the selected baselines.
        </div>
      )}

      <div style={{ padding: "9px 14px", fontSize: 11, color: "var(--steel-dim)" }}>
        Positive variance = later than baseline. \u25c6 marks an activity that has become
        critical since that baseline was captured.
      </div>
    </Card>
  );
}
