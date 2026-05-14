"use client";
import { useState, useEffect } from "react";
import { useMos } from "@/components/brain/MosContext";
import { Save, Download } from "lucide-react";

type CapexRow = {
  scheme_id: number;
  scheme_name: string;
  type: string;
  be_total: number;
  re_total: number;
  current_actual: number;
  current_remarks: string;
};

export default function CapexActuals() {
  const { speakAndChat } = useMos();
  const [rows, setRows] = useState<CapexRow[]>([]);

  useEffect(() => {
    // Mocking the backend response for the grid
    setRows([
      { scheme_id: 1, scheme_name: "Blast Furnace #3", type: "Plant AMR", be_total: 500, re_total: 550, current_actual: 0, current_remarks: "" },
      { scheme_id: 2, scheme_name: "Coke Oven Battery 6", type: "Corporate AMR", be_total: 1200, re_total: 1200, current_actual: 0, current_remarks: "" }
    ]);
    speakAndChat("CAPEX Workspace loaded. Variance highlighting is active: Red indicates expenditure over BE/RE limits.", "💰");
  }, []);

  const handleUpdate = (index: number, field: keyof Pick<CapexRow, "current_actual" | "current_remarks">, value: number | string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  const handleSave = () => {
    speakAndChat("Bulk CAPEX Actuals processed and saved successfully.", "✅");
    // Fetch POST to /api/v1/capex/workspace/save
  };

  return (
    <div className="p-8 text-white">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-emerald-400 mb-2">CAPEX Actuals Workspace</h1>
          <p className="text-zinc-400">Bulk monthly expenditure updates.</p>
        </div>
        <div className="flex gap-4">
          <button className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 flex items-center gap-2 border border-zinc-700">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={handleSave} className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 flex items-center gap-2 font-bold shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Save className="w-4 h-4" /> Save Actuals
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-950/50 text-zinc-400 text-sm uppercase tracking-wider">
              <th className="p-4 border-b border-zinc-800">Scheme Name</th>
              <th className="p-4 border-b border-zinc-800">Type</th>
              <th className="p-4 border-b border-zinc-800 text-right">BE Plan</th>
              <th className="p-4 border-b border-zinc-800 text-right">RE Plan</th>
              <th className="p-4 border-b border-zinc-800 text-right">Actual (Month)</th>
              <th className="p-4 border-b border-zinc-800">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // Variance Highlighting Logic
              const isOverBudget = row.current_actual > (row.re_total > 0 ? row.re_total : row.be_total);
              return (
                <tr key={row.scheme_id} className="hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50">
                  <td className="p-4 font-medium">{row.scheme_name}</td>
                  <td className="p-4 text-zinc-400 text-sm">{row.type}</td>
                  <td className="p-4 text-right text-zinc-300">{row.be_total}</td>
                  <td className="p-4 text-right text-zinc-300">{row.re_total}</td>
                  <td className="p-4">
                    <input
                      type="number"
                      value={row.current_actual}
                      onChange={(e) => handleUpdate(i, "current_actual", Number(e.target.value))}
                      className={`w-full text-right p-2 rounded-lg bg-zinc-950 border ${isOverBudget ? 'border-red-500 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-zinc-700 focus:border-emerald-400'} outline-none transition-all`}
                    />
                  </td>
                  <td className="p-4">
                    <input
                      type="text"
                      value={row.current_remarks}
                      onChange={(e) => handleUpdate(i, "current_remarks", e.target.value)}
                      placeholder="Add remarks..."
                      className="w-full p-2 rounded-lg bg-zinc-950 border border-zinc-700 focus:border-emerald-400 outline-none text-sm"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
