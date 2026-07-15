"use client";

/**
 * Interactive What-If scenarios (C4) — three live levers over real data:
 *   1. Execution pace ×N   — scale the recent actual run-rate and project the
 *      completion month from the remaining weighted progress.
 *   2. Delay event (TIA)   — insert a fragnet on any activity via the delay
 *      engine; forecast completion shift = prima facie EOT.
 *   3. CAPEX re-phasing ×N — scale the remaining monthly plan and compare the
 *      projected FY outturn against BE.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FlaskConical, TrendingUp, IndianRupee, Zap } from "lucide-react";
import { exportPayload } from "@/lib/export";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const API = "http://localhost:8000/api/v1";

const num = (v: any, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

type Ctx = Record<string, any>;
type Row = { aid: string; name: string };

function monthShift(label: string, add: number) {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [mon, yy] = String(label || "Jan-26").split("-");
  let idx = M.indexOf(mon) + add;
  let year = 2000 + Number(yy || 26) + Math.floor(idx / 12);
  idx = ((idx % 12) + 12) % 12;
  return `${M[idx]}-${String(year).slice(2)}`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const cls = tone === "green" ? "text-emerald-400" : tone === "amber" ? "text-amber-400" : tone === "red" ? "text-red-400" : "text-[var(--ink)]";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-[10px] uppercase tracking-wide text-[var(--ink-4)]">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--ink-3)]">{sub}</p>}
    </div>
  );
}

export default function WhatIfPanel() {
  const [schemes, setSchemes] = useState<{ id: number; name: string }[]>([]);
  const [schemeId, setSchemeId] = useState("");
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [delayRows, setDelayRows] = useState<Row[]>([]);

  // levers
  const [pace, setPace] = useState(1.0);
  const [fragAid, setFragAid] = useState("");
  const [fragDays, setFragDays] = useState(60);
  const [tia, setTia] = useState<any>(null);
  const [capexScale, setCapexScale] = useState(1.0);

  useEffect(() => {
    fetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      setSchemes(d.map((s: any) => ({ id: s.id, name: s.name })));
      setSchemeId((c) => c || String(d.find((s: any) => s.id === 74)?.id || d[0]?.id || ""));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    fetch(`${API}/report-templates-data?scheme_id=${schemeId}`)
      .then((r) => r.json()).then((d) => alive && setCtx(d)).catch(() => {});
    fetch(`${API}/delay/schedule/${schemeId}`).then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDelayRows((d.rows || []).map((r: any) => ({ aid: r.aid, name: r.name })));
        setFragAid(d.suggestedTiaActivity || "");
      }).catch(() => setDelayRows([]));
    setTia(null);
    return () => { alive = false; };
  }, [schemeId]);

  const runTia = useCallback(() => {
    if (!schemeId) return;
    fetch(`${API}/delay/tia/${schemeId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_id: Number(fragAid) || -1, name: "What-if fragnet", party: "employer", days: fragDays }),
    }).then((r) => r.json()).then((d) => setTia(d.result || null)).catch(() => setTia(null));
  }, [schemeId, fragAid, fragDays]);

  // ── Scenario 1: pace — run-rate from last 3 actual months of scurve trend ──
  const paceModel = useMemo(() => {
    const trend: any[] = ctx?.scurve_trend || [];
    if (!trend.length || !ctx) return null;
    const actuals = trend.filter((t) => (t.monthlyActualPercent || 0) > 0);
    const last3 = actuals.slice(-3);
    const baseRate = last3.length ? last3.reduce((s, t) => s + t.monthlyActualPercent, 0) / last3.length : 0;
    const current = ctx.meta?.actualPercent ?? 0;
    const remaining = Math.max(0, 100 - current);
    const lastLabel = actuals.length ? actuals[actuals.length - 1].month : (trend[trend.length - 1]?.month || "Jan-26");
    const monthsAt = (rate: number) => (rate > 0.01 ? Math.ceil(remaining / rate) : null);
    const mBase = monthsAt(baseRate);
    const mAdj = monthsAt(baseRate * pace);
    // projected curve for chart
    const projected = trend.map((t) => ({ month: t.month, plan: t.cumulativePlanPercent, actual: t.cumulativeActualPercent }));
    let cum = current;
    let label = lastLabel;
    for (let i = 0; i < 24 && cum < 100; i++) {
      label = monthShift(label, 1);
      cum = Math.min(100, cum + baseRate * pace);
      projected.push({ month: label, plan: null as any, actual: null as any, projected: cum } as any);
    }
    return {
      baseRate, current, remaining,
      baseFinish: mBase != null ? monthShift(lastLabel, mBase) : "beyond horizon",
      adjFinish: mAdj != null ? monthShift(lastLabel, mAdj) : "beyond horizon",
      monthsSaved: mBase != null && mAdj != null ? mBase - mAdj : 0,
      chart: projected,
    };
  }, [ctx, pace]);

  // ── Scenario 3: capex re-phasing ──
  const capexModel = useMemo(() => {
    const monthly: any[] = ctx?.capex_monthly || [];
    if (!monthly.length || !ctx) return null;
    const actualSoFar = monthly.reduce((s, m) => s + (m.actual || 0), 0);
    const lastActualIdx = monthly.reduce((k, m, i) => ((m.actual || 0) > 0 ? i : k), -1);
    const remainingPlan = monthly.slice(lastActualIdx + 1).reduce((s, m) => s + (m.plan || 0), 0);
    const be = ctx.capex?.beFy || monthly.reduce((s, m) => s + (m.plan || 0), 0);
    const projected = actualSoFar + remainingPlan * capexScale;
    return { actualSoFar, remainingPlan, be, projected, vsBe: be ? (projected / be) * 100 : 0 };
  }, [ctx, capexScale]);

  const exportScenario = async () => {
    const schemeName = schemes.find((s) => String(s.id) === schemeId)?.name || schemeId;
    const payload = {
      title: "What-If Scenario Snapshot",
      project_label: schemeName,
      fy_label: ctx?.meta?.financialYear || "—",
      month_label: ctx?.meta?.month || "—",
      status_text: `Pace ${pace.toFixed(2)}× · Capex scale ${capexScale.toFixed(2)}×`,
      header_lines: [
        `Scheme: ${schemeName}`,
        `Current actual: ${ctx?.meta?.actualPercent ?? "—"}%`,
        `Pace model finish @ current: ${paceModel?.baseFinish || "—"}`,
        `Pace model finish @ ${pace.toFixed(2)}×: ${paceModel?.adjFinish || "—"}`,
        `Months saved: ${paceModel?.monthsSaved ?? "—"}`,
        tia ? `TIA slip days: ${tia.projectSlipDays ?? tia.slipDays ?? JSON.stringify(tia).slice(0, 80)}` : "TIA: not run",
        capexModel
          ? `CAPEX projected FY: ${capexModel.projected?.toFixed?.(2) ?? capexModel.projected} vs BE ${capexModel.be}`
          : "CAPEX: n/a",
      ],
      physical_text: `Execution pace lever ${pace}×\nBase rate ${paceModel?.baseRate ?? "—"}%/mo`,
      stage_text: tia ? `TIA fragnet ${fragDays}d on activity ${fragAid}` : "No TIA fragnet",
      capex_text: capexModel
        ? `Actual so far ${capexModel.actualSoFar}\nRemaining plan ${capexModel.remainingPlan}\nProjected ${capexModel.projected}\nvs BE ${capexModel.vsBe?.toFixed?.(1)}%`
        : "",
      dpr_summary: [],
      kpi_rows: [
        ["Pace multiplier", pace],
        ["Base finish", paceModel?.baseFinish],
        ["Adjusted finish", paceModel?.adjFinish],
        ["CAPEX scale", capexScale],
        ["CAPEX projected", capexModel?.projected],
      ],
      table_sections: [],
    };
    try {
      await exportPayload({ format: "pdf", payload, filenameStem: `WhatIf_${schemeId}` });
    } catch (e: any) {
      alert(e?.message || "Export failed");
    }
  };

  return (
    <div className="space-y-5 p-5" style={{ background: "var(--bg)", minHeight: "80vh" }}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
          <FlaskConical size={18} className="text-violet-400" /> What-If Scenarios
        </h2>
        <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)}
          className="ml-auto min-w-[260px] rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none">
          {schemes.map((s) => <option key={s.id} value={String(s.id)}>#{s.id} · {s.name.slice(0, 45)}</option>)}
        </select>
        <button type="button" onClick={exportScenario} disabled={!ctx}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50">
          <Download size={13} /> Export PDF
        </button>
      </div>

      {/* 1 · execution pace */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
          <TrendingUp size={15} className="text-emerald-400" /> Execution pace
        </p>
        <p className="mb-3 text-xs text-[var(--ink-3)]">
          Recent run-rate {num(paceModel?.baseRate)}%/month · currently {num(paceModel?.current)}% complete ·
          drag to model acceleration or slowdown
        </p>
        <div className="mb-4 flex items-center gap-3">
          <input type="range" min={0.25} max={3} step={0.05} value={pace}
            onChange={(e) => setPace(Number(e.target.value))} className="w-72" />
          <span className={`rounded-lg px-2 py-1 text-sm font-bold ${pace >= 1 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
            {pace.toFixed(2)}×
          </span>
        </div>
        {paceModel && (
          <>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <Stat label="Completion @ current pace" value={paceModel.baseFinish} />
              <Stat label={`Completion @ ${pace.toFixed(2)}×`} value={paceModel.adjFinish}
                tone={pace >= 1 ? "green" : "red"} />
              <Stat label="Months saved / lost" value={`${paceModel.monthsSaved >= 0 ? "" : "+"}${num(-paceModel.monthsSaved, 0)}`}
                sub={paceModel.monthsSaved >= 0 ? "saved vs current pace" : "additional months"}
                tone={paceModel.monthsSaved >= 0 ? "green" : "red"} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={paceModel.chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f4633" />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} interval={Math.ceil(paceModel.chart.length / 14)} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="plan" name="Plan" stroke="#38bdf8" strokeDasharray="6 3" dot={false} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="#34d399" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="projected" name={`Projected @ ${pace.toFixed(2)}×`} stroke="#a78bfa" strokeDasharray="2 3" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* 2 · delay event */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
          <Zap size={15} className="text-amber-400" /> Delay event (Time Impact Analysis)
        </p>
        <p className="mb-3 text-xs text-[var(--ink-3)]">Insert a hypothetical delay on any activity — the delay engine measures the forecast completion shift.</p>
        <div className="mb-3 flex flex-wrap items-end gap-3 text-xs text-[var(--ink-3)]">
          <label>Activity
            <select value={fragAid} onChange={(e) => setFragAid(e.target.value)}
              className="mt-1 block min-w-[240px] rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5 text-[var(--ink)] outline-none">
              {delayRows.map((r) => <option key={r.aid} value={r.aid}>{r.name.slice(0, 40)}</option>)}
            </select>
          </label>
          <label>Delay days
            <input type="number" value={fragDays} onChange={(e) => setFragDays(Number(e.target.value))}
              className="mt-1 block w-24 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5 text-[var(--ink)] outline-none" />
          </label>
          <button onClick={runTia}
            className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20">
            Run scenario
          </button>
        </div>
        {tia && (
          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Forecast without event" value={`day ${num(tia.forecastWithout, 0)}`} />
            <Stat label="Forecast with event" value={`day ${num(tia.forecastWith, 0)}`} tone="amber" />
            <Stat label="Completion impact" value={`${num(tia.impact, 0)} days`}
              sub={tia.impact < fragDays ? "partially absorbed by float" : "fully critical"} tone="red" />
          </div>
        )}
      </div>

      {/* 3 · capex re-phasing */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <p className="mb-1 flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
          <IndianRupee size={15} className="text-sky-400" /> CAPEX re-phasing
        </p>
        <p className="mb-3 text-xs text-[var(--ink-3)]">Scale the remaining months' plan and compare the projected FY outturn with BE.</p>
        <div className="mb-4 flex items-center gap-3">
          <input type="range" min={0.25} max={2} step={0.05} value={capexScale}
            onChange={(e) => setCapexScale(Number(e.target.value))} className="w-72" />
          <span className="rounded-lg bg-sky-500/15 px-2 py-1 text-sm font-bold text-sky-400">{capexScale.toFixed(2)}×</span>
        </div>
        {capexModel && (
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Actual so far (FY)" value={`₹${num(capexModel.actualSoFar)} Cr`} />
            <Stat label="Remaining plan" value={`₹${num(capexModel.remainingPlan)} Cr`} />
            <Stat label={`Projected outturn @ ${capexScale.toFixed(2)}×`} value={`₹${num(capexModel.projected)} Cr`} tone="amber" />
            <Stat label="vs BE" value={`${num(capexModel.vsBe, 1)}%`} sub={`BE ₹${num(capexModel.be)} Cr`}
              tone={capexModel.vsBe >= 95 ? "green" : capexModel.vsBe >= 75 ? "amber" : "red"} />
          </div>
        )}
      </div>
    </div>
  );
}
