"use client";

/**
 * "Physical Progress of Different Project on Monthly Basis" — matches the
 * friend's PMC report exactly: pick one Corporate AMR project from a
 * dropdown, see its contract meta, an 11-column details row (approval/award/
 * completion dates, time overrun, cost overrun, cumulative expenditure), the
 * per-activity physical-progress table (overall target / cumulative previous
 * / month target / month achievement), and the manpower deployment table.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Loader2, BarChart3, CalendarDays, ListChecks, FolderKanban, Download, FileSpreadsheet } from "lucide-react";
import { exportPmc } from "@/lib/export";

const API = "http://localhost:8000/api/v1";

type SchemeOption = { scheme_id: number; scheme_name: string; scheme_type: string };

type ActivityRow = {
  item: string; overallTarget: number; cumulativePrevious: number;
  targetMonth: number; achievementMonth: number;
};
type ManpowerRow = { slNo: string; agency: string; manpower: string; value: number };
type Detail = {
  schemeId: number; projectName: string; month: string; financialYear: string;
  contractMeta: { agency: string; loaDate: string | null; effectiveDate: string | null };
  details: {
    approvalDate: string | null; awardDate: string | null;
    originalCompletionDate: string | null; revisedCompletionDate: string | null;
    anticipatedCompletionDate: string | null; timeOverrunMonths: number | null;
    originalCostCr: number; revisedCostCr: number; anticipatedCostCr: number;
    costOverrunCr: number; cumulativeExpenditureCr: number;
  };
  physicalProgress: ActivityRow[];
  manpower: { monthLabel: string; filledDays: number; rows: ManpowerRow[] };
};

const fmtD = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const cr = (n: number | null | undefined) =>
  n || n === 0 ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
const pct = (n: number) => `${Number(n || 0).toFixed(2)}%`;

export default function PhysicalProgressPmcPage() {
  const router = useRouter();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [schemes, setSchemes] = useState<SchemeOption[]>([]);
  const [schemeId, setSchemeId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const runExport = async (format: "pdf" | "docx" | "xlsx" | "pptx") => {
    if (!schemeId) return;
    setExporting(true);
    try {
      await exportPmc({ format, schemeId, month });
    } catch (e: any) {
      alert(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`)
      .then(r => r.json())
      .then((d: any[]) => {
        const corp = (Array.isArray(d) ? d : [])
          .filter((s) => s.type === "corporate")
          .map((s) => ({ scheme_id: s.id, scheme_name: s.name, scheme_type: s.type }));
        setSchemes(corp);
        // COB-7 carries the richest activity-level plan data.
        const preferred = corp.find((s) => s.scheme_id === 74) ?? corp[0];
        if (preferred) setSchemeId(String(preferred.scheme_id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!schemeId) return;
    setLoading(true);
    fetch(`${API}/reports-mos/pmc-detail/${schemeId}?month=${month}`)
      .then(r => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [schemeId, month]);

  const detailHeaders = [
    "Date of Approval", "Date of Awarding Contract", "Original Completion",
    "Revised Completion", "Anticipated Completion", "Time Overrun (months)",
    "Original Cost (₹ Cr)", "Revised Cost (₹ Cr)", "Anticipated Cost (₹ Cr)",
    "Cost Overrun (₹ Cr)", "Cum. Exp. Till Month (₹ Cr)",
  ];
  const detailCells = detail ? [
    fmtD(detail.details.approvalDate), fmtD(detail.details.awardDate),
    fmtD(detail.details.originalCompletionDate), fmtD(detail.details.revisedCompletionDate),
    fmtD(detail.details.anticipatedCompletionDate),
    detail.details.timeOverrunMonths ?? "-",
    cr(detail.details.originalCostCr), cr(detail.details.revisedCostCr),
    cr(detail.details.anticipatedCostCr), cr(detail.details.costOverrunCr),
    cr(detail.details.cumulativeExpenditureCr),
  ] : [];

  const th = "border border-[var(--line)] bg-[var(--panel-3)] px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-3)]";
  const td = "border border-[var(--line)] px-2 py-1.5 text-xs text-center";
  const tdL = "border border-[var(--line)] px-2 py-1.5 text-xs text-left";

  return (
    <div className="min-h-screen p-6 text-[var(--ink)] print:p-0">
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <button onClick={() => router.push("/reports")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-[var(--panel-3)]">
          <ArrowLeft size={13} /> Reports
        </button>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <BarChart3 className="h-5 w-5 text-[var(--steel)]" />
          Physical Progress of Different Project on Monthly Basis
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" disabled={!detail || exporting}
            onClick={() => runExport("pdf")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-40">
            <Download size={13} /> PDF
          </button>
          <button type="button" disabled={!detail || exporting}
            onClick={() => runExport("docx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-40">
            <Download size={13} /> DOC
          </button>
          <button type="button" disabled={!detail || exporting}
            onClick={() => runExport("xlsx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-40">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button type="button" disabled={!detail || exporting}
            onClick={() => runExport("pptx")}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--panel-3)] disabled:opacity-40">
            <Download size={13} /> PPT
          </button>
          <button onClick={() => window.print()} disabled={!detail}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--steel)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 print:hidden">
        <label className="flex items-center gap-2 text-xs">
          <CalendarDays size={14} className="text-[var(--steel)]" /> Month
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--steel)]" />
        </label>
        <span className="flex items-center gap-1.5 text-xs text-[var(--ink-3)]">
          <ListChecks size={14} /> Report Type: Physical Progress
        </span>
        <label className="flex items-center gap-2 text-xs">
          <FolderKanban size={14} className="text-[var(--steel)]" /> Project
          <select value={schemeId} onChange={e => setSchemeId(e.target.value)}
            className="min-w-[280px] rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--steel)]">
            {schemes.map(s => (
              <option key={s.scheme_id} value={s.scheme_id}>{s.scheme_name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-4 rounded-lg bg-[#0b3d91] px-5 py-3 text-center print:rounded-none">
        <div className="text-sm font-bold tracking-widest text-white">
          Physical Progress of Different Project on Monthly Basis
        </div>
        <div className="text-[11px] text-blue-200">
          Month: {month} · Projects: {detail?.projectName || "-"}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[var(--ink-3)]">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading project detail…
        </div>
      ) : !detail ? (
        <div className="rounded-xl border border-dashed border-[var(--line)] py-16 text-center text-[var(--ink-3)]">
          Select a project from the dropdown to view physical progress data.
        </div>
      ) : (
        <>
          {/* contract meta */}
          <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Name of Agency</th>
                  <th className={th}>LOA Date</th>
                  <th className={th}>Effective Date of Contract</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={td}>{detail.contractMeta.agency}</td>
                  <td className={td}>{fmtD(detail.contractMeta.loaDate)}</td>
                  <td className={td}>{fmtD(detail.contractMeta.effectiveDate)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 11-column details row */}
          <div className="mb-4">
            <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Details of the Project</h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr>{detailHeaders.map(h => <th key={h} className={th}>{h}</th>)}</tr>
                  <tr>{detailHeaders.map((h, i) => <th key={h + "n"} className={th}>{i + 1}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>{detailCells.map((c, i) => <td key={i} className={td}>{c}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* physical progress table */}
          <div className="mb-4">
            <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">Physical Progress</h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th} style={{ textAlign: "left" }}>Item Description of Progress (Main package)</th>
                    <th className={th}>Overall % Target till the month</th>
                    <th className={th}>Cumulative % Complete on till Previous month</th>
                    <th className={th}>% Target for the month</th>
                    <th className={th}>% Achievement for the month</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.physicalProgress.length ? detail.physicalProgress.map((row, i) => (
                    <tr key={i}>
                      <td className={tdL}>{row.item}</td>
                      <td className={td}>{pct(row.overallTarget)}</td>
                      <td className={td}>{pct(row.cumulativePrevious)}</td>
                      <td className={td}>{pct(row.targetMonth)}</td>
                      <td className={td}>{pct(row.achievementMonth)}</td>
                    </tr>
                  )) : (
                    <tr><td className={tdL} colSpan={5}>
                      No S-Curve activity rows found for {detail.projectName} in {month}.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* manpower */}
          <div>
            <h2 className="mb-2 text-sm font-bold text-[var(--ink)]">
              Manpower Deployment - PMC Report
              <span className="ml-2 text-xs font-normal text-[var(--ink-3)]">
                Month Average: {detail.manpower.monthLabel} · DPR Days: {detail.manpower.filledDays}
              </span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>SL. NO.</th>
                    <th className={th} style={{ textAlign: "left" }}>Agency</th>
                    <th className={th}>Manpower</th>
                    <th className={th} colSpan={2}>Total Numbers Engaged</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.manpower.rows.length ? detail.manpower.rows.map((row, i) => (
                    <tr key={i}>
                      <td className={td}>{row.slNo}</td>
                      <td className={tdL}>{row.agency}</td>
                      <td className={td}>{row.manpower}</td>
                      <td className={td} colSpan={2}><b>{row.value}</b></td>
                    </tr>
                  )) : (
                    <tr><td className={tdL} colSpan={5}>
                      No manpower data available from Daily Progress Report for {month}.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
