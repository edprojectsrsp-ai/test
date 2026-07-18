"use client";

/**
 * Advanced Report Studio tools — each panel lazy-loaded so only the active tab pays cost.
 */

import { type CSSProperties, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

const load = (label: string) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, color: "var(--ink-3)", fontSize: 13 }}>
    <Loader2 size={16} className="spin" /> Loading {label}…
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
  "TS2": "Treatment System-2",
  "PELLET-2MTPA": "2.0 MTPA Pellet Plant",
  "BF5-STOVE4": "BF-5 4th Stove",
};

type Tab = "kpi" | "studio" | "document" | "designer" | "whatif";

export default function ToolsPage() {
  const [tab, setTab] = useState<Tab>("kpi");
  const btn = (a: boolean): CSSProperties => ({
    border: "1px solid var(--line)", cursor: "pointer", padding: "7px 14px", borderRadius: 9,
    fontSize: 12.5, fontWeight: 750,
    background: a ? "var(--steel-soft)" : "var(--panel)",
    color: a ? "var(--steel)" : "var(--ink-3)",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/report-studio" style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", marginRight: 6 }}>
          <ArrowLeft size={13} /> Hub
        </Link>
        <button style={btn(tab === "kpi")} onClick={() => setTab("kpi")}>KPI Builder</button>
        <button style={btn(tab === "studio")} onClick={() => setTab("studio")}>Ingest & Compose</button>
        <button style={btn(tab === "document")} onClick={() => setTab("document")}>Report Document</button>
        <button style={btn(tab === "designer")} onClick={() => setTab("designer")}>Template Designer</button>
        <button style={btn(tab === "whatif")} onClick={() => setTab("whatif")}>What-If</button>
      </div>
      {tab === "kpi" && <KpiBuilder />}
      {tab === "studio" && <ReportStudio />}
      {tab === "designer" && <TemplateDesigner />}
      {tab === "whatif" && <WhatIfPanel />}
      {tab === "document" && (
        <ReportDocument
          project="COB7-PKG2"
          month="2026-06"
          allProjects={["OXY-1000", "COB7-PKG2", "TS2", "PELLET-2MTPA", "BF5-STOVE4"]}
          projectNames={NAMES}
          figuresCtx={{
            capex_heads: [
              ["MEP", 0, 0, 0, 0],
              ["AMR", 238.7, 122.7, 802.33, 391.7],
              ["Capital Repair & Spares", 2.2, 17.3, 2.2, 53.3],
              ["New Schemes", 0, 8.93, 0, 0],
              ["Total", 240.9, 140.0, 804.53, 445.0],
            ],
            pmc_discipline: [
              ["Civil Work", 65.84, 64.68, 5.55],
              ["Structural Supply", 77.62, 53.15, 13.55],
            ],
            portfolio_status: [
              ["On Schedule", 41, 6120],
              ["Delay < 1 Yr", 19, 3480],
              ["Delay > 1 Yr", 8, 2068],
            ],
            milestones: [
              { name: "Silo Building Civil", orig: "12.11.2026", anticipated: "07.05.2027", reason: "Drawing delay" },
            ],
          }}
        />
      )}
    </div>
  );
}
