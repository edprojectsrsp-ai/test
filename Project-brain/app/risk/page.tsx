"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, AlertCircle, CheckCircle2, ShieldQuestion, TrendingDown, DollarSign, Clock, RefreshCw } from "lucide-react";
import { PageHeader, LoadingState, EmptyState, Chip } from "@/ui";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1").replace(/\/$/, "");

type Indicator = { key: string; label: string; level: string; score: number; action: string };
type HeatmapItem = {
  package_id: number; package_name: string; is_scheme_mirror: boolean;
  scheme_id: number; scheme_name: string; scheme_code: string; scheme_type: string;
  overall_risk: "red" | "amber" | "green" | "unknown";
  indicators: Indicator[] | null;
};

const RISK_COLORS = {
  red:   { bg: "bg-red-500/10",     border: "border-red-500/40",    text: "text-red-400",     dot: "bg-red-500" },
  amber: { bg: "bg-amber-500/10",   border: "border-amber-500/40",  text: "text-amber-400",   dot: "bg-amber-500" },
  green: { bg: "bg-emerald-500/10", border: "border-emerald-500/40",text: "text-emerald-400", dot: "bg-emerald-500" },
  unknown:{ bg: "bg-zinc-800/30",   border: "border-zinc-700",      text: "text-zinc-400",    dot: "bg-zinc-500" },
};

const RULE_ICONS: Record<string, any> = {
  schedule_slip: TrendingDown, cost_overrun: DollarSign,
  no_progress_30d: Clock, retender_imminent: RefreshCw, missing_actuals: AlertCircle,
};

export default function RiskHeatmapPage() {
  const [items, setItems] = useState<HeatmapItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "red" | "amber">("all");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/risk/heatmap`).then(r => r.json()),
      fetch(`${API}/risk/summary`).then(r => r.json()),
    ]).then(([h, s]) => {
      setItems((h.items || []).filter((x: HeatmapItem) => !x.is_scheme_mirror));
      setSummary(s);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? items : items.filter(x => x.overall_risk === filter);

  return (
    <div className="min-h-screen p-8" style={{ color: "var(--ink)" }}>
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Risk Heatmap"
          subtitle="5 risk rules computed nightly across the portfolio — surfacing trouble before it grows."
          right={<Chip tone="critical" dot>Intelligence</Chip>}
        />

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard label="Red" value={summary.summary.red_count} color="red" icon={<AlertTriangle className="w-5 h-5" />} />
            <StatCard label="Amber" value={summary.summary.amber_count} color="amber" icon={<AlertCircle className="w-5 h-5" />} />
            <StatCard label="Green" value={summary.summary.green_count} color="green" icon={<CheckCircle2 className="w-5 h-5" />} />
            <StatCard label="Packages at risk" value={summary.summary.packages_at_risk} color="unknown" icon={<ShieldQuestion className="w-5 h-5" />} />
            <StatCard label="Schemes at risk" value={summary.summary.schemes_at_risk} color="unknown" icon={<ShieldQuestion className="w-5 h-5" />} />
          </div>
        )}

        <div className="flex gap-2 mb-4">
          {(["all", "red", "amber"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition
                ${filter === f
                  ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}>
              {f === "all" ? "All Packages" : f === "red" ? "Red Only" : "Amber+Red"}
            </button>
          ))}
        </div>

        {loading ? <LoadingState label="Loading risk data…" rows={6} /> :
         filtered.length === 0 ? (
           <EmptyState
             icon={<ShieldQuestion size={28} />}
             title="No packages match this filter"
             hint={filter === "all" ? "No risk items in the portfolio yet." : "Try the All Packages filter to see everything."}
           />
         ) :
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {filtered.map(item => (
             <motion.div key={item.package_id} layout
               initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
               className={`${RISK_COLORS[item.overall_risk].bg} ${RISK_COLORS[item.overall_risk].border} border rounded-xl p-4`}>
               <div className="flex items-start justify-between mb-2">
                 <div className="flex items-center gap-2">
                   <span className={`w-2 h-2 rounded-full ${RISK_COLORS[item.overall_risk].dot}`}></span>
                   <span className={`text-xs font-mono uppercase ${RISK_COLORS[item.overall_risk].text}`}>{item.overall_risk}</span>
                 </div>
                 <span className="text-xs text-zinc-500">{item.scheme_code}</span>
               </div>
               <h3 className="font-semibold text-zinc-100 mb-0.5 text-sm">{item.scheme_name}</h3>
               <p className="text-xs text-zinc-400 mb-3">{item.package_name}</p>
               {item.indicators && item.indicators.length > 0 && (
                 <div className="space-y-2 pt-2 border-t border-zinc-800/50">
                   {item.indicators.slice(0, 3).map((ind, i) => {
                     const Icon = RULE_ICONS[ind.key] || AlertCircle;
                     return (
                       <div key={i} className="flex items-start gap-2 text-xs">
                         <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${RISK_COLORS[ind.level as keyof typeof RISK_COLORS]?.text}`} />
                         <div>
                           <div className="text-zinc-300 font-medium">{ind.label}</div>
                           {ind.action && <div className="text-zinc-500 mt-0.5 leading-snug">{ind.action}</div>}
                         </div>
                       </div>
                     );
                   })}
                 </div>
               )}
             </motion.div>
           ))}
         </div>
        }
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: keyof typeof RISK_COLORS; icon: React.ReactNode }) {
  return (
    <div className={`${RISK_COLORS[color].bg} ${RISK_COLORS[color].border} border rounded-xl p-3`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={RISK_COLORS[color].text}>{icon}</span>
        <span className="text-xs text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${RISK_COLORS[color].text}`}>{value ?? 0}</div>
    </div>
  );
}
