"use client";

/**
 * Saved report templates — re-run live against semantic layer on every View/export.
 * No heavy builder bundle; only template list + table preview + export.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Loader2, Table2 } from "lucide-react";

const CustomReportsTab = dynamic(() => import("../../../components/report/RsReports"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 48, color: "var(--ink-3)", fontSize: 13 }}>
      <Loader2 size={16} className="spin" /> Loading templates…
    </div>
  ),
});

export default function TemplatesPage() {
  return (
    <div>
      <div style={{ padding: "8px 24px 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <ArrowLeft size={13} /> Hub
        </Link>
        <Link
          href="/report-studio/builder"
          style={{
            fontSize: 12, fontWeight: 700, color: "var(--steel)", textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
        >
          <Table2 size={13} /> Design new template in Matrix Builder
        </Link>
      </div>
      <CustomReportsTab />
    </div>
  );
}
