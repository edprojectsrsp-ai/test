"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Settings2, Search, ArrowUpDown, Eye,
  Filter, RefreshCw, Package, AlertCircle
} from "lucide-react";
import Link from "next/link";

const API_URL = "http://localhost:8000/api/v1/schemes/all";

interface Scheme {
  scheme_id: number;
  scheme_name: string;
  scheme_type: string;
  current_status: string;
  estimated_cost_cr: number;
  sanctioned_cost_cr: number;
  anticipated_cost_cr: number;
  amr_no: string;
  wbs_element: string;
  has_multiple_packages: boolean;
  scheme_owner_name: string;
  package_count: number;
  total_contract_value_cr: number;
  scheduled_completion: string;
  expected_completion: string;
  effective_date: string;
  delay_status: string;
  delay_days: number;
  // Backward-compat aliases
  id: number;
  status: string;
  estimated_cost: number;
}

export default function ViewSchemesMaster() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortConfig, setSortConfig] = useState({ key: "scheme_id", direction: "asc" });

  const [visibleColumns, setVisibleColumns] = useState({
    scheme_id: true,
    scheme_name: true,
    scheme_type: true,
    estimated_cost_cr: true,
    package_count: true,
    current_status: true,
    delay_status: true,
  });

  const columnLabels: Record<string, string> = {
    scheme_id: "ID",
    scheme_name: "Scheme Name",
    scheme_type: "Type",
    estimated_cost_cr: "Cost (Cr)",
    package_count: "Pkgs",
    current_status: "Status",
    delay_status: "Delay",
  };

  useEffect(() => {
    fetchSchemes();
  }, []);

  const fetchSchemes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Backend returned ${res.status}: ${errText}`);
      }

      const data = await res.json();

      if (Array.isArray(data)) {
        setSchemes(data);
      } else {
        setError("Backend returned an unexpected format. Check the FastAPI logs.");
        setSchemes([]);
      }
    } catch (e: any) {
      console.error("Fetch error:", e);
      setError(e.message || "Failed to fetch schemes. Is the backend running on port 8000?");
      setSchemes([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedSchemes = useMemo(() => {
    if (!Array.isArray(schemes)) return [];

    let result = schemes.filter((s) => {
      const name = s?.scheme_name?.toLowerCase() || "";
      const type = s?.scheme_type?.toLowerCase() || "";
      const owner = s?.scheme_owner_name?.toLowerCase() || "";
      const amr = s?.amr_no?.toLowerCase() || "";
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        name.includes(term) || type.includes(term) || owner.includes(term) || amr.includes(term);
      const matchesStatus = statusFilter === "all" || s.current_status === statusFilter;
      const matchesType = typeFilter === "all" || s.scheme_type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });

    if (sortConfig.key) {
      result.sort((a: any, b: any) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [schemes, searchTerm, statusFilter, typeFilter, sortConfig]);

  const requestSort = (key: string) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  // KPI totals
  const totals = useMemo(() => {
    const totalCost = schemes.reduce((sum, s) => sum + (s.estimated_cost_cr || 0), 0);
    const ongoingCount = schemes.filter((s) => s.current_status === "ongoing").length;
    const tenderingCount = schemes.filter((s) => s.current_status === "under_tendering").length;
    const closedCount = schemes.filter((s) => s.current_status === "closed").length;
    return { totalCost, ongoingCount, tenderingCount, closedCount };
  }, [schemes]);

  const statusStyles: Record<string, string> = {
    ongoing: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    under_tendering: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    under_stage1: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    under_stage2: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    under_formulation: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    closed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    on_hold: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dropped: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  const delayStyles: Record<string, string> = {
    "On Time": "text-emerald-400",
    "Delayed < 1 Year": "text-amber-400",
    "Delayed > 1 Year": "text-red-400",
    "N/A": "text-zinc-500",
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-white">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              Master <span className="text-cyan-400">Scheme Registry</span>
            </h1>
            <p className="text-zinc-400">All schemes from across the portfolio.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchSchemes}
              className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl hover:text-cyan-400 transition-all"
            >
              <RefreshCw size={20} className={loading ? "animate-spin text-cyan-400" : ""} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <div className="text-xs text-zinc-500 uppercase font-medium">Total Schemes</div>
            <div className="text-3xl font-black text-white mt-1">{schemes.length}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <div className="text-xs text-zinc-500 uppercase font-medium">Ongoing</div>
            <div className="text-3xl font-black text-emerald-400 mt-1">{totals.ongoingCount}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <div className="text-xs text-zinc-500 uppercase font-medium">Tendering</div>
            <div className="text-3xl font-black text-amber-400 mt-1">{totals.tenderingCount}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <div className="text-xs text-zinc-500 uppercase font-medium">Portfolio Cost</div>
            <div className="text-2xl font-black text-cyan-400 mt-1">
              ₹{totals.totalCost.toFixed(2)} Cr
            </div>
          </div>
        </div>

        {/* Filters Row */}
        <div className="mb-6 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text"
              placeholder="Search name, type, owner, AMR no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-cyan-500/50"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-zinc-300 outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="under_formulation">Under Formulation</option>
            <option value="under_stage1">Under Stage-I</option>
            <option value="under_tendering">Under Tendering</option>
            <option value="under_stage2">Under Stage-II</option>
            <option value="ongoing">Ongoing</option>
            <option value="on_hold">On Hold</option>
            <option value="closed">Closed</option>
            <option value="dropped">Dropped</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-zinc-300 outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Types</option>
            <option value="corporate">Corporate AMR</option>
            <option value="plant">Plant AMR</option>
            <option value="dummy">Dummy</option>
          </select>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={20} />
            <div>
              <div className="font-bold text-red-400 mb-1">Backend Error</div>
              <div className="text-sm text-red-300/80">{error}</div>
              <div className="text-xs text-red-400/60 mt-2">
                Tips: Check FastAPI is running on port 8000, and the database schema is GOD MODE v2.
              </div>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900/80 border-b border-zinc-800">
                  {Object.keys(visibleColumns).map(
                    (col) =>
                      visibleColumns[col as keyof typeof visibleColumns] && (
                        <th
                          key={col}
                          onClick={() => requestSort(col)}
                          className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-cyan-400"
                        >
                          <div className="flex items-center gap-2">
                            {columnLabels[col]}
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                      )
                  )}
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-zinc-500 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedSchemes.map((scheme) => (
                  <tr
                    key={scheme.scheme_id}
                    className="border-b border-zinc-800/50 hover:bg-white/[0.02] transition-colors group"
                  >
                    {visibleColumns.scheme_id && (
                      <td className="px-6 py-4 font-mono text-cyan-500/70 text-sm">
                        #{scheme.scheme_id}
                      </td>
                    )}
                    {visibleColumns.scheme_name && (
                      <td className="px-6 py-4 font-bold text-zinc-200 max-w-md">
                        <Link
                          href={`/view/${scheme.scheme_id}`}
                          className="hover:text-cyan-400 hover:underline"
                        >
                          {scheme.scheme_name}
                        </Link>
                        {scheme.amr_no && (
                          <div className="text-xs text-zinc-500 font-normal mt-1">
                            {scheme.amr_no}
                          </div>
                        )}
                      </td>
                    )}
                    {visibleColumns.scheme_type && (
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                            scheme.scheme_type === "corporate"
                              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                              : scheme.scheme_type === "plant"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                          }`}
                        >
                          {scheme.scheme_type}
                        </span>
                      </td>
                    )}
                    {visibleColumns.estimated_cost_cr && (
                      <td className="px-6 py-4 text-zinc-300">
                        ₹{(scheme.estimated_cost_cr || 0).toFixed(2)} Cr
                      </td>
                    )}
                    {visibleColumns.package_count && (
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 text-sm text-zinc-300">
                          <Package size={14} className="text-zinc-500" />
                          {scheme.package_count || 0}
                        </span>
                      </td>
                    )}
                    {visibleColumns.current_status && (
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                            statusStyles[scheme.current_status] ||
                            "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                          }`}
                        >
                          {scheme.current_status?.replace(/_/g, " ") || "Unknown"}
                        </span>
                      </td>
                    )}
                    {visibleColumns.delay_status && (
                      <td className="px-6 py-4">
                        <span
                          className={`text-sm font-medium ${
                            delayStyles[scheme.delay_status] || "text-zinc-500"
                          }`}
                        >
                          {scheme.delay_status}
                        </span>
                      </td>
                    )}
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/view/${scheme.scheme_id}`}
                        className="p-2 bg-zinc-800 rounded-lg hover:bg-cyan-600 inline-block transition-colors"
                      >
                        <Eye size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && !error && filteredAndSortedSchemes.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center">
              <Filter size={32} className="text-zinc-600 mb-4" />
              <h3 className="text-zinc-400 font-medium text-lg">No projects found</h3>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setTypeFilter("all");
                }}
                className="mt-4 text-cyan-400 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-zinc-600">
          Showing {filteredAndSortedSchemes.length} of {schemes.length} schemes
        </div>
      </div>
    </div>
  );
}