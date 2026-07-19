"use client";

/**
 * Report Studio hub — intentionally lightweight (no TanStack / recharts / builder).
 * Heavy modules load only when navigating to /builder or /tools.
 */

import Link from "next/link";
import {
  ArrowRight, FileStack, LayoutDashboard, Play, Save, Scale, Table2, Wand2, Wrench,
} from "lucide-react";

const card: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10,
  padding: 18, borderRadius: 14,
  border: "1px solid var(--line)", background: "var(--panel)",
  textDecoration: "none", color: "inherit", minHeight: 150,
  transition: "border-color .15s, box-shadow .15s",
};

export default function ReportStudioHub() {
  return (
    <div style={{ padding: "18px 24px", maxWidth: 980 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>
          Design once · run anytime
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, maxWidth: 640 }}>
          Report Studio lives on its own routes so CAPEX, DPR, and dashboards stay light.
          Build matrices and formulas here, <b>save as a template</b>, then regenerate the report
          later — always from live database figures, not a frozen snapshot.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 22 }}>
        <Link href="/report-studio/builder" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <Table2 size={18} /> <b style={{ fontSize: 14 }}>Matrix Builder</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, flex: 1 }}>
            Power BI–style design: rows, pivot columns, measures, formulas, filters.
            Heavy UI loads only on this page.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open designer <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/canvas" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <LayoutDashboard size={18} /> <b style={{ fontSize: 14 }}>Dashboard Canvas</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, flex: 1 }}>
            Power BI-style report pages: drag &amp; resize visuals on a grid, slicers,
            click-to-cross-filter, multi-page dashboards saved as live query specs.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open canvas <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/matrix" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <Scale size={18} /> <b style={{ fontSize: 14 }}>Matrix Engine</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, flex: 1 }}>
            Metadata-driven MoS/PMC reports: reusable versioned rules, inherited row
            hierarchies, period-sensitive classification, cell drill-down to source
            schemes, reconciliation checks, frozen approved snapshots.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open designer <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/templates" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <FileStack size={18} /> <b style={{ fontSize: 14 }}>Templates</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, flex: 1 }}>
            Saved multi-section report packs. Click View / Excel / Word — queries re-run
            against current CAPEX actuals and plans.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Run saved templates <ArrowRight size={13} />
          </span>
        </Link>

        <Link href="/report-studio/tools" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--steel)" }}>
            <Wrench size={18} /> <b style={{ fontSize: 14 }}>Advanced tools</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, flex: 1 }}>
            KPI cards, document compose, WYSIWYG template designer, what-if — loaded on demand only.
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--steel)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Open tools <ArrowRight size={13} />
          </span>
        </Link>
      </div>

      <div
        style={{
          border: "1px solid var(--line)", borderRadius: 14, padding: 16,
          background: "var(--panel-2)", display: "grid", gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <Step n={1} icon={<Wand2 size={14} />} title="Design" body="Build matrix / formulas / filters in Matrix Builder." />
        <Step n={2} icon={<Save size={14} />} title="Save template" body="Save metric or “Add to report” → stored as query specs, not numbers." />
        <Step n={3} icon={<Play size={14} />} title="Generate anytime" body="Open Templates → View / export. Figures refresh from live data." />
      </div>

      <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
        Official MoS board packs (pixel-perfect Excel/Word) remain under{" "}
        <Link href="/reports/mos-capex" style={{ color: "var(--steel)" }}>/reports/mos-capex</Link>
        {" "}and CAPEX pack templates. This studio is for self-serve analytics packs that stay current.
      </p>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div
        style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          display: "grid", placeItems: "center",
          background: "var(--steel-soft)", color: "var(--steel)", fontSize: 12, fontWeight: 800,
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
