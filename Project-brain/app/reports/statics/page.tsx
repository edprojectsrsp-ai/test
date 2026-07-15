"use client";

/**
 * Statics Report — the friend's Ongoing → DPR summary table format:
 * one activity per band (quantity row + % row), columns
 * Scope | UOM | Till <last FY end> | FTM Plan/Actual | FY Plan/Actual |
 * Cumulative Till Plan/Actual, with the weighted Over All row on top and
 * the Capex (In Cr.) band at the bottom. Values come from the unified
 * progress service, so they match the DPR Summary tab and dashboards.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, Printer, Table2 } from "lucide-react";
import { exportStatics } from "@/lib/export";

const API = "http://localhost:8000/api/v1";

type Row = {
  id: number | string;
  overall?: boolean;
  source?: string;
  parent?: string;
  category?: string;
  activity?: string;
  scope?: number;
  uom?: string;
  lastFyActual?: number;
  ftmPlan?: number;
  ftmActual?: number;
  currentFyPlan?: number;
  currentFyActual?: number;
  cumulativePlan?: number;
  cumulativeActual?: number;
  lastFyActualPercent?: number;
  ftmPlanPercent?: number;
  ftmActualPercent?: number;
  currentFyPlanPercent?: number;
  currentFyActualPercent?: number;
  cumulativePlanPercent?: number;
  cumulativeActualPercent?: number;
};

type Payload = {
  schemeId: number;
  planMonth: string;
  financialYear: string;
  asOf: string;
  plannedPercent: number;
  actualPercent: number;
  summary: { financialYearLabel: string; summaryRows: Row[] };
};

type Scheme = { id: number; name: string };
type Pkg = { package_id: number; package_name: string };

const qty = (v: number | undefined | null) =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (v: number | undefined | null) => `${(v ?? 0).toFixed(2)}%`;

/**
 * Map a raw (category, name) to the ministry DPR grid's clean short label and
 * an ordering rank — a faithful port of the friend's progress_category(): the
 * discipline comes from the activity name (steel/structural, mechanical/
 * equipment, refractory, civil, design), Supply-vs-Erection from the activity
 * category, and pairs are ordered Supply→Erection per discipline. Anything
 * outside the standard set keeps its raw name and original order, so other
 * schemes render unchanged.
 */
function staticsDisplay(category: string, name: string, index: number): { label: string; rank: number } {
  const cat = (category || "").toLowerCase();
  const t = `${category} ${name}`.toLowerCase();
  const erection = cat.includes("erection") || /\berection\b/.test(t);
  if (/design/.test(t) && /eng/.test(t)) return { label: "Design & Engg.", rank: 0 };
  if (/civil/.test(t)) return { label: "Civil-RCC", rank: 1 };
  let disc = "", base = -1;
  if (/steel|structur/.test(t)) { disc = "Strl"; base = 2; }
  else if (/mechanical|equipment|electrical/.test(t)) { disc = "Eqpt"; base = 4; }
  else if (/refractor/.test(t)) { disc = "Refractory"; base = 6; }
  if (base < 0) return { label: name, rank: 90 + index };   // unknown → keep raw name & order
  return { label: `${disc} ${erection ? "Erection" : "Supply"}`, rank: base + (erection ? 1 : 0) };
}

export default function StaticsReportPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading report…</p>}>
      <StaticsReport />
    </Suspense>
  );
}

function StaticsReport() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedPackageId = params.get("package_id") || "";
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState(() => params.get("id") || "");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [packageId, setPackageId] = useState(requestedPackageId);
  // current month selected by default
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const runExport = async (format: "xlsx" | "pdf" | "docx") => {
    if (!schemeId) return;
    setExporting(true);
    try {
      await exportStatics({
        format,
        schemeId,
        month,
        packageId: packageId || null,
      });
    } catch (e: any) {
      alert(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        setSchemes(d.map((s: any) => ({ id: s.id, name: s.name })));
        setSchemeId((cur) => cur || String(d[0]?.id || ""));
      })
      .catch(() => {});
  }, []);

  // load sub-projects (packages) when the project changes
  useEffect(() => {
    if (!schemeId) return;
    setPackages([]);
    fetch(`${API}/dpr/scheme/${schemeId}/packages`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        setPackages(d);
        setPackageId(d.some((p: Pkg) => String(p.package_id) === requestedPackageId) ? requestedPackageId : "");
      })
      .catch(() => {});
  }, [requestedPackageId, schemeId]);

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    setLoading(true);
    const pkgQuery = packageId ? `&package_id=${packageId}` : "";
    fetch(`${API}/board/scheme-summary/${schemeId}?month=${month}${pkgQuery}`)
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [schemeId, packageId, month]);

  const rows = data?.summary?.summaryRows || [];
  const overall = rows.find((r) => r.overall);
  const activities = rows
    .filter((r) => !r.overall && r.source !== "capex")
    .map((r, i) => ({ row: r, ...staticsDisplay(r.parent || "", r.activity || r.category || "", i) }))
    .sort((a, b) => a.rank - b.rank);
  const capex = rows.find((r) => r.source === "capex");
  const schemeName = schemes.find((s) => String(s.id) === schemeId)?.name || "";
  const packageName = packages.find((p) => String(p.package_id) === packageId)?.package_name || "";
  const titleLabel = packageName || schemeName;

  // last-FY end label, e.g. month 2026-07 → "31-Mar-26"
  const fyStartYear = (() => {
    const [y, m] = month.split("-").map(Number);
    return m >= 4 ? y : y - 1;
  })();
  const tillLabel = `31-Mar-${String(fyStartYear).slice(2)}`;
  const fyLabel = `FY-${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`;

  // excel-like styling (matches the reference snapshot)
  const th = "border border-slate-400 px-2 py-1.5 text-[11px] font-bold text-center";
  const td = "border border-slate-400 px-2 py-1 text-[11px] text-center";

  const band = (r: Row, label: string, unitLabel: string, isCr = false) => (
    <>
      <tr>
        <td rowSpan={2} className={`${td} bg-sky-300 text-left font-bold text-slate-900`}>{label}</td>
        <td rowSpan={2} className={`${td} bg-orange-200 font-semibold text-slate-900`}>{qty(r.scope)}</td>
        <td className={`${td} bg-slate-100 font-semibold text-slate-700`}>{unitLabel}</td>
        <td className={`${td} bg-orange-100 text-slate-900`}>{qty(r.lastFyActual)}</td>
        <td className={`${td} bg-white text-slate-900`}>{qty(r.ftmPlan)}</td>
        <td className={`${td} bg-teal-100 text-slate-900`}>{qty(r.ftmActual)}</td>
        <td className={`${td} bg-white text-slate-900`}>{qty(r.currentFyPlan)}</td>
        <td className={`${td} bg-lime-100 text-slate-900`}>{qty(r.currentFyActual)}</td>
        <td className={`${td} bg-white text-slate-900`}>{qty(r.cumulativePlan)}</td>
        <td className={`${td} bg-blue-100 text-slate-900`}>{qty(r.cumulativeActual)}</td>
      </tr>
      <tr>
        <td className={`${td} bg-slate-100 font-semibold text-slate-700`}>%</td>
        <td className={`${td} bg-orange-100 text-slate-900`}>{pct(r.lastFyActualPercent)}</td>
        <td className={`${td} bg-white text-slate-900`}>{pct(r.ftmPlanPercent)}</td>
        <td className={`${td} bg-teal-100 text-slate-900`}>{pct(r.ftmActualPercent)}</td>
        <td className={`${td} bg-white text-slate-900`}>{pct(r.currentFyPlanPercent)}</td>
        <td className={`${td} bg-lime-100 text-slate-900`}>{pct(r.currentFyActualPercent)}</td>
        <td className={`${td} bg-white text-slate-900`}>{isCr ? pct(r.cumulativePlanPercent) : pct(r.cumulativePlanPercent)}</td>
        <td className={`${td} bg-blue-100 font-semibold text-slate-900`}>{pct(r.cumulativeActualPercent)}</td>
      </tr>
    </>
  );

  return (
    <div className="min-h-screen bg-white p-6 text-slate-900 print:p-2">
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <button
          onClick={() => router.push("/reports")}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100"
        >
          <ArrowLeft size={13} /> Reports
        </button>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Table2 size={18} className="text-sky-600" /> Statics Report — DPR Progress Summary
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
            className="min-w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-sky-500"
          >
            {schemes.map((s) => (
              <option key={s.id} value={String(s.id)}>#{s.id} · {s.name.substring(0, 55)}</option>
            ))}
          </select>
          <select
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="min-w-[190px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-sky-500"
          >
            <option value="">— All Sub-Projects —</option>
            {packages.map((p) => (
              <option key={p.package_id} value={String(p.package_id)}>
                {p.package_name || `Package ${p.package_id}`}
              </option>
            ))}
          </select>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-sky-500"
          />
          <button
            type="button"
            disabled={exporting || !schemeId}
            onClick={() => runExport("xlsx")}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            <FileSpreadsheet size={13} /> {exporting ? "…" : "Excel"}
          </button>
          <button
            type="button"
            disabled={exporting || !schemeId}
            onClick={() => runExport("pdf")}
            className="flex items-center gap-1.5 rounded-lg border border-sky-600 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            <Download size={13} /> PDF
          </button>
          <button
            type="button"
            disabled={exporting || !schemeId}
            onClick={() => runExport("docx")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={13} /> DOC
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
          >
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Computing weighted summary…</p>}

      {!loading && data && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={`${th} bg-green-700 text-white`}>
                  {titleLabel.substring(0, 28) || "Project"}
                </th>
                <th rowSpan={2} className={`${th} bg-slate-200 text-slate-800`}>Scope</th>
                <th rowSpan={2} className={`${th} bg-slate-200 text-slate-800`}>UOM</th>
                <th className={`${th} bg-slate-200 text-slate-800`}>Till</th>
                <th colSpan={2} className={`${th} bg-slate-200 text-slate-800`}>FTM</th>
                <th colSpan={2} className={`${th} bg-slate-200 text-slate-800`}>{fyLabel}</th>
                <th colSpan={2} className={`${th} bg-slate-200 text-slate-800`}>Cumulative Till</th>
              </tr>
              <tr>
                <th className={`${th} bg-slate-100 text-slate-700`}>{tillLabel}</th>
                <th className={`${th} bg-slate-100 text-slate-700`}>Plan</th>
                <th className={`${th} bg-teal-200 text-slate-800`}>Actual</th>
                <th className={`${th} bg-slate-100 text-slate-700`}>Plan</th>
                <th className={`${th} bg-lime-200 text-slate-800`}>Actual</th>
                <th className={`${th} bg-slate-100 text-slate-700`}>Plan</th>
                <th className={`${th} bg-blue-200 text-slate-800`}>Actual</th>
              </tr>
            </thead>
            <tbody>
              {/* Over All — single % row, weighted */}
              {overall && (
                <tr>
                  <td className={`${td} bg-sky-300 text-left font-bold text-slate-900`}>Over All</td>
                  <td className={`${td} bg-orange-200`} />
                  <td className={`${td} bg-slate-100`} />
                  <td className={`${td} bg-orange-200 font-bold text-slate-900`}>{pct(overall.lastFyActualPercent)}</td>
                  <td className={`${td} bg-white font-bold text-slate-900`}>{pct(overall.ftmPlanPercent)}</td>
                  <td className={`${td} bg-teal-100 font-bold text-slate-900`}>{pct(overall.ftmActualPercent)}</td>
                  <td className={`${td} bg-white font-bold text-slate-900`}>{pct(overall.currentFyPlanPercent)}</td>
                  <td className={`${td} bg-lime-100 font-bold text-slate-900`}>{pct(overall.currentFyActualPercent)}</td>
                  <td className={`${td} bg-white font-bold text-slate-900`}>{pct(overall.cumulativePlanPercent)}</td>
                  <td className={`${td} bg-blue-100 font-bold text-slate-900`}>{pct(overall.cumulativeActualPercent)}</td>
                </tr>
              )}
              {activities.map(({ row, label }) => (
                <SummaryBand key={String(row.id)}>
                  {band(row, label, row.uom || "")}
                </SummaryBand>
              ))}
              {capex && (
                <SummaryBand key="capex">
                  {band(capex, "Capex ( In Cr.)", "Cr.", true)}
                </SummaryBand>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-500">
            As on {data.asOf} · Plan month {data.planMonth} · {data.summary?.financialYearLabel} ·
            Overall Planned {pct(data.plannedPercent)} vs Actual {pct(data.actualPercent)} ·
            Derived from DPR daily actuals via the unified progress service.
          </p>
        </div>
      )}
    </div>
  );
}

// tbody fragment wrapper (keeps <tr> pairs together without extra DOM)
function SummaryBand({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
