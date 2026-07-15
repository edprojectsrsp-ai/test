"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  FileSignature,
  FolderOpen,
  IndianRupee,
  BarChart2,
  Activity,
  ClipboardList,
  Building2,
  ChevronRight,
} from "lucide-react";

const API = "http://localhost:8000/api/v1";

type Scheme = { scheme_id: number; scheme_name: string; scheme_type: string };
type Package = { package_id: number; package_name: string; scheme_id: number };

type ReportCard = {
  name: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  iconCls: string;
  path?: string;
  href?: string;
  badge: string | null;
};

const SCHEME_KEY = "pb-reports-scheme";
const PKG_KEY = "pb-reports-package";

export default function ReportsHub() {
  const router = useRouter();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [schemeId, setSchemeId] = useState("");
  const [packageId, setPackageId] = useState("");

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setSchemes(
            d.map((s: any) => ({
              scheme_id: s.id,
              scheme_name: s.name,
              scheme_type: s.type,
            })),
          );
          // restore last selection so going "back" keeps the scheme picked
          try {
            const saved = localStorage.getItem(SCHEME_KEY);
            if (saved && d.some((s: any) => String(s.id) === saved)) setSchemeId(saved);
          } catch { /* storage blocked */ }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!schemeId) return;
    try { localStorage.setItem(SCHEME_KEY, schemeId); } catch { /* ignore */ }
    fetch(`${API}/dpr/scheme/${schemeId}/packages`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setPackages(d);
          if (d.length > 0) {
            let pick = String(d[0].package_id);
            try {
              const savedPkg = localStorage.getItem(PKG_KEY);
              if (savedPkg && d.some((p: any) => String(p.package_id) === savedPkg)) pick = savedPkg;
            } catch { /* ignore */ }
            setPackageId(pick);
          }
        }
      })
      .catch(() => {});
  }, [schemeId]);

  useEffect(() => {
    if (!packageId) return;
    try { localStorage.setItem(PKG_KEY, packageId); } catch { /* ignore */ }
  }, [packageId]);

  const go = (path: string, requireScheme = true, usePackage = false) => {
    if (requireScheme && !schemeId) return;
    if (path === "/statics") {
      const packageQuery = packageId ? `&package_id=${encodeURIComponent(packageId)}` : "";
      router.push(`/reports/statics?id=${encodeURIComponent(schemeId)}${packageQuery}`);
      return;
    }
    const id = usePackage ? packageId : schemeId;
    router.push(`/reports${path}?id=${encodeURIComponent(id)}`);
  };

  const schemeSelected = !!schemeId;

  const schemeReports: ReportCard[] = [
    {
      name: "S-Curve",
      desc: "Cumulative plan vs actual progress with forecast",
      icon: TrendingUp,
      color: "border-cyan-500/40 hover:bg-cyan-500/10",
      iconCls: "text-cyan-400",
      path: "/s-curve",
      badge: "Live",
    },
    {
      name: "Physical Progress",
      desc: "9-column activity-wise progress table",
      icon: Activity,
      color: "border-emerald-500/40 hover:bg-emerald-500/10",
      iconCls: "text-emerald-400",
      path: "/table",
      badge: null,
    },
    {
      name: "DPR Analysis",
      desc: "Daily progress report with monthly summary",
      icon: ClipboardList,
      color: "border-amber-500/40 hover:bg-amber-500/10",
      iconCls: "text-amber-400",
      path: "/dpr",
      badge: null,
    },
    {
      name: "Statics Report",
      desc: "DPR progress summary grid — Till last FY / FTM / FY / Cumulative, qty + % per activity with Over All & Capex rows",
      icon: BarChart2,
      color: "border-sky-500/40 hover:bg-sky-500/10",
      iconCls: "text-sky-400",
      path: "/statics",
      badge: "New",
    },
  ];

  const fyNow = (() => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String(y + 1).slice(2)}`;
  })();

  const portfolioReports: ReportCard[] = [
    {
      name: "MoS CAPEX Format",
      desc: "Monthly overview of CAPEX projects including expenditure, progress and delays",
      icon: IndianRupee,
      color: "border-violet-500/40 hover:bg-violet-500/10",
      iconCls: "text-violet-400",
      href: "/reports/mos-capex",
      badge: "Live",
    },
    {
      name: `Physical & Financial Progress Report of CAPEX Projects for FY ${fyNow}`,
      desc: "11-column format — cost, approval/award dates, completion, physical progress i/ii/iii, CAPEX expenditure",
      icon: BarChart2,
      color: "border-fuchsia-500/40 hover:bg-fuchsia-500/10",
      iconCls: "text-fuchsia-400",
      href: "/reports/mos-capex?section=physical-financial",
      badge: "Live",
    },
    {
      name: "CAPEX PMC Report",
      desc: "Project-wise PMC report with CAPEX plan vs expenditure detail",
      icon: IndianRupee,
      color: "border-orange-500/40 hover:bg-orange-500/10",
      iconCls: "text-orange-400",
      href: "/reports/pmc?focus=capex",
      badge: null,
    },
    {
      name: "Physical Progress PMC",
      desc: "Project-wise PMC reports with physical and financial progress details",
      icon: Activity,
      color: "border-rose-500/40 hover:bg-rose-500/10",
      iconCls: "text-rose-400",
      href: "/reports/pmc",
      badge: "Live",
    },
    {
      name: "Statics Report",
      desc: "DPR progress summary grid — pick project & sub-project, current month preselected; qty + % per activity with Over All & Capex rows",
      icon: BarChart2,
      color: "border-sky-500/40 hover:bg-sky-500/10",
      iconCls: "text-sky-400",
      href: "/reports/statics",
      badge: "New",
    },
    {
      name: "Report Studio",
      desc: "Build, customise and export your own report formats",
      icon: FileSignature,
      color: "border-cyan-500/40 hover:bg-cyan-500/10",
      iconCls: "text-cyan-400",
      href: "/report-studio",
      badge: "Studio",
    },
    {
      name: "Package-N Status Report",
      desc: "Formatted status report - open, print, or edit",
      icon: FileSignature,
      color: "border-indigo-500/40 hover:bg-indigo-500/10",
      iconCls: "text-indigo-400",
      href: "/reports/package-n",
      badge: null,
    },
    {
      name: "Report Documents",
      desc: "Upload, edit and export .docx report files",
      icon: FolderOpen,
      color: "border-sky-500/40 hover:bg-sky-500/10",
      iconCls: "text-sky-400",
      href: "/reports/documents",
      badge: null,
    },
    {
      name: "Corporate AMR",
      desc: "74-scheme AMR master grid with filter/export",
      icon: Building2,
      color: "border-teal-500/40 hover:bg-teal-500/10",
      iconCls: "text-teal-400",
      href: "/progress/corporate",
      badge: null,
    },
  ];

  return (
    <div className="min-h-screen p-6 text-[var(--ink)]">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--ink)]">
          <BarChart2 className="h-7 w-7 text-[var(--steel)]" />
          Reports Command Centre
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-3)]">
          Select a scheme to generate project-wise reports
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] p-4">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
            Scheme
          </label>
          <select
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
            className="min-w-[300px] rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]"
          >
            <option value="">- Select Scheme -</option>
            {schemes.map((s) => (
              <option key={s.scheme_id} value={String(s.scheme_id)}>
                #{s.scheme_id} - {s.scheme_name.substring(0, 60)}
              </option>
            ))}
          </select>
        </div>

        {packages.length > 0 && (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
              Package
            </label>
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="min-w-[200px] rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--steel)]"
            >
              {packages.map((p) => (
                <option key={p.package_id} value={String(p.package_id)}>
                  {p.package_name || `Package ${p.package_id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {schemeSelected && (
          <div className="ml-auto flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-400">Scheme selected - reports ready</span>
          </div>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[var(--ink-3)]">
          <Activity size={14} className="text-[var(--steel)]" />
          Project-Wise Reports
          {!schemeSelected && (
            <span className="ml-2 font-normal text-[var(--ink-4)]">
              (select a scheme above)
            </span>
          )}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {schemeReports.map((report) => {
            const Icon = report.icon;
            const disabled = !schemeSelected;
            return (
              <button
                key={report.name}
                onClick={() => go(report.path || "")}
                disabled={disabled}
                className={`flex items-start gap-4 rounded-xl border p-5 text-left transition-all ${
                  disabled
                    ? "cursor-not-allowed border-[var(--line)] opacity-40"
                    : `${report.color} cursor-pointer`
                }`}
              >
                <div
                  className={`shrink-0 rounded-lg bg-[var(--panel-2)] p-2.5 ${report.iconCls}`}
                >
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {report.name}
                    </span>
                    {report.badge && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                        {report.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--ink-3)]">{report.desc}</p>
                </div>
                {!disabled && (
                  <ChevronRight
                    size={16}
                    className="mt-1 shrink-0 text-[var(--ink-4)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-[var(--ink-3)]">
          <Building2 size={14} className="text-violet-400" />
          Portfolio-Level Reports
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {portfolioReports.map((report) => {
            const Icon = report.icon;
            return (
              <button
                key={report.name}
                onClick={() => router.push(report.href || "/reports")}
                className={`flex items-start gap-4 rounded-xl border p-5 text-left transition-all ${report.color}`}
              >
                <div
                  className={`shrink-0 rounded-lg bg-[var(--panel-2)] p-2.5 ${report.iconCls}`}
                >
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {report.name}
                  </span>
                  <p className="mt-1 text-[11px] text-[var(--ink-3)]">{report.desc}</p>
                </div>
                <ChevronRight
                  size={16}
                  className="mt-1 shrink-0 text-[var(--ink-4)]"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
