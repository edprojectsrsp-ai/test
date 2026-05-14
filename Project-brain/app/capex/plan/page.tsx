"use client";
import { useState, useEffect } from "react";
import { useMos } from "@/components/brain/MosContext";
import { Save } from "lucide-react";

export default function CapexPlan() {
  const { speakAndChat } = useMos();
  const [schemeId, setSchemeId] = useState("1"); // Mock selected scheme
  const [fy, setFy] = useState("2026-27");
  const [planType, setPlanType] = useState("BE");
  const [hasBE, setHasBE] = useState(false);
  const [total, setTotal] = useState(0);
  const [months, setMonths] = useState<number[]>(Array(12).fill(0));
  const [effMonth, setEffMonth] = useState(4); // April index

  const currentSum = months.reduce((a, b) => a + (Number(b) || 0), 0);
  const isValid = currentSum === total && total > 0;

  useEffect(() => {
    // Mock check if BE exists to unlock RE
    setHasBE(true);
    speakAndChat(`Configuring ${planType} for FY ${fy}. The monthly sum must equal the total declared budget.`, "📊");
  }, [planType]);

  const handleSave = async () => {
    if (!isValid) return alert("Sum of months must equal Total Budget.");
    speakAndChat(`Saving ${planType}. Financial baseline locked.`, "✅");
    // Fetch call to /api/v1/capex/plan/save goes here
  };

  return (
    <div className="p-8 text-white">
      <h1 className="text-3xl font-bold mb-6 text-cyan-400">Financial Baseline (BE/RE)</h1>

      <div className="flex gap-4 mb-8">
        <select value={planType} onChange={(e) => setPlanType(e.target.value)} className="glass-input p-3 rounded-xl text-white">
          <option value="BE">Budget Estimate (BE)</option>
          {hasBE && <option value="RE">Revised Estimate (RE)</option>}
        </select>
        <input type="number" placeholder="Total Budget Amount" onChange={(e) => setTotal(Number(e.target.value))} className="glass-input p-3 rounded-xl w-64 text-white" />

        {planType === "RE" && (
          <select value={effMonth} onChange={(e) => setEffMonth(Number(e.target.value))} className="glass-input p-3 rounded-xl text-white">
            <option value={4}>Effective Month: Apr</option>
            <option value={10}>Effective Month: Oct</option>
          </select>
        )}
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6">
        <div className="grid grid-cols-6 gap-4">
          {["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"].map((m, i) => {
            const isLocked = planType === "RE" && i + 4 < effMonth;
            return (
              <div key={m}>
                <label className="block text-xs text-zinc-500 mb-1">{m}</label>
                <input
                  type="number"
                  value={months[i]}
                  disabled={isLocked}
                  onChange={(e) => {
                    const newM = [...months];
                    newM[i] = Number(e.target.value);
                    setMonths(newM);
                  }}
                  className={`w-full p-2 rounded-lg bg-zinc-800 border ${isLocked ? 'border-red-900/50 cursor-not-allowed text-zinc-600' : 'border-zinc-700 focus:border-cyan-400'} outline-none`}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div className={`text-lg font-bold ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
            Total Allocated: {currentSum} / {total}
          </div>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 ${isValid ? 'bg-cyan-600 hover:bg-cyan-500 text-white' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}
          >
            <Save className="w-5 h-5" /> Save Plan
          </button>
        </div>
      </div>
    </div>
  );
}
