"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Tabs, Chip, toast } from "@/ui";
import { PlanEngineGrid } from "@/plan/PlanEngineGrid";
import { PlanGrid, computeCurve } from "@/plan/PlanGrid";
import { SCurveChart } from "@/charts/SCurveChart";
import {
  getSchemes, getPackages, getPlans, getPlanFull, saveActivities, lockPlan, getSCurve,
  Scheme, Package, Plan, PlanActivity, PkgData,
} from "@/lib/furnace/api";

const TABS = [{ key: "appendix", label: "Appendix-2" }, { key: "activities", label: "Activities" }, { key: "plangrid", label: "Plan Grid" }, { key: "scurve", label: "S-Curve" }];

export default function PlanEnginePage() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [schemeId, setSchemeId] = useState(0);
  const [pkgId, setPkgId] = useState(0);
  const [planId, setPlanId] = useState(0);
  const [activities, setActivities] = useState<PlanActivity[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [planned, setPlanned] = useState<Record<string, number>>({});
  const [actual, setActual] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState(false);
  const [tab, setTab] = useState("activities");
  const [curve, setCurve] = useState<PkgData | null>(null);

  useEffect(() => { getSchemes().then((s) => { setSchemes(s); if (s[0]) setSchemeId(s[0].scheme_id); }); }, []);
  useEffect(() => { if (schemeId) getPackages(schemeId).then((p) => { setPackages(p); if (p[0]) setPkgId(p[0].package_id); }); }, [schemeId]);
  useEffect(() => { if (pkgId) getPlans(pkgId).then((pl) => { setPlans(pl); if (pl[0]) setPlanId(pl[0].progress_plan_id); }); }, [pkgId]);

  const loadFull = () => getPlanFull(planId).then((f) => {
    setActivities(f.activities); setLocked(f.plan.is_locked);
    setMonths(f.months ?? []); setPlanned(f.monthly_cells ?? {}); setActual(f.actual_cells ?? {});
  });
  useEffect(() => {
    if (!planId) return;
    loadFull();
    getSCurve(pkgId).then(setCurve);
  }, [planId, pkgId]);

  // S-curve recomputed live from the plan grid cells (today = last month with any actual)
  const cellCurve = useMemo(() => {
    if (!months.length) return null;
    const todayIdx = months.reduce((acc, m, i) => activities.some((a) => (actual[`${a.plan_activity_id ?? a.activity_id}|${m.slice(0, 7)}`] ?? 0) > 0) ? i : acc, 0);
    return computeCurve(activities, months, planned, actual, todayIdx);
  }, [activities, months, planned, actual]);

  const plan = plans.find((p) => p.progress_plan_id === planId);

  const persist = (next: PlanActivity[]) => { setActivities(next); void saveActivities(planId, next); };
  const handleLock = (lock: boolean) => { void lockPlan(planId, lock); setLocked(lock); toast(lock ? "Plan locked as baseline" : "Plan unlocked for editing"); };
  const regen = () => { getSCurve(pkgId).then(setCurve); setTab("scurve"); toast("S-curve regenerated from weightages"); };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Master Plan Engine" subtitle="Appendix-2 baseline · activity weightages · S-curve generation"
        right={<>
          <Field label="Scheme"><Select value={schemeId} onChange={(v) => setSchemeId(+v)} options={schemes.map((s) => ({ value: s.scheme_id, label: s.scheme_name }))} style={{ minWidth: 220 }} /></Field>
          <Field label="Package"><Select value={pkgId} onChange={(v) => setPkgId(+v)} options={packages.map((p) => ({ value: p.package_id, label: p.package_name }))} style={{ minWidth: 180 }} /></Field>
          <Field label="Plan"><Select value={planId} onChange={(v) => setPlanId(+v)} options={plans.map((p) => ({ value: p.progress_plan_id, label: p.plan_label ?? `Plan ${p.plan_no}` }))} style={{ minWidth: 170 }} /></Field>
          <ThemeToggle />
        </>} />

      <div className="fz-eyebrow">Plan Engine <span className="tag">{plan ? `${plan.plan_label} · ${plan.plan_status}` : ""}</span></div>
      <Card pad={false}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="fz-display" style={{ fontWeight: 800, fontSize: 16 }}>Activity Register</span>
            {plan && <Chip tone={locked ? "moderate" : "neutral"}>{locked ? "Baseline" : "Draft"}</Chip>}
          </div>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        {tab === "activities" && (
          <PlanEngineGrid activities={activities} locked={locked} onChange={persist} onLock={handleLock} onRegenerate={() => setTab("plangrid")} />
        )}
        {tab === "plangrid" && (
          <PlanGrid planId={planId} activities={activities} months={months} planned={planned} actual={actual}
            locked={locked} onChange={setPlanned} onAfterServer={loadFull} />
        )}
        {tab === "appendix" && <Appendix activities={activities} />}
        {tab === "scurve" && (
          <div style={{ padding: 18 }}>{(cellCurve ?? curve) ? <SCurveChart data={(cellCurve ?? curve) as PkgData} /> : <div style={{ color: "var(--ink-3)", padding: 40, textAlign: "center" }}>Add cells in the Plan Grid tab.</div>}</div>
        )}
      </Card>
    </div>
  );
}

/** Appendix-2 baseline view: standard parent→child activity tree (master template). */
function Appendix({ activities }: { activities: PlanActivity[] }) {
  const groups: { parent: string; children: string[] }[] = [
    { parent: "Design & Engineering", children: ["Basic Engineering", "Detailed Design Engineering"] },
    { parent: "Civil Work", children: ["Civil Execution"] },
    { parent: "Supply / Delivery", children: ["Building Steel Structures", "Mechanical Plant — Imported", "Mechanical Plant — Indigenous", "Electrical Plant — Imported", "Electrical Plant — Indigenous", "Refractories — Imported"] },
  ];
  return (
    <div style={{ padding: 18 }}>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14 }}>SAIL-standard Appendix-2 activity master. Seed these into the plan as the baseline, then assign weightages in the Activities tab.</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Parent activity", "Appendix-2 / contract activity"].map((h) => <th key={h} style={{ textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--ink-3)", fontWeight: 600, padding: "10px 14px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
        <tbody>
          {groups.flatMap((g) => g.children.map((c, ci) => (
            <tr key={g.parent + c} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "9px 14px", fontWeight: 600 }}>{ci === 0 ? <>{g.parent} <span style={{ fontWeight: 400, fontSize: 10.5, color: "var(--ink-3)" }}>· {g.children.length} activities</span></> : ""}</td>
              <td style={{ padding: "9px 14px", color: "var(--ink-2)" }}>{c}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
