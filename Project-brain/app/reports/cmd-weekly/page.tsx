"use client";

/**
 * CMD Weekly Report
 * -----------------
 * Renders the official "Execution Details" form (one form per package) for
 * schemes whose cost is above Rs 100 Cr (closed schemes excluded).
 *
 * All form values come from the backend `cmd-weekly-form` endpoint, which does
 * the field mapping / % math:
 *   - Date of award of contract    = contract effective date
 *   - Original date of completion  = contract scheduled completion date
 *   - Overall Physical Progress    = weighted plan% vs actual%
 *   - CAPEX BE (full year) / Actual (this FY)
 *   - Financial Target % = (last-FY + capex plan till month) / gross cost
 *   - Financial Actual % = (last-FY + capex actual till month) / gross cost
 *   - Progress-of-Package rows     = per-activity % progress (plan vs actual)
 *
 * Every cell is left BLANK where the backend returns null.
 *
 * View / Print + Download (Excel / PDF) via the shared export engine.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Download, Loader2, CalendarClock, RefreshCw } from "lucide-react";
import { exportCmdWeekly } from "@/lib/export";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";
const COST_THRESHOLD_CR = 100;
const PLANT_NAME = "Rourkela Steel Plant (RSP), SAIL";

type SchemeCard = {
  id: number;
  name: string;
  type: string;
  status: string;
  cost_cr: number | null;
  sanctioned_cost_cr: number | null;
};

type ActivityRow = {
  activity_name: string;
  scope: number | null;
  mtd_plan_pct: number | null;
  mtd_actual_pct: number | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
};

type PackageForm = {
  package_id: number;
  package_name: string;
  package_cost_cr: number | null;
  gross_cost_cr: number | null;
  award_date: string | null;
  original_completion_date: string | null;
  physical_plan_pct: number | null;
  physical_actual_pct: number | null;
  capex_be_fy_cr: number | null;
  capex_actual_fy_cr: number | null;
  financial_target_pct: number | null;
  financial_actual_pct: number | null;
  activities: ActivityRow[];
};

type SchemeForm = {
  scheme_id: number;
  scheme_name: string;
  status: string;
  gross_cost_cr: number | null;
  original_cost_cr: number | null;
  revised_cost_cr: number | null;
  capex_be_fy_cr: number | null;
  capex_actual_fy_cr: number | null;
  financial_target_pct: number | null;
  financial_actual_pct: number | null;
  packages: PackageForm[];
};

type Row = { scheme: SchemeCard; cost: number; form: SchemeForm | null; loaded: boolean };

const schemeCost = (s: SchemeCard) => Math.max(s.cost_cr ?? 0, s.sanctioned_cost_cr ?? 0);

/** number → string; blank for null/NaN (so empty cells stay empty) */
const nf = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(v)
    ? ""
    : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${nf(v)}%`);
const dstr = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

export default function CmdWeeklyReportPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const monthLabel = useMemo(
    () => new Date(`${month}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    [month],
  );
  const monthShort = useMemo(() => {
    const d = new Date(`${month}-01`);
    return `${d.toLocaleDateString("en-IN", { month: "long" })}'${String(d.getFullYear()).slice(2)}`;
  }, [month]);
  const fyLabel = useMemo(() => {
    const d = new Date(`${month}-01`);
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  }, [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cards: SchemeCard[] = await fetch(`${API}/dashboard/scheme-cards`).then((r) => r.json());
      // candidates = ongoing schemes only; the >100 Cr filter is applied on the
      // GROSS cost returned by cmd-weekly-form (falls back to est/sanctioned).
      const ongoing = (Array.isArray(cards) ? cards : []).filter(
        (s) => (s.status || "").toLowerCase() === "ongoing",
      );

      const withForms = await Promise.all(
        ongoing.map(async (s) => {
          try {
            const form: SchemeForm = await fetch(
              `${API}/dashboard/cmd-weekly-form?scheme_id=${s.id}&month=${month}`,
            ).then((r) => r.json());
            const gross = form?.gross_cost_cr ?? schemeCost(s);
            return { scheme: s, cost: gross, form, loaded: true } as Row;
          } catch {
            return { scheme: s, cost: schemeCost(s), form: null, loaded: true } as Row;
          }
        }),
      );

      const filled = withForms
        .filter((r) => (r.cost ?? 0) > COST_THRESHOLD_CR)
        .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
      setRows(filled);
    } catch (e: any) {
      setError(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCost = useMemo(() => rows.reduce((s, r) => s + r.cost, 0), [rows]);

  /** one form per package (multi-package scheme → multiple forms) */
  const forms = useMemo(() => {
    const out: { scheme: SchemeForm; cost: number; pkg: PackageForm | null }[] = [];
    for (const r of rows) {
      if (!r.form) {
        out.push({
          scheme: { scheme_id: r.scheme.id, scheme_name: r.scheme.name, status: r.scheme.status } as SchemeForm,
          cost: r.cost,
          pkg: null,
        });
        continue;
      }
      if (!r.form.packages || r.form.packages.length === 0) {
        out.push({ scheme: r.form, cost: r.cost, pkg: null });
      } else {
        for (const p of r.form.packages) out.push({ scheme: r.form, cost: r.cost, pkg: p });
      }
    }
    return out;
  }, [rows]);

  const buildPayload = useCallback(() => {
    const table_sections: { title: string; headers: string[]; rows: string[][] }[] = [];
    forms.forEach((f, i) => {
      const s = f.scheme;
      const p = f.pkg;
      const name = p?.package_name || s.scheme_name;
      // Synopsis
      table_sections.push({
        title: `${i + 1}. ${name} — Synopsis of Package`,
        headers: [
          "i. Original / ii. Revised Cost (Rs Cr)",
          "Date of award of contract",
          "Original date of completion",
          `Physical % ${monthShort} — Target`,
          `Physical % ${monthShort} — Actual`,
          `CAPEX FY ${fyLabel} — BE`,
          `CAPEX FY ${fyLabel} — Actual`,
          "Financial % — Target",
          "Financial % — Actual",
        ],
        rows: [[
          `i. ${nf(p?.gross_cost_cr ?? p?.package_cost_cr ?? s.original_cost_cr ?? f.cost)}\nii.`,
          dstr(p?.award_date ?? null),
          dstr(p?.original_completion_date ?? null),
          pct(p?.physical_plan_pct),
          pct(p?.physical_actual_pct),
          nf(p?.capex_be_fy_cr),
          nf(p?.capex_actual_fy_cr),
          pct(p?.financial_target_pct),
          pct(p?.financial_actual_pct),
        ]],
      });
      // Progress of Package (%)
      table_sections.push({
        title: `${i + 1}. ${name} — Progress of Package`,
        headers: [
          "Brief Description of Progress",
          "Total Scope (Nos/CuM/MT)",
          `% Physical Progress during ${monthShort} — Plan`,
          `% Physical Progress during ${monthShort} — Actual`,
          `Total % progress till ${monthShort} — Plan`,
          `Total % progress till ${monthShort} — Actual`,
          "Reasons of Shortfall (if any)",
          "Action taken",
        ],
        rows:
          !p || p.activities.length === 0
            ? [["", "", "", "", "", "", "", ""]]
            : p.activities.map((a) => [
                a.activity_name,
                nf(a.scope),
                pct(a.mtd_plan_pct),
                pct(a.mtd_actual_pct),
                pct(a.cum_plan_pct),
                pct(a.cum_actual_pct),
                "",
                "",
              ]),
      });
    });

    return {
      title: "CMD Weekly Report",
      project_label: PLANT_NAME,
      month_label: monthLabel,
      header_lines: [
        `Execution Details — ${PLANT_NAME}`,
        `Schemes / Projects above Rs ${COST_THRESHOLD_CR} Cr — Reporting month: ${monthLabel}`,
      ],
      kpi_rows: [
        ["Reporting month", monthLabel],
        ["Cost filter", `> Rs ${COST_THRESHOLD_CR} Cr (closed excluded)`],
        ["No. of packages", String(forms.length)],
        ["Total scheme cost (Rs Cr)", nf(totalCost)],
      ],
      table_sections,
    };
  }, [forms, monthLabel, monthShort, fyLabel, totalCost]);

  const runExport = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await exportCmdWeekly({ format, month, payload: buildPayload() });
    } catch (e: any) {
      alert(e?.message || "Download failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="min-h-screen p-6 text-[var(--ink)] print:bg-white print:p-0 print:text-black">
      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <button
          onClick={() => router.push("/reports")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
        >
          <ArrowLeft size={16} /> Reports
        </button>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]"
          />
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
        >
          <RefreshCw size={16} /> Refresh
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--panel-2)]"
          >
            <Printer size={16} /> View / Print
          </button>
          <button
            onClick={() => runExport("xlsx")}
            disabled={!!exporting || loading}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {exporting === "xlsx" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Excel
          </button>
          <button
            onClick={() => runExport("pdf")}
            disabled={!!exporting || loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--panel-2)] disabled:opacity-50"
          >
            {exporting === "pdf" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            PDF
          </button>
        </div>
      </div>

      {/* Heading */}
      <div className="mb-6 print:mb-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold print:text-black">
          <CalendarClock className="h-7 w-7 text-emerald-400 print:hidden" />
          CMD Weekly Report
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-3)] print:text-black">
          {PLANT_NAME} &middot; Schemes / Projects above Rs {COST_THRESHOLD_CR} Cr &middot; Reporting month: {monthLabel}
        </p>
        {!loading && (
          <p className="mt-1 text-xs text-[var(--ink-4)] print:text-black">
            {forms.length} package form(s) &middot; Total scheme cost Rs {nf(totalCost)} Cr
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--ink-3)]">
          <Loader2 className="animate-spin" size={18} /> Loading schemes above Rs {COST_THRESHOLD_CR} Cr…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}
      {!loading && !error && forms.length === 0 && (
        <div className="rounded-lg border border-[var(--line)] p-6 text-sm text-[var(--ink-3)]">
          No ongoing schemes above Rs {COST_THRESHOLD_CR} Cr found.
        </div>
      )}

      <div className="space-y-10">
        {forms.map((f, i) => (
          <ExecutionForm
            key={`${f.scheme.scheme_id}-${f.pkg?.package_id ?? "x"}-${i}`}
            index={i + 1}
            plant={PLANT_NAME}
            scheme={f.scheme}
            cost={f.cost}
            pkg={f.pkg}
            monthShort={monthShort}
            fyLabel={fyLabel}
          />
        ))}
      </div>
    </div>
  );
}

function ExecutionForm(props: {
  index: number;
  plant: string;
  scheme: SchemeForm;
  cost: number;
  pkg: PackageForm | null;
  monthShort: string;
  fyLabel: string;
}) {
  const { index, plant, scheme, cost, pkg, monthShort, fyLabel } = props;
  const packageName = pkg?.package_name || scheme.scheme_name;

  const bd = "border border-[var(--line)] print:border-black";
  const lbl = "bg-[var(--panel-2)] font-semibold print:bg-gray-100";
  const hd = "bg-[var(--panel-2)] text-center align-middle font-semibold print:bg-gray-100";
  const cell = "px-2 py-1 text-[11px] align-top";

  return (
    <section className="break-inside-avoid overflow-x-auto rounded-lg border border-[var(--line)] print:border-black">
      <table className="w-full min-w-[900px] border-collapse text-[11px]">
        <tbody>
          <tr>
            <td colSpan={9} className={`${bd} ${cell} bg-[var(--steel-soft)] text-center text-sm font-bold print:bg-gray-200`}>
              Execution Details
            </td>
          </tr>
          <tr>
            <td className={`${bd} ${cell} ${lbl}`}>Name of Plant:</td>
            <td colSpan={8} className={`${bd} ${cell}`}>{plant}</td>
          </tr>
          <tr>
            <td className={`${bd} ${cell} ${lbl}`}>Name of Package</td>
            <td colSpan={8} className={`${bd} ${cell}`}>
              {packageName}
              {packageName !== scheme.scheme_name && (
                <span className="text-[var(--ink-4)] print:text-black"> &nbsp;(Scheme: {scheme.scheme_name})</span>
              )}
            </td>
          </tr>

          {/* Synopsis */}
          <tr>
            <td colSpan={9} className={`${bd} ${cell} bg-[var(--panel-2)] text-center font-bold print:bg-gray-100`}>
              Synopsis of Package
            </td>
          </tr>
          <tr>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>i. Original Cost<br />ii. Revised cost<br />(Rs Cr)</td>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>Date of award of contract</td>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>i. Original date of completion<br />ii. Revised date of completion<br />iii. No. of Time Extensions<br />iv. Delay (days)</td>
            <td colSpan={2} className={`${bd} ${cell} ${hd}`}>Overall Physical Progress till the month {monthShort}</td>
            <td colSpan={2} className={`${bd} ${cell} ${hd}`}>CAPEX progress during FY {fyLabel} (Rs Cr)</td>
            <td colSpan={2} className={`${bd} ${cell} ${hd}`}>Overall Financial Progress till the month {monthShort} (%)</td>
          </tr>
          <tr>
            <td className={`${bd} ${cell} ${hd}`}>% Target</td>
            <td className={`${bd} ${cell} ${hd}`}>% Actual</td>
            <td className={`${bd} ${cell} ${hd}`}>BE target</td>
            <td className={`${bd} ${cell} ${hd}`}>Actual</td>
            <td className={`${bd} ${cell} ${hd}`}>Total Target till month</td>
            <td className={`${bd} ${cell} ${hd}`}>Total Actual till month</td>
          </tr>
          <tr>
            <td className={`${bd} ${cell}`}>i. {nf(pkg?.gross_cost_cr ?? pkg?.package_cost_cr ?? scheme.original_cost_cr ?? cost)}<br />ii.</td>
            <td className={`${bd} ${cell}`}>{dstr(pkg?.award_date ?? null) || " "}</td>
            <td className={`${bd} ${cell}`}>{pkg?.original_completion_date ? `i. ${dstr(pkg.original_completion_date)}` : " "}</td>
            <td className={`${bd} ${cell} text-right`}>{pct(pkg?.physical_plan_pct) || " "}</td>
            <td className={`${bd} ${cell} text-right`}>{pct(pkg?.physical_actual_pct) || " "}</td>
            <td className={`${bd} ${cell} text-right`}>{nf(pkg?.capex_be_fy_cr) || " "}</td>
            <td className={`${bd} ${cell} text-right`}>{nf(pkg?.capex_actual_fy_cr) || " "}</td>
            <td className={`${bd} ${cell} text-right`}>{pct(pkg?.financial_target_pct) || " "}</td>
            <td className={`${bd} ${cell} text-right`}>{pct(pkg?.financial_actual_pct) || " "}</td>
          </tr>

          {/* Progress of Package */}
          <tr>
            <td colSpan={9} className={`${bd} ${cell} bg-[var(--panel-2)] text-center font-bold print:bg-gray-100`}>
              Progress of Package
            </td>
          </tr>
          <tr>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>Brief Description of Progress</td>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>Total Scope (Nos/CuM/MT)</td>
            <td colSpan={2} className={`${bd} ${cell} ${hd}`}>% Physical Progress during {monthShort}</td>
            <td colSpan={2} className={`${bd} ${cell} ${hd}`}>Total % progress till month {monthShort}</td>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>Reasons of Shortfall (if any)</td>
            <td rowSpan={2} className={`${bd} ${cell} ${hd}`}>Action taken</td>
          </tr>
          <tr>
            <td className={`${bd} ${cell} ${hd}`}>Plan</td>
            <td className={`${bd} ${cell} ${hd}`}>Actual</td>
            <td className={`${bd} ${cell} ${hd}`}>Plan</td>
            <td className={`${bd} ${cell} ${hd}`}>Actual</td>
          </tr>
          {!pkg || pkg.activities.length === 0 ? (
            <tr>
              <td colSpan={8} className={`${bd} ${cell}`}>&nbsp;</td>
            </tr>
          ) : (
            pkg.activities.map((a, idx) => (
              <tr key={idx}>
                <td className={`${bd} ${cell}`}>{a.activity_name}</td>
                <td className={`${bd} ${cell} text-right`}>{nf(a.scope)}</td>
                <td className={`${bd} ${cell} text-right`}>{pct(a.mtd_plan_pct)}</td>
                <td className={`${bd} ${cell} text-right`}>{pct(a.mtd_actual_pct)}</td>
                <td className={`${bd} ${cell} text-right`}>{pct(a.cum_plan_pct)}</td>
                <td className={`${bd} ${cell} text-right`}>{pct(a.cum_actual_pct)}</td>
                <td className={`${bd} ${cell}`}>&nbsp;</td>
                <td className={`${bd} ${cell}`}>&nbsp;</td>
              </tr>
            ))
          )}

          {/* Critical path + Hindrance */}
          <tr>
            <td colSpan={9} className={`${bd} ${cell} ${lbl}`}>List of critical Path items and Status</td>
          </tr>
          <tr>
            <td colSpan={9} className={`${bd} ${cell}`} style={{ height: 44 }}>&nbsp;</td>
          </tr>
          <tr>
            <td colSpan={9} className={`${bd} ${cell} ${lbl}`}>Hindrance, if any</td>
          </tr>
          <tr>
            <td colSpan={9} className={`${bd} ${cell}`} style={{ height: 44 }}>&nbsp;</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
