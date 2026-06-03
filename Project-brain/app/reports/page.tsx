"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, Table2, FileText, Bot, FileSignature,
  FolderOpen, IndianRupee, BarChart2, Activity,
  ClipboardList, Building2, AlertTriangle, ChevronRight,
} from "lucide-react";

const API = "http://localhost:8002/api/v1";

type Scheme = { scheme_id: number; scheme_name: string; scheme_type: string };
type Package = { package_id: number; package_name: string; scheme_id: number };

export default function ReportsHub() {
  const router = useRouter();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [schemeId, setSchemeId] = useState<string>("");
  const [packageId, setPackageId] = useState<string>("");

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setSchemes(d.map((s: any) => ({ scheme_id: s.id, scheme_name: s.name, scheme_type: s.type })));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!schemeId) { setPackages([]); setPackageId(""); return; }
    fetch(`${API}/dpr/scheme/${schemeId}/packages`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setPackages(d);
          if (d.length > 0) setPackageId(String(d[0].package_id));
        }
      })
      .catch(() => {});
  }, [schemeId]);

  const go = (path: string, requireScheme = true, usePackage = false) => {
    if (requireScheme && !schemeId) return;
    const id = usePackage ? packageId : schemeId;
    router.push(`/reports${path}?id=${encodeURIComponent(id)}`);
  };

  const schemeSelected = !!schemeId;

  const schemeReports = [
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
      name: "CAPEX Report",
      desc: "Budget vs RE vs actual expenditure analysis",
      icon: IndianRupee,
      color: "border-violet-500/40 hover:bg-violet-500/10",
      iconCls: "text-violet-400",
      path: "/table",
      badge: null,
    },
    {
      name: "AI Analytics",
      desc: "AI-generated insights from live data",
      icon: Bot,
      color: "border-fuchsia-500/40 hover:bg-fuchsia-500/10",
      iconCls: "text-fuchsia-400",
      path: "/ai",
      badge: "AI",
    },
  ];

  const portfolioReports = [
    {
      name: "Package-N Status Report",
      desc: "Formatted status report — open, print, or edit",
      icon: FileSignature,
      color: "border-indigo-500/40 hover:bg-indigo-500/10",
      iconCls: "text-indigo-400",
      href: "/reports/package-n",
    },
    {
      name: "Report Documents",
      desc: "Upload, edit and export .docx report files",
      icon: FolderOpen,
      color: "border-sky-500/40 hover:bg-sky-500/10",
      iconCls: "text-sky-400",
      href: "/reports/documents",
    },
    {
      name: "Corporate AMR",
      desc: "74-scheme AMR master grid with filter/export",
      icon: Building2,
      color: "border-teal-500/40 hover:bg-teal-500/10",
      iconCls: "text-teal-400",
      href: "/progress/corporate",
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart2 className="w-7 h-7 text-cyan-400" />
          Reports Command Centre
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Select a scheme to generate project-wise reports</p>
      </div>

      {/* Selectors */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Scheme</label>
          <select
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/60 min-w-[300px]"
          >
            <option value="">— Select Scheme —</option>
            {schemes.map((s) => (
              <option key={s.scheme_id} value={String(s.scheme_id)}>
                #{s.scheme_id} · {s.scheme_name.substring(0, 60)}
              </option>
            ))}
          </select>
        </div>

        {packages.length > 0 && (
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Package</label>
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500/60 min-w-[200px]"
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
          <div className="flex items-center gap-2 ml-auto">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400">Scheme selected — reports ready</span>
          </div>
        )}
      </div>

      {/* Project-Wise Reports */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" /> Project-Wise Reports
          {!schemeSelected && <span className="text-zinc-600 font-normal ml-2">(select a scheme above)</span>}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {schemeReports.map((r) => {
            const Icon = r.icon;
            const disabled = !schemeSelected;
            return (
              <button
                key={r.name}
                onClick={() => go(r.path)}
                disabled={disabled}
                className={`text-left rounded-xl border p-5 transition-all flex items-start gap-4 ${disabled ? "border-zinc-800 opacity-40 cursor-not-allowed" : `${r.color} cursor-pointer`}`}
              >
                <div className={`rounded-lg p-2.5 bg-zinc-800 shrink-0 ${r.iconCls}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm">{r.name}</span>
                    {r.badge && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400">{r.badge}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">{r.desc}</p>
                </div>
                {!disabled && <ChevronRight size={16} className="text-zinc-600 shrink-0 mt-1" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Portfolio / Portfolio-wide reports */}
      <div>
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Building2 size={14} className="text-violet-400" /> Portfolio-Level Reports
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {portfolioReports.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.name}
                onClick={() => router.push(r.href)}
                className={`text-left rounded-xl border p-5 transition-all flex items-start gap-4 ${r.color}`}
              >
                <div className={`rounded-lg p-2.5 bg-zinc-800 shrink-0 ${r.iconCls}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-white text-sm">{r.name}</span>
                  <p className="text-[11px] text-zinc-400 mt-1">{r.desc}</p>
                </div>
                <ChevronRight size={16} className="text-zinc-600 shrink-0 mt-1" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
