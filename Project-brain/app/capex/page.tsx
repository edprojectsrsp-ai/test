"use client";
import { useState, useEffect } from "react";
import { useMos } from "@/components/brain/MosContext";
import {
  Save, Plus, ArrowDownToLine, Lock,
  Indent, Outdent, ArrowUp, ArrowDown, ShieldAlert,
  ChevronDown, ChevronRight, Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type MonthValue = { be: number; re: number; actual: number };
type RowLevel = "Header" | "SubHeader" | "Item";
type CapexRow = {
  id: string;
  name: string;
  level: RowLevel;
  indent: number;
  gross: number;
  cumLast: number;
  beFY: number;
  reFY: number;
  actualFY: number;
  months: Record<number, MonthValue>;
  isEditable: boolean;
};

const getEmptyMonths = () => {
  const m: Record<number, MonthValue> = {};
  for(let i=1; i<=12; i++) m[i] = { be: 0, re: 0, actual: 0 };
  return m;
};

export default function CapexWorkspace() {
  const { speakAndChat } = useMos();
  const [fy, setFy] = useState("2026-27");
  const [planStatus, setPlanStatus] = useState("Draft");
  const [planType, setPlanType] = useState("BE");
  const [effMonth, setEffMonth] = useState(10);

  const [rows, setRows] = useState<CapexRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  useEffect(() => {
    speakAndChat("CAPEX Hierarchical Engine initialized. Load an existing plan or import schemes to begin.", "📊");
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // --------------------------------------------------------
  // 1. IMPORT SCHEMES (Restored to YOUR exact robust logic)
  // --------------------------------------------------------
  const handleImportSchemes = async () => {
    if (planStatus !== "Draft") {
      return alert("Cannot import into an Approved/Locked plan.");
    }

    speakAndChat("Fetching schemes from database...", "⚡");

    try {
      const BACKEND_URL = "http://localhost:8000";
      const response = await fetch(`${BACKEND_URL}/api/v1/schemes/all`);

      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

      const dbSchemes = await response.json();
      console.log(`✅ Fetched ${dbSchemes.length} schemes from database`);

      const currentFY = parseInt(fy.split('-')[0]);
      const importedRows: CapexRow[] = [];

      importedRows.push({
        id: 'hA', name: "A. MEP Schemes", level: "Header", indent: 0,
        gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
        months: getEmptyMonths(), isEditable: false
      });

      const corporateCompleted: CapexRow[] = [];
      const corporateOngoing: CapexRow[] = [];
      const plantCompleted: CapexRow[] = [];
      const plantOngoing: CapexRow[] = [];
      const plantUpcoming: CapexRow[] = [];
      const capitalRepairs: CapexRow[] = [];
      const orderThisFY: CapexRow[] = [];
      const underTendering: CapexRow[] = [];
      const underStage1: CapexRow[] = [];
      const underFormulation: CapexRow[] = [];

      dbSchemes.forEach((scheme: any) => {
        const item: CapexRow = {
          id: `sch_${scheme.scheme_id}`,
          name: scheme.scheme_name || "Unnamed Scheme",
          level: "Item",
          indent: 2,
          gross: Number(scheme.sanctioned_cost_cr) || Number(scheme.estimated_cost_cr) || 0,
          cumLast: 0,
          beFY: 0, reFY: 0, actualFY: 0,
          months: getEmptyMonths(),
          isEditable: true
        };

        const schemetype = String(scheme.scheme_type || '').toUpperCase().trim();
        const status = String(scheme.current_status || '').toUpperCase().trim();

        if (schemetype === 'DUMMY') capitalRepairs.push(item);
        else if (schemetype === 'CORPORATE') {
          if (status === 'CLOSED') corporateCompleted.push(item);
          else if (status === 'ONGOING') corporateOngoing.push(item);
          else if (status === 'UNDER_TENDERING' || status === 'UNDER_STAGE2') underTendering.push(item);
          else if (status === 'UNDER_STAGE1') underStage1.push(item);
          else if (status === 'UNDER_FORMULATION') underFormulation.push(item);
        } 
        else if (schemetype === 'PLANT') {
          if (status === 'CLOSED') plantCompleted.push(item);
          else if (status === 'ONGOING') plantOngoing.push(item);
          else plantUpcoming.push(item);
        }

        if (scheme.effective_date) {
          try {
            if (new Date(scheme.effective_date).getFullYear() === currentFY) orderThisFY.push(item);
          } catch (e) {}
        }
      });

      const addSection = (headerName: string, subHeaderName: string, items: CapexRow[]) => {
        const headerId = `h${headerName.replace(/[^a-zA-Z0-9]/g, '')}`;
        importedRows.push({ id: headerId, name: headerName, level: "Header", indent: 0, gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0, months: getEmptyMonths(), isEditable: false });
        importedRows.push({ id: `sh${headerName.replace(/[^a-zA-Z0-9]/g, '')}`, name: subHeaderName, level: "SubHeader", indent: 1, gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0, months: getEmptyMonths(), isEditable: false });
        items.forEach(item => importedRows.push({ ...item, indent: 2 }));
      };

      addSection("B1. Completed Corporate", "Completed Corporate", corporateCompleted);
      addSection("B2. Ongoing Corporate", "Ongoing Corporate", corporateOngoing);
      addSection("B3.1 Completed Plant", "Completed Plant", plantCompleted);
      addSection("B3.2 Ongoing Plant", "Ongoing Plant", plantOngoing);
      addSection("B3.3 Upcoming Plant", "Upcoming Plant", plantUpcoming);

      importedRows.push({ id: 'hC', name: "C. Capital Repairs", level: "Header", indent: 0, gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0, months: getEmptyMonths(), isEditable: false });
      capitalRepairs.forEach(item => { item.indent = 1; importedRows.push(item); });

      addSection("D1. Order Placed this FY", "Order Placed this FY", orderThisFY);
      addSection("D2. Under Tendering", "Under Tendering", underTendering);
      addSection("D3. Under Stage-I", "Under Stage-I", underStage1);
      addSection("D4. Under Formulation", "Under Formulation", underFormulation);

      recalculateRollups(importedRows);
      speakAndChat(`Successfully imported ${dbSchemes.length} schemes!`, "✅");

    } catch (error: any) {
      console.error("Import Error:", error);
      speakAndChat("Failed to fetch schemes from backend.", "❌");
      alert(`Import Failed!\n\n${error.message}`);
    }
  };

  // --------------------------------------------------------
  // 2. MATHEMATICAL ENGINE
  // --------------------------------------------------------
  const recalculateRollups = (currentRows: CapexRow[]) => {
    let newRows = [...currentRows];
    for (let i = newRows.length - 1; i >= 0; i--) {
      if (newRows[i].level === 'Item') continue;
      newRows[i].gross = 0; newRows[i].cumLast = 0; newRows[i].beFY = 0; newRows[i].actualFY = 0;
      const targetIndent = newRows[i].indent + 1;
      for (let j = i + 1; j < newRows.length; j++) {
        if (newRows[j].indent <= newRows[i].indent) break;
        if (newRows[j].indent === targetIndent) {
          newRows[i].gross += Number(newRows[j].gross) || 0;
          newRows[i].cumLast += Number(newRows[j].cumLast) || 0;
          newRows[i].beFY += Number(newRows[j].beFY) || 0;
          newRows[i].actualFY += Number(newRows[j].actualFY) || 0;
        }
      }
    }
    setRows(newRows);
  };

  // --------------------------------------------------------
  // 3. TREE MANIPULATION
  // --------------------------------------------------------
  const handleIndent = (index: number) => {
    if (planStatus !== "Draft" || index === 0) return;
    const newRows = [...rows];
    const maxIndent = newRows[index - 1].indent + 1;
    if (newRows[index].indent < maxIndent && newRows[index].indent < 2) {
      newRows[index].indent += 1;
      newRows[index].level = newRows[index].indent === 0 ? 'Header' : newRows[index].indent === 1 ? 'SubHeader' : 'Item';
      newRows[index].isEditable = newRows[index].level === 'Item';
      recalculateRollups(newRows);
    }
  };

  const handleOutdent = (index: number) => {
    if (planStatus !== "Draft" || rows[index].indent === 0) return;
    const newRows = [...rows];
    newRows[index].indent -= 1;
    newRows[index].level = newRows[index].indent === 0 ? 'Header' : newRows[index].indent === 1 ? 'SubHeader' : 'Item';
    newRows[index].isEditable = newRows[index].level === 'Item';
    recalculateRollups(newRows);
  };

  const moveRow = (index: number, direction: "up" | "down") => {
    if (planStatus !== "Draft") return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === rows.length - 1) return;
    const newRows = [...rows];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    [newRows[index], newRows[swapIdx]] = [newRows[swapIdx], newRows[index]];
    recalculateRollups(newRows);
  };

  // --------------------------------------------------------
  // 4. VALUE EDITS & VALIDATION
  // --------------------------------------------------------
  const handleCellEdit = (index: number, field: "gross" | "cumLast", value: string) => {
    if (!rows[index].isEditable || planStatus !== "Draft") return;
    const newRows = [...rows];
    newRows[index][field] = Number(value) || 0;
    if (field === 'cumLast' && newRows[index].cumLast > newRows[index].gross) {
      speakAndChat(`Warning: Cumulative > Gross on ${newRows[index].name}`, "⚠️");
    }
    recalculateRollups(newRows);
  };

  const handleMonthEdit = (index: number, monthNo: number, type: "be" | "re" | "actual", value: string) => {
    if (!rows[index].isEditable || planStatus !== "Draft") return;
    if (planType === "RE" && type === "re" && monthNo < effMonth) {
      return alert("RE cells locked before Effective Month.");
    }
    const newRows = [...rows];
    newRows[index].months[monthNo][type] = Number(value) || 0;

    let totalBE = 0, totalActual = 0;
    for (let m = 1; m <= 12; m++) {
      totalBE += newRows[index].months[m].be;
      totalActual += newRows[index].months[m].actual;
    }
    newRows[index].beFY = totalBE;
    newRows[index].actualFY = totalActual;
    recalculateRollups(newRows);
  };

  const handleValidate = () => {
    const errors = rows.filter(r => r.level === 'Item' && r.gross < 0).length;
    if (errors > 0) alert("Validation Failed: Negative Gross Costs found.");
    else speakAndChat("Validation Passed. Ready for Approval.", "✅");
  };

  const isRowVisible = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].indent < rows[index].indent) {
        if (expanded[rows[i].id] === false) return false;
      }
    }
    return true;
  };

  return (
    <div className="p-8 text-white min-h-screen bg-[#050505]">
      
      {/* PREMIUM TOP BAR */}
      <div className="flex justify-between items-center mb-8 bg-zinc-900/40 p-6 rounded-3xl border border-white/5 backdrop-blur-md">
        <div>
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">CAPEX COMMAND</h1>
          <div className="flex gap-4 mt-3">
            <select value={fy} onChange={(e) => setFy(e.target.value)} className="glass-input p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500">
              <option>2026-27</option>
            </select>
            <select value={planType} onChange={(e) => setPlanType(e.target.value)} className="glass-input p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500">
              <option value="BE">Budget Estimate (BE)</option>
              <option value="RE">Revised Estimate (RE)</option>
            </select>
            {planType === "RE" && (
              <select value={effMonth} onChange={(e) => setEffMonth(Number(e.target.value))} className="glass-input p-1.5 text-xs rounded-lg bg-black/50 border border-amber-500/50 outline-none text-amber-400">
                <option value={10}>Eff: Oct</option>
                <option value={11}>Eff: Nov</option>
              </select>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 rounded-lg text-xs font-bold border border-white/5">
              Status: <span className={planStatus === 'Draft' ? 'text-amber-400' : 'text-emerald-400'}>{planStatus}</span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 flex-wrap max-w-2xl justify-end">
          <button onClick={handleImportSchemes} className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl font-bold hover:bg-cyan-400 transition-all text-sm shadow-lg shadow-cyan-500/20">
            <ArrowDownToLine size={16} /> Import Schemes
          </button>
          <button className="btn-glass px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center gap-2 border border-white/10"><Plus size={16}/> Add Row</button>
          <button onClick={handleValidate} className="btn-glass px-4 py-2 text-sm bg-blue-900/40 hover:bg-blue-800 text-blue-400 rounded-xl flex items-center gap-2 border border-blue-500/20"><ShieldAlert size={16}/> Validate</button>
          <button onClick={() => {recalculateRollups(rows); speakAndChat("Plan Saved", "💾");}} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)]"><Save size={16}/> Save</button>
          <button onClick={() => setPlanStatus("Approved")} className="btn-glass px-4 py-2 text-sm bg-purple-900/40 hover:bg-purple-800 text-purple-400 rounded-xl flex items-center gap-2 border border-purple-500/20"><Lock size={16}/> Approve</button>
        </div>
      </div>

      {/* MATRIX WORKSPACE */}
      <div className="bg-zinc-900/30 border border-white/10 rounded-[2.5rem] overflow-hidden backdrop-blur-2xl shadow-2xl pb-32">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap min-w-max">
            <thead>
              <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                <th className="p-6 sticky left-0 bg-[#0c0c0c] z-30">Reporting Hierarchy</th>
                <th className="p-6 text-right">Gross Cost</th>
                <th className="p-6 text-right">Cum. Actuals</th>
                <th className="p-6 text-right text-cyan-400">BE 2026-27</th>
                <th className="p-6 text-center border-l border-white/5 bg-zinc-800/20">APR Plan | Act</th>
                <th className="p-6 text-center bg-zinc-800/20">MAY Plan | Act</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                if (!isRowVisible(i)) return null;
                const isCollapsible = row.level !== 'Item';
                const isExpanded = expanded[row.id] !== false;

                return (
                  <tr 
                    key={row.id} 
                    onMouseEnter={() => setHoveredRow(row.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    className={`group border-b border-white/[0.03] hover:bg-white/[0.02] transition-all relative ${row.level === 'Header' ? 'bg-zinc-900/50' : ''}`}
                  >
                    <td className="p-6 sticky left-0 bg-[#0c0c0c] z-20 border-r border-white/5" style={{ paddingLeft: `${(row.indent * 2) + 1.5}rem` }}>
                      <div className="flex items-center gap-3">
                        {isCollapsible ? (
                          <button onClick={() => toggleExpand(row.id)} className="text-cyan-500 hover:scale-125 transition-transform">
                            {isExpanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                          </button>
                        ) : <div className="w-4 h-4 border-l-2 border-b-2 border-zinc-800 -mt-2 ml-1"/>}
                        <span className={`${row.level === 'Header' ? 'text-white font-bold text-lg' : row.level === 'SubHeader' ? 'text-zinc-300 font-semibold' : 'text-zinc-400'}`}>
                          {row.name}
                        </span>
                      </div>

                      {/* FLOATING ACTION PILL */}
                      <AnimatePresence>
                        {hoveredRow === row.id && planStatus === "Draft" && (
                          <motion.div 
                            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} 
                            className="absolute left-[100%] top-1/2 -translate-y-1/2 ml-4 flex gap-1 bg-zinc-800 p-1.5 rounded-2xl border border-white/10 shadow-2xl z-50 backdrop-blur-xl"
                          >
                            <button onClick={() => handleIndent(i)} className="p-2 hover:bg-cyan-600 rounded-xl transition-all text-zinc-300 hover:text-white"><Indent size={14}/></button>
                            <button onClick={() => handleOutdent(i)} className="p-2 hover:bg-cyan-600 rounded-xl transition-all text-zinc-300 hover:text-white"><Outdent size={14}/></button>
                            <div className="w-[1px] h-4 bg-white/10 self-center mx-1"/>
                            <button onClick={() => moveRow(i, 'up')} className="p-2 hover:bg-zinc-700 rounded-xl transition-all text-zinc-300 hover:text-white"><ArrowUp size={14}/></button>
                            <button onClick={() => moveRow(i, 'down')} className="p-2 hover:bg-zinc-700 rounded-xl transition-all text-zinc-300 hover:text-white"><ArrowDown size={14}/></button>
                            <button className="p-2 hover:bg-red-600/40 text-red-400 rounded-xl transition-all"><Trash2 size={14}/></button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>

                    <td className="p-4 text-right">
                      {row.isEditable ? (
                        <input type="number" value={row.gross || ''} onChange={(e) => handleCellEdit(i, 'gross', e.target.value)} className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg p-1.5 text-right outline-none focus:border-cyan-400 text-zinc-300 transition-all font-mono" />
                      ) : <span className="text-zinc-400 font-mono">₹ {row.gross.toFixed(2)}</span>}
                    </td>
                    
                    <td className="p-4 text-right">
                      {row.isEditable ? (
                        <input type="number" value={row.cumLast || ''} onChange={(e) => handleCellEdit(i, 'cumLast', e.target.value)} className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg p-1.5 text-right outline-none focus:border-cyan-400 text-zinc-500 transition-all font-mono" />
                      ) : <span className="text-zinc-500 font-mono">₹ {row.cumLast.toFixed(2)}</span>}
                    </td>

                    <td className="p-4 text-right font-mono text-cyan-400 font-bold underline decoration-cyan-500/20 underline-offset-4">₹ {row.beFY.toFixed(2)}</td>

                    {[4, 5].map(m => (
                      <td key={m} className="p-4 border-l border-white/5 bg-black/10">
                        <div className="flex gap-2 justify-center bg-zinc-950/50 p-2 rounded-2xl border border-white/5 focus-within:border-cyan-500/30 transition-all">
                          <input 
                            type="number" 
                            disabled={!row.isEditable} 
                            value={row.months[m]?.be || ''}
                            onChange={(e) => handleMonthEdit(i, m, 'be', e.target.value)}
                            className="w-12 bg-transparent text-xs text-center text-cyan-400 outline-none disabled:opacity-30 font-mono" 
                            placeholder="BE" 
                          />
                          <div className="w-[1px] h-4 bg-white/10 self-center"/>
                          <input 
                            type="number" 
                            disabled={!row.isEditable} 
                            value={row.months[m]?.actual || ''}
                            onChange={(e) => handleMonthEdit(i, m, 'actual', e.target.value)}
                            className="w-12 bg-transparent text-xs text-center text-emerald-400 outline-none disabled:opacity-30 font-mono" 
                            placeholder="ACT" 
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}