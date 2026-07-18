"use client";

/**
 * Matrix Builder route — dynamic import keeps TanStack + recharts out of other modules.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

const PowerBuilder = dynamic(() => import("../PowerBuilder"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 48, color: "var(--ink-3)", fontSize: 13 }}>
      <Loader2 size={16} className="spin" /> Loading Matrix Builder…
    </div>
  ),
});

export default function BuilderPage() {
  return (
    <div>
      <div style={{ padding: "8px 22px 0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <ArrowLeft size={13} /> Hub
        </Link>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
          Design here → <Link href="/report-studio/templates" style={{ color: "var(--steel)" }}>Save / run as template</Link>
        </span>
      </div>
      <PowerBuilder />
    </div>
  );
}
