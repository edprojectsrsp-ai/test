"use client";

import { useState } from "react";
import { Activity, CalendarDays, Save } from "lucide-react";
import { useMos } from "../../../components/brain/MosContext";

const API_URL = "http://localhost:8000/api/v1/plant";

export default function PlantProgressWorkspace() {
  const { focusField, speakAndChat } = useMos();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [gridData, setGridData] = useState<any[]>([]);

  const handleLoadWorkspace = async () => {
    speakAndChat("Loading the bulk workspace. I am cross-referencing last month's data now.", "🔄");
    try {
      const res = await fetch(`${API_URL}/workspace?year=${year}&month=${month}`);

      if (!res.ok) {
        const errorData = await res.json();
        console.error("Backend Error:", errorData);
        speakAndChat("The backend returned an error. Please check your Python terminal.", "❌");
        return;
      }

      const data = await res.json();
      setGridData(data);
      setIsLoaded(true);
      speakAndChat(`Workspace loaded. ${data.length} schemes ready for bulk update.`, "✅");
    } catch (e) {
      console.error(e);
      speakAndChat("Failed to connect to the backend database.", "❌");
    }
  };

  const updateRow = (index: number, field: string, value: any) => {
    const updated = [...gridData];
    updated[index][field] = value;

    if (field === "current_progress") {
      const val = Number.parseFloat(String(value)) || 0;
      if (val === 100 && updated[index].current_status !== "closed") {
        speakAndChat("Progress is 100%. Please change the status to 'closed' and enter a closure date.", "🎉");
      }
      if (val < updated[index].last_progress) {
        speakAndChat(
          `Warning: Current progress (${val}%) cannot be less than last month (${updated[index].last_progress}%).`,
          "⚠️"
        );
      }
    }

    setGridData(updated);
  };

  const handleSaveWorkspace = async () => {
    for (const row of gridData) {
      const prog = Number.parseFloat(String(row.current_progress));
      if (prog < 0 || prog > 100) return speakAndChat(`Error in ${row.scheme_name}: Progress must be 0-100%.`, "❌");
      if (prog < row.last_progress)
        return speakAndChat(`Error in ${row.scheme_name}: Progress dropped below last month.`, "❌");
      if (prog === row.last_progress && (!row.current_remark || row.current_remark.trim() === "")) {
        return speakAndChat(
          `Rule violation in ${row.scheme_name}: Progress is unchanged. You MUST enter a remark explaining why.`,
          "⚠️"
        );
      }
      if (row.current_status === "closed" && !row.closure_date) {
        return speakAndChat(`Error in ${row.scheme_name}: Closed schemes must have a closure date.`, "❌");
      }
    }

    const payload = {
      progress_month: `${year}-${String(month).padStart(2, "0")}-01`,
      rows: gridData,
    };

    try {
      const res = await fetch(`${API_URL}/save-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
         speakAndChat("Save failed. Check Python terminal.", "❌");
         return;
      }
      speakAndChat("Massive Success! All Plant AMR updates and lifecycle changes have been locked.", "💾");
    } catch (e) {
      speakAndChat("Network failure while saving.", "❌");
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-32">
      <h1 className="font-[Space Grotesk] text-5xl font-bold mb-2 flex items-center gap-4">
        <Activity className="w-10 h-10 text-emerald-400" />
        Plant AMR Bulk Workspace
      </h1>
      <p className="text-zinc-400 mb-12">Excel-style grid for rapid portfolio updates and lifecycle management.</p>

      <div className="bg-black/50 border border-zinc-800 rounded-2xl p-6 mb-8 flex items-end gap-6 backdrop-blur-md">
        <div>
          <label className="block text-sm text-emerald-400 mb-2 font-semibold">Select Year</label>
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
            className="glass-input rounded-xl px-5 py-3 text-white outline-none w-48 appearance-none"
          >
            {[2025, 2026, 2027].map(y => <option key={y} value={y} className="text-black">{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-emerald-400 mb-2 font-semibold">Select Month</label>
          <select
            value={month}
            onChange={e => setMonth(parseInt(e.target.value))}
            className="glass-input rounded-xl px-5 py-3 text-white outline-none w-48 appearance-none"
          >
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
              <option key={i+1} value={i+1} className="text-black">{m}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleLoadWorkspace}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all"
        >
          Load Plant Workspace
        </button>
      </div>

      {isLoaded && (
        <div className="bg-black/60 border border-zinc-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-emerald-400" /> Month: {month}/{year}
            </h2>
            <button
              onClick={handleSaveWorkspace}
              className="bg-white text-black hover:bg-emerald-400 px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-colors"
            >
              <Save className="w-5 h-5" /> Save Entire Portfolio
            </button>
          </div>

          <div className="overflow-x-auto border border-zinc-800 rounded-xl custom-scrollbar bg-zinc-950">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="p-4 sticky left-0 bg-zinc-900 z-10 w-64 border-r border-zinc-800 shadow-[2px_0_5px_rgba(0,0,0,0.5)]">
                    Scheme Name
                  </th>
                  <th className="p-4 border-r border-zinc-800">Exp. Comp</th>
                  <th className="p-4 border-r border-zinc-800 bg-zinc-900/50">Last Month %</th>
                  <th className="p-4 border-r border-zinc-800 bg-zinc-900/50">Last Status / Remark</th>
                  <th className="p-4 border-r border-emerald-900/30 text-emerald-400">Current %</th>
                  <th className="p-4 border-r border-emerald-900/30 text-emerald-400">Status</th>
                  <th className="p-4 border-r border-emerald-900/30 text-emerald-400 w-64">Current Remark</th>
                  <th className="p-4 text-emerald-400">Closure Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {gridData.map((row, idx) => {
                  const progError = parseFloat(row.current_progress) < row.last_progress;
                  return (
                    <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                      <td
                        className="p-4 sticky left-0 z-10 bg-zinc-950 border-r border-zinc-800 shadow-[2px_0_5px_rgba(0,0,0,0.5)] font-bold text-white truncate max-w-[250px]"
                        title={row.scheme_name}
                      >
                        {row.scheme_name}
                      </td>
                      <td className="p-2 border-r border-zinc-800">
                        <input
                          type="date"
                          value={row.expected_completion_date || ""}
                          onChange={(e) => updateRow(idx, "expected_completion_date", e.target.value)}
                          onFocus={(e) => focusField(e, "Update the expected completion date if delayed.", "📅")}
                          className="bg-transparent outline-none w-full text-zinc-300"
                        />
                      </td>
                      <td className="p-4 border-r border-zinc-800 bg-zinc-900/20 text-zinc-500 font-mono text-right">
                        {row.last_progress}%
                      </td>
                      <td className="p-4 border-r border-zinc-800 bg-zinc-900/20 text-zinc-500 text-xs truncate max-w-[150px]">
                        {row.last_status_remark}
                      </td>

                      <td className="p-2 border-r border-zinc-800">
                        <input
                          type="number"
                          step="0.1"
                          value={row.current_progress}
                          onChange={(e) => updateRow(idx, "current_progress", e.target.value)}
                          onFocus={(e) => focusField(e, "Enter cumulative progress. Cannot be lower than last month.", "📈")}
                          className={`w-20 bg-zinc-900 border ${
                            progError ? "border-red-500 text-red-400" : "border-zinc-700 text-emerald-400"
                          } rounded p-2 text-right outline-none focus:border-emerald-400 font-mono font-bold`}
                        />
                      </td>
                      <td className="p-2 border-r border-zinc-800">
                        <select
                          value={row.current_status}
                          onChange={(e) => updateRow(idx, "current_status", e.target.value)}
                          className="bg-zinc-900 border border-zinc-700 rounded p-2 outline-none focus:border-emerald-400"
                        >
                          <option value="ongoing">Ongoing</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="p-2 border-r border-zinc-800">
                        <input
                          type="text"
                          value={row.current_remark}
                          onChange={(e) => updateRow(idx, "current_remark", e.target.value)}
                          onFocus={(e) => focusField(e, "Provide status remarks. Mandatory if progress is unchanged.", "✍️")}
                          placeholder="Required if unchanged..."
                          className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 outline-none focus:border-emerald-400 text-sm"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="date"
                          disabled={row.current_status !== "closed"}
                          value={row.closure_date || ""}
                          onChange={(e) => updateRow(idx, "closure_date", e.target.value)}
                          className={`bg-transparent outline-none w-full ${
                            row.current_status === "closed" ? "text-emerald-400" : "text-zinc-700"
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
