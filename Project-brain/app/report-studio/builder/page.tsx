"use client";

/**
 * Unified Builder workspace.
 * Keeps the old capabilities but collapses overlapping authoring tools into one page.
 */

import { type CSSProperties, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, BarChart3, LayoutDashboard, Loader2, Table2 } from "lucide-react";

const load = (label: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 48, color: "var(--ink-3)", fontSize: 13 }}>
    <Loader2 size={16} className="spin" /> Loading {label}...
  </div>
);

const PowerBuilder = dynamic(() => import("../PowerBuilder"), {
  ssr: false,
  loading: () => load("Matrix Builder"),
});

const KpiBuilder = dynamic(() => import("../KpiBuilder"), {
  ssr: false,
  loading: () => load("KPI Builder"),
});

const DashboardCanvas = dynamic(() => import("../DashboardCanvas"), {
  ssr: false,
  loading: () => load("Dashboard Canvas"),
});

type Tab = "matrix" | "kpi" | "canvas";

const INTRO: Record<Tab, string> = {
  matrix: "Use this for the deepest semantic builder flow: dimensions, measures, formulas, filters, pivots, charts, and reusable report sections.",
  kpi: "Use this for a lighter self-service KPI experience over curated datasets when you want speed more than full report modeling depth.",
  canvas: "Use this when the deliverable is a full dashboard page with positioned visuals, slicers, and cross-filter behavior.",
};

export default function BuilderPage() {
  const [tab, setTab] = useState<Tab>("matrix");

  const btn = (active: boolean): CSSProperties => ({
    border: "1px solid var(--line)",
    cursor: "pointer",
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 12.5,
    fontWeight: 750,
    background: active ? "var(--steel-soft)" : "var(--panel)",
    color: active ? "var(--steel)" : "var(--ink-3)",
  });

  return (
    <div>
      <div style={{ padding: "12px 22px 0", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
            <ArrowLeft size={13} /> Overview
          </Link>
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
            Save reusable outputs into{" "}
            <Link href="/report-studio/templates" style={{ color: "var(--steel)" }}>Reports</Link>
          </span>
          <Link href="/report-studio/canvas" style={{ fontSize: 12, color: "var(--ink-4)", textDecoration: "none" }}>
            Legacy direct canvas route
          </Link>
        </div>

        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>Builder Workspace</h1>
          <p style={{ margin: "6px 0 0", maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
            Matrix Builder, KPI Builder, and Dashboard Canvas now live together so analytics design happens in one place.
            The tools are unchanged underneath; this page only reduces navigation overlap.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btn(tab === "matrix")} onClick={() => setTab("matrix")}><Table2 size={13} /> Matrix Builder</button>
          <button style={btn(tab === "kpi")} onClick={() => setTab("kpi")}><BarChart3 size={13} /> KPI Builder</button>
          <button style={btn(tab === "canvas")} onClick={() => setTab("canvas")}><LayoutDashboard size={13} /> Dashboard Canvas</button>
        </div>

        <div style={{ maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
          {INTRO[tab]}
        </div>
      </div>

      {tab === "matrix" && <PowerBuilder />}
      {tab === "kpi" && <KpiBuilder />}
      {tab === "canvas" && <DashboardCanvas />}
    </div>
  );
}
