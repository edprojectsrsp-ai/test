"use client";
// Reports Hub v2 — parity with rival report cards (MoS CAPEX / Phys-Fin / PMC)
// plus: inline live preview table before exporting, per-format export buttons
// wired to the generic report_export engine, and the AI custom-report card
// (describe any report → safe SQL → table + chart) which the rival cannot do.
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, PageHeader, Select, toast } from "@/ui";
import { REPORT_CARDS, ReportCard, ReportPreview, getReportPreview, reportExportUrl, downloadCSV, MOCK } from "@/lib/furnace/gridApi";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" };
const FYS = ["2026-27", "2025-26"];

const GROUP_TONE: Record<string, string> = {
  "Corporate Office (MoS)": "var(--steel-soft)", PMC: "var(--verdigris-soft)", Progress: "var(--slag-soft)", AI: "var(--molten-soft)",
};

export default function ReportsHub() {
  const [fy, setFy] = useState(FYS[0]);
  const [activeId, setActiveId] = useState<string>(REPORT_CARDS[0].id);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [loading, setLoading] = useState(false);

  const active = useMemo(() => REPORT_CARDS.find((r) => r.id === activeId)!, [activeId]);
  const groups = useMemo(() => {
    const m = new Map<string, ReportCard[]>();
    REPORT_CARDS.forEach((r) => m.set(r.group, [...(m.get(r.group) ?? []), r]));
    return [...m.entries()];
  }, []);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    getReportPreview(activeId, fy)
      .then((p) => { if (!gone) setPreview(p); })
      .catch((error) => {
        if (!gone) setPreview({
          title: "Live report unavailable", fy, generated: new Date().toISOString(),
          columns: ["Status"], rows: [[String(error)]],
          footnote: "Demo figures are disabled; this panel only shows live database results.",
        });
      })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [activeId, fy]);

  const onExport = (fmt: string) => {
    if (activeId === "custom-ai") { window.location.href = `/ai?ask=${encodeURIComponent("Build me a custom report: ")}`; return; }
    if (fmt === "csv" && preview) {
      downloadCSV(`${activeId}-${fy}`, preview.columns, preview.rows, `${preview.title} — FY ${fy}`);
      toast("Report exported (CSV)");
      return;
    }
    if (MOCK) { toast(`Demo mode — ${fmt.toUpperCase()} export runs against the live backend (report_export engine).`); return; }
    window.open(reportExportUrl(activeId, fy, fmt), "_blank");
  };

  const isNumeric = (v: string | number) => typeof v === "number";

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Reports" subtitle="Ministry & PMC formats · live preview before export · xlsx / docx / pdf via one engine"
        right={<>
          <Field label="Financial year"><Select value={fy} onChange={setFy} options={FYS.map((f) => ({ value: f, label: `FY ${f}` }))} style={{ minWidth: 128 }} /></Field>
          <ThemeToggle />
        </>} />

      <div style={{ display: "grid", gridTemplateColumns: "330px 1fr", gap: 14, marginTop: 14, alignItems: "start" }}>
        {/* Card rail */}
        <div style={{ display: "grid", gap: 12 }}>
          {groups.map(([group, cards]) => (
            <Card key={group} pad={false}>
              <div style={{ padding: "9px 14px", background: GROUP_TONE[group] ?? "var(--panel)", borderBottom: "1px solid var(--line)", ...label }}>{group}</div>
              {cards.map((c) => (
                <button key={c.id} onClick={() => setActiveId(c.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 14px", cursor: "pointer",
                    border: "none", borderBottom: "1px solid var(--grid-line)",
                    background: c.id === activeId ? "var(--steel-soft)" : "transparent",
                    borderLeft: c.id === activeId ? "3px solid var(--steel)" : "3px solid transparent", color: "var(--ink)",
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--steel-dim)", marginTop: 2 }}>{c.desc}</div>
                  <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                    {c.exports.map((f) => <Chip key={f} tone="neutral">{f}</Chip>)}
                  </div>
                </button>
              ))}
            </Card>
          ))}
        </div>

        {/* Preview panel */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{preview?.title ?? active.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--steel-dim)", marginTop: 2 }}>
                FY {fy} · generated {preview?.generated ?? "…"} {loading ? "· loading…" : ""}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            {active.exports.map((f) => (
              <Button key={f} kind={f === "pdf" ? "accent" : "default"} onClick={() => onExport(f)}>
                {f === "csv" ? "CSV" : f.toUpperCase()}
              </Button>
            ))}
            {active.id !== "custom-ai" ? <Button onClick={() => onExport("csv")}>CSV</Button> : null}
          </div>

          {active.id === "custom-ai" ? (
            <div style={{ marginTop: 16, padding: 18, border: "1px dashed var(--line)", borderRadius: "var(--r-lg)", background: "var(--bg-tint-warm)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Describe the report you need — Brain builds it.</div>
              <p style={{ fontSize: 12.5, color: "var(--steel-dim)", margin: "6px 0 12px", lineHeight: 1.6 }}>
                Example: “Scheme-wise CAPEX achievement for Corporate AMR, months Apr–Jun, only schemes below 50%, with a bar chart.”
                The AI plans safe read-only SQL against the live schema, renders the table with citations, and exports to xlsx/pdf.
              </p>
              <Button kind="accent" onClick={() => onExport("ai")}>Open in Brain Console →</Button>
            </div>
          ) : preview ? (
            <div style={{ marginTop: 14, overflow: "auto", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c} style={{ padding: "7px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--steel-dim)", background: "var(--panel)", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, ri) => {
                    const total = String(row[1] ?? "").toUpperCase() === "TOTAL";
                    return (
                      <tr key={ri} style={{ background: total ? "var(--panel)" : ri % 2 ? "var(--bg-tint-cool)" : "transparent", fontWeight: total ? 700 : 400 }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: "6px 12px", fontSize: 12.5, borderBottom: "1px solid var(--grid-line)", textAlign: isNumeric(cell) ? "right" : ci === 0 ? "center" : "left", ...(isNumeric(cell) ? mono : {}), whiteSpace: "nowrap" }}>
                            {isNumeric(cell) ? (cell as number).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : String(cell)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview?.footnote && active.id !== "custom-ai" ? (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--steel-dim)" }}>※ {preview.footnote}</div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
