"use client";
/**
 * Plant TV-wall control room — industry layout:
 *   LEFT  ~70%  live multi-camera grid (annotated MJPEG)
 *   RIGHT ~30%  live alert ticker with evidence + Ack/Resolve
 * Single screen, no tab switching required for day-to-day ops.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path, options) {
  const r = await fetch(`${API_BASE}${path}`, options);
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function WallTile({ cam, focused, onFocus, onFlag }) {
  const [key, setKey] = useState(0);
  const [ok, setOk] = useState(true);
  const [flagging, setFlagging] = useState(false);
  const running = cam.state === "running";

  useEffect(() => {
    if (running) { setKey((k) => k + 1); setOk(true); }
  }, [running]);

  const st = cam.stats || {};
  const hot = (st.violations_fired || 0) > 0;

  return (
    <div
      onClick={() => onFocus(cam.camera_id)}
      style={{
        position: "relative",
        background: "#05080c",
        borderRadius: 12,
        overflow: "hidden",
        border: focused
          ? "2px solid #3b82f6"
          : hot
            ? "2px solid #c02b3c"
            : "1px solid #1e2c3a",
        cursor: "pointer",
        minHeight: focused ? 0 : undefined,
        boxShadow: focused ? "0 0 0 3px rgba(59,130,246,.25)" : "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{
        position: "relative",
        flex: 1,
        minHeight: focused ? "min(58vh, 560px)" : 180,
        background: "#0b0f14",
      }}>
        {running && ok ? (
          <img
            key={key}
            alt={cam.camera_id}
            src={`${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/stream.mjpg?fps=${focused ? 12 : 6}&k=${key}`}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            onError={() => {
              setOk(false);
              setTimeout(() => { setOk(true); setKey((k) => k + 1); }, 2000);
            }}
          />
        ) : (
          <div style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center",
            color: "#6d8296", fontSize: 12, padding: 12, textAlign: "center",
          }}>
            {cam.state === "error"
              ? `Error: ${st.last_error || "failed"}`
              : running ? "Reconnecting…" : "Stopped"}
          </div>
        )}

        <div style={{
          position: "absolute", top: 8, left: 8, display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(5,8,12,.8)", padding: "4px 9px", borderRadius: 7,
          fontSize: 11, color: "#e7eef6", ...mono, maxWidth: "70%",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 4, flexShrink: 0,
            background: running ? "#3dd68c" : cam.state === "error" ? "#ff6b7a" : "#6d8296",
          }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cam.camera_id}
          </span>
        </div>

        {running ? (
          <span style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(192,43,60,.92)", color: "#fff",
            fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 5, letterSpacing: 0.5,
          }}>
            LIVE
          </span>
        ) : null}

        <div style={{
          position: "absolute", bottom: 8, left: 8, right: 8,
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{
            background: "rgba(5,8,12,.78)", color: "#c5d0db",
            fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 5,
            textTransform: "uppercase",
          }}>
            {cam.mode || "monitor"}
          </span>
          <span style={{ ...mono, fontSize: 10, color: "#9bb0c3", background: "rgba(5,8,12,.6)", padding: "3px 7px", borderRadius: 5 }}>
            viol {st.violations_fired ?? 0}
          </span>
          {running ? (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                setFlagging(true);
                try { await onFlag(cam.camera_id); }
                finally { setFlagging(false); }
              }}
              style={{
                marginLeft: "auto", border: "none", background: "rgba(255,255,255,.92)",
                color: "#b25e00", borderRadius: 6, padding: "4px 9px", fontSize: 11,
                fontWeight: 800, cursor: "pointer",
              }}
            >
              {flagging ? "…" : "⚑ Teach"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AlertRow({ v, onStatus, onOpen }) {
  const open = v.status === "open";
  const done = v.status === "resolved" || v.status === "false_alarm";
  return (
    <div style={{
      display: "flex", gap: 10, padding: 10, borderRadius: 10,
      background: open ? "rgba(192,43,60,.12)" : "rgba(255,255,255,.04)",
      border: `1px solid ${open ? "rgba(192,43,60,.35)" : "rgba(255,255,255,.08)"}`,
      opacity: done ? 0.55 : 1,
    }}>
      <div
        onClick={() => onOpen(v)}
        style={{
          width: 72, height: 54, borderRadius: 7, overflow: "hidden",
          background: "#0b0f14", flexShrink: 0, cursor: "pointer",
        }}
      >
        {v.has_image ? (
          <img
            alt=""
            src={`${API_BASE}${v.image_url}`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#6d8296", fontSize: 10 }}>
            no img
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, color: open ? "#ff8a95" : "#e7eef6",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {v.label}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#7a8fa3", ...mono, flexShrink: 0 }}>
            {timeAgo(v.occurred_at)}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#9bb0c3", marginBottom: 6 }}>
          {v.camera_id} · {Math.round((v.confidence || 0) * 100)}%
          {v.status && v.status !== "open" ? ` · ${v.status.replace("_", " ")}` : ""}
        </div>
        {!done ? (
          <div style={{ display: "flex", gap: 5 }}>
            <button
              type="button"
              onClick={() => onStatus(v, "acknowledged")}
              style={tinyBtn("#f0b429")}
            >
              Ack
            </button>
            <button
              type="button"
              onClick={() => onStatus(v, "resolved")}
              style={{ ...tinyBtn("#3dd68c"), background: "rgba(61,214,140,.15)" }}
            >
              Resolve
            </button>
            <button
              type="button"
              onClick={() => onStatus(v, "false_alarm")}
              style={tinyBtn("#7a8fa3")}
            >
              False
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const tinyBtn = (color) => ({
  border: `1px solid ${color}55`,
  background: "transparent",
  color,
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
});

export default function PPEWallRoom({ onNavigate }) {
  const [cams, setCams] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [focusId, setFocusId] = useState(null);
  const [toast, setToast] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const toastTimer = useRef(null);

  const say = (m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  };

  const refresh = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([
        api("/api/cameras").catch(() => []),
        api("/api/violations?limit=40").catch(() => ({ violations: [] })),
      ]);
      const list = Array.isArray(c) ? c : [];
      setCams(list);
      setAlerts(v.violations || []);
      setLoaded(true);
      setFocusId((prev) => {
        if (prev && list.some((x) => x.camera_id === prev)) return prev;
        const run = list.find((x) => x.state === "running");
        return run?.camera_id || list[0]?.camera_id || null;
      });
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const onFlag = async (id) => {
    try {
      const r = await api(`/api/cameras/${encodeURIComponent(id)}/flag`, { method: "POST" });
      say(`Teach queued #${String(r.capture_id).slice(0, 8)}`);
    } catch (e) {
      say(e.message);
    }
  };

  const onStatus = async (v, status) => {
    setAlerts((xs) => xs.map((x) => (x.id === v.id ? { ...x, status } : x)));
    try {
      await api(`/api/violations/${v.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      say(e.message);
      refresh();
    }
  };

  const openAlerts = alerts.filter((a) => a.status === "open").length;
  const running = cams.filter((c) => c.state === "running").length;
  const focus = cams.find((c) => c.camera_id === focusId);
  const others = cams.filter((c) => c.camera_id !== focusId);

  const gridCols = others.length <= 1 ? 1 : others.length <= 4 ? 2 : 3;

  return (
    <div style={{
      height: "100%",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: "#070b12",
      color: "#e7eef6",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* KPI strip */}
      <div style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderBottom: "1px solid #1a2533",
        background: "#0b1220",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Control wall</span>
        <span style={{ fontSize: 12, color: "#7a8fa3" }}>live video · live alerts · single screen</span>
        <span style={{ flex: 1 }} />
        <Kpi label="Cameras" value={`${running}/${cams.length}`} ok={running > 0} />
        <Kpi label="Open alerts" value={String(openAlerts)} danger={openAlerts > 0} />
        <Kpi label="Logged" value={String(alerts.length)} />
        <button
          type="button"
          onClick={() => onNavigate?.("live")}
          style={ghostBtn}
        >
          Manage cameras →
        </button>
        <button
          type="button"
          onClick={() => onNavigate?.("alerts")}
          style={ghostBtn}
        >
          Full alerts →
        </button>
      </div>

      <div style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 340px)",
        gap: 0,
      }}>
        {/* LEFT — video wall */}
        <div style={{
          minHeight: 0,
          overflow: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          {!loaded ? (
            <div style={{ color: "#6d8296", padding: 40, textAlign: "center" }}>Loading cameras…</div>
          ) : !cams.length ? (
            <div style={{
              flex: 1, display: "grid", placeItems: "center",
              border: "1px dashed #2a3a4c", borderRadius: 14, margin: 8,
            }}>
              <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>◎</div>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>No cameras on the wall</div>
                <div style={{ fontSize: 13, color: "#7a8fa3", lineHeight: 1.5, marginBottom: 14 }}>
                  Open Live (manage) to pick a model and add a webcam, RTSP, or demo video.
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate?.("live")}
                  style={{
                    border: "none", background: "#1256d1", color: "#fff",
                    borderRadius: 9, padding: "10px 18px", fontWeight: 800, cursor: "pointer",
                  }}
                >
                  Go to Live setup
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Focused hero camera */}
              {focus ? (
                <WallTile
                  cam={focus}
                  focused
                  onFocus={setFocusId}
                  onFlag={onFlag}
                />
              ) : null}
              {/* Other cameras strip/grid */}
              {others.length > 0 ? (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                  gap: 10,
                }}>
                  {others.map((cam) => (
                    <WallTile
                      key={cam.camera_id}
                      cam={cam}
                      focused={false}
                      onFocus={setFocusId}
                      onFlag={onFlag}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* RIGHT — alert ticker */}
        <aside style={{
          borderLeft: "1px solid #1a2533",
          background: "#0b1220",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}>
          <div style={{
            padding: "12px 14px",
            borderBottom: "1px solid #1a2533",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span style={{ fontWeight: 800, fontSize: 13 }}>Alert ticker</span>
            {openAlerts > 0 ? (
              <span style={{
                background: "rgba(192,43,60,.25)", color: "#ff8a95",
                fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
              }}>
                {openAlerts} open
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#3dd68c", fontWeight: 700 }}>clear</span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: "#5a6f82" }}>auto-refresh 3s</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "grid", gap: 8, alignContent: "start" }}>
            {alerts.map((v) => (
              <AlertRow
                key={v.id}
                v={v}
                onStatus={onStatus}
                onOpen={setLightbox}
              />
            ))}
            {!alerts.length && loaded ? (
              <div style={{
                padding: 20, textAlign: "center", color: "#7a8fa3", fontSize: 12.5, lineHeight: 1.5,
              }}>
                No violations yet.<br />
                Run cameras in <b style={{ color: "#c5d0db" }}>Monitor</b> or <b style={{ color: "#c5d0db" }}>Collect</b>.
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {lightbox ? (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 10050,
            background: "rgba(0,0,0,.82)", display: "grid", placeItems: "center", padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#121a26", borderRadius: 14, overflow: "hidden",
              maxWidth: 860, width: "100%", border: "1px solid #2a3a4c",
            }}
          >
            <img
              alt={lightbox.label}
              src={`${API_BASE}${lightbox.image_url}`}
              style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", background: "#05080c" }}
            />
            <div style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ color: "#ff8a95" }}>{lightbox.label}</b>
              <span style={{ color: "#9bb0c3", fontSize: 13 }}>
                {lightbox.camera_id} · {Math.round((lightbox.confidence || 0) * 100)}%
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setLightbox(null)} style={ghostBtn}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "#1a2533", color: "#fff", padding: "10px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 600, zIndex: 10060, borderLeft: "3px solid #1256d1",
        }}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, ok, danger }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "baseline", gap: 6,
      background: "rgba(255,255,255,.04)", border: "1px solid #1e2c3a",
      borderRadius: 8, padding: "4px 10px", fontSize: 12,
    }}>
      <span style={{ color: "#7a8fa3" }}>{label}</span>
      <b style={{
        color: danger ? "#ff8a95" : ok ? "#3dd68c" : "#e7eef6",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </b>
    </div>
  );
}

const ghostBtn = {
  border: "1px solid #2a3a4c",
  background: "transparent",
  color: "#9bb0c3",
  borderRadius: 8,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
