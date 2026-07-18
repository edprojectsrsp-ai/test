"use client";

/**
 * EVM Studio — Earned Value Management.
 *
 * Two views:
 *   · Portfolio board — every active scheme's latest CPI/SPI/EAC, worst first
 *     (the review-meeting exception list), traffic-light health.
 *   · Scheme detail — in-page scheme selector (Plan Engine pattern), FY picker,
 *     KPI cards, cumulative PV/EV/AC curve, monthly metric table, EAC forecasts.
 *
 * Basis: PV/AC financial (effective CAPEX plan + booked actuals, ₹ Cr);
 * EV = weighted physical % complete × BAC. Definitions from /evm/glossary.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowLeft, Gauge, HelpCircle, IndianRupee,
  LayoutGrid, Loader2, RefreshCw, TrendingDown, TrendingUp, X,
} from "lucide-react";
import { authFetch } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

const MONTH_NAMES: Record<number, string> = {
  4: "Apr", 5: "May", 6: "Jun", 7: "Jul", 8: "Aug", 9: "Sep",
  10: "Oct", 11: "Nov", 12: "Dec", 1: "Jan", 2: "Feb", 3: "Mar",
};

type SeriesRow = {
  month_no: number; pv: number | null; ev: number | null; ac: number | null;
  sv: number | null; cv: number | null; spi: number | null; cpi: number | null;
  eac: number | null; eac_ac: number | null; eac_scr: number | null;
  etc: number | null; vac: number | null; tcpi: number | null;
  pct_planned: number | null; pct_complete: number | null; future: boolean;
};
type SchemeEvm = {
  scheme_id: number; fy: string; bac: number; exp_last_fy: number;
  be_fy: number | null; re_fy: number | null; has_physical: boolean;
  series: SeriesRow[]; latest: SeriesRow | null; health: string;
};
type PortfolioRow = {
  scheme_id: number; scheme_name: string; bac: number | null; health: string;
  has_physical: boolean; month_no?: number; pv?: number | null; ev?: number | null;
  ac?: number | null; spi?: number | null; cpi?: number | null; eac?: number | null;
  vac?: number | null; tcpi?: number | null; pct_planned?: number | null; pct_complete?: number | null;
};

const HEALTH_COLOR: Record<string, string> = {
  green: "#3fb950", amber: "#f0883e", red: "#e5534b", unknown: "var(--ink-4)",
};

const panel: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12 };
const inp: React.CSSProperties = {
  background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8,
  color: "var(--ink)", fontSize: 12.5, padding: "7px 10px", outline: "none",
};
const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";

const fmtCr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })}`;
const fmtIdx = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toFixed(2);

function idxColor(v: number | null | undefined): string {
  if (v == null) return "var(--ink-4)";
  if (v >= 0.95) return "#3fb950";
  if (v >= 0.85) return "#f0883e";
  return "#e5534b";
}

export default function EvmStudio() {
  const now = new Date();
  const defaultFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  const [fy, setFy] = useState(defaultFy);
  const [schemes, setSchemes] = useState<{ scheme_id: number; scheme_name: string }[]>([]);
  const [schemeId, setSchemeId] = useState<number | null>(null);   // null = portfolio board
  const [portfolio, setPortfolio] = useState<{ counts: Record<string, number>; schemes: PortfolioRow[] } | null>(null);
  const [detail, setDetail] = useState<SchemeEvm | null>(null);
  const [glossary, setGlossary] = useState<{ key: string; name: string; def: string }[]>([]);
  const [showGlossary, setShowGlossary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API}/evm/glossary`);
        setGlossary((await r.json()).metrics || []);
      } catch { /* help stays empty */ }
    })();
  }, []);

  const loadPortfolio = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const r = await authFetch(`${API}/evm/portfolio?fy_start_year=${fy}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Load failed");
      setPortfolio(j);
      setSchemes(j.schemes.map((s: PortfolioRow) => ({ scheme_id: s.scheme_id, scheme_name: s.scheme_name })));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [fy]);

  const loadDetail = useCallback(async (sid: number) => {
    setBusy(true); setErr("");
    try {
      const r = await authFetch(`${API}/evm/scheme/${sid}?fy_start_year=${fy}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Load failed");
      setDetail(j);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [fy]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);
  useEffect(() => { if (schemeId != null) loadDetail(schemeId); else setDetail(null); }, [schemeId, loadDetail]);

  const chartData = useMemo(() => (detail?.series || []).map((s) => ({
    name: MONTH_NAMES[s.month_no],
    PV: s.pv, EV: s.ev, AC: s.ac,
  })), [detail]);

  const latest = detail?.latest || null;
  const schemeName = schemes.find((s) => s.scheme_id === schemeId)?.scheme_name || `Scheme ${schemeId}`;

  return (
    <div style={{ padding: "16px 22px", maxWidth: 1280, margin: "0 auto" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Gauge size={19} style={{ color: "var(--steel)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 850, letterSpacing: "-0.02em" }}>EVM Studio</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
            Earned value · PV / EV / AC · CPI · SPI · EAC forecasting — live figures, ₹ Cr
          </div>
        </div>
        <select style={inp} value={schemeId ?? ""} onChange={(e) => setSchemeId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Portfolio board — all schemes</option>
          {schemes.map((s) => <option key={s.scheme_id} value={s.scheme_id}>{s.scheme_name}</option>)}
        </select>
        <select style={inp} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
          {[defaultFy - 2, defaultFy - 1, defaultFy, defaultFy + 1].map((y) => (
            <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>
          ))}
        </select>
        <button style={{ ...inp, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700 }}
                onClick={() => (schemeId != null ? loadDetail(schemeId) : loadPortfolio())}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        <button style={{ ...inp, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
                onClick={() => setShowGlossary(true)} title="Metric definitions">
          <HelpCircle size={13} />
        </button>
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(229,83,75,.12)",
                      border: "1px solid rgba(229,83,75,.4)", color: "#e5534b", fontSize: 12.5, fontWeight: 600 }}>
          {err}
        </div>
      )}

      {/* ================= portfolio board ================= */}
      {schemeId == null && portfolio && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {(["red", "amber", "green", "unknown"] as const).map((h) => (
              <div key={h} style={{ ...panel, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: HEALTH_COLOR[h] }} />
                <span style={{ fontSize: 20, fontWeight: 850, fontFamily: mono }}>{portfolio.counts[h] || 0}</span>
                <span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 700, textTransform: "uppercase" }}>{h}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ alignSelf: "center", fontSize: 11.5, color: "var(--ink-4)", display: "inline-flex", gap: 5, alignItems: "center" }}>
              <LayoutGrid size={12} /> Worst health first — click a scheme for the full curve
            </div>
          </div>

          <div style={{ ...panel, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {["", "Scheme", "BAC", "PV", "EV", "AC", "SPI", "CPI", "EAC", "VAC", "% Compl."].map((h, i) => (
                    <th key={i} style={{ position: "sticky", top: 0, background: "var(--panel-2)", padding: "8px 12px",
                                          textAlign: i < 2 ? "left" : "right", color: "var(--ink-3)", fontWeight: 800,
                                          borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {portfolio.schemes.map((s) => (
                  <tr key={s.scheme_id} onClick={() => setSchemeId(s.scheme_id)} style={{ cursor: "pointer" }}>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 999, background: HEALTH_COLOR[s.health] }} />
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", color: "var(--ink)", fontWeight: 650, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.scheme_name}
                      {!s.has_physical && (
                        <span title="No physical progress plan — EV unavailable"
                              style={{ marginLeft: 6, fontSize: 9.5, color: "var(--ink-4)", fontWeight: 700 }}>NO-PHYS</span>
                      )}
                    </td>
                    {[fmtCr(s.bac), fmtCr(s.pv), fmtCr(s.ev), fmtCr(s.ac)].map((v, i) => (
                      <td key={i} style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>{v}</td>
                    ))}
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, fontWeight: 800, color: idxColor(s.spi) }}>{fmtIdx(s.spi)}</td>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, fontWeight: 800, color: idxColor(s.cpi) }}>{fmtIdx(s.cpi)}</td>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>{fmtCr(s.eac)}</td>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: (s.vac ?? 0) < 0 ? "#e5534b" : "var(--ink-2)" }}>{fmtCr(s.vac)}</td>
                    <td style={{ padding: "7px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>
                      {s.pct_complete == null ? "—" : `${s.pct_complete.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {portfolio.schemes.length === 0 && (
              <div style={{ padding: 28, textAlign: "center", color: "var(--ink-4)", fontSize: 12.5 }}>
                No schemes with CAPEX plans or actuals for this FY.
              </div>
            )}
          </div>
        </>
      )}

      {/* ================= scheme detail ================= */}
      {schemeId != null && detail && (
        <>
          <button onClick={() => setSchemeId(null)}
                  style={{ ...inp, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12, fontWeight: 700 }}>
            <ArrowLeft size={13} /> Portfolio board
          </button>

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            <Kpi label="Health" value={detail.health.toUpperCase()} color={HEALTH_COLOR[detail.health]} icon={<Activity size={13} />} />
            <Kpi label="BAC (gross cost)" value={fmtCr(detail.bac)} icon={<IndianRupee size={13} />} />
            <Kpi label="SPI" value={fmtIdx(latest?.spi)} color={idxColor(latest?.spi)}
                 icon={(latest?.spi ?? 1) >= 1 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                 sub={latest?.sv != null ? `SV ${fmtCr(latest.sv)}` : undefined} />
            <Kpi label="CPI" value={fmtIdx(latest?.cpi)} color={idxColor(latest?.cpi)}
                 icon={(latest?.cpi ?? 1) >= 1 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                 sub={latest?.cv != null ? `CV ${fmtCr(latest.cv)}` : undefined} />
            <Kpi label="EAC (BAC÷CPI)" value={fmtCr(latest?.eac)}
                 sub={latest?.vac != null ? `VAC ${fmtCr(latest.vac)}` : undefined}
                 color={(latest?.vac ?? 0) < 0 ? "#e5534b" : undefined} />
            <Kpi label="TCPI" value={fmtIdx(latest?.tcpi)}
                 sub="efficiency to finish on BAC" />
            <Kpi label="% complete (phys)" value={latest?.pct_complete == null ? "—" : `${latest.pct_complete.toFixed(1)}%`}
                 sub={latest?.pct_planned != null ? `planned ${latest.pct_planned.toFixed(1)}%` : undefined} />
          </div>

          {!detail.has_physical && (
            <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, display: "flex", gap: 8, alignItems: "center",
                          background: "rgba(240,136,62,.1)", border: "1px solid rgba(240,136,62,.35)", color: "#f0883e", fontSize: 12 }}>
              <AlertTriangle size={13} /> No locked physical progress plan — EV / CPI / SPI unavailable. PV and AC curves still shown.
            </div>
          )}

          {/* curve */}
          <div style={{ ...panel, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--ink-2)" }}>
              Cumulative PV · EV · AC — {schemeName} · FY {detail.fy} (₹ Cr, incl. exp. till last FY {fmtCr(detail.exp_last_fy)})
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--ink-4)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--ink-4)" }} tickFormatter={(v: any) => Number(v).toLocaleString("en-IN")} width={64} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: any) => fmtCr(v)} contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 11.5 }} labelStyle={{ color: "var(--ink-2)", fontWeight: 700 }} />
                  <Legend wrapperStyle={{ fontSize: 11.5 }} />
                  <Line dataKey="PV" stroke="#6ea8fe" strokeWidth={2} dot={{ r: 2.5 }} strokeDasharray="6 3" />
                  <Line dataKey="EV" stroke="#3fb950" strokeWidth={2.4} dot={{ r: 2.5 }} />
                  <Line dataKey="AC" stroke="#e5534b" strokeWidth={2} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* monthly table */}
          <div style={{ ...panel, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr>
                  {["Month", "PV", "EV", "AC", "SV", "CV", "SPI", "CPI", "EAC", "EAC (atyp.)", "EAC (sch-adj.)", "ETC", "VAC", "TCPI", "% Compl."].map((h, i) => (
                    <th key={h} style={{ position: "sticky", top: 0, background: "var(--panel-2)", padding: "7px 10px",
                                          textAlign: i === 0 ? "left" : "right", color: "var(--ink-3)", fontWeight: 800,
                                          borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.series.map((s) => (
                  <tr key={s.month_no} style={{ opacity: s.future ? 0.45 : 1 }}>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", fontWeight: 750, color: "var(--ink-2)" }}>
                      {MONTH_NAMES[s.month_no]}{s.future ? " ·plan" : ""}
                    </td>
                    {[fmtCr(s.pv), fmtCr(s.ev), fmtCr(s.ac), fmtCr(s.sv), fmtCr(s.cv)].map((v, i) => (
                      <td key={i} style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>{v}</td>
                    ))}
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, fontWeight: 750, color: idxColor(s.spi) }}>{fmtIdx(s.spi)}</td>
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, fontWeight: 750, color: idxColor(s.cpi) }}>{fmtIdx(s.cpi)}</td>
                    {[fmtCr(s.eac), fmtCr(s.eac_ac), fmtCr(s.eac_scr), fmtCr(s.etc), fmtCr(s.vac), fmtIdx(s.tcpi)].map((v, i) => (
                      <td key={i} style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>{v}</td>
                    ))}
                    <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: mono, color: "var(--ink-2)" }}>
                      {s.pct_complete == null ? "—" : `${s.pct_complete.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* glossary drawer */}
      {showGlossary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
             onClick={() => setShowGlossary(false)}>
          <div style={{ width: 380, height: "100%", background: "var(--panel)", borderLeft: "1px solid var(--line)", padding: 18, overflow: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <HelpCircle size={15} style={{ color: "var(--steel)" }} />
              <b style={{ fontSize: 13, flex: 1 }}>EVM metric definitions</b>
              <X size={15} style={{ cursor: "pointer" }} onClick={() => setShowGlossary(false)} />
            </div>
            {glossary.map((g) => (
              <div key={g.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--steel)" }}>{g.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>{g.def}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <div style={{ ...panel, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                    color: "var(--ink-4)", display: "flex", alignItems: "center", gap: 5 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 850, fontFamily: mono, marginTop: 4, color: color || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
