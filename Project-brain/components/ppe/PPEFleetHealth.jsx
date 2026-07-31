"use client";
/**
 * PPEFleetHealth — is the system actually watching?
 *
 * "Running" was never the useful question. A camera can be running while its
 * feed is a frozen still, and a fleet can be entirely green while every
 * detection arrives seconds late because twenty cameras are queued behind one
 * model. Both of those look healthy on a status list and are why sites lose
 * trust in a safety system without ever seeing an error.
 *
 * So this shows the two things that actually determine whether violations get
 * caught: whether each stream is delivering fresh frames, and whether the
 * detector can keep up with the fleet.
 */
import React, { useCallback, useEffect, useState } from "react";
import { buildPpeUrl, getPpeApiBase } from "../../lib/ppeApi";

const API_BASE = getPpeApiBase();

async function api(path) {
  const r = await fetch(buildPpeUrl(path), { cache: "no-store" });
  const t = await r.text();
  let b; try { b = t ? JSON.parse(t) : {}; } catch { b = { detail: t }; }
  if (!r.ok) throw new Error(typeof b.detail === "string" ? b.detail : (b.detail ? JSON.stringify(b.detail) : `HTTP ${r.status}`));
  return b;
}

const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)",
  sub: "var(--ink-3)", line: "var(--line)", shadow: "var(--shadow)",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontVariantNumeric: "tabular-nums" };

const HEALTH = {
  healthy:      { label: "Healthy",      color: "var(--verdigris)", bg: "var(--verdigris-soft)" },
  degraded:     { label: "Degraded",     color: "var(--slag)", bg: "var(--slag-soft)" },
  reconnecting: { label: "Reconnecting", color: "var(--slag)", bg: "var(--slag-soft)" },
  frozen:       { label: "Frozen feed",  color: "var(--molten)", bg: "var(--molten-soft)" },
  offline:      { label: "Offline",      color: "var(--molten)", bg: "var(--molten-soft)" },
  starting:     { label: "Starting",     color: "var(--steel)", bg: "var(--steel-soft)" },
  stopped:      { label: "Stopped",      color: "var(--ink-3)", bg: "var(--panel-3)" },
};

const EXPLAIN = {
  frozen: "Reads are succeeding but the picture has not changed. The camera "
        + "will look fine in a status list — this is the failure most likely to "
        + "go unnoticed.",
  offline: "Repeated reconnects have failed. Retries continue at the capped "
         + "interval, so a camera powered down for a shift will rejoin on its own.",
  reconnecting: "The stream dropped and is being reopened with backoff.",
  degraded: "Some reads returned nothing. A dropped packet is normal; sustained "
          + "gaps trigger a reconnect.",
};

const fmtAgo = (s) => (s == null ? "—"
  : s < 60 ? `${Math.round(s)}s ago`
  : s < 3600 ? `${Math.round(s / 60)}m ago`
  : `${(s / 3600).toFixed(1)}h ago`);

function Stat({ label, value, tone, hint }) {
  return (
    <div title={hint} style={{
      flex: "1 1 130px", padding: "10px 13px", borderRadius: 11,
      background: C.panel, border: `1px solid ${C.line}`, boxShadow: C.shadow,
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub }}>
        {label}
      </div>
      <div style={{ ...mono, fontSize: 20, fontWeight: 800, marginTop: 3, color: tone || C.ink }}>
        {value}
      </div>
    </div>
  );
}

function Bar({ pct, tone }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: "var(--panel-3)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: tone }} />
    </div>
  );
}

export default function PPEFleetHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api("/api/cameras/health")); setError(null); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    load();
    if (!auto) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, auto]);

  if (error) {
    return (
      <div className="ppe-banner ppe-banner--danger" style={{ margin: 18 }}>
        Could not reach the PPE service: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 18, fontSize: 13, color: C.sub }}>Loading fleet health…</div>
    );
  }

  const cams = data.cameras || [];
  const inf = data.inference || {};
  const saturated = inf.saturated;
  const availPct = data.fleet_availability == null ? null : data.fleet_availability * 100;

  return (
    <div style={{ padding: "14px 18px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>Fleet health</div>
          <div style={{ fontSize: 12, color: C.sub }}>
            Stream freshness · freezes · detector capacity — not just “running”.
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setAuto((a) => !a)} style={{
          padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
          background: auto ? "var(--steel)" : C.panel, color: auto ? "#fff" : C.ink,
          border: `1px solid ${auto ? "var(--steel)" : C.line}`,
        }}>{auto ? "Live" : "Paused"}</button>
        <button type="button" onClick={load} style={{
          padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: "pointer", background: C.panel, color: C.ink, border: `1px solid ${C.line}`,
        }}>Refresh</button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Cameras" value={data.total ?? 0} />
        <Stat label="Not healthy" value={data.degraded ?? 0}
          tone={data.degraded ? "var(--molten)" : "var(--verdigris)"}
          hint="Frozen, reconnecting or offline." />
        <Stat label="Fleet uptime" value={availPct == null ? "—" : `${availPct.toFixed(1)}%`}
          tone={availPct != null && availPct < 95 ? "var(--slag)" : "var(--verdigris)"}
          hint="Share of wall time cameras have been delivering frames." />
        <Stat label="Detector load"
          value={inf.oversubscription ? `${inf.oversubscription}x` : "—"}
          tone={saturated ? "var(--molten)" : "var(--verdigris)"}
          hint="Requested inference rate divided by what the model can sustain." />
        <Stat label="Inference time"
          value={inf.measured_latency_ms ? `${inf.measured_latency_ms} ms` : "—"}
          hint="Measured, not configured — it depends on model, hardware and frame size." />
      </div>

      {inf.advice && (
        <div style={{
          padding: "11px 14px", borderRadius: 11, marginBottom: 14, fontSize: 12.5, lineHeight: 1.55,
          background: saturated ? "#fdf1e3" : "#e6f6ef",
          color: saturated ? "#8a5a00" : "#0a6b45",
          border: `1px solid ${saturated ? "#f0d4a8" : "#b8e6d0"}`,
        }}>
          <strong>{saturated ? "Detector oversubscribed" : "Detector within capacity"}</strong>
          <div style={{ marginTop: 3 }}>{inf.advice}</div>
        </div>
      )}

      {cams.length === 0 && (
        <div style={{ fontSize: 12.5, color: C.sub, padding: 12 }}>No cameras configured.</div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {cams.map((c) => {
          const h = HEALTH[c.health] || HEALTH.stopped;
          const i = c.inference || {};
          const served = i.served_ratio == null ? null : i.served_ratio * 100;
          const explain = EXPLAIN[c.health];
          return (
            <div key={c.camera_id} style={{
              border: `1px solid ${C.line}`, borderRadius: 11, background: C.panel,
              padding: "10px 13px", boxShadow: C.shadow,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ ...mono, fontSize: 13, fontWeight: 800 }}>{c.camera_id}</span>
                <span style={{
                  fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999,
                  background: h.bg, color: h.color,
                }}>{h.label}</span>
                <span style={{ ...mono, fontSize: 10.5, color: C.sub }}>{c.source_kind}</span>
                {i.starved && (
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999,
                    background: "#fdf1e3", color: "#b25e00",
                  }}>starved of inference</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ ...mono, fontSize: 11, color: C.sub }}>
                  last frame {fmtAgo(c.seconds_since_frame)}
                </span>
              </div>

              <div style={{
                display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8,
                ...mono, fontSize: 11, color: C.sub,
              }}>
                <span>uptime <strong style={{ color: C.ink }}>
                  {c.availability == null ? "—" : `${(c.availability * 100).toFixed(1)}%`}
                </strong></span>
                <span>reconnects <strong style={{ color: c.reconnects ? "#b25e00" : C.ink }}>
                  {c.reconnects}</strong></span>
                <span>freezes <strong style={{ color: c.freezes_detected ? "#c02b3c" : C.ink }}>
                  {c.freezes_detected}</strong></span>
                {c.longest_outage_s > 0 && (
                  <span>longest outage <strong style={{ color: C.ink }}>
                    {fmtAgo(c.longest_outage_s).replace(" ago", "")}</strong></span>
                )}
                {i.granted_fps != null && (
                  <span>inference <strong style={{ color: C.ink }}>
                    {i.granted_fps}</strong> of {i.requested_fps} fps</span>
                )}
              </div>

              {served != null && served < 100 && (
                <div style={{ marginTop: 7 }}>
                  <Bar pct={served} tone={served < 50 ? "#c02b3c" : "#b25e00"} />
                  <div style={{ fontSize: 10.5, color: C.sub, marginTop: 3 }}>
                    Getting {served.toFixed(0)}% of its requested rate. Frames are skipped,
                    not queued, so detection stays current but sparser.
                  </div>
                </div>
              )}

              {explain && (
                <div style={{ marginTop: 7, fontSize: 11.5, color: h.color, lineHeight: 1.5 }}>
                  {explain}
                </div>
              )}
              {c.last_error && (
                <div style={{ ...mono, marginTop: 5, fontSize: 10.5, color: C.sub,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={c.last_error}>
                  {c.last_error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
