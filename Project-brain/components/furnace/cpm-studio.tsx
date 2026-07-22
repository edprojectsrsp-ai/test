"use client";
// CPM Studio — MS-Project-grade scheduling view on MIT foundations.
// Rendering: gantt-task-react (MIT) — dependency arrows, progress bars, drag,
//   Day/Week/Month zoom. No GPL debt (deliberately NOT dhtmlxGantt free tier).
// Intelligence: lib/furnace/cpmEngine.ts — instant in-browser CPM recompute
//   (drag a bar → critical path re-flows live) + 10 DCMA-style health checks.
// Backend: existing _scheduling_module endpoints for official runs, XER/MSP
//   import, baselines. The rival's Codex-built module is an iframe island that
//   needs a server round-trip for every recalculation; this does it in <1ms.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
const BaselinePanel = dynamic(() => import("@/app/cpm/BaselinePanel"), { ssr: false });
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, PageHeader, Segmented, Select, toast } from "@/ui";
import { downloadCSV, inr } from "@/lib/furnace/gridApi";
import {
  CpmActivity, CpmLink, CpmScheduleFull, CpmScheduleRef,
  runCpm, dcmaLite, getSchedules, getScheduleFull, runBackendCpm, importUrl,
} from "@/lib/furnace/cpmEngine";
import { runDcma14 } from "@/lib/furnace/dcma";
const ScheduleChecker = dynamic(() => import("@/components/furnace/ScheduleChecker"), { ssr: false });
const MultiBaselinePanel = dynamic(() => import("@/components/furnace/MultiBaselinePanel"), { ssr: false });

// Schedule export formats. .mpp is intentionally absent: it is a proprietary
// binary with no reliable writer — export XML and use MS Project's Save As.
const SCHED_API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/scheduling").replace(/\/$/, "");
const EXPORT_FORMATS: { fmt: string; label: string }[] = [
  { fmt: "xer", label: "Primavera P6 (.xer)" },
  { fmt: "xml", label: "MS Project (.xml)" },
  { fmt: "csv", label: "Excel / CSV" },
];

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" };
const th: React.CSSProperties = { padding: "6px 10px", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--steel-dim)", borderBottom: "1px solid var(--line)", background: "var(--panel)", position: "sticky", top: 0, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "5px 10px", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5 };
const num: React.CSSProperties = { ...mono, textAlign: "right", whiteSpace: "nowrap" };

const DAY = 86400000;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * DAY);

export default function CpmStudio() {
  const [refs, setRefs] = useState<CpmScheduleRef[]>([]);
  const [schedId, setSchedId] = useState<number | null>(null);
  const [net, setNet] = useState<CpmScheduleFull | null>(null);
  const [view, setView] = useState<ViewMode>(ViewMode.Week);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showBaselines, setShowBaselines] = useState(false);
  const [showChecker, setShowChecker] = useState(false);
  const [showMultiBl, setShowMultiBl] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => { getSchedules().then((r) => { setRefs(r); setSchedId(r[0]?.schedule_id ?? null); }); }, []);
  useEffect(() => { if (schedId != null) getScheduleFull(schedId).then(setNet); }, [schedId]);

  const result = useMemo(() => (net ? runCpm(net.activities, net.links) : null), [net]);
  const checks = useMemo(() => (net && result ? dcmaLite(net.activities, net.links, result) : []), [net, result]);
  const failing = checks.filter((c) => !c.pass);
  const dcma = useMemo(
    () => (net && result ? runDcma14(net.activities, net.links, result, { dataDate: net.dataDate }) : null),
    [net, result],
  );

  // ---- map CPM network to gantt-task-react tasks ------------------------------
  const tasks: Task[] = useMemo(() => {
    if (!net || !result) return [];
    const start0 = net.dataDate;
    const predsBySucc = new Map<string, string[]>();
    net.links.forEach((l) => predsBySucc.set(l.succ, [...(predsBySucc.get(l.succ) ?? []), l.pred]));
    const list = net.activities
      .filter((a) => !criticalOnly || result.critical.has(a.id))
      .map((a): Task => {
        const critical = result.critical.has(a.id);
        return {
          id: a.id, name: `${a.code} · ${a.name}`, type: "task",
          start: addDays(start0, result.es[a.id] ?? 0),
          end: addDays(start0, result.ef[a.id] ?? a.duration),
          progress: Math.round(a.progress),
          dependencies: (predsBySucc.get(a.id) ?? []).filter((p) => !criticalOnly || result.critical.has(p)),
          styles: critical
            ? { backgroundColor: "#e2502a", backgroundSelectedColor: "#c5380d", progressColor: "#8f2c0e", progressSelectedColor: "#7a250b" }
            : { backgroundColor: "#4d7ea8", backgroundSelectedColor: "#3c6690", progressColor: "#2c4f74", progressSelectedColor: "#25436364" },
        };
      });
    return list;
  }, [net, result, criticalOnly]);

  // Drag a bar → adjust duration/offset and recompute CPM instantly
  const onDateChange = useCallback((task: Task) => {
    if (!net) return;
    const days = Math.max(1, Math.round((task.end.getTime() - task.start.getTime()) / DAY));
    setNet((n) => n && ({ ...n, activities: n.activities.map((a) => (a.id === task.id ? { ...a, duration: days } : a)) }));
    toast(`${task.id} duration → ${days}d · critical path recomputed`);
  }, [net]);

  const onImport = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(importUrl(), { method: "POST", body: fd });
      if (!r.ok) throw new Error(String(r.status));
      toast("Schedule imported — reloading list.");
      getSchedules().then(setRefs);
    } catch { toast("Import needs the live backend (XER/MSP importer)."); }
  };

  const officialRun = async () => {
    if (schedId == null) return;
    const ok = await runBackendCpm(schedId);
    toast(ok ? "Official CPM run stored (backend engine)." : "Backend run unavailable — live engine already current.");
  };

  const exportCsv = () => {
    if (!net || !result) return;
    downloadCSV(`cpm-${schedId}`,
      ["Code", "Activity", "WBS", "Dur (d)", "ES", "EF", "LS", "LF", "TF", "FF", "Critical", "% Complete"],
      net.activities.map((a) => [a.code, a.name, a.wbs ?? "", a.duration,
        result.es[a.id], result.ef[a.id], result.ls[a.id], result.lf[a.id],
        result.tf[a.id], result.ff[a.id], result.critical.has(a.id) ? "YES" : "", a.progress]),
      `CPM — ${net.ref.schedule_name} · data date ${net.dataDate}`);
    toast("CPM table exported (CSV)");
  };

  const critCount = result ? result.critical.size : 0;
  const sel = selected && net ? net.activities.find((a) => a.id === selected) ?? null : null;

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="CPM Studio" subtitle="Live critical path · drag bars to re-flow · DCMA 14-point checker · baselines · XER/MSP import"
        right={<>
          <Field label="Schedule">
            <Select value={String(schedId ?? "")} onChange={(v) => setSchedId(Number(v))}
              options={refs.map((r) => ({ value: String(r.schedule_id), label: r.schedule_name }))} style={{ minWidth: 280 }} />
          </Field>
          <ThemeToggle />
        </>} />

      {/* Command bar */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {net && result ? <>
            <Chip tone="steel" dot>{net.activities.length} activities</Chip>
            <Chip tone="critical" dot>{critCount} critical</Chip>
            <Chip tone="neutral">project {result.projectDuration}d</Chip>
            <Chip tone={dcma && dcma.failed ? "moderate" : "ok"} dot>DCMA {dcma ? `${dcma.passed}/${dcma.passed + dcma.failed} · ${dcma.grade}` : "—"}</Chip>
          </> : null}
          <span style={{ flex: 1 }} />
          <Segmented value={String(view)} onChange={(v) => setView(v as ViewMode)}
            options={[{ value: String(ViewMode.Day), label: "Day" }, { value: String(ViewMode.Week), label: "Week" }, { value: String(ViewMode.Month), label: "Month" }]} />
          <Button onClick={() => setCriticalOnly((c) => !c)} kind={criticalOnly ? "accent" : "default"}>Critical only</Button>
          <label style={{ display: "inline-flex" }}>
            <input type="file" accept=".xer,.xml,.mpp" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} />
            <Button onClick={() => { }} style={{ pointerEvents: "none" }}>Import XER / MSP</Button>
          </label>
          <Button onClick={officialRun}>Official run</Button>
          <Button onClick={() => setShowBaselines((b) => !b)} kind={showBaselines ? "accent" : "default"}>Baselines &amp; Variance</Button>
          <Button onClick={() => setShowChecker((c) => !c)} kind={showChecker ? "accent" : "default"}>Schedule Checker</Button>
          <Button onClick={() => setShowMultiBl((b) => !b)} kind={showMultiBl ? "accent" : "default"}>Compare Baselines</Button>
          <span style={{ position: "relative", display: "inline-block" }}>
            <Button onClick={() => setExportOpen((o) => !o)}>Export \u25be</Button>
            {exportOpen && (
              <span style={{ position: "absolute", right: 0, top: "calc(100% + 5px)", zIndex: 40,
                background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r)",
                boxShadow: "var(--shadow)", minWidth: 200, display: "block", padding: 4 }}>
                {EXPORT_FORMATS.map((f) => (
                  <a key={f.fmt} href={`${SCHED_API}/projects/${schedId}/export?fmt=${f.fmt}`}
                    onClick={() => setExportOpen(false)}
                    style={{ display: "block", padding: "7px 11px", fontSize: 12.5,
                      color: "var(--ink)", textDecoration: "none", borderRadius: 6 }}>
                    {f.label}
                  </a>
                ))}
                <span onClick={() => { exportCsv(); setExportOpen(false); }}
                  style={{ display: "block", padding: "7px 11px", fontSize: 12.5,
                    color: "var(--steel-dim)", cursor: "pointer", borderTop: "1px solid var(--grid-line)" }}>
                  CPM table (client-side CSV)
                </span>
              </span>
            )}
          </span>
          <a href="/cpm" style={{ textDecoration: "none" }}><Button>Advanced / Projects</Button></a>
        </div>
      </Card>

      {/* Gantt */}
      <Card pad={false} style={{ marginTop: 14, overflow: "hidden" }}>
        {tasks.length ? (
          <div style={{ background: "var(--panel)" }} className="fz-gantt">
            <Gantt tasks={tasks} viewMode={view}
              onDateChange={onDateChange}
              onSelect={(t, isSel) => setSelected(isSel ? t.id : null)}
              listCellWidth="230px" columnWidth={view === ViewMode.Day ? 44 : view === ViewMode.Week ? 90 : 160}
              barCornerRadius={3} fontSize="11.5px" rowHeight={36} />
          </div>
        ) : <div style={{ padding: 30, color: "var(--steel-dim)" }}>No schedule loaded.</div>}
      </Card>

      {showBaselines && schedId != null && (
        <Card style={{ marginTop: 14 }}>
          <BaselinePanel scheduleId={schedId} />
        </Card>
      )}

      {showMultiBl && schedId != null && (
        <div style={{ marginTop: 14 }}>
          <MultiBaselinePanel projectId={schedId} />
        </div>
      )}

      {showChecker && net && result && (
        <div style={{ marginTop: 14 }}>
          <ScheduleChecker activities={net.activities} links={net.links} result={result} dataDate={net.dataDate} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 14, alignItems: "start" }}>
        {/* Activity table */}
        <Card pad={false}>
          <div style={{ overflow: "auto", maxHeight: 420 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["Code", "Activity", "Dur", "ES", "EF", "LS", "LF", "TF", "%"].map((c) => <th key={c} style={{ ...th, textAlign: c === "Activity" ? "left" : "right" }}>{c}</th>)}</tr></thead>
              <tbody>
                {net && result ? net.activities.map((a) => {
                  const crit = result.critical.has(a.id);
                  return (
                    <tr key={a.id} onClick={() => setSelected(a.id)}
                      style={{ cursor: "pointer", background: selected === a.id ? "var(--steel-soft)" : crit ? "var(--molten-soft)" : undefined }}>
                      <td style={{ ...td, ...mono, fontWeight: 600 }}>{a.code}</td>
                      <td style={{ ...td, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</td>
                      <td style={{ ...td, ...num }}>{a.duration}</td>
                      <td style={{ ...td, ...num }}>{result.es[a.id]}</td>
                      <td style={{ ...td, ...num }}>{result.ef[a.id]}</td>
                      <td style={{ ...td, ...num }}>{result.ls[a.id]}</td>
                      <td style={{ ...td, ...num }}>{result.lf[a.id]}</td>
                      <td style={{ ...td, ...num, fontWeight: 700, color: result.tf[a.id] < 0 ? "var(--molten)" : result.tf[a.id] === 0 ? "var(--ember)" : "var(--verdigris)" }}>{result.tf[a.id]}</td>
                      <td style={{ ...td, ...num }}>{inr(a.progress, 0)}</td>
                    </tr>
                  );
                }) : null}
              </tbody>
            </table>
          </div>
        </Card>

        {/* DCMA + selection */}
        <div style={{ display: "grid", gap: 14 }}>
          <Card>
            <span style={label}>Schedule health — DCMA live checks</span>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {checks.map((c) => (
                <div key={c.id} title={c.offenders.join(", ")}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "5px 9px", borderRadius: "var(--r)", background: c.pass ? "transparent" : "var(--molten-soft)", border: "1px solid var(--grid-line)" }}>
                  <span>{c.pass ? "✓" : "✗"} {c.name}</span>
                  <span style={{ ...mono, color: c.pass ? "var(--verdigris)" : "var(--molten)" }}>{c.count}{c.total ? `/${c.total}` : ""} <span style={{ color: "var(--steel-dim)" }}>({c.threshold})</span></span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--steel-dim)" }}>Open <strong>Schedule Checker</strong> for the full DCMA 14-point assessment incl. CPLI, BEI and the critical-path test.</div>
          </Card>
          {sel && result ? (
            <Card>
              <span style={label}>Selected — {sel.code}</span>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 5 }}>{sel.name}</div>
              <div style={{ ...mono, fontSize: 12, marginTop: 6, display: "grid", gap: 3 }}>
                <span>ES {result.es[sel.id]} · EF {result.ef[sel.id]} · LS {result.ls[sel.id]} · LF {result.lf[sel.id]}</span>
                <span>TF {result.tf[sel.id]}d · FF {result.ff[sel.id]}d · {result.critical.has(sel.id) ? "ON CRITICAL PATH" : "off critical path"}</span>
              </div>
              <a href={`/ai?ask=${encodeURIComponent(`Activity ${sel.code} (${sel.name}) — why is it ${result.critical.has(sel.id) ? "on" : "near"} the critical path, and what happens to project finish if it slips 30 days?`)}`}
                style={{ ...mono, fontSize: 12, color: "var(--steel)", textDecoration: "none", display: "inline-block", marginTop: 9 }}>Ask Brain →</a>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
