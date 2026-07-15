"use client";

/**
 * Corporate AMR Master — live-computed grid of all schemes.
 * Source: GET /api/v1/progress/corporate/amr
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, BarChart2, Building2,
  CheckCircle2, Clock, Filter, Loader2, RefreshCw, Search,
  TrendingDown, TrendingUp,
} from "lucide-react";

const API = "http://localhost:8000/api/v1";

type KPIs = {
  total_schemes: number; ongoing: number; under_tendering: number; closed: number;
  total_cost_cr: number; avg_delay_months: number;
};

type SchemeRow = {
  scheme_id: number;
  scheme_name: string;
  scheme_type: string;
  current_status: string;
  total_cost_cr: number;
  planned_completion_date: string | null;
  scheme_owner_name: string | null;
  delay_months: number;
  delay_category: string;
  delay_color: string;
  physical_pct: number;
  contractor_name: string | null;
  loa_date: string | null;
  contract_value_cr: number | null;
  tender_status: string | null;
  awarded_value_cr: number | null;
};

const statusLabel: Record<string, string> = {
  ongoing:          "Ongoing",
  under_tendering:  "Under Tendering",
  closed:           "Closed",
  under_formulation:"Under Formulation",
};

const statusColor: Record<string, string> = {
  ongoing:          "bg-green-500/20 text-green-400 border-green-500/30",
  under_tendering:  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  closed:           "bg-zinc-700 text-zinc-400 border-zinc-600",
  under_formulation:"bg-amber-500/20 text-amber-400 border-amber-500/30",
};

export default function CorporateAMRPage() {
  const [kpis, setKpis]           = useState<KPIs | null>(null);
  const [rows, setRows]           = useState<SchemeRow[]>([]);
  const [filtered, setFiltered]   = useState<SchemeRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("all");

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/progress/corporate/kpis`).then(r => r.json()),
      fetch(`${API}/progress/corporate/amr`).then(r => r.json()),
    ])
      .then(([k, r]) => {
        setKpis(k);
        // Corporate AMR report covers corporate schemes only.
        const corp = (Array.isArray(r) ? r : []).filter(
          (row: SchemeRow) => row.scheme_type === "corporate",
        );
        setRows(corp);
        setFiltered(corp);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Apply filters
  useEffect(() => {
    let f = rows;
    if (search) f = f.filter(r => r.scheme_name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== "all") f = f.filter(r => r.current_status === statusFilter);
    setFiltered(f);
  }, [search, statusFilter, rows]);

  const fmt = (v: number | null | undefined) =>
    v != null ? `₹ ${Number(v).toFixed(1)} Cr` : "—";
  const fmtD = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—";

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-1 flex items-center gap-3 text-4xl font-bold">
            <BarChart2 className="h-8 w-8 text-sky-400" />
            Corporate AMR Master
          </h1>
          <p className="text-zinc-400">Live-computed from DB — all 74 schemes across cost, progress & delay</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* KPI cards */}
      {kpis && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total Schemes",     value: kpis.total_schemes,    icon: Building2,    color: "text-zinc-300" },
            { label: "Ongoing",           value: kpis.ongoing,          icon: Activity,     color: "text-green-400" },
            { label: "Under Tendering",   value: kpis.under_tendering,  icon: Clock,        color: "text-blue-400" },
            { label: "Closed",            value: kpis.closed,           icon: CheckCircle2, color: "text-zinc-500" },
            { label: "Total CAPEX (Cr)",  value: `₹ ${kpis.total_cost_cr?.toFixed(0)}`, icon: TrendingUp, color: "text-amber-300" },
            { label: "Avg Delay (mo)",    value: kpis.avg_delay_months, icon: TrendingDown, color: kpis.avg_delay_months > 3 ? "text-red-400" : "text-zinc-300" },
          ].map(c => (
            <div key={c.label} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                <c.icon className="h-3.5 w-3.5" /> {c.label}
              </div>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search schemes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-48 bg-transparent text-sm outline-none placeholder-zinc-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatus(e.target.value)}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-sky-400"
        >
          <option value="all">All statuses</option>
          <option value="ongoing">Ongoing</option>
          <option value="under_tendering">Under Tendering</option>
          <option value="closed">Closed</option>
        </select>
        <span className="ml-2 text-sm text-zinc-500">{filtered.length} corporate schemes</span>
      </div>

      {/* AMR Grid */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sky-400">
          <Loader2 className="h-6 w-6 animate-spin" /> Loading corporate AMR…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Scheme Name</th>
                <th className="px-4 py-3 text-center">Type</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Cost (Cr)</th>
                <th className="px-4 py-3 text-center">Sched. Comp.</th>
                <th className="px-4 py-3 text-center">Physical %</th>
                <th className="px-4 py-3 text-center">Delay</th>
                <th className="px-4 py-3 text-left">Contractor</th>
                <th className="px-4 py-3 text-right">Contract Value</th>
                <th className="px-4 py-3 text-left">Tender Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-zinc-500">
                    No schemes match the current filters.
                  </td>
                </tr>
              ) : filtered.map((r, idx) => (
                <motion.tr
                  key={r.scheme_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(idx * 0.01, 0.3) }}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="px-4 py-3 text-zinc-500">{idx + 1}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <a
                      href={`/view/${r.scheme_id}`}
                      className="font-medium text-sky-300 hover:underline"
                    >
                      {r.scheme_name}
                    </a>
                    {r.scheme_owner_name && (
                      <p className="text-xs text-zinc-500">{r.scheme_owner_name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 capitalize">
                      {r.scheme_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusColor[r.current_status] || "bg-zinc-700 text-zinc-400"}`}>
                      {statusLabel[r.current_status] || r.current_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-300">
                    {fmt(r.total_cost_cr)}
                  </td>
                  <td className="px-4 py-3 text-center text-zinc-400">{fmtD(r.planned_completion_date)}</td>
                  <td className="px-4 py-3 text-center">
                    {r.physical_pct > 0 ? (
                      <div className="flex flex-col items-center gap-1">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                            style={{ width: `${Math.min(r.physical_pct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-cyan-300">{Number(r.physical_pct).toFixed(1)}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.delay_months > 0 ? (
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-bold"
                        style={{ color: r.delay_color, borderColor: r.delay_color + "40", backgroundColor: r.delay_color + "15" }}
                      >
                        +{r.delay_months}mo
                      </span>
                    ) : (
                      <span className="text-xs text-green-500">On time</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {r.contractor_name || <span className="text-zinc-600">—</span>}
                    {r.loa_date && <p className="text-xs text-zinc-500">LOA: {fmtD(r.loa_date)}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-300">{fmt(r.contract_value_cr)}</td>
                  <td className="px-4 py-3">
                    {r.tender_status ? (
                      <span className="text-xs capitalize text-blue-400">{r.tender_status.replace(/_/g, " ")}</span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
