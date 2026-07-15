"use client";
// Command Dashboard v2 — executive density at rival level and beyond.
// Parity: KPI strip, status board (count + ₹Cr + heat), monthly BE/RE/Actual bars
// with cumulative plan/actual overlay + click-month drill popover, achievement
// gauge, live ticking countdown to expected finish, scheme drill-down (milestone
// bars with expected-finish extension, S-curve with actual cutoff, monthly
// remarks, DPR category summary).
// Beyond: AI Insight strip (auto-computed anomalies with Ask-Brain deep links),
// per-scheme variance chips, CSV export, print-safe layout.
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, Kpi, PageHeader, Select, toast } from "@/ui";
import { CmdMonth, CmdScheme, CmdSummary, getCommandSummary, inr, downloadCSV } from "@/lib/furnace/gridApi";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--steel-dim)" };
const TONE: Record<string, string> = { ok: "var(--verdigris)", warn: "var(--slag)", hot: "var(--molten)", done: "var(--steel)" };
const FYS = ["2026-27", "2025-26"];
const cr = (n: number) => `₹${inr(n, 0)} Cr`;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

/* Gauge: 180° achievement dial */
function Gauge({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const angle = (p / 100) * 180;
  const rad = ((180 - angle) * Math.PI) / 180;
  const x = 60 + 46 * Math.cos(rad), y = 58 - 46 * Math.sin(rad);
  const large = angle > 90 ? 1 : 0;
  return (
    <svg viewBox="0 0 120 66" style={{ width: "100%", maxWidth: 190 }}>
      <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="var(--grid-line)" strokeWidth={9} strokeLinecap="round" />
      <path d={`M 14 58 A 46 46 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none"
        stroke={p >= 90 ? "var(--verdigris)" : p >= 65 ? "var(--slag)" : "var(--molten)"} strokeWidth={9} strokeLinecap="round" />
      <text x={60} y={50} textAnchor="middle" style={{ ...mono as any, fontSize: 17, fontWeight: 700, fill: "var(--ink)" }}>{inr(p, 1)}%</text>
      <text x={60} y={63} textAnchor="middle" style={{ fontSize: 8, fill: "var(--steel-dim)", letterSpacing: 1 }}>ACHIEVEMENT</text>
    </svg>
  );
}

/* Trend: grouped BE/RE/Actual bars + cumulative polylines + click drill */
function TrendChart({ trend, onPick, picked }: { trend: CmdMonth[]; onPick: (i: number | null) => void; picked: number | null }) {
  const H = 150, W = 640, pad = 34;
  const maxBar = Math.max(1, ...trend.flatMap((t) => [t.be, t.re, t.actual]));
  let cp = 0, ca = 0;
  const cum = trend.map((t) => { cp += t.be; ca += t.actual; return { cp, ca }; });
  const maxCum = Math.max(1, cum[cum.length - 1]?.cp ?? 1, cum[cum.length - 1]?.ca ?? 1);
  const bw = (W - pad * 2) / trend.length;
  const y = (v: number) => H - 18 - (v / maxBar) * (H - 40);
  const cy = (v: number) => H - 18 - (v / maxCum) * (H - 40);
  const cx = (i: number) => pad + bw * i + bw / 2;
  const planPts = cum.map((c, i) => `${cx(i)},${cy(c.cp)}`).join(" ");
  const actualDefined = trend.map((t) => t.actual > 0);
  const lastActual = actualDefined.lastIndexOf(true);
  const actPts = cum.slice(0, lastActual + 1).map((c, i) => `${cx(i)},${cy(c.ca)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={W - 6} y1={y(maxBar * f)} y2={y(maxBar * f)} stroke="var(--grid-line)" strokeDasharray="3 4" />)}
      {trend.map((t, i) => {
        const gx = pad + bw * i + 4, w = Math.max(3, (bw - 12) / 3);
        return (
          <g key={t.month} onClick={() => onPick(picked === i ? null : i)} style={{ cursor: "pointer" }} opacity={picked == null || picked === i ? 1 : 0.35}>
            <rect x={gx} y={y(t.be)} width={w} height={H - 18 - y(t.be)} fill="var(--steel)" rx={1.5} />
            {t.re ? <rect x={gx + w + 2} y={y(t.re)} width={w} height={H - 18 - y(t.re)} fill="var(--slag)" rx={1.5} /> : null}
            {t.actual ? <rect x={gx + (w + 2) * 2} y={y(t.actual)} width={w} height={H - 18 - y(t.actual)} fill="var(--molten)" rx={1.5} /> : null}
            <text x={cx(i)} y={H - 5} textAnchor="middle" style={{ fontSize: 8.5, fill: "var(--steel-dim)" }}>{t.month.split("-")[0]}</text>
          </g>
        );
      })}
      <polyline points={planPts} fill="none" stroke="var(--steel-deep)" strokeWidth={1.8} strokeDasharray="5 3" />
      {lastActual >= 0 ? <polyline points={actPts} fill="none" stroke="var(--verdigris)" strokeWidth={2} /> : null}
    </svg>
  );
}

/* Milestone Gantt with expected-finish (amber extension) */
function MilestoneBars({ scheme }: { scheme: CmdScheme }) {
  const ds = scheme.milestones.flatMap((m) => [Date.parse(m.start), Date.parse(m.finish), Date.parse(m.expectedFinish)]).filter(Number.isFinite);
  const min = Math.min(...ds), max = Math.max(...ds), span = Math.max(1, max - min);
  const pos = (t: number) => ((t - min) / span) * 100;
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {scheme.milestones.map((m) => {
        const s = Date.parse(m.start), f = Date.parse(m.finish), ef = Date.parse(m.expectedFinish);
        const slip = ef > f;
        return (
          <div key={m.label} style={{ display: "grid", gridTemplateColumns: "175px 1fr 52px", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${m.parent} · ${m.label}`}>
              <span style={{ color: "var(--steel-dim)" }}>{m.parent} · </span>{m.label}
            </span>
            <div style={{ position: "relative", height: 14, background: "var(--grid-line)", borderRadius: 7 }}>
              <div style={{ position: "absolute", left: `${pos(s)}%`, width: `${Math.max(2, pos(f) - pos(s))}%`, top: 0, bottom: 0, background: "var(--steel)", borderRadius: 7 }} />
              {slip ? <div title={`Expected finish slips to ${m.expectedFinish}`} style={{ position: "absolute", left: `${pos(f)}%`, width: `${Math.max(1.5, pos(ef) - pos(f))}%`, top: 2, bottom: 2, background: "var(--molten)", borderRadius: 6, opacity: 0.85 }} /> : null}
            </div>
            <span style={{ ...mono, fontSize: 11, textAlign: "right", color: slip ? "var(--molten)" : "var(--steel-dim)" }}>{inr(m.weight, 0)}%</span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 14, fontSize: 10.5, color: "var(--steel-dim)" }}>
        <span><span style={{ display: "inline-block", width: 16, height: 8, background: "var(--steel)", borderRadius: 4, marginRight: 5 }} />schedule</span>
        <span><span style={{ display: "inline-block", width: 16, height: 8, background: "var(--molten)", borderRadius: 4, marginRight: 5 }} />expected-finish slip</span>
      </div>
    </div>
  );
}

/* S-curve: plan line + actual (cutoff-aware) */
function SCurve({ scheme }: { scheme: CmdScheme }) {
  const pts = scheme.curve; const W = 320, H = 130;
  const x = (i: number) => 30 + (i / Math.max(1, pts.length - 1)) * (W - 44);
  const y = (v: number) => H - 20 - (v / 100) * (H - 34);
  const plan = pts.map((p, i) => `${x(i)},${y(p.cumPlan)}`).join(" ");
  const actual = pts.filter((p) => p.cumActual != null).map((p, i) => `${x(i)},${y(p.cumActual!)}`).join(" ");
  const lastA = [...pts].reverse().find((p) => p.cumActual != null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      {[25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={30} x2={W - 12} y1={y(t)} y2={y(t)} stroke="var(--grid-line)" strokeDasharray="3 4" />
          <text x={24} y={y(t) + 3} textAnchor="end" style={{ fontSize: 8, fill: "var(--steel-dim)" }}>{t}</text>
        </g>
      ))}
      <polyline points={plan} fill="none" stroke="var(--steel)" strokeWidth={1.8} strokeDasharray="5 3" />
      {actual ? <polyline points={actual} fill="none" stroke="var(--verdigris)" strokeWidth={2.2} /> : null}
      {lastA ? <text x={Math.min(W - 34, x(pts.findIndex((p) => p === lastA)) + 4)} y={y(lastA.cumActual!) - 4} style={{ ...mono as any, fontSize: 9.5, fill: "var(--verdigris)", fontWeight: 700 }}>{inr(lastA.cumActual!, 1)}%</text> : null}
      {pts.map((p, i) => (i % 2 === 0 ? <text key={p.month} x={x(i)} y={H - 6} textAnchor="middle" style={{ fontSize: 7.5, fill: "var(--steel-dim)" }}>{p.month.split("-")[0]}</text> : null))}
    </svg>
  );
}

export default function CommandDashboard() {
  const [fy, setFy] = useState(FYS[0]);
  const [sum, setSum] = useState<CmdSummary | null>(null);
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  useEffect(() => { getCommandSummary(fy).then((s) => { setSum(s); setSchemeId((id) => id ?? s.schemes[0]?.scheme_id ?? null); }); }, [fy]);

  const scheme = useMemo(() => sum?.schemes.find((s) => s.scheme_id === schemeId) ?? null, [sum, schemeId]);
  const now = useNow(Boolean(scheme));

  const plan = sum ? (sum.effectivePlanType === "RE" && sum.re ? sum.re : sum.be) : 0;
  const achievement = sum && plan ? (sum.actual / plan) * 100 : 0;
  const variance = sum ? plan - sum.actual : 0;

  // countdown to selected scheme's expected finish
  const target = scheme ? Date.parse(`${scheme.expectedFinish}T23:59:59`) : NaN;
  const diff = Number.isFinite(target) ? target - now : 0;
  const overdue = diff < 0;
  const abs = Math.floor(Math.abs(diff) / 1000);
  const dd = Math.floor(abs / 86400), hh = Math.floor((abs % 86400) / 3600), mi = Math.floor((abs % 3600) / 60), ss = abs % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  // AI insight strip — auto anomalies (this is what the rival cannot compute)
  const insights = useMemo(() => {
    if (!sum) return [] as { text: string; ask: string; tone: "hot" | "warn" | "ok" }[];
    const out: { text: string; ask: string; tone: "hot" | "warn" | "ok" }[] = [];
    const withAct = sum.trend.filter((t) => t.actual > 0);
    if (withAct.length) {
      const worst = withAct.reduce((a, b) => (b.actual - b.be < a.actual - a.be ? b : a));
      out.push({ text: `Worst month: ${worst.month} slipped ${cr(worst.be - worst.actual)} vs BE`, ask: `Why did CAPEX actuals slip in ${worst.month} and which packages drove it?`, tone: "hot" });
    }
    const lag = [...sum.schemes].sort((a, b) => a.achievement - b.achievement)[0];
    if (lag) out.push({ text: `${lag.name} trails at ${inr(lag.achievement, 1)}% achievement (${lag.status})`, ask: `Analyse delays for ${lag.name} — critical path activities and expected finish impact.`, tone: "warn" });
    const hotCost = sum.statusRows.find((r) => r.tone === "hot");
    if (hotCost) out.push({ text: `${hotCost.count} schemes worth ${cr(hotCost.cost)} delayed > 1 year`, ask: `List schemes delayed more than one year with pending approvals and cost impact.`, tone: "hot" });
    return out.slice(0, 3);
  }, [sum]);

  const exportCsv = () => {
    if (!sum) return;
    downloadCSV(`command-dashboard-${fy}`, ["Month", "BE", "RE", "Actual", "Cum Plan", "Cum Actual"],
      (() => { let cp = 0, ca = 0; return sum.trend.map((t) => { cp += t.be; ca += t.actual; return [t.month, t.be, t.re, t.actual, +cp.toFixed(1), +ca.toFixed(1)]; }); })(),
      `Command Dashboard — FY ${fy}`);
    toast("Dashboard trend exported (CSV)");
  };

  if (!sum) return <div className="fz fz-app" style={{ padding: 40, color: "var(--steel-dim)" }}>Loading command dashboard…</div>;
  const picked = pickedMonth != null ? sum.trend[pickedMonth] : null;

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Command Dashboard" subtitle="Portfolio CAPEX & physical performance · live countdown · drill to scheme"
        right={<>
          <Field label="Financial year"><Select value={fy} onChange={setFy} options={FYS.map((f) => ({ value: f, label: `FY ${f}` }))} style={{ minWidth: 128 }} /></Field>
          <Button onClick={exportCsv}>Export CSV</Button>
          <Button onClick={() => window.print()}>Print</Button>
          <ThemeToggle />
        </>} />

      {/* AI insight strip */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {insights.map((it) => (
          <a key={it.text} href={`/ai?ask=${encodeURIComponent(it.ask)}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: "var(--r)", textDecoration: "none", color: "var(--ink)", border: "1px solid var(--line)", background: it.tone === "hot" ? "var(--molten-soft)" : it.tone === "warn" ? "var(--slag-soft)" : "var(--verdigris-soft)", fontSize: 12.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: TONE[it.tone] }} />
            {it.text}
            <span style={{ ...mono, fontSize: 11, color: "var(--steel)" }}>Ask Brain →</span>
          </a>
        ))}
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 14 }}>
        <Kpi label="Portfolio cost" value={cr(sum.totalCost)} tone="steel" sub={`${sum.corp.n + sum.plant.n} live schemes`} />
        <Kpi label={`BE FY ${fy}`} value={cr(sum.be)} tone="steel" sub={sum.re ? `RE ${cr(sum.re)}` : "RE not yet effective"} />
        <Kpi label="Actual (YTD)" value={cr(sum.actual)} tone="steel" sub={`vs ${sum.effectivePlanType} plan`} />
        <Kpi label="Variance" value={cr(Math.abs(variance))} tone={variance > 0 ? "minor" : "ok"} sub={variance > 0 ? "behind plan" : "ahead of plan"} />
        <Kpi label="Corporate AMR" value={String(sum.corp.n)} tone="steel" sub={cr(sum.corp.cost)} />
        <Kpi label="Plant Level AMR" value={String(sum.plant.n)} tone="steel" sub={cr(sum.plant.cost)} />
        <Kpi label="Completed this FY" value={String(sum.completed.n)} tone="ok" sub={cr(sum.completed.cost)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 14, alignItems: "start" }}>
        {/* CAPEX trend */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={label}>CAPEX trend — BE / RE / Actual (₹Cr) with cumulative overlay</span>
            <span style={{ fontSize: 11, color: "var(--steel-dim)" }}>click a month to drill</span>
          </div>
          <TrendChart trend={sum.trend} picked={pickedMonth} onPick={setPickedMonth} />
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--steel-dim)" }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--steel)", borderRadius: 2, marginRight: 5 }} />BE</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--slag)", borderRadius: 2, marginRight: 5 }} />RE</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--molten)", borderRadius: 2, marginRight: 5 }} />Actual</span>
            <span style={{ borderTop: "2px dashed var(--steel-deep)", paddingTop: 1 }}>cum plan</span>
            <span style={{ borderTop: "2px solid var(--verdigris)", paddingTop: 1 }}>cum actual</span>
          </div>
          {picked ? (
            <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: "var(--r)", padding: 12, background: "var(--bg-tint-cool)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b style={mono}>{picked.month}</b>
                <span style={{ ...mono, fontSize: 12 }}>BE {inr(picked.be, 1)} · {picked.re ? `RE ${inr(picked.re, 1)} · ` : ""}Actual {inr(picked.actual, 1)} · {picked.be ? `${inr((picked.actual / picked.be) * 100, 1)}%` : "—"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                {[{ t: "Plan (top contributors)", rows: picked.planProjects }, { t: "Actual (top contributors)", rows: picked.actualProjects }].map((sect) => (
                  <div key={sect.t}>
                    <div style={{ ...label, marginBottom: 4 }}>{sect.t}</div>
                    {sect.rows.length ? sect.rows.map((r) => (
                      <div key={r.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                        <span>{r.name}</span><span style={mono}>{inr(r.amount, 1)}</span>
                      </div>
                    )) : <span style={{ fontSize: 12, color: "var(--steel-dim)" }}>no entries</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {/* Gauge + status board + countdown */}
        <div style={{ display: "grid", gap: 14 }}>
          <Card>
            <span style={label}>Achievement vs {sum.effectivePlanType}</span>
            <div style={{ display: "flex", justifyContent: "center" }}><Gauge pct={achievement} /></div>
          </Card>
          <Card>
            <span style={label}>Delivery status — count · ₹Cr</span>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {sum.statusRows.map((r) => {
                const maxCost = Math.max(...sum.statusRows.map((x) => x.cost), 1);
                return (
                  <div key={r.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                      <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: TONE[r.tone], marginRight: 7 }} />{r.label}</span>
                      <span style={mono}><b>{r.count}</b> · {cr(r.cost)}</span>
                    </div>
                    <div style={{ height: 5, background: "var(--grid-line)", borderRadius: 3, marginTop: 3 }}>
                      <div style={{ height: 5, width: `${(r.cost / maxCost) * 100}%`, background: TONE[r.tone], borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          {scheme ? (
            <Card style={{ background: overdue ? "var(--molten-soft)" : undefined }}>
              <span style={label}>{overdue ? "Overdue" : "Countdown"} — {scheme.name}</span>
              <div style={{ ...mono, fontSize: 26, fontWeight: 700, marginTop: 6, color: overdue ? "var(--molten)" : "var(--ink)" }}>
                {dd}<span style={{ fontSize: 13, color: "var(--steel-dim)" }}>d </span>{pad2(hh)}:{pad2(mi)}:{pad2(ss)}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--steel-dim)", marginTop: 3 }}>expected finish {scheme.expectedFinish}{overdue ? " — passed" : ""}</div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Scheme drill-down */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={label}>Scheme drill-down</span>
          <Select value={String(schemeId ?? "")} onChange={(v) => setSchemeId(Number(v))}
            options={sum.schemes.map((s) => ({ value: String(s.scheme_id), label: `${s.name} — ${cr(s.cost)}` }))} style={{ minWidth: 300 }} />
          {scheme ? <>
            <Chip tone={scheme.status.includes("> 1") ? "critical" : scheme.status.includes("Delay") ? "minor" : "ok"} dot>{scheme.status}</Chip>
            <Chip tone="neutral">{scheme.type}</Chip>
            <span style={{ ...mono, fontSize: 12.5 }}>achv <b>{inr(scheme.achievement, 1)}%</b></span>
            <span style={{ flex: 1 }} />
            <a href={`/ai?ask=${encodeURIComponent(`Full status of ${scheme.name}: critical path, pending approvals, CAPEX vs plan, expected finish.`)}`}
              style={{ ...mono, fontSize: 12, color: "var(--steel)", textDecoration: "none" }}>Ask Brain about this scheme →</a>
          </> : null}
        </div>
        {scheme ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, marginTop: 14 }}>
            <div>
              <div style={{ ...label, marginBottom: 8 }}>Milestones — schedule vs expected finish</div>
              <MilestoneBars scheme={scheme} />
              <div style={{ ...label, margin: "14px 0 6px" }}>Key dates</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {[["Registration", scheme.registration], ["FY start", scheme.fyStart], ["Schedule finish", scheme.scheduleFinish], ["Expected finish", scheme.expectedFinish]].map(([k, v]) => (
                  <div key={k} style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "7px 10px" }}>
                    <div style={{ fontSize: 10, color: "var(--steel-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
                    <div style={{ ...mono, fontSize: 12.5, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 6 }}>S-curve — cumulative plan vs actual</div>
              <SCurve scheme={scheme} />
              <div style={{ ...label, margin: "10px 0 6px" }}>DPR category summary</div>
              {scheme.dpr.map((d) => (
                <div key={d.category} style={{ display: "grid", gridTemplateColumns: "1fr 90px", alignItems: "center", gap: 8, padding: "3px 0" }}>
                  <span style={{ fontSize: 12 }}>{d.category}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 6, background: "var(--grid-line)", borderRadius: 3 }}>
                      <div style={{ height: 6, width: `${Math.min(100, d.actual)}%`, background: d.actual >= 90 ? "var(--verdigris)" : d.actual >= 65 ? "var(--slag)" : "var(--molten)", borderRadius: 3 }} />
                    </div>
                    <span style={{ ...mono, fontSize: 11 }}>{inr(d.actual, 0)}%</span>
                  </div>
                </div>
              ))}
              <div style={{ ...label, margin: "12px 0 6px" }}>Monthly remarks</div>
              <div style={{ display: "grid", gap: 6, maxHeight: 130, overflow: "auto" }}>
                {scheme.remarks.map((r) => (
                  <div key={r.month} style={{ fontSize: 12, display: "flex", gap: 8 }}>
                    <b style={{ ...mono, color: "var(--steel)", whiteSpace: "nowrap" }}>{r.month}</b>
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
