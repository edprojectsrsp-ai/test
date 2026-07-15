"use client";
import React, { useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { PageHeader, Card, Chip } from "@/ui";
import { REPORTS, ReportDef } from "@/lib/furnace/api";
import MosCapexReport from "@/components/furnace/MosCapexReport";
import PhysicalProgressPmc from "@/components/furnace/PhysicalProgressPmc";

const LIVE = ["mos-capex", "pmc-phys", "phys-fin", "capex-pmc"];

export default function ReportsPage() {
  const [open, setOpen] = useState<string | null>(null);

  if (open === "mos-capex" || open === "capex-pmc") return <MosCapexReport onBack={() => setOpen(null)} />;
  if (open === "pmc-phys" || open === "phys-fin") return <PhysicalProgressPmc onBack={() => setOpen(null)} />;

  const groups = useMemo(() => {
    const g: Record<string, ReportDef[]> = {};
    REPORTS.forEach((r) => { (g[r.group] ||= []).push(r); });
    return Object.entries(g);
  }, []);

  const launch = (r: ReportDef) => {
    if (LIVE.includes(r.id)) setOpen(r.id);
    else if (typeof window !== "undefined") window.location.href = r.path;
  };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Reports" subtitle="Official corporate-office & PMC deliverables — view or export" right={<ThemeToggle />} />
      {groups.map(([group, reports]) => (
        <div key={group}>
          <div className="fz-eyebrow">{group} <span className="tag">{reports.length} reports</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {reports.map((r) => {
              const live = LIVE.includes(r.id);
              return (
                <button key={r.id} onClick={() => launch(r)} style={{ textAlign: "left", cursor: "pointer", border: 0, background: "transparent", padding: 0 }}>
                  <Card style={{ height: "100%" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--steel-soft)", color: "var(--steel)" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>
                      </div>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                    </div>
                    <div className="fz-display" style={{ fontWeight: 700, fontSize: 15, marginTop: 13 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>{r.desc}</div>
                    <div style={{ marginTop: 12, display: "flex", gap: 7 }}><Chip tone="neutral">PDF / Excel</Chip>{live && <Chip tone="ok" dot>Live</Chip>}</div>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
