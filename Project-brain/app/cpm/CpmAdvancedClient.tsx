"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  TestTube2,
} from "lucide-react";
import {
  SchedulePage,
  SchedulingApi,
  type Activity,
  type DashboardPayload,
  type DelayReport,
  type DcmaReport,
  type SchedulePayload,
} from "../../components/scheduling-ui";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const api = new SchedulingApi(API_BASE);

type ProjectRecord = {
  id: string;
  name: string;
  code: string | null;
  start_date: string | null;
  data_date: string | null;
};

type ActivityForm = {
  actual_start: string;
  actual_finish: string;
  percent_complete: string;
  remaining_duration: string;
  remarks: string;
  changed_by: string;
};

const emptyDelay: DelayReport = {
  project_finish_variance_wd: null,
  delayed_count: 0,
  critical_delay_count: 0,
  rows: [],
};

const emptyDcma: DcmaReport = {
  checks: [],
  score: 0,
  passed_count: 0,
  applicable_count: 0,
};

function activityToForm(activity: Activity): ActivityForm {
  return {
    actual_start: activity.actual_start ?? "",
    actual_finish: activity.actual_finish ?? "",
    percent_complete: activity.percent_complete == null ? "" : String(Math.round(activity.percent_complete)),
    remaining_duration: activity.remaining_duration == null ? "" : String(activity.remaining_duration),
    remarks: "",
    changed_by: "codex",
  };
}

export default function CpmAdvancedClient({
  initialProjects,
}: {
  initialProjects: ProjectRecord[];
}) {
  const [projects, setProjects] = useState<ProjectRecord[]>(initialProjects ?? []);
  const [projectId, setProjectId] = useState(initialProjects?.[0]?.id ?? "");
  const [projectName, setProjectName] = useState(initialProjects?.[0]?.name ?? "");
  const [projectCode, setProjectCode] = useState(initialProjects?.[0]?.code ?? "");
  const [startDate, setStartDate] = useState(initialProjects?.[0]?.start_date ?? "");
  const [dataDate, setDataDate] = useState(initialProjects?.[0]?.data_date ?? "");
  const [baselineName, setBaselineName] = useState("Baseline");
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [schedule, setSchedule] = useState<SchedulePayload | null>(null);
  const [delay, setDelay] = useState<DelayReport | null>(null);
  const [dcma, setDcma] = useState<DcmaReport | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [selectedActivityCode, setSelectedActivityCode] = useState<string | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm>({
    actual_start: "",
    actual_finish: "",
    percent_complete: "",
    remaining_duration: "",
    remarks: "",
    changed_by: "codex",
  });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const selectedActivity = useMemo<Activity | null>(() => {
    if (!schedule || !selectedActivityCode) return null;
    return schedule.activities.find((activity) => activity.code === selectedActivityCode) ?? null;
  }, [schedule, selectedActivityCode]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  const loadProject = useCallback(async (pid: string, baseline?: string | null) => {
    if (!pid) return;
    setBusy(true);
    setError(null);
    try {
      const [scheduleData, dashboardData, dcmaData] = await Promise.all([
        api.getSchedule(pid),
        api.getDashboard(pid).catch(() => null),
        api.runDcma(pid, baseline ?? undefined).catch(() => null),
      ]);
      setSchedule(scheduleData);
      setDashboard(dashboardData);
      setDcma(dcmaData);
      if (baseline) {
        setDelay(await api.getDelay(pid, baseline).catch(() => null));
      } else {
        setDelay(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedule");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const handle = window.setTimeout(() => {
      void loadProject(projectId, baselineId);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [baselineId, loadProject, projectId]);

  const selectActivity = (code: string | null) => {
    setSelectedActivityCode(code);
    const activity = schedule?.activities.find((row) => row.code === code);
    if (activity) setActivityForm(activityToForm(activity));
  };

  const ensureSelectedProject = async () => {
    if (!projectId) throw new Error("Pick an existing project first.");
    return projectId;
  };

  const importSelected = async () => {
    setMessage(null);
    setError(null);
    if (!importFile) {
      setError("Choose a schedule file first.");
      return;
    }
    setImporting(true);
    try {
      const pid = await ensureSelectedProject();
      await api.importSchedule(pid, importFile);
      setMessage(`Imported ${importFile.name}. Running CPM...`);
      await api.runCpm(pid);
      await loadProject(pid, baselineId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const runCpm = async () => {
    if (!projectId) return setError("Select a project first.");
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      await api.runCpm(projectId);
      await loadProject(projectId, baselineId);
      setMessage("CPM recalculated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "CPM failed");
    } finally {
      setRunning(false);
    }
  };

  const saveBaseline = async () => {
    if (!projectId) return setError("Select a project first.");
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.saveBaseline(projectId, baselineName.trim() || "Baseline");
      setBaselineId(result.baseline_id);
      await loadProject(projectId, result.baseline_id);
      setMessage(`Baseline saved: ${result.baseline_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Baseline save failed");
    } finally {
      setSaving(false);
    }
  };

  const runDelay = async () => {
    if (!projectId) return setError("Select a project first.");
    if (!baselineId) return setError("Save a baseline first.");
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      setDelay(await api.getDelay(projectId, baselineId));
      setMessage("Delay analysis loaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delay analysis failed");
    } finally {
      setRunning(false);
    }
  };

  const runDcma = async () => {
    if (!projectId) return setError("Select a project first.");
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      setDcma(await api.runDcma(projectId, baselineId ?? undefined));
      setMessage("DCMA report refreshed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "DCMA run failed");
    } finally {
      setRunning(false);
    }
  };

  const saveActivity = async () => {
    if (!projectId || !selectedActivity) return;
    setEditing(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProgress(selectedActivity.id, {
        actual_start: activityForm.actual_start || undefined,
        actual_finish: activityForm.actual_finish || undefined,
        percent_complete: activityForm.percent_complete === "" ? undefined : Number(activityForm.percent_complete),
        remaining_duration: activityForm.remaining_duration === "" ? undefined : Number(activityForm.remaining_duration),
        remarks: activityForm.remarks || undefined,
        changed_by: activityForm.changed_by || undefined,
      });
      await loadProject(projectId, baselineId);
      setMessage(`Updated ${selectedActivity.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setEditing(false);
    }
  };

  const exportSchedule = (fmt: "csv" | "xlsx" | "pdf") => {
    if (!projectId) return;
    window.open(api.exportReportUrl(projectId, fmt, { baselineId: baselineId ?? undefined }), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-4 py-4 space-y-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-xl">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[280px] flex-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-cyan-400 font-semibold">
                <TestTube2 size={14} />
                CPM Test Harness
              </div>
              <h1 className="mt-1 text-2xl font-bold">Select an existing project and upload a schedule</h1>
              <p className="mt-1 text-sm text-zinc-400">
                Pick a project from the dropdown, upload the L2 schedule, then run CPM, baseline, DCMA, delay, and exports from the same project.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Project" value={projectId || "—"} />
              <Stat label="Activities" value={schedule?.activities.length ?? 0} />
              <Stat label="DCMA" value={dcma ? `${Math.round(dcma.score)}%` : "—"} />
              <Stat label="Delay rows" value={delay ? delay.rows.length : "—"} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Panel title="Existing project" icon={<RefreshCw size={16} />}>
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Project"
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    const project = projects.find((item) => item.id === value);
                    setProjectName(project?.name ?? "");
                    setProjectCode(project?.code ?? "");
                    setStartDate(project?.start_date ?? "");
                    setDataDate(project?.data_date ?? "");
                    setBaselineId(null);
                    if (value) void loadProject(value, null);
                  }}
                  options={[
                    { value: "", label: "Select a project" },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: `${project.name}${project.code ? ` (${project.code})` : ""}`,
                    })),
                  ]}
                />
                <Field label="Project name" value={projectName} onChange={setProjectName} />
                <Field label="Project code" value={projectCode} onChange={setProjectCode} />
                <Field label="Start date" type="date" value={startDate} onChange={setStartDate} />
                <Field label="Data date" type="date" value={dataDate} onChange={setDataDate} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton onClick={refreshProjects} loading={busy} icon={<RefreshCw size={16} />}>
                  Reload List
                </ActionButton>
                <ActionButton onClick={() => projectId && void loadProject(projectId, baselineId)} loading={busy} icon={<RefreshCw size={16} />}>
                  Reload Project
                </ActionButton>
              </div>
            </Panel>

            <Panel title="Upload and run" icon={<FileUp size={16} />}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Schedule file" type="file" onFile={setImportFile} />
                <Field label="Baseline name" value={baselineName} onChange={setBaselineName} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton onClick={importSelected} loading={importing} icon={<FileUp size={16} />} disabled={!projectId}>
                  Upload to Selected Project
                </ActionButton>
                <ActionButton onClick={runCpm} loading={running} icon={<Play size={16} />} disabled={!projectId}>
                  Run CPM
                </ActionButton>
                <ActionButton onClick={saveBaseline} loading={saving} icon={<Save size={16} />} disabled={!projectId}>
                  Save Baseline
                </ActionButton>
                <ActionButton onClick={runDcma} loading={running} icon={<CheckCircle2 size={16} />} disabled={!projectId}>
                  Run DCMA
                </ActionButton>
                <ActionButton onClick={runDelay} loading={running} icon={<AlertTriangle size={16} />} disabled={!projectId}>
                  Run Delay
                </ActionButton>
              </div>
            </Panel>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ActionButton onClick={() => exportSchedule("csv")} icon={<Download size={16} />} disabled={!projectId}>
              Export CSV
            </ActionButton>
            <ActionButton onClick={() => exportSchedule("xlsx")} icon={<Download size={16} />} disabled={!projectId}>
              Export Excel
            </ActionButton>
            <ActionButton onClick={() => exportSchedule("pdf")} icon={<Download size={16} />} disabled={!projectId}>
              Export PDF
            </ActionButton>
            {message && <Pill tone="good" text={message} />}
            {error && <Pill tone="bad" text={error} />}
          </div>
        </div>

        {dashboard && (
          <div className="grid gap-3 md:grid-cols-4">
            <MiniCard label="Health" value={dashboard.cards.health} />
            <MiniCard label="Critical" value={dashboard.cards.critical_count} />
            <MiniCard label="Needs update" value={dashboard.cards.needs_update} />
            <MiniCard label="Negative float" value={dashboard.cards.negative_float} />
          </div>
        )}

        {schedule ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-white shadow-2xl">
            <SchedulePage
              schedule={schedule}
              delay={delay ?? emptyDelay}
              dcma={dcma ?? emptyDcma}
              onExport={exportSchedule}
              onActivitySelect={selectActivity}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50 p-10 text-center text-zinc-400">
            {busy ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="animate-spin" size={18} />
                Loading schedule...
              </div>
            ) : (
              <div>
                <div className="text-lg font-semibold text-zinc-200">No schedule loaded yet</div>
                <div className="mt-1 text-sm">Choose an existing project to begin.</div>
              </div>
            )}
          </div>
        )}

        {selectedActivity && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.28em] text-cyan-400">
                  <Pencil size={15} />
                  Edit activity
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {selectedActivity.code} · {selectedActivity.name}
                </div>
              </div>
              <div className="text-sm text-zinc-400">Click any activity row to test inline editing.</div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label="Actual start" type="date" value={activityForm.actual_start} onChange={(value) => setActivityForm((prev) => ({ ...prev, actual_start: value }))} />
              <Field label="Actual finish" type="date" value={activityForm.actual_finish} onChange={(value) => setActivityForm((prev) => ({ ...prev, actual_finish: value }))} />
              <Field label="Percent complete" type="number" value={activityForm.percent_complete} onChange={(value) => setActivityForm((prev) => ({ ...prev, percent_complete: value }))} />
              <Field label="Remaining duration" type="number" value={activityForm.remaining_duration} onChange={(value) => setActivityForm((prev) => ({ ...prev, remaining_duration: value }))} />
              <Field label="Changed by" value={activityForm.changed_by} onChange={(value) => setActivityForm((prev) => ({ ...prev, changed_by: value }))} />
              <Field label="Remarks" value={activityForm.remarks} onChange={(value) => setActivityForm((prev) => ({ ...prev, remarks: value }))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton onClick={saveActivity} loading={editing} icon={<Save size={16} />}>
                Save Activity
              </ActionButton>
              <ActionButton onClick={() => selectActivity(null)} icon={<CheckCircle2 size={16} />}>
                Clear Selection
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[140px] rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-cyan-300">{value}</div>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <span className="text-cyan-400">{icon}</span>
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Pill({ tone, text }: { tone: "good" | "bad"; text: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      }`}
    >
      {tone === "good" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      {text}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onFile,
  type = "text",
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  onFile?: (file: File | null) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      {type === "file" ? (
        <input
          type="file"
          className="block w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
          onChange={(event) => onFile?.(event.target.files?.[0] ?? null)}
        />
      ) : (
        <input
          type={type}
          value={value ?? ""}
          onChange={(event) => onChange?.(event.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-cyan-500"
        />
      )}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-0 focus:border-cyan-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionButton({
  onClick,
  children,
  icon,
  loading = false,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
