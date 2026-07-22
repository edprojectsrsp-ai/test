"use client";

/**
 * Scenario workspace with legacy specialist access.
 * Keeps What-If prominent while preserving access to older standalone entry points.
 */

import { type CSSProperties, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, BarChart3, FileText, FlaskConical, Loader2, PenTool, Sparkles } from "lucide-react";

const load = (label: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, color: "var(--ink-3)", fontSize: 13 }}>
    <Loader2 size={16} className="spin" /> Loading {label}...
  </div>
);

const KpiBuilder = dynamic(() => import("../KpiBuilder"), { ssr: false, loading: () => load("KPI Builder") });
const TemplateDesigner = dynamic(() => import("../TemplateDesigner"), { ssr: false, loading: () => load("Template Designer") });
const WhatIfPanel = dynamic(() => import("../WhatIfPanel"), { ssr: false, loading: () => load("What-If") });
const ReportStudio = dynamic(() => import("../../../components/report/ReportStudio"), { ssr: false, loading: () => load("Compose") });
const ReportDocument = dynamic(() => import("../../../components/report/ReportDocument"), { ssr: false, loading: () => load("Document") });

const NAMES: Record<string, string> = {
  "OXY-1000": "1000 TPD Oxygen Plant",
  "COB7-PKG2": "COB#7 Battery Proper (Pkg-2)",
  TS2: "Treatment System-2",
  "PELLET-2MTPA": "2.0 MTPA Pellet Plant",
  "BF5-STOVE4": "BF-5 4th Stove",
};

type Tab = "whatif" | "kpi" | "compose" | "document" | "designer";

const INTRO: Record<Tab, string> = {
  whatif: "Scenario analysis stays distinct because it changes live assumptions over real data rather than designing reusable report specs.",
  kpi: "Standalone KPI access remains here for teams that want the old shortcut, though the main Builder workspace now groups it with matrix and dashboard design.",
  compose: "Legacy direct access to ingestion and composition remains here even though the cleaner home for it is now the Reports workspace.",
  document: "Legacy direct document review remains available here for users who prefer jumping straight into final report edits.",
  designer: "Legacy direct template designer access remains available here without removing the new grouped Reports flow.",
};

export default function ToolsPage() {
  const [tab, setTab] = useState<Tab>("whatif");

  const btn = (active: boolean): CSSProperties => ({
    border: "1px solid var(--line)",
    cursor: "pointer",
    padding: "7px 14px",
    borderRadius: 9,
    fontSize: 12.5,
    fontWeight: 750,
    background: active ? "var(--steel-soft)" : "var(--panel)",
    color: active ? "var(--steel)" : "var(--ink-3)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  });

  return (
    <div>
      <div style={{ display: "grid", gap: 10, padding: "12px 22px 0" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", marginRight: 6 }}>
            <ArrowLeft size={13} /> Overview
          </Link>
          <Link href="/report-studio/templates" style={{ fontSize: 12, color: "var(--steel)", textDecoration: "none" }}>
            Reports workspace
          </Link>
          <Link href="/report-studio/builder" style={{ fontSize: 12, color: "var(--steel)", textDecoration: "none" }}>
            Builder workspace
          </Link>
        </div>

        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>Scenario Workspace</h1>
          <p style={{ margin: "6px 0 0", maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
            What-If remains first-class here. Older direct-entry specialist tools are still available so no capability is lost while the main IA stays cleaner.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btn(tab === "whatif")} onClick={() => setTab("whatif")}><FlaskConical size={13} /> What-If</button>
          <button style={btn(tab === "kpi")} onClick={() => setTab("kpi")}><BarChart3 size={13} /> KPI Legacy</button>
          <button style={btn(tab === "compose")} onClick={() => setTab("compose")}><Sparkles size={13} /> Compose Legacy</button>
          <button style={btn(tab === "document")} onClick={() => setTab("document")}><FileText size={13} /> Document Legacy</button>
          <button style={btn(tab === "designer")} onClick={() => setTab("designer")}><PenTool size={13} /> Designer Legacy</button>
        </div>

        <div style={{ maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
          {INTRO[tab]}
        </div>
      </div>

      {tab === "whatif" && <WhatIfPanel />}
      {tab === "kpi" && <KpiBuilder />}
      {tab === "compose" && <ReportStudio />}
      {tab === "designer" && <TemplateDesigner />}
      {tab === "document" && (
        <ReportDocument
          project="COB7-PKG2"
          month={new Date().toISOString().slice(0, 7)}
          allProjects={["OXY-1000", "COB7-PKG2", "TS2", "PELLET-2MTPA", "BF5-STOVE4"]}
          projectNames={NAMES}
        />
      )}
    </div>
  );
}
