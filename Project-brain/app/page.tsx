"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Save, SkipForward, AlertTriangle } from "lucide-react";

export default function HomeRegistration() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [type, setType] = useState("corporate");
  const [status, setStatus] = useState("under_formulation");
  const [estCost, setEstCost] = useState(""); // Restored Estimated Cost

  // Step 2 Dates
  const [dates, setDates] = useState({ stage1_date: "", stage2_date: "", start_date: "", scheduled_completion: "", closure_date: "" });

  // Logic to calculate mandatory fields based on your rules
  const [mandatoryFields, setMandatoryFields] = useState<string[]>([]);

  useEffect(() => {
    let required: string[] = [];
    if (type === "corporate") {
      if (["under_stage1", "under_tendering"].includes(status)) required = ["stage1_date"];
      if (status === "under_stage2") required = ["stage1_date", "stage2_date"];
      if (status === "ongoing") required = ["stage1_date", "stage2_date", "start_date", "scheduled_completion"];
      if (status === "closed") required = ["closure_date"];
    } else if (type === "plant") {
      if (status === "ongoing") required = ["start_date", "scheduled_completion"];
      if (status === "closed") required = ["closure_date"];
    }
    setMandatoryFields(required);
  }, [type, status]);

  // Handle clicking "Continue" on Step 1
  const handleStep1Submit = () => {
    if (!name.trim()) {
      alert("Scheme Name is mandatory!");
      return;
    }
    // Moves to Step 2
    setStep(2);
  };

  // Handle clicking "Continue" on Step 2
  const handleStep2Submit = (skipped = false) => {
    if (!skipped) {
      for (const field of mandatoryFields) {
        if (!dates[field as keyof typeof dates]) {
          alert(`Please fill the mandatory field: ${field.replace('_', ' ')}`);
          return;
        }
      }
    }
    // Moves to Step 3
    setStep(3);
  };

  const isMandatory = (field: string) => mandatoryFields.includes(field);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.08)_0%,transparent_60%)] p-10 pt-20">
      <div className="mx-auto max-w-4xl mb-10">
        <h1 className="text-4xl font-bold mb-6 flex items-center gap-3">
          <span className="text-cyan-400 border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 rounded-full text-lg">Step {step}/3</span>
          Scheme Registration
        </h1>
      </div>

      <div className="mx-auto max-w-4xl">
        <AnimatePresence mode="wait">

          {/* STEP 1: Basic Info */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
              <h3 className="text-2xl font-semibold mb-6 border-b border-zinc-800 pb-4">Core Identity</h3>
              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-1">
                  <label className="block text-sm text-zinc-400 mb-2">Scheme Name <span className="text-red-400">*</span></label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 outline-none focus:border-cyan-400" placeholder="e.g. Blast Furnace Mod" />
                </div>

                {/* ESTIMATED COST IS BACK */}
                <div className="col-span-1">
                  <label className="block text-sm text-zinc-400 mb-2">Estimated Cost (₹ Cr) <span className="text-zinc-600 italic">- Optional</span></label>
                  <input type="number" value={estCost} onChange={(e) => setEstCost(e.target.value)} className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 outline-none focus:border-cyan-400" placeholder="0.00" />
                </div>

                <div className="col-span-1">
                  <label className="block text-sm text-zinc-400 mb-2">Scheme Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 outline-none focus:border-cyan-400">
                    <option value="corporate">Corporate AMR</option>
                    <option value="plant">Plant AMR</option>
                    <option value="dummy">Dummy / Internal</option>
                  </select>
                </div>

                <div className="col-span-1">
                  <label className="block text-sm text-zinc-400 mb-2">Current Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 outline-none focus:border-cyan-400">
                    <option value="under_formulation">Under Formulation</option>
                    <option value="under_stage1">Under Stage-I</option>
                    <option value="under_tendering">Under Tendering</option>
                    <option value="under_stage2">Under Stage-II</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end mt-8">
                <button onClick={handleStep1Submit} className="flex items-center gap-2 bg-cyan-500 text-black px-8 py-4 rounded-xl font-bold hover:bg-cyan-400 transition-colors">
                  Continue to Step 2 <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Dates */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
              <div className="flex justify-between items-center mb-6 border-b border-zinc-800 pb-4">
                <h3 className="text-2xl font-semibold">Milestone Dates</h3>
                <span className="text-xs text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/30">Glowing fields are mandatory</span>
              </div>
              <div className="grid grid-cols-2 gap-6 mb-8">
                {[{ id: "stage1_date", label: "Stage-I Date" }, { id: "stage2_date", label: "Stage-II Date" }, { id: "start_date", label: "Start Date" }, { id: "scheduled_completion", label: "Scheduled Completion" }, { id: "closure_date", label: "Closure Date" }].map((field) => (
                  <div key={field.id}>
                    <label className="flex items-center justify-between text-sm text-zinc-400 mb-2">
                      <span>{field.label} {isMandatory(field.id) && <span className="text-cyan-400 ml-1">*</span>}</span>
                    </label>
                    <input
                      type="date"
                      value={dates[field.id as keyof typeof dates]}
                      onChange={(e) => setDates({ ...dates, [field.id]: e.target.value })}
                      className={`w-full rounded-2xl border bg-zinc-950 px-5 py-4 outline-none transition-all ${isMandatory(field.id) ? "border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]" : "border-zinc-700"}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-8 pt-6 border-t border-zinc-800">
                <button onClick={() => handleStep2Submit(true)} className="flex items-center gap-2 text-zinc-400 hover:text-white px-6 py-3 transition-colors"><SkipForward className="w-5 h-5" /> Skip for now</button>
                <button onClick={() => handleStep2Submit(false)} className="flex items-center gap-2 bg-cyan-500 text-black px-8 py-4 rounded-xl font-bold hover:bg-cyan-400"><Save className="w-5 h-5" /> Save & Continue</button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Finish */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center">
              <h3 className="text-3xl font-bold text-cyan-400 mb-4">Registration Complete!</h3>
              <p className="text-zinc-400 mb-8">Your scheme logic has been processed successfully.</p>
              <button onClick={() => setStep(1)} className="bg-white text-black px-8 py-4 rounded-xl font-bold hover:bg-zinc-200">Register Another Scheme</button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
