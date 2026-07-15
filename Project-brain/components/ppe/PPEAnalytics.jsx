"use client";
/**
 * PPE Analytics — industry-standard compliance overview.
 * Uses live camera stats + violation type counts (no separate analytics backend).
 */
import React, { useCallback, useEffect, useState } from "react";

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

/** What the stock pretrained models actually detect */
const MODEL_COVERAGE = [
  { gear: "Helmet / Hardhat", snehil: true, vox: true, nduka: true, vyra: true, note: "Cap Found / Not found" },
  { gear: "Safety vest", snehil: true, vox: true, nduka: true, vyra: true, note: "Safety Jacket" },
  { gear: "Face mask", snehil: true, vox: true, nduka: false, vyra: true, note: "Mask" },
  { gear: "Person", snehil: true, vox: true, nduka: true, vyra: true, note: "Person box" },
  { gear: "Safety cone", snehil: true, vox: true, nduka: false, vyra: true, note: "Scene object" },
  { gear: "Vehicle / machinery", snehil: true, vox: true, nduka: false, vyra: false, note: "Near-miss context" },
  { gear: "Gloves", snehil: false, vox: false, nduka: false, vyra: true, note: "Hexmon/Vyra" },
  { gear: "Goggles", snehil: false, vox: false, nduka: false, vyra: true, note: "Hexmon/Vyra" },
  { gear: "Fall detected", snehil: false, vox: false, nduka: false, vyra: true, note: "Hexmon/Vyra" },
  { gear: "Boots", snehil: false, vox: false, nduka: false, vyra: false, note: "Fine-tune" },
  { gear: "Harness", snehil: false, vox: false, nduka: false, vyra: false, note: "Fine-tune" },
];

export default function PPEAnalytics({ embedded = false }) {
  const [cams, setCams] = useState([]);
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [liveModel, setLiveModel] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, t, p, m] = await Promise.all([
        api("/api/cameras").catch(() => []),
        api("/api/violations/types").catch(() => ({ types: [], total: 0 })),
        api("/api/review/pending").catch(() => []),
        api("/api/models").catch(() => ({})),
      ]);
      setCams(Array.isArray(c) ? c : []);
      setTypes(t.types || []);
      setTotal(t.total || 0);
      setPending(Array.isArray(p) ? p.length : 0);
      setLiveModel((m.live_weights || "").split(/[\\/]/).pop() || "—");
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const running = cams.filter((c) => c.state === "running").length;
  const violations = cams.reduce((s, c) => s + (c.stats?.violations_fired || 0), 0);
  const harvested = cams.reduce((s, c) => s + (c.stats?.captures_made || 0), 0);
  const inferred = cams.reduce((s, c) => s + (c.stats?.frames_inferred || 0), 0);
  const maxType = Math.max(1, ...types.map((t) => t.count || 0));

  const kpis = [
    { label: "Cameras live", value: `${running}/${cams.length}`, tone: running ? "ok" : "mute" },
    { label: "Violations logged", value: String(total), tone: total ? "danger" : "mute" },
    { label: "Fired (session)", value: String(violations), tone: violations ? "danger" : "mute" },
    { label: "Frames inferred", value: String(inferred), tone: "brand" },
    { label: "Harvested frames", value: String(harvested), tone: harvested ? "ok" : "mute" },
    { label: "Review queue", value: String(pending), tone: pending ? "warn" : "mute" },
  ];

  const toneMap = {
    ok: { fg: C.ok, bg: C.okSoft },
    danger: { fg: C.danger, bg: C.dangerSoft },
    warn: { fg: C.warn, bg: C.warnSoft },
    brand: { fg: C.brand, bg: C.brandSoft },
    mute: { fg: C.ink, bg: C.panel },
  };

  return (
    <div style={{
      padding: embedded ? "16px 20px 40px" : "20px 24px",
      fontFamily: "'Inter', system-ui, sans-serif",
      color: C.ink,
    }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Analytics & coverage</h2>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.sub }}>
          Live KPIs · violation mix · what each stock model can actually detect
        </p>
      </div>

      {err ? (
        <div style={{ background: C.dangerSoft, color: C.danger, padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          {err}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
        {kpis.map((k) => {
          const t = toneMap[k.tone] || toneMap.mute;
          return (
            <div key={k.label} style={{
              background: t.bg, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "14px 14px", boxShadow: C.shadow,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: t.fg, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 14 }}>
        {/* Violation mix */}
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: C.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 }}>
            Violations by type
          </div>
          {!types.length ? (
            <div style={{ color: C.sub, fontSize: 13, padding: "20px 0" }}>
              No violations yet. Run cameras in <b>Monitor</b> or <b>Collect</b> mode.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {types.map((t) => (
                <div key={t.category}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700 }}>{t.label}</span>
                    <span style={{ ...mono, color: C.sub }}>{t.count}</span>
                  </div>
                  <div style={{ height: 8, background: C.panel2, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.round((t.count / maxType) * 100)}%`,
                      height: "100%",
                      background: t.severity === "critical" ? C.danger : t.severity === "high" ? "#e85d4c" : C.warn,
                      borderRadius: 99,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, fontSize: 12, color: C.sub }}>
            Live model weights: <span style={{ ...mono, color: C.ink }}>{liveModel}</span>
          </div>
        </section>

        {/* Model coverage truth table */}
        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: C.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            Stock model PPE coverage
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.sub, lineHeight: 1.45 }}>
            Four stock models in the AI Model dropdown. Pick <b>Hexmon/Vyra</b> for the widest PPE set
            (gloves/goggles/fall); <b>nduka1999</b> for fast cap+vest; Snehil/VoxDroid for classic 10-class CSS.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.sub, fontSize: 10, textTransform: "uppercase" }}>
                  <th style={{ padding: "6px 6px", borderBottom: `1px solid ${C.line}` }}>Gear</th>
                  <th style={{ padding: "6px 6px", borderBottom: `1px solid ${C.line}` }}>Snehil</th>
                  <th style={{ padding: "6px 6px", borderBottom: `1px solid ${C.line}` }}>VoxDroid</th>
                  <th style={{ padding: "6px 6px", borderBottom: `1px solid ${C.line}` }}>nduka</th>
                  <th style={{ padding: "6px 6px", borderBottom: `1px solid ${C.line}` }}>Vyra</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_COVERAGE.map((row) => (
                  <tr key={row.gear}>
                    <td style={{ padding: "6px", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ fontWeight: 700 }}>{row.gear}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>{row.note}</div>
                    </td>
                    {[row.snehil, row.vox, row.nduka, row.vyra].map((ok, i) => (
                      <td key={i} style={{ padding: "6px", borderBottom: `1px solid ${C.line}`, color: ok ? C.ok : C.danger, fontWeight: 800 }}>
                        {ok ? "✓" : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: C.sub, lineHeight: 1.5, background: C.panel2, padding: 10, borderRadius: 8 }}>
            First select downloads weights (~40–50 MB). nduka is ONNX (CPU-friendly); others are .pt.
          </div>
        </section>
      </div>

      {/* Per-camera health */}
      {cams.length > 0 ? (
        <section style={{ marginTop: 14, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: C.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Camera health
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {cams.map((cam) => {
              const st = cam.stats || {};
              const ok = cam.state === "running";
              return (
                <div key={cam.camera_id} style={{
                  border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, background: C.panel2,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: ok ? C.ok : cam.state === "error" ? C.danger : C.sub }} />
                    <b style={{ fontSize: 13 }}>{cam.camera_id}</b>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: C.sub, textTransform: "uppercase" }}>{cam.mode || "—"}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.sub, ...mono }}>
                    {cam.source} · inf {st.frames_inferred ?? 0} · viol {st.violations_fired ?? 0}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
