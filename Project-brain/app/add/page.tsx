"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle, Save, SkipForward, UploadCloud } from "lucide-react";
import { useMos } from "@/components/brain/MosContext";
import Link from "next/link"; // Added for routing to bulk upload

const API_URL = "http://localhost:8002/api/v1/schemes";

type SchemeType = "corporate" | "plant" | "dummy";
type SchemeStatus = "under_formulation" | "under_stage1" | "under_tendering" | "under_stage2" | "ongoing" | "closed";

type DateFields = {
  stage1_date: string;
  stage2_date: string;
  start_date: string;
  scheduled_completion_date: string;
  expected_completion_date: string;
  closure_date: string;
  remarks: string;
};

type Match = {
  id: number;
  name: string;
  exact: boolean;
  confidence?: number;
};

const dateFields: { id: keyof DateFields; label: string }[] = [
  { id: "stage1_date", label: "Stage-I Date" },
  { id: "stage2_date", label: "Stage-II Date" },
  { id: "start_date", label: "Start Date" },
  { id: "scheduled_completion_date", label: "Scheduled Completion" },
  { id: "expected_completion_date", label: "Expected Completion" },
  { id: "closure_date", label: "Closure Date" },
];

export default function AddSchemeWizard() {
  const { focusField, speakAndChat } = useMos();
  const [step, setStep] = useState(1);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [typeGlow, setTypeGlow] = useState("");

  const [name, setName] = useState("");
  const [estCost, setEstCost] = useState("");
  const [type, setType] = useState<SchemeType>("corporate");
  const [status, setStatus] = useState<SchemeStatus>("under_formulation");
  const [similarNames, setSimilarNames] = useState<Match[]>([]);
  const [forceProceed, setForceProceed] = useState(false);

  const [dates, setDates] = useState<DateFields>({
    stage1_date: "",
    stage2_date: "",
    start_date: "",
    scheduled_completion_date: "",
    expected_completion_date: "",
    closure_date: "",
    remarks: "",
  });

  const [parentId, setParentId] = useState("");
  const [availableParents, setAvailableParents] = useState<{ id: number; scheme_name: string }[]>([]);
  const [mandatoryFields, setMandatoryFields] = useState<(keyof DateFields)[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let required: (keyof DateFields)[] = [];

    if (type === "corporate") {
      if (["under_stage1", "under_tendering"].includes(status)) required = ["stage1_date"];
      if (status === "under_stage2") required = ["stage1_date", "stage2_date"];
      if (status === "ongoing") required = ["stage1_date", "stage2_date", "start_date", "scheduled_completion_date"];
      if (status === "closed") required = ["closure_date"];
    } else if (type === "plant") {
      if (status === "ongoing") required = ["start_date", "scheduled_completion_date"];
      if (status === "closed") required = ["closure_date"];
    }

    setMandatoryFields(required);
  }, [status, type]);

  const checkCostLogic = () => {
    const val = parseFloat(estCost);
    if (Number.isNaN(val)) return;

    if (val >= 30) {
      setType("corporate");
      setTypeGlow("ring-4 ring-cyan-400");
      speakAndChat(`Cost is ${val} Cr. I suggest Corporate AMR. Pre-selected for you.`, "ðŸ’¡");
    } else if (val > 0 && val < 30) {
      setType("plant");
      setTypeGlow("ring-4 ring-emerald-400");
      speakAndChat(`Cost is ${val} Cr. This is Plant AMR. Updated type for you.`, "ðŸŒ±");
    }
    setTimeout(() => setTypeGlow(""), 1500);
  };

  const isMandatory = (field: keyof DateFields) => mandatoryFields.includes(field);

  const inputClass = (field: keyof DateFields) =>
    `w-full rounded-2xl border bg-zinc-800 px-5 py-4 outline-none transition-all ${
      isMandatory(field)
        ? "border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] focus:shadow-[0_0_20px_rgba(34,211,238,0.5)]"
        : "border-zinc-700 focus:border-zinc-500"
    }`;

  const handleStep1Submit = async () => {
    if (!name.trim()) return alert("Scheme Name is required");

    setIsLoading(true);
    try {
      if (!forceProceed) {
        const simRes = await fetch(`${API_URL}/check-name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheme_name: name }),
        });

        if (simRes.ok) {
          const data = await simRes.json();
          if (data.matches && data.matches.length > 0) {
            const isExact = data.matches.find((match: Match) => match.exact);
            if (isExact) return alert("Exact name already exists! Please choose another.");

            setSimilarNames(data.matches);
            speakAndChat("Wait! I found similar names in the database. Please review them before proceeding.", "âš ï¸");
            return;
          }
        }
      }

      const createRes = await fetch(`${API_URL}/step1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheme_name: name,
          scheme_type: type,
          current_status: status,
          estimated_cost: Number.parseFloat(estCost) || null,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        return alert(`Backend Error: ${err.detail || "Could not create scheme"}`);
      }

      const newScheme = await createRes.json();
      setSchemeId(newScheme.id);
      setSimilarNames([]);
      setStep(2);
    } catch (error) {
      console.error("API Error:", error);
      alert("Cannot reach the AI Brain! Ensure your FastAPI backend is running on port 8000.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep2Submit = async (skipped = false) => {
    setIsLoading(true);
    try {
      if (!skipped) {
        for (const field of mandatoryFields) {
          if (!dates[field]) {
            return alert(`Please fill the mandatory field: ${field.replace(/_/g, " ")}`);
          }
        }
      }

      const payload = Object.fromEntries(Object.entries(dates).filter(([, value]) => value !== ""));

      if (Object.keys(payload).length > 0 && schemeId) {
        const updateRes = await fetch(`${API_URL}/${schemeId}/step2`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!updateRes.ok) return alert("Failed to save dates to database.");
      }

      const parentRes = await fetch(`${API_URL}/parents?scheme_id=${schemeId}`);
      if (parentRes.ok) {
        const parentData = await parentRes.json();
        setAvailableParents(parentData);
      }

      setStep(3);
    } catch (error) {
      console.error("API Error:", error);
      alert("Failed to communicate with backend during Step 2.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep3Submit = async (skipped = false) => {
    setIsLoading(true);
    try {
      if (!skipped && parentId && schemeId) {
        const linkRes = await fetch(`${API_URL}/${schemeId}/step3`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent_id: Number.parseInt(parentId, 10) }),
        });

        if (!linkRes.ok) return alert("Failed to link to parent scheme.");
      }

      alert("Scheme Registration Complete! Project Brain has logged the data.");
      window.location.href = "/view";
    } catch (error) {
      console.error("API Error:", error);
      alert("Failed to finalize scheme linkage.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.08)_0%,transparent_60%)] p-10 pt-20 text-white">
      
      {/* HEADER ROW WITH BULK UPLOAD BUTTON */}
      <div className="mx-auto mb-10 max-w-4xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight">
          <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-lg text-cyan-400">Step {step}/3</span>
          Scheme Registration
        </h1>

        <Link href="/add/bulk">
          <button className="flex items-center gap-2 rounded-xl bg-emerald-600/20 border border-emerald-500/50 px-5 py-2.5 font-medium text-emerald-400 transition-all hover:bg-emerald-500/30 hover:scale-105">
            <UploadCloud size={20} />
            Bulk Upload (Excel)
          </button>
        </Link>
      </div>

      <div className="mx-auto max-w-4xl">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
              <h3 className="mb-6 border-b border-zinc-800 pb-4 text-2xl font-semibold">Core Identity</h3>

              <div className="mb-6 grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className="mb-2 block text-sm text-zinc-400">Scheme Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onFocus={(e) =>
                      focusField(e, "The Scheme Name must be unique. I will scan the database when you continue â€” be specific!", "ðŸ˜Š")
                    }
                    onChange={(event) => {
                      setName(event.target.value);
                      setSimilarNames([]);
                      setForceProceed(false);
                    }}
                    className="glass-input w-full rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-lg text-white outline-none focus:border-cyan-400 transition-all placeholder-zinc-500"
                    placeholder="BF #3 Modernization"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Estimated Cost (Cr) <span className="text-zinc-600 italic">- Optional</span></label>
                  <input
                    type="number"
                    value={estCost}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "What is the estimated cost? I will help you pick the right scheme type based on this.",
                        "ðŸ¤”"
                      )
                    }
                    onBlur={checkCostLogic}
                    onChange={(event) => setEstCost(event.target.value)}
                    className="glass-input w-full rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-lg text-white outline-none focus:border-cyan-400 transition-all placeholder-zinc-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Scheme Type</label>
                  {/* DROPDOWN FIX: Added solid background to select, and explicitly styled options */}
                  <select
                    value={type}
                    onFocus={(e) => focusField(e, "Select the type. Did you see my recommendation?", "ðŸ’¡")}
                    onChange={(event) => setType(event.target.value as SchemeType)}
                    className={`glass-input w-full cursor-pointer rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-lg text-white outline-none transition-all focus:border-cyan-400 ${typeGlow}`}
                  >
                    <option value="corporate" className="bg-zinc-900 text-white">Corporate AMR</option>
                    <option value="plant" className="bg-zinc-900 text-white">Plant AMR</option>
                    <option value="dummy" className="bg-zinc-900 text-white">Dummy / Internal</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="mb-2 block text-sm text-zinc-400">Current Status</label>
                  {/* DROPDOWN FIX: Added solid background to select, and explicitly styled options */}
                  <select
                    value={status}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "âš ï¸ Warning: Please fill the scheme status carefully. This dictates the entire project workflow!",
                        "âš ï¸"
                      )
                    }
                    onChange={(event) => setStatus(event.target.value as SchemeStatus)}
                    className="glass-input w-full cursor-pointer rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-lg text-white outline-none focus:border-cyan-400 transition-all"
                  >
                    <option value="under_formulation" className="bg-zinc-900 text-white">Under Formulation</option>
                    <option value="under_stage1" className="bg-zinc-900 text-white">Under Stage-I</option>
                    <option value="under_tendering" className="bg-zinc-900 text-white">Under Tendering</option>
                    <option value="under_stage2" className="bg-zinc-900 text-white">Under Stage-II</option>
                    <option value="ongoing" className="bg-zinc-900 text-white">Ongoing</option>
                    <option value="closed" className="bg-zinc-900 text-white">Closed</option>
                  </select>
                </div>

                {similarNames.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="col-span-2 mt-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2 font-bold text-amber-400"><AlertTriangle className="h-5 w-5" /> Similar Schemes Detected</div>
                    <ul className="mb-4 space-y-1 text-sm text-zinc-300">
                      {similarNames.map((scheme) => (
                        <li key={scheme.id}>{scheme.name} {scheme.confidence ? <span className="text-xs text-amber-500/70">({scheme.confidence}% match)</span> : null}</li>
                      ))}
                    </ul>
                    <label className="flex w-max cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/50 p-3 text-sm text-white">
                      <input type="checkbox" checked={forceProceed} onChange={(event) => setForceProceed(event.target.checked)} className="h-4 w-4 accent-cyan-500" />
                      I confirm this is a new, unique scheme. Proceed anyway.
                    </label>
                  </motion.div>
                )}
              </div>

              <div className="mt-8 flex justify-end">
                <button onClick={handleStep1Submit} disabled={isLoading || (similarNames.length > 0 && !forceProceed)} className="flex items-center gap-2 rounded-xl bg-white px-8 py-4 font-bold text-black transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                  {isLoading ? "Processing..." : "Create & Continue"} <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
              <div className="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4">
                <h3 className="text-2xl font-semibold">Milestone Dates</h3>
              </div>

              <div className="mb-8 grid grid-cols-2 gap-6">
                {dateFields.map((field) => (
                  <div key={field.id}>
                    <label className="mb-2 flex items-center justify-between text-sm text-zinc-400">
                      <span>{field.label} {isMandatory(field.id) && <span className="ml-1 text-cyan-400">*</span>}</span>
                    </label>
                    <input
                      type="date"
                      value={dates[field.id]}
                      onChange={(event) => setDates({ ...dates, [field.id]: event.target.value })}
                      className={inputClass(field.id)}
                    />
                  </div>
                ))}

                <div className="col-span-2">
                  <label className="mb-2 block text-sm text-zinc-400">Remarks</label>
                  <textarea
                    rows={3}
                    value={dates.remarks}
                    onChange={(event) => setDates({ ...dates, remarks: event.target.value })}
                    className={inputClass("remarks")}
                    placeholder="Add context, risks, or board notes"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-between border-t border-zinc-800 pt-6">
                <button onClick={() => handleStep2Submit(true)} disabled={isLoading} className="flex items-center gap-2 px-6 py-3 text-zinc-400 transition-colors hover:text-white"><SkipForward className="h-5 w-5" /> Skip for now</button>
                <button onClick={() => handleStep2Submit(false)} disabled={isLoading} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-8 py-4 font-bold text-white transition-transform hover:scale-105"><Save className="h-5 w-5" /> Save Dates & Continue</button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
              <h3 className="mb-6 border-b border-zinc-800 pb-4 text-2xl font-semibold">Package Linkage (Optional)</h3>
              <div className="mb-8">
                <label className="mb-2 block text-sm text-zinc-400">Select Master / Parent Scheme</label>
                {/* DROPDOWN FIX */}
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-lg text-white outline-none focus:border-cyan-400 transition-all"
                >
                  <option value="" className="bg-zinc-900 text-white">-- No Parent (Standalone Scheme) --</option>
                  {availableParents.map((parent) => (
                    <option key={parent.id} value={parent.id} className="bg-zinc-900 text-white">
                      [{parent.id}] {parent.scheme_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-8 flex justify-between border-t border-zinc-800 pt-6">
                <button onClick={() => handleStep3Submit(true)} disabled={isLoading} className="flex items-center gap-2 px-6 py-3 text-zinc-400 transition-colors hover:text-white"><CheckCircle className="h-5 w-5" /> Save as Standalone</button>
                <button onClick={() => handleStep3Submit(false)} disabled={isLoading || !parentId} className="flex items-center gap-2 rounded-xl bg-white px-8 py-4 font-bold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-5 w-5" /> Link & Finalize</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
