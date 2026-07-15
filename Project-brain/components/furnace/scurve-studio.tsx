"use client";
// S-Curve Studio — Physical Progress Plan & Actual, unified.
// Rival parity (his ScurvePlanningView + physical progress window):
//   plan versions with lock/draft flow, activity rows (UoM, scope, weightage,
//   start/finish), month-wise planned-qty entry gated to each activity's date
//   range, save-draft vs save-&-lock, weightage checks, plan/actual curves with
//   actual cutoff.
// Beyond parity:
//   inline cell editing with Enter/Tab flow + dirty buffer (he round-trips a
//   modal per cell), live Σ-weightage & row-vs-scope validation chips, FORECAST
//   band from the forecast engine (method + confidence + expected completion vs
//   baseline), automatic slippage detection with Ask-Brain deep links, monthly
//   variance table, one-click CSV. All Furnace tokens, light/dark.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, PageHeader, Select, Tabs, toast } from "@/ui";
import {
  Scheme, Package, Plan, PlanFull, PkgData,
  getSchemes, getPackages, getPlans, getPlanFull, getSCurve,
  savePlanCells, lockPlan, autoDistribute,
} from "@/lib/furnace/api";
import { downloadCSV, inr } from "@/lib/furnace/gridApi";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" };
const th: React.CSSProperties = { padding: "6px 9px", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--steel-dim)", borderBottom: "1px solid var(--line)", background: "var(--panel)", position: "sticky", top: 0, whiteSpace: "nowrap", zIndex: 2 };
const td: React.CSSProperties = { padding: "5px 9px", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5 };
const num: React.CSSProperties = { ...mono, textAlign: "right", whiteSpace: "nowrap" };

const key = (activityId: number, month: string) => `${activityId}|${month}`;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m || 1) - 1]}-${String(y).slice(-2)}`;
};
const inRange = (ym: string, start?: string, finish?: string) => {
  const v = ym.slice(0, 7);
  const s = (start || "").slice(0, 7), f = (finish || "").slice(0, 7);
  return (!s || v >= s) && (!f || v <= f);
};

interface EditCell { actId: number; month: string; }

export default function SCurveStudio() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [pkgs, setPkgs] = useState<Package[]>([]);
  const [pkgId, setPkgId] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [full, setFull] = useState<PlanFull | null>(null);
  const [curve, setCurve] = useState<PkgData | null>(null);
  const [tab, setTab] = useState("grid");
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<EditCell | null>(null);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSchemes().then((s) => { setSchemes(s); setSchemeId((v) => v ?? s[0]?.scheme_id ?? null); }); }, []);
  useEffect(() => {
    if (schemeId == null) return;
    getPackages(schemeId).then((p) => { setPkgs(p); setPkgId(p[0]?.package_id ?? null); });
  }, [schemeId]);
  useEffect(() => {
    if (pkgId == null) return;
    getPlans(pkgId).then((ps) => { setPlans(ps); setPlanId(ps[0]?.progress_plan_id ?? null); });
    getSCurve(pkgId).then(setCurve);
  }, [pkgId]);
  const loadPlan = useCallback(() => {
    if (planId == null) return;
    getPlanFull(planId).then((f) => { setFull(f); setDirty({}); setEdit(null); });
  }, [planId]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  const plan = full?.plan ?? null;
  const acts = full?.activities ?? [];
  const months = full?.months ?? [];
  const locked = Boolean(plan?.is_locked);

  const plannedAt = useCallback((actId: number, m: string): number => {
    const k = key(actId, m);
    return dirty[k] ?? full?.monthly_cells?.[k] ?? 0;
  }, [dirty, full]);
  const actualAt = useCallback((actId: number, m: string): number => full?.actual_cells?.[key(actId, m)] ?? 0, [full]);

  // ---- derived: weight & scope checks, monthly/cumulative % -----------------
  const weightSum = useMemo(() => acts.reduce((a, r) => a + (r.weightage || 0), 0), [acts]);
  const rowPlanned = useCallback((actId: number) => months.reduce((a, m) => a + plannedAt(actId, m), 0), [months, plannedAt]);

  const monthly = useMemo(() => {
    let cp = 0, ca = 0;
    let lastActualIdx = -1;
    months.forEach((m, i) => { if (acts.some((r) => (full?.actual_cells?.[key(r.plan_activity_id ?? r.activity_id, m)] ?? 0) > 0)) lastActualIdx = i; });
    return months.map((m, i) => {
      let planQty = 0, actQty = 0, planPct = 0, actPct = 0;
      acts.forEach((r) => {
        const id = r.plan_activity_id ?? r.activity_id;
        const p = plannedAt(id, m), a = actualAt(id, m);
        planQty += p; actQty += a;
        if (r.scope_qty > 0) { planPct += (p / r.scope_qty) * (r.weightage || 0); actPct += (a / r.scope_qty) * (r.weightage || 0); }
      });
      cp = Math.min(100, cp + planPct);
      const hasActual = i <= lastActualIdx;
      if (hasActual) ca = Math.min(100, ca + actPct);
      return { m, planQty, actQty, planPct, actPct: hasActual ? actPct : null, cumPlan: cp, cumActual: hasActual ? ca : null, variance: hasActual ? ca - cp : null };
    });
  }, [months, acts, plannedAt, actualAt, full]);

  const slippages = useMemo(() => monthly.filter((r) => r.variance != null && r.variance <= -5), [monthly]);

  // ---- editing ---------------------------------------------------------------
  const beginEdit = (actId: number, m: string, start?: string, finish?: string) => {
    if (locked) { toast("Plan is locked — unlock to edit planned quantities."); return; }
    if (!inRange(m, start, finish)) { toast(`${monthLabel(m)} is outside this activity's start–finish window.`); return; }
    setEdit({ actId, month: m });
    setEditVal(String(plannedAt(actId, m) || ""));
  };
  const commit = (move: "down" | "right" | "stay") => {
    if (!edit) return;
    const v = Number(editVal || 0);
    if (!Number.isFinite(v) || v < 0) { toast("Enter a valid non-negative quantity."); return; }
    setDirty((d) => ({ ...d, [key(edit.actId, edit.month)]: v }));
    const actIdx = acts.findIndex((r) => (r.plan_activity_id ?? r.activity_id) === edit.actId);
    const mIdx = months.indexOf(edit.month);
    if (move === "down" && actIdx >= 0 && actIdx + 1 < acts.length) {
      const nxt = acts[actIdx + 1]; const id = nxt.plan_activity_id ?? nxt.activity_id;
      setEdit({ actId: id, month: edit.month }); setEditVal(String(plannedAt(id, edit.month) || ""));
    } else if (move === "right" && mIdx >= 0 && mIdx + 1 < months.length) {
      const nm = months[mIdx + 1];
      setEdit({ actId: edit.actId, month: nm }); setEditVal(String(plannedAt(edit.actId, nm) || ""));
    } else setEdit(null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit("down"); }
    else if (e.key === "Tab") { e.preventDefault(); commit("right"); }
    else if (e.key === "Escape") setEdit(null);
  };

  const saveDraft = async () => {
    if (!planId || !Object.keys(dirty).length) { toast("No unsaved cells."); return; }
    setBusy(true);
    try {
      const cells = Object.entries(dirty).map(([k, planned_qty]) => {
        const [id, plan_month] = k.split("|");
        return { plan_activity_id: +id, plan_month, planned_qty };
      });
      const res = await savePlanCells(planId, cells);
      toast(`Draft saved — ${res.saved} cell(s).`);
      loadPlan();
    } catch (e: any) { toast(e?.message || "Save failed"); }
    finally { setBusy(false); }
  };
  const toggleLock = async () => {
    if (!planId) return;
    if (!locked && Object.keys(dirty).length) await saveDraft();
    if (!locked && Math.abs(weightSum - 100) > 0.01) { toast(`Σ weightage is ${inr(weightSum, 2)}% — must equal 100% before locking.`); return; }
    try { const r = await lockPlan(planId, !locked); setFull((f) => f && ({ ...f, plan: { ...f.plan, is_locked: r.is_locked } })); toast(r.is_locked ? "Plan locked." : "Plan unlocked."); }
    catch (e: any) { toast(e?.message || "Lock failed"); }
  };
  const distribute = async () => {
    if (!planId) return;
    if (locked) { toast("Unlock the plan first."); return; }
    setBusy(true);
    try { const r = await autoDistribute(planId); toast(`Auto-distributed ${r.activities_distributed} activities · ${r.cells_written} cells.`); loadPlan(); }
    catch (e: any) { toast(e?.message || "Auto-distribute failed"); }
    finally { setBusy(false); }
  };
  const exportCsv = () => {
    downloadCSV(`scurve-${pkgId}-plan${planId}`,
      ["Month", "Plan Qty", "Actual Qty", "Monthly Plan %", "Monthly Actual %", "Cum Plan %", "Cum Actual %", "Variance pp"],
      monthly.map((r) => [monthLabel(r.m), +r.planQty.toFixed(2), +r.actQty.toFixed(2), +r.planPct.toFixed(2),
        r.actPct == null ? "" : +r.actPct.toFixed(2), +r.cumPlan.toFixed(2), r.cumActual == null ? "" : +r.cumActual.toFixed(2), r.variance == null ? "" : +r.variance.toFixed(2)]),
      `S-Curve — package ${pkgId} · ${plan?.plan_label ?? ""}`);
    toast("Monthly table exported (CSV)");
  };

  // ---- curve svg (plan + actual + forecast band) ------------------------------
  const CurveSvg = () => {
    const pts = curve?.points ?? [];
    const seq = pts.length ? pts.map((p) => ({ m: p.month_date.slice(0, 7), cp: p.cumulative_planned_pct, ca: p.cumulative_actual_pct, fc: p.is_forecast }))
      : monthly.map((r) => ({ m: r.m, cp: r.cumPlan, ca: r.cumActual, fc: false }));
    if (!seq.length) return <div style={{ color: "var(--steel-dim)", fontSize: 12.5, padding: 20 }}>No curve data yet — enter planned quantities in the grid.</div>;
    const W = 660, H = 210;
    const x = (i: number) => 38 + (i / Math.max(1, seq.length - 1)) * (W - 58);
    const y = (v: number) => H - 26 - (Math.max(0, Math.min(100, v)) / 100) * (H - 44);
    const planPts = seq.map((p, i) => `${x(i)},${y(p.cp)}`).join(" ");
    const actSeq = seq.map((p, i) => ({ ...p, i })).filter((p) => p.ca != null && !p.fc);
    const fcSeq = seq.map((p, i) => ({ ...p, i })).filter((p) => p.ca != null && p.fc);
    const actPts = actSeq.map((p) => `${x(p.i)},${y(p.ca!)}`).join(" ");
    const fcJoin = actSeq.length && fcSeq.length ? [actSeq[actSeq.length - 1], ...fcSeq] : fcSeq;
    const fcPts = fcJoin.map((p) => `${x(p.i)},${y(p.ca!)}`).join(" ");
    const lastAct = actSeq[actSeq.length - 1];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {[25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={38} x2={W - 16} y1={y(t)} y2={y(t)} stroke="var(--grid-line)" strokeDasharray="3 4" />
            <text x={32} y={y(t) + 3} textAnchor="end" style={{ fontSize: 8.5, fill: "var(--steel-dim)" }}>{t}</text>
          </g>
        ))}
        <polyline points={planPts} fill="none" stroke="var(--steel)" strokeWidth={2} strokeDasharray="6 3" />
        {actPts ? <polyline points={actPts} fill="none" stroke="var(--verdigris)" strokeWidth={2.4} /> : null}
        {fcPts ? <polyline points={fcPts} fill="none" stroke="var(--molten)" strokeWidth={2} strokeDasharray="4 4" /> : null}
        {lastAct ? <>
          <circle cx={x(lastAct.i)} cy={y(lastAct.ca!)} r={3.4} fill="var(--verdigris)" />
          <text x={Math.min(W - 46, x(lastAct.i) + 6)} y={y(lastAct.ca!) - 6} style={{ ...(mono as any), fontSize: 10.5, fontWeight: 700, fill: "var(--verdigris)" }}>{inr(lastAct.ca!, 1)}%</text>
        </> : null}
        {seq.map((p, i) => (i % 2 === 0 ? <text key={p.m} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 8, fill: "var(--steel-dim)" }}>{monthLabel(p.m)}</text> : null))}
      </svg>
    );
  };

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="S-Curve Studio" subtitle="Physical progress plan & actual · month-gated planning · forecast engine"
        right={<>
          <Field label="Scheme"><Select value={String(schemeId ?? "")} onChange={(v) => setSchemeId(Number(v))} options={schemes.map((s) => ({ value: String(s.scheme_id), label: s.scheme_name }))} style={{ minWidth: 210 }} /></Field>
          <Field label="Package"><Select value={String(pkgId ?? "")} onChange={(v) => setPkgId(Number(v))} options={pkgs.map((p) => ({ value: String(p.package_id), label: `Pkg-${p.package_no} · ${p.package_name}` }))} style={{ minWidth: 220 }} /></Field>
          <ThemeToggle />
        </>} />

      {/* Plan rail */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={label}>Plan version</span>
          {plans.map((p) => (
            <button key={p.progress_plan_id} onClick={() => setPlanId(p.progress_plan_id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: "var(--r)", cursor: "pointer", ...mono, fontSize: 12, border: `1px solid ${p.progress_plan_id === planId ? "var(--steel)" : "var(--line)"}`, background: p.progress_plan_id === planId ? "var(--steel-soft)" : "var(--panel)", color: "var(--ink)" }}>
              {p.plan_label ?? `Plan ${p.plan_no}`}
              <Chip tone={p.is_locked ? "steel" : "neutral"} dot>{p.is_locked ? "Locked" : p.plan_status}</Chip>
            </button>
          ))}
          <Chip tone={Math.abs(weightSum - 100) < 0.01 ? "ok" : "critical"}>Σ wt {inr(weightSum, 2)}%</Chip>
          {dirtyCount ? <Chip tone="minor" dot>{dirtyCount} unsaved</Chip> : null}
          <span style={{ flex: 1 }} />
          <Button onClick={distribute} disabled={busy || locked}>Auto-distribute</Button>
          <Button onClick={saveDraft} disabled={busy || !dirtyCount} kind={dirtyCount ? "accent" : "default"}>Save draft</Button>
          <Button onClick={toggleLock} kind={locked ? "default" : "steel"}>{locked ? "Unlock" : "Save & lock"}</Button>
          <Button onClick={exportCsv}>CSV</Button>
        </div>
      </Card>

      <div style={{ marginTop: 14 }}>
        <Tabs tabs={[{ key: "grid", label: "Plan Grid" }, { key: "curve", label: "Curve & Forecast" }, { key: "table", label: "Monthly Table" }]} active={tab} onChange={setTab} />
      </div>

      {tab === "grid" ? (
        <Card pad={false} style={{ marginTop: 12, overflow: "hidden" }}>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 350px)" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 3, minWidth: 210 }}>Activity</th>
                  {["UoM", "Scope", "Wt %", "Start", "Finish"].map((c) => <th key={c} style={{ ...th, textAlign: "right" }}>{c}</th>)}
                  {months.map((m) => <th key={m} style={{ ...th, textAlign: "right", borderLeft: "1px solid var(--grid-line)" }}>{monthLabel(m)}</th>)}
                  <th style={{ ...th, textAlign: "right", borderLeft: "1px solid var(--line)" }}>Σ vs scope</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((r) => {
                  const id = r.plan_activity_id ?? r.activity_id;
                  const total = rowPlanned(id);
                  const over = r.scope_qty > 0 && total > r.scope_qty + 1e-9;
                  const under = r.scope_qty > 0 && total < r.scope_qty - 1e-9;
                  return (
                    <tr key={id}>
                      <td style={{ ...td, position: "sticky", left: 0, background: "var(--bg)", borderRight: "1px solid var(--line)", fontWeight: 600, minWidth: 210 }} title={r.activity_name}>{r.activity_name}</td>
                      <td style={{ ...td, ...num }}>{r.uom}</td>
                      <td style={{ ...td, ...num }}>{inr(r.scope_qty, 1)}</td>
                      <td style={{ ...td, ...num }}>{inr(r.weightage, 2)}</td>
                      <td style={{ ...td, ...num, color: "var(--steel-dim)" }}>{(r.contract_start_month || "").slice(0, 7)}</td>
                      <td style={{ ...td, ...num, color: "var(--steel-dim)" }}>{(r.expected_completion_month || "").slice(0, 7)}</td>
                      {months.map((m) => {
                        const allowed = inRange(m, r.contract_start_month, r.expected_completion_month);
                        const editing = edit?.actId === id && edit.month === m;
                        const planned = plannedAt(id, m);
                        const act = actualAt(id, m);
                        const isDirty = key(id, m) in dirty;
                        return (
                          <td key={m}
                            onDoubleClick={() => beginEdit(id, m, r.contract_start_month, r.expected_completion_month)}
                            title={allowed ? (locked ? "Plan locked" : "Double-click to enter planned qty") : "Outside activity start–finish window"}
                            style={{ ...td, ...num, borderLeft: "1px solid var(--grid-line)", cursor: allowed && !locked ? "cell" : "not-allowed",
                              background: !allowed ? "var(--bg-tint-cool)" : isDirty ? "var(--slag-soft)" : undefined,
                              color: !allowed ? "var(--steel-dim)" : undefined }}>
                            {editing ? (
                              <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={onKey} onBlur={() => commit("stay")}
                                style={{ width: 64, ...num, padding: "2px 4px", border: "1px solid var(--steel)", borderRadius: 4, background: "var(--panel)", color: "var(--ink)", outline: "none" }} />
                            ) : (
                              <>
                                {planned ? inr(planned, 1) : ""}
                                {act ? <div style={{ fontSize: 10, color: "var(--verdigris)" }}>{inr(act, 1)}</div> : null}
                              </>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ ...td, ...num, borderLeft: "1px solid var(--line)", color: over ? "var(--molten)" : under ? "var(--slag)" : "var(--verdigris)" }}>
                        {inr(total, 1)} / {inr(r.scope_qty, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--panel)", fontWeight: 700 }}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "var(--panel)", borderTop: "2px solid var(--line)" }}>Monthly plan %</td>
                  {[...Array(5)].map((_, i) => <td key={i} style={{ ...td, borderTop: "2px solid var(--line)" }} />)}
                  {monthly.map((r) => (
                    <td key={r.m} style={{ ...td, ...num, borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--grid-line)" }}>{r.planPct ? `${inr(r.planPct, 1)}%` : ""}</td>
                  ))}
                  <td style={{ ...td, borderTop: "2px solid var(--line)" }} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ display: "flex", gap: 16, padding: "8px 14px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--steel-dim)", flexWrap: "wrap" }}>
            <span>▸ double-click a month cell to enter planned qty · Enter ↓ · Tab → · Esc</span>
            <span>▸ shaded cells are outside the activity window</span>
            <span>▸ green sub-figure = actual qty recorded via DPR</span>
            <span>▸ amber cells = unsaved draft</span>
          </div>
        </Card>
      ) : null}

      {tab === "curve" ? (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 12, alignItems: "start" }}>
          <Card>
            <span style={label}>Cumulative progress — plan vs actual vs forecast</span>
            <CurveSvg />
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--steel-dim)" }}>
              <span style={{ borderTop: "2px dashed var(--steel)", paddingTop: 1 }}>plan</span>
              <span style={{ borderTop: "2px solid var(--verdigris)", paddingTop: 1 }}>actual</span>
              <span style={{ borderTop: "2px dashed var(--molten)", paddingTop: 1 }}>forecast</span>
            </div>
          </Card>
          <div style={{ display: "grid", gap: 14 }}>
            <Card>
              <span style={label}>Forecast engine</span>
              {curve?.forecast_completion_date ? (
                <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 12.5 }}>
                  <div>Expected completion <b style={mono}>{curve.forecast_completion_date}</b></div>
                  {curve.baseline_finish_date ? <div>Baseline finish <b style={mono}>{curve.baseline_finish_date}</b></div> : null}
                  <div>Method <Chip tone="steel">{curve.forecast_method ?? "trend"}</Chip> confidence <b style={mono}>{inr(curve.forecast_confidence_pct ?? 0, 0)}%</b></div>
                  {curve.forecast_explainer ? <div style={{ color: "var(--steel-dim)", lineHeight: 1.55 }}>{curve.forecast_explainer}</div> : null}
                  <div style={mono}>today: plan {inr(curve.today_planned_pct ?? 0, 1)}% · actual {inr(curve.today_actual_pct ?? 0, 1)}% · Δ {inr(curve.today_variance_pct ?? 0, 1)}pp</div>
                </div>
              ) : <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--steel-dim)" }}>Forecast appears once actuals exist for this package.</div>}
            </Card>
            <Card>
              <span style={label}>Slippage detector</span>
              {slippages.length ? (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {slippages.map((s) => (
                    <a key={s.m} href={`/ai?ask=${encodeURIComponent(`Package ${pkgId}: cumulative actual slipped ${inr(Math.abs(s.variance!), 1)}pp behind plan in ${monthLabel(s.m)}. Which activities caused it and what is the recovery path?`)}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 11px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--molten-soft)", textDecoration: "none", color: "var(--ink)", fontSize: 12.5 }}>
                      <span><b style={mono}>{monthLabel(s.m)}</b> — {inr(Math.abs(s.variance!), 1)}pp behind plan</span>
                      <span style={{ ...mono, fontSize: 11, color: "var(--steel)" }}>Ask Brain →</span>
                    </a>
                  ))}
                </div>
              ) : <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--verdigris)" }}>No month is ≥5pp behind plan. On track.</div>}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "table" ? (
        <Card pad={false} style={{ marginTop: 12 }}>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 330px)" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>{["Month", "Plan Qty", "Actual Qty", "Monthly Plan %", "Monthly Actual %", "Cum Plan %", "Cum Actual %", "Variance pp", ""].map((c) => <th key={c} style={{ ...th, textAlign: "right" }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {monthly.map((r, i) => (
                  <tr key={r.m} style={{ background: i % 2 ? "var(--bg-tint-cool)" : undefined }}>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{monthLabel(r.m)}</td>
                    <td style={{ ...td, ...num }}>{inr(r.planQty, 1)}</td>
                    <td style={{ ...td, ...num }}>{r.actPct == null ? "—" : inr(r.actQty, 1)}</td>
                    <td style={{ ...td, ...num }}>{inr(r.planPct, 2)}</td>
                    <td style={{ ...td, ...num }}>{r.actPct == null ? "—" : inr(r.actPct, 2)}</td>
                    <td style={{ ...td, ...num }}>{inr(r.cumPlan, 2)}</td>
                    <td style={{ ...td, ...num }}>{r.cumActual == null ? "—" : inr(r.cumActual, 2)}</td>
                    <td style={{ ...td, ...num, fontWeight: 700, color: r.variance == null ? "var(--steel-dim)" : r.variance < -5 ? "var(--molten)" : r.variance < 0 ? "var(--slag)" : "var(--verdigris)" }}>
                      {r.variance == null ? "—" : `${r.variance > 0 ? "+" : ""}${inr(r.variance, 2)}`}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {r.variance == null ? "" : <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: r.variance < -5 ? "var(--molten)" : r.variance < 0 ? "var(--slag)" : "var(--verdigris)" }} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
