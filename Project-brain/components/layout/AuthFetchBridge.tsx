"use client";

/**
 * Sprint 1 — global auth bridge.
 *
 * PB_AUTH_ENFORCE turned Bearer auth on across the backend, but dozens of
 * pages still call the API with plain fetch(). Rather than touching every
 * call site, this bridge patches window.fetch once:
 *
 *   • any request to a Project-Brain backend origin (8000 = core API,
 *     8002 = AI service) gets the stored token as an Authorization header
 *     when the caller didn't set one;
 *   • a 401 from those origins clears the session and routes to /login
 *     (except on the login page itself, so a failed login shows its error).
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getToken } from "@/lib/auth";

const API_ORIGINS = [
  "localhost:8000", "127.0.0.1:8000",
  "localhost:8002", "127.0.0.1:8002",
];

function isApiUrl(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    return API_ORIGINS.some((o) => url.includes(o));
  } catch {
    return false;
  }
}

let patched = false;

export default function AuthFetchBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (patched || typeof window === "undefined") return;
    patched = true;
    const original = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isApiUrl(input)) return original(input, init);

      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined),
      );
      const token = getToken();
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const res = await original(input, { ...init, headers });

      if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
        // stale/absent token — send the user to login once, not in a loop
        clearSession();
        window.location.href = "/login";
      }
      return res;
    };
  }, [router, pathname]);

  return null;
}
