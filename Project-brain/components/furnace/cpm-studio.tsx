"use client";
// CPM Studio — MS-Project-grade scheduling view on MIT foundations.
// Rendering: gantt-task-react (MIT) — dependency arrows, progress bars, drag,
//   Day/Week/Month zoom. No GPL debt (deliberately NOT dhtmlxGantt free tier).
// Intelligence: lib/furnace/cpmEngine.ts — instant in-browser CPM recompute
//   (drag a bar → critical path re-flows live) + 10 DCMA-style health checks.
// Backend: existing _scheduling_module endpoints for official runs, XER/MSP
//   import, baselines. The rival's Codex-built module is an iframe island that
//   needs a server round-trip for every recalculation; this does it in <1ms.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { WorkCalendar, calendarFromSchedule } from "@/lib/furnace/workCalendar";
import { History, historyShortcut } from "@/lib/furnace/history";
import type { Assignment, Resource } from "@/lib/furnace/resources";
const ResourceHistogramPanel = dynamic(() => import("@/components/furnace/ResourceHistogram"), { ssr: false });
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
// Units are working days, so unit -> date must go through the calendar.
// Plain day addition drew every bar straight through weekends and holidays,
// which on a five-day calendar showed a 100-unit activity finishing two months
// earlier than the backend's official run.
const unitDate = (cal: WorkCalendar, unit: number) => cal.dateForUnit(unit);

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
  const [showResources, setShowResources] = useState(false);
  const [, forceHistoryRender] = useState(0);

  // Snapshot history over the schedule. Bar drags fire continuously, so edits
  // to the same activity coalesce into a single undo step via mergeKey.
  const historyRef = useRef<History<CpmScheduleFull> | null>(null);
  if (historyRef.current === null) historyRef.current = new History<CpmScheduleFull>();
  const history = historyRef.current;

  const commit = useCallback((next: CpmScheduleFull, label: string, mergeKey?: string) => {
    history.push(next, label, mergeKey);
    setNet(next);
    forceHistoryRender((n) => n + 1);
  }, [history]);

  const doUndo = useCallback(() => {
    const prev = history.undo();
    if (prev) { setNet(prev); forceHistoryRender((n) => n + 1); toast("Undo"); }
  }, [history]);

  const doRedo = useCallback(() => {
    const next = history.redo();
    if (next) { setNet(next); forceHistoryRender((n) => n + 1); toast("Redo"); }
  }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = historyShortcut(e as any);
      if (!action) return;
      e.preventDefault();
      action === "undo" ? doUndo() : doRedo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);
  const [groupByWbs, setGroupByWbs] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => { getSchedules().then((r) => { setRefs(r); setSchedId(r[0]?.schedule_id ?? null); }); }, []);
  useEffect(() => {
    if (schedId == null) return;
    getScheduleFull(schedId).then((full) => {
      setNet(full);
      // a freshly loaded schedule is the new origin: undoing into a previous
      // schedule's edits would apply them to the wrong network
      history.reset(full, "Loaded");
      forceHistoryRender((n) => n + 1);
    });
  }, [schedId, history]);

  const calendar = useMemo(() => {
    const cal = calendarFromSchedule(net as any);
    if (net?.dataDate) cal.setAnchor(net.dataDate);
    return cal;
  }, [net]);

  const result = useMemo(
    () => (net ? runCpm(net.activities, net.links,
      { dataDate: net.dataDate, calendar }) : null),
    [net, calendar]);
  const checks = useMemo(() => (net && result ? dcmaLite(net.activities, net.links, result) : []), [net, result]);
  const failing = checks.filter((c) => !c.pass);
  const dcma = useMemo(
    () => (net && result ? runDcma14(net.activities, net.links, result, { dataDate: net.dataDate }) : null),
    [net, result],
  );

  // ---- map CPM network to gantt-task-react tasks ------------------------------
  const tasks: Task[] = useMemo(() => {
    if (!net || !result) return [];
    const predsBySucc = new Map<string, string[]>();
    net.links.forEach((l) => predsBySucc.set(l.succ, [...(predsBySucc.get(l.succ) ?? []), l.pred]));

    const leaves = net.activities
      .filter((a) => !criticalOnly || result.critical.has(a.id))
      .map((a): Task => {
        const critical = result.critical.has(a.id);
        return {
          id: a.id, name: `${a.code} · ${a.name}`, type: "task",
          start: unitDate(calendar, result.es[a.id] ?? 0),
          // exclusive-end: the day after the last worked day, so a Friday
          // finish stops at Saturday instead of running through to Monday
          end: calendar.barEndForUnit(result.ef[a.id] ?? a.duration),
          progress: Math.round(a.progress),
          project: groupByWbs && a.wbs ? `wbs:${a.wbs}` : undefined,
          dependencies: (predsBySucc.get(a.id) ?? []).filter((p) => !criticalOnly || result.critical.has(p)),
          styles: critical
            ? { backgroundColor: "#e2502a", backgroundSelectedColor: "#c5380d", progressColor: "#8f2c0e", progressSelectedColor: "#7a250b" }
            : { backgroundColor: "#4d7ea8", backgroundSelectedColor: "#3c6690", progressColor: "#2c4f74", progressSelectedColor: "#254363" },
        };
      });

    if (!groupByWbs) return leaves;

    // MS-Project-style outline: one summary bar per WBS spanning its children,
    // rolled-up % complete weighted by duration so the summary means something.
    const byWbs = new Map<string, CpmActivity[]>();
    net.activities.forEach((a) => {
      if (!a.wbs) return;
      byWbs.set(a.wbs, [...(byWbs.get(a.wbs) ?? []), a]);
    });

    const out: Task[] = [];
    [...byWbs.keys()].sort().forEach((wbs) => {
      const kids = byWbs.get(wbs)!;
      const visibleKids = leaves.filter((t) => t.project === `wbs:${wbs}`);
      if (!visibleKids.length) return;
      const es = Math.min(...kids.map((k) => result.es[k.id] ?? 0));
      const ef = Math.max(...kids.map((k) => result.ef[k.id] ?? 0));
      const totalDur = kids.reduce((n, k) => n + (k.duration || 0), 0) || 1;
      const earned = kids.reduce((n, k) => n + (k.duration || 0) * (k.progress || 0), 0);
      const anyCritical = kids.some((k) => result.critical.has(k.id));
      out.push({
        id: `wbs:${wbs}`, name: wbs, type: "project",
        start: unitDate(calendar, es), end: calendar.barEndForUnit(ef),
        progress: Math.round(earned / totalDur),
        hideChildren: collapsed.has(wbs),
        styles: anyCritical
          ? { backgroundColor: "#8f2c0e", backgroundSelectedColor: "#7a250b", progressColor: "#5c1c07", progressSelectedColor: "#4a1605" }
          : { backgroundColor: "#2c4f74", backgroundSelectedColor: "#254363", progressColor: "#1b3b57", progressSelectedColor: "#16304f" },
      });
      if (!collapsed.has(wbs)) out.push(...visibleKids);
    });
    // activities with no WBS still need to appear
    out.push(...leaves.filter((t) => !t.project));
    return out;
  }, [net, result, criticalOnly, groupByWbs, collapsed, calendar]);

  const onExpanderClick = useCallback((task: Task) => {
    if (!task.id.startsWith("wbs:")) return;
    const key = task.id.slice(4);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // Drag a bar → adjust duration/offset and recompute CPM instantly
  const onDateChange = useCallback((task: Task) => {
    if (!net || task.id.startsWith("wbs:")) return;   // summary bars are derived
    // Bars span working days, so the new duration is the working-day count
    // between the ends — not the calendar-day difference, which would read a
    // 5-day bar dragged across a weekend as 7 days.
    const lastWorked = new Date(task.end.getTime() - DAY);
    const days = Math.max(1, calendar.workingDaysBetween(task.start, lastWorked));
    const next: CpmScheduleFull = {
      ...net,
      activities: net.activities.map((a) =>
        (a.id === task.id ? { ...a, duration: days } : a)),
    };
    commit(next, `${task.id} duration → ${days}d`, `drag:${task.id}`);
    toast(`${task.id} duration → ${days}d · critical path recomputed`);
  }, [net, calendar, commit]);

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
            <Chip tone="neutral">{calendar.name}</Chip>
          <Chip tone={dcma && dcma.failed ? "moderate" : "ok"} dot>DCMA {dcma ? `${dcma.passed}/${dcma.passed + dcma.failed} · ${dcma.grade}` : "—"}</Chip>
          </> : null}
          <span style={{ flex: 1 }} />
          <Segmented value={String(view)} onChange={(v) => setView(v as ViewMode)}
            options={[{ value: String(ViewMode.Day), label: "Day" }, { value: String(ViewMode.Week), label: "Week" }, { value: String(ViewMode.Month), label: "Month" }]} />
          <Button onClick={doUndo} disabled={!history.canUndo}
            title={history.canUndo ? `Undo ${history.undoLabel ?? ""}` : "Nothing to undo"}>
            ↶ Undo
          </Button>
          <Button onClick={doRedo} disabled={!history.canRedo}
            title={history.canRedo ? `Redo ${history.redoLabel ?? ""}` : "Nothing to redo"}>
            ↷ Redo
          </Button>
          <Button onClick={() => setCriticalOnly((c) => !c)} kind={criticalOnly ? "accent" : "default"}>Critical only</Button>
          <Button onClick={() => setShowResources((v) => !v)} kind={showResources ? "accent" : "default"}>Resources</Button>
          <Button onClick={() => setGroupByWbs((g) => !g)} kind={groupByWbs ? "accent" : "default"}>WBS outline</Button>
          {groupByWbs && (
            <Button onClick={() => setCollapsed((c) => (c.size ? new Set() : new Set(
              net ? net.activities.map((a) => a.wbs).filter(Boolean) as string[] : [])))}>
              {collapsed.size ? "Expand all" : "Collapse all"}
            </Button>
          )}
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
              onSelect={(t, isSel) => setSelected(isSel && !t.id.startsWith("wbs:") ? t.id : null)}
              onExpanderClick={onExpanderClick}
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

      {showResources && net && result && (
        <div style={{ marginTop: 14 }}>
          <ResourceHistogramPanel
            activities={net.activities} links={net.links} result={result}
            resources={((net as any).resources ?? []) as Resource[]}
            assignments={((net as any).assignments ?? []) as Assignment[]}
            calendar={calendar} />
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
