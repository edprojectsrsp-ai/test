"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GanttChartSquare, Calendar, AlertTriangle, CheckCircle2, Clock,
  Upload, Save, Play, Pause, Activity, TrendingUp, TrendingDown,
  Layers, Eye, Edit3, X, ArrowRight, GitBranch, Zap, Target,
  Filter, RefreshCw, FileUp, Plus, ChevronRight, Info
} from "lucide-react";

const API = "http://localhost:8002";
const USER_ID = 1;

// ===========================================================================
// TYPES
// ===========================================================================
type DateView = "planned" | "baseline" | "estimated" | "actual" | "forecast" | "early" | "late" | "all";

type Activity = {
  activity_id: number; activity_code: string; activity_name: string;
  activity_type: string; activity_status: string; wbs_code: string;
  // 7 date dimensions
  planned_start_date: string; planned_finish_date: string;
  baseline_start_date: string; baseline_finish_date: string;
  estimated_start_date: string; estimated_finish_date: string;
  actual_start_date: string; actual_finish_date: string;
  early_start_date: string; early_finish_date: string;
  late_start_date: string; late_finish_date: string;
  forecast_start_date: string; forecast_finish_date: string;
  // Durations
  planned_duration_days: number; baseline_duration_days: number;
  estimated_duration_days: number; actual_duration_days: number;
  // CPM
  total_float_days: number; free_float_days: number;
  is_critical: boolean; is_near_critical: boolean;
  // Progress
  physical_pct_complete: number;
  delay_vs_baseline_days: number; start_delay_vs_baseline_days: number;
  forecast_slip_days: number;
};

type Schedule = {
  schedule_id: number; schedule_name: string; status: string;
  project_start_date: string; project_finish_date: string; data_date: string;
  total_activities: number; completed_activities: number;
  critical_path_length_days: number;
  is_current_baseline: boolean; schedule_pct_complete: number;
  package_name: string; scheme_name: string;
};

// Date view config â€” each dimension picks its own colour and bar style
const DATE_VIEWS: Record<DateView, { label: string; color: string; bg: string; getDates: (a: Activity) => [string?, string?] }> = {
  planned:    { label: "Planned",     color: "border-cyan-500",       bg: "bg-cyan-500/40",     getDates: (a) => [a.planned_start_date, a.planned_finish_date] },
  baseline:   { label: "Baseline",    color: "border-sky-400",        bg: "bg-sky-400/30",      getDates: (a) => [a.baseline_start_date, a.baseline_finish_date] },
  estimated:  { label: "Estimated",   color: "border-violet-400",     bg: "bg-violet-400/40",   getDates: (a) => [a.estimated_start_date, a.estimated_finish_date] },
  actual:     { label: "Actual",      color: "border-emerald-400",    bg: "bg-emerald-400/50",  getDates: (a) => [a.actual_start_date, a.actual_finish_date] },
  forecast:   { label: "Forecast",    color: "border-amber-400",      bg: "bg-amber-400/40",    getDates: (a) => [a.forecast_start_date, a.forecast_finish_date] },
  early:      { label: "Early (CPM)", color: "border-fuchsia-400",    bg: "bg-fuchsia-400/40",  getDates: (a) => [a.early_start_date, a.early_finish_date] },
  late:       { label: "Late (CPM)",  color: "border-rose-400",       bg: "bg-rose-400/30",     getDates: (a) => [a.late_start_date, a.late_finish_date] },
  all:        { label: "All overlay", color: "border-zinc-400",       bg: "bg-zinc-500/20",     getDates: (a) => [a.planned_start_date, a.planned_finish_date] },
};

const STATUS_BG: Record<string, string> = {
  not_started: "text-zinc-400 border-zinc-700",
  in_progress: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  completed:   "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  on_hold:     "text-orange-300 border-orange-500/40 bg-orange-500/10",
  cancelled:   "text-red-300 border-red-500/40 bg-red-500/10",
};

// ===========================================================================
// MAIN PAGE
// ===========================================================================
export default function CPMPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [dateView, setDateView] = useState<DateView>("planned");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [showDelays, setShowDelays] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load schedule list
  useEffect(() => {
    fetch(`${API}/api/v1/cpm/schedule`).then(r => r.json()).then(d => {
      setSchedules(d.schedules || []);
      if (d.schedules?.length && !scheduleId) setScheduleId(d.schedules[0].schedule_id);
    });
  }, []);

  // Load schedule detail
  useEffect(() => {
    if (!scheduleId) return;
    setLoading(true);
    fetch(`${API}/api/v1/cpm/schedule/${scheduleId}`).then(r => r.json()).then(d => {
      setSchedule(d.schedule);
      setActivities(d.activities || []);
      setDependencies(d.dependencies || []);
      setLoading(false);
    });
  }, [scheduleId]);

  const refresh = async () => {
    if (!scheduleId) return;
    const d = await fetch(`${API}/api/v1/cpm/schedule/${scheduleId}`).then(r => r.json());
    setSchedule(d.schedule);
    setActivities(d.activities || []);
  };

  const runCPM = async () => {
    if (!scheduleId) return;
    setLoading(true);
    await fetch(`${API}/api/v1/cpm/run/${scheduleId}`, { method: "POST" });
    await refresh();
    setLoading(false);
  };

  const saveBaseline = async () => {
    if (!scheduleId || !confirm("Freeze current planned dates as baseline?")) return;
    await fetch(`${API}/api/v1/cpm/baseline/save/${scheduleId}?user_id=${USER_ID}`, { method: "POST" });
    await refresh();
  };

  // Visible activities
  const visibleActivities = useMemo(() => {
    let acts = activities;
    if (criticalOnly) acts = acts.filter(a => a.is_critical);
    return acts;
  }, [activities, criticalOnly]);

  // Time range for Gantt (across ALL dimensions to keep stable)
  const timeRange = useMemo(() => {
    const dates: number[] = [];
    activities.forEach(a => {
      ["planned_start_date","planned_finish_date","baseline_start_date","baseline_finish_date",
       "actual_start_date","actual_finish_date","early_start_date","early_finish_date",
       "late_start_date","late_finish_date","forecast_start_date","forecast_finish_date"].forEach(k => {
        const v = (a as any)[k];
        if (v) dates.push(new Date(v).getTime());
      });
    });
    if (!dates.length) return null;
    const min = Math.min(...dates), max = Math.max(...dates);
    return { min, max, days: Math.ceil((max - min) / 86400000) || 1 };
  }, [activities]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* HEADER STRIP */}
      <div className="border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/60 to-zinc-950 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-cyan-500/20 border border-fuchsia-500/30 flex items-center justify-center">
                <GanttChartSquare className="w-5 h-5 text-fuchsia-300" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">CPM Schedule Engine</h1>
                <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                  <span className="px-2 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">SPRINT 9B</span>
                  <span>Â·</span><span>CRITICAL PATH METHOD Â· 7-DIMENSION DATES Â· XER/MPP/CSV</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg text-sm">
                <FileUp className="w-4 h-4" />Import .xer / .mpp / .csv
              </button>
              <button onClick={runCPM} disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 rounded-lg text-sm text-fuchsia-200">
                <Play className={`w-4 h-4 ${loading ? "animate-pulse" : ""}`} />Run CPM
              </button>
              <button onClick={saveBaseline}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg text-sm">
                <Save className="w-4 h-4" />Save Baseline
              </button>
              <button onClick={() => setShowDelays(!showDelays)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${showDelays
                  ? "bg-red-500/20 border-red-500/30 text-red-200"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 hover:border-zinc-700"}`}>
                <AlertTriangle className="w-4 h-4" />Delay Analysis
              </button>
            </div>
          </div>

          {/* Schedule selector + summary */}
          <div className="flex items-center gap-3 flex-wrap">
            <select value={scheduleId || ""} onChange={e => setScheduleId(Number(e.target.value))}
              className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm min-w-[300px]">
              {schedules.map(s =>
                <option key={s.schedule_id} value={s.schedule_id}>
                  {s.scheme_name} / {s.package_name} â€” {s.schedule_name}
                </option>
              )}
              {!schedules.length && <option>No schedules â€” import one</option>}
            </select>

            {schedule && (
              <div className="flex items-center gap-4 text-xs">
                <Stat label="Duration" value={schedule.critical_path_length_days != null ? `${schedule.critical_path_length_days}d` : "â€”"} />
                <Stat label="Activities" value={`${schedule.total_activities || 0}`} />
                <Stat label="Critical" value={`${activities.filter(a => a.is_critical).length}`} accent="fuchsia" />
                <Stat label="Complete" value={`${Math.round(schedule.schedule_pct_complete || 0)}%`} accent="emerald" />
                {schedule.is_current_baseline && (
                  <span className="px-2 py-1 rounded bg-sky-500/10 border border-sky-500/30 text-sky-300 font-mono text-[10px]">
                    BASELINED
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DATE-VIEW SELECTOR */}
        <div className="max-w-[1800px] mx-auto px-6 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500 uppercase tracking-wider mr-2 font-mono">Date View:</span>
            {(Object.keys(DATE_VIEWS) as DateView[]).map(v => {
              const cfg = DATE_VIEWS[v];
              return (
                <button key={v} onClick={() => setDateView(v)}
                  className={`px-3 py-1 rounded-md text-xs font-mono border transition ${
                    dateView === v
                      ? `${cfg.color} bg-zinc-900 text-zinc-100`
                      : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                  }`}>
                  <span className={`inline-block w-2 h-2 rounded-sm mr-1.5 ${cfg.bg}`}></span>
                  {cfg.label}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)}
                  className="rounded accent-fuchsia-500" />
                Critical path only
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-[1800px] mx-auto p-6">
        {!scheduleId && (
          <div className="text-center py-24 text-zinc-500">
            <Calendar className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No schedule loaded. Import a .xer, .mpp or .csv file to begin.</p>
          </div>
        )}

        {scheduleId && !loading && activities.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <p>Schedule is empty. Add activities or import a file.</p>
          </div>
        )}

        {scheduleId && activities.length > 0 && timeRange && (
          <GanttChart
            activities={visibleActivities}
            allActivities={activities}
            dependencies={dependencies}
            dateView={dateView}
            timeRange={timeRange}
            onEdit={setEditingActivity}
          />
        )}

        {showDelays && scheduleId && (
          <DelayAnalysisPanel scheduleId={scheduleId} onClose={() => setShowDelays(false)} />
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editingActivity && (
          <EditActivityModal
            activity={editingActivity}
            onClose={() => setEditingActivity(null)}
            onSaved={async () => { setEditingActivity(null); await refresh(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <ImportModal onClose={() => setShowImport(false)}
            onImported={async (sid) => {
              setShowImport(false);
              const all = await fetch(`${API}/api/v1/cpm/schedule`).then(r => r.json());
              setSchedules(all.schedules || []);
              setScheduleId(sid);
            }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ===========================================================================
// STAT PILL
// ===========================================================================
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const color = accent === "fuchsia" ? "text-fuchsia-300" :
                accent === "emerald" ? "text-emerald-300" : "text-zinc-200";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-zinc-500 font-mono uppercase tracking-wider">{label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}

// ===========================================================================
// GANTT CHART
// ===========================================================================
function GanttChart({ activities, allActivities, dependencies, dateView, timeRange, onEdit }: any) {
  const pixelsPerDay = 8;
  const headerHeight = 60;
  const rowHeight = 36;
  const labelWidth = 320;

  const tDate = (d: string) => d ? (new Date(d).getTime() - timeRange.min) / 86400000 : null;

  // Build a date axis (weeks + months)
  const axisMarkers = useMemo(() => {
    const markers: { x: number; label: string; isMonth: boolean }[] = [];
    const start = new Date(timeRange.min);
    const days = timeRange.days;
    for (let i = 0; i <= days; i += 7) {
      const d = new Date(start.getTime() + i * 86400000);
      const isMonthStart = d.getDate() <= 7;
      markers.push({
        x: i * pixelsPerDay,
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        isMonth: isMonthStart,
      });
    }
    return markers;
  }, [timeRange]);

  // For "all" overlay, render multiple bars per row
  const dimensionsToRender: DateView[] = dateView === "all"
    ? ["planned", "baseline", "actual", "forecast"]
    : [dateView];

  const totalWidth = timeRange.days * pixelsPerDay + 40;

  return (
    <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex">
        {/* LEFT: Activity labels (sticky) */}
        <div className="border-r border-zinc-800 bg-zinc-950/50" style={{ width: labelWidth, flexShrink: 0 }}>
          <div className="border-b border-zinc-800 bg-zinc-900/50" style={{ height: headerHeight }}>
            <div className="p-3 text-xs font-mono uppercase tracking-wider text-zinc-500">
              Activity ({activities.length})
            </div>
          </div>
          {activities.map((a: Activity) => (
            <div key={a.activity_id}
              onClick={() => onEdit(a)}
              className={`px-3 py-2 border-b border-zinc-800/60 cursor-pointer hover:bg-zinc-800/40 transition flex items-center gap-2 ${
                a.is_critical ? "border-l-2 border-l-fuchsia-500" : ""
              }`}
              style={{ height: rowHeight }}>
              <span className="font-mono text-xs text-zinc-500 w-12 truncate">{a.activity_code}</span>
              <span className="text-sm text-zinc-200 truncate flex-1">{a.activity_name}</span>
              {a.is_critical && (
                <Zap className="w-3 h-3 text-fuchsia-400 flex-shrink-0" />
              )}
              {a.physical_pct_complete > 0 && (
                <span className="text-[10px] font-mono text-zinc-500">{Math.round(a.physical_pct_complete)}%</span>
              )}
            </div>
          ))}
        </div>

        {/* RIGHT: Gantt timeline */}
        <div className="flex-1 overflow-x-auto">
          <div style={{ width: totalWidth, position: "relative" }}>
            {/* Time axis header */}
            <div className="sticky top-0 bg-zinc-900/80 border-b border-zinc-800 backdrop-blur-sm z-10"
                 style={{ height: headerHeight }}>
              {axisMarkers.map((m, i) => (
                <div key={i} className="absolute top-0 h-full"
                     style={{ left: m.x }}>
                  <div className={`absolute top-0 h-full border-l ${m.isMonth ? "border-zinc-600" : "border-zinc-800"}`}></div>
                  <div className={`absolute top-2 left-1 text-[10px] font-mono ${m.isMonth ? "text-zinc-300" : "text-zinc-600"}`}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Rows */}
            <div className="relative">
              {/* Vertical grid lines */}
              {axisMarkers.map((m, i) => (
                <div key={i} className={`absolute top-0 bottom-0 border-l ${m.isMonth ? "border-zinc-800" : "border-zinc-900"}`}
                     style={{ left: m.x }}></div>
              ))}

              {/* Activity bars */}
              {activities.map((a: Activity, rowIdx: number) => {
                return (
                  <div key={a.activity_id}
                       className="relative border-b border-zinc-800/60"
                       style={{ height: rowHeight }}>
                    {dimensionsToRender.map((dim, dimIdx) => {
                      const [s, f] = DATE_VIEWS[dim].getDates(a);
                      const sx = tDate(s as string);
                      const fx = tDate(f as string);
                      if (sx == null || fx == null) return null;
                      const left = sx * pixelsPerDay;
                      const width = Math.max((fx - sx) * pixelsPerDay, 4);
                      const cfg = DATE_VIEWS[dim];
                      const barHeight = dateView === "all" ? 6 : 20;
                      const topOffset = dateView === "all"
                        ? 4 + dimIdx * 7
                        : (rowHeight - barHeight) / 2;

                      // Critical path gets extra glow
                      const isCriticalAndCPM = a.is_critical && (dim === "early" || dim === "late" || dim === "planned");

                      // Float bar - show trailing slack for non-critical activities
                      const showFloat = dim === "early" && !a.is_critical && a.total_float_days > 0;

                      return (
                        <div key={dim}>
                          {/* Float (slack) bar */}
                          {showFloat && (
                            <div
                              className="absolute rounded-sm bg-zinc-700/30 border-l border-zinc-600"
                              style={{
                                left: left + width,
                                width: a.total_float_days * pixelsPerDay,
                                top: topOffset,
                                height: barHeight,
                              }}
                              title={`Float: ${a.total_float_days}d`}
                            />
                          )}

                          {/* The bar itself */}
                          <motion.div
                            initial={{ opacity: 0, scaleX: 0 }}
                            animate={{ opacity: 1, scaleX: 1 }}
                            transition={{ duration: 0.4, delay: rowIdx * 0.01 }}
                            className={`absolute rounded ${cfg.bg} border ${cfg.color} ${
                              isCriticalAndCPM ? "shadow-[0_0_8px_rgba(244,114,182,0.4)]" : ""
                            } ${a.is_critical ? "border-fuchsia-500" : ""}`}
                            style={{
                              left, width, top: topOffset, height: barHeight,
                              transformOrigin: "left",
                            }}
                            title={`${a.activity_code} Â· ${DATE_VIEWS[dim].label}: ${s} â†’ ${f}`}
                          >
                            {/* Progress fill */}
                            {a.physical_pct_complete > 0 && dim === "actual" && (
                              <div className="absolute inset-y-0 left-0 bg-emerald-300/40 rounded"
                                   style={{ width: `${a.physical_pct_complete}%` }}></div>
                            )}
                            {dateView !== "all" && width > 60 && (
                              <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-zinc-100 truncate">
                                {a.activity_code} Â· {Math.round((fx-sx))}d
                              </span>
                            )}
                          </motion.div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// EDIT ACTIVITY MODAL
// ===========================================================================
function EditActivityModal({ activity, onClose, onSaved }: any) {
  const [form, setForm] = useState<any>({ ...activity });
  const [saving, setSaving] = useState(false);

  const field = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const body: any = {};
    // Only send changed/non-null fields
    ["activity_name","activity_type","activity_status","planned_start_date","planned_finish_date",
     "baseline_start_date","baseline_finish_date","estimated_start_date","estimated_finish_date",
     "actual_start_date","actual_finish_date","forecast_start_date","forecast_finish_date",
     "planned_duration_days","estimated_duration_days","remaining_duration_days",
     "actual_duration_days","physical_pct_complete","constraint_type","constraint_date",
     "notes","cost_actual_cr"].forEach(k => {
      if (form[k] != null && form[k] !== "") body[k] = form[k];
    });

    await fetch(`${API}/api/v1/cpm/activity/${activity.activity_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-5 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-zinc-500">{activity.activity_code}</span>
              {activity.is_critical && (
                <span className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 text-[10px] font-mono">
                  CRITICAL PATH
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold">{activity.activity_name}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Name" colspan={2}>
            <input value={form.activity_name || ""} onChange={e => field("activity_name", e.target.value)} className={inp} />
          </Field>

          <Field label="Status">
            <select value={form.activity_status || ""} onChange={e => field("activity_status", e.target.value)} className={inp}>
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>

          <Field label="Physical % Complete">
            <input type="number" min="0" max="100" value={form.physical_pct_complete ?? 0}
              onChange={e => field("physical_pct_complete", parseFloat(e.target.value))} className={inp} />
          </Field>

          <DivHeader>Planned (Original)</DivHeader>
          <Field label="Planned Start">
            <input type="date" value={form.planned_start_date?.slice(0,10) || ""}
              onChange={e => field("planned_start_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Planned Finish">
            <input type="date" value={form.planned_finish_date?.slice(0,10) || ""}
              onChange={e => field("planned_finish_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Planned Duration (days)">
            <input type="number" step="0.1" value={form.planned_duration_days ?? ""}
              onChange={e => field("planned_duration_days", parseFloat(e.target.value))} className={inp} />
          </Field>

          <DivHeader>Baseline (Frozen)</DivHeader>
          <Field label="Baseline Start">
            <input type="date" value={form.baseline_start_date?.slice(0,10) || ""}
              onChange={e => field("baseline_start_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Baseline Finish">
            <input type="date" value={form.baseline_finish_date?.slice(0,10) || ""}
              onChange={e => field("baseline_finish_date", e.target.value)} className={inp} />
          </Field>

          <DivHeader>Estimated (Current re-projection)</DivHeader>
          <Field label="Estimated Start">
            <input type="date" value={form.estimated_start_date?.slice(0,10) || ""}
              onChange={e => field("estimated_start_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Estimated Finish">
            <input type="date" value={form.estimated_finish_date?.slice(0,10) || ""}
              onChange={e => field("estimated_finish_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Estimated Duration">
            <input type="number" step="0.1" value={form.estimated_duration_days ?? ""}
              onChange={e => field("estimated_duration_days", parseFloat(e.target.value))} className={inp} />
          </Field>
          <Field label="Remaining Duration">
            <input type="number" step="0.1" value={form.remaining_duration_days ?? ""}
              onChange={e => field("remaining_duration_days", parseFloat(e.target.value))} className={inp} />
          </Field>

          <DivHeader>Actual (What really happened)</DivHeader>
          <Field label="Actual Start">
            <input type="date" value={form.actual_start_date?.slice(0,10) || ""}
              onChange={e => field("actual_start_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Actual Finish">
            <input type="date" value={form.actual_finish_date?.slice(0,10) || ""}
              onChange={e => field("actual_finish_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Actual Duration">
            <input type="number" step="0.1" value={form.actual_duration_days ?? ""}
              onChange={e => field("actual_duration_days", parseFloat(e.target.value))} className={inp} />
          </Field>

          <DivHeader>Forecast (Projected from actuals)</DivHeader>
          <Field label="Forecast Start">
            <input type="date" value={form.forecast_start_date?.slice(0,10) || ""}
              onChange={e => field("forecast_start_date", e.target.value)} className={inp} />
          </Field>
          <Field label="Forecast Finish">
            <input type="date" value={form.forecast_finish_date?.slice(0,10) || ""}
              onChange={e => field("forecast_finish_date", e.target.value)} className={inp} />
          </Field>

          <DivHeader>Constraint</DivHeader>
          <Field label="Constraint Type">
            <select value={form.constraint_type || "none"} onChange={e => field("constraint_type", e.target.value)} className={inp}>
              <option value="none">None</option>
              <option value="start_no_earlier_than">Start No Earlier Than</option>
              <option value="start_no_later_than">Start No Later Than</option>
              <option value="finish_no_earlier_than">Finish No Earlier Than</option>
              <option value="finish_no_later_than">Finish No Later Than</option>
              <option value="must_start_on">Must Start On</option>
              <option value="must_finish_on">Must Finish On</option>
              <option value="as_late_as_possible">As Late As Possible</option>
            </select>
          </Field>
          <Field label="Constraint Date">
            <input type="date" value={form.constraint_date?.slice(0,10) || ""}
              onChange={e => field("constraint_date", e.target.value)} className={inp} />
          </Field>

          <DivHeader>CPM Calculated (read-only)</DivHeader>
          <ReadOnlyRow label="Early Start" value={activity.early_start_date} />
          <ReadOnlyRow label="Early Finish" value={activity.early_finish_date} />
          <ReadOnlyRow label="Late Start" value={activity.late_start_date} />
          <ReadOnlyRow label="Late Finish" value={activity.late_finish_date} />
          <ReadOnlyRow label="Total Float" value={activity.total_float_days != null ? `${activity.total_float_days} days` : ""} />
          <ReadOnlyRow label="Free Float" value={activity.free_float_days != null ? `${activity.free_float_days} days` : ""} />

          <Field label="Notes" colspan={2}>
            <textarea value={form.notes || ""} onChange={e => field("notes", e.target.value)}
              rows={3} className={inp + " resize-none"} />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-zinc-900 border-t border-zinc-800 p-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 text-fuchsia-200 rounded-lg text-sm font-medium">
            {saving ? "Saving + Running CPM..." : "Save (Triggers CPM Rerun)"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const inp = "w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-sm";

function Field({ label, children, colspan = 1 }: any) {
  return (
    <div className={colspan === 2 ? "col-span-2" : ""}>
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">{label}</label>
      {children}
    </div>
  );
}

function DivHeader({ children }: any) {
  return (
    <div className="col-span-2 pt-2 pb-1 border-b border-zinc-800/60 text-xs uppercase tracking-wider text-fuchsia-300 font-mono">
      {children}
    </div>
  );
}

function ReadOnlyRow({ label, value }: any) {
  return (
    <Field label={label}>
      <div className="px-3 py-1.5 bg-zinc-950/50 border border-zinc-800/50 rounded text-sm text-zinc-400 font-mono">
        {value || "â€”"}
      </div>
    </Field>
  );
}

// ===========================================================================
// IMPORT MODAL
// ===========================================================================
function ImportModal({ onClose, onImported }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [packageId, setPackageId] = useState("");
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const upload = async () => {
    if (!file || !packageId || !name) { alert("All fields required"); return; }
    setImporting(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("package_id", packageId);
    fd.append("schedule_name", name);
    fd.append("user_id", String(USER_ID));
    const r = await fetch(`${API}/api/v1/cpm/schedule/import`, { method: "POST", body: fd });
    const d = await r.json();
    setResult(d);
    setImporting(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileUp className="w-5 h-5 text-fuchsia-400" />
            Import Schedule
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!result ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5 font-mono">Schedule File</label>
              <input type="file" accept=".xer,.mpp,.csv,.xml" onChange={e => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-fuchsia-500/20 file:text-fuchsia-200" />
              <p className="text-xs text-zinc-500 mt-1">Accepts .xer (Primavera P6), .mpp (MS Project), .csv, .xml</p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5 font-mono">Package ID</label>
              <input type="number" value={packageId} onChange={e => setPackageId(e.target.value)}
                placeholder="e.g. 75" className={inp} />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5 font-mono">Schedule Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. COB-7 Phase 1 Schedule" className={inp} />
            </div>

            <button onClick={upload} disabled={importing || !file}
              className="w-full mt-2 py-2.5 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 text-fuchsia-200 rounded-lg font-medium">
              {importing ? "Importing + Running CPM..." : "Import & Run CPM"}
            </button>
          </div>
        ) : (
          <div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 mb-3">
              <div className="flex items-center gap-2 text-emerald-300 font-medium mb-2">
                <CheckCircle2 className="w-5 h-5" />
                Import successful
              </div>
              <div className="text-sm text-zinc-300 space-y-1">
                <div>Schedule ID: <span className="font-mono">{result.schedule_id}</span></div>
                <div>Activities: <span className="font-mono">{result.activities_inserted}</span></div>
                <div>Dependencies: <span className="font-mono">{result.dependencies_inserted}</span></div>
                {result.cpm && (
                  <>
                    <div>Project Duration: <span className="font-mono">{result.cpm.project_duration_days} days</span></div>
                    <div>Critical Activities: <span className="font-mono text-fuchsia-300">{result.cpm.critical_activities}</span></div>
                  </>
                )}
              </div>
            </div>

            {result.warnings?.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
                <div className="text-amber-300 text-xs font-medium mb-1">Warnings ({result.warnings.length})</div>
                {result.warnings.slice(0, 10).map((w: string, i: number) => (
                  <div key={i} className="text-xs text-zinc-400 font-mono">{w}</div>
                ))}
              </div>
            )}

            <button onClick={() => onImported(result.schedule_id)}
              className="w-full py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 text-fuchsia-200 rounded-lg">
              Open Schedule
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ===========================================================================
// DELAY ANALYSIS PANEL
// ===========================================================================
function DelayAnalysisPanel({ scheduleId, onClose }: any) {
  const [delays, setDelays] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/api/v1/cpm/delays/${scheduleId}`).then(r => r.json())
      .then(d => setDelays(d.delays || []));
  }, [scheduleId]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="mt-6 bg-red-500/5 border border-red-500/30 rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-red-200">
          <AlertTriangle className="w-5 h-5" />
          Delay Analysis ({delays.length} delayed activities)
        </h3>
        <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {delays.length === 0 ? (
        <p className="text-sm text-zinc-400">No delays detected â€” schedule is on track.</p>
      ) : (
        <div className="space-y-2">
          {delays.map((d) => (
            <div key={d.activity_id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <span className="font-mono text-xs text-zinc-500">{d.activity_code}</span>
                  <h4 className="text-sm font-medium text-zinc-100">{d.activity_name}</h4>
                </div>
                <div className="flex gap-2 items-center">
                  {d.is_critical && (
                    <span className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-mono border border-fuchsia-500/30">
                      CRITICAL
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-xs font-mono ${
                    d.delay_vs_baseline_days > 30 ? "bg-red-500/20 text-red-300" :
                    d.delay_vs_baseline_days > 7 ? "bg-orange-500/20 text-orange-300" :
                    "bg-amber-500/20 text-amber-300"
                  }`}>
                    +{d.delay_vs_baseline_days || d.forecast_slip_days || 0}d
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs text-zinc-400">
                <div>Baseline: <span className="font-mono text-zinc-300">{d.baseline_finish_date?.slice(0,10) || "â€”"}</span></div>
                <div>Actual: <span className="font-mono text-zinc-300">{d.actual_finish_date?.slice(0,10) || "â€”"}</span></div>
                <div>Forecast: <span className="font-mono text-zinc-300">{d.forecast_finish_date?.slice(0,10) || "â€”"}</span></div>
                <div>% Complete: <span className="font-mono text-zinc-300">{Math.round(d.physical_pct_complete || 0)}%</span></div>
              </div>
              {d.attributions?.length > 0 && (
                <div className="mt-2 text-xs text-zinc-400">
                  Cause: {d.attributions[0].cause} Â· Attributed to: <span className="text-zinc-200">{d.attributions[0].attributable_to}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
