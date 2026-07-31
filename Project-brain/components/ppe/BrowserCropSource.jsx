"use client";
/**
 * Browser crop = your live PPE camera from any web NVR / DVR / CCTV page.
 *
 * Flow (what the operator does):
 *   1. Open the camera vendor web page (we can open the URL for you)
 *   2. Login with username + password ON THAT PAGE (normal browser login)
 *   3. Share that tab/window back into PPE
 *   4. Drag a crop box over only the live video pane
 *   5. Stream → PPE treats it as a live camera (detect / alert / record)
 *
 * Why not embed the NVR page in an iframe? Most NVR vendors block framing
 * (X-Frame-Options). Sharing the real tab is the reliable industrial approach.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getPpeApiBase } from "../../lib/ppeApi";

const API_BASE = getPpeApiBase();

const LS_URL = "ppe.browserCrop.nvrUrl";

/**
 * @param {{ cameraId: string, fps?: number, onClose?: () => void, onLive?: () => void }} props
 */
export default function BrowserCropSource({ cameraId, fps = 6, onClose, onLive }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const cropRef = useRef(null);
  const dragRef = useRef(null);
  const nvrWinRef = useRef(null);

  const [mode, setMode] = useState("display"); // display = NVR tab | webcam
  const [nvrUrl, setNvrUrl] = useState(() => {
    try {
      return localStorage.getItem(LS_URL) || "http://192.168.1.64/";
    } catch {
      return "http://192.168.1.64/";
    }
  });
  const [step, setStep] = useState(1); // 1 open · 2 share · 3 crop · 4 live
  const [live, setLive] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [err, setErr] = useState("");
  const [stats, setStats] = useState({ sent: 0, lastOk: null, lastErr: "" });
  const [crop, setCrop] = useState(null);

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setPushing(false);
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const openNvrLogin = () => {
    setErr("");
    const url = (nvrUrl || "").trim();
    if (!url) {
      setErr("Enter the NVR / camera web address first (e.g. http://192.168.1.64/).");
      return;
    }
    try {
      localStorage.setItem(LS_URL, url);
    } catch {
      /* ignore */
    }
    // Open real browser window so user can type username + password on the
    // vendor page. We never capture their password into PPE.
    const w = window.open(url, "ppe-nvr-login", "noopener,noreferrer");
    nvrWinRef.current = w;
    if (!w) {
      setErr("Popup blocked — allow popups for this site, or open the NVR URL in a new tab yourself.");
      return;
    }
    setStep(2);
  };

  const startCapture = async () => {
    setErr("");
    stopStream();
    try {
      let stream;
      if (mode === "webcam") {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
          audio: false,
        });
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error("Use Chrome or Edge — this browser cannot share a tab/window.");
        }
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 10, max: 15 },
            displaySurface: "browser",
          },
          audio: false,
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: "exclude",
        });
      }
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      await v.play();
      setLive(true);
      setStep(3);
      setCrop({ x: 0.08, y: 0.08, w: 0.84, h: 0.75 });
      cropRef.current = { x: 0.08, y: 0.08, w: 0.84, h: 0.75 };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setErr("Share stopped. Click “Share the login tab” again.");
        stopStream();
        setStep(2);
      });
    } catch (e) {
      setErr(e?.message || String(e));
      stopStream();
    }
  };

  const pushOnce = useCallback(async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const cr = cropRef.current;
    if (!v || !c || !cr || v.readyState < 2) return;

    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 360;
    const sx = Math.max(0, Math.floor(cr.x * vw));
    const sy = Math.max(0, Math.floor(cr.y * vh));
    const sw = Math.max(8, Math.floor(cr.w * vw));
    const sh = Math.max(8, Math.floor(cr.h * vh));

    const maxW = 1280;
    const scale = sw > maxW ? maxW / sw : 1;
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    c.width = dw;
    c.height = dh;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);

    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.72));
    if (!blob) return;

    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    try {
      const r = await fetch(
        `${API_BASE}/api/cameras/${encodeURIComponent(cameraId)}/push-frame`,
        { method: "POST", body: fd },
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      setStats((s) => ({ sent: s.sent + 1, lastOk: Date.now(), lastErr: "" }));
      onLive?.();
    } catch (e) {
      setStats((s) => ({ ...s, lastErr: e?.message || String(e) }));
    }
  }, [cameraId, onLive]);

  const startPush = () => {
    if (!live) {
      setErr("Share the NVR tab first (step 2).");
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setPushing(true);
    setStep(4);
    setErr("");
    const interval = Math.max(100, Math.round(1000 / Math.max(1, fps)));
    timerRef.current = setInterval(() => pushOnce(), interval);
    pushOnce();
  };

  const stopPush = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPushing(false);
    if (live) setStep(3);
  };

  const toNorm = (clientX, clientY) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  };

  const onPointerDown = (e) => {
    if (!live) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);
    dragRef.current = { x0: p.x, y0: p.y };
    setCrop({ x: p.x, y: p.y, w: 0.01, h: 0.01 });
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toNorm(e.clientX, e.clientY);
    const x = Math.min(d.x0, p.x);
    const y = Math.min(d.y0, p.y);
    const next = {
      x,
      y,
      w: Math.max(0.02, Math.abs(p.x - d.x0)),
      h: Math.max(0.02, Math.abs(p.y - d.y0)),
    };
    setCrop(next);
    cropRef.current = next;
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const fullFrame = () => {
    const next = { x: 0, y: 0, w: 1, h: 1 };
    setCrop(next);
    cropRef.current = next;
  };

  const steps = [
    { n: 1, label: "Open & login" },
    { n: 2, label: "Share tab" },
    { n: 3, label: "Crop video" },
    { n: 4, label: "PPE live" },
  ];

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2eaf2",
        borderRadius: 14,
        boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 12px 28px -18px rgba(37,99,235,.14)",
        overflow: "hidden",
        color: "#0a0a0a",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid #93c5fd",
          background: "#dbeafe",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Browser live camera (NVR web login)</div>
          <div style={{ fontSize: 12, color: "#1e3a5f", marginTop: 2 }}>
            Camera <b>{cameraId}</b> · login on vendor page · crop pane · PPE detects on that crop
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            style={btn(false)}
          >
            Close
          </button>
        ) : null}
      </div>

      {/* Step indicator */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "12px 16px 0",
          flexWrap: "wrap",
        }}
      >
        {steps.map((s) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div
              key={s.n}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: active ? "#2563eb" : done ? "#ecfdf5" : "#f8fafc",
                color: active ? "#fff" : done ? "#059669" : "#475569",
                border: `1px solid ${active ? "#1d4ed8" : done ? "#a7f3d0" : "#e2eaf2"}`,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  background: active ? "rgba(255,255,255,.2)" : done ? "#059669" : "#e2e8f0",
                  color: active || done ? "#fff" : "#334155",
                }}
              >
                {done ? "✓" : s.n}
              </span>
              {s.label}
            </div>
          );
        })}
      </div>

      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        {/* Mode */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>Source type</span>
          <button type="button" disabled={live} onClick={() => setMode("display")} style={btn(mode === "display")}>
            NVR / camera web page
          </button>
          <button type="button" disabled={live} onClick={() => setMode("webcam")} style={btn(mode === "webcam")}>
            This PC webcam
          </button>
        </div>

        {mode === "display" ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              background: "#f8fafc",
              border: "1px solid #e2eaf2",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800 }}>Step 1 — Open the camera website & login</div>
            <p style={{ margin: 0, fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>
              Enter the NVR / DVR / IP-camera web address. Click <b>Open login page</b>, then type{" "}
              <b>username and password on that page</b> (Hikvision, Dahua, CP Plus, etc.). PPE does{" "}
              <b>not</b> store those passwords — you log in like a normal browser.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label style={{ flex: "1 1 280px", display: "block" }}>
                <span style={label}>NVR / camera web URL</span>
                <input
                  value={nvrUrl}
                  onChange={(e) => setNvrUrl(e.target.value)}
                  placeholder="http://192.168.1.64/  or  https://nvr.company.local/"
                  style={inp}
                />
              </label>
              <button type="button" onClick={openNvrLogin} style={btn(true, true)}>
                Open login page
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              After login, leave that window open on the live video view, then continue to Step 2.
            </div>
          </div>
        ) : (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2eaf2",
              borderRadius: 12,
              padding: 14,
              fontSize: 12.5,
              color: "#334155",
            }}
          >
            Use the laptop / USB camera as the live feed (no NVR login). Click{" "}
            <b>Share / start camera</b> below.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={startCapture} style={btn(true, true)}>
            {mode === "webcam" ? "Start webcam" : "Step 2 · Share the login tab"}
          </button>
          <button type="button" onClick={fullFrame} disabled={!live} style={btn(false)}>
            Crop = full frame
          </button>
          {!pushing ? (
            <button type="button" onClick={startPush} disabled={!live} style={btn(true, true)}>
              Step 4 · Start PPE on this crop
            </button>
          ) : (
            <button type="button" onClick={stopPush} style={btn(false)}>
              Pause PPE stream
            </button>
          )}
          <button type="button" onClick={stopStream} style={btn(false)}>
            Stop share
          </button>
        </div>

        {mode === "display" && live ? (
          <div style={{ fontSize: 12.5, color: "#1e40af", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "8px 12px" }}>
            <b>Step 3 — Crop:</b> drag on the preview below so the blue box covers <b>only the live video</b>
            (not menus / logos). Then click <b>Start PPE on this crop</b>.
          </div>
        ) : null}

        {err ? (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {err}
          </div>
        ) : null}

        <div
          ref={wrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: "relative",
            background: "#0b0f14",
            borderRadius: 12,
            overflow: "hidden",
            aspectRatio: "16 / 9",
            cursor: live ? "crosshair" : "default",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              pointerEvents: "none",
            }}
          />
          {!live ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#94a3b8",
                fontSize: 13,
                padding: 24,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {mode === "display" ? (
                <>
                  1) Open login page & sign in with username/password
                  <br />
                  2) Click “Share the login tab” and pick that Chrome/Edge tab
                  <br />
                  3) Drag to crop the video pane · Start PPE
                </>
              ) : (
                "Click “Start webcam” to use this PC camera for PPE."
              )}
            </div>
          ) : null}
          {crop && live ? (
            <div
              style={{
                position: "absolute",
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
                border: "2px solid #2563eb",
                boxShadow: "0 0 0 9999px rgba(15,23,42,.45)",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  background: "#2563eb",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                LIVE CROP → PPE
              </span>
            </div>
          ) : null}
        </div>

        <canvas ref={canvasRef} style={{ display: "none" }} />

        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            fontSize: 12.5,
            color: "#334155",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
          }}
        >
          <span>
            Status:{" "}
            <b style={{ color: pushing ? "#059669" : live ? "#2563eb" : "#64748b" }}>
              {pushing ? "PPE LIVE ON CROP" : live ? "SHARED — crop then start PPE" : "WAITING"}
            </b>
          </span>
          <span>
            Frames sent: <b>{stats.sent}</b>
          </span>
          {stats.lastErr ? (
            <span style={{ color: "#dc2626" }}>Last error: {stats.lastErr}</span>
          ) : stats.lastOk ? (
            <span style={{ color: "#059669" }}>Push OK</span>
          ) : null}
        </div>

        {pushing ? (
          <div
            style={{
              fontSize: 12.5,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 600,
            }}
          >
            This crop is now your live camera. PPE detection, alerts, and recording use it like any
            RTSP camera. Keep the NVR tab open and shared.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const label = {
  fontSize: 10.5,
  fontWeight: 800,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 4,
  display: "block",
};

const inp = {
  width: "100%",
  background: "#fff",
  border: "1px solid #cfe0ec",
  color: "#0a0a0a",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "IBM Plex Mono, ui-monospace, monospace",
};

function btn(active, primary = false) {
  if (primary) {
    return {
      border: "1px solid #1d4ed8",
      background: "#2563eb",
      color: "#fff",
      borderRadius: 8,
      padding: "8px 14px",
      fontSize: 12.5,
      fontWeight: 700,
      cursor: "pointer",
      whiteSpace: "nowrap",
    };
  }
  return {
    border: `1.5px solid ${active ? "#2563eb" : "#cfe0ec"}`,
    background: active ? "#eff6ff" : "#fff",
    color: active ? "#1d4ed8" : "#0a0a0a",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
