"use client";

import { useState, useRef, useEffect, type RefObject } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function RegistrationStep2() {
  const router = useRouter();
  const params = useParams();
  const schemeId = params.id;

  // --- STATE ---
  const [mosAwake, setMosAwake] = useState(true);
  const [isTalking, setIsTalking] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ text: string; mood: string }[]>([]);
  const [mosY, setMosY] = useState(150);
  const [mosGesture, setMosGesture] = useState<"idle" | "guide" | "warning" | "success">("idle");
  const [currentSpeechText, setCurrentSpeechText] = useState("Hello!");
  
  const [schemeStatus, setSchemeStatus] = useState<string>("");
  const [formData, setFormData] = useState({
    stage1_date: "", stage2_date: "", start_date: "", 
    scheduled_completion_date: "", expected_completion_date: "", closure_date: "", remarks: ""
  });
  const [isLoading, setIsLoading] = useState(false);

  // --- REFS ---
  const formRef = useRef<HTMLDivElement>(null);
  const stage1Ref = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const closureRef = useRef<HTMLDivElement>(null);
  const remarksRef = useRef<HTMLDivElement>(null);

  // --- AUDIO SYNTHESIS ---
  const speakAndChat = (text: string, mood: string, gesture: "idle" | "guide" | "warning" | "success" = "idle") => {
    setChatHistory(prev => [...prev, { text, mood }]);
    setCurrentSpeechText(text);
    setMosGesture(gesture);
    setIsTalking(true);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const synth = window.speechSynthesis;
      if (synth.speaking) synth.cancel();
      const utterThis = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const femaleVoice = voices.find(v => v.name.includes("Female") || v.name.includes("Google US English"));
      if (femaleVoice) utterThis.voice = femaleVoice;
      utterThis.pitch = 1.2;
      utterThis.rate = 1.05;
      utterThis.onend = () => { setIsTalking(false); setMosGesture("idle"); };
      synth.speak(utterThis);
    }
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    const fetchScheme = async () => {
      try {
        const res = await fetch(`http://localhost:8002/api/v1/schemes/${schemeId}`);
        if (res.ok) {
          const data = await res.json();
          setSchemeStatus(data.current_status);
          speakAndChat(`Project loaded! Since the status is "${data.current_status.replace("_", " ")}", I've highlighted the recommended fields.`, "🔍", "guide");
        }
      } catch (err) {
        speakAndChat("Could not fetch scheme context. Proceeding blindly.", "⚠️", "warning");
      }
    };
    if (schemeId) fetchScheme();
  }, [schemeId]);

  const trackField = (ref: RefObject<HTMLDivElement | null>, text: string, mood: string) => {
    if (!ref.current || !formRef.current) return;
    const containerTop = formRef.current.getBoundingClientRect().top;
    const elementTop = ref.current.getBoundingClientRect().top;
    const scrollTop = formRef.current.scrollTop;
    setMosY(elementTop - containerTop + scrollTop - 15);
    speakAndChat(text, mood, "guide");
  };

  // --- LOGIC VALIDATION ---
  const handleSave = async () => {
    // Logic: If Ongoing -> Start & Scheduled Dates are Mandatory
    if (schemeStatus === "ongoing") {
      if (!formData.start_date || !formData.scheduled_completion_date) {
        trackField(startRef, "Wait! Ongoing projects MUST have a Start Date and Scheduled Completion Date.", "🛑");
        setMosGesture("warning");
        return;
      }
    }
    // Logic: If Closed -> Closure Date is Mandatory
    if (schemeStatus === "closed" && !formData.closure_date) {
      trackField(closureRef, "Hold on! Closed projects MUST have a Closure Date.", "🛑");
      setMosGesture("warning");
      return;
    }

    setIsLoading(true);
    speakAndChat("Validating and saving timeline...", "⚙️", "guide");

    try {
      const payload = Object.fromEntries(Object.entries(formData).filter(([_, value]) => value !== ""));
      const res = await fetch(`http://localhost:8002/api/v1/schemes/step2/${schemeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        speakAndChat("All details synced! Project registration complete.", "✅", "success");
        setTimeout(() => router.push("/view"), 2500); // Route to View Schemes (Module for Child packages)
      }
    } catch (err) {
      speakAndChat("Network error while saving details.", "❌", "warning");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    speakAndChat("Skipping details for now. You can update these later in the View module!", "⏭️", "success");
    setTimeout(() => router.push("/view"), 2000);
  };

  // --- DYNAMIC STYLING HELPER ---
  const isMandatory = (field: string) => {
    if (schemeStatus === "ongoing" && (field === "start" || field === "scheduled")) return true;
    if (schemeStatus === "closed" && field === "closure") return true;
    return false;
  };

  const inputClass = (field: string) => `w-full rounded-2xl px-6 py-4 text-xl outline-none backdrop-blur-md transition-all duration-300 border focus:translate-x-2 
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
      
      {/* LEFT SIDEBAR: Chat History */}
      <div className="w-80 bg-black/50 border-r border-cyan-900/50 p-8 flex flex-col backdrop-blur-md z-10">
        <div className="flex items-center gap-4 mb-16">
          <div className="text-6xl">🧠</div>
          <div>
            <h1 className="font-bold tracking-tighter text-3xl font-mono">PROJECT BRAIN</h1>
            <p className="text-cyan-400 text-sm">Step 2: Timeline</p>
          </div>
        </div>
        
        <div className="flex-1 flex flex-col mt-4">
          <h3 className="text-zinc-400 text-sm font-semibold uppercase tracking-wider mb-4 flex justify-between items-center">
            Chat History
          </h3>
          <div className="bg-black/60 backdrop-blur-md border border-white/10 flex-1 rounded-2xl p-4 overflow-y-auto flex flex-col gap-2">
            {chatHistory.map((msg, index) => (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={index} className="bg-cyan-600 rounded-tr-lg rounded-br-lg rounded-bl-lg px-3 py-2 text-xs w-max max-w-[90%] shadow-lg">
                <span className="text-sm mr-1">{msg.mood}</span> {msg.text}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: The Form */}
      <div ref={formRef} className="flex-1 p-12 overflow-y-auto relative scroll-smooth">
        <div className="max-w-2xl ml-10">
          <h1 className="text-5xl font-bold mb-2 font-mono">Project Timeline</h1>
          <p className="text-zinc-400 mb-12">Fill in the applicable dates. Mandatory fields are highlighted based on status.</p>

          <div className="space-y-8 pb-32">
            <div className="grid grid-cols-2 gap-6">
              <div ref={stage1Ref} className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Stage-1 Date</label>
                <input type="date" value={formData.stage1_date} onChange={(e) => setFormData({...formData, stage1_date: e.target.value})}
                  onFocus={() => trackField(stage1Ref, "When was Stage-1 approval achieved?", "📅")}
                  className={inputClass("stage1")} />
              </div>
              <div className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Stage-2 Date</label>
                <input type="date" value={formData.stage2_date} onChange={(e) => setFormData({...formData, stage2_date: e.target.value})}
                  className={inputClass("stage2")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div ref={startRef} className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Start Date {isMandatory("start") && <span className="text-red-400">*</span>}</label>
                <input type="date" value={formData.start_date} onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                  onFocus={() => trackField(startRef, "Start dates are critical for Ongoing projects. Do you have it?", "⏱️")}
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
              <div ref={closureRef} className="form-group">
                <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Closure Date {isMandatory("closure") && <span className="text-red-400">*</span>}</label>
                <input type="date" value={formData.closure_date} onChange={(e) => setFormData({...formData, closure_date: e.target.value})}
                  onFocus={() => trackField(closureRef, "Only fill this if the project is fully closed and handed over.", "🔒")}
                  className={inputClass("closure")} />
              </div>
            </div>

            <div ref={remarksRef} className="form-group">
              <label className="block text-sm text-cyan-400 mb-3 font-semibold uppercase">Remarks</label>
              <textarea rows={3} value={formData.remarks} onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                onFocus={() => trackField(remarksRef, "Any special notes or context for the Board?", "📝")}
                className="bg-white/5 border border-cyan-400/20 focus:border-cyan-400 focus:shadow-[0_0_20px_rgba(34,211,238,0.2)] focus:translate-x-2 backdrop-blur-md transition-all duration-300 w-full rounded-2xl px-6 py-4 text-xl outline-none" />
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

      {/* FLOATING MOS WIDGET */}
      <motion.div className="absolute right-[60px] z-50 flex items-center gap-3 pointer-events-none" animate={{ top: mosY }} transition={{ type: "spring", stiffness: 60, damping: 15 }}>
        <AnimatePresence>
          {isTalking && (
            <motion.div initial={{ scale: 0, opacity: 0, originX: 1, originY: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} className="bg-white text-black p-3 rounded-2xl rounded-tr-none shadow-2xl max-w-[200px]">
              <p className="text-xs font-semibold leading-relaxed">{currentSpeechText}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.img src="/mos-assistant.gif" alt="MOS" animate={mosGesture} className={`w-[100px] rounded-xl border-2 pointer-events-auto cursor-pointer ${isTalking ? "border-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.8)]" : "border-white/10 shadow-xl"}`} style={{ transition: "box-shadow 0.3s, border-color 0.3s" }} />
      </motion.div>
    </div>
  );
}
