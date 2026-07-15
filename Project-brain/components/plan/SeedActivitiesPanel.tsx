"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, PlusCircle, Copy, AlertTriangle } from "lucide-react";

type PriorPlan = {
  plan_id: number;
  plan_name: string;
  plan_version: number;
  financial_year: string;
  is_locked: boolean;
  activity_count: number;
};

type SeedSourcesResponse = {
  package_id: number;
  master_activity_count: number;
  prior_plans: PriorPlan[];
};

type Props = {
  planId: number;
  packageId: number;
  isLocked?: boolean;
  onSeeded?: () => void;
};

const API_BASE = "http://localhost:8000/api/v1";

export default function SeedActivitiesPanel({ planId, packageId, isLocked, onSeeded }: Props) {
  const [sources, setSources] = useState<SeedSourcesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [priorPlanId, setPriorPlanId] = useState<number | null>(null);
  const [carryActuals, setCarryActuals] = useState(true);

  const locked = !!isLocked;

  const priorOptions = useMemo(() => sources?.prior_plans ?? [], [sources]);

  const loadSources = async () => {
    setErr("");
    try {
      const r = await fetch(`${API_BASE}/plan-seed/sources/${packageId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as SeedSourcesResponse;
      setSources(d);
      if (d.prior_plans?.length) setPriorPlanId((p) => p ?? d.prior_plans[0].plan_id);
    } catch (e: any) {
      setErr(e?.message || "Failed to load seed sources");
      setSources(null);
    }
  };

  useEffect(() => {
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const seedFromMaster = async () => {
    if (locked) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API_BASE}/plan-seed/plans/${planId}/seed-master`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      await r.json().catch(() => null);
      onSeeded?.();
      await loadSources();
    } catch (e: any) {
      setErr(e?.message || "Seeding from master failed");
    } finally {
      setBusy(false);
    }
  };

  const seedFromPrior = async () => {
    if (locked) return;
    if (!priorPlanId) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API_BASE}/plan-seed/plans/${planId}/seed-prior`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_plan_id: priorPlanId, carry_actuals: carryActuals }),
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      await r.json().catch(() => null);
      onSeeded?.();
      await loadSources();
    } catch (e: any) {
      setErr(e?.message || "Seeding from prior plan failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-200">Seed Activities</div>
          <div className="text-[11px] text-zinc-500">
            Quick-fill activities from the master library or copy from an older plan.
          </div>
        </div>
        <button
          onClick={loadSources}
          disabled={busy}
          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs flex items-center gap-2 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {locked && (
        <div className="mt-3 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} />
          Plan is locked. Create a new plan version to seed activities.
        </div>
      )}

      {err && (
        <div className="mt-3 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3 items-end">
        <div className="lg:col-span-1">
          <div className="text-[11px] text-zinc-500 mb-1">Master Library</div>
          <div className="text-xs text-zinc-300">
            {sources ? (
              <>
                {sources.master_activity_count} activities available
              </>
            ) : (
              "Unavailable"
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="text-[11px] text-zinc-500 mb-1">Copy From Prior Plan</div>
          <select
            value={priorPlanId ?? ""}
            onChange={(e) => setPriorPlanId(e.target.value ? Number(e.target.value) : null)}
            disabled={busy || locked || priorOptions.length === 0}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 disabled:opacity-50"
            title={priorOptions.length ? "Pick a plan to copy from" : "No prior plans with activities"}
          >
            <option value="">No prior plans</option>
            {priorOptions.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.financial_year} · v{p.plan_version} · {p.activity_count} acts · {p.plan_name}
              </option>
            ))}
          </select>
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 select-none">
            <input
              type="checkbox"
              checked={carryActuals}
              onChange={(e) => setCarryActuals(e.target.checked)}
              disabled={busy || locked || priorOptions.length === 0}
              className="accent-cyan-500"
            />
            Carry actuals till last FY
          </label>
        </div>

        <div className="lg:col-span-1 flex gap-2">
          <button
            onClick={seedFromMaster}
            disabled={busy || locked}
            className="flex-1 px-3 py-2 bg-cyan-700/40 hover:bg-cyan-700/60 border border-cyan-600/30 rounded-lg text-xs text-cyan-100 flex items-center justify-center gap-2 disabled:opacity-40"
            title="Seed activities from the master library"
          >
            <PlusCircle size={14} /> Seed master
          </button>
          <button
            onClick={seedFromPrior}
            disabled={busy || locked || !priorPlanId}
            className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-40"
            title="Copy activities from a prior plan"
          >
            <Copy size={14} /> Copy prior
          </button>
        </div>
      </div>
    </div>
  );
}
