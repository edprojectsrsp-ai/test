// api.ts — typed client for the scheduling backend.
// Pass a baseUrl (default same-origin) when mounting under a gateway.

import type {
  SchedulePayload,
  DelayReport,
  DcmaReport,
  DashboardPayload,
} from "./types";

export class SchedulingApi {
  constructor(
    private baseUrl = "",
    private prefix = "/api/scheduling"
  ) {}

  private url(path: string) {
    return `${this.baseUrl}${this.prefix}${path}`;
  }

  listProjects() {
    return fetch(this.url("/projects")).then((r) =>
      this.json<Array<{
        id: string;
        name: string;
        code: string | null;
        start_date: string | null;
        data_date: string | null;
      }>>(r)
    );
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  getSchedule(projectId: string) {
    return fetch(this.url(`/projects/${projectId}/schedule`)).then((r) =>
      this.json<SchedulePayload>(r)
    );
  }

  createProject(body: {
    name: string;
    code?: string;
    start_date?: string;
    data_date?: string;
  }) {
    return fetch(this.url("/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => this.json<{ id: string }>(r));
  }

  importSchedule(projectId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(this.url(`/projects/${projectId}/import`), {
      method: "POST",
      body: formData,
    }).then((r) => this.json<{ imported: unknown; activities_persisted: number }>(r));
  }

  runCpm(projectId: string) {
    return fetch(this.url(`/projects/${projectId}/cpm/run`), {
      method: "POST",
    }).then((r) => this.json<{ project_finish: string; critical_path: string[] }>(r));
  }

  updateProgress(
    activityId: string,
    body: {
      actual_start?: string;
      actual_finish?: string;
      percent_complete?: number;
      remaining_duration?: number;
      remarks?: string;
      changed_by?: string;
    }
  ) {
    return fetch(this.url(`/activities/${activityId}/progress`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => this.json<{ updated_fields: string[]; project_finish: string }>(r));
  }

  saveBaseline(projectId: string, name: string) {
    const q = new URLSearchParams({ name });
    return fetch(this.url(`/projects/${projectId}/baselines?${q}`), {
      method: "POST",
    }).then((r) => this.json<{ baseline_id: string; project_finish: string }>(r));
  }

  getDelay(projectId: string, baselineId: string) {
    const q = new URLSearchParams({ baseline_id: baselineId });
    return fetch(this.url(`/projects/${projectId}/delay?${q}`)).then((r) =>
      this.json<DelayReport>(r)
    );
  }

  runDcma(projectId: string, baselineId?: string) {
    const q = baselineId ? `?baseline_id=${baselineId}` : "";
    return fetch(this.url(`/projects/${projectId}/dcma${q}`), {
      method: "POST",
    }).then((r) => this.json<DcmaReport>(r));
  }

  getDashboard(projectId: string) {
    return fetch(this.url(`/projects/${projectId}/dashboard`)).then((r) =>
      this.json<DashboardPayload>(r)
    );
  }

  exportReportUrl(
    projectId: string,
    fmt: "csv" | "xlsx" | "pdf",
    opts: { baselineId?: string; lookAheadDays?: number } = {}
  ) {
    const q = new URLSearchParams({ fmt });
    if (opts.baselineId) q.set("baseline_id", opts.baselineId);
    if (opts.lookAheadDays) q.set("look_ahead_days", String(opts.lookAheadDays));
    return this.url(`/projects/${projectId}/reports/export?${q}`);
  }
}
