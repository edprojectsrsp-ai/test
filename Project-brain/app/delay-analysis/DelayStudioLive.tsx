"use client";

/**
 * Delay Analysis Studio (live) — five forensic methods, each its own process
 * flow, all computed by the authoritative Python engine on the /api/v1/delay/*
 * endpoints. The network is derived from the live plan_activities baseline vs
 * forecast dates; delay attribution is driven by an editable, party-tagged
 * event register (auto-populatable from the baseline→forecast slips).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, FileText, GitBranch, Layers, Network, Plus, RefreshCw,
  Scale, Sigma, Trash2, X, Zap,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";
type Party = "employer" | "contractor" | "neutral";
const PARTY_COLOR: Record<Party, string> = {
  employer: "#f59e0b", contractor: "#22d3ee", neutral: "#a78bfa",
};
const PARTY_LABEL: Record<Party, string> = {
  employer: "Employer", contractor: "Contractor", neutral: "Neutral / Excusable",
};

type Scheme = { id: number; name: string };
type Pkg = { package_id: number; package_name: string };
type EventRow = {
  event_id: number; activity_id: number | null; name: string; party: Party;
  delay_days: number; at_date: string | null; description: string; source: string;
  evidence_document_id?: number | null;
  evidence_chunk_id?: number | null;
  kg_edge_id?: number | null;
  evidence_quote?: string | null;
  party_suggested?: string | null;
  cause_label?: string | null;
};
type KgSuggestion = {
  kg_edge_id: number; cause_label: string; target_label: string;
  party_suggested: Party; activity_id: number | null;
  evidence_document_id: number | null; document_title?: string;
  evidence_quote: string; weight: number;
};
type ModelRow = {
  aid: string; name: string; category: string; discipline: string; stage: number;
  uom: string; package: string; plannedStartDay: number; plannedFinishDay: number;
  baselineDur: number; abStartDay: number; abFinishDay: number; slipDays: number;
  plannedStartDate: string; plannedFinishDate: string; expectedFinishDate: string;
};
type Schedule = {
  activities: { id: string; name: string; dur: number; preds: any[] }[];
  rows: ModelRow[];
  meta: { origin: string; unit: string; activityCount: number; packages: string[] };
  windowBoundaries: number[];
  drivingChain: string[];
  projectSlip: number;
  suggestedTiaActivity: string | null;
  suggestedTiaDataDate: number | null;
};

const num = (v: any, d = 0) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

const METHODS = [
  { key: "apab", name: "As-Planned vs As-Built", tag: "SCL · retrospective", icon: Layers },
  { key: "iap", name: "Impacted As-Planned", tag: "SCL · additive", icon: Plus },
  { key: "collapsed", name: "Collapsed As-Built", tag: "But-for · subtractive", icon: Scale },
  { key: "windows", name: "Window Analysis", tag: "Contemporaneous", icon: Sigma },
  { key: "tia", name: "Time Impact Analysis", tag: "AACE 52R-06 · prospective", icon: Zap },
] as const;
type MethodKey = (typeof METHODS)[number]["key"];

function Narrative({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        <Activity className="h-3.5 w-3.5" /> Forensic narrative
      </p>
      <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-300">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}

function PartyBar({ byParty, unit = "days" }: { byParty: Record<string, number>; unit?: string }) {
  const total = Math.max(1, Object.values(byParty).reduce((s, v) => s + Math.max(0, v), 0));
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-800">
        {(["employer", "contractor", "neutral"] as Party[]).map((p) => {
          const v = Math.max(0, byParty[p] || 0);
          return v > 0 ? (
            <div key={p} style={{ width: `${(v / total) * 100}%`, background: PARTY_COLOR[p] }}
              title={`${PARTY_LABEL[p]}: ${num(v, 1)} ${unit}`} />
          ) : null;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {(["employer", "contractor", "neutral"] as Party[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PARTY_COLOR[p] }} />
            <span className="text-zinc-400">{PARTY_LABEL[p]}</span>
            <b className="text-zinc-200">{num(byParty[p], 1)} {unit}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// day-indexed dual Gantt (baseline outline vs forecast/as-built fill)
function Gantt({ rows, names, chain }: { rows: ModelRow[]; names?: Record<string, string>; chain?: string[] }) {
  const maxDay = Math.max(1, ...rows.map((r) => Math.max(r.plannedFinishDay, r.abFinishDay)));
  const W = 720, rowH = 22, padL = 190;
  const x = (d: number) => padL + (d / maxDay) * (W - padL - 12);
  const inChain = new Set(chain || []);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${rows.length * rowH + 24}`} width="100%" style={{ minWidth: 640 }}>
        {rows.map((r, i) => {
          const y = i * rowH + 6;
          const slipped = r.abFinishDay > r.plannedFinishDay;
          return (
            <g key={r.aid}>
              <text x={4} y={y + 11} fontSize={9.5} fill={inChain.has(r.aid) ? "#f59e0b" : "#a1a1aa"}>
                {(names?.[r.aid] || r.name).slice(0, 30)}
              </text>
              {/* baseline outline */}
              <rect x={x(r.plannedStartDay)} y={y} width={Math.max(2, x(r.plannedFinishDay) - x(r.plannedStartDay))}
                height={7} rx={2} fill="none" stroke="#3f3f46" strokeWidth={1} />
              {/* forecast / as-built fill */}
              <rect x={x(r.abStartDay)} y={y + 8} width={Math.max(2, x(r.abFinishDay) - x(r.abStartDay))}
                height={7} rx={2} fill={slipped ? "#f59e0b" : "#34d399"} opacity={0.85} />
              {r.slipDays > 0 && (
                <text x={x(r.abFinishDay) + 3} y={y + 14} fontSize={8} fill="#f59e0b">+{r.slipDays}d</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded border border-zinc-600" /> Baseline</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-emerald-400" /> On-forecast</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-amber-400" /> Slipped forecast</span>
      </div>
    </div>
  );
}

export default function DelayStudioLive() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState("");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [packageId, setPackageId] = useState("");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [method, setMethod] = useState<MethodKey>("apab");
  const [result, setResult] = useState<any>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [tiaAid, setTiaAid] = useState("");
  const [tiaDays, setTiaDays] = useState(30);
  const [tiaParty, setTiaParty] = useState<Party>("employer");
  const [kgBusy, setKgBusy] = useState(false);
  const [kgPreview, setKgPreview] = useState<KgSuggestion[] | null>(null);
  const [kgNote, setKgNote] = useState("");
  const [evidence, setEvidence] = useState<any>(null);

  const pkgQ = packageId ? `?package_id=${packageId}` : "";

  useEffect(() => {
    authFetch(`${API}/dashboard/scheme-cards`).then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      setSchemes(d.map((s: any) => ({ id: s.id, name: s.name })));
      setSchemeId((c) => c || String(d.find((s: any) => s.id === 74)?.id || d[0]?.id || ""));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!schemeId) return;
    setPackages([]); setPackageId("");
    authFetch(`${API}/dpr/scheme/${schemeId}/packages`).then((r) => r.json())
      .then((d) => Array.isArray(d) && setPackages(d)).catch(() => {});
  }, [schemeId]);

  const loadSchedule = useCallback(() => {
    if (!schemeId) return;
    setErr("");
    authFetch(`${API}/delay/schedule/${schemeId}${pkgQ}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.detail)))
      .then((d) => { setSchedule(d); setEvents([]); setTiaAid(d.suggestedTiaActivity || ""); })
      .catch((e) => { setSchedule(null); setErr(String(e)); });
    authFetch(`${API}/delay/events/${schemeId}`).then((r) => r.json())
      .then((d) => setEvents(d.events || [])).catch(() => {});
  }, [schemeId, pkgQ]);

  useEffect(loadSchedule, [loadSchedule]);

  const runMethod = useCallback(() => {
    if (!schemeId || !schedule) return;
    setLoading(true); setErr(""); setResult(null);
    if (method === "tia") {
      // empty selection → -1 so the backend targets the baseline completion driver
      const aid = tiaAid ? Number(tiaAid) : -1;
      authFetch(`${API}/delay/tia/${schemeId}${pkgQ}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_id: aid, name: "Fragnet", party: tiaParty, days: tiaDays }),
      }).then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.detail)))
        .then((d) => { setResult(d.result); setNames(d.activityNames || {}); })
        .catch((e) => setErr(String(e))).finally(() => setLoading(false));
      return;
    }
    const q = method === "windows" ? (pkgQ ? `${pkgQ}&windows=4` : "?windows=4") : pkgQ;
    authFetch(`${API}/delay/${method}/${schemeId}${q}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.detail)))
      .then((d) => { setResult(d.result); setNames(d.activityNames || {}); })
      .catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [schemeId, schedule, method, pkgQ, tiaAid, tiaDays, tiaParty]);

  useEffect(() => { if (schedule) runMethod(); }, [schedule, method, runMethod]);

  const autopopulate = async () => {
    await authFetch(`${API}/delay/events/${schemeId}/autopopulate${pkgQ}`, { method: "POST" }).catch(() => {});
    loadSchedule();
  };

  const previewKg = async () => {
    if (!schemeId) return;
    setKgBusy(true); setKgNote("");
    try {
      const d = await authFetch(`${API}/delay/kg-suggestions/${schemeId}${pkgQ}`).then((r) => r.json());
      setKgPreview(d.suggestions || []);
      if (!d.kg_available) setKgNote("Knowledge graph tables missing — run AI graph sync.");
      else if (!(d.suggestions || []).length) setKgNote(d.note || "No caused_delay edges for this scheme yet.");
      else setKgNote(`${d.count} correspondence-linked causes ready to import.`);
    } catch (e: any) {
      setKgNote(e?.message || "KG preview failed");
      setKgPreview([]);
    } finally {
      setKgBusy(false);
    }
  };

  const seedFromKg = async () => {
    if (!schemeId) return;
    setKgBusy(true); setKgNote("");
    try {
      const d = await authFetch(`${API}/delay/events/${schemeId}/from-kg${pkgQ}`, { method: "POST" }).then((r) => r.json());
      setKgNote(d.note || `Imported ${d.created || 0} KG delay events.`);
      await loadSchedule();
      runMethod();
      // refresh preview counts
      previewKg();
    } catch (e: any) {
      setKgNote(e?.message || "KG import failed");
    } finally {
      setKgBusy(false);
    }
  };

  const openEvidence = async (eventId: number) => {
    try {
      const d = await authFetch(`${API}/delay/evidence/${eventId}`).then((r) => r.json());
      setEvidence(d);
    } catch {
      setEvidence(null);
    }
  };

  const patchEvent = async (e: EventRow, patch: Partial<EventRow>) => {
    const body = { activity_id: e.activity_id, name: e.name, party: e.party,
      delay_days: e.delay_days, at_date: e.at_date, description: e.description, ...patch };
    setEvents((cur) => cur.map((x) => x.event_id === e.event_id ? { ...x, ...patch } : x));
    await authFetch(`${API}/delay/events/${e.event_id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => {});
    runMethod();
  };
  const deleteEvent = async (id: number) => {
    setEvents((cur) => cur.filter((x) => x.event_id !== id));
    await authFetch(`${API}/delay/events/${id}`, { method: "DELETE" }).catch(() => {});
    runMethod();
  };

  const kgEventCount = useMemo(() => events.filter((e) => e.source === "kg_delay").length, [events]);

  const meta = METHODS.find((m) => m.key === method)!;
  const rows = schedule?.rows || [];

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <GitBranch className="h-6 w-6 text-amber-400" /> Delay Analysis Studio
          </h1>
          <p className="text-sm text-zinc-400">Five forensic methods over the live baseline-vs-forecast network · authoritative Python engine</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)}
            className="min-w-[240px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs outline-none focus:border-amber-500">
            {schemes.map((s) => <option key={s.id} value={String(s.id)}>#{s.id} · {s.name.slice(0, 48)}</option>)}
          </select>
          <select value={packageId} onChange={(e) => setPackageId(e.target.value)}
            className="min-w-[170px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs outline-none focus:border-amber-500">
            <option value="">— All Sub-Projects —</option>
            {packages.map((p) => <option key={p.package_id} value={String(p.package_id)}>{p.package_name}</option>)}
          </select>
        </div>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        {/* method rail */}
        <div className="space-y-2">
          {METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.key} onClick={() => setMethod(m.key)}
                className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                  method === m.key ? "border-amber-500/50 bg-amber-500/10" : "border-zinc-800 hover:border-zinc-700"}`}>
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${method === m.key ? "text-amber-400" : "text-zinc-500"}`} />
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{m.name}</div>
                  <div className="font-mono text-[9.5px] uppercase tracking-wide text-zinc-500">{m.tag}</div>
                </div>
              </button>
            );
          })}
          {schedule && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] text-zinc-400">
              <div className="mb-1 font-bold text-zinc-300">Network</div>
              {schedule.meta.activityCount} activities · origin {schedule.meta.origin}
              <div className="mt-1">{schedule.meta.packages.length} package(s)</div>
            </div>
          )}
        </div>

        {/* method panel */}
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{meta.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-amber-300/80">{meta.tag}</span>
              {loading && <RefreshCw className="ml-auto h-4 w-4 animate-spin text-zinc-500" />}
            </div>
          </div>

          {/* per-method body */}
          {method === "apab" && result && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Baseline finish" value={`day ${num(result.plannedFinish)}`} />
                <Stat label="As-built / forecast finish" value={`day ${num(result.asBuiltFinish)}`} tone="amber" />
                <Stat label="Project slip" value={`${num(result.projectSlip)} d`} tone="red" />
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-2 text-xs font-bold text-zinc-300">Baseline vs forecast (as-built) — driving chain in amber</p>
                <Gantt rows={rows} names={names} chain={result.drivingChain} />
              </div>
              <VarianceLedger rows={result.rows} names={names} />
              <Narrative lines={result.narrative} />
            </>
          )}

          {method === "iap" && result && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Baseline finish" value={`day ${num(result.baselineFinish)}`} />
                <Stat label="Impacted finish" value={`day ${num(result.impactedFinish)}`} tone="amber" />
                <Stat label="Total impact" value={`+${num(result.totalImpact)} d`} tone="red" />
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-3 text-xs font-bold text-zinc-300">Additive event insertion — each event's marginal push to completion</p>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
                    <tr><th className="py-1 text-left">Event</th><th className="text-left">Party</th>
                      <th className="text-right">Event days</th><th className="text-right">Finish before→after</th><th className="text-right">Impact</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {result.steps.map((s: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1.5 text-zinc-200">{s.event.name}</td>
                        <td><span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ background: `${PARTY_COLOR[s.event.party as Party]}22`, color: PARTY_COLOR[s.event.party as Party] }}>{PARTY_LABEL[s.event.party as Party]}</span></td>
                        <td className="text-right text-zinc-400">{num(s.event.days)}</td>
                        <td className="text-right text-zinc-500">{num(s.finishBefore)} → {num(s.finishAfter)}</td>
                        <td className="text-right font-bold text-amber-300">+{num(s.impact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-2 text-xs font-bold text-zinc-300">Attribution (additive)</p>
                <PartyBar byParty={result.byParty} />
              </div>
              <Narrative lines={result.narrative} />
            </>
          )}

          {method === "collapsed" && result && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="As-built finish" value={`day ${num(result.asBuiltFinish)}`} tone="amber" />
                <Stat label="But-for ALL events" value={`day ${num(result.scenarios.find((s: any) => s.removedParty === "all")?.collapsedFinish)}`} tone="green" />
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-3 text-xs font-bold text-zinc-300">But-for scenarios — days the project collapses when a party's events are removed</p>
                <div className="space-y-2">
                  {result.scenarios.map((s: any) => (
                    <div key={s.removedParty} className="flex items-center gap-3">
                      <span className="w-28 text-xs capitalize text-zinc-300">{s.removedParty === "all" ? "All events" : PARTY_LABEL[s.removedParty as Party]}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-4 rounded-full" style={{
                          width: `${Math.min(100, (s.saved / Math.max(1, result.asBuiltFinish)) * 100)}%`,
                          background: s.removedParty === "all" ? "#34d399" : PARTY_COLOR[s.removedParty as Party] }} />
                      </div>
                      <span className="w-24 text-right text-xs"><b className="text-zinc-100">{num(s.saved, 1)} d</b> saved</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-2 text-xs font-bold text-zinc-300">Attribution (but-for)</p>
                <PartyBar byParty={result.byParty} />
              </div>
              <Narrative lines={result.narrative} />
            </>
          )}

          {method === "windows" && result && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Cumulative slip" value={`${num(result.totalSlip, 1)} d`} tone="amber" />
                <Stat label="Unexplained" value={`${num(result.unexplained, 1)} d`} tone="red" />
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-3 text-xs font-bold text-zinc-300">Contemporaneous windows — forecast drift & responsibility per period</p>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
                    <tr><th className="py-1 text-left">Window (days)</th><th className="text-right">Forecast start→end</th>
                      <th className="text-right">Slip</th><th className="text-left">Attributed</th><th className="text-right">Unexpl.</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {result.windows.map((w: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1.5 text-zinc-300">{num(w.from)}–{num(w.to)}</td>
                        <td className="text-right text-zinc-500">{num(w.forecastAtStart)} → {num(w.forecastAtEnd)}</td>
                        <td className="text-right font-bold text-amber-300">{num(w.slip, 1)}</td>
                        <td className="text-zinc-400">{w.attributed.length ? w.attributed.map((a: any) => `${a.event.name} ${num(a.days, 1)}d`).join(", ") : "—"}</td>
                        <td className="text-right text-red-300">{num(w.unexplained, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-2 text-xs font-bold text-zinc-300">Attribution (contemporaneous)</p>
                <PartyBar byParty={result.byParty} />
              </div>
              <Narrative lines={result.narrative} />
            </>
          )}

          {method === "tia" && (
            <>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="mb-3 text-xs font-bold text-zinc-300">Fragnet — insert a delay event at the data date, measure the forecast shift</p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-zinc-400">Activity
                    <select value={tiaAid} onChange={(e) => setTiaAid(e.target.value)}
                      className="mt-1 block min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs outline-none">
                      <option value="">(largest slip)</option>
                      {rows.map((r) => <option key={r.aid} value={r.aid}>{r.name.slice(0, 36)}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-zinc-400">Delay days
                    <input type="number" value={tiaDays} onChange={(e) => setTiaDays(Number(e.target.value))}
                      className="mt-1 block w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs outline-none" />
                  </label>
                  <label className="text-xs text-zinc-400">Party
                    <select value={tiaParty} onChange={(e) => setTiaParty(e.target.value as Party)}
                      className="mt-1 block rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs outline-none">
                      {(["employer", "contractor", "neutral"] as Party[]).map((p) => <option key={p} value={p}>{PARTY_LABEL[p]}</option>)}
                    </select>
                  </label>
                  <button onClick={runMethod} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20">
                    Run TIA
                  </button>
                </div>
              </div>
              {result && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Forecast without" value={`day ${num(result.forecastWithout)}`} />
                    <Stat label="Forecast with fragnet" value={`day ${num(result.forecastWith)}`} tone="amber" />
                    <Stat label="Time impact (EOT)" value={`${num(result.impact)} d`} tone="red" />
                  </div>
                  <Narrative lines={result.narrative} />
                </>
              )}
            </>
          )}

          {/* Sprint 3 · KG → register (moat) */}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-xs font-bold text-violet-200">
                <Network className="h-3.5 w-3.5" /> Knowledge-graph attribution
              </p>
              {kgEventCount > 0 && (
                <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-200">
                  {kgEventCount} from correspondence
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Link href="/knowledge-graph"
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800">
                  <Network className="h-3 w-3" /> Open graph
                </Link>
                <button type="button" disabled={kgBusy || !schemeId} onClick={previewKg}
                  className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
                  Preview KG causes
                </button>
                <button type="button" disabled={kgBusy || !schemeId} onClick={seedFromKg}
                  className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
                  {kgBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  Import from correspondence
                </button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Pre-populate the register from <span className="font-mono text-red-300">caused_delay</span> edges
              mined from letters / notes — with document evidence and auto-suggested party. Override party anytime.
            </p>
            {kgNote && <p className="mt-2 text-[11px] text-violet-200/90">{kgNote}</p>}
            {kgPreview && kgPreview.length > 0 && (
              <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
                {kgPreview.slice(0, 12).map((s) => (
                  <div key={s.kg_edge_id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-200">{s.cause_label}</span>
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                        style={{ background: `${PARTY_COLOR[s.party_suggested] || "#a78bfa"}22`, color: PARTY_COLOR[s.party_suggested] || "#a78bfa" }}>
                        {PARTY_LABEL[s.party_suggested] || s.party_suggested}
                      </span>
                      {s.document_title && (
                        <span className="truncate text-zinc-500">· {s.document_title}</span>
                      )}
                    </div>
                    {s.evidence_quote && (
                      <p className="mt-0.5 line-clamp-2 italic text-zinc-500">&ldquo;{s.evidence_quote}&rdquo;</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* shared event register */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-zinc-300">Delay-event register <span className="text-zinc-500">({events.length})</span></p>
              <button onClick={autopopulate}
                className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20">
                <RefreshCw className="h-3.5 w-3.5" /> Auto-populate from slips
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No events. Import from correspondence (KG) or auto-populate from baseline→forecast slips, then attribute party.
              </p>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-1 text-left">Event</th>
                      <th className="text-right">Days</th>
                      <th className="text-left">Party</th>
                      <th className="text-left">Evidence</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {events.map((e) => (
                      <tr key={e.event_id} className={e.source === "kg_delay" ? "bg-violet-500/5" : ""}>
                        <td className="py-1.5 text-zinc-300">
                          {e.name}
                          {e.source === "autoslip" && (
                            <span className="ml-1 rounded bg-zinc-800 px-1 text-[9px] text-zinc-500">auto</span>
                          )}
                          {e.source === "kg_delay" && (
                            <span className="ml-1 rounded border border-violet-400/40 bg-violet-500/15 px-1.5 text-[9px] font-bold text-violet-200">
                              Attributed from correspondence
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <input type="number" value={e.delay_days}
                            onChange={(ev) => patchEvent(e, { delay_days: Number(ev.target.value) })}
                            className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-right outline-none" />
                        </td>
                        <td>
                          <select value={e.party} onChange={(ev) => patchEvent(e, { party: ev.target.value as Party })}
                            className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 outline-none"
                            style={{ color: PARTY_COLOR[e.party] }}>
                            {(["employer", "contractor", "neutral"] as Party[]).map((p) => (
                              <option key={p} value={p}>{PARTY_LABEL[p]}</option>
                            ))}
                          </select>
                          {e.party_suggested && e.party_suggested !== e.party && (
                            <span className="ml-1 text-[9px] text-zinc-600">sug: {e.party_suggested}</span>
                          )}
                        </td>
                        <td>
                          {(e.source === "kg_delay" || e.evidence_document_id) ? (
                            <button type="button" onClick={() => openEvidence(e.event_id)}
                              className="flex items-center gap-1 text-[10px] font-semibold text-cyan-400 hover:underline">
                              <FileText className="h-3 w-3" /> View
                            </button>
                          ) : (
                            <span className="text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="text-right">
                          <button onClick={() => deleteEvent(e.event_id)} className="text-zinc-600 hover:text-red-400">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Evidence side drawer */}
      {evidence && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Evidence drawer</p>
              <p className="text-sm font-bold text-zinc-100">{evidence.name}</p>
            </div>
            <button type="button" onClick={() => setEvidence(null)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            {evidence.source === "kg_delay" && (
              <span className="inline-flex rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-[10px] font-bold text-violet-200">
                Attributed from correspondence
              </span>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Cause</p>
              <p className="text-zinc-200">{evidence.cause_label || "—"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Party (current)</p>
                <p style={{ color: PARTY_COLOR[evidence.party as Party] }} className="font-bold">
                  {PARTY_LABEL[evidence.party as Party] || evidence.party}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Suggested</p>
                <p className="text-zinc-300">{evidence.party_suggested || "—"}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Quote</p>
              <blockquote className="mt-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-xs italic leading-relaxed text-zinc-300">
                {evidence.evidence_quote || evidence.description || "No quote stored."}
              </blockquote>
            </div>
            {evidence.document && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Document</p>
                <p className="text-zinc-200">{evidence.document.title || `Document #${evidence.evidence_document_id}`}</p>
                {evidence.evidence_document_id && (
                  <Link href={`/view/${evidence.evidence_document_id}`}
                    className="mt-1 inline-block text-xs font-semibold text-cyan-400 hover:underline">
                    Open in vault →
                  </Link>
                )}
              </div>
            )}
            {!evidence.document && evidence.evidence_document_id && (
              <Link href={`/view/${evidence.evidence_document_id}`}
                className="inline-block text-xs font-semibold text-cyan-400 hover:underline">
                Open document #{evidence.evidence_document_id} →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "red" | "green" }) {
  const cls = tone === "amber" ? "text-amber-300" : tone === "red" ? "text-red-300" : tone === "green" ? "text-emerald-300" : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function VarianceLedger({ rows, names }: { rows: any[]; names?: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="mb-3 text-xs font-bold text-zinc-300">Variance ledger</p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wide text-zinc-500">
            <tr><th className="py-1 text-left">Activity</th><th className="text-right">Baseline S→F</th>
              <th className="text-right">Forecast S→F</th><th className="text-right">Finish var</th>
              <th className="text-right">Own slip</th><th className="text-center">Driving</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map((r) => (
              <tr key={r.id} className={r.asBuiltCritical ? "bg-amber-500/5" : ""}>
                <td className="py-1.5 text-zinc-300">{names?.[r.id] || r.name}</td>
                <td className="text-right text-zinc-500">{num(r.plannedStart)}→{num(r.plannedFinish)}</td>
                <td className="text-right text-zinc-400">{r.actualStart == null ? "—" : `${num(r.actualStart)}→${num(r.actualFinish)}`}</td>
                <td className={`text-right font-bold ${(r.finishVar ?? 0) > 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {r.finishVar == null ? "—" : (r.finishVar > 0 ? `+${num(r.finishVar)}` : num(r.finishVar))}</td>
                <td className="text-right text-zinc-400">{r.ownSlip == null ? "—" : num(r.ownSlip)}</td>
                <td className="text-center">{r.asBuiltCritical ? <span className="text-amber-400">●</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
