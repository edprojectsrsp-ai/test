"use client";

/**
 * Lightweight Report Studio overview.
 * The goal here is product clarity: fewer entry points, same underlying power.
 */

import Link from "next/link";
import {
  ArrowRight, FileStack, FlaskConical, Play, Save, Scale, Table2, Wand2, Wrench,
} from "lucide-react";

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 18,
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  textDecoration: "none",
  color: "inherit",
  minHeight: 168,
  transition: "border-color .15s, box-shadow .15s",
};

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "var(--panel-2)",
  color: "var(--ink-3)",
  fontSize: 11.5,
  fontWeight: 700,
};

export default function ReportStudioHub() {
  return (
    <div style={{ padding: "18px 24px", maxWidth: 1080 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--ink)" }}>
          One studio, four clear jobs
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, maxWidth: 760 }}>
          Report Studio now groups the existing features into cleaner workspaces.
          You still have matrix design, KPI work, dashboarding, report composition,
          governed matrix runs, snapshots, and what-if analysis, but with less route sprawl.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={pill}><Table2 size={12} /> Builder = matrix + KPI + dashboard</span>
        <span style={pill}><FileStack size={12} /> Reports = library + compose + document + designer</span>
        <span style={pill}><Scale size={12} /> Engine = governed matrix logic and run mode</span>
        <span style={pill}><Wrench size={12} /> Scenarios = what-if and legacy specialist tools</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12, marginBottom: 22 }}>
        <Link href="/report-studio/builder" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <Table2 size={18} /> <b style={{ fontSize: 14 }}>Builder</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, flex: 1 }}>
            Matrix Builder, KPI Builder, and Dashboard Canvas in one place. Use this for analytics authoring and reusable query specs.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open builder <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/templates" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <FileStack size={18} /> <b style={{ fontSize: 14 }}>Reports</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, flex: 1 }}>
            Saved report packs, ingest and compose, final document review, and template design grouped into one report-production workspace.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open reports <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/matrix" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <Scale size={18} /> <b style={{ fontSize: 14 }}>Engine</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, flex: 1 }}>
            Versioned rules, inherited row hierarchies, measure libraries, run mode, drilldown, reconciliation, snapshots, and exports.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open engine <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/tools" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <FlaskConical size={18} /> <b style={{ fontSize: 14 }}>Scenarios</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, flex: 1 }}>
            What-if analysis stays separate because it is a specialized planning surface. Legacy routes remain reachable from here too.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open scenarios <ArrowRight size={13} />
          </span>
        </Link>
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 16,
          background: "var(--panel-2)",
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <Step n={1} icon={<Wand2 size={14} />} title="Build" body="Author matrices, KPIs, formulas, and dashboard pages in Builder." />
        <Step n={2} icon={<Save size={14} />} title="Package" body="Save as reusable specs, add sections to reports, and manage templates without freezing numbers." />
        <Step n={3} icon={<Play size={14} />} title="Run" body="Open Reports or Engine to regenerate live outputs, inspect, export, and freeze approved snapshots." />
      </div>

      <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
        Matrix Engine scratchpad still provides Excel-like inline formulas for ad hoc analysis.
        Matrix Builder remains Power BI-style, not cell-by-cell spreadsheet design.
      </p>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: "var(--steel-soft)",
          color: "var(--steel)",
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {n}
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          {icon} {title}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.45 }}>{body}</div>
      </div>
    </div>
  );
}
