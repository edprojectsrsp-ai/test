/** Client for the DPMS Schema Discovery service (default :8010). */

export const DPMS_URL =
  process.env.NEXT_PUBLIC_DPMS_VIEWER_URL || "http://localhost:8010";

export type DpmsTable = {
  name: string;
  file: string;
  rows: number;
  cols: number;
};

export type DpmsRelationship = {
  id?: string;
  child_table: string;
  child_col: string;
  parent_table: string;
  parent_col: string;
  confidence?: number | null;
  containment?: number | null;
  parent_coverage?: number | null;
  name_sim?: number | null;
  status?: string;
  source?: string;
  note?: string;
};

export type DpmsStatus = {
  ready: boolean;
  folder: string;
  tables: number;
  links: number;
};

export type LinkSample = {
  child_table: string;
  child_col: string;
  parent_table: string;
  parent_col: string;
  child_preview_columns: string[];
  parent_preview_columns: string[];
  rows: Record<string, unknown>[];
};

function relId(r: Pick<DpmsRelationship, "child_table" | "child_col" | "parent_table" | "parent_col">) {
  return [r.child_table, r.child_col, r.parent_table, r.parent_col].join("|");
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${DPMS_URL}${path}`, {
      ...init,
      // Avoid stale empty caches while the DPMS service is restarting
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Cannot reach DPMS at ${DPMS_URL}. Start: python dpms_viewer.py --folder <csv> --port 8010`
    );
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) || res.statusText };
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || res.statusText || "Request failed";
    throw new Error(err);
  }
  return data as T;
}

export const dpmsApi = {
  status: () => jsonFetch<DpmsStatus>("/api/status"),
  tables: () => jsonFetch<DpmsTable[]>("/api/tables"),
  columns: (name: string) =>
    jsonFetch<{ table: string; columns: string[] }>(
      `/api/columns/${encodeURIComponent(name)}`
    ),
  relationships: () => jsonFetch<DpmsRelationship[]>("/api/relationships"),
  links: () => jsonFetch<DpmsRelationship[]>("/api/links"),
  saveRelationship: (payload: DpmsRelationship) =>
    jsonFetch<DpmsRelationship>("/api/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteRelationship: (id: string) =>
    jsonFetch<{ deleted: number; relationships: number }>(
      `/api/relationships/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),
  discover: (body?: { max_pairs?: number; sample_rows?: number }) =>
    jsonFetch<{ candidates: number; relationships: DpmsRelationship[] }>(
      "/api/discover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || { max_pairs: 450, sample_rows: 50000 }),
      }
    ),
  linkSample: (rel: DpmsRelationship, limit = 25) => {
    const q = new URLSearchParams({
      child_table: rel.child_table,
      child_col: rel.child_col,
      parent_table: rel.parent_table,
      parent_col: rel.parent_col,
      limit: String(limit),
    });
    return jsonFetch<LinkSample>(`/api/link-sample?${q}`);
  },
  projectMasterPlan: (maxTables = 20, maxFileMb = 400) =>
    jsonFetch<{
      hub: string;
      core_columns: string[];
      plan: Array<Record<string, unknown>>;
      included: number;
      available: number;
    }>(`/api/project-master/plan?max_tables=${maxTables}&max_file_mb=${maxFileMb}`),
  projectMasterBuild: (body?: {
    tables?: string[];
    max_tables?: number;
    max_file_mb?: number;
    sample_rows?: number;
  }) =>
    jsonFetch<Record<string, unknown>>("/api/project-master/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }),
  projectMaster: (page = 0, size = 50, q = "") => {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      q,
    });
    return jsonFetch<Record<string, unknown>>(`/api/project-master?${params}`);
  },
  relId,
};
