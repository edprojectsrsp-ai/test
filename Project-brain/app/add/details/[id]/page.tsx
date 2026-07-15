"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RegistrationStep2() {
  const router = useRouter();
  const params = useParams();
  const schemeId = params.id;

  // --- STATE ---
  const [schemeStatus, setSchemeStatus] = useState<string>("");
  const [formData, setFormData] = useState({
    stage1_date: "", stage2_date: "", start_date: "",
    scheduled_completion_date: "", expected_completion_date: "", closure_date: "", remarks: ""
  });
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // --- INITIAL LOAD ---
  useEffect(() => {
    const fetchScheme = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/v1/schemes/${schemeId}`);
        if (res.ok) {
          const data = await res.json();
          setSchemeStatus(data.current_status);
        }
      } catch {
        setFormError("Could not load the scheme context. You can still enter the timeline manually.");
      }
    };
    if (schemeId) fetchScheme();
  }, [schemeId]);

  // --- LOGIC VALIDATION ---
  const handleSave = async () => {
    // Logic: If Ongoing -> Start & Scheduled Dates are Mandatory
    if (schemeStatus === "ongoing") {
      if (!formData.start_date || !formData.scheduled_completion_date) {
        setFormError("Start Date and Scheduled Completion Date are required for ongoing projects.");
        return;
      }
    }
    // Logic: If Closed -> Closure Date is Mandatory
    if (schemeStatus === "closed" && !formData.closure_date) {
      setFormError("Closure Date is required for closed projects.");
      return;
    }

    setFormError("");
    setIsLoading(true);

    try {
      const payload = Object.fromEntries(Object.entries(formData).filter(([_, value]) => value !== ""));
      const res = await fetch(`http://localhost:8000/api/v1/schemes/step2/${schemeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        router.push("/view");
      } else {
        setFormError("Could not save the project timeline.");
      }
    } catch {
      setFormError("Network error while saving details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    router.push("/view");
  };

  // --- DYNAMIC STYLING HELPER ---
  const isMandatory = (field: string) => {
    if (schemeStatus === "ongoing" && (field === "start" || field === "scheduled")) return true;
    if (schemeStatus === "closed" && field === "closure") return true;
    return false;
  };

  const inputClass = (field: string) => `w-full rounded-2xl px-6 py-4 text-xl outline-none bg-white transition-all duration-300 border focus:translate-x-2
    ${isMandatory(field) ? "bg-cyan-950/20 border-cyan-400 focus:shadow-[0_0_20px_rgba(34,211,238,0.4)]" : "bg-white/5 border-cyan-400/20 focus:border-cyan-400"}`;

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden relative" style={{
      background: "linear-gradient(-45deg, #09090b, #18181b, #082f49, #000000)",
      backgroundSize: "400% 400%", animation: "gradientBG 15s ease infinite"
    }}>
      <style jsx global>{`
        @keyframes gradientBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      <div className="flex-1 p-12 overflow-y-auto relative scroll-smooth">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-5xl font-bold mb-2 font-mono">Project Timeline</h1>
          <p className="text-zinc-400 mb-12">Fill in the applicable dates. Mandatory fields are highlighted based on status.</p>
          {formError && <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{formError}</div>}

          <div className="space-y-8 pb-32">
            <div className="grid grid-cols-2 gap-6">
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Stage-1 Date</label>
                <input type="date" value={formData.stage1_date} onChange={(e) => setFormData({...formData, stage1_date: e.target.value})}
                  className={inputClass("stage1")} />
              </div>
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Stage-2 Date</label>
                <input type="date" value={formData.stage2_date} onChange={(e) => setFormData({...formData, stage2_date: e.target.value})}
                  className={inputClass("stage2")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Start Date {isMandatory("start") && <span className="text-red-400">*</span>}</label>
                <input type="date" value={formData.start_date} onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                  className={inputClass("start")} />
              </div>
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Scheduled Completion {isMandatory("scheduled") && <span className="text-red-400">*</span>}</label>
                <input type="date" value={formData.scheduled_completion_date} onChange={(e) => setFormData({...formData, scheduled_completion_date: e.target.value})}
                  className={inputClass("scheduled")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Expected Completion</label>
                <input type="date" value={formData.expected_completion_date} onChange={(e) => setFormData({...formData, expected_completion_date: e.target.value})}
                  className={inputClass("expected")} />
              </div>
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Closure Date {isMandatory("closure") && <span className="text-red-400">*</span>}</label>
                <input type="date" value={formData.closure_date} onChange={(e) => setFormData({...formData, closure_date: e.target.value})}
                  className={inputClass("closure")} />
              </div>
            </div>

            <div className="form-group">
              <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Remarks</label>
              <textarea rows={3} value={formData.remarks} onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                className="bg-white/5 border border-cyan-400/20 focus:border-cyan-400 focus:shadow-[0_0_20px_rgba(34,211,238,0.2)] focus:translate-x-2 bg-white transition-all duration-300 w-full rounded-2xl px-6 py-4 text-xl outline-none" />
            </div>

            <div className="flex gap-4 pt-6">
              <button onClick={handleSkip} disabled={isLoading} className="w-1/3 bg-slate-800 hover:bg-slate-700 py-4 rounded-xl text-lg font-bold transition-all text-slate-300">
                Skip For Now
              </button>
              <button onClick={handleSave} disabled={isLoading} className="w-2/3 bg-cyan-600 hover:bg-cyan-500 py-4 rounded-xl text-lg font-bold shadow-[0_0_15px_rgba(34,211,238,0.4)] transition-all">
                {isLoading ? "Saving..." : "Save Details & Finish"}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
