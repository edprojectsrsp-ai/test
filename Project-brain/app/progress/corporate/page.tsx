"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Edit2,
  Play,
  Activity,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

const API_URL = "http://localhost:8002/api/v1/view";

type SchemeRow = {
  scheme_id: string | number;
  scheme_name: string;
  scheme_type: string;
};

type ActivityRow = {
  name: string;
  uom: string;
  scope: number;
  weight: number;
  planTillMonth: number;
  actualTillMonth: number;
  remarks: string;
};

type ActivePlan = {
  version: number;
  status: string;
  effectiveMonth: string;
  overallPlanned: number;
  overallActual: number;
  activities: ActivityRow[];
};

const MONTHS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;

export default function CorporateProgressDashboard() {
  const [schemes, setSchemes] = useState<SchemeRow[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [selectedFY, setSelectedFY] = useState("2026-27");
  const [selectedMonth, setSelectedMonth] = useState("April");
  const [isDashboardLoaded, setIsDashboardLoaded] = useState(false);

  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/all`)
      .then((res) => {
        if (!res.ok) throw new Error("Backend connection failed.");
        return res.json();
      })
      .then((data: SchemeRow[]) => {
        const corporateSchemes = data.filter(
          (s) => s.scheme_type === "corporate"
        );
        setSchemes(corporateSchemes);
      })
      .catch((err) => console.error("Failed to fetch schemes:", err));
  }, []);

  const loadDashboard = () => {
    if (!selectedScheme || !selectedFY || !selectedMonth) {
      alert("Please select Scheme, FY, and Month to load the dashboard.");
      return;
    }
    setActivePlan({
      version: 1,
      status: "Active",
      effectiveMonth: "April",
      overallPlanned: 11.5,
      overallActual: 10.2,
      activities: [
        {
          name: "Excavation",
          uom: "Cum",
          scope: 5000,
          weight: 20,
          planTillMonth: 10,
          actualTillMonth: 8,
          remarks: "Slight delay due to rain",
        },
        {
          name: "Foundation Concreting",
          uom: "Cum",
          scope: 2000,
          weight: 30,
          planTillMonth: 15,
          actualTillMonth: 15,
          remarks: "On track",
        },
        {
          name: "Structural Steel Erection",
          uom: "MT",
          scope: 800,
          weight: 50,
          planTillMonth: 5,
          actualTillMonth: 2,
          remarks: "Material delayed at port",
        },
      ],
    });
    setIsDashboardLoaded(true);
  };

  const getVarianceColor = (planned: number, actual: number) => {
    const variance = actual - planned;
    if (variance >= 0) return "text-emerald-400";
    if (variance >= -5) return "text-yellow-400";
    return "text-rose-400";
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-gray-100 p-8 font-sans selection:bg-cyan-900">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            Corporate AMR Physical Progress
          </h1>
          <p className="text-gray-400 mt-1">
            Appendix 2 Matrix & DPR Aggregation Command Center
          </p>
        </div>
        <div className="flex gap-4">
          <Link
            href="/physical"
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg border border-gray-700 transition-colors"
          >
            <ArrowLeft size={16} /> Back to Hub
          </Link>
        </div>
      </div>

      <div className="bg-[#111115] border border-gray-800 rounded-xl p-6 mb-8 shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Select Scheme
            </label>
            <select
              className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none"
              value={selectedScheme}
              onChange={(e) => setSelectedScheme(e.target.value)}
            >
              <option value="">-- Select Corporate Scheme --</option>
              {schemes.map((s) => (
                <option key={String(s.scheme_id)} value={String(s.scheme_id)}>
                  {s.scheme_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Financial Year
            </label>
            <select
              className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-white outline-none"
              value={selectedFY}
              onChange={(e) => setSelectedFY(e.target.value)}
            >
              <option value="2025-26">2025-26</option>
              <option value="2026-27">2026-27</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Month
            </label>
            <select
              className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-white outline-none"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={loadDashboard}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 py-3 px-6 rounded-lg font-bold shadow-lg shadow-cyan-900/20 transition-all"
          >
            <Search size={18} /> Load Dashboard
          </button>
        </div>
      </div>

      {isDashboardLoaded && activePlan ? (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-wrap gap-4">
            <button className="flex items-center gap-2 bg-emerald-900/50 hover:bg-emerald-800 border border-emerald-700/50 text-emerald-100 px-4 py-2 rounded-lg transition-colors">
              <Activity size={16} /> Enter Actual Progress
            </button>
            <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg transition-colors">
              <Edit2 size={16} /> Modify / Revise Plan
            </button>
            <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg transition-colors">
              <Play size={16} /> View History
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-[#111115] border border-gray-800 p-5 rounded-xl">
              <p className="text-gray-400 text-sm mb-1">Plan Version</p>
              <p className="text-2xl font-bold text-white">
                V{activePlan.version}{" "}
                <span className="text-sm font-normal text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded ml-2">
                  {activePlan.status}
                </span>
              </p>
            </div>
            <div className="bg-[#111115] border border-gray-800 p-5 rounded-xl">
              <p className="text-gray-400 text-sm mb-1">
                Overall Planned (Till {selectedMonth})
              </p>
              <p className="text-2xl font-bold text-white">
                {activePlan.overallPlanned}%
              </p>
            </div>
            <div className="bg-[#111115] border border-gray-800 p-5 rounded-xl">
              <p className="text-gray-400 text-sm mb-1">
                Overall Actual (Till {selectedMonth})
              </p>
              <p className="text-2xl font-bold text-white">
                {activePlan.overallActual}%
              </p>
            </div>
            <div className="bg-[#111115] border border-gray-800 p-5 rounded-xl">
              <p className="text-gray-400 text-sm mb-1">Variance</p>
              <p
                className={`text-2xl font-bold ${getVarianceColor(
                  activePlan.overallPlanned,
                  activePlan.overallActual
                )}`}
              >
                {(activePlan.overallActual - activePlan.overallPlanned).toFixed(
                  1
                )}
                %
              </p>
            </div>
          </div>

          <div className="bg-[#111115] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-900 border-b border-gray-800 text-xs uppercase tracking-wider text-gray-400">
                    <th className="p-4 font-semibold">Activity</th>
                    <th className="p-4 font-semibold">UOM</th>
                    <th className="p-4 font-semibold text-right">Scope</th>
                    <th className="p-4 font-semibold text-right">Weightage</th>
                    <th className="p-4 font-semibold text-right bg-blue-900/10">
                      Plan Till Mth
                    </th>
                    <th className="p-4 font-semibold text-right bg-emerald-900/10">
                      Actual Till Mth
                    </th>
                    <th className="p-4 font-semibold text-right">Variance</th>
                    <th className="p-4 font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 text-sm">
                  {activePlan.activities.map((act, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="p-4 font-medium text-gray-200">
                        {act.name}
                      </td>
                      <td className="p-4 text-gray-400">{act.uom}</td>
                      <td className="p-4 text-right text-gray-300">
                        {act.scope ? act.scope.toLocaleString() : "-"}
                      </td>
                      <td className="p-4 text-right text-cyan-400">
                        {act.weight}%
                      </td>
                      <td className="p-4 text-right font-medium bg-blue-900/5">
                        {act.planTillMonth}%
                      </td>
                      <td className="p-4 text-right font-medium bg-emerald-900/5">
                        {act.actualTillMonth}%
                      </td>
                      <td
                        className={`p-4 text-right font-bold ${getVarianceColor(
                          act.planTillMonth,
                          act.actualTillMonth
                        )}`}
                      >
                        {(act.actualTillMonth - act.planTillMonth).toFixed(1)}%
                      </td>
                      <td
                        className="p-4 text-gray-400 italic max-w-xs truncate"
                        title={act.remarks}
                      >
                        {act.remarks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        isDashboardLoaded &&
        !activePlan && (
          <div className="bg-[#111115] border border-dashed border-gray-700 rounded-xl p-12 text-center flex flex-col items-center animate-fade-in">
            <AlertCircle size={48} className="text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-gray-200 mb-2">
              No Active Plan Found
            </h3>
            <p className="text-gray-400 max-w-md mx-auto mb-6">
              There is no active Appendix 2 progress plan for this scheme in
              the selected Financial Year.
            </p>
            <button className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 py-3 px-6 rounded-lg font-bold shadow-lg shadow-cyan-900/20 transition-all">
              <Plus size={18} /> Create Progress Plan
            </button>
          </div>
        )
      )}
    </div>
  );
}

