/**
 * Unified PPE API client — timeouts, clearer errors, offline-friendly.
 */
import { getPpeApiBase, buildPpeUrl } from "./ppeApi";
import { ensureAgent } from "./ppeAgent";

export {
  getPpeApiBase,
  buildPpeUrl,
  normalizePpePath,
  PPE_PROXY_BASE,
  PPE_DIRECT_BASE,
} from "./ppeApi";

export {
  ensureAgent,
  refreshAgent,
  getAgentBase,
  agentStatus,
  agentHealth,
  subscribeAgent,
} from "./ppeAgent";

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * @param {string} path - e.g. "/api/cameras" or "/health"
 * @param {RequestInit & { timeoutMs?: number, raw?: boolean }} [options]
 */
export async function ppeFetch(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, raw = false, ...init } = options;

  // Settle "is there a local agent?" before building the URL, so the very
  // first request already goes to the right place. Cached after the first
  // call, so this costs nothing on subsequent ones.
  if (!path.startsWith("http")) await ensureAgent();

  const url = path.startsWith("http") ? path : buildPpeUrl(path);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = init.signal
    ? anySignal([init.signal, ctrl.signal])
    : ctrl.signal;

  try {
    const r = await fetch(url, {
      cache: "no-store",
      ...init,
      signal,
    });
    if (raw) return r;

    const t = await r.text();
    let body;
    try {
      body = t ? JSON.parse(t) : {};
    } catch {
      body = { detail: t };
    }
    if (!r.ok) {
      const detail =
        typeof body.detail === "string"
          ? body.detail
          : body.detail
            ? JSON.stringify(body.detail)
            : `${r.status} ${r.statusText}`;
      const err = new Error(detail || `HTTP ${r.status} ${path}`);
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (e) {
    if (e?.name === "AbortError") {
      const err = new Error(
        `PPE request timed out after ${timeoutMs}ms (${path}). Is the service running?`,
      );
      err.status = 0;
      err.timeout = true;
      throw err;
    }
    if (e?.message && !e.status && e.name !== "Error") {
      /* rethrow our own */
    }
    if (e?.status != null) throw e;
    const msg = e?.message || String(e);
    const err = new Error(
      `Network error talking to PPE service (${url}): ${msg}. ` +
        "Start the PPE backend (default :8004) and keep it running.",
    );
    err.status = 0;
    err.network = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience: GET JSON */
export function ppeGet(path, opts) {
  return ppeFetch(path, opts);
}

/** Convenience: POST JSON */
export function ppePost(path, body, opts = {}) {
  return ppeFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

export function ppePut(path, body, opts = {}) {
  return ppeFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

export function ppeDelete(path, opts = {}) {
  return ppeFetch(path, { method: "DELETE", ...opts });
}

/** Fleet meta for shell badges */
export async function fetchPpeShellMeta() {
  const agent = await ensureAgent();
  const onAgent = agent.status === "online";

  const health = await ppeFetch("/health", { timeoutMs: 8000 }).catch(() => null);
  if (!health || health.status !== "ok") {
    return {
      health: "offline",
      agent: agent.status,
      role: null,
      camRunning: 0,
      camTotal: 0,
      openAlerts: 0,
      pendingReview: 0,
      device: null,
      model: null,
      armed: null,
    };
  }

  // Cameras and the review queue exist only on the agent — the cloud role does
  // not mount those routers at all. Asking for them from a remote browser is a
  // guaranteed 404, so don't: an empty badge is honest, a failed request is noise.
  const [cams, types, pending] = await Promise.all([
    onAgent ? ppeFetch("/api/cameras", { timeoutMs: 8000 }).catch(() => []) : [],
    ppeFetch("/api/violations/types", { timeoutMs: 8000 }).catch(() => null),
    onAgent ? ppeFetch("/api/review/pending", { timeoutMs: 8000 }).catch(() => []) : [],
  ]);

  const list = Array.isArray(cams) ? cams : [];
  return {
    health: "online",
    agent: agent.status,
    role: health.role || (onAgent ? "edge" : "cloud"),
    camRunning: list.filter((c) => c.state === "running").length,
    camTotal: list.length,
    openAlerts: Number(types?.total) || 0,
    pendingReview: Array.isArray(pending) ? pending.length : 0,
    device: health.device || null,
    model: health.active_model || health.model || null,
    armed: health.recording_armed ?? null,
    fleet: health.fleet || null,
  };
}

/**
 * Cloud-sync controls. Agent-only: the push queue lives on the plant PC, and
 * the cloud is the destination, so none of this is meaningful remotely.
 */
export function fetchSyncStatus(opts) {
  return ppeFetch("/api/sync/status", { timeoutMs: 8000, ...opts });
}

export function fetchSyncPending(params = {}, opts) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ""),
  ).toString();
  return ppeFetch(`/api/sync/pending${qs ? `?${qs}` : ""}`, {
    timeoutMs: 12000,
    ...opts,
  });
}

/**
 * Send queued violations to the cloud.
 * @param {{camera_id?:string, rule_type?:string, since?:string, until?:string,
 *          limit?:number, dry_run?:boolean}} [filters]
 */
export function pushToCloud(filters = {}, opts = {}) {
  // A backlog of thousands is chunked server-side but still one HTTP call from
  // here, and it uploads an image per violation. Minutes, not seconds.
  return ppePost("/api/sync/push", filters, { timeoutMs: 300000, ...opts });
}

function anySignal(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
