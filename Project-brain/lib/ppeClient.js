/**
 * Unified PPE API client — timeouts, clearer errors, offline-friendly.
 */
import { getPpeApiBase, buildPpeUrl } from "./ppeApi";

export {
  getPpeApiBase,
  buildPpeUrl,
  normalizePpePath,
  PPE_PROXY_BASE,
  PPE_DIRECT_BASE,
} from "./ppeApi";

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * @param {string} path - e.g. "/api/cameras" or "/health"
 * @param {RequestInit & { timeoutMs?: number, raw?: boolean }} [options]
 */
export async function ppeFetch(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, raw = false, ...init } = options;
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
  const health = await ppeFetch("/health", { timeoutMs: 8000 }).catch(() => null);
  if (!health || health.status !== "ok") {
    return {
      health: "offline",
      camRunning: 0,
      camTotal: 0,
      openAlerts: 0,
      pendingReview: 0,
      device: null,
      model: null,
      armed: null,
    };
  }

  const [cams, types, pending] = await Promise.all([
    ppeFetch("/api/cameras", { timeoutMs: 8000 }).catch(() => []),
    ppeFetch("/api/violations/types", { timeoutMs: 8000 }).catch(() => null),
    ppeFetch("/api/review/pending", { timeoutMs: 8000 }).catch(() => []),
  ]);

  const list = Array.isArray(cams) ? cams : [];
  return {
    health: "online",
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
