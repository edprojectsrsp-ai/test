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
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-lg font-bold text-zinc-400 mb-2">Redirecting…</div>
        <p className="text-sm text-zinc-500">
          Appendix-2 has moved to the{" "}
          <a href="/progress/plan-engine" className="text-cyan-400 underline">
            Master Plan Engine
          </a>
          .
        </p>
      </div>
    </div>
  );
}
