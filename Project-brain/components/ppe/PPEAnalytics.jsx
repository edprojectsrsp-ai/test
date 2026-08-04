"use client";
/**
 * PPE Analytics — industrial compliance overview.
 * KPIs, timeseries, shift/dept breakdown, heatmap, model coverage.
 */
import React, { useCallback, useEffect, useState } from "react";
import { buildPpeUrl } from "../../lib/ppeApi";
import { ensureAgent, subscribeAgent } from "../../lib/ppeAgent";


async function api(path) {
  const r = await fetch(buildPpeUrl(path), { cache: "no-store" });
  const t = await r.text();
  let body;
  try {
    body = t ? JSON.parse(t) : {};
  } catch {
    body = { detail: t };
  }
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const C = {
  panel: "var(--panel)",
  panel2: "var(--panel-2)",
  ink: "var(--ink)",
  sub: "var(--ink-3)",
  line: "var(--line)",
  brand: "var(--steel)",
  brandSoft: "var(--steel-soft)",
  ok: "var(--verdigris)",
  okSoft: "var(--verdigris-soft)",
  warn: "var(--slag)",
  warnSoft: "var(--slag-soft)",
  danger: "var(--molten)",
  dangerSoft: "var(--molten-soft)",
  shadow: "var(--shadow)",
};

const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const MODEL_COVERAGE = [
  { gear: "Helmet / Hardhat", sh17: true, snehil: true, vox: true, nduka: true, vyra: true, note: "Cap Found / Not found" },
  { gear: "Coloured hardhats (yellow/red)", sh17: true, snehil: false, vox: false, nduka: false, vyra: false, note: "css-data models skew white/blue" },
  { gear: "Safety vest", sh17: true, snehil: true, vox: true, nduka: true, vyra: true, note: "Safety Jacket" },
  { gear: "Face mask", sh17: true, snehil: true, vox: true, nduka: false, vyra: true, note: "Mask" },
  { gear: "Person", sh17: true, snehil: true, vox: true, nduka: true, vyra: true, note: "Person box" },
  { gear: "Safety cone", sh17: false, snehil: true, vox: true, nduka: false, vyra: true, note: "Scene object" },
  { gear: "Vehicle / machinery", sh17: false, snehil: true, vox: true, nduka: false, vyra: false, note: "Near-miss context" },
  { gear: "Gloves", sh17: true, snehil: false, vox: false, nduka: false, vyra: true, note: "SH17 / Hexmon-Vyra" },
  { gear: "Goggles", sh17: true, snehil: false, vox: false, nduka: false, vyra: true, note: "SH17 / Hexmon-Vyra" },
  { gear: "Fall detected", sh17: false, snehil: false, vox: false, nduka: false, vyra: true, note: "Hexmon/Vyra only" },
  { gear: "Boots", sh17: true, snehil: false, vox: false, nduka: false, vyra: false, note: "SH17 only" },
  { gear: "Harness", sh17: false, snehil: false, vox: false, nduka: false, vyra: false, note: "Fine-tune" },
];

function MiniBars({ series }) {
  if (!series?.length) {
    return <div style={{ color: C.sub, fontSize: 13, padding: "16px 0" }}>No time-series data yet.</div>;
  }
  const max = Math.max(1, ...series.map((p) => Number(p.count || p.total || p.y || 0)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 96, paddingTop: 8 }}>
      {series.slice(-42).map((p, i) => {
        const v = Number(p.count || p.total || p.y || 0);
        const h = Math.max(2, Math.round((v / max) * 88));
        const label = p.date || p.day || p.t || p.label || "";
        return (
          <div
            key={i}
            title={`${label}: ${v}`}
            style={{
              flex: 1,
              minWidth: 4,
              height: h,
              borderRadius: "3px 3px 0 0",
              background: v > max * 0.7 ? C.danger : v > max * 0.4 ? C.warn : C.brand,
              opacity: 0.85 + (v / max) * 0.15,
            }}
          />
        );
      })}
    </div>
  );
}

function DistList({ title, data, empty }) {
  const entries = Object.entries(data || {})
    .filter(([, n]) => typeof n === "number")
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: C.shadow,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: C.sub,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {!entries.length ? (
        <div style={{ color: C.sub, fontSize: 13 }}>{empty}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {entries.slice(0, 8).map(([k, n]) => (
            <div key={k}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ fontWeight: 700, color: C.ink }}>{k || "—"}</span>
                <span style={{ ...mono, color: C.sub }}>{n}</span>
              </div>
              <div style={{ height: 6, background: C.panel2, borderRadius: 99, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.round((n / max) * 100)}%`,
                    height: "100%",
                    background: C.brand,
                    borderRadius: 99,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PPEAnalytics({ embedded = false }) {
  // Start true so the plant PC — the common case — never flashes "unavailable"
  // while discovery is still in flight.
  const [onAgent, setOnAgent] = useState(true);
  const [cams, setCams] = useState([]);
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [liveModel, setLiveModel] = useState("");
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState([]);
  const [byDept, setByDept] = useState({});
  const [byShift, setByShift] = useState({});
  const [offenders, setOffenders] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      // Cameras, the review queue and the model registry live on the plant PC;
      // the cloud role does not mount those routers. Viewed remotely, asking
      // for them is a guaranteed 404 every 8 seconds — so don't ask, and record
      // the answer as "unavailable" rather than zero. A dashboard that reports
      // "0 cameras" to a manager is worse than one that admits it cannot see.
      const [c, t, p, m, sum, ts, dept, shift, rep] = await Promise.all([
        onAgent ? api("/api/cameras").catch(() => []) : null,
        api("/api/violations/types").catch(() => ({ types: [], total: 0 })),
        onAgent ? api("/api/review/pending").catch(() => []) : null,
        onAgent ? api("/api/models").catch(() => ({})) : null,
        api("/api/analytics/summary").catch(() => null),
        api("/api/analytics/timeseries?days=30").catch(() => ({ series: [] })),
        api("/api/analytics/by-department").catch(() => ({})),
        api("/api/analytics/by-shift").catch(() => ({})),
        api("/api/analytics/repeat-offenders?limit=8").catch(() => ({ offenders: [] })),
      ]);
      setCams(Array.isArray(c) ? c : []);
      setTypes(t.types || []);
      setTotal(t.total || 0);
      setPending(p == null ? null : Array.isArray(p) ? p.length : 0);
      setLiveModel(m == null ? null : (m.live_weights || "").split(/[\\/]/).pop() || "—");
      setSummary(sum);
      setSeries(ts.series || ts.points || ts.data || []);
      {
        const d = dept.by_department || dept.counts || dept;
        setByDept(d && typeof d === "object" && !Array.isArray(d) ? d : {});
      }
      {
        const s = shift.by_shift || shift.counts || shift;
        setByShift(s && typeof s === "object" && !Array.isArray(s) ? s : {});
      }
      setOffenders(rep.offenders || rep.items || (Array.isArray(rep) ? rep : []));
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [onAgent]);

  useEffect(() => {
    ensureAgent().then((s) => setOnAgent(s.status === "online"));
    return subscribeAgent((s) => setOnAgent(s.status === "online"));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const running = cams.filter((c) => c.state === "running").length;
  const violations = cams.reduce((s, c) => s + (c.stats?.violations_fired || 0), 0);
  const harvested = cams.reduce((s, c) => s + (c.stats?.captures_made || 0), 0);
  const inferred = cams.reduce((s, c) => s + (c.stats?.frames_inferred || 0), 0);
  const maxType = Math.max(1, ...types.map((t) => t.count || 0));

  const totalViol = summary?.total_violations ?? total;
  const openViol = summary?.open_violations;
  const openRate =
    openViol != null && totalViol
      ? `${Math.round((openViol / Math.max(1, totalViol)) * 100)}%`
      : "—";

  // Live-fleet figures are meaningless without the agent — "—" says we cannot
  // see them, which is the truth; "0" would be a claim we have not earned.
  const kpis = [
    onAgent
      ? { label: "Cameras live", value: `${running}/${cams.length}`, tone: running ? "ok" : "mute" }
      : { label: "Cameras live", value: "—", tone: "mute", hint: "Only visible on the plant PC" },
    { label: "Violations logged", value: String(totalViol), tone: totalViol ? "danger" : "mute" },
    { label: "Open", value: openViol != null ? String(openViol) : "—", tone: openViol ? "warn" : "mute" },
    { label: "Open rate", value: openRate, tone: "warn" },
    { label: "Last 24h", value: String(summary?.violations_24h ?? "—"), tone: "brand" },
    onAgent
      ? { label: "Fired (session)", value: String(violations), tone: violations ? "danger" : "mute" }
      : { label: "Fired (session)", value: "—", tone: "mute", hint: "Only visible on the plant PC" },
    onAgent
      ? { label: "Frames inferred", value: String(inferred), tone: "brand" }
      : { label: "Frames inferred", value: "—", tone: "mute", hint: "Only visible on the plant PC" },
    {
      label: "Review queue",
      value: pending == null ? "—" : String(pending),
      tone: pending ? "warn" : "mute",
      hint: pending == null ? "Only visible on the plant PC" : undefined,
    },
  ];

  const toneMap = {
    ok: { fg: C.ok, bg: C.okSoft },
    danger: { fg: C.danger, bg: C.dangerSoft },
    warn: { fg: C.warn, bg: C.warnSoft },
    brand: { fg: C.brand, bg: C.brandSoft },
    mute: { fg: C.ink, bg: C.panel },
  };

  return (
    <div
      style={{
        padding: embedded ? "16px 20px 40px" : "20px 24px",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: C.ink,
      }}
    >
      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Analytics & compliance</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.sub }}>
            KPIs · 30-day trend · shift / department · model PPE coverage
          </p>
        </div>
        <span style={{ flex: 1 }} />
        {liveModel != null ? (
          <span style={{ fontSize: 12, color: C.sub }}>
            Model <span style={{ ...mono, color: C.ink, fontWeight: 700 }}>{liveModel}</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: C.sub }} title="The detector runs on the plant PC">
            Cloud view — live fleet, model and review figures unavailable
          </span>
        )}
      </div>

      {err ? (
        <div
          style={{
            background: C.dangerSoft,
            color: C.danger,
            padding: 12,
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => {
          const t = toneMap[k.tone] || toneMap.mute;
          return (
            <div
              key={k.label}
              style={{
                background: t.bg,
                border: `1px solid ${C.line}`,
                borderRadius: 11,
                padding: "12px 14px",
                boxShadow: C.shadow,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.sub,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {k.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: t.fg,
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums",
                  ...mono,
                }}
              >
                {k.value}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: 16,
            boxShadow: C.shadow,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.sub,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 4,
            }}
          >
            Violations · last 30 days
          </div>
          <MiniBars series={series} />
          <div style={{ marginTop: 8, fontSize: 11, color: C.sub }}>
            Bars scale to peak day · hover for counts
          </div>
        </section>

        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: 16,
            boxShadow: C.shadow,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.sub,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 12,
            }}
          >
            Violations by type
          </div>
          {!types.length ? (
            <div style={{ color: C.sub, fontSize: 13, padding: "12px 0" }}>
              No violations yet. Run cameras in <b>Monitor</b> or <b>Collect</b>.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {types.map((t) => (
                <div key={t.category}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{t.label}</span>
                    <span style={{ ...mono, color: C.sub }}>{t.count}</span>
                  </div>
                  <div style={{ height: 7, background: C.panel2, borderRadius: 99, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.round((t.count / maxType) * 100)}%`,
                        height: "100%",
                        background:
                          t.severity === "critical"
                            ? C.danger
                            : t.severity === "high"
                              ? "#e85d4c"
                              : C.warn,
                        borderRadius: 99,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <DistList title="By department" data={byDept} empty="No department tags yet." />
        <DistList title="By shift" data={byShift} empty="No shift tags yet." />
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: 16,
            boxShadow: C.shadow,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.sub,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 12,
            }}
          >
            Repeat offenders / tracks
          </div>
          {!offenders.length ? (
            <div style={{ color: C.sub, fontSize: 13 }}>No repeat patterns yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {offenders.map((o, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12.5,
                    padding: "6px 0",
                    borderBottom: `1px solid ${C.line}`,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {o.camera_id || o.label || o.track_id || o.id || `track ${i + 1}`}
                  </span>
                  <span style={{ ...mono, color: C.danger, fontWeight: 800 }}>
                    {o.count ?? o.violations ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 12,
          padding: 16,
          boxShadow: C.shadow,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: C.sub,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          Stock model PPE coverage
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.sub, lineHeight: 1.45 }}>
          Prefer <b style={{ color: C.ink }}>SH17 YOLOv9-m</b> for plant hardhats (all colours). Snehil/VoxDroid
          share css-data blind spots. Hexmon/Vyra for fall detection.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.sub, fontSize: 10, textTransform: "uppercase" }}>
                {["Gear", "SH17", "Snehil", "VoxDroid", "nduka", "Vyra"].map((h) => (
                  <th key={h} style={{ padding: "6px", borderBottom: `1px solid ${C.line}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODEL_COVERAGE.map((row) => (
                <tr key={row.gear}>
                  <td style={{ padding: "6px", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ fontWeight: 700 }}>{row.gear}</div>
                    <div style={{ fontSize: 10, color: C.sub }}>{row.note}</div>
                  </td>
                  {[row.sh17, row.snehil, row.vox, row.nduka, row.vyra].map((ok, i) => (
                    <td
                      key={i}
                      style={{
                        padding: "6px",
                        borderBottom: `1px solid ${C.line}`,
                        color: ok ? C.ok : C.danger,
                        fontWeight: 800,
                      }}
                    >
                      {ok ? "✓" : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {cams.length > 0 ? (
        <section
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: 16,
            boxShadow: C.shadow,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.sub,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 10,
            }}
          >
            Camera health
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {cams.map((cam) => {
              const st = cam.stats || {};
              const ok = cam.state === "running";
              return (
                <div
                  key={cam.camera_id}
                  style={{
                    border: `1px solid ${C.line}`,
                    borderRadius: 10,
                    padding: 12,
                    background: C.panel2,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: ok ? C.ok : cam.state === "error" ? C.danger : C.sub,
                        boxShadow: ok ? "0 0 0 3px rgba(34,197,94,.2)" : "none",
                      }}
                    />
                    <b style={{ fontSize: 13 }}>{cam.camera_id}</b>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        color: C.sub,
                        textTransform: "uppercase",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {cam.mode || "—"}
                    </span>
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
