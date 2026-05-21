"use client";
import { useState, useEffect, useCallback } from "react";
import { useMos } from "@/components/brain/MosContext";
import {
  Save, Plus, ArrowDownToLine, Lock, Unlock,
  Indent, Outdent, ArrowUp, ArrowDown, ShieldAlert,
  ChevronDown, ChevronRight, Trash2, RefreshCw, Copy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = "http://localhost:8000/api/v1";

// =============================================================================
// Types
// =============================================================================
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
  scheme_id?: number | null;
  months: Record<number, MonthValue>;
  isEditable: boolean;
};

type PlanListItem = {
  id: number;
  fy_year: string;
  plan_type: string;
  plan_version: string | null;
  plan_status: string;
  is_effective: boolean;
  effective_from_month: number | null;
  created_by: string | null;
  created_at: string | null;
  row_count: number;
};

// =============================================================================
// Helpers
// =============================================================================
const getEmptyMonths = (): Record<number, MonthValue> => {
  const m: Record<number, MonthValue> = {};
  for (let i = 1; i <= 12; i++) m[i] = { be: 0, re: 0, actual: 0 };
  return m;
};

/** Pull a JWT off localStorage if there is one. Optional auth.  */
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("brain_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Decode the role off the JWT (without verifying) to gate the Unlock button. */
function getCurrentRole(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("brain_token");
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.role || null;
  } catch {
    return null;
  }
}

/**
 * Rebuild rollup totals. First pass: for ITEM rows, recompute beFY/actualFY
 * from their months array (this matters after load, since the server returns
 * actualFY=0 and we have to reconstruct from the months). Second pass:
 * sum item totals up into Header/SubHeader rows.
 */
function recomputeRollups(currentRows: CapexRow[]): CapexRow[] {
  const newRows = [...currentRows];

  // Pass 1 — items derive beFY / actualFY from their months
  for (let i = 0; i < newRows.length; i++) {
    if (newRows[i].level !== "Item") continue;
    let be = 0, act = 0;
    for (let m = 1; m <= 12; m++) {
      const mv = newRows[i].months[m];
      if (mv) { be += mv.be || 0; act += mv.actual || 0; }
    }
    newRows[i].beFY = be;
    newRows[i].actualFY = act;
  }

  // Pass 2 — parents sum their direct children
  for (let i = newRows.length - 1; i >= 0; i--) {
    if (newRows[i].level === "Item") continue;
    newRows[i].gross = 0;
    newRows[i].cumLast = 0;
    newRows[i].beFY = 0;
    newRows[i].actualFY = 0;
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
  return newRows;
}

/** Convert a server row into the local CapexRow shape. */
function serverRowToLocal(r: any): CapexRow {
  const months: Record<number, MonthValue> = getEmptyMonths();
  if (r.months && typeof r.months === "object") {
    for (const [k, v] of Object.entries<any>(r.months)) {
      const m = Number(k);
      if (m >= 1 && m <= 12) {
        months[m] = { be: Number(v.be) || 0, re: Number(v.re) || 0, actual: Number(v.actual) || 0 };
      }
    }
  }
  return {
    id: r.id,
    name: r.name,
    level: r.level as RowLevel,
    indent: r.indent || 0,
    gross: Number(r.gross) || 0,
    cumLast: Number(r.cumLast) || 0,
    beFY: Number(r.beFY) || 0,
    reFY: Number(r.reFY) || 0,
    actualFY: Number(r.actualFY) || 0,
    scheme_id: r.scheme_id ?? null,
    months,
    isEditable: r.isEditable !== false && r.level === "Item",
  };
}

// =============================================================================
// Component
// =============================================================================
export default function CapexWorkspace() {
  const { speakAndChat } = useMos();

  // Plan list and selection
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [planVersion, setPlanVersion] = useState<string>("v1");
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Plan attributes
  const [fy, setFy] = useState("2026-27");
  const [planStatus, setPlanStatus] = useState<string>("Draft");
  const [planType, setPlanType] = useState<string>("BE");
  const [effMonth, setEffMonth] = useState<number>(10);

  // Plan contents
  const [rows, setRows] = useState<CapexRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // Local "I have unsaved changes" tracker
  const [isDirty, setIsDirty] = useState(false);

  const role = getCurrentRole();
  const isAdmin = role === "admin";
  const isLocked = planStatus !== "Draft";
  const canEditRows = !isLocked;

  // ---------------------------------------------------------------------------
  // 1. Load plan list on mount
  // ---------------------------------------------------------------------------
  const refreshPlanList = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const res = await fetch(`${API_BASE}/capex/plans`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PlanListItem[] = await res.json();
      setPlans(data);
      return data;
    } catch (e: any) {
      speakAndChat(`Couldn't load plan list: ${e.message}`, "⚠️");
      return [];
    } finally {
      setLoadingPlans(false);
    }
  }, [speakAndChat]);

  useEffect(() => {
    speakAndChat("CAPEX Hierarchical Engine initialized.", "📊");
    refreshPlanList().then((list) => {
      if (list.length > 0) {
        // Auto-open the most recent plan
        loadPlan(list[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Load a specific plan into state
  // ---------------------------------------------------------------------------
  const loadPlan = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/capex/plans/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlanId(id);
      setFy(data.fy || "2026-27");
      setPlanType(data.planType || "BE");
      setPlanVersion(data.planVersion || "v1");
      setPlanStatus(data.status || "Draft");
      setEffMonth(data.effMonth || 10);
      const localRows = (data.rows || []).map(serverRowToLocal);
      setRows(recomputeRollups(localRows));
      setIsDirty(false);
      speakAndChat(`Loaded plan #${id} (${data.fy} ${data.planType})`, "📂");
    } catch (e: any) {
      speakAndChat(`Failed to load plan: ${e.message}`, "❌");
    }
  };

  // ---------------------------------------------------------------------------
  // 3. Build the body that backend expects
  // ---------------------------------------------------------------------------
  const buildPayload = () => ({
    fy,
    planType,
    planVersion,
    status: planStatus,
    effMonth: planType === "RE" ? effMonth : null,
    rows: rows.map((r) => ({
      name: r.name,
      level: r.level,
      indent: r.indent,
      gross: r.gross,
      cumLast: r.cumLast,
      beFY: r.beFY,
      reFY: r.reFY,
      actualFY: r.actualFY,
      scheme_id: r.scheme_id ?? null,
      months: Object.fromEntries(
        Object.entries(r.months).map(([k, v]) => [k, { be: v.be, re: v.re, actual: v.actual }]),
      ),
    })),
  });

  // ---------------------------------------------------------------------------
  // 4. Save (PUT existing OR POST new)
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    if (isLocked) {
      alert(
        `Plan is ${planStatus}. Ask an admin to unlock it before saving changes.`,
      );
      return;
    }
    if (rows.length === 0) {
      alert("Nothing to save. Import schemes or add rows first.");
      return;
    }

    setIsSaving(true);
    try {
      const url = planId
        ? `${API_BASE}/capex/plans/${planId}`
        : `${API_BASE}/capex/plans`;
      const res = await fetch(url, {
        method: planId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(buildPayload()),
      });

      if (res.status === 423) {
        const detail = await res.json().catch(() => ({ detail: "" }));
        alert(detail.detail || "Plan is locked. Ask an admin to unlock it.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      const saved = await res.json();
      setPlanId(saved.header?.id ?? planId);
      setPlanStatus(saved.status || "Draft");
      setIsDirty(false);
      speakAndChat("Plan saved to database", "💾");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Save failed: ${e.message}`, "❌");
      alert(`Save failed:\n\n${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsNewVersion = async () => {
    // Bump version number client-side, then force POST by clearing planId temporarily.
    const m = (planVersion || "v1").match(/^v(\d+)$/);
    const nextV = m ? `v${parseInt(m[1], 10) + 1}` : "v2";
    if (!confirm(`Save as new version (${planVersion} → ${nextV})?\n\nThis creates a brand-new plan and leaves the current one untouched.`)) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/capex/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...buildPayload(), planVersion: nextV }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const saved = await res.json();
      setPlanId(saved.header.id);
      setPlanVersion(nextV);
      setPlanStatus("Draft");
      setIsDirty(false);
      speakAndChat(`New version ${nextV} created`, "🌱");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Failed: ${e.message}`, "❌");
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 5. Approve / Unlock
  // ---------------------------------------------------------------------------
  const handleApprove = async () => {
    if (!planId) {
      alert("Save the plan first before approving.");
      return;
    }
    if (isDirty) {
      const proceed = confirm(
        "You have unsaved changes. Save first, then approve? (Cancel = approve without saving)",
      );
      if (proceed) {
        await handleSave();
      }
    }
    try {
      const res = await fetch(`${API_BASE}/capex/plans/${planId}/approve`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setPlanStatus("Approved");
      speakAndChat("Plan approved and locked", "🔒");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Approve failed: ${e.message}`, "❌");
    }
  };

  const handleUnlock = async () => {
    if (!planId) return;
    if (!isAdmin) {
      alert("Only admins can unlock approved plans.");
      return;
    }
    if (!confirm("Unlock this plan and revert to Draft so it can be edited?")) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/capex/plans/${planId}/unlock`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.status === 403) {
        alert("Server rejected unlock: admin role required.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setPlanStatus("Draft");
      speakAndChat("Plan unlocked (Draft)", "🔓");
      refreshPlanList();
    } catch (e: any) {
      speakAndChat(`Unlock failed: ${e.message}`, "❌");
    }
  };

  // ---------------------------------------------------------------------------
  // 6. Plan switcher + New
  // ---------------------------------------------------------------------------
  const handleSwitchPlan = (id: number) => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Discard and switch plans?")) return;
    }
    loadPlan(id);
  };

  const handleNewPlan = () => {
    if (isDirty && !confirm("Discard unsaved changes and start a new blank plan?")) return;
    setPlanId(null);
    setPlanVersion("v1");
    setPlanStatus("Draft");
    setRows([]);
    setIsDirty(false);
    speakAndChat("New blank plan. Import schemes to begin.", "🆕");
  };

  // ---------------------------------------------------------------------------
  // 7. Import schemes (existing logic, retained)
  // ---------------------------------------------------------------------------
  const handleImportSchemes = async () => {
    if (isLocked) {
      alert("Plan is locked. Ask an admin to unlock before importing.");
      return;
    }
    speakAndChat("Fetching schemes from database...", "⚡");
    try {
      const response = await fetch(`${API_BASE}/schemes/all`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dbSchemes = await response.json();
      const currentFY = parseInt(fy.split("-")[0]);
      const importedRows: CapexRow[] = [];

      importedRows.push({
        id: "hA", name: "A. MEP Schemes", level: "Header", indent: 0,
        gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
        months: getEmptyMonths(), isEditable: false,
      });

      const corpCompleted: CapexRow[] = [];
      const corpOngoing: CapexRow[] = [];
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
          cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
          scheme_id: scheme.scheme_id,
          months: getEmptyMonths(),
          isEditable: true,
        };
        const stype = String(scheme.scheme_type || "").toUpperCase().trim();
        const status = String(scheme.current_status || "").toUpperCase().trim();
        if (stype === "DUMMY") capitalRepairs.push(item);
        else if (stype === "CORPORATE") {
          if (status === "CLOSED") corpCompleted.push(item);
          else if (status === "ONGOING") corpOngoing.push(item);
          else if (status === "UNDER_TENDERING" || status === "UNDER_STAGE2") underTendering.push(item);
          else if (status === "UNDER_STAGE1") underStage1.push(item);
          else if (status === "UNDER_FORMULATION") underFormulation.push(item);
        } else if (stype === "PLANT") {
          if (status === "CLOSED") plantCompleted.push(item);
          else if (status === "ONGOING") plantOngoing.push(item);
          else plantUpcoming.push(item);
        }
        if (scheme.effective_date) {
          try {
            if (new Date(scheme.effective_date).getFullYear() === currentFY) orderThisFY.push(item);
          } catch {}
        }
      });

      const addSection = (headerName: string, subHeaderName: string, items: CapexRow[]) => {
        const cleanId = headerName.replace(/[^a-zA-Z0-9]/g, "");
        importedRows.push({
          id: `h${cleanId}`, name: headerName, level: "Header", indent: 0,
          gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
          months: getEmptyMonths(), isEditable: false,
        });
        importedRows.push({
          id: `sh${cleanId}`, name: subHeaderName, level: "SubHeader", indent: 1,
          gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
          months: getEmptyMonths(), isEditable: false,
        });
        items.forEach((item) => importedRows.push({ ...item, indent: 2 }));
      };

      addSection("B1. Completed Corporate", "Completed Corporate", corpCompleted);
      addSection("B2. Ongoing Corporate", "Ongoing Corporate", corpOngoing);
      addSection("B3.1 Completed Plant", "Completed Plant", plantCompleted);
      addSection("B3.2 Ongoing Plant", "Ongoing Plant", plantOngoing);
      addSection("B3.3 Upcoming Plant", "Upcoming Plant", plantUpcoming);

      importedRows.push({
        id: "hC", name: "C. Capital Repairs", level: "Header", indent: 0,
        gross: 0, cumLast: 0, beFY: 0, reFY: 0, actualFY: 0,
        months: getEmptyMonths(), isEditable: false,
      });
      capitalRepairs.forEach((item) => importedRows.push({ ...item, indent: 1 }));

      addSection("D1. Order Placed this FY", "Order Placed this FY", orderThisFY);
      addSection("D2. Under Tendering", "Under Tendering", underTendering);
      addSection("D3. Under Stage-I", "Under Stage-I", underStage1);
      addSection("D4. Under Formulation", "Under Formulation", underFormulation);

      setRows(recomputeRollups(importedRows));
      setIsDirty(true);
      speakAndChat(`Imported ${dbSchemes.length} schemes`, "✅");
    } catch (error: any) {
      speakAndChat("Failed to fetch schemes.", "❌");
      alert(`Import Failed!\n\n${error.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // 8. Tree manipulation (kept from original, now sets isDirty)
  // ---------------------------------------------------------------------------
  const handleIndent = (index: number) => {
    if (!canEditRows || index === 0) return;
    const newRows = [...rows];
    const maxIndent = newRows[index - 1].indent + 1;
    if (newRows[index].indent < maxIndent && newRows[index].indent < 2) {
      newRows[index].indent += 1;
      newRows[index].level =
        newRows[index].indent === 0 ? "Header" : newRows[index].indent === 1 ? "SubHeader" : "Item";
      newRows[index].isEditable = newRows[index].level === "Item";
      setRows(recomputeRollups(newRows));
      setIsDirty(true);
    }
  };

  const handleOutdent = (index: number) => {
    if (!canEditRows || rows[index].indent === 0) return;
    const newRows = [...rows];
    newRows[index].indent -= 1;
    newRows[index].level =
      newRows[index].indent === 0 ? "Header" : newRows[index].indent === 1 ? "SubHeader" : "Item";
    newRows[index].isEditable = newRows[index].level === "Item";
    setRows(recomputeRollups(newRows));
    setIsDirty(true);
  };

  const moveRow = (index: number, direction: "up" | "down") => {
    if (!canEditRows) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === rows.length - 1) return;
    const newRows = [...rows];
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    [newRows[index], newRows[swapIdx]] = [newRows[swapIdx], newRows[index]];
    setRows(recomputeRollups(newRows));
    setIsDirty(true);
  };

  const handleDeleteRow = (index: number) => {
    if (!canEditRows) return;
    if (!confirm(`Delete row "${rows[index].name}"?`)) return;
    const newRows = rows.filter((_, i) => i !== index);
    setRows(recomputeRollups(newRows));
    setIsDirty(true);
  };

  // ---------------------------------------------------------------------------
  // 9. Cell + month edits
  // ---------------------------------------------------------------------------
  const handleCellEdit = (index: number, field: "gross" | "cumLast", value: string) => {
    if (!rows[index].isEditable || !canEditRows) return;
    const newRows = [...rows];
    newRows[index][field] = Number(value) || 0;
    if (field === "cumLast" && newRows[index].cumLast > newRows[index].gross) {
      speakAndChat(`Warning: Cumulative > Gross on ${newRows[index].name}`, "⚠️");
    }
    setRows(recomputeRollups(newRows));
    setIsDirty(true);
  };

  const handleMonthEdit = (
    index: number, monthNo: number, type: "be" | "re" | "actual", value: string,
  ) => {
    if (!rows[index].isEditable || !canEditRows) return;
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
    setRows(recomputeRollups(newRows));
    setIsDirty(true);
  };

  const handleValidate = () => {
    const errors = rows.filter((r) => r.level === "Item" && r.gross < 0).length;
    if (errors > 0) alert("Validation Failed: Negative Gross Costs found.");
    else speakAndChat("Validation Passed. Ready for Approval.", "✅");
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isRowVisible = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].indent < rows[index].indent) {
        if (expanded[rows[i].id] === false) return false;
      }
    }
    return true;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="p-8 text-white min-h-screen bg-[#050505]">
      {/* TOP BAR */}
      <div className="flex justify-between items-center mb-6 bg-zinc-900/40 p-6 rounded-3xl border border-white/5 backdrop-blur-md">
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">
              CAPEX COMMAND
            </h1>
            {planId && (
              <span className="text-xs text-zinc-500 font-mono">
                Plan #{planId} · {planVersion}
              </span>
            )}
            {isDirty && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                unsaved changes
              </span>
            )}
          </div>

          <div className="flex gap-3 mt-3 flex-wrap items-center">
            {/* Plan picker */}
            <div className="flex items-center gap-2">
              <select
                value={planId ?? ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) handleSwitchPlan(v);
                }}
                disabled={loadingPlans}
                className="p-1.5 text-xs rounded-lg bg-black/50 border border-cyan-500/40 outline-none focus:border-cyan-400 min-w-[260px]"
              >
                <option value="">— Select Plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} · {p.fy_year} · {p.plan_type} · {p.plan_version} · {p.plan_status}
                    {p.row_count > 0 ? ` (${p.row_count} rows)` : " (empty)"}
                  </option>
                ))}
              </select>
              <button
                onClick={refreshPlanList}
                disabled={loadingPlans}
                title="Refresh plan list"
                className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 disabled:opacity-50"
              >
                <RefreshCw size={12} className={loadingPlans ? "animate-spin" : ""} />
              </button>
              <button
                onClick={handleNewPlan}
                className="p-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center gap-1"
              >
                <Plus size={12} /> New
              </button>
            </div>

            <select value={fy} onChange={(e) => { setFy(e.target.value); setIsDirty(true); }}
                    disabled={isLocked || !!planId}
                    title={planId ? "FY is fixed on saved plans. Create a new plan to change FY." : ""}
                    className="p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500 disabled:opacity-60">
              <option>2026-27</option>
              <option>2027-28</option>
            </select>
            <select value={planType} onChange={(e) => { setPlanType(e.target.value); setIsDirty(true); }}
                    disabled={isLocked || !!planId}
                    className="p-1.5 text-xs rounded-lg bg-black/50 border border-white/10 outline-none focus:border-cyan-500 disabled:opacity-60">
              <option value="BE">Budget Estimate (BE)</option>
              <option value="RE">Revised Estimate (RE)</option>
            </select>
            {planType === "RE" && (
              <select value={effMonth} onChange={(e) => { setEffMonth(Number(e.target.value)); setIsDirty(true); }}
                      disabled={isLocked}
                      className="p-1.5 text-xs rounded-lg bg-black/50 border border-amber-500/50 outline-none text-amber-400 disabled:opacity-60">
                <option value={10}>Eff: Oct</option>
                <option value={11}>Eff: Nov</option>
              </select>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 rounded-lg text-xs font-bold border border-white/5">
              Status:&nbsp;
              <span className={
                planStatus === "Draft" ? "text-amber-400" :
                planStatus === "Approved" ? "text-emerald-400" : "text-zinc-300"
              }>
                {planStatus}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap max-w-xl justify-end">
          <button onClick={handleImportSchemes} disabled={isLocked}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl font-bold hover:bg-cyan-400 transition-all text-sm shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed">
            <ArrowDownToLine size={16} /> Import Schemes
          </button>
          <button disabled={isLocked}
                  className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center gap-2 border border-white/10 disabled:opacity-50">
            <Plus size={16} /> Add Row
          </button>
          <button onClick={handleValidate}
                  className="px-4 py-2 text-sm bg-blue-900/40 hover:bg-blue-800 text-blue-400 rounded-xl flex items-center gap-2 border border-blue-500/20">
            <ShieldAlert size={16} /> Validate
          </button>
          <button onClick={handleSave} disabled={isSaving || isLocked}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
            <Save size={16} /> {isSaving ? "Saving..." : "Save"}
          </button>
          {planId && (
            <button onClick={handleSaveAsNewVersion} disabled={isSaving}
                    title="Create a new plan version from the current state"
                    className="px-4 py-2 text-sm bg-indigo-900/40 hover:bg-indigo-800 text-indigo-300 rounded-xl flex items-center gap-2 border border-indigo-500/20 disabled:opacity-50">
              <Copy size={16} /> Save As New Version
            </button>
          )}
          {planStatus === "Draft" ? (
            <button onClick={handleApprove}
                    className="px-4 py-2 text-sm bg-purple-900/40 hover:bg-purple-800 text-purple-400 rounded-xl flex items-center gap-2 border border-purple-500/20">
              <Lock size={16} /> Approve & Lock
            </button>
          ) : (
            <button onClick={handleUnlock} disabled={!isAdmin}
                    title={isAdmin ? "Admin: unlock back to Draft" : "Admin only"}
                    className={`px-4 py-2 text-sm rounded-xl flex items-center gap-2 border ${
                      isAdmin
                        ? "bg-rose-900/40 hover:bg-rose-800 text-rose-300 border-rose-500/20"
                        : "bg-zinc-900 text-zinc-600 border-white/5 cursor-not-allowed"
                    }`}>
              <Unlock size={16} /> {isAdmin ? "Unlock (Admin)" : "Locked (Admin only)"}
            </button>
          )}
        </div>
      </div>

      {/* MATRIX WORKSPACE */}
      <div className="bg-zinc-900/30 border border-white/10 rounded-[2.5rem] overflow-hidden backdrop-blur-2xl shadow-2xl pb-32">
        {rows.length === 0 ? (
          <div className="p-24 text-center">
            <p className="text-zinc-400 text-lg mb-2">No data in this plan yet.</p>
            <p className="text-zinc-600 text-sm mb-6">
              Import schemes from the database to populate the hierarchy, then edit values.
            </p>
            <button
              onClick={handleImportSchemes}
              disabled={isLocked}
              className="px-6 py-3 bg-white text-black rounded-xl font-bold hover:bg-cyan-400 disabled:opacity-50"
            >
              Import Schemes
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap min-w-max">
              <thead>
                <tr className="bg-white/[0.03] text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <th className="p-6 sticky left-0 bg-[#0c0c0c] z-30">Reporting Hierarchy</th>
                  <th className="p-6 text-right">Gross Cost</th>
                  <th className="p-6 text-right">Cum. Actuals</th>
                  <th className="p-6 text-right text-cyan-400">BE {fy}</th>
                  <th className="p-6 text-center border-l border-white/5 bg-zinc-800/20">APR Plan | Act</th>
                  <th className="p-6 text-center bg-zinc-800/20">MAY Plan | Act</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (!isRowVisible(i)) return null;
                  const isCollapsible = row.level !== "Item";
                  const isExpanded = expanded[row.id] !== false;
                  return (
                    <tr
                      key={row.id}
                      onMouseEnter={() => setHoveredRow(row.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`group border-b border-white/[0.03] hover:bg-white/[0.02] transition-all relative ${
                        row.level === "Header" ? "bg-zinc-900/50" : ""
                      }`}
                    >
                      <td className="p-6 sticky left-0 bg-[#0c0c0c] z-20 border-r border-white/5"
                          style={{ paddingLeft: `${(row.indent * 2) + 1.5}rem` }}>
                        <div className="flex items-center gap-3">
                          {isCollapsible ? (
                            <button onClick={() => toggleExpand(row.id)}
                                    className="text-cyan-500 hover:scale-125 transition-transform">
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </button>
                          ) : (
                            <div className="w-4 h-4 border-l-2 border-b-2 border-zinc-800 -mt-2 ml-1" />
                          )}
                          <span className={
                            row.level === "Header" ? "text-white font-bold text-lg" :
                            row.level === "SubHeader" ? "text-zinc-300 font-semibold" :
                            "text-zinc-400"
                          }>
                            {row.name}
                          </span>
                        </div>

                        <AnimatePresence>
                          {hoveredRow === row.id && canEditRows && (
                            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        className="absolute left-[100%] top-1/2 -translate-y-1/2 ml-4 flex gap-1 bg-zinc-800 p-1.5 rounded-2xl border border-white/10 shadow-2xl z-50 backdrop-blur-xl">
                              <button onClick={() => handleIndent(i)}
                                      className="p-2 hover:bg-cyan-600 rounded-xl transition-all text-zinc-300 hover:text-white">
                                <Indent size={14} />
                              </button>
                              <button onClick={() => handleOutdent(i)}
                                      className="p-2 hover:bg-cyan-600 rounded-xl transition-all text-zinc-300 hover:text-white">
                                <Outdent size={14} />
                              </button>
                              <div className="w-[1px] h-4 bg-white/10 self-center mx-1" />
                              <button onClick={() => moveRow(i, "up")}
                                      className="p-2 hover:bg-zinc-700 rounded-xl transition-all text-zinc-300 hover:text-white">
                                <ArrowUp size={14} />
                              </button>
                              <button onClick={() => moveRow(i, "down")}
                                      className="p-2 hover:bg-zinc-700 rounded-xl transition-all text-zinc-300 hover:text-white">
                                <ArrowDown size={14} />
                              </button>
                              <button onClick={() => handleDeleteRow(i)}
                                      className="p-2 hover:bg-red-600/40 text-red-400 rounded-xl transition-all">
                                <Trash2 size={14} />
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </td>

                      <td className="p-4 text-right">
                        {row.isEditable && canEditRows ? (
                          <input type="number" value={row.gross || ""}
                                 onChange={(e) => handleCellEdit(i, "gross", e.target.value)}
                                 className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg p-1.5 text-right outline-none focus:border-cyan-400 text-zinc-300 transition-all font-mono" />
                        ) : (
                          <span className="text-zinc-400 font-mono">₹ {row.gross.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {row.isEditable && canEditRows ? (
                          <input type="number" value={row.cumLast || ""}
                                 onChange={(e) => handleCellEdit(i, "cumLast", e.target.value)}
                                 className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg p-1.5 text-right outline-none focus:border-cyan-400 text-zinc-500 transition-all font-mono" />
                        ) : (
                          <span className="text-zinc-500 font-mono">₹ {row.cumLast.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono text-cyan-400 font-bold underline decoration-cyan-500/20 underline-offset-4">
                        ₹ {row.beFY.toFixed(2)}
                      </td>

                      {[4, 5].map((m) => (
                        <td key={m} className="p-4 border-l border-white/5 bg-black/10">
                          <div className="flex gap-2 justify-center bg-zinc-950/50 p-2 rounded-2xl border border-white/5 focus-within:border-cyan-500/30 transition-all">
                            <input type="number"
                                   disabled={!row.isEditable || !canEditRows}
                                   value={row.months[m]?.be || ""}
                                   onChange={(e) => handleMonthEdit(i, m, "be", e.target.value)}
                                   className="w-12 bg-transparent text-xs text-center text-cyan-400 outline-none disabled:opacity-30 font-mono"
                                   placeholder="BE" />
                            <div className="w-[1px] h-4 bg-white/10 self-center" />
                            <input type="number"
                                   disabled={!row.isEditable || !canEditRows}
                                   value={row.months[m]?.actual || ""}
                                   onChange={(e) => handleMonthEdit(i, m, "actual", e.target.value)}
                                   className="w-12 bg-transparent text-xs text-center text-emerald-400 outline-none disabled:opacity-30 font-mono"
                                   placeholder="ACT" />
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
