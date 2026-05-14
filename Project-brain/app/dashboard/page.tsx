"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, AlertTriangle, CheckCircle, TrendingUp,
  IndianRupee, Layers, Clock, Building2, Bot, User, Send,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://localhost:8000/api/v1";

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
  scheduled_completion: string | null;
  expected_completion: string | null;
  delay: { delay_months: number; delay_category: string; color: string };
};

const COLOR_MAP: Record<string, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  gray: "#6b7280",
};

const BADGE_MAP: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  red: "bg-red-500/10 text-red-400 border-red-500/20",
  gray: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<SchemeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { role: "ai", content: "Dashboard loaded. Ask me about delays, CAPEX status, or any specific project." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/dashboard/summary`).then((r) => r.json()),
      fetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()),
    ])
      .then(([sum, cds]) => {
        setSummary(sum);
        setCards(Array.isArray(cds) ? cds : []);
      })
      .catch(() =>
        setError(
          "Failed to load dashboard. Ensure the backend is running and the GOD MODE migration has been applied."
        )
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping]);

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
      setChatMessages((p) => [
        ...p,
        { role: "ai", content: data.reply || "No response from Neural Engine." },
      ]);
    } catch {
      setChatMessages((p) => [
        ...p,
        { role: "ai", content: "Error connecting to Neural Engine." },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-cyan-400">
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}>
          Initializing Dashboard...
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 max-w-lg text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-semibold">{error}</p>
          <p className="text-zinc-500 text-sm mt-2 font-mono">
            psql -U postgres -p 5433 -d project_brain -f god_mode_migration.sql
          </p>
        </div>
      </div>
    );
  }

  const ds = summary?.delay_summary;
  const donutData = [
    { name: "On Time", value: ds?.on_time ?? 0, color: "green" },
    { name: "Minor Delay", value: ds?.minor ?? 0, color: "yellow" },
    { name: "Moderate Delay", value: ds?.moderate ?? 0, color: "orange" },
    { name: "Critical Delay", value: ds?.critical ?? 0, color: "red" },
  ].filter((d) => d.value > 0);

  const totalDelayed = (ds?.minor ?? 0) + (ds?.moderate ?? 0) + (ds?.critical ?? 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-white p-6">

      {/* HEADER */}
      <header className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center gap-3">
            <LayoutDashboard className="h-8 w-8 text-cyan-400" />
            Portfolio Dashboard
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Capital Projects · {summary?.current_fy}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-4 py-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-cyan-300">Live Data</span>
        </div>
      </header>

      {/* MAIN 70/30 GRID */}
      <div className="grid flex-1 grid-cols-12 gap-6 overflow-hidden">

        {/* LEFT 70% */}
        <div className="col-span-8 flex flex-col gap-5 overflow-y-auto pr-2 pb-6">

          {/* KPI CARDS */}
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: "Total Schemes",
                value: summary?.total_schemes ?? 0,
                sub: "All active schemes",
                icon: Layers,
                border: "border-zinc-800",
                bg: "bg-zinc-900/50",
                iconBg: "bg-cyan-500/10 text-cyan-400",
              },
              {
                label: "Total CAPEX",
                value: `₹${(summary?.total_cost_cr ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`,
                sub: "Portfolio value",
                icon: IndianRupee,
                border: "border-violet-500/30",
                bg: "bg-violet-950/20",
                iconBg: "bg-violet-500/10 text-violet-400",
              },
              {
                label: "Ongoing",
                value: summary?.by_status?.ongoing ?? 0,
                sub: `${ds?.on_time ?? 0} on time`,
                icon: TrendingUp,
                border: "border-emerald-500/30",
                bg: "bg-emerald-950/20",
                iconBg: "bg-emerald-500/10 text-emerald-400",
              },
              {
                label: "Delayed",
                value: totalDelayed,
                sub: "Minor + Moderate + Critical",
                icon: AlertTriangle,
                border: "border-orange-500/30",
                bg: "bg-orange-950/20",
                iconBg: "bg-orange-500/10 text-orange-400",
              },
            ].map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <motion.div
                  key={kpi.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`rounded-2xl border ${kpi.border} ${kpi.bg} p-5 backdrop-blur-md flex items-center gap-4`}
                >
                  <div className={`rounded-xl p-3 shrink-0 ${kpi.iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">{kpi.label}</p>
                    <p className="text-2xl font-bold text-white">{kpi.value}</p>
                    {kpi.sub && <p className="text-[10px] text-zinc-500 mt-0.5">{kpi.sub}</p>}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* ANALYTICS ROW */}
          <div className="grid grid-cols-5 gap-4">

            {/* Delay Donut */}
            <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-md">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-400" /> Delay Classification
              </h3>
              {donutData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={65}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {donutData.map((entry, idx) => (
                          <Cell key={idx} fill={COLOR_MAP[entry.color]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "#18181b",
                          border: "1px solid #3f3f46",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        itemStyle={{ color: "#e4e4e7" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 mt-2">
                    {donutData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: COLOR_MAP[d.color] }}
                          />
                          <span className="text-zinc-400">{d.name}</span>
                        </div>
                        <span className="font-semibold text-white">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-500 py-10 text-center">No ongoing scheme data</p>
              )}
            </div>

            {/* By Status */}
            <div className="col-span-1 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-md">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-cyan-400" /> By Status
              </h3>
              <div className="space-y-3">
                {Object.entries(summary?.by_status ?? {}).map(([status, count]) => {
                  const pct = summary?.total_schemes
                    ? Math.round((count / summary.total_schemes) * 100)
                    : 0;
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-400 capitalize">{status.replace(/_/g, " ")}</span>
                        <span className="text-white font-medium">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By Type */}
            <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-md">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-400" /> By Scheme Type
              </h3>
              <div className="space-y-3">
                {Object.entries(summary?.by_type ?? {}).map(([type, count]) => {
                  const label = String(type)
                    .replace("SchemeType.", "")
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                  const pct = summary?.total_schemes
                    ? Math.round((count / summary.total_schemes) * 100)
                    : 0;
                  return (
                    <div key={type}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-400">{label}</span>
                        <span className="text-white font-medium">
                          {count} <span className="text-zinc-500">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SCHEME CARDS */}
          <div className="flex-1 min-h-0 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md flex flex-col overflow-hidden">
            <div className="flex items-center border-b border-zinc-800 px-5 py-3 shrink-0">
              <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-400" />
                Active Schemes
                <span className="ml-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400 border border-cyan-500/20">
                  {cards.length}
                </span>
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {cards.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-sm">
                  No active schemes found.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {cards.map((card, i) => {
                    const badgeCls = BADGE_MAP[card.delay?.color] ?? BADGE_MAP.gray;
                    return (
                      <motion.div
                        key={card.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 hover:border-zinc-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="text-sm font-medium text-white leading-snug line-clamp-2">
                            {card.name}
                          </h4>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeCls}`}>
                            {card.delay?.delay_category || "N/A"}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 capitalize">
                            {card.type.replace(/_/g, " ")}
                          </span>
                          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 capitalize">
                            {card.status.replace(/_/g, " ")}
                          </span>
                        </div>

                        <div className="space-y-0.5 text-xs text-zinc-500">
                          {card.cost_cr != null && (
                            <div className="flex justify-between">
                              <span>Cost</span>
                              <span className="text-zinc-300 font-medium">
                                ₹{card.cost_cr.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr
                              </span>
                            </div>
                          )}
                          {card.scheduled_completion && (
                            <div className="flex justify-between">
                              <span>Scheduled</span>
                              <span className="text-zinc-400">{card.scheduled_completion}</span>
                            </div>
                          )}
                          {card.expected_completion && (
                            <div className="flex justify-between">
                              <span>Expected</span>
                              <span className={card.delay?.color === "green" ? "text-emerald-400" : "text-orange-400"}>
                                {card.expected_completion}
                              </span>
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
        </div>

        {/* RIGHT: AI CHAT 30% */}
        <div className="col-span-4 flex flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#09090b] shadow-[0_0_30px_rgba(34,211,238,0.05)] backdrop-blur-xl relative">
          <div className="absolute inset-0 bg-gradient-to-br from-[#09090b] to-[#082f49] opacity-50 z-0 pointer-events-none" />

          <div className="relative z-10 border-b border-cyan-500/20 bg-black/40 p-4 backdrop-blur-md flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/20 border border-cyan-400/50 shadow-[0_0_15px_rgba(34,211,238,0.4)]">
              <Bot className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-semibold text-cyan-50">Neural Analyst</h2>
              <p className="text-xs text-cyan-400/70">Context-Aware Portfolio Intelligence</p>
            </div>
          </div>

          <div className="relative z-10 flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {chatMessages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    msg.role === "user"
                      ? "bg-zinc-800"
                      : "bg-cyan-900/50 border border-cyan-500/30"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="h-4 w-4 text-zinc-400" />
                  ) : (
                    <Bot className="h-4 w-4 text-cyan-400" />
                  )}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl p-3 text-sm ${
                    msg.role === "user"
                      ? "bg-zinc-800 text-zinc-200 rounded-tr-none"
                      : "bg-cyan-950/40 text-cyan-50 border border-cyan-500/20 rounded-tl-none"
                  }`}
                >
                  {msg.content}
                </div>
              </motion.div>
            ))}

            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-900/50 border border-cyan-500/30">
                  <Bot className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-none bg-cyan-950/40 border border-cyan-500/20 p-4">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:75ms]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:150ms]" />
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
              Project Brain LLM · Live dashboard context
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
