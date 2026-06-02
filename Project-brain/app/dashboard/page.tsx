"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, AlertTriangle, CheckCircle, TrendingUp,
  IndianRupee, Layers, Clock, Building2, Bot, User, Send,
  Activity, TrendingDown, FileText, ChevronDown, ChevronRight,
  RefreshCw, Printer, Download, BarChart2, GitBranch,
  ClipboardList, CreditCard, BookOpen, Cpu, Calendar,
  MapPin, Hash,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://localhost:8002/api/v1";

// ─── Types ──────────────────────────────────────────────────────────────────

type Summary = {
  total_schemes: number;
  total_cost_cr: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  delay_summary: { on_time: number; minor: number; moderate: number; critical: number };
  current_fy: string;
};

type SchemeCard = {
  id: number;
  name: string;
  type: string;
  status: string;
  cost_cr: number | null;
  sanctioned_cost_cr: number | null;
  scheduled_completion: string | null;
  expected_completion: string | null;
  delay: { delay_months: number; delay_category: string; color: string };
};

type SchemeDetail = {
  scheme_id: number;
  scheme_name: string;
  scheme_type: string;
  current_status: string;
  estimated_cost_cr: number | null;
  sanctioned_cost_cr: number | null;
  wbs_element: string | null;
  amr_no: string | null;
  planned_start_date: string | null;
  planned_completion_date: string | null;
  actual_start_date: string | null;
  contractor: string | null;
  contract_no: string | null;
  contract_value_cr: number | null;
  effective_date: string | null;
  schedule_completion_date: string | null;
  delay_days: number;
  status_key: string;
  status_text: string;
  status_color: string;
  stage1: Record<string, string | number | null> | null;
  stage2: Record<string, string | number | null> | null;
  tender: Record<string, string | number | null> | null;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  green: "#10b981", yellow: "#f59e0b", orange: "#f97316", red: "#ef4444", gray: "#6b7280",
};
const BADGE_MAP: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  orange: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
  gray: "bg-zinc-800 text-zinc-400 border-zinc-700",
};
const STATUS_BG: Record<string, string> = {
  on_track: "bg-emerald-600", at_risk: "bg-yellow-500", delayed: "bg-red-600",
};

function fyOptions(): string[] {
  const today = new Date();
  const yr = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return [`${yr + 1}-${String(yr + 2).slice(-2)}`, `${yr}-${String(yr + 1).slice(-2)}`,
    `${yr - 1}-${String(yr).slice(-2)}`, `${yr - 2}-${String(yr - 1).slice(-2)}`];
}

function monthOptions(): { value: string; label: string }[] {
  const months = [];
  const d = new Date();
  for (let i = 0; i < 24; i++) {
    const yr = d.getFullYear(), mo = d.getMonth() + 1;
    months.push({
      value: `${yr}-${String(mo).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

function fmt(v: number | null | undefined, dec = 2) {
  if (v == null) return "—";
  return `₹${Number(v).toFixed(dec)} Cr`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Module Nav buttons ──────────────────────────────────────────────────────

const MODULES = [
  { label: "Plan Engine", href: "/plan-engine", icon: GitBranch, color: "text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10" },
  { label: "DPR Entry", href: "/dpr", icon: ClipboardList, color: "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" },
  { label: "S-Curve", href: "/s-curve", icon: TrendingUp, color: "text-violet-400 border-violet-500/30 hover:bg-violet-500/10" },
  { label: "CAPEX", href: "/capex", icon: IndianRupee, color: "text-amber-400 border-amber-500/30 hover:bg-amber-500/10" },
  { label: "Appendix-2", href: "/appendix-2", icon: BookOpen, color: "text-blue-400 border-blue-500/30 hover:bg-blue-500/10" },
  { label: "Reports", href: "/reports", icon: FileText, color: "text-pink-400 border-pink-500/30 hover:bg-pink-500/10" },
  { label: "CPM Schedule", href: "/cpm", icon: Cpu, color: "text-orange-400 border-orange-500/30 hover:bg-orange-500/10" },
  { label: "Billing", href: "/billing", icon: CreditCard, color: "text-teal-400 border-teal-500/30 hover:bg-teal-500/10" },
  { label: "Corporate AMR", href: "/progress/corporate", icon: BarChart2, color: "text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10" },
  { label: "AI Assistant", href: "/ai", icon: Bot, color: "text-fuchsia-400 border-fuchsia-500/30 hover:bg-fuchsia-500/10" },
];

// ─── Milestone row helper ────────────────────────────────────────────────────

function MilestoneRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  const has = value != null && value !== "—";
  return (
    <div className="flex items-center justify-between py-1 border-b border-zinc-800/50 last:border-0">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</span>
      <span className={`text-[11px] font-medium ${has ? "text-zinc-200" : "text-zinc-600"}`}>
        {has ? (typeof value === "string" && value.includes("-") && value.length === 10 ? fmtDate(value) : value) : "Pending"}
      </span>
      <span className={`ml-2 h-2 w-2 rounded-full ${has ? "bg-emerald-400" : "bg-zinc-700"}`} />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<SchemeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Selectors
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(null);
  const [selectedFY, setSelectedFY] = useState(() => fyOptions()[1]);
  const [selectedMonth, setSelectedMonth] = useState(() => monthOptions()[0].value);

  // Project-wise data
  const [detail, setDetail] = useState<SchemeDetail | null>(null);
  const [physFin, setPhysFin] = useState<any>(null);
  const [capexSnap, setCapexSnap] = useState<any>(null);
  const [dprSummary, setDprSummary] = useState<any[]>([]);
  const [physLoading, setPhysLoading] = useState(false);

  // Corporate CAPEX
  const [corpCapex, setCorpCapex] = useState<any>(null);
  const [corpOpen, setCorpOpen] = useState(false);

  // AI Chat
  const [chatMessages, setChatMessages] = useState([
    { role: "ai", content: "Dashboard loaded. Ask me about delays, CAPEX status, or any specific project." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [aiProvider, setAiProvider] = useState("auto");
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`${API}/dashboard/summary`).then((r) => r.json()),
      fetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()),
      fetch(`${API}/dashboard/corporate-capex`).then((r) => r.json()),
    ])
      .then(([sum, cds, cc]) => {
        setSummary(sum);
        setCards(Array.isArray(cds) ? cds : []);
        setCorpCapex(cc);
      })
      .catch(() => setError("Failed to load dashboard. Ensure the backend is running on port 8002."))
      .finally(() => setLoading(false));
  }, []);

  // ── Scroll chat to bottom ───────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping]);

  // ── Load project-wise data when scheme/month changes ────────────────────
  useEffect(() => {
    if (!selectedSchemeId) {
      setDetail(null); setPhysFin(null); setCapexSnap(null); setDprSummary([]);
      return;
    }
    setPhysLoading(true);
    Promise.all([
      fetch(`${API}/dashboard/scheme-detail?scheme_id=${selectedSchemeId}`).then((r) => r.json()),
      fetch(`${API}/dashboard/physical-financial?scheme_id=${selectedSchemeId}&month=${selectedMonth}`).then((r) => r.json()),
      fetch(`${API}/dashboard/capex-snapshot?scheme_id=${selectedSchemeId}`).then((r) => r.json()),
      fetch(`${API}/dashboard/dpr-summary?scheme_id=${selectedSchemeId}`).then((r) => r.json()),
    ])
      .then(([det, pf, cs, dpr]) => {
        setDetail(det);
        setPhysFin(pf);
        setCapexSnap(cs);
        setDprSummary(Array.isArray(dpr) ? dpr : []);
      })
      .finally(() => setPhysLoading(false));
  }, [selectedSchemeId, selectedMonth]);

  // ── AI Chat ─────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChatMessages((p) => [...p, { role: "user", content: msg }]);
    setChatInput("");
    setIsTyping(true);
    try {
      const res = await fetch(`${API}/brain/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context: { summary, cards } }),
      });
      const data = await res.json();
      setChatMessages((p) => [...p, { role: "ai", content: data.reply || "No response." }]);
    } catch {
      setChatMessages((p) => [...p, { role: "ai", content: "Error connecting to Neural Engine." }]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Loading / Error ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-cyan-400 bg-zinc-950">
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}>
          Initializing Dashboard…
        </motion.div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-8 bg-zinc-950">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 max-w-lg text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  const ds = summary?.delay_summary;
  const donutData = [
    { name: "On Time", value: ds?.on_time ?? 0, color: "green" },
    { name: "Minor", value: ds?.minor ?? 0, color: "yellow" },
    { name: "Moderate", value: ds?.moderate ?? 0, color: "orange" },
    { name: "Critical", value: ds?.critical ?? 0, color: "red" },
  ].filter((d) => d.value > 0);

  const totalDelayed = (ds?.minor ?? 0) + (ds?.moderate ?? 0) + (ds?.critical ?? 0);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-white">

      {/* ═══════════════════ LEFT / MAIN CONTENT ═══════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── TOP HEADER ── */}
        <div className="shrink-0 bg-[#0b3d91] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-white" />
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                RSP Project Department — Executive Dashboard
              </h1>
              <p className="text-blue-200 text-[11px]">Rourkela Steel Plant · Capital Project Monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-blue-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Live · {summary?.current_fy}
          </div>
        </div>

        {/* ── CONTROLS ROW ── */}
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/80 px-5 py-2.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Building2 size={13} />
            <span>Scheme:</span>
          </div>
          <select
            value={selectedSchemeId || ""}
            onChange={(e) => setSelectedSchemeId(parseInt(e.target.value) || null)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/60 max-w-[280px] truncate"
          >
            <option value="">— All Schemes —</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.id} · {c.name.substring(0, 55)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Calendar size={13} /><span>FY:</span>
          </div>
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/60"
          >
            {fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock size={13} /><span>Month:</span>
          </div>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/60"
          >
            {monthOptions().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── KPI CARDS ── */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total Schemes", value: summary?.total_schemes ?? 0, sub: "Active portfolio", icon: Layers, cls: "border-zinc-800 bg-zinc-900/60", icn: "bg-cyan-500/10 text-cyan-400" },
              { label: "Total CAPEX", value: `₹${((summary?.total_cost_cr ?? 0) / 100).toFixed(0)}K Cr`, sub: "Sanctioned value", icon: IndianRupee, cls: "border-violet-500/30 bg-violet-950/20", icn: "bg-violet-500/10 text-violet-400" },
              { label: "Ongoing", value: (summary?.by_status?.ongoing ?? 0) + (summary?.by_status?.under_execution ?? 0), sub: `${ds?.on_time ?? 0} on track`, icon: TrendingUp, cls: "border-emerald-500/30 bg-emerald-950/20", icn: "bg-emerald-500/10 text-emerald-400" },
              { label: "Delayed", value: totalDelayed, sub: "All delay buckets", icon: AlertTriangle, cls: "border-orange-500/30 bg-orange-950/20", icn: "bg-orange-500/10 text-orange-400" },
              { label: "Critical", value: ds?.critical ?? 0, sub: "> 6 months overrun", icon: TrendingDown, cls: "border-red-500/30 bg-red-950/20", icn: "bg-red-500/10 text-red-400" },
            ].map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className={`rounded-xl border ${kpi.cls} p-4 flex items-center gap-3`}>
                  <div className={`rounded-lg p-2.5 shrink-0 ${kpi.icn}`}><Icon className="w-4 h-4" /></div>
                  <div>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{kpi.label}</p>
                    <p className="text-xl font-bold text-white">{kpi.value}</p>
                    <p className="text-[9px] text-zinc-500">{kpi.sub}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* ── ANALYTICS ROW: Delay donut + By Status + By Type ── */}
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-400" /> Delay Classification
              </h3>
              {donutData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {donutData.map((entry, idx) => <Cell key={idx} fill={COLOR_MAP[entry.color]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 11 }} itemStyle={{ color: "#e4e4e7" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    {donutData.map((d) => (
                      <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: COLOR_MAP[d.color] }} />
                        <span className="text-zinc-400">{d.name}</span>
                        <span className="ml-auto font-semibold text-white">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-500 py-8 text-center">No data</p>
              )}
            </div>

            <div className="col-span-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> By Status
              </h3>
              <div className="space-y-2.5">
                {Object.entries(summary?.by_status ?? {}).slice(0, 6).map(([status, count]) => {
                  const pct = summary?.total_schemes ? Math.round((count / summary.total_schemes) * 100) : 0;
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-zinc-400 capitalize">{status.replace(/_/g, " ")}</span>
                        <span className="text-white font-medium">{count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-violet-400" /> By Scheme Type
              </h3>
              <div className="space-y-2.5">
                {Object.entries(summary?.by_type ?? {}).map(([type, count]) => {
                  const label = String(type).replace("SchemeType.", "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  const pct = summary?.total_schemes ? Math.round((count / summary.total_schemes) * 100) : 0;
                  return (
                    <div key={type}>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-zinc-400">{label}</span>
                        <span className="text-white font-medium">{count} <span className="text-zinc-500">({pct}%)</span></span>
                      </div>
                      <div className="h-1 rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── PHYSICAL-FINANCIAL PANEL ── */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md overflow-hidden">
            {/* Header row: scheme selector + month picker */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-400" /> Physical-Financial Summary
              </h2>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSchemeId || ""}
                  onChange={(e) => setSelectedSchemeId(parseInt(e.target.value) || null)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/50 max-w-[200px] truncate"
                >
                  <option value="">— Select Scheme —</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>#{c.id} {c.name.substring(0, 45)}</option>
                  ))}
                </select>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
                >
                  {generateMonthOptions().map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

                      {/* Col 2: Stage-1 Approvals */}
                      <div className="p-4">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3 font-bold flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${detail.stage1 ? "bg-emerald-400" : "bg-zinc-600"}`} />
                          Stage-1 Approvals
                          {detail.stage1?.cost_gross_cr && (
                            <span className="ml-auto text-emerald-400">₹{Number(detail.stage1.cost_gross_cr).toFixed(2)} Cr</span>
                          )}
                        </p>
                        {detail.stage1 ? (
                          <div className="space-y-0">
                            <MilestoneRow label="COD Date" value={detail.stage1.cod_date as string} />
                            <MilestoneRow label="Corporate PAG" value={detail.stage1.corporate_pag_date as string} />
                            <MilestoneRow label="Chairman Approval" value={detail.stage1.chairman_approval_date as string} />
                            <MilestoneRow label="SAIL Board" value={detail.stage1.sail_board_date as string} />
                            <MilestoneRow label="Sanction Date" value={detail.stage1.sanction_date as string} />
                            <MilestoneRow label="Order Date" value={detail.stage1.order_date as string} />
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-600 italic">No Stage-1 record found</p>
                        )}

                        {/* Tender cycle */}
                        {detail.tender && (
                          <div className="mt-4">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-bold">Tender Cycle</p>
                            <MilestoneRow label="NIT Date" value={detail.tender.nit_date as string} />
                            <MilestoneRow label="TOD Original" value={detail.tender.tod_original_date as string} />
                            {detail.tender.awarded_value_cr && (
                              <MilestoneRow label="Awarded Value" value={`₹${Number(detail.tender.awarded_value_cr).toFixed(2)} Cr`} />
                            )}
                            <MilestoneRow label="Status" value={detail.tender.cycle_status as string} />
                          </div>
                        )}
                      </div>

                      {/* Col 3: Stage-2 + CAPEX snapshot */}
                      <div className="p-4">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3 font-bold flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${detail.stage2 ? "bg-blue-400" : "bg-zinc-600"}`} />
                          Stage-2 Approvals
                          {detail.stage2?.firmed_up_cost_gross_cr && (
                            <span className="ml-auto text-blue-400">₹{Number(detail.stage2.firmed_up_cost_gross_cr).toFixed(2)} Cr</span>
                          )}
                        </p>
                        {detail.stage2 ? (
                          <div className="space-y-0">
                            <MilestoneRow label="COD Date" value={detail.stage2.cod_date as string} />
                            <MilestoneRow label="PAG Date" value={detail.stage2.pag_date as string} />
                            <MilestoneRow label="Chairman Approval" value={detail.stage2.chairman_approval_date as string} />
                            <MilestoneRow label="Empowered Comm." value={detail.stage2.empowered_committee_date as string} />
                            <MilestoneRow label="Sanction Date" value={detail.stage2.sanction_date as string} />
                            <MilestoneRow label="Order Date" value={detail.stage2.order_date as string} />
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-600 italic">No Stage-2 record found</p>
                        )}

                        {/* CAPEX snapshot inline */}
                        {capexSnap && (
                          <div className="mt-4 bg-zinc-900 rounded-lg p-3">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-bold flex items-center gap-1.5">
                              <IndianRupee size={10} className="text-violet-400" /> CAPEX Snapshot
                              {capexSnap.pct_spent > 0 && (
                                <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold ${capexSnap.pct_spent > 90 ? "bg-red-500/20 text-red-400" : capexSnap.pct_spent > 70 ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                                  {capexSnap.pct_spent}% spent
                                </span>
                              )}
                            </p>
                            <div className="grid grid-cols-2 gap-1">
                              {[
                                { l: "Sanctioned", v: capexSnap.sanctioned_cost_cr, c: "text-zinc-300" },
                                { l: "Till Last FY", v: capexSnap.expenditure_till_last_fy, c: "text-zinc-400" },
                                { l: "BE (Current FY)", v: capexSnap.be_current_fy, c: "text-cyan-400" },
                                { l: "RE (Current FY)", v: capexSnap.re_current_fy, c: "text-blue-400" },
                                { l: "Actuals FY", v: capexSnap.actuals_current_fy, c: "text-emerald-400" },
                                { l: "Total Spent", v: capexSnap.total_spent, c: "text-violet-400" },
                              ].map(({ l, v, c }) => (
                                <div key={l} className="bg-zinc-950 rounded px-2 py-1">
                                  <div className="text-[8px] text-zinc-600 uppercase">{l}</div>
                                  <div className={`text-[11px] font-bold ${c}`}>{fmt(v)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Physical-Financial Table ── */}
                    <div className="border-x border-b border-zinc-700 rounded-b-xl overflow-hidden">
                      <div className="bg-zinc-900/60 px-4 py-2 border-b border-zinc-700 flex items-center gap-2">
                        <Activity size={13} className="text-cyan-400" />
                        <span className="text-xs font-semibold text-zinc-300">Physical-Financial Progress Summary</span>
                        <span className="ml-auto text-[10px] text-zinc-500">Month: {selectedMonth}</span>
                      </div>

                      {!physFin?.has_active_plan ? (
                        <div className="px-5 py-4 text-xs text-amber-400 bg-amber-500/5 flex items-center gap-2">
                          <AlertTriangle size={13} /> No locked baseline plan found. Go to Plan Engine to create and lock a plan.
                        </div>
                      ) : physFin.activities?.length === 0 ? (
                        <p className="px-5 py-4 text-xs text-zinc-500">No activities in locked plan.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] border-collapse">
                            <thead className="bg-zinc-900/80 sticky top-0">
                              <tr>
                                {["Activity", "Package", "Scope", "Till Last FY", "MTD Plan", "MTD Actual", "FY Plan", "FY Actual", "Cum. Plan", "Cum. Actual", "Deviation"].map((h) => (
                                  <th key={h} className="px-2.5 py-2 text-left text-zinc-400 font-bold uppercase tracking-wide whitespace-nowrap border-b border-zinc-800">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {physFin.activities.map((a: any, i: number) => {
                                const dev = a.cum_act - a.cum_plan;
                                const devCls = dev >= 0 ? "text-emerald-400" : dev >= -5 ? "text-amber-400" : "text-red-400";
                                return (
                                  <tr key={a.activity_id} className={`border-b border-zinc-800/40 hover:bg-zinc-900/40 ${i % 2 ? "bg-zinc-900/20" : ""}`}>
                                    <td className="px-2.5 py-1.5 text-zinc-200 max-w-[160px] truncate" title={a.activity_name}>{a.activity_name}</td>
                                    <td className="px-2.5 py-1.5 text-zinc-500 max-w-[90px] truncate" title={a.package_name}>{a.package_name?.split(" - ")[1] || a.package_name}</td>
                                    <td className="px-2.5 py-1.5 text-zinc-300 text-right">{a.scope}</td>
                                    <td className="px-2.5 py-1.5 text-zinc-400 text-right">{a.till_last_fy}</td>
                                    <td className="px-2.5 py-1.5 text-cyan-300 text-right">{a.mtd_plan}</td>
                                    <td className="px-2.5 py-1.5 text-emerald-300 text-right">{a.mtd_act}</td>
                                    <td className="px-2.5 py-1.5 text-cyan-400 text-right">{a.fy_plan}</td>
                                    <td className="px-2.5 py-1.5 text-emerald-400 text-right">{a.fy_act}</td>
                                    <td className="px-2.5 py-1.5 text-cyan-200 font-medium text-right">{a.cum_plan}</td>
                                    <td className={`px-2.5 py-1.5 font-bold text-right ${devCls}`}>{a.cum_act}</td>
                                    <td className={`px-2.5 py-1.5 font-bold text-right ${devCls}`}>
                                      {dev >= 0 ? "+" : ""}{dev.toFixed(2)}
                                    </td>
                                  </tr>
                                );
                              })}
                              {physFin.total && (
                                <tr className="bg-[#0b3d91]/20 font-bold border-t-2 border-zinc-700">
                                  <td className="px-2.5 py-2 text-zinc-200 uppercase tracking-widest" colSpan={2}>TOTAL</td>
                                  <td className="px-2.5 py-2 text-right text-zinc-200">{physFin.total.scope}</td>
                                  <td className="px-2.5 py-2 text-right text-zinc-400">{physFin.total.till_last_fy}</td>
                                  <td className="px-2.5 py-2 text-right text-cyan-300">{physFin.total.mtd_plan}</td>
                                  <td className="px-2.5 py-2 text-right text-emerald-300">{physFin.total.mtd_act}</td>
                                  <td className="px-2.5 py-2 text-right text-cyan-400">{physFin.total.fy_plan}</td>
                                  <td className="px-2.5 py-2 text-right text-emerald-400">{physFin.total.fy_act}</td>
                                  <td className="px-2.5 py-2 text-right text-cyan-200">{physFin.total.cum_plan}</td>
                                  <td className={`px-2.5 py-2 text-right font-bold ${(physFin.total.deviation ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {physFin.total.cum_act}
                                  </td>
                                  <td className={`px-2.5 py-2 text-right font-bold ${(physFin.total.deviation ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {(physFin.total.deviation ?? 0) >= 0 ? "+" : ""}{physFin.total.deviation}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* ── DPR Work Summary ── */}
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-2">
                        <FileText size={13} className="text-emerald-400" />
                        <span className="text-xs font-semibold text-zinc-300">Current Work Summary (DPR Insights)</span>
                      </div>
                      {dprSummary.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-zinc-500">No DPR entries yet for this scheme.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-zinc-800">
                                <th className="px-3 py-1.5 text-left text-zinc-500 font-semibold">Date</th>
                                <th className="px-3 py-1.5 text-left text-zinc-500 font-semibold">Activity</th>
                                <th className="px-3 py-1.5 text-left text-zinc-500 font-semibold">Package</th>
                                <th className="px-3 py-1.5 text-left text-zinc-500 font-semibold">Area of Work</th>
                                <th className="px-3 py-1.5 text-left text-zinc-500 font-semibold">Remarks</th>
                                <th className="px-3 py-1.5 text-right text-zinc-500 font-semibold">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dprSummary.map((d, i) => (
                                <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                                  <td className="px-3 py-1.5 text-zinc-400 whitespace-nowrap font-mono">{d.date}</td>
                                  <td className="px-3 py-1.5 text-zinc-200 max-w-[180px] truncate">{d.activity_name}</td>
                                  <td className="px-3 py-1.5 text-zinc-400 max-w-[80px] truncate">{d.package_name}</td>
                                  <td className="px-3 py-1.5 text-zinc-400 max-w-[120px] truncate">{d.area_of_work || "—"}</td>
                                  <td className="px-3 py-1.5 text-zinc-500 max-w-[160px] truncate">{d.remarks || "—"}</td>
                                  <td className="px-3 py-1.5 text-emerald-400 font-bold text-right">{d.actual_qty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── CORPORATE CAPEX TABLE (collapsible) ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <button
              onClick={() => setCorpOpen(!corpOpen)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <IndianRupee size={14} className="text-violet-400" />
                <span className="text-xs font-semibold text-zinc-300">Corporate CAPEX — All Schemes ({corpCapex?.schemes?.length ?? 0})</span>
                {corpCapex?.total && (
                  <span className="text-[10px] text-zinc-500 ml-2">
                    Sanctioned: {fmt(corpCapex.total.sanctioned_cost_cr)} · BE: {fmt(corpCapex.total.be_fy)} · Actual: {fmt(corpCapex.total.actuals_fy)}
                  </span>
                )}
              </div>
              {corpOpen ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
            </button>

            <AnimatePresence>
              {corpOpen && corpCapex?.schemes && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-[10px] border-collapse">
                      <thead className="bg-zinc-900/80 sticky top-0">
                        <tr className="border-b border-zinc-700">
                          <th className="px-3 py-2 text-left text-zinc-400 font-bold">#</th>
                          <th className="px-3 py-2 text-left text-zinc-400 font-bold">Scheme Name</th>
                          <th className="px-3 py-2 text-left text-zinc-400 font-bold">Type</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">Sanctioned</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">Till Last FY</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">BE FY</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">RE FY</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">Actuals FY</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">Total Spent</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">% Spent</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-bold">Var. vs BE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {corpCapex.schemes.map((s: any, i: number) => (
                          <tr key={s.scheme_id}
                            className={`border-b border-zinc-800/40 hover:bg-zinc-900/50 cursor-pointer ${selectedSchemeId === s.scheme_id ? "bg-cyan-950/20" : i % 2 ? "bg-zinc-900/10" : ""}`}
                            onClick={() => setSelectedSchemeId(s.scheme_id)}
                          >
                            <td className="px-3 py-1.5 text-zinc-500">{s.scheme_id}</td>
                            <td className="px-3 py-1.5 text-zinc-200 max-w-[220px] truncate" title={s.scheme_name}>{s.scheme_name}</td>
                            <td className="px-3 py-1.5 text-zinc-400 capitalize">{s.scheme_type}</td>
                            <td className="px-3 py-1.5 text-zinc-300 text-right">{s.sanctioned_cost_cr > 0 ? `₹${s.sanctioned_cost_cr}` : "—"}</td>
                            <td className="px-3 py-1.5 text-zinc-400 text-right">{s.cum_last_fy > 0 ? `₹${s.cum_last_fy}` : "—"}</td>
                            <td className="px-3 py-1.5 text-cyan-400 text-right">{s.be_fy > 0 ? `₹${s.be_fy}` : "—"}</td>
                            <td className="px-3 py-1.5 text-blue-400 text-right">{s.re_fy > 0 ? `₹${s.re_fy}` : "—"}</td>
                            <td className="px-3 py-1.5 text-emerald-400 text-right">{s.actuals_fy > 0 ? `₹${s.actuals_fy}` : "—"}</td>
                            <td className="px-3 py-1.5 text-violet-400 text-right">{s.total_spent > 0 ? `₹${s.total_spent}` : "—"}</td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${s.pct_spent > 90 ? "bg-red-500/20 text-red-400" : s.pct_spent > 70 ? "bg-amber-500/20 text-amber-400" : s.pct_spent > 0 ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-600"}`}>
                                {s.pct_spent > 0 ? `${s.pct_spent}%` : "—"}
                              </span>
                            </td>
                            <td className={`px-3 py-1.5 text-right font-bold ${s.variance_be >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {s.variance_be !== 0 ? (s.variance_be > 0 ? `+${s.variance_be}` : s.variance_be) : "—"}
                            </td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="bg-[#0b3d91]/20 font-bold border-t-2 border-zinc-700">
                          <td className="px-3 py-2 text-zinc-200 uppercase" colSpan={3}>PORTFOLIO TOTAL</td>
                          <td className="px-3 py-2 text-zinc-200 text-right">{fmt(corpCapex.total.sanctioned_cost_cr)}</td>
                          <td className="px-3 py-2 text-zinc-400 text-right">{fmt(corpCapex.total.cum_last_fy)}</td>
                          <td className="px-3 py-2 text-cyan-400 text-right">{fmt(corpCapex.total.be_fy)}</td>
                          <td className="px-3 py-2 text-blue-400 text-right">{fmt(corpCapex.total.re_fy)}</td>
                          <td className="px-3 py-2 text-emerald-400 text-right">{fmt(corpCapex.total.actuals_fy)}</td>
                          <td className="px-3 py-2 text-violet-400 text-right">{fmt(corpCapex.total.total_spent)}</td>
                          <td className="px-3 py-2" colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── SCHEME CARDS GRID ── */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
            <div className="flex items-center border-b border-zinc-800 px-4 py-2.5">
              <Building2 size={13} className="text-cyan-400 mr-2" />
              <h2 className="text-xs font-semibold text-zinc-300">
                Active Scheme Cards
                <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-400 border border-cyan-500/20">
                  {cards.length}
                </span>
              </h2>
            </div>
            <div className="p-3">
              {cards.length === 0 ? (
                <p className="py-8 text-center text-zinc-500 text-xs">No schemes found.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {cards.map((card, i) => {
                    const badgeCls = BADGE_MAP[card.delay?.color] ?? BADGE_MAP.gray;
                    const isSelected = selectedSchemeId === card.id;
                    return (
                      <motion.div key={card.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.015 }}
                        onClick={() => setSelectedSchemeId(isSelected ? null : card.id)}
                        className={`rounded-lg border p-3 cursor-pointer transition-all ${isSelected ? "border-cyan-500/60 bg-cyan-950/30 ring-1 ring-cyan-500/30" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <h4 className="text-[11px] font-medium text-white leading-snug line-clamp-2">{card.name}</h4>
                          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${badgeCls}`}>
                            {card.delay?.delay_category || "N/A"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 capitalize">{card.type?.replace(/_/g, " ")}</span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 capitalize">{card.status?.replace(/_/g, " ")}</span>
                        </div>
                        <div className="space-y-0.5 text-[9px] text-zinc-500">
                          {card.cost_cr != null && (
                            <div className="flex justify-between">
                              <span>Cost</span>
                              <span className="text-zinc-300 font-medium">₹{card.cost_cr?.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr</span>
                            </div>
                          )}
                          {card.scheduled_completion && (
                            <div className="flex justify-between">
                              <span>Scheduled</span>
                              <span className="text-zinc-400">{card.scheduled_completion}</span>
                            </div>
                          )}
                          {(card.delay?.delay_months ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span>Overrun</span>
                              <span className="text-red-400">{card.delay.delay_months} mo.</span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
               MODULE NAVIGATION + EXPORT BUTTONS  (at the end)
          ══════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">

            {/* Module Navigation */}
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 font-bold">Quick Navigation — Modules</p>
              <div className="grid grid-cols-5 gap-2">
                {MODULES.map(({ label, href, icon: Icon, color }) => (
                  <button
                    key={href}
                    onClick={() => router.push(href)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${color}`}
                  >
                    <Icon size={14} className="shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export Buttons */}
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 font-bold">Export Dashboard</p>
              <div className="flex items-center gap-3">
                <button
                  disabled
                  title="Export PDF — coming in Sprint 7"
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-500 opacity-60 cursor-not-allowed"
                >
                  <Printer size={13} /> Export PDF
                </button>
                <button
                  disabled
                  title="Export DOCX — coming in Sprint 7"
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-500 opacity-60 cursor-not-allowed"
                >
                  <Download size={13} /> Export DOC
                </button>
                <button
                  disabled
                  title="Export PPT — coming in Sprint 7"
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-500 opacity-60 cursor-not-allowed"
                >
                  <BarChart2 size={13} /> Export PPT
                </button>
                <span className="text-[10px] text-zinc-600 italic ml-2">Export engine — Sprint 7</span>
              </div>
            </div>
          </div>

        </div>{/* end scrollable body */}
      </div>{/* end left panel */}

      {/* ═══════════════════ RIGHT: AI CHAT ═══════════════════ */}
      <div className="w-80 shrink-0 flex flex-col overflow-hidden border-l border-cyan-500/20 bg-[#09090b] relative">
        <div className="absolute inset-0 bg-gradient-to-br from-[#09090b] to-[#082f49] opacity-60 z-0 pointer-events-none" />

        <div className="relative z-10 border-b border-cyan-500/20 bg-black/40 p-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/20 border border-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.3)]">
            <Bot className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-cyan-50">Neural Analyst</h2>
            <p className="text-[10px] text-cyan-400/70">Context-Aware Intelligence</p>
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {chatMessages.map((msg, idx) => (
            <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${msg.role === "user" ? "bg-zinc-800" : "bg-cyan-900/50 border border-cyan-500/30"}`}>
                {msg.role === "user" ? <User className="h-3.5 w-3.5 text-zinc-400" /> : <Bot className="h-3.5 w-3.5 text-cyan-400" />}
              </div>
              <div className={`max-w-[82%] rounded-xl p-2.5 text-xs ${msg.role === "user" ? "bg-zinc-800 text-zinc-200 rounded-tr-none" : "bg-cyan-950/40 text-cyan-50 border border-cyan-500/20 rounded-tl-none"}`}>
                {msg.content}
              </div>
            </motion.div>
          ))}
          {isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-900/50 border border-cyan-500/30">
                <Bot className="h-3.5 w-3.5 text-cyan-400" />
              </div>
              <div className="flex items-center gap-1 rounded-xl rounded-tl-none bg-cyan-950/40 border border-cyan-500/20 px-3 py-2">
                {[0, 75, 150].map((delay) => (
                  <div key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>

          <div className="relative z-10 border-t border-cyan-500/20 bg-black/40 p-4 backdrop-blur-md">
            <div className="relative flex items-center">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask about delays, budgets, or specific projects..."
                className="w-full rounded-xl border border-cyan-500/30 bg-zinc-900/80 py-3 pl-4 pr-12 text-sm text-white placeholder-zinc-500 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim() || isTyping}
                className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/40 disabled:opacity-50 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-500">
              Project Brain LLM Â· Live dashboard context
            </p>
          </div>
          <p className="mt-1.5 text-center text-[9px] text-zinc-600">Project Brain LLM · Live context</p>
        </div>
      </div>

    </div>
  );
}
