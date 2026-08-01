/**
 * Sprint 0 — client auth helpers (token storage + fetch with Bearer).
 */

const TOKEN_KEYS = ["brain_token", "token", "pb_token"] as const;

export type BrainUser = {
  user_id?: number;
  username?: string;
  full_name?: string;
  role?: string;
  designation?: string;
  department?: string;
};

/** A real backend JWT has three dot-separated segments (header.payload.sig).
 *  Stale/placeholder values (e.g. "dev") are not JWTs and cause the export
 *  endpoints to 401 with "Invalid token: Not enough segments", so we skip
 *  them when picking the token to send. */
function looksLikeJwt(v: string | null): boolean {
  return !!v && v.split(".").length === 3;
}

export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  // Prefer a value that actually looks like a JWT, so a garbage value left in
  // one key doesn't shadow a valid token in another and break downloads.
  const values = TOKEN_KEYS.map((k) => localStorage.getItem(k)).filter(Boolean) as string[];
  return values.find(looksLikeJwt) ?? values[0] ?? null;
}

export function setSession(token: string, user?: BrainUser) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("brain_token", token);
  localStorage.setItem("token", token); // compat with ProtectedRoute
  if (user) localStorage.setItem("brain_user", JSON.stringify(user));
}

export function clearSession() {
  if (typeof localStorage === "undefined") return;
  TOKEN_KEYS.forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem("brain_user");
}

export function getStoredUser(): BrainUser | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("brain_user");
    return raw ? (JSON.parse(raw) as BrainUser) : null;
  } catch {
    return null;
  }
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  const base: Record<string, string> = {};
  if (token) base.Authorization = `Bearer ${token}`;
  if (!extra) return base;
  if (extra instanceof Headers) {
    extra.forEach((v, k) => {
      base[k] = v;
    });
    return base;
  }
  return { ...base, ...(extra as Record<string, string>) };
}

/** fetch with Authorization when a token is present */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}
