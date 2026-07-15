"use client";

import React, { useState, useEffect } from "react";
import { ArrowRight, Upload, Edit, Save, Plus, FileSpreadsheet, CheckCircle, Calendar, FileText, Lock, AlertCircle } from "lucide-react";

const STANDARD_ACTIVITIES = [
  "Basic Engineering", "Detailed Design Engineering", "Civil Work", "Equipment Foundation",
  "Building Steel Structures", "Mechanical Plant Supply", "Electrical Plant Supply",
  "Mechanical Erection", "Electrical Erection", "Commissioning"
];

const MONTHS = [
  { name: 'Apr', idx: 0 }, { name: 'May', idx: 1 }, { name: 'Jun', idx: 2 },
  { name: 'Jul', idx: 3 }, { name: 'Aug', idx: 4 }, { name: 'Sep', idx: 5 },
  { name: 'Oct', idx: 6 }, { name: 'Nov', idx: 7 }, { name: 'Dec', idx: 8 },
  { name: 'Jan', idx: 9 }, { name: 'Feb', idx: 10 }, { name: 'Mar', idx: 11 }
];

const UOM_OPTIONS = ["Cum", "MT", "Tons", "Lot", "Rmt", "SqM", "%"];

const getFYFromDate = (dateStr: string) => {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() >= 3 ? `${y}-${(y + 1).toString().slice(-2)}` : `${y - 1}-${y.toString().slice(-2)}`;
};

export default function CorporatePlannerWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [projectMeta, setProjectMeta] = useState<any>(null);

  const [hasAppx2, setHasAppx2] = useState(false);
  const [isEditingAppx2, setIsEditingAppx2] = useState(false);
  const [appendixActivities, setAppendixActivities] = useState<any[]>([]);

  const [baseFY, setBaseFY] = useState("");
  const [availableFYs, setAvailableFYs] = useState<string[]>([]);
  const [selectedFY, setSelectedFY] = useState("");
  const [revision, setRevision] = useState("Initial Plan");
  const [planName, setPlanName] = useState("");

  const [existingPlans, setExistingPlans] = useState([
    { id: 101, schemeId: "1", name: "Physical Progress Plan - FY 2024-25 (Initial Plan)", fy: "2024-25", rev: "Initial Plan", status: "Active", date: "12-Apr-2024",
      matrixData: [
        { id: 1, name: "Basic Engineering", uom: "%", scope: 100, weightage: 30, startIdx: 0, finishIdx: 5, expStart: "2024-04-01", expFinish: "2024-09-30", months: { Apr: 10, May: 30, Jun: 50, Jul: 70, Aug: 90, Sep: 100, Oct: 100, Nov: 100, Dec: 100, Jan: 100, Feb: 100, Mar: 100 } },
        { id: 2, name: "Civil Work", uom: "Cum", scope: 5000, weightage: 70, startIdx: 4, finishIdx: 11, expStart: "2024-08-15", expFinish: "2025-03-31", months: { Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 500, Sep: 1000, Oct: 2000, Nov: 3000, Dec: 4000, Jan: 4500, Feb: 4800, Mar: 5000 } }
      ]
    }
  ]);

  const [isDuplicatePlan, setIsDuplicatePlan] = useState(false);
  const [hasInitialPlan, setHasInitialPlan] = useState(false);
  const [plannerData, setPlannerData] = useState<any[]>([]);
  const [isMatrixEditing, setIsMatrixEditing] = useState(true);

  // MOCK DATABASE OF THE 7 NEW SCHEMES
  const dbSchemes = {
    "1": { name: "Blast Furnace #3 Modernization", schedStart: "2024-04-01", schedFinish: "2026-12-31" },
    "2": { name: "Coke Oven Battery 6 Rebuild", schedStart: "2025-06-15", schedFinish: "2027-10-31" },
    "3": { name: "New BOF Shop Construction", schedStart: "2026-01-10", schedFinish: "2029-06-30" },
    "4": { name: "Hot Strip Mill Expansion", schedStart: "2024-02-01", schedFinish: "2026-01-31" },
    "5": { name: "Slag Granulation Plant", schedStart: "2026-05-01", schedFinish: "2027-08-31" },
    "6": { name: "Oxygen Plant Upgrade", schedStart: "2025-01-15", schedFinish: "2026-11-30" },
    "7": { name: "Rail Mill Automation", schedStart: "2026-09-01", schedFinish: "2028-03-31" }
  };

  useEffect(() => {
    if (selectedScheme && dbSchemes[selectedScheme as keyof typeof dbSchemes]) {
      const scheme = dbSchemes[selectedScheme as keyof typeof dbSchemes];
      setProjectMeta({ ...scheme, expStart: scheme.schedStart, expFinish: scheme.schedFinish });
      setHasAppx2(true);

      // Mock Appendix 2 based on the project's start date
      setAppendixActivities([
        { id: 1, name: "Basic Engineering", schedStart: scheme.schedStart, schedFinish: scheme.schedFinish, expStart: scheme.schedStart, expFinish: scheme.schedFinish },
      ]);

      const projectFY = getFYFromDate(scheme.schedStart);
      setBaseFY(projectFY);
      setSelectedFY(projectFY);

      const startYear = parseInt(projectFY.split("-")[0]);
      setAvailableFYs(Array.from({ length: 5 }, (_, i) => `${startYear + i}-${(startYear + i + 1).toString().slice(-2)}`));
    }
  }, [selectedScheme]);

  useEffect(() => {
    if (selectedFY && revision) {
      setPlanName(`Physical Progress Plan - FY ${selectedFY} (${revision})`);
      setHasInitialPlan(existingPlans.some(p => p.schemeId === selectedScheme && p.rev === "Initial Plan"));
      setIsDuplicatePlan(existingPlans.some(p => p.schemeId === selectedScheme && p.fy === selectedFY && p.rev === revision));
    }
  }, [selectedFY, revision, selectedScheme, existingPlans]);

  const initializeMatrix = () => {
    if (isDuplicatePlan) return;
    const basePlan = existingPlans.find(p => p.schemeId === selectedScheme && p.rev === "Initial Plan");

    const initialPlanner = appendixActivities.map(act => {
      const startMonthIdx = new Date(act.expStart).getMonth() - 3;
      const finishMonthIdx = new Date(act.expFinish).getMonth() - 3;
      const inheritedData = basePlan ? basePlan.matrixData.find((b:any) => b.id === act.id) : null;

      return {
        ...act,
        uom: inheritedData ? inheritedData.uom : "Cum",
        scope: inheritedData ? inheritedData.scope : 0,
        weightage: inheritedData ? inheritedData.weightage : 0,
        startIdx: startMonthIdx >= 0 ? startMonthIdx : 0,
        finishIdx: finishMonthIdx >= 0 ? finishMonthIdx : 11,
        months: { Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0, Jan: 0, Feb: 0, Mar: 0 }
      };
    });
    setPlannerData(initialPlanner);
    setCurrentStep(4);
  };

  const handleEditPlan = (plan: any) => {
    setSelectedFY(plan.fy);
    setRevision(plan.rev);
    setPlanName(plan.name);
    setPlannerData(JSON.parse(JSON.stringify(plan.matrixData)));
    setIsMatrixEditing(true);
    setCurrentStep(4);
  };

  // ==========================================
  // STRICT ERP VALIDATIONS
  // ==========================================
  const isBasePlan = revision === "Initial Plan";
  const totalWeightage = plannerData.reduce((sum, item) => sum + (Number(item.weightage) || 0), 0);

  // 1. Initial Plan Validations
  const hasValidScopes = plannerData.every(item => item.scope > 0 && item.uom !== "");

  // 2. Universal Month-Wise Validation (Matches Scope or 100%)
  const hasValidMonthWisePlan = plannerData.every(item => {
    if (!item.months) return false;

    const finishMonthName = MONTHS[item.finishIdx >= 0 && item.finishIdx <= 11 ? item.finishIdx : 11].name;
    const finalMonthValue = Number(item.months[finishMonthName]) || 0;

    // RULE: If UOM is %, finish month MUST equal 100. Otherwise, finish month MUST equal exact Scope Qty.
    return item.uom === "%" ? finalMonthValue === 100 : finalMonthValue === item.scope;
  });

  // 3. The Master Gate
  const isValidMatrix = totalWeightage === 100 && hasValidScopes && hasValidMonthWisePlan;

  const schemePlans = existingPlans.filter(p => p.schemeId === selectedScheme);
  const getRevisionOptions = () => {
    const options = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];
    if (selectedFY === baseFY && !hasInitialPlan) return ["Initial Plan", ...options];
    return options;
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-gray-100 p-8 font-sans">

      {/* HEADER */}
      <div className="mb-8 border-b border-gray-800 pb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">Corporate Planning Engine</h1>
        </div>
        {projectMeta && (
          <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl text-xs flex gap-6 shadow-lg">
            <div>
              <p className="text-gray-500 font-bold mb-1 uppercase tracking-wider">Schedule Dates</p>
              <p className="text-gray-300">Start: <span className="text-white">{projectMeta.schedStart}</span></p>
              <p className="text-gray-300">Finish: <span className="text-white">{projectMeta.schedFinish}</span></p>
            </div>
            <div className="border-l border-gray-700 pl-6">
              <p className="text-blue-400 font-bold mb-1 uppercase tracking-wider">Expected Dates</p>
              <p className="text-gray-300">Start: <span className="text-blue-100">{projectMeta.expStart}</span></p>
              <p className="text-gray-300">Finish: <span className="text-blue-100">{projectMeta.expFinish}</span></p>
            </div>
          </div>
        )}
      </div>

      {/* STEP 1: SELECTION */}
      {currentStep === 1 && (
        <div className="bg-[#111115] border border-gray-800 rounded-xl p-8 max-w-xl">
          <h2 className="text-xl font-bold text-white mb-6">Select Corporate Scheme</h2>
          <select className="w-full bg-gray-900 border border-gray-700 rounded-lg p-4 text-white outline-none focus:border-cyan-500 mb-6"
            value={selectedScheme} onChange={(e) => setSelectedScheme(e.target.value)}>
            <option value="">-- Choose Scheme --</option>
            {Object.entries(dbSchemes).map(([id, scheme]) => (
              <option key={id} value={id}>{scheme.name}</option>
            ))}
          </select>
          <button disabled={!selectedScheme} onClick={() => setCurrentStep(2)}
            className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 py-3 rounded-lg font-bold disabled:opacity-50">
            Proceed to Appendix-2 <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* STEP 2: APPX-2 GATE */}
      {currentStep === 2 && (
        <div className="bg-[#111115] border border-gray-800 rounded-xl p-6 shadow-2xl animate-fade-in">
          <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="text-cyan-400" /> Appendix-2 Baseline Master
            </h2>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm text-gray-300 transition-all border border-gray-700">
                <Upload size={16} className="text-cyan-400" /> Upload Appx-2
              </button>
              {/* RESTORED EDIT BUTTON */}
              {hasAppx2 && !isEditingAppx2 && (
                <button onClick={() => setIsEditingAppx2(true)} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm text-white transition-all border border-gray-700">
                  <Edit size={16} /> Edit Appx-2
                </button>
              )}
            </div>
          </div>

          {!hasAppx2 && !isEditingAppx2 ? (
            <div className="text-center py-12 bg-gray-900/30 rounded-xl border border-dashed border-gray-700">
              <p className="text-gray-400 mb-6">No Appendix-2 found for this project. Upload an Excel file or create it manually.</p>
              <button onClick={() => setIsEditingAppx2(true)} className="bg-gray-800 border border-gray-700 hover:border-cyan-500 px-6 py-3 rounded-lg font-semibold text-white transition-all">
                Create Manually
              </button>
            </div>
          ) : (
            <>
              {/* ADD ROW BUTTON (Only visible during edit) */}
              {isEditingAppx2 && (
                <div className="mb-4 flex justify-end">
                  <button onClick={() => {
                    const newId = appendixActivities.length ? Math.max(...appendixActivities.map(a => a.id)) + 1 : 1;
                    setAppendixActivities([...appendixActivities, {
                      id: newId,
                      name: "",
                      schedStart: projectMeta.schedStart,
                      schedFinish: projectMeta.schedFinish,
                      expStart: projectMeta.schedStart,
                      expFinish: projectMeta.schedFinish
                    }]);
                  }} className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-sm font-bold bg-cyan-900/20 px-3 py-1.5 rounded border border-cyan-900/50 transition-colors">
                    <Plus size={14} /> Add Activity Row
                  </button>
                </div>
              )}

              <div className="overflow-x-auto mb-6">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-900 border-b border-gray-800 text-xs uppercase tracking-wider text-gray-400">
                      <th className="p-3">Activity Name</th>
                      <th className="p-3">Sched. Start</th>
                      <th className="p-3">Sched. Finish</th>
                      <th className="p-3 text-blue-400">Exp. Start</th>
                      <th className="p-3 text-blue-400">Exp. Finish</th>
                      {isEditingAppx2 && <th className="p-3 text-center">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {appendixActivities.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="p-3 font-medium text-gray-200">
                          {isEditingAppx2 ? (
                            <input type="text" list="appx2-activities" value={row.name} onChange={(e) => { const d = [...appendixActivities]; d[idx].name = e.target.value; setAppendixActivities(d); }} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white outline-none focus:border-cyan-500" placeholder="Activity Name" />
                          ) : row.name}
                        </td>
                        <td className="p-3 text-gray-400">
                          {isEditingAppx2 ? <input type="date" value={row.schedStart} onChange={(e) => { const d = [...appendixActivities]; d[idx].schedStart = e.target.value; setAppendixActivities(d); }} className="bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white [color-scheme:dark]" /> : row.schedStart}
                        </td>
                        <td className="p-3 text-gray-400">
                          {isEditingAppx2 ? <input type="date" value={row.schedFinish} onChange={(e) => { const d = [...appendixActivities]; d[idx].schedFinish = e.target.value; setAppendixActivities(d); }} className="bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white [color-scheme:dark]" /> : row.schedFinish}
                        </td>
                        <td className="p-3 text-blue-300">
                          {isEditingAppx2 ? <input type="date" value={row.expStart} onChange={(e) => { const d = [...appendixActivities]; d[idx].expStart = e.target.value; setAppendixActivities(d); }} className="bg-blue-900/20 border border-blue-800 rounded p-2 text-sm text-blue-100 [color-scheme:dark]" /> : row.expStart}
                        </td>
                        <td className="p-3 text-blue-300">
                          {isEditingAppx2 ? <input type="date" value={row.expFinish} onChange={(e) => { const d = [...appendixActivities]; d[idx].expFinish = e.target.value; setAppendixActivities(d); }} className="bg-blue-900/20 border border-blue-800 rounded p-2 text-sm text-blue-100 [color-scheme:dark]" /> : row.expFinish}
                        </td>
                        {isEditingAppx2 && (
                          <td className="p-3 text-center">
                             <button onClick={() => setAppendixActivities(appendixActivities.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-300 text-xs font-semibold px-2 py-1 rounded border border-rose-900/50 bg-rose-900/20">Remove</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Datalist for Standard Activities */}
                {isEditingAppx2 && (
                  <datalist id="appx2-activities">
                    {STANDARD_ACTIVITIES.map(a => <option key={a} value={a} />)}
                  </datalist>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-4">
            {isEditingAppx2 ? (
              <button onClick={() => { setIsEditingAppx2(false); setHasAppx2(true); }} disabled={appendixActivities.length === 0} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-6 py-2 rounded-lg font-bold text-white transition-all disabled:opacity-50">
                <Save size={16}/> Save Appx-2
              </button>
            ) : (
              <button onClick={() => setCurrentStep(3)} disabled={!hasAppx2} className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 px-6 py-2 rounded-lg font-bold text-white transition-all disabled:opacity-50">
                Go to Plan Setup <ArrowRight size={18}/>
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 3: PLAN SETUP */}
      {currentStep === 3 && (
        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-1 bg-[#111115] border border-cyan-900/50 rounded-xl p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-6">Create New Plan</h2>
            <div className="space-y-4 mb-8">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase">Financial Year</label>
                <select value={selectedFY} onChange={(e) => setSelectedFY(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white mt-1">
                  {availableFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase">Revision Number</label>
                <select value={revision} onChange={(e) => setRevision(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white mt-1">
                  {getRevisionOptions().map(rev => <option key={rev} value={rev}>{rev}</option>)}
                </select>
              </div>
            </div>
            <button onClick={initializeMatrix} disabled={isDuplicatePlan || (!hasInitialPlan && revision !== "Initial Plan")} className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 py-3 rounded-lg font-bold text-white disabled:opacity-50">
              Initialize Matrix <ArrowRight size={18} />
            </button>
          </div>
          <div className="col-span-2 bg-[#111115] border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-6"><FileText size={20} className="inline mr-2 text-gray-400" /> Existing Plans</h2>
            <table className="w-full text-left border-collapse">
              <thead><tr className="bg-gray-900 text-xs uppercase text-gray-400"><th className="p-3">Plan Name</th><th className="p-3">FY</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead>
              <tbody className="divide-y divide-gray-800">
                {schemePlans.map(plan => (
                  <tr key={plan.id}>
                    <td className="p-3 text-gray-200">{plan.name}</td><td className="p-3 text-gray-400">{plan.fy}</td>
                    <td className="p-3"><span className="text-emerald-400 bg-emerald-900/40 px-2 py-1 rounded text-xs">{plan.status}</span></td>
                    <td className="p-3"><button onClick={() => handleEditPlan(plan)} className="text-cyan-400 hover:text-cyan-300 bg-gray-800 px-3 py-1.5 rounded text-sm"><Edit size={14} className="inline mr-1"/> Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 4: MATRIX */}
      {currentStep === 4 && (
        <div className="bg-[#111115] border border-gray-800 rounded-xl p-6 shadow-2xl">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white">{planName}</h2>
              {!isBasePlan && <p className="text-yellow-500/80 text-sm mt-2"><Lock size={14} className="inline"/> Baseline Scope & Weightage inherited from Initial Plan.</p>}
            </div>
            <div className={`px-4 py-2 border rounded-lg font-bold ${totalWeightage === 100 ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800' : 'bg-rose-900/30 text-rose-400 border-rose-800'}`}>
              Total Weightage: {totalWeightage}%
            </div>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-left border-collapse min-w-[1500px]">
              <thead>
                <tr className="bg-gray-900 text-xs uppercase text-gray-400">
                  <th className="p-3 sticky left-0 bg-gray-900 z-10 border-r border-gray-800 w-64">Activity</th>
                  <th className="p-3">UOM</th><th className="p-3">Scope Qty</th><th className="p-3">Weight %</th>
                  {MONTHS.map(m => <th key={m.name} className="p-3 text-center">{m.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {plannerData.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="p-3 sticky left-0 bg-[#111115] z-10 border-r border-gray-800">
                      <p className="font-medium text-gray-200 text-sm">{row.name}</p>
                      <p className="text-[10px] text-blue-400 mt-1">Exp: {row.expStart} - {row.expFinish}</p>
                    </td>

                    {/* STRICT LOCKING: Only editable if this is the "Initial Plan" */}
                    <td className="p-3">
                      <select disabled={!isMatrixEditing || !isBasePlan} value={row.uom} onChange={(e) => { const d = [...plannerData]; d[idx].uom = e.target.value; setPlannerData(d); }}
                        className="w-20 bg-gray-900 border border-gray-700 rounded p-1 text-xs outline-none disabled:opacity-50">
                        {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="p-3">
                      <input type="number" disabled={!isMatrixEditing || !isBasePlan || row.uom === "%"} value={row.scope || ""} onChange={(e) => { const d = [...plannerData]; d[idx].scope = Number(e.target.value); setPlannerData(d); }}
                        className="w-20 bg-gray-900 border border-gray-700 rounded p-1 text-center text-sm outline-none disabled:opacity-40" />
                    </td>
                    <td className="p-3">
                      <input type="number" disabled={!isMatrixEditing || !isBasePlan} value={row.weightage || ""} onChange={(e) => { const d = [...plannerData]; d[idx].weightage = Number(e.target.value); setPlannerData(d); }}
                        className="w-16 bg-gray-900 border border-gray-700 rounded p-1 text-center text-cyan-400 font-bold outline-none disabled:opacity-50"/>
                    </td>

                    {/* MONTH CELLS */}
                    {MONTHS.map((m) => {
                      const isBeforeStart = m.idx < row.startIdx;
                      const isAfterFinish = m.idx > row.finishIdx;
                      const isLocked = isBeforeStart || isAfterFinish || !isMatrixEditing;

                      return (
                        <td key={m.name} className="p-2">
                          <input type="number" max="100" min="0" disabled={isLocked}
                            value={isAfterFinish ? (row.uom === "%" ? 100 : row.scope) : (isBeforeStart ? 0 : row.months[m.name] || "")}
                            onChange={(e) => { const d = [...plannerData]; d[idx].months[m.name] = Number(e.target.value); setPlannerData(d); }}
                            className={`w-14 rounded p-1.5 text-center text-sm font-medium outline-none mx-auto block
                              ${isBeforeStart ? 'bg-gray-900/50 text-gray-600 border-transparent cursor-not-allowed' : ''}
                              ${isAfterFinish ? 'bg-emerald-900/20 text-emerald-600 border-transparent cursor-not-allowed' : ''}
                              ${!isLocked ? 'bg-gray-900 border border-gray-700 text-white focus:border-blue-500' : ''}
                            `} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center border-t border-gray-800 pt-6">
            <button onClick={() => setCurrentStep(3)} className="bg-gray-800 hover:bg-gray-700 px-6 py-3 rounded-lg font-bold text-gray-300">Back</button>

            <div className="flex items-center gap-4">
              {/* VALIDATION ERROR HELPER TEXT */}
              {!isValidMatrix && (
                <span className="text-rose-400 text-sm font-medium animate-pulse">
                  * Final month must match Scope/100%, and Total Weightage must be 100%.
                </span>
              )}
              <button disabled={!isValidMatrix} className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-6 py-3 rounded-lg font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed">
                <CheckCircle size={18} /> Validate & Activate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
