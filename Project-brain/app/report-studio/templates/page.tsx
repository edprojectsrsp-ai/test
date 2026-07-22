"use client";

/**
 * Unified Reports workspace.
 * Groups report library, composition, document review, and template design.
 */

import { type CSSProperties, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, FileStack, FileText, Loader2, PenTool, Sparkles, Table2 } from "lucide-react";

const load = (label: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 48, color: "var(--ink-3)", fontSize: 13 }}>
    <Loader2 size={16} className="spin" /> Loading {label}...
  </div>
);

const ReportsLibrary = dynamic(() => import("../../../components/report/RsReports"), {
  ssr: false,
  loading: () => load("Reports Library"),
});

const ReportStudio = dynamic(() => import("../../../components/report/ReportStudio"), {
  ssr: false,
  loading: () => load("Compose"),
});

const ReportDocument = dynamic(() => import("../../../components/report/ReportDocument"), {
  ssr: false,
  loading: () => load("Document"),
});

const TemplateDesigner = dynamic(() => import("../TemplateDesigner"), {
  ssr: false,
  loading: () => load("Template Designer"),
});

const NAMES: Record<string, string> = {
  "OXY-1000": "1000 TPD Oxygen Plant",
  "COB7-PKG2": "COB#7 Battery Proper (Pkg-2)",
  TS2: "Treatment System-2",
  "PELLET-2MTPA": "2.0 MTPA Pellet Plant",
  "BF5-STOVE4": "BF-5 4th Stove",
};

type Tab = "library" | "compose" | "document" | "designer";

const INTRO: Record<Tab, string> = {
  library: "Run saved report packs against live data, preview outputs, and export Excel or Word without opening the full builder.",
  compose: "Ingest raw material, compose grounded report drafts, review citations, and edit narrative before packaging final outputs.",
  document: "Review the resolved report in document form and edit visible cells or bullets inline before export.",
  designer: "Define reusable report layouts and structures when you need a more template-first workflow.",
};

export default function TemplatesPage() {
  const [tab, setTab] = useState<Tab>("library");

  const btn = (active: boolean): CSSProperties => ({
    border: "1px solid var(--line)",
    cursor: "pointer",
    padding: "8px 14px",
    borderRadius: 10,
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
      <div style={{ padding: "12px 24px 0", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
            <ArrowLeft size={13} /> Overview
          </Link>
          <Link
            href="/report-studio/builder"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--steel)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Table2 size={13} /> Build new sections in Builder
          </Link>
        </div>

        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>Reports Workspace</h1>
          <p style={{ margin: "6px 0 0", maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
            Report library, composition, final document review, and template design are grouped here so the report-production flow stays together.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btn(tab === "library")} onClick={() => setTab("library")}><FileStack size={13} /> Library</button>
          <button style={btn(tab === "compose")} onClick={() => setTab("compose")}><Sparkles size={13} /> Compose</button>
          <button style={btn(tab === "document")} onClick={() => setTab("document")}><FileText size={13} /> Document</button>
          <button style={btn(tab === "designer")} onClick={() => setTab("designer")}><PenTool size={13} /> Designer</button>
        </div>

        <div style={{ maxWidth: 860, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
          {INTRO[tab]}
        </div>
      </div>

      {tab === "library" && <ReportsLibrary />}
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
