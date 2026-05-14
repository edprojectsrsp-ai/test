"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Briefcase, FileText, Anchor, Activity, CheckSquare, Zap, Lock, Unlock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Helper to map statuses to their hierarchical "level"
const STATUS_LEVELS: Record<string, number> = {
  under_formulation: 0,
  under_stage1: 1,
  under_tendering: 2,
  under_stage2: 3,
  ongoing: 4,
  closed: 5,
};

export default function InteractiveSchemeVault() {
  const { id } = useParams();
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState("stage1");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // 🟢 The "God Mode" Feature Switch
  const [autoPilot, setAutoPilot] = useState(true);
  
  const [formData, setFormData] = useState<any>(null);

  useEffect(() => {
    fetch(`http://localhost:8000/api/v1/schemes/${id}/vault`)
      .then(res => res.json())
      .then(data => {
        setFormData({
          core: data.core || {},
          stage1: data.stage1 || {},
          tender: data.tender || {},
          stage2: data.stage2 || {},
          order: data.order || {},
          closure: data.closure || {}
        });
        setLoading(false);
      });
  }, [id]);

  const handleInputChange = (section: string, field: string, value: any) => {
    setHasChanges(true);
    setFormData((prev: any) => {
      const newData = { ...prev, [section]: { ...prev[section], [field]: value } };
      
      // 🟢 AUTO-PILOT LOGIC: Let the dates drive the status
      if (autoPilot) {
        let newStatus = newData.core.status;
        
        if (section === "tender" && field === "nit_date" && value) {
          if (STATUS_LEVELS[newStatus] < STATUS_LEVELS["under_tendering"]) newStatus = "under_tendering";
        }
        if (section === "stage2" && field === "stage_2_sanction_date" && value) {
          if (STATUS_LEVELS[newStatus] < STATUS_LEVELS["under_stage2"]) newStatus = "under_stage2";
        }
        if (section === "order" && field === "effective_date" && value) {
           if (STATUS_LEVELS[newStatus] < STATUS_LEVELS["ongoing"]) newStatus = "ongoing";
        }
        if (section === "closure" && field === "commissioning_date" && value) {
           newStatus = "closed";
        }

        newData.core.status = newStatus;
      }

      return newData;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`http://localhost:8000/api/v1/schemes/${id}/vault`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        setHasChanges(false);
        // Optional: Trigger a beautiful toast notification here
      } else {
        alert("Failed to save data.");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">Initializing Vault...</div>;

  const currentLevel = STATUS_LEVELS[formData.core.status] || 0;

  const pipelineNodes = [
    { id: "stage1", label: "Stage-I Approvals", icon: <Briefcase size={18} />, reqLevel: 0 },
    { id: "tender", label: "Tendering Process", icon: <FileText size={18} />, reqLevel: 2 },
    { id: "stage2", label: "Stage-II Sanction", icon: <Anchor size={18} />, reqLevel: 3 },
    { id: "order", label: "Execution Phase", icon: <Activity size={18} />, reqLevel: 4 },
    { id: "closure", label: "Closure & Handover", icon: <CheckSquare size={18} />, reqLevel: 5 },
  ];

  // Check if the currently selected tab is mathematically "locked" based on status
  const activeNode = pipelineNodes.find(n => n.id === activeTab);
  const isLocked = currentLevel < (activeNode?.reqLevel || 0);

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-white font-sans">
      <div className="max-w-7xl mx-auto">
        
        {/* ================= HEADER & CORE CONTROLS ================= */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-zinc-800 pb-6 gap-6">
          <div className="flex-1">
            <button onClick={() => router.push("/view")} className="flex items-center gap-2 text-zinc-400 hover:text-cyan-400 mb-4 text-sm font-medium transition-colors">
              <ArrowLeft size={16} /> Back to Master Grid
            </button>
            <h1 className="text-4xl font-black text-white">{formData.core.scheme_name}</h1>
            
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-300 font-mono">ID: {formData.core.id}</span>
              
              {/* Manual Override Status Dropdown */}
              <div className={`flex items-center gap-2 border rounded-lg px-2 transition-all ${autoPilot ? "bg-zinc-900 border-zinc-800 opacity-50 cursor-not-allowed" : "bg-cyan-900/20 border-cyan-800"}`}>
                <select 
                  disabled={autoPilot}
                  value={formData.core.status} 
                  onChange={(e) => handleInputChange("core", "status", e.target.value)}
                  className="bg-transparent py-1.5 text-sm capitalize text-cyan-400 outline-none cursor-pointer disabled:cursor-not-allowed"
                >
                  <option value="under_formulation" className="bg-zinc-900 text-white">Under Formulation</option>
                  <option value="under_stage1" className="bg-zinc-900 text-white">Under Stage-1</option>
                  <option value="under_tendering" className="bg-zinc-900 text-white">Under Tendering</option>
                  <option value="under_stage2" className="bg-zinc-900 text-white">Under Stage-2</option>
                  <option value="ongoing" className="bg-zinc-900 text-white">Ongoing</option>
                  <option value="closed" className="bg-zinc-900 text-white">Closed</option>
                </select>
              </div>

              {/* Auto-Pilot Toggle */}
              <button 
                onClick={() => setAutoPilot(!autoPilot)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${
                  autoPilot ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]" : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                <Zap size={14} className={autoPilot ? "animate-pulse" : ""} /> 
                {autoPilot ? "Auto-Pilot ON" : "Manual Override"}
              </button>
            </div>
          </div>

          <button 
            onClick={handleSave} 
            disabled={isSaving || !hasChanges} 
            className={`flex items-center gap-2 px-8 py-4 rounded-xl font-bold transition-all ${
              hasChanges 
                ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]" 
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
            }`}
          >
            <Save size={20} /> {isSaving ? "Committing..." : hasChanges ? "Commit Changes" : "Vault Saved"}
          </button>
        </div>

        {/* ================= VAULT BODY ================= */}
        <div className="flex flex-col md:flex-row gap-8">
          
          {/* THE SMART PIPELINE (Left Sidebar) */}
          <div className="w-full md:w-72 flex flex-col relative">
            {/* The vertical connection line */}
            <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-zinc-800 z-0"></div>

            {pipelineNodes.map((node, index) => {
              const isNodeActive = currentLevel >= node.reqLevel;
              const isSelected = activeTab === node.id;

              return (
                <div key={node.id} className="relative z-10 flex items-center mb-2">
                  <button
                    onClick={() => setActiveTab(node.id)}
                    className={`flex items-center gap-4 w-full px-4 py-4 rounded-2xl font-medium transition-all duration-300 ${
                      isSelected 
                        ? "bg-zinc-800 shadow-xl border border-zinc-700 scale-105 ml-2" 
                        : "hover:bg-zinc-900/80 hover:translate-x-2 border border-transparent"
                    }`}
                  >
                    {/* Status Indicator Node */}
                    <div className={`flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 transition-all ${
                      isNodeActive 
                        ? "bg-emerald-500 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
                        : "bg-zinc-950 border-zinc-700"
                    }`}>
                      {isNodeActive && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                    </div>

                    <div className="flex flex-col items-start">
                      <span className={`text-sm flex items-center gap-2 ${isNodeActive ? "text-white" : "text-zinc-500"}`}>
                        {node.icon} {node.label}
                      </span>
                      {!isNodeActive && <span className="text-[10px] text-zinc-600 mt-0.5 uppercase tracking-wider">Locked (Future Phase)</span>}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* DYNAMIC FORM AREA */}
          <div className="flex-1 relative">
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl min-h-[500px] overflow-hidden">
              
              {/* SMART LOCK OVERLAY */}
              <AnimatePresence>
                {isLocked && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-md rounded-3xl border border-zinc-800/50"
                  >
                    <Lock size={48} className="text-zinc-600 mb-4" />
                    <h3 className="text-2xl font-bold text-white mb-2">Phase Locked</h3>
                    <p className="text-zinc-400 text-center max-w-sm mb-6">
                      This project is currently <span className="text-cyan-400 capitalize">{formData.core.status.replace(/_/g, " ")}</span>. 
                      You must advance the status to edit this phase.
                    </p>
                    <button 
                      onClick={() => { setAutoPilot(false); handleInputChange("core", "status", Object.keys(STATUS_LEVELS).find(k => STATUS_LEVELS[k] === activeNode?.reqLevel)); }}
                      className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-cyan-600 text-white rounded-xl transition-all font-medium border border-zinc-700 hover:border-cyan-500"
                    >
                      <Unlock size={18} /> Force Unlock Phase
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* FORM FIELDS (Blur them out if locked) */}
              <div className={`transition-all duration-500 ${isLocked ? "opacity-20 blur-sm pointer-events-none" : "opacity-100 blur-none"}`}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-6"
                  >
                    {activeTab === "stage1" && (
                      <>
                        <h2 className="col-span-1 xl:col-span-2 text-xl font-bold border-b border-zinc-800 pb-2 mb-2 text-white">Initial Formulations & Approvals</h2>
                        <InputField label="Acceptance of Assignment" type="date" value={formData.stage1.assignment_date} onChange={(v) => handleInputChange("stage1", "assignment_date", v)} />
                        <InputField label="Draft FR/TS Date" type="date" value={formData.stage1.draft_fr_date} onChange={(v) => handleInputChange("stage1", "draft_fr_date", v)} />
                        <InputField label="PAG Meeting Date" type="date" value={formData.stage1.pag_meeting_date} onChange={(v) => handleInputChange("stage1", "pag_meeting_date", v)} />
                        <InputField label="SAIL Board Date" type="date" value={formData.stage1.sail_board_date} onChange={(v) => handleInputChange("stage1", "sail_board_date", v)} />
                        <InputField label="Stage-1 Sanction Date" type="date" value={formData.stage1.sanction_date} onChange={(v) => handleInputChange("stage1", "sanction_date", v)} />
                        <InputField label="Stage-1 Cost (Gross Cr)" type="number" value={formData.stage1.stage_1_cost_gross} onChange={(v) => handleInputChange("stage1", "stage_1_cost_gross", parseFloat(v))} />
                      </>
                    )}

                    {activeTab === "tender" && (
                      <>
                        <h2 className="col-span-1 xl:col-span-2 text-xl font-bold border-b border-zinc-800 pb-2 mb-2 text-white">Tender & Bid Evaluation</h2>
                        <InputField label="PR Initiation Date" type="date" value={formData.tender.pr_initiation_date} onChange={(v) => handleInputChange("tender", "pr_initiation_date", v)} />
                        <InputField label="Mode of Tender" type="text" value={formData.tender.tender_mode} onChange={(v) => handleInputChange("tender", "tender_mode", v)} />
                        <InputField label="NIT Number" type="text" value={formData.tender.nit_number} onChange={(v) => handleInputChange("tender", "nit_number", v)} />
                        <InputField label="NIT Date" type="date" value={formData.tender.nit_date} onChange={(v) => handleInputChange("tender", "nit_date", v)} />
                        <InputField label="Offers Received" type="number" value={formData.tender.offers_received} onChange={(v) => handleInputChange("tender", "offers_received", parseInt(v))} />
                        <InputField label="L1 Bidder Name" type="text" value={formData.tender.l1_name} onChange={(v) => handleInputChange("tender", "l1_name", v)} />
                      </>
                    )}

                    {activeTab === "stage2" && (
                      <>
                        <h2 className="col-span-1 xl:col-span-2 text-xl font-bold border-b border-zinc-800 pb-2 mb-2 text-white">Stage-II Details</h2>
                        <InputField label="Stage-2 Sanction Date" type="date" value={formData.stage2.stage_2_sanction_date} onChange={(v) => handleInputChange("stage2", "stage_2_sanction_date", v)} />
                        <InputField label="Firmed Cost (Net Cr)" type="number" value={formData.stage2.firmed_cost_net} onChange={(v) => handleInputChange("stage2", "firmed_cost_net", parseFloat(v))} />
                      </>
                    )}

                    {activeTab === "order" && (
                      <>
                        <h2 className="col-span-1 xl:col-span-2 text-xl font-bold border-b border-zinc-800 pb-2 mb-2 text-white">Execution Metrics</h2>
                        <InputField label="Party Name" type="text" value={formData.order.party_name} onChange={(v) => handleInputChange("order", "party_name", v)} />
                        <InputField label="PO Number" type="text" value={formData.order.po_number} onChange={(v) => handleInputChange("order", "po_number", v)} />
                        <InputField label="Effective Contract Date" type="date" value={formData.order.effective_date} onChange={(v) => handleInputChange("order", "effective_date", v)} />
                        <InputField label="Schedule Completion Date" type="date" value={formData.order.schedule_completion_date} onChange={(v) => handleInputChange("order", "schedule_completion_date", v)} />
                      </>
                    )}

                    {activeTab === "closure" && (
                      <>
                        <h2 className="col-span-1 xl:col-span-2 text-xl font-bold border-b border-zinc-800 pb-2 mb-2 text-white">Closure & Handover</h2>
                        <InputField label="PAC Date" type="date" value={formData.closure.pac_date} onChange={(v) => handleInputChange("closure", "pac_date", v)} />
                        <InputField label="Commissioning Date" type="date" value={formData.closure.commissioning_date} onChange={(v) => handleInputChange("closure", "commissioning_date", v)} />
                        <InputField label="FAC Date" type="date" value={formData.closure.fac_date} onChange={(v) => handleInputChange("closure", "fac_date", v)} />
                        <div className="col-span-1 xl:col-span-2">
                          <label className="block text-sm text-zinc-400 mb-2 font-medium">Delay Reasons / Remarks</label>
                          <textarea 
                            value={formData.closure.delay_reasons || ""}
                            onChange={(e) => handleInputChange("closure", "delay_reasons", e.target.value)}
                            className="w-full bg-zinc-950/50 border border-zinc-700 rounded-xl p-4 text-white outline-none focus:border-cyan-500 focus:bg-zinc-900 transition-all resize-none" 
                            rows={3}
                          />
                        </div>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Minimalist Input Component
function InputField({ label, type, value, onChange }: { label: string; type: string; value: any; onChange: (val: string) => void }) {
  return (
    <div>
      <label className="block text-sm text-zinc-400 mb-2 font-medium">{label}</label>
      <input 
        type={type} 
        value={value || ""} 
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950/50 border border-zinc-700 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-500 focus:bg-zinc-900 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all"
      />
    </div>
  );
}