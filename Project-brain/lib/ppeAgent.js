/**
 * Local PPE agent discovery.
 *
 * Inference, cameras and live video run on the plant PC, not in the cloud — a
 * 512 MB instance cannot hold torch, let alone decode RTSP. So the same page,
 * served from Vercel over HTTPS, has two very different jobs depending on where
 * it is opened:
 *
 *   On the plant PC  -> talk straight to http://127.0.0.1:8004. Video never
 *                       leaves the machine and never crosses the cloud.
 *   Anywhere else    -> fall back to the /api/ppe proxy, which reaches the
 *                       cloud role: violations and analytics only.
 *
 * This module answers "is there an agent on this machine?" once, cheaply, and
 * lets the UI subscribe to the answer.
 *
 * Two browser details this has to live with:
 *
 *   * An HTTPS page fetching http://127.0.0.1 is allowed — loopback counts as a
 *     potentially-trustworthy origin — but Chrome first sends a Private Network
 *     Access preflight. The agent answers it (see main.py); without that reply
 *     every call fails as an opaque CORS error that looks like the agent is
 *     down. Use Chrome or Edge: Firefox has been inconsistent here.
 *
 *   * A failed probe on a remote machine is a connection refused, which is
 *     immediate and harmless, but it does log to the console. That noise is the
 *     price of not requiring the user to tell us where they are sitting.
 */

const DEFAULT_AGENT_URL = "http://127.0.0.1:8004";

// How long a negative result stands before we look again. Long enough that a
// remote viewer clicking around does not re-probe on every render, short enough
// that starting the agent and refreshing the page just works.
const ABSENT_TTL_MS = 60_000;
// A positive result is cheap to re-check and the shell already polls /health
// every 5s, so this only guards against a stale base after the agent stops.
const ONLINE_TTL_MS = 15_000;
const PROBE_TIMEOUT_MS = 1500;

/** @typedef {"unknown"|"probing"|"online"|"absent"} AgentStatus */

const state = {
  /** @type {AgentStatus} */ status: "unknown",
  /** @type {string|null} */ base: null,
  /** @type {object|null} */ health: null,
  checkedAt: 0,
};

/** @type {Set<(s: typeof state) => void>} */
const listeners = new Set();
/** @type {Promise<typeof state>|null} */
let inFlight = null;

function isBrowser() {
  return typeof window !== "undefined";
}

function candidates() {
  const configured =
    (typeof process !== "undefined" &&
      process.env &&
      process.env.NEXT_PUBLIC_PPE_AGENT_URL) ||
    "";
  const list = [];
  if (configured) list.push(configured.replace(/\/$/, ""));
  list.push(DEFAULT_AGENT_URL);
  // 127.0.0.1 before localhost on purpose: "localhost" can resolve to ::1
  // first, and a v4-only listener then looks unreachable.
  list.push("http://localhost:8004");
  return [...new Set(list)];
}

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* a broken subscriber must not break discovery */
    }
  });
}

function setState(next) {
  Object.assign(state, next, { checkedAt: Date.now() });
  emit();
}

async function probe(base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const health = await r.json();
    // Must be an EDGE agent. The cloud role answers /health too, and treating
    // it as local would send camera and live-view calls somewhere that has no
    // cameras and no detector.
    if (health?.status !== "ok" || health?.role === "cloud") return null;
    return health;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the agent, using the cached answer when it is still fresh.
 * Concurrent callers share one probe.
 * @param {{ force?: boolean }} [opts]
 */
export function ensureAgent(opts = {}) {
  if (!isBrowser()) return Promise.resolve({ ...state, status: "absent" });
  if (inFlight) return inFlight;

  const age = Date.now() - state.checkedAt;
  const ttl = state.status === "online" ? ONLINE_TTL_MS : ABSENT_TTL_MS;
  if (!opts.force && state.status !== "unknown" && age < ttl) {
    return Promise.resolve({ ...state });
  }

  inFlight = (async () => {
    if (state.status === "unknown") setState({ status: "probing" });
    for (const base of candidates()) {
      const health = await probe(base);
      if (health) {
        setState({ status: "online", base, health });
        return { ...state };
      }
    }
    setState({ status: "absent", base: null, health: null });
    return { ...state };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Force a fresh probe (the Retry button). */
export function refreshAgent() {
  return ensureAgent({ force: true });
}

/**
 * The agent's base URL, or null when there is none.
 * Synchronous by design: buildPpeUrl and <img src> cannot await. Before the
 * first probe resolves this returns null and callers use the cloud proxy;
 * subscribers re-render once the answer arrives.
 */
export function getAgentBase() {
  return state.status === "online" ? state.base : null;
}

export function agentStatus() {
  return state.status;
}

export function agentHealth() {
  return state.health;
}

/**
 * @param {(s: typeof state) => void} fn
 * @returns {() => void} unsubscribe — returns nothing, so it can be handed
 * straight back from useEffect (a React cleanup must not return a value).
 */
export function subscribeAgent(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
