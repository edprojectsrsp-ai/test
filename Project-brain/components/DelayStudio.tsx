"use client";

import React, { useMemo, useState } from "react";
import {
  cpm, asPlannedVsAsBuilt, impactedAsPlanned, collapsedAsBuilt,
  windowAnalysis, timeImpactAnalysis, statusedForecast,
  type Activity, type Actuals, type DelayEvent, type Party,
} from "../engine/delayAnalysis";

/**
 * DelayStudio.tsx — forensic delay analysis for Project Brain.
 * Furnace / Control Room tokens, inline styles, no Tailwind. React 19 strict.
 *
 * Five methods, five method-matched panels:
 *   APAB      — dual Gantt: planned (steel outline) vs actual (molten fill),
 *               as-built driving chain glows; variance ledger.
 *   IAP       — additive waterfall: baseline bar, one riser per event.
 *   COLLAPSED — as-built Gantt with party toggles; but-for marker collapses.
 *   WINDOWS   — period strip; per-window slip stacked by responsibility.
 *   TIA       — data-date scrubber; fragnet card; before/after forecast.
 *
 * Party colors are constant across all panels:
 *   Employer = steel · Contractor = molten · Neutral = gray.
 */

const T = {
  bg: "var(--bg, #0f1317)",
  panel: "var(--panel, #14181d)",
  panel2: "var(--panel-2, #1b2128)",
  line: "var(--line, #2a333d)",
  ink: "var(--ink, #e7edf3)",
  dim: "var(--ink-dim, #8b98a6)",
  steel: "var(--steel, #4aa8c7)",
  steelBr: "var(--steel-br, #6fd0ee)",
  steelDim: "var(--steel-dim, #2f6d84)",
  molten: "var(--molten, #e08d2f)",
  moltenBr: "var(--molten-br, #f7b24a)",
  ok: "var(--ok, #4bbf73)",
  bad: "var(--danger, #e2564a)",
  mono: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
  disp: "var(--font-display, 'Archivo', system-ui, sans-serif)",
  body: "var(--font-body, 'Inter', system-ui, sans-serif)",
};

const PARTY_COLOR: Record<Party, string> = {
  employer: T.steelBr, contractor: T.moltenBr, neutral: "#8b98a6",
};
const PARTY_LABEL: Record<Party, string> = {
  employer: "Employer (RSP)", contractor: "Contractor", neutral: "Neutral",
};

export type MethodKey = "apab" | "iap" | "collapsed" | "windows" | "tia";

export interface DelayStudioProps {
  activities?: Activity[];
  asBuilt?: Actuals;
  events?: DelayEvent[];
  windowBoundaries?: number[];
  unit?: string;
  initialMethod?: MethodKey;
}

const DEMO_ACTS: Activity[] = [
  { id: "A", name: "Enabling works", dur: 10 },
  { id: "B", name: "Civil raft", dur: 10, preds: [{ id: "A" }] },
  { id: "C", name: "Erection", dur: 10, preds: [{ id: "B" }, { id: "D" }] },
  { id: "D", name: "Vendor drawings", dur: 5, preds: [{ id: "A" }] },
];
const DEMO_AB: Actuals = {
  A: { start: 0, finish: 12 }, B: { start: 12, finish: 25 },
  C: { start: 25, finish: 36 }, D: { start: 12, finish: 17 },
};
const DEMO_EVENTS: DelayEvent[] = [
  { id: "E-A", name: "Late site handover", party: "contractor", activityId: "A", days: 2, atDay: 5 },
  { id: "E-B", name: "Dewatering failure", party: "employer", activityId: "B", days: 3, atDay: 18 },
  { id: "E-C", name: "Cyclone shutdown", party: "neutral", activityId: "C", days: 1, atDay: 30 },
];

const METHODS: { key: MethodKey; name: string; tag: string; blurb: string }[] = [
  { key: "apab", name: "As-Planned vs As-Built", tag: "SCL obs. / retrospective",
    blurb: "Post-mortem observation: where actual dates departed from the baseline, and which chain actually drove completion." },
  { key: "iap", name: "Impacted As-Planned", tag: "SCL modelled / additive",
    blurb: "Insert delay events into the pristine baseline one by one; each event's completion delta is its impact." },
  { key: "collapsed", name: "Collapsed As-Built", tag: "But-for / subtractive",
    blurb: "Remove a party's events from the as-built and collapse; the improvement is that party's responsibility." },
  { key: "windows", name: "Window Analysis", tag: "Contemporaneous periods",
    blurb: "Cut the project into windows; the movement of forecast completion inside each window is attributed to that window's critical events." },
  { key: "tia", name: "Time Impact Analysis", tag: "AACE 52R-06 / prospective",
    blurb: "Status the schedule at a data date, insert the fragnet, measure the forecast shift — the EOT instrument." },
];

const card: React.CSSProperties = {
  background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 14,
};
const eyebrow: React.CSSProperties = {
  fontFamily: T.mono, fontSize: 10, letterSpacing: "0.14em",
  textTransform: "uppercase", color: T.dim,
};

function PartyLegend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {(Object.keys(PARTY_COLOR) as Party[]).map(p => (
        <span key={p} style={{ fontFamily: T.mono, fontSize: 11, color: PARTY_COLOR[p], display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: PARTY_COLOR[p], display: "inline-block" }} />
          {PARTY_LABEL[p]}
        </span>
      ))}
    </div>
  );
}

function Narrative({ lines }: { lines: string[] }) {
  return (
    <div style={{ ...card, background: T.panel2 }}>
      <div style={{ ...eyebrow, marginBottom: 8 }}>Findings</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.55, color: T.ink }}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shared Gantt scaffolding
 * ------------------------------------------------------------------ */
function useScale(maxDay: number, width: number, padL: number, padR: number) {
  const span = Math.max(1, maxDay);
  return (d: number) => padL + (d / span) * (width - padL - padR);
}

function TimeAxis({ maxDay, xAt, W, y }: { maxDay: number; xAt: (d: number) => number; W: number; y: number }) {
  const step = maxDay <= 20 ? 5 : maxDay <= 60 ? 10 : 20;
  const ticks: number[] = [];
  for (let d = 0; d <= maxDay; d += step) ticks.push(d);
  return (
    <g>
      {ticks.map(d => (
        <g key={d}>
          <line x1={xAt(d)} x2={xAt(d)} y1={16} y2={y} stroke={T.line} strokeWidth={1} />
          <text x={xAt(d)} y={y + 14} fill={T.dim} fontSize={10} fontFamily={T.mono} textAnchor="middle">{d}</text>
        </g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Panel 1 — APAB: dual Gantt + variance ledger
 * ------------------------------------------------------------------ */
function PanelAPAB({ acts, ab, unit }: { acts: Activity[]; ab: Actuals; unit: string }) {
  const r = useMemo(() => asPlannedVsAsBuilt(acts, ab), [acts, ab]);
  const W = 640, padL = 150, padR = 20, rowH = 34;
  const H = 30 + r.rows.length * rowH + 26;
  const maxDay = Math.max(r.asBuiltFinish, r.plannedFinish) + 2;
  const xAt = useScale(maxDay, W, padL, padR);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
        {[
          ["Planned finish", `day ${r.plannedFinish}`, T.steelBr],
          ["As-built finish", `day ${r.asBuiltFinish}`, T.moltenBr],
          ["Project slip", `${r.projectSlip} ${unit}`, r.projectSlip > 0 ? T.bad : T.ok],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ ...card, background: T.panel2, padding: "10px 12px" }}>
            <div style={eyebrow}>{l}</div>
            <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: c as string, marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={eyebrow}>Planned (outline) vs actual (fill) · driving chain glows</div>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>
            ▭ planned &nbsp; ▬ actual &nbsp; ⟶ as-built critical
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="planned vs as-built gantt">
          <TimeAxis maxDay={maxDay} xAt={xAt} W={W} y={30 + r.rows.length * rowH} />
          {r.rows.map((row, i) => {
            const y = 30 + i * rowH;
            const driving = row.asBuiltCritical;
            return (
              <g key={row.id}>
                <text x={8} y={y + 15} fill={driving ? T.ink : T.dim} fontSize={12}
                  fontFamily={T.body} fontWeight={driving ? 600 : 400}>
                  {row.name}
                </text>
                <rect x={xAt(row.plannedStart)} y={y + 2} width={Math.max(2, xAt(row.plannedFinish) - xAt(row.plannedStart))}
                  height={10} fill="none" stroke={T.steelBr} strokeWidth={1.4} rx={2} />
                {row.actualStart != null && row.actualFinish != null && (
                  <rect x={xAt(row.actualStart)} y={y + 14}
                    width={Math.max(2, xAt(row.actualFinish) - xAt(row.actualStart))}
                    height={10} fill={T.molten} opacity={driving ? 0.95 : 0.45} rx={2}
                    stroke={driving ? T.moltenBr : "none"} strokeWidth={driving ? 1.5 : 0} />
                )}
                {(row.finishVar ?? 0) !== 0 && row.actualFinish != null && (
                  <text x={xAt(row.actualFinish) + 5} y={y + 23} fill={(row.finishVar ?? 0) > 0 ? T.bad : T.ok}
                    fontSize={10} fontFamily={T.mono}>
                    {(row.finishVar ?? 0) > 0 ? "+" : ""}{row.finishVar}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Variance ledger</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>
            {["Activity", "Plan", "Actual", "Start var", "Finish var", "Own slip", "Driving"].map(h => (
              <th key={h} style={{ textAlign: h === "Activity" ? "left" : "right", padding: "5px 8px", borderBottom: `1px solid ${T.steelDim}`, color: T.steelBr, fontFamily: T.mono, fontSize: 10, textTransform: "uppercase" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {r.rows.map(row => (
              <tr key={row.id}>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: T.ink }}>{row.name}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: T.dim, textAlign: "right", fontFamily: T.mono }}>{row.plannedStart}–{row.plannedFinish}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: T.dim, textAlign: "right", fontFamily: T.mono }}>{row.actualStart ?? "—"}–{row.actualFinish ?? "—"}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: "right", fontFamily: T.mono, color: (row.startVar ?? 0) > 0 ? T.bad : T.ink }}>{row.startVar ?? "—"}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: "right", fontFamily: T.mono, color: (row.finishVar ?? 0) > 0 ? T.bad : T.ink }}>{row.finishVar ?? "—"}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: "right", fontFamily: T.mono, color: (row.ownSlip ?? 0) > 0 ? T.moltenBr : T.ink }}>{row.ownSlip ?? "—"}</td>
                <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: "right" }}>{row.asBuiltCritical ? "●" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Narrative lines={r.narrative} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel 2 — IAP: additive waterfall
 * ------------------------------------------------------------------ */
function PanelIAP({ acts, events, unit }: { acts: Activity[]; events: DelayEvent[]; unit: string }) {
  const r = useMemo(() => impactedAsPlanned(acts, events), [acts, events]);
  const W = 640, H = 210, padL = 46, padR = 20, padT = 20, padB = 44;
  const maxD = r.impactedFinish + 2;
  const xIdx = (i: number) => padL + (i + 0.5) * ((W - padL - padR) / (r.steps.length + 2));
  const yAt = (d: number) => padT + (H - padT - padB) * (1 - d / maxD);
  const barW = Math.min(64, (W - padL - padR) / (r.steps.length + 2) * 0.62);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={eyebrow}>Impact waterfall — baseline + each event in sequence</div>
          <PartyLegend />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="impacted as-planned waterfall">
          {[0.25, 0.5, 0.75, 1].map(g => (
            <line key={g} x1={padL} x2={W - padR} y1={yAt(maxD * g)} y2={yAt(maxD * g)} stroke={T.line} strokeWidth={1} />
          ))}
          {/* baseline column */}
          <rect x={xIdx(0) - barW / 2} y={yAt(r.baselineFinish)} width={barW}
            height={yAt(0) - yAt(r.baselineFinish)} fill={T.steelDim} rx={3} />
          <text x={xIdx(0)} y={yAt(r.baselineFinish) - 5} fill={T.steelBr} fontSize={11} fontFamily={T.mono} textAnchor="middle">{r.baselineFinish}</text>
          <text x={xIdx(0)} y={H - 26} fill={T.dim} fontSize={10} fontFamily={T.mono} textAnchor="middle">baseline</text>
          {/* risers */}
          {r.steps.map((s, i) => {
            const x = xIdx(i + 1);
            const col = PARTY_COLOR[s.event.party];
            return (
              <g key={s.event.id}>
                <line x1={xIdx(i) + barW / 2} x2={x - barW / 2} y1={yAt(s.finishBefore)} y2={yAt(s.finishBefore)}
                  stroke={T.dim} strokeWidth={1} strokeDasharray="3 3" />
                <rect x={x - barW / 2} y={yAt(s.finishAfter)} width={barW}
                  height={Math.max(1.5, yAt(s.finishBefore) - yAt(s.finishAfter))}
                  fill={col} opacity={0.9} rx={3} />
                <text x={x} y={yAt(s.finishAfter) - 5} fill={col} fontSize={11} fontFamily={T.mono} textAnchor="middle">+{s.impact}</text>
                <text x={x} y={H - 26} fill={T.dim} fontSize={9.5} fontFamily={T.mono} textAnchor="middle">{s.event.id}</text>
                <text x={x} y={H - 14} fill={T.dim} fontSize={9} fontFamily={T.body} textAnchor="middle">{s.event.name.slice(0, 14)}</text>
              </g>
            );
          })}
          {/* impacted column */}
          <rect x={xIdx(r.steps.length + 1) - barW / 2} y={yAt(r.impactedFinish)} width={barW}
            height={yAt(0) - yAt(r.impactedFinish)} fill="none" stroke={T.moltenBr} strokeWidth={1.6} rx={3} />
          <text x={xIdx(r.steps.length + 1)} y={yAt(r.impactedFinish) - 5} fill={T.moltenBr} fontSize={11} fontFamily={T.mono} textAnchor="middle">{r.impactedFinish}</text>
          <text x={xIdx(r.steps.length + 1)} y={H - 26} fill={T.dim} fontSize={10} fontFamily={T.mono} textAnchor="middle">impacted</text>
        </svg>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
        {(Object.keys(r.byParty) as Party[]).map(p => (
          <div key={p} style={{ ...card, background: T.panel2, padding: "10px 12px", borderLeft: `2px solid ${PARTY_COLOR[p]}` }}>
            <div style={eyebrow}>{PARTY_LABEL[p]}</div>
            <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: PARTY_COLOR[p], marginTop: 3 }}>
              {r.byParty[p]} {unit}
            </div>
          </div>
        ))}
      </div>
      <Narrative lines={r.narrative} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel 3 — Collapsed As-Built: party toggles collapse the marker
 * ------------------------------------------------------------------ */
function PanelCollapsed({ acts, ab, events, unit }: { acts: Activity[]; ab: Actuals; events: DelayEvent[]; unit: string }) {
  const r = useMemo(() => collapsedAsBuilt(acts, ab, events), [acts, ab, events]);
  const [removed, setRemoved] = useState<Set<Party>>(new Set());
  const live = useMemo(() => {
    const evs = events.filter(e => removed.has(e.party));
    const abDur: Record<string, number> = {};
    for (const a of acts) {
      const x = ab[a.id];
      abDur[a.id] = x ? x.finish - x.start : a.dur;
    }
    for (const e of evs) abDur[e.activityId] = Math.max(0, abDur[e.activityId] - e.days);
    return cpm(acts, abDur).finish;
  }, [acts, ab, events, removed]);
  const W = 640, H = 96, padL = 20, padR = 20;
  const maxD = r.asBuiltFinish + 2;
  const xAt = useScale(maxD, W, padL, padR);
  const baseline = useMemo(() => cpm(acts).finish, [acts]);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Toggle a party's events OUT of the as-built ("but-for")</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {(Object.keys(PARTY_COLOR) as Party[]).map(p => {
            const on = removed.has(p);
            const evs = events.filter(e => e.party === p);
            return (
              <button key={p} onClick={() => {
                const s = new Set(removed);
                if (on) s.delete(p); else s.add(p);
                setRemoved(s);
              }} style={{
                padding: "7px 14px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${PARTY_COLOR[p]}`,
                background: on ? PARTY_COLOR[p] : "transparent",
                color: on ? "#14181d" : PARTY_COLOR[p],
                fontFamily: T.mono, fontSize: 12,
              }}>
                {on ? "✕ " : ""}{PARTY_LABEL[p]} · {evs.reduce((s, e) => s + e.days, 0)}d in {evs.length} event(s)
              </button>
            );
          })}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="collapse track">
          <line x1={xAt(0)} x2={xAt(maxD)} y1={48} y2={48} stroke={T.line} strokeWidth={2} />
          {/* baseline marker */}
          <line x1={xAt(baseline)} x2={xAt(baseline)} y1={30} y2={66} stroke={T.steelDim} strokeWidth={1.4} strokeDasharray="4 3" />
          <text x={xAt(baseline)} y={24} fill={T.steelDim} fontSize={10} fontFamily={T.mono} textAnchor="middle">baseline {baseline}</text>
          {/* as-built marker */}
          <line x1={xAt(r.asBuiltFinish)} x2={xAt(r.asBuiltFinish)} y1={30} y2={66} stroke={T.bad} strokeWidth={1.4} />
          <text x={xAt(r.asBuiltFinish)} y={24} fill={T.bad} fontSize={10} fontFamily={T.mono} textAnchor="middle">as-built {r.asBuiltFinish}</text>
          {/* live collapsed marker */}
          <circle cx={xAt(live)} cy={48} r={9} fill={T.moltenBr} />
          <text x={xAt(live)} y={82} fill={T.moltenBr} fontSize={12} fontFamily={T.mono} textAnchor="middle" fontWeight={700}>
            collapsed → day {live}
          </text>
        </svg>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.ink, marginTop: 6 }}>
          Days saved but-for the removed parties: <span style={{ color: T.moltenBr, fontWeight: 700 }}>{r.asBuiltFinish - live}</span> {unit}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10 }}>
        {r.scenarios.map(s => (
          <div key={String(s.removedParty)} style={{ ...card, background: T.panel2, padding: "10px 12px" }}>
            <div style={eyebrow}>but-for {s.removedParty === "all" ? "ALL events" : PARTY_LABEL[s.removedParty as Party]}</div>
            <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 600, marginTop: 3, color: s.removedParty === "all" ? T.ok : PARTY_COLOR[s.removedParty as Party] }}>
              day {s.collapsedFinish} <span style={{ fontSize: 12, color: T.dim }}>(−{s.saved})</span>
            </div>
          </div>
        ))}
      </div>
      <Narrative lines={r.narrative} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel 4 — Windows: period strip with responsibility stacks
 * ------------------------------------------------------------------ */
function PanelWindows({ acts, ab, events, boundaries, unit }: {
  acts: Activity[]; ab: Actuals; events: DelayEvent[]; boundaries: number[]; unit: string;
}) {
  const r = useMemo(() => windowAnalysis(acts, ab, events, boundaries), [acts, ab, events, boundaries]);
  const W = 640, H = 250, padL = 46, padR = 20, stripY = 26, stripH = 22, chartTop = 78, chartBot = 36;
  const maxDay = boundaries[boundaries.length - 1];
  const xAt = useScale(maxDay, W, padL, padR);
  const maxSlip = Math.max(1, ...r.windows.map(w => w.slip));
  const yBar = (v: number) => (H - chartBot) - ((H - chartBot - chartTop) * v) / maxSlip;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={eyebrow}>Windows · forecast drift & responsibility stack per period</div>
          <PartyLegend />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="window analysis strip">
          {/* window strip */}
          {r.windows.map((w, i) => (
            <g key={i}>
              <rect x={xAt(w.from)} y={stripY} width={xAt(w.to) - xAt(w.from)} height={stripH}
                fill={i % 2 ? T.panel2 : "transparent"} stroke={T.line} strokeWidth={1} />
              <text x={(xAt(w.from) + xAt(w.to)) / 2} y={stripY + 15} fill={T.dim} fontSize={10}
                fontFamily={T.mono} textAnchor="middle">W{i + 1}: {w.from}–{w.to}</text>
              {/* forecast drift label */}
              <text x={(xAt(w.from) + xAt(w.to)) / 2} y={stripY + 34} fill={w.slip > 0 ? T.bad : T.ok}
                fontSize={10} fontFamily={T.mono} textAnchor="middle">
                {w.forecastAtStart}→{w.forecastAtEnd}
              </text>
              {/* stacked responsibility bar */}
              {(() => {
                const cx = (xAt(w.from) + xAt(w.to)) / 2;
                const bw = Math.min(46, (xAt(w.to) - xAt(w.from)) * 0.5);
                let acc = 0;
                const segs: { v: number; c: string }[] = [
                  { v: w.byParty.employer, c: PARTY_COLOR.employer },
                  { v: w.byParty.contractor, c: PARTY_COLOR.contractor },
                  { v: w.byParty.neutral, c: PARTY_COLOR.neutral },
                  { v: w.unexplained, c: T.bad },
                ];
                return segs.map((s, si) => {
                  if (s.v <= 0) return null;
                  const y1 = yBar(acc + s.v), y0 = yBar(acc);
                  acc += s.v;
                  return <rect key={si} x={cx - bw / 2} y={y1} width={bw} height={Math.max(1.5, y0 - y1)} fill={s.c} opacity={0.92} rx={2} />;
                });
              })()}
              {w.slip > 0 && (
                <text x={(xAt(w.from) + xAt(w.to)) / 2} y={yBar(w.slip) - 5} fill={T.ink} fontSize={11}
                  fontFamily={T.mono} textAnchor="middle">+{w.slip}</text>
              )}
              {/* events markers */}
              {w.attributed.map(a => (
                <circle key={a.event.id} cx={xAt(a.event.atDay ?? w.from)} cy={stripY + stripH / 2}
                  r={4} fill={PARTY_COLOR[a.event.party]} stroke={T.panel} strokeWidth={1} />
              ))}
            </g>
          ))}
          {/* unexplained legend note */}
          <text x={W - padR} y={H - 8} fill={T.bad} fontSize={9.5} fontFamily={T.mono} textAnchor="end">
            red segment = unexplained / concurrent
          </text>
        </svg>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
        {(Object.keys(r.byParty) as Party[]).map(p => (
          <div key={p} style={{ ...card, background: T.panel2, padding: "10px 12px", borderLeft: `2px solid ${PARTY_COLOR[p]}` }}>
            <div style={eyebrow}>{PARTY_LABEL[p]}</div>
            <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 600, color: PARTY_COLOR[p], marginTop: 3 }}>
              {r.byParty[p].toFixed(1)} {unit}
            </div>
          </div>
        ))}
        <div style={{ ...card, background: T.panel2, padding: "10px 12px", borderLeft: `2px solid ${T.bad}` }}>
          <div style={eyebrow}>Unexplained</div>
          <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 600, color: T.bad, marginTop: 3 }}>
            {r.unexplained.toFixed(1)} {unit}
          </div>
        </div>
      </div>
      <Narrative lines={r.narrative} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel 5 — TIA: data-date scrubber + fragnet
 * ------------------------------------------------------------------ */
function PanelTIA({ acts, ab, events, unit }: { acts: Activity[]; ab: Actuals; events: DelayEvent[]; unit: string }) {
  const abFinish = useMemo(() => Math.max(0, ...Object.values(ab).map(x => x.finish)), [ab]);
  const [dd, setDd] = useState(Math.round(abFinish / 2));
  const [fragIdx, setFragIdx] = useState(0);
  const fragnet = events[fragIdx] ?? events[0];
  const r = useMemo(() => fragnet ? timeImpactAnalysis(acts, ab, fragnet, dd) : null,
    [acts, ab, fragnet, dd]);
  const W = 640, H = 120, padL = 20, padR = 20;
  const maxD = (r ? Math.max(r.forecastWith, abFinish) : abFinish) + 4;
  const xAt = useScale(maxD, W, padL, padR);
  if (!r) return <div style={card}>No delay events defined.</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Data date & fragnet</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontFamily: T.mono, fontSize: 12, color: T.ink, display: "flex", alignItems: "center", gap: 8 }}>
            Data date: day
            <input type="range" min={0} max={abFinish} value={dd}
              onChange={e => setDd(Number(e.target.value))} style={{ accentColor: T.molten as string, width: 180 }} />
            <span style={{ color: T.moltenBr, fontWeight: 700 }}>{dd}</span>
          </label>
          <select value={fragIdx} onChange={e => setFragIdx(Number(e.target.value))}
            style={{ background: T.panel2, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 10px", fontFamily: T.body, fontSize: 13 }}>
            {events.map((e, i) => (
              <option key={e.id} value={i}>{e.name} — {e.party}, {e.days}d on {e.activityId}</option>
            ))}
          </select>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="TIA timeline">
          <line x1={xAt(0)} x2={xAt(maxD)} y1={60} y2={60} stroke={T.line} strokeWidth={2} />
          <line x1={xAt(dd)} x2={xAt(dd)} y1={22} y2={92} stroke={T.moltenBr} strokeWidth={2} />
          <text x={xAt(dd)} y={16} fill={T.moltenBr} fontSize={10} fontFamily={T.mono} textAnchor="middle">DATA DATE {dd}</text>
          <circle cx={xAt(r.forecastWithout)} cy={60} r={7} fill={T.steelBr} />
          <text x={xAt(r.forecastWithout)} y={44} fill={T.steelBr} fontSize={10} fontFamily={T.mono} textAnchor="middle">without {r.forecastWithout}</text>
          <circle cx={xAt(r.forecastWith)} cy={60} r={7} fill={T.bad} />
          <text x={xAt(r.forecastWith)} y={84} fill={T.bad} fontSize={10} fontFamily={T.mono} textAnchor="middle">with {r.forecastWith}</text>
          {r.forecastWith > r.forecastWithout && (
            <g>
              <line x1={xAt(r.forecastWithout)} x2={xAt(r.forecastWith)} y1={60} y2={60}
                stroke={T.bad} strokeWidth={4} opacity={0.5} />
              <text x={(xAt(r.forecastWithout) + xAt(r.forecastWith)) / 2} y={104}
                fill={T.bad} fontSize={12} fontFamily={T.mono} textAnchor="middle" fontWeight={700}>
                impact +{r.impact} {unit}
              </text>
            </g>
          )}
        </svg>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
        {[
          ["Forecast (without)", `day ${r.forecastWithout}`, T.steelBr],
          ["Forecast (with fragnet)", `day ${r.forecastWith}`, T.bad],
          ["Time impact / EOT basis", `${r.impact} ${unit}`, r.impact > 0 ? T.moltenBr : T.ok],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ ...card, background: T.panel2, padding: "10px 12px" }}>
            <div style={eyebrow}>{l}</div>
            <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 600, color: c as string, marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>
      <Narrative lines={r.narrative} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function DelayStudio({
  activities = DEMO_ACTS, asBuilt = DEMO_AB, events = DEMO_EVENTS,
  windowBoundaries, unit = "days", initialMethod = "apab",
}: DelayStudioProps) {
  const abFinish = Math.max(0, ...Object.values(asBuilt).map(x => x.finish));
  const bounds = windowBoundaries ?? [0, Math.round(abFinish / 3), Math.round((2 * abFinish) / 3), abFinish + 2];
  const [method, setMethod] = useState<MethodKey>(initialMethod);
  const meta = METHODS.find(m => m.key === method)!;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 14, fontFamily: T.body, color: T.ink, background: T.bg, padding: 4, minHeight: 560 }}>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        <div style={{ padding: "4px 2px" }}>
          <div style={eyebrow}>Delay Analysis Studio</div>
          <div style={{ fontFamily: T.disp, fontWeight: 700, fontSize: 17, marginTop: 2 }}>Forensic methods</div>
        </div>
        {METHODS.map(m => (
          <button key={m.key} onClick={() => setMethod(m.key)} style={{
            textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
            background: method === m.key ? T.panel2 : T.panel,
            border: `1px solid ${method === m.key ? T.steelDim : T.line}`,
            borderLeft: `3px solid ${method === m.key ? T.molten : T.line}`,
          }}>
            <div style={{ color: T.ink, fontSize: 13, fontWeight: 600 }}>{m.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim, marginTop: 2, letterSpacing: "0.06em" }}>{m.tag}</div>
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12, alignContent: "start", minWidth: 0 }}>
        <div style={{ ...card, background: T.panel2, padding: "10px 14px" }}>
          <span style={{ fontFamily: T.disp, fontWeight: 700, fontSize: 15 }}>{meta.name}</span>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.moltenBr, marginLeft: 10, letterSpacing: "0.08em" }}>{meta.tag}</span>
          <div style={{ color: T.dim, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{meta.blurb}</div>
        </div>
        {method === "apab" && <PanelAPAB acts={activities} ab={asBuilt} unit={unit} />}
        {method === "iap" && <PanelIAP acts={activities} events={events} unit={unit} />}
        {method === "collapsed" && <PanelCollapsed acts={activities} ab={asBuilt} events={events} unit={unit} />}
        {method === "windows" && <PanelWindows acts={activities} ab={asBuilt} events={events} boundaries={bounds} unit={unit} />}
        {method === "tia" && <PanelTIA acts={activities} ab={asBuilt} events={events} unit={unit} />}
      </div>
    </div>
  );
}
