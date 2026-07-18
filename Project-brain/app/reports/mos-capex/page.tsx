"use client";

/**
 * MoS CAPEX — two views:
 *   1. "MoS Format": the categorized Ministry-of-Steel statement
 *      (Being implemented from last FY / started this FY / total ongoing with
 *       delay split / completed milestone payments / new projects 3a+3b /
 *       spares & capital repairs / grand total).
 *   2. "Detail": the per-scheme monthly BE/RE/actual table.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Loader2, IndianRupee, Calendar, Download, FileSpreadsheet } from "lucide-react";
import MosCapexReport from "@/components/furnace/MosCapexReport";
import { CapexPackPanel } from "@/components/report/RsReports";
import { exportMosCapex } from "@/lib/export";

const API = "http://localhost:8000/api/v1";

type StatusGroup = { label: string; count: number; cost: number };
type Row = {
  no: string; category: string; tone: string; section: boolean;
  projects: number; totalCost: number; expenditureLastFy: number;
  capexCurrentFy: number; expenditureCurrentFy: number; totalExpenditure: number;
  childRows: Row[]; statusGroups: StatusGroup[]; point3Rows?: Row[];
};

const n2 = (v: number) => (v ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0");

const toneCls: Record<string, string> = {
  blue: "bg-sky-500/10", teal: "bg-teal-500/10", purple: "bg-violet-500/15 font-bold",
  "soft-purple": "bg-violet-500/5", "soft-blue": "bg-sky-500/5",
  "soft-green": "bg-emerald-500/5", "soft-orange": "bg-orange-500/10 font-semibold",
  "soft-red": "bg-red-500/5", total: "bg-[var(--steel-soft)] font-bold",
};

export default function MosCapexPage() {
  const router = useRouter();
  const [view, setView] = useState<"format" | "pf" | "detail" | "pack">(() => {
    if (typeof window !== "undefined") {
      const section = new URLSearchParams(window.location.search).get("section");
      if (section === "physical-financial") return "pf";
      if (section === "detail") return "detail";
      if (section === "formats" || section === "capex-pack") return "pack";
    }
    return "format";
  });
  const [data, setData] = useState<{ financialYear: string; asOn: string; rows: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [exporting, setExporting] = useState(false);

  const runExport = async (format: "xlsx" | "pdf" | "docx" | "pptx") => {
    setExporting(true);
    try {
      await exportMosCapex({ format, reportMonth });
    } catch (e: any) {
      alert(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/reports-mos/capex-summary?report_month=${reportMonth}`)
      .then(r => r.json()).then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [reportMonth]);

  if (view === "pf") {
    return (
      <div>
        <div className="flex items-center gap-2 p-4 pb-0 print:hidden">
          <button onClick={() => router.push("/reports")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--panel-3)]">
            <ArrowLeft size={13} /> Reports
          </button>
          <ViewSeg view={view} setView={setView} />
        </div>
        <PhysicalFinancialDetail />
      </div>
    );
  }

  if (view === "pack") {
    return (
      <div className="min-h-screen p-6 text-[var(--ink)]">
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <button onClick={() => router.push("/reports")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--panel-3)]">
            <ArrowLeft size={13} /> Reports
          </button>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <IndianRupee className="h-5 w-5 text-[var(--steel)]" />
            CAPEX Standard Formats — 3 Reports
          </h1>
          <ViewSeg view={view} setView={setView} />
        </div>
        <div className="mb-4 rounded-lg bg-[#0b3d91] px-5 py-3 text-center">
          <div className="text-sm font-bold tracking-widest text-white">
            PHYSICAL &amp; FINANCIAL PROGRESS · MONTH-WISE MONITORING · MoS BACKUP
          </div>
          <div className="text-[11px] text-blue-200">
            Rourkela Steel Plant · built from Report Studio KPIs · view or download each format below
          </div>
        </div>
        <CapexPackPanel />
      </div>
    );
  }

  if (view === "detail") {
    return (
      <div>
        <div className="flex items-center gap-2 p-4 pb-0 print:hidden">
          <ViewSeg view={view} setView={setView} />
        </div>
        <MosCapexReport onBack={() => router.push("/reports")} />
      </div>
    );
  }

  const td = "border border-[var(--line)] px-2.5 py-1.5 text-xs text-right whitespace-nowrap";
  const tdL = "border border-[var(--line)] px-2.5 py-1.5 text-xs text-left";

  const renderRow = (r: Row, depth = 0, key = "") => {
    const rows: React.ReactNode[] = [];
    rows.push(
      <tr key={key} className={`${toneCls[r.tone] || ""} ${r.section ? "font-bold" : ""}`}>
        <td className={td} style={{ width: 40 }}>{r.no}</td>
        <td className={tdL} style={{ paddingLeft: 10 + depth * 18 }}>
          {r.category}
          {r.statusGroups.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
              {r.statusGroups.map(g => (
                <span key={g.label}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    g.label === "On Time" ? "bg-emerald-500/15 text-emerald-600"
                    : g.label.includes("< 1") ? "bg-amber-500/15 text-amber-600"
                    : "bg-red-500/15 text-red-600"}`}>
                  {g.label}: {g.count} · ₹{n2(g.cost)}
                </span>
              ))}
            </span>
          )}
        </td>
        <td className={td}>{r.projects || ""}</td>
        <td className={td}>{n2(r.totalCost)}</td>
        <td className={td}>{n2(r.expenditureLastFy)}</td>
        <td className={td}>{n2(r.capexCurrentFy)}</td>
        <td className={td}>{n2(r.expenditureCurrentFy)}</td>
        <td className={td}>{n2(r.totalExpenditure)}</td>
      </tr>,
    );
    (r.point3Rows || []).forEach((c, i) => rows.push(...renderRow(c, depth + 1, `${key}-p3-${i}`)));
    (r.childRows || []).forEach((c, i) => rows.push(...renderRow(c, depth + 1, `${key}-c-${i}`)));
    return rows;
  };

  return (
    <div className="min-h-screen p-6 text-[var(--ink)] print:p-0">
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <button onClick={() => router.push("/reports")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--panel-3)]">
          <ArrowLeft size={13} /> Reports
        </button>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <IndianRupee className="h-5 w-5 text-[var(--steel)]" />
          MoS CAPEX Statement
        </h1>
        <ViewSeg view={view} setView={setView} />
        <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs">
          <Calendar size={13} className="text-[var(--steel)]" />
          Report month
          <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)}
            className="bg-transparent font-semibold outline-none" />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" disabled={exporting || loading}
            onClick={() => runExport("xlsx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-50">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button type="button" disabled={exporting || loading}
            onClick={() => runExport("pdf")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-50">
            <Download size={13} /> PDF
          </button>
          <button type="button" disabled={exporting || loading}
            onClick={() => runExport("docx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-50">
            <Download size={13} /> DOC
          </button>
          <button type="button" disabled={exporting || loading}
            onClick={() => runExport("pptx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-50">
            <Download size={13} /> PPT
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--steel)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-[#0b3d91] px-5 py-3 text-center print:rounded-none">
        <div className="text-sm font-bold tracking-widest text-white">
          CAPEX PROJECTS — MoS FORMAT · FY {data?.financialYear || ""}
        </div>
        <div className="text-[11px] text-blue-200">
          Rourkela Steel Plant · all values ₹ Cr · as on {data?.asOn || ""}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[var(--ink-3)]">
          <Loader2 className="h-5 w-5 animate-spin" /> Computing MoS statement…
        </div>
      ) : !data ? (
        <div className="py-16 text-center text-[var(--ink-3)]">Could not load report.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["No.", "Category", "Projects", "Total Cost", `Exp. till last FY`,
                  `CAPEX FY ${data.financialYear} (BE/RE)`, `Exp. FY ${data.financialYear}`,
                  "Total Expenditure"].map(h => (
                  <th key={h}
                    className="border border-[var(--line)] bg-[var(--panel-3)] px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-3)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{data.rows.flatMap((r, i) => renderRow(r, 0, `r${i}`))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ViewKey = "format" | "pf" | "detail" | "pack";
function ViewSeg({ view, setView }: { view: ViewKey; setView: (v: ViewKey) => void }) {
  const base = "px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-1">
      <button className={`${base} ${view === "format" ? "bg-[var(--steel)] text-white" : "text-[var(--ink-3)]"}`}
        onClick={() => setView("format")}>MoS Format</button>
      <button className={`${base} ${view === "pf" ? "bg-[var(--steel)] text-white" : "text-[var(--ink-3)]"}`}
        onClick={() => setView("pf")}>Physical &amp; Financial Detail</button>
      <button className={`${base} ${view === "detail" ? "bg-[var(--steel)] text-white" : "text-[var(--ink-3)]"}`}
        onClick={() => setView("detail")}>Detail by Scheme</button>
      <button className={`${base} ${view === "pack" ? "bg-[var(--steel)] text-white" : "text-[var(--ink-3)]"}`}
        onClick={() => setView("pack")}>Standard Formats (3)</button>
    </div>
  );
}

// ─────────────────── Physical & Financial Progress Detail ───────────────────
// Matches the friend's "Physical and Financial Progress Report of CAPEX
// Projects" drill-down: >=50 Cr projects individually, <50 Cr grouped.

type PfProject = {
  schemeId: number; name: string; totalCost: number;
  approvalDate: string | null; awardDate: string | null;
  originalCompletionDate: string | null; anticipatedCompletionDate: string | null;
  expenditureLastFy: number; capexCurrentFy: number; expenditureCurrentFy: number;
  cumulativeExpenditure: number; reasonForDelay?: string;
  physical: { last_fy: number; fy_plan: number; fy_actual: number } | null;
};
type PfData = {
  month: string; financialYear: string;
  highCostProjects: PfProject[];
  lowCostSummary: { count: number; totalCost: number; expenditureLastFy: number;
                    capexCurrentFy: number; expenditureCurrentFy: number; cumulativeExpenditure: number };
};

function PhysicalFinancialDetail() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<PfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/reports-mos/capex-detail?month=${month}`)
      .then(r => r.json()).then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month]);

  const fmtD = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  const n2 = (v: number) => (v || v === 0 ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-");
  const pct = (v: number | undefined) => `${(v ?? 0).toFixed(2)}%`;

  const th = "border border-[var(--line)] bg-[var(--panel-3)] px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-3)]";
  const td = "border border-[var(--line)] px-2 py-1.5 text-xs text-center";
  const tdL = "border border-[var(--line)] px-2 py-1.5 text-xs text-left";

  return (
    <div className="min-h-screen p-6 text-[var(--ink)] print:p-0">
      <div className="mb-4 mt-3 flex items-center justify-between print:hidden">
        <div className="text-sm text-[var(--ink-3)]">
          Project-wise physical &amp; financial progress — mirrors the MoS drill-down report.
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">Report Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[var(--steel)]" />
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--steel)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <Printer size={13} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-[#0b3d91] px-5 py-3 text-center print:rounded-none">
        <div className="text-sm font-bold tracking-widest text-white">
          Physical and Financial Progress Report of CAPEX Projects — FY {data?.financialYear || ""}
        </div>
        <div className="text-[11px] text-blue-200">
          Rourkela Steel Plant · Report Month {data?.month || month}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[var(--ink-3)]">
          <Loader2 className="h-5 w-5 animate-spin" /> Computing project-wise progress…
        </div>
      ) : !data ? (
        <div className="py-16 text-center text-[var(--ink-3)]">Could not load report.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>SN</th>
                <th className={th} style={{ textAlign: "left" }}>Name of Project / Package</th>
                <th className={th}>Total / Revised<br />Project Cost (₹ Cr)</th>
                <th className={th}>Date of Approval /<br />Award</th>
                <th className={th}>Original / Revised<br />Completion</th>
                <th className={th}>Physical Progress (%)<br />i. till last FY<br />ii. FY plan<br />iii. FY actual</th>
                <th className={th}>CAPEX till<br />last FY (₹ Cr)</th>
                <th className={th}>CAPEX target<br />for FY (₹ Cr)</th>
                <th className={th}>CAPEX expenditure<br />in FY (₹ Cr)</th>
                <th className={th}>Cum. CAPEX exp.<br />till month (₹ Cr)</th>
                <th className={th}>Reasons of delay,<br />if any</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={tdL} colSpan={11} style={{ background: "var(--panel-3)", fontWeight: 700 }}>
                  A. Projects &ge; ₹50 Cr. — Rourkela Steel Plant
                </td>
              </tr>
              {data.highCostProjects.map((p, i) => (
                <tr key={p.schemeId}>
                  <td className={td}>{i + 1}</td>
                  <td className={tdL}>{p.name}</td>
                  <td className={td}>{n2(p.totalCost)}</td>
                  <td className={td}>
                    {fmtD(p.approvalDate)}{p.awardDate ? <><br />{fmtD(p.awardDate)}</> : null}
                  </td>
                  <td className={td}>
                    {fmtD(p.originalCompletionDate)}
                    {p.anticipatedCompletionDate && p.anticipatedCompletionDate !== p.originalCompletionDate
                      ? <><br /><span className="text-amber-600">{fmtD(p.anticipatedCompletionDate)}</span></> : null}
                  </td>
                  <td className={td}>
                    {p.physical
                      ? <>i. {pct(p.physical.last_fy)}<br />ii. {pct(p.physical.fy_plan)}<br />iii. {pct(p.physical.fy_actual)}</>
                      : "-"}
                  </td>
                  <td className={td}>{n2(p.expenditureLastFy)}</td>
                  <td className={td}>{n2(p.capexCurrentFy)}</td>
                  <td className={td}>{n2(p.expenditureCurrentFy)}</td>
                  <td className={td}>{n2(p.cumulativeExpenditure)}</td>
                  <td className={tdL}>{p.reasonForDelay || "-"}</td>
                </tr>
              ))}
              <tr className="font-bold" style={{ background: "var(--steel-soft)" }}>
                <td className={td}></td>
                <td className={tdL}>Projects &lt; ₹50 Cr. ({data.lowCostSummary.count} Nos)</td>
                <td className={td}>{n2(data.lowCostSummary.totalCost)}</td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}></td>
                <td className={td}>{n2(data.lowCostSummary.expenditureLastFy)}</td>
                <td className={td}>{n2(data.lowCostSummary.capexCurrentFy)}</td>
                <td className={td}>{n2(data.lowCostSummary.expenditureCurrentFy)}</td>
                <td className={td}>{n2(data.lowCostSummary.cumulativeExpenditure)}</td>
                <td className={td}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
