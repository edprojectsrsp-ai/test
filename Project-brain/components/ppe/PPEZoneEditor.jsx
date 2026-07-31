"use client";
/**
 * PPEZoneEditor — draw monitoring zones directly on the live feed.
 *
 * Masks are the difference between a system people trust and one they mute. A
 * camera that also frames a public road turns every passer-by into a
 * violation, so an operator needs to drag a polygon over that road and watch
 * the false alerts stop.
 *
 * Two things this deliberately does:
 *
 *   Draws over the *live* image rather than a still. Zone editing is iterative
 *   — you place a corner, see where people actually walk, and adjust. A frozen
 *   snapshot hides the very traffic you are masking.
 *
 *   Stores points as fractions of the frame, matching the backend. A zone
 *   drawn on a 1080p preview keeps working when the stream renegotiates to
 *   720p after a camera reboot; pixel coordinates would slide the mask off the
 *   road with nothing on screen to say so.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPpeUrl, getPpeApiBase } from "../../lib/ppeApi";

const API_BASE = getPpeApiBase();

async function api(path, options) {
  const r = await fetch(buildPpeUrl(path), { cache: "no-store", ...options });
  const t = await r.text();
  let body;
  try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) {
    const d = body.detail;
    throw new Error(typeof d === "string" ? d
      : d?.errors ? d.errors.join(" · ")
      : d ? JSON.stringify(d) : `HTTP ${r.status}`);
  }
  return body;
}

const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)",
  sub: "var(--ink-3)", line: "var(--line)", brand: "var(--steel)",
  ok: "var(--verdigris)", danger: "var(--molten)", shadow: "var(--shadow)",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const KIND = {
  include: { label: "Monitor here", stroke: "#3d8f6b", fill: "rgba(61,143,107,0.22)" },
  exclude: { label: "Ignore here", stroke: "#c02b3c", fill: "rgba(192,43,60,0.22)" },
};

const GEAR = ["helmet", "vest", "gloves", "boots", "goggles", "mask", "harness"];

const btn = (active, tone) => ({
  padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", whiteSpace: "nowrap",
  background: active ? (tone || C.brand) : C.panel,
  color: active ? "#fff" : C.ink,
  border: `1px solid ${active ? (tone || C.brand) : C.line}`,
});

const inputStyle = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
  fontSize: 12.5, outline: "none",
};

export default function PPEZoneEditor({ cameraId, onClose }) {
  const [zones, setZones] = useState([]);
  const [draft, setDraft] = useState(null);      // points being placed
  const [kind, setKind] = useState("exclude");
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const wrapRef = useRef(null);

  const flash = (tone, text) => { setMsg({ tone, text }); setTimeout(() => setMsg(null), 6000); };

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/cameras/${encodeURIComponent(cameraId)}/zones`);
      setZones(d.zones || []);
      setDirty(false);
    } catch (e) { flash("danger", e.message); }
  }, [cameraId]);

  useEffect(() => { load(); }, [load]);

  // Warn before losing unsaved polygons — redrawing a mask by hand is tedious.
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const toFrac = (e) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  };

  const onCanvasClick = (e) => {
    const p = toFrac(e);
    if (!p) return;
    setDraft((d) => (d ? [...d, p] : [p]));
  };

  const finishDraft = () => {
    if (!draft || draft.length < 3) {
      flash("warn", "A zone needs at least three points.");
      return;
    }
    const name = kind === "exclude"
      ? `Ignored area ${zones.filter((z) => z.kind === "exclude").length + 1}`
      : `Zone ${zones.filter((z) => z.kind === "include").length + 1}`;
    setZones((zs) => [...zs, {
      name, kind, points: draft, relative: true, enabled: true,
      required_ppe: null, active_hours: null,
    }]);
    setSelected(zones.length);
    setDraft(null);
    setDirty(true);
  };

  const patch = (i, changes) => {
    setZones((zs) => zs.map((z, k) => (k === i ? { ...z, ...changes } : z)));
    setDirty(true);
  };

  const remove = (i) => {
    setZones((zs) => zs.filter((_, k) => k !== i));
    setSelected(null);
    setDirty(true);
  };

  const save = async () => {
    setBusy("save");
    try {
      const d = await api(`/api/cameras/${encodeURIComponent(cameraId)}/zones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones }),
      });
      setDirty(false);
      flash("ok", d.monitors_whole_frame
        ? `Saved. ${d.excludes} ignored area(s); the rest of the frame is still monitored.`
        : `Saved. Monitoring only inside ${d.includes} zone(s).`);
    } catch (e) {
      // The API rejects the whole update on any bad zone rather than silently
      // dropping it, so the operator knows the mask did not take effect.
      flash("danger", e.message);
    } finally { setBusy(""); }
  };

  const summary = useMemo(() => {
    const inc = zones.filter((z) => z.kind === "include").length;
    const exc = zones.length - inc;
    return { inc, exc, wholeFrame: inc === 0 };
  }, [zones]);

  const poly = (pts) => pts.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}>
      {/* ---------------- canvas ---------------- */}
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button onClick={() => setKind("exclude")} style={btn(kind === "exclude", KIND.exclude.stroke)}>
            Ignore area
          </button>
          <button onClick={() => setKind("include")} style={btn(kind === "include", KIND.include.stroke)}>
            Monitor area
          </button>
          <span style={{ width: 1, height: 20, background: C.line }} />
          {draft ? (
            <>
              <button onClick={finishDraft} style={btn(true, C.ok)}>
                Finish ({draft.length} pts)
              </button>
              <button onClick={() => setDraft((d) => (d.length > 1 ? d.slice(0, -1) : null))}
                style={btn(false)}>Undo point</button>
              <button onClick={() => setDraft(null)} style={btn(false)}>Cancel</button>
            </>
          ) : (
            <span style={{ fontSize: 12, color: C.sub }}>
              Click on the picture to place corners, then Finish.
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => setImgKey((k) => k + 1)} style={btn(false)}>Reload feed</button>
        </div>

        <div
          ref={wrapRef}
          onClick={onCanvasClick}
          style={{
            position: "relative", width: "100%", aspectRatio: "16 / 9",
            background: "#05080c", borderRadius: 12, overflow: "hidden",
            border: `1px solid ${C.line}`, cursor: "crosshair",
          }}
        >
          <img
            key={imgKey}
            alt={`${cameraId} live`}
            src={`${API_BASE}/api/cameras/${encodeURIComponent(cameraId)}/stream.mjpg?k=${imgKey}`}
            draggable={false}
            onError={() => setTimeout(() => setImgKey((k) => k + 1), 2000)}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />

          <svg viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {zones.map((z, i) => {
              const k = KIND[z.kind] || KIND.include;
              const on = selected === i;
              return (
                <g key={i} opacity={z.enabled === false ? 0.35 : 1}>
                  <polygon points={poly(z.points)} fill={k.fill}
                    stroke={k.stroke} strokeWidth={on ? 0.8 : 0.4}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={z.enabled === false ? "2 2" : undefined} />
                  <text x={z.points[0][0] * 100} y={z.points[0][1] * 100 - 1.5}
                    fill={k.stroke} fontSize={3} fontWeight={700}
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 0.8 }}>
                    {z.name}
                  </text>
                </g>
              );
            })}
            {draft && draft.length > 0 && (
              <g>
                <polygon points={poly(draft)} fill={KIND[kind].fill}
                  stroke={KIND[kind].stroke} strokeWidth={0.6}
                  strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
                {draft.map(([x, y], i) => (
                  <circle key={i} cx={x * 100} cy={y * 100} r={0.9}
                    fill="#fff" stroke={KIND[kind].stroke} strokeWidth={0.4}
                    vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}
          </svg>
        </div>

        <div style={{ marginTop: 8, fontSize: 11.5, color: C.sub, lineHeight: 1.5 }}>
          A person counts as inside a zone when their <strong>feet</strong> are inside it —
          someone leaning over a barrier is judged by where they stand.
          {summary.wholeFrame
            ? " With no monitored area defined, the whole frame is watched except the ignored areas."
            : " Only the monitored areas are watched; everywhere else on this camera is out of scope."}
        </div>
      </div>

      {/* ---------------- side panel ---------------- */}
      <div>
        {msg && (
          <div style={{
            marginBottom: 10, padding: "9px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600,
            background: msg.tone === "ok" ? "#e6f6ef" : msg.tone === "warn" ? "#fdf1e3" : "#fdecee",
            color: msg.tone === "ok" ? "#0a8f5b" : msg.tone === "warn" ? "#b25e00" : "#c02b3c",
          }}>{msg.text}</div>
        )}

        <div style={{
          display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>Zones</span>
          <span style={{ ...mono, fontSize: 11, color: C.sub }}>
            {summary.inc} monitored · {summary.exc} ignored
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={save} disabled={busy === "save" || !dirty}
            style={{ ...btn(dirty, C.brand), opacity: dirty ? 1 : 0.5 }}>
            {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>

        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {zones.length === 0 && (
            <div style={{ fontSize: 12, color: C.sub, padding: "10px 2px", lineHeight: 1.55 }}>
              No zones yet — the whole frame is monitored. If this camera also sees a
              public road or a neighbouring bay, draw an <strong>ignore area</strong> over it,
              or every passer-by will raise a violation.
            </div>
          )}

          {zones.map((z, i) => {
            const k = KIND[z.kind] || KIND.include;
            const open = selected === i;
            return (
              <div key={i} style={{
                border: `1px solid ${open ? k.stroke : C.line}`, borderRadius: 10,
                marginBottom: 8, background: C.panel, overflow: "hidden",
              }}>
                <div onClick={() => setSelected(open ? null : i)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: k.stroke, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.name}</span>
                  <span style={{ ...mono, fontSize: 10.5, color: C.sub, marginLeft: "auto" }}>
                    {k.label}
                  </span>
                </div>

                {open && (
                  <div style={{ padding: "0 10px 10px", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ marginTop: 9 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>Name</div>
                      <input value={z.name} onChange={(e) => patch(i, { name: e.target.value })}
                        style={inputStyle} />
                      <div style={{ fontSize: 10.5, color: C.sub, marginTop: 3 }}>
                        Alerts say the zone name, so “no helmet in welding bay” beats “on camera 7”.
                      </div>
                    </div>

                    {z.kind === "include" && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 5 }}>
                          Gear required here (none = camera defaults)
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {GEAR.map((g) => {
                            const on = (z.required_ppe || []).includes(g);
                            return (
                              <button key={g} onClick={() => {
                                const cur = z.required_ppe || [];
                                const next = on ? cur.filter((x) => x !== g) : [...cur, g];
                                patch(i, { required_ppe: next.length ? next : null });
                              }} style={{
                                ...mono, padding: "3px 9px", borderRadius: 999, fontSize: 10.5,
                                fontWeight: 700, cursor: "pointer",
                                background: on ? "#eef4fb" : C.panel2,
                                color: on ? "#1c4f82" : C.sub,
                                border: `1px solid ${on ? "#9dc0e4" : C.line}`,
                              }}>{g}</button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>
                        Active hours (blank = always)
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="number" min={0} max={23} placeholder="from"
                          value={z.active_hours?.[0] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            patch(i, { active_hours: v === "" ? null
                              : [Number(v), z.active_hours?.[1] ?? 0] });
                          }}
                          style={{ ...inputStyle, ...mono, width: 74 }} />
                        <span style={{ fontSize: 12, color: C.sub }}>to</span>
                        <input type="number" min={0} max={23} placeholder="to"
                          value={z.active_hours?.[1] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            patch(i, { active_hours: v === "" ? null
                              : [z.active_hours?.[0] ?? 0, Number(v)] });
                          }}
                          style={{ ...inputStyle, ...mono, width: 74 }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: C.sub, marginTop: 3 }}>
                        Night shifts wrap midnight — 22 to 6 works as expected.
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                      <button onClick={() => patch(i, { enabled: z.enabled === false })}
                        style={btn(false)}>{z.enabled === false ? "Enable" : "Disable"}</button>
                      <button onClick={() => remove(i)}
                        style={{ ...btn(false), color: C.danger, borderColor: C.danger }}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {onClose && (
          <button onClick={onClose} style={{ ...btn(false), width: "100%", marginTop: 10 }}>
            Close editor
          </button>
        )}
      </div>
    </div>
  );
}
