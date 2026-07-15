"use client";
/**
 * PPE Violation Reports — audit-ready summary + table + CSV export.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path) {
  const r = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)", sub: "var(--ink-3)",
  line: "var(--line)", brand: "var(--steel)", brandSoft: "var(--steel-soft)",
  ok: "var(--verdigris)", okSoft: "var(--verdigris-soft)", warn: "var(--slag)", warnSoft: "var(--slag-soft)",
  danger: "var(--molten)", dangerSoft: "var(--molten-soft)",
  shadow: "var(--shadow)",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

function fmt(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function PPEReports({ embedded = false }) {
  const [summary, setSummary] = useState(null);
  const [types, setTypes] = useState([]);
  const [items, setItems] = useState([]);
  const [series, setSeries] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: "200" });
      if (from) p.set("date_from", from);
      if (to) p.set("date_to", to);
      if (status) p.set("status", status);

      const [sum, typ, viol, ts] = await Promise.all([
        api("/api/analytics/summary").catch(() => null),
        api("/api/violations/types").catch(() => ({ types: [] })),
        api(`/api/violations?${p}`).catch(() => ({ violations: [] })),
        api("/api/analytics/timeseries?days=14").catch(() => ({ series: [] })),
      ]);
      setSummary(sum);
      setTypes(typ.types || []);
      setItems(viol.violations || []);
      setSeries(ts.series || []);
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    if (status) p.set("status", status);
    if (!from && !to) p.set("hours", String(24 * 90));
    window.open(`${API_BASE}/api/violations/export.csv?${p}`, "_blank");
  };

  const maxDay = useMemo(() => Math.max(1, ...series.map((s) => s.count || 0)), [series]);

  const kpis = [
    { label: "Total violations", value: summary?.total_violations ?? "—", tone: "danger" },
    { label: "Open", value: summary?.open_violations ?? "—", tone: "warn" },
    { label: "Last 24h", value: summary?.violations_24h ?? "—", tone: "brand" },
    { label: "Alerts sent", value: summary?.alerts_total ?? "—", tone: "mute" },
    { label: "Rows (filter)", value: items.length, tone: "mute" },
  ];

  const toneMap = {
    danger: { fg: C.danger, bg: C.dangerSoft },
    warn: { fg: C.warn, bg: C.warnSoft },
    brand: { fg: C.brand, bg: C.brandSoft },
    mute: { fg: C.ink, bg: C.panel },
  };

  return (
    <div style={{
      padding: embedded ? "16px 20px 48px" : "20px 24px",
      fontFamily: "Inter, system-ui, sans-serif", color: C.ink,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>PPE violation reports</h2>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.sub }}>
            Audit log · type mix · daily trend · CSV export
          </p>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: C.panel,
          border: `1px solid ${C.line}`, borderRadius: 10, padding: "5px 10px", boxShadow: C.shadow,
        }}>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: 12.5, background: "transparent" }} />
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: 12.5, background: "transparent" }} />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{
            border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 10px",
            fontSize: 12.5, fontWeight: 700, background: C.panel, cursor: "pointer",
          }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="false_alarm">False alarm</option>
        </select>
        <button type="button" onClick={load} style={btnSecondary}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button type="button" onClick={exportCsv} style={btnPrimary}>
          ↓ Export CSV
        </button>
      </div>

      {err ? (
        <div style={{ background: C.dangerSoft, color: C.danger, padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
          {err}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
        {kpis.map((k) => {
          const t = toneMap[k.tone] || toneMap.mute;
          return (
            <div key={k.label} style={{
              background: t.bg, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "12px 14px", boxShadow: C.shadow,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.sub, textTransform: "uppercase" }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: t.fg, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 14, marginBottom: 14 }}>
        {/* By type */}
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: C.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Violations by PPE type
          </div>
          {!types.length ? (
            <div style={{ color: C.sub, fontSize: 13 }}>No data yet.</div>
          ) : types.map((t) => {
            const max = Math.max(1, ...types.map((x) => x.count));
            return (
              <div key={t.category} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700 }}>{t.label}</span>
                  <span style={{ ...mono, color: C.sub }}>{t.count}</span>
                </div>
                <div style={{ height: 8, background: C.panel2, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    width: `${(t.count / max) * 100}%`, height: "100%", borderRadius: 99,
                    background: t.severity === "critical" ? C.danger : C.warn,
                  }} />
                </div>
              </div>
            );
          })}
        </section>

        {/* Daily trend */}
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: C.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Daily trend (14 days)
          </div>
          {!series.length ? (
            <div style={{ color: C.sub, fontSize: 13 }}>No time-series yet.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {series.slice(-14).map((s) => (
                <div key={s.date} title={`${s.date}: ${s.count}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: "100%", maxWidth: 28,
                    height: Math.max(4, (s.count / maxDay) * 100),
                    background: C.brand, borderRadius: "4px 4px 0 0",
                  }} />
                  <span style={{ fontSize: 9, color: C.sub, transform: "rotate(-40deg)", whiteSpace: "nowrap" }}>
                    {s.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Detail table */}
      <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: C.shadow, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.line}`, fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Violation log ({items.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: C.panel2, textAlign: "left", color: C.sub, fontSize: 11, textTransform: "uppercase" }}>
                {["Time", "Camera", "Violation", "Conf.", "Status", "Track"].map((h) => (
                  <th key={h} style={{ padding: "9px 12px", borderBottom: `1px solid ${C.line}`, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: "9px 12px", ...mono, whiteSpace: "nowrap" }}>{fmt(v.occurred_at)}</td>
                  <td style={{ padding: "9px 12px", fontWeight: 700 }}>{v.camera_id}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{
                      background: C.dangerSoft, color: C.danger, fontWeight: 800,
                      padding: "2px 8px", borderRadius: 6, fontSize: 12,
                    }}>
                      {v.label}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", ...mono }}>{Math.round((v.confidence || 0) * 100)}%</td>
                  <td style={{ padding: "9px 12px", textTransform: "capitalize", fontWeight: 700, color: v.status === "open" ? C.danger : v.status === "resolved" ? C.ok : C.warn }}>
                    {(v.status || "").replace("_", " ")}
                  </td>
                  <td style={{ padding: "9px 12px", ...mono, color: C.sub }}>{v.track_id ?? "—"}</td>
                </tr>
              ))}
              {!items.length && !loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 28, textAlign: "center", color: C.sub }}>
                    No violations for this filter. Run cameras in Monitor mode to populate the report.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const btnPrimary = {
  border: "none", background: "var(--steel)", color: "#fff", borderRadius: 9,
  padding: "8px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
};
const btnSecondary = {
  border: "1px solid var(--line)", background: C.panel, color: "var(--ink-3)", borderRadius: 9,
  padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
};
