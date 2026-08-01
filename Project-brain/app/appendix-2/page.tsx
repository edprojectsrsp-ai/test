"use client";

/**
 * Appendix-2 Redirect
 * This page has been merged into the unified Plan Engine page.
 * Redirects users automatically.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Appendix2Redirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/progress/plan-engine");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--ink)" }}>
      <div className="text-center">
        <div className="text-lg font-bold mb-2" style={{ color: "var(--ink-3)" }}>Redirecting…</div>
        <p className="text-sm" style={{ color: "var(--ink-4)" }}>
          Appendix-2 has moved to the{" "}
          <a href="/progress/plan-engine" className="underline" style={{ color: "var(--steel)" }}>
            Master Plan Engine
          </a>
          .
        </p>
      </div>
    </div>
  );
}
