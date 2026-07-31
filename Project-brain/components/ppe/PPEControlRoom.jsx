"use client";
/*
 * PPE Control Room — unified, white corporate theme.
 *
 * One screen, top to bottom:
 *   1. KPI strip + AI MODEL bar
 *   2. ADD SOURCE bar
 *   3. Live camera grid — annotated MJPEG, mode switch, teach, stats
 *   4. Model versions — self-training history
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { buildPpeUrl, getPpeApiBase } from "../../lib/ppeApi";
import TeachCanvas from "./TeachCanvas";
import BrowserCropSource from "./BrowserCropSource";

const API_BASE = getPpeApiBase();

function formatApiDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => {
      if (typeof d === "string") return d;
      const loc = Array.isArray(d?.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
      const msg = d?.msg || JSON.stringify(d);
      // Old PPE server without browser support
      if (String(msg).includes("string_pattern_mismatch") || String(msg).includes("source_kind")) {
        return "PPE backend is outdated or not restarted — restart the PPE service on :8004 (use the project .venv), then try again.";
      }
      return loc ? `${loc}: ${msg}` : msg;
    }).join(" · ");
  }
  if (typeof detail === "object") return detail.msg || detail.message || JSON.stringify(detail);
  return String(detail);
}

async function api(path, options) {
  const url = buildPpeUrl(path);
  let r;
  try {
    r = await fetch(url, options);
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(
      `Network error talking to PPE service (${url}): ${msg}. `
      + "Start PPE backend on :8004 (ppe-camera/backend .venv) and keep it running.",
    );
  }
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) {
    const detail = formatApiDetail(body.detail) || `${r.status} ${r.statusText}`;
    throw new Error(detail || `HTTP ${r.status} ${path}`);
  }
  return body;
}

/* shared app palette — follows Furnace, Corporate and Ministry presets */
const C = {
  bg: "var(--bg)", panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)", sub: "var(--ink-3)",
  line: "var(--line)", brand: "var(--steel)", brandSoft: "var(--steel-soft)", ok: "var(--verdigris)", okSoft: "var(--verdigris-soft)",
  warn: "var(--slag)", warnSoft: "var(--slag-soft)", danger: "var(--molten)", dangerSoft: "var(--molten-soft)",
  shadow: "var(--shadow)",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const MODES = [
  { id: "off", label: "Off", hint: "Stream only — no AI inference", color: C.sub },
  { id: "monitor", label: "Monitor", hint: "Detect + alert on violations", color: C.brand },
  { id: "collect", label: "Collect", hint: "Detect + alert + harvest uncertain frames for training", color: C.ok },
  { id: "strict", label: "Strict", hint: "Audit mode — harvest + eager alerts", color: C.warn },
];

const SOURCE_HELP = {
  ip: "Plant CCTV — IP + login. Auto tries RTSP by brand, then common HTTP snapshot paths when RTSP is blocked.",
  onvif: "Resolve stream over ONVIF, or Discover cameras on the LAN.",
  webcam: "Laptop / USB camera for a quick local test.",
  browser: "Share an NVR web page tab and crop only the live video pane — no RTSP required.",
  rtsp: "Paste a full RTSP URL (rtsp://user:pass@ip:554/…).",
  screen: "Capture a region of the SERVER desktop. Prefer Browser crop for NVR web UIs.",
  mjpeg: "HTTP MJPEG stream (http://ip/video.cgi) when RTSP is blocked.",
  snapshot: "Poll a still URL (http://ip/cgi-bin/snapshot.cgi). Works through HTTP-only firewalls.",
  hls: "HLS / re-stream (https://host/stream.m3u8).",
  folder: "Watch a folder of stills on the server.",
  video: "Upload a clip — full pipeline without a physical camera.",
  fake: "Synthetic frames for wiring checks only.",
};

/** Sensible defaults per source type (FPS, poll, etc.) */
const KIND_DEFAULTS = {
  ip: { fps: "6" },
  onvif: { fps: "6" },
  rtsp: { fps: "6" },
  mjpeg: { fps: "8" },
  snapshot: { fps: "2", poll: 1 },
  hls: { fps: "6" },
  webcam: { fps: "10", webcamFps: "15" },
  browser: { fps: "6" },
  video: { fps: "10" },
  folder: { fps: "4" },
  screen: { fps: "6" },
  fake: { fps: "6" },
};

const PRIMARY_KINDS = [
  { id: "ip", label: "Plant CCTV", icon: "📡", hint: "IP + user + pass" },
  { id: "webcam", label: "Webcam", icon: "📷", hint: "Local USB / laptop" },
  { id: "video", label: "Upload video", icon: "🎬", hint: "Demo clip" },
  { id: "browser", label: "Browser NVR", icon: "✂", hint: "Share tab + crop" },
];

const ADVANCED_KINDS = [
  { id: "rtsp", label: "RTSP URL", icon: "🔗" },
  { id: "snapshot", label: "HTTP snapshot", icon: "🖼" },
  { id: "mjpeg", label: "HTTP MJPEG", icon: "🌐" },
  { id: "hls", label: "HLS", icon: "📶" },
  { id: "onvif", label: "ONVIF", icon: "🔎" },
  { id: "folder", label: "Image folder", icon: "📁" },
  { id: "screen", label: "Server screen", icon: "🖥" },
  { id: "fake", label: "Fake", icon: "🧪" },
];

/** Common still endpoints when RTSP is firewalled (plant sites). */
const SNAPSHOT_PATHS = [
  "/cgi-bin/snapshot.cgi",
  "/snapshot.jpg",
  "/cgi-bin/snapshot.cgi?channel=1",
  "/ISAPI/Streaming/channels/101/picture",
  "/onvif-http/snapshot",
  "/tmpfs/auto.jpg",
  "/image.jpg",
];

function Pill({ tone = "brand", children }) {
  const map = {
    brand: [C.brand, C.brandSoft], ok: [C.ok, C.okSoft], warn: [C.warn, C.warnSoft],
    danger: [C.danger, C.dangerSoft], mute: [C.sub, "#eef1f5"],
  };
  const [fg, bg] = map[tone] || map.brand;
  return (
    <span style={{ color: fg, background: bg, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ModePills({ value, onChange, busy }) {
  return (
    <div
      role="group"
      aria-label="Detection mode"
      style={{
        display: "flex", flexWrap: "wrap", gap: 4, flex: "1 1 auto", minWidth: 0,
        background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 4,
      }}
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.hint}
          aria-pressed={value === m.id}
          disabled={busy}
          onClick={() => onChange(m.id)}
          style={{
            border: "none",
            cursor: busy ? "wait" : "pointer",
            padding: "7px 12px",
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 700,
            flex: "1 1 auto",
            minWidth: 64,
            background: value === m.id ? C.panel : "transparent",
            boxShadow: value === m.id ? C.shadow : "none",
            color: value === m.id ? m.color : C.sub,
            opacity: busy ? 0.6 : 1,
            transition: "background .12s ease, color .12s ease",
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Custom model picker (never clipped) */
function ModelPicker({ models, activeKey, busy, onPick, emptyMessage = "No models returned. Is the PPE backend running?" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const active = models.find((m) => m.key === activeKey);
  const orderedModels = [...models].sort((a, b) => {
    const aRank = a.recommended ? 0 : a.plant_ready ? 1 : a.kind === "pretrained" ? 2 : 3;
    const bRank = b.recommended ? 0 : b.plant_ready ? 1 : b.kind === "pretrained" ? 2 : 3;
    if (aRank !== bRank) return aRank - bRank;
    const ae = Number(a.efficacy) || 0;
    const be = Number(b.efficacy) || 0;
    if (ae !== be) return be - ae;
    return a.label.localeCompare(b.label);
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", zIndex: open ? 80 : 2, minWidth: 0, flex: "1 1 320px", maxWidth: 480 }}>
      <button
        type="button"
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: C.panel,
          border: `1.5px solid ${open ? C.brand : C.line}`,
          color: C.ink,
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 14,
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
          textAlign: "left",
          boxShadow: open ? `0 0 0 3px ${C.brandSoft}` : "none",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active ? active.label : models.length ? "Select a detector…" : "Loading models…"}
        </span>
        <span style={{ color: C.sub, fontSize: 12, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 6px)",
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            boxShadow: "0 16px 48px rgba(16,30,46,.18)",
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 90,
            padding: 6,
          }}
        >
          {!models.length ? (
            <div style={{ padding: "14px 12px", color: C.sub, fontSize: 13 }}>
              {emptyMessage}
            </div>
          ) : (
            orderedModels.map((m) => {
              const isActive = m.key === activeKey;
              const disabled = !m.available;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={disabled || busy}
                  onClick={() => {
                    if (disabled) return;
                    setOpen(false);
                    onPick(m.key);
                  }}
                  style={{
                    width: "100%",
                    display: "block",
                    textAlign: "left",
                    border: "none",
                    borderRadius: 9,
                    padding: "11px 12px",
                    cursor: disabled ? "not-allowed" : "pointer",
                    background: isActive ? C.brandSoft : "transparent",
                    color: disabled ? "#9aa8b5" : C.ink,
                    marginBottom: 2,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 13.5, flex: 1 }}>{m.label}</span>
                    {m.recommended ? <Pill tone="brand">plant default</Pill> : null}
                    {m.efficacy != null ? <Pill tone="mute">{m.efficacy}/100</Pill> : null}
                    {m.tier === "light" ? <Pill tone="ok">light</Pill> : null}
                    {m.tier === "heavy" ? <Pill tone="warn">heavy</Pill> : null}
                    {isActive ? <Pill tone="ok">LIVE</Pill> : null}
                    {disabled ? <Pill tone="mute">unavailable</Pill> : null}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3, lineHeight: 1.35 }}>
                    {m.note
                      ? String(m.note).slice(0, 140) + (String(m.note).length > 140 ? "…" : "")
                      : m.kind === "pretrained" && !m.downloaded && m.url
                        ? "Downloads on select"
                        : m.kind === "upload"
                          ? "Upload a .pt file"
                          : m.kind === "custom"
                            ? "Use a path on the server"
                            : m.downloaded
                              ? "Ready on disk"
                              : (m.kind || "model")}
                    {!m.available && m.kind === "pretrained" ? " · configure URL first" : ""}
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Compact model switch (expanded camera) */
function CompactModelSwitch({ onSay }) {
  const say = onSay || (() => {});
  const [models, setModels] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    try {
      const z = await api("/api/models/zoo");
      setModels(z.models || []);
      setActiveKey(z.active_key || null);
      setLoadErr("");
      try {
        const m = await api("/api/models");
        setLive((m.live_weights || "").split(/[\\/]/).pop());
      } catch { /* optional */ }
    } catch (e) {
      setLoadErr(e.message || "Could not load models");
      setModels([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onPick = async (key) => {
    const m = models.find((x) => x.key === key);
    if (!m) return;
    if (!m.available) { say(`${m.label} is not configured yet`, "warn"); return; }
    if (m.kind === "upload" || m.kind === "custom") {
      say("Use Live → Model & train for upload / custom path", "warn");
      return;
    }
    setBusy(true);
    say(m.downloaded ? "Activating model…" : "Downloading + activating…", "brand");
    try {
      await api(`/api/models/zoo/${encodeURIComponent(key)}/select`, { method: "POST" });
      await load();
      say(`${m.label} is live on all cameras`, "ok");
    } catch (e) {
      say(e.message || "Model switch failed", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Detection model
      </div>
      <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.45 }}>
        Applies to <b style={{ color: C.ink }}>every camera</b> (fleet-wide). Change it here without leaving this view.
      </div>
      <ModelPicker
        models={models}
        activeKey={activeKey}
        busy={busy}
        onPick={onPick}
        emptyMessage={loadErr || "No models returned. Is the PPE backend running?"}
      />
      {activeKey ? <Pill tone="ok">● LIVE fleet-wide</Pill> : <Pill tone="mute">none active</Pill>}
      {live ? (
        <div style={{ fontSize: 11, color: C.sub, ...mono, wordBreak: "break-all" }}>
          weights: {live}
        </div>
      ) : null}
      {loadErr ? (
        <div style={{ fontSize: 12, color: C.danger }}>{loadErr}</div>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={load}
        style={{
          border: `1px solid ${C.line}`, background: C.panel, color: C.sub,
          borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}
      >
        ↻ Refresh model list
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- AI MODEL bar */
function ModelBar({ say }) {
  const [models, setModels] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const uploadRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const z = await api("/api/models/zoo");
      setModels(z.models || []);
      setActiveKey(z.active_key || null);
      setLoadErr("");
      try {
        const m = await api("/api/models");
        setLive((m.live_weights || "").split(/[\\/]/).pop());
      } catch { /* optional */ }
    } catch (e) {
      setLoadErr(e.message || "Could not load models");
      setModels([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const verifyActive = useCallback(async ({ silent = false } = {}) => {
    setVerifyBusy(true);
    try {
      const [zoo, modelState] = await Promise.all([
        api("/api/models/zoo"),
        api("/api/models"),
      ]);
      const liveWeights = (modelState.live_weights || "").split(/[\\/]/).pop();
      const activeVersion = modelState.versions?.find((v) => v.is_active);
      const activeZooModel = (zoo.models || []).find((m) => m.key === zoo.active_key);
      if (!liveWeights || (!activeVersion && !zoo.active_key)) {
        throw new Error("No live model is loaded yet.");
      }
      setActiveKey(zoo.active_key || null);
      setLive(liveWeights);
      setVerifiedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (!silent) {
        say(
          `Verified: ${activeZooModel?.label || activeVersion?.note || "active model"} is running`,
          "ok",
        );
      }
      return true;
    } catch (e) {
      setVerifiedAt("");
      if (!silent) say(`Verification failed: ${e.message}`, "danger");
      return false;
    } finally {
      setVerifyBusy(false);
    }
  }, [say]);

  const activate = async (fn, label) => {
    setBusy(true); say(label, "brand");
    try {
      await fn();
      await load();
      say("Model is live — you can upload video now", "ok");
    } catch (e) {
      say(`Model error: ${e.message}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  const activateAndVerify = async (fn, label) => {
    setBusy(true); say(label, "brand");
    try {
      await fn();
      await load();
      const ok = await verifyActive({ silent: true });
      say(ok ? "Model is live and verified" : "Model selected; verify once before using it", ok ? "ok" : "warn");
    } catch (e) {
      setVerifiedAt("");
      say(`Model error: ${e.message}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  const onPick = (key) => {
    const m = models.find((x) => x.key === key); if (!m) return;
    if (!m.available) { say(`${m.label} is not configured yet`, "warn"); return; }
    if (m.kind === "upload") { uploadRef.current?.click(); return; }
    if (m.kind === "custom") { setShowCustom(true); return; }
    if (!m.url && !m.downloaded) { say(`${m.label} has no download URL set yet`, "warn"); return; }
    const heavy = !m.downloaded && m.tier === "heavy";
    activateAndVerify(
      () => api(`/api/models/zoo/${encodeURIComponent(key)}/select`, { method: "POST" }),
      m.downloaded
        ? "Activating…"
        : heavy
          ? "Downloading from Hugging Face (40–50 MB)… keep this tab open"
          : "Downloading + activating…",
    );
  };
  const onUpload = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f); fd.append("activate", "true");
    activateAndVerify(() => api("/api/models/upload", { method: "POST", body: fd }), `Uploading ${f.name}…`);
    e.target.value = "";
  };
  const onCustom = () => {
    if (!customPath.trim()) { say("Enter a .pt path", "warn"); return; }
    const fd = new FormData(); fd.append("path", customPath.trim());
    activateAndVerify(() => api("/api/models/zoo/select-custom", { method: "POST", body: fd }), "Activating custom model…");
    setShowCustom(false);
  };

  const active = models.find((m) => m.key === activeKey);

  return (
    <section style={{
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      padding: "14px 16px",
      boxShadow: C.shadow,
      overflow: "visible",
      position: "relative",
      zIndex: 5,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: 0.8, color: C.sub, fontWeight: 800, textTransform: "uppercase", flexShrink: 0 }}>
          AI Model
        </span>
        <ModelPicker
          models={models}
          activeKey={activeKey}
          busy={busy}
          onPick={onPick}
          emptyMessage={loadErr || "No models returned. Is the PPE backend running?"}
        />
        {active ? <Pill tone="ok">● LIVE</Pill> : <Pill tone="mute">none active</Pill>}
        {active?.verified === false && active?.kind === "pretrained" ? <Pill tone="warn">unverified</Pill> : null}
        {busy ? <Pill tone="brand">working…</Pill> : null}
        {verifiedAt ? <Pill tone="ok">verified {verifiedAt}</Pill> : null}
        <span style={{ flex: "1 1 80px" }} />
        <span style={{ fontSize: 11.5, color: C.sub, ...mono, wordBreak: "break-all" }}>
          all cameras · {live || "…"}
        </span>
        <button
          type="button"
          disabled={busy || verifyBusy || !active}
          onClick={() => verifyActive()}
          title="Check that the selected model is actually hot-loaded and live"
          style={{
            border: `1px solid ${C.line}`, background: C.panel, color: C.ok, borderRadius: 9,
            padding: "9px 14px", fontSize: 12.5, fontWeight: 700,
            cursor: busy || verifyBusy || !active ? "not-allowed" : "pointer",
            opacity: busy || verifyBusy || !active ? 0.65 : 1,
            flexShrink: 0,
          }}
        >
          {verifyBusy ? "Verifying…" : "Verify Active"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => activateAndVerify(() => api("/api/models/rollback", { method: "POST" }), "Rolling back…")}
          style={{
            border: `1px solid ${C.line}`, background: C.panel, color: C.sub, borderRadius: 9,
            padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "wait" : "pointer",
            flexShrink: 0,
          }}
        >
          ↺ Rollback
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={load}
          title="Reload model list"
          style={{
            border: `1px solid ${C.line}`, background: C.panel, color: C.sub, borderRadius: 9,
            padding: "9px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0,
          }}
        >
          ↻
        </button>
      </div>

      {loadErr ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: C.dangerSoft,
            color: C.danger,
            border: "1px solid #f5c2c8",
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          Model list error: {loadErr}
        </div>
      ) : null}
      {!loadErr ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#5b6b7b", lineHeight: 1.45 }}>
          Default mode uses the <b>lightweight</b> model on the free Render worker. You can still switch to a
          <b> heavy</b> model whenever you want broader coverage.
        </div>
      ) : null}
      {active?.classes?.length ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }} aria-label="Model classes">
          {active.classes.slice(0, 12).map((c) => (
            <span key={c} style={{ fontSize: 10.5, color: C.sub, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "1px 7px" }}>{c}</span>
          ))}
          {active.classes.length > 12 ? (
            <span style={{ fontSize: 10.5, color: C.sub, padding: "1px 4px" }}>+{active.classes.length - 12} more</span>
          ) : null}
        </div>
      ) : null}
      {showCustom ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/path/to/best.pt on server"
            onKeyDown={(e) => e.key === "Enter" && onCustom()}
            style={{ flex: "1 1 220px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5, ...mono }}
          />
          <button type="button" onClick={onCustom} style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Activate</button>
          <button type="button" onClick={() => setShowCustom(false)} style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.sub, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </div>
      ) : null}
      <div style={{ fontSize: 11, color: "#8595a5", marginTop: 9 }}>
        A <b>.pt</b> file is executable code — only activate checkpoints you trust. Demo/Enterprise are checksum-pinned.
      </div>
      <input ref={uploadRef} type="file" accept=".pt" onChange={onUpload} style={{ display: "none" }} />
    </section>
  );
}

/* ---------------------------------------------------------------- PPE multi-select chips */
function PpePicker({ catalog, value, onChange, note }) {
  const items = catalog?.length
    ? catalog
    : [
      { id: "helmet", label: "Cap / Hardhat", display: "Cap", in_stock_models: true },
      { id: "vest", label: "Safety Jacket", display: "Safety Jacket", in_stock_models: true },
      { id: "mask", label: "Mask", display: "Mask", in_stock_models: true },
      { id: "gloves", label: "Gloves", display: "Gloves", in_stock_models: false },
      { id: "goggles", label: "Goggles", display: "Goggles", in_stock_models: false },
      { id: "boots", label: "Boots", display: "Boots", in_stock_models: false },
      { id: "harness", label: "Harness", display: "Harness", in_stock_models: false },
    ];
  const sel = new Set(value || []);
  const toggle = (id) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (!next.size) next.add("helmet");
    onChange([...next]);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.map((it) => {
          const on = sel.has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              title={it.in_stock_models === false ? "Needs fine-tuned model for reliable detection" : it.label}
              onClick={() => toggle(it.id)}
              style={{
                border: `1.5px solid ${on ? C.brand : C.line}`,
                background: on ? C.brandSoft : C.panel,
                color: on ? C.brand : C.sub,
                borderRadius: 999,
                padding: "5px 11px",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                opacity: it.in_stock_models === false && on ? 0.85 : 1,
              }}
            >
              {on ? "✓ " : ""}{it.display || it.label}
              {it.in_stock_models === false ? " *" : ""}
            </button>
          );
        })}
      </div>
      {note ? <div style={{ fontSize: 11, color: "#8595a5", marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Add source */
function AddSource({ onAdd, onAddVideo, open: openProp, onOpenChange, catalog, defaultPpe, onBrowserReady }) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp != null ? openProp : openLocal;
  const setOpen = (v) => {
    const next = typeof v === "function" ? v(open) : v;
    if (onOpenChange) onOpenChange(next);
    else setOpenLocal(next);
  };
  const [kind, setKind] = useState("ip");
  const [pollInterval, setPollInterval] = useState(1);
  const [folderPath, setFolderPath] = useState("");
  const [folderPattern, setFolderPattern] = useState("*.jpg");
  const [folderLoop, setFolderLoop] = useState(false);
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [index, setIndex] = useState("0");
  const [region, setRegion] = useState("0,0,1280,720");
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState("normal");
  const [fpsLimit, setFpsLimit] = useState("10");
  const [webcamFps, setWebcamFps] = useState("15");
  const [ppe, setPpe] = useState(defaultPpe || ["helmet", "vest"]);
  // IP camera (brand) builder
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState("hikvision");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [port, setPort] = useState("");
  const [channel, setChannel] = useState("1");
  const [stream, setStream] = useState("main");
  const [path, setPath] = useState("");
  const [transport, setTransport] = useState("tcp");
  // test + discovery
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    if (defaultPpe?.length) setPpe(defaultPpe);
  }, [defaultPpe]);

  useEffect(() => {
    api("/api/cameras/meta/brands").then((d) => setBrands(d.brands || [])).catch(() => {});
  }, []);

  const brandMeta = brands.find((b) => b.id === brand);

  // resolve the source_kind + source_kwargs for whatever is selected
  const buildConfig = async () => {
    if (kind === "ip") {
      const r = await api("/api/cameras/rtsp-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand, host: host.trim(), username: user, password: pass,
          port: port ? Number(port) : null, channel: Number(channel) || 1,
          stream, path,
        }),
      });
      return { source_kind: "rtsp", source_kwargs: { url: r.url, transport }, display: r.masked };
    }
    if (kind === "onvif") {
      return {
        source_kind: "onvif",
        source_kwargs: { host: host.trim(), port: port ? Number(port) : 80, username: user, password: pass },
        display: `onvif://${host.trim()}:${port || 80}`,
      };
    }
    if (kind === "mjpeg") {
      return { source_kind: "mjpeg", display: url.trim(),
        source_kwargs: { url: url.trim(), username: user || "", password: pass || "" } };
    }
    if (kind === "snapshot") {
      return { source_kind: "snapshot", display: url.trim(),
        source_kwargs: { url: url.trim(), username: user || "", password: pass || "",
                         poll_interval: Number(pollInterval) || 1.0 } };
    }
    if (kind === "hls") {
      return { source_kind: "hls", source_kwargs: { url: url.trim() }, display: url.trim() };
    }
    if (kind === "folder") {
      return { source_kind: "folder", display: folderPath,
        source_kwargs: { path: folderPath.trim(), pattern: folderPattern || "*.jpg", loop: folderLoop } };
    }
    if (kind === "webcam") {
      const requestedFps = Number(webcamFps);
      return {
        source_kind: "webcam",
        source_kwargs: {
          index: Number(index) || 0,
          ...(requestedFps > 0 ? { fps: requestedFps } : {}),
        },
      };
    }
    if (kind === "browser") {
      return {
        source_kind: "browser",
        source_kwargs: {},
        display: "browser-crop (share tab + crop pane)",
      };
    }
    if (kind === "rtsp") return { source_kind: "rtsp", source_kwargs: { url: url.trim(), transport } };
    if (kind === "screen") {
      const [l, t, w, h] = region.split(",").map((n) => Number(n) || 0);
      return { source_kind: "screen", source_kwargs: { left: l, top: t, width: w, height: h } };
    }
    return { source_kind: "fake", source_kwargs: { frames: 300 } };
  };

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const cfg = await buildConfig();
      const r = await api("/api/cameras/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_kind: cfg.source_kind, source_kwargs: cfg.source_kwargs, timeout: 8 }),
      });
      setTestResult({ ...r, display: cfg.display });
    } catch (e) {
      setTestResult({ ok: false, error: e.message || String(e) });
    } finally {
      setTesting(false);
    }
  };

  const runDiscover = async () => {
    setDiscovering(true); setFound([]); setTestResult(null);
    try {
      const r = await api("/api/cameras/discover?timeout=4");
      setFound(r.devices || []);
      if (!r.available) setTestResult({ ok: false, error: r.error || "ONVIF discovery unavailable" });
      else if (!(r.devices || []).length) setTestResult({ ok: false, error: "No ONVIF cameras answered on this LAN." });
    } catch (e) {
      setTestResult({ ok: false, error: e.message || String(e) });
    } finally {
      setDiscovering(false);
    }
  };

  const submit = async () => {
    if (kind === "video") { videoRef.current?.click(); return; }
    // Sanitize id: only [A-Za-z0-9._-] allowed by the API
    const rawId = id.trim() || (kind === "browser" ? `nvr-web-${Date.now() % 100000}` : `${kind}-${Date.now() % 10000}`);
    const camera_id = String(rawId).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || `cam-${Date.now() % 10000}`;
    setSubmitting(true);
    setTestResult(null);
    try {
      const cfg = await buildConfig();
      const payload = {
        camera_id,
        source_kind: cfg.source_kind,
        source_kwargs: {
          ...(cfg.source_kwargs || {}),
          ...(kind === "browser" ? { camera_id } : {}),
        },
        required_ppe: ppe?.length ? ppe : ["helmet", "vest"],
        fps_limit: Math.max(1, Number(fpsLimit) || 6),
      };
      await onAdd(payload);
      if (kind === "browser") {
        onBrowserReady?.(camera_id);
        setTestResult({
          ok: true,
          note: `Camera “${camera_id}” created. Use the wizard below: open NVR login → share tab → crop → Start PPE.`,
        });
      } else {
        setTestResult({ ok: true, note: `Camera “${camera_id}” added.` });
      }
      setId("");
    } catch (e) {
      setTestResult({ ok: false, error: e.message || String(e) });
    } finally {
      setSubmitting(false);
    }
  };
  const onVideo = (e) => {
    const f = e.target.files?.[0];
    if (f) onAddVideo(f, id.trim() || "demo", loop, speed, ppe, Math.max(1, Number(fpsLimit) || 10));
    e.target.value = "";
    setId("");
  };

  const inp = { background: C.panel, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: "8px 10px", fontSize: 12.5 };
  const lbl = { fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" };
  const field = (label, node) => (<label style={{ display: "block" }}><span style={lbl}>{label}</span>{node}</label>);
  const missingReq =
    (kind === "ip" && !host.trim()) ||
    (kind === "onvif" && !host.trim()) ||
    (kind === "rtsp" && !url.trim()) ||
    (kind === "mjpeg" && !url.trim()) ||
    (kind === "snapshot" && !url.trim()) ||
    (kind === "hls" && !url.trim()) ||
    (kind === "folder" && !folderPath.trim());
  const canTest = kind !== "video" && kind !== "fake" && kind !== "browser" && !missingReq;

  // Full source matrix — mirrors backend SOURCE_KINDS + IP brand builder.
  const kinds = [
    { id: "ip", label: "IP Camera", icon: "📡" },
    { id: "onvif", label: "ONVIF", icon: "🔎" },
    { id: "rtsp", label: "RTSP URL", icon: "🔗" },
    { id: "mjpeg", label: "HTTP MJPEG", icon: "🌐" },
    { id: "snapshot", label: "HTTP snapshot", icon: "🖼" },
    { id: "hls", label: "HLS / RTMP", icon: "📶" },
    { id: "browser", label: "Browser crop", icon: "✂" },
    { id: "webcam", label: "Webcam", icon: "📷" },
    { id: "video", label: "Upload video", icon: "🎬" },
    { id: "folder", label: "Image folder", icon: "📁" },
    { id: "screen", label: "Server screen", icon: "🖥" },
    { id: "fake", label: "Fake", icon: "🧪" },
  ];

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: C.shadow, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: 0.8, color: C.sub, fontWeight: 800, textTransform: "uppercase" }}>Add source</span>
        <span style={{ color: C.sub, fontSize: 12.5 }}>IP · ONVIF · RTSP · MJPEG · browser crop · webcam · video · all types</span>
        <span style={{ flex: 1 }} />
        <span style={{
          background: C.brand, color: "#fff", borderRadius: 8, padding: "6px 12px",
          fontSize: 12, fontWeight: 800,
        }}>
          {open ? "▲ Close" : "+ Add camera"}
        </span>
      </button>

      {open ? (
        <div style={{ padding: "0 16px 14px", display: "grid", gap: 12, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => { setKind(k.id); setTestResult(null); }}
                title={SOURCE_HELP[k.id]}
                style={{
                  border: `1.5px solid ${kind === k.id ? C.brand : C.line}`,
                  background: kind === k.id ? C.brandSoft : C.panel,
                  color: kind === k.id ? C.brand : C.sub,
                  borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  display: "inline-flex", gap: 6, alignItems: "center",
                }}
              >
                <span aria-hidden>{k.icon}</span> {k.label}
              </button>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: C.sub }}>{SOURCE_HELP[kind]}</p>

          {/* IP camera (brand) builder */}
          {kind === "ip" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                {field("Brand", (
                  <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...inp, width: "100%", cursor: "pointer" }}>
                    {(brands.length ? brands : [{ id: "hikvision", label: "Hikvision" }]).map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                ))}
                {field("IP / host", <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.64" style={{ ...inp, width: "100%", ...mono }} />)}
                {field("Port", <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={String(brandMeta?.default_port || 554)} style={{ ...inp, width: "100%" }} />)}
                {field("Username", <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="admin" style={{ ...inp, width: "100%" }} />)}
                {field("Password", <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••" style={{ ...inp, width: "100%" }} />)}
                {field("Channel", <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="1" style={{ ...inp, width: "100%" }} />)}
                {field("Stream", (
                  <select value={stream} onChange={(e) => setStream(e.target.value)} style={{ ...inp, width: "100%", cursor: "pointer" }}>
                    <option value="main">Main (high-res)</option>
                    <option value="sub">Sub (lighter)</option>
                  </select>
                ))}
                {field("Transport", (
                  <select value={transport} onChange={(e) => setTransport(e.target.value)} title="TCP is steadier on WiFi/eSIM" style={{ ...inp, width: "100%", cursor: "pointer" }}>
                    <option value="tcp">TCP (reliable)</option>
                    <option value="udp">UDP (low-latency)</option>
                    <option value="">Auto</option>
                  </select>
                ))}
              </div>
              {brand === "generic" ? field("RTSP path", <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/live/ch01_0" style={{ ...inp, width: "100%", ...mono }} />) : null}
              {brandMeta?.note ? <div style={{ fontSize: 11, color: "#8595a5" }}>{brandMeta.note}</div> : null}
            </div>
          ) : null}

          {/* ONVIF */}
          {kind === "onvif" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                {field("IP / host", <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.64" style={{ ...inp, width: "100%", ...mono }} />)}
                {field("ONVIF port", <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="80" style={{ ...inp, width: "100%" }} />)}
                {field("Username", <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="admin" style={{ ...inp, width: "100%" }} />)}
                {field("Password", <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••" style={{ ...inp, width: "100%" }} />)}
              </div>
              <div>
                <button type="button" onClick={runDiscover} disabled={discovering}
                  style={{ border: `1px solid ${C.line}`, background: C.panel2, color: C.ink, borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: discovering ? "wait" : "pointer" }}>
                  {discovering ? "Scanning LAN…" : "🔎 Discover cameras on LAN"}
                </button>
              </div>
              {found.length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  {found.map((d, i) => (
                    <button key={i} type="button" onClick={() => setHost(d.host || "")}
                      style={{ textAlign: "left", border: `1px solid ${C.line}`, background: C.panel, borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", ...mono }}>
                      {d.host || "(unknown host)"} <span style={{ color: C.sub }}>{(d.xaddrs || [])[0] || ""}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {kind === "browser" ? (
            <div style={{
              fontSize: 12.5, lineHeight: 1.55, color: C.sub,
              background: C.brandSoft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px",
            }}>
              <b style={{ color: C.brand }}>Yes — browser live camera</b>
              <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                <li>Click <b>Add camera</b> — a wizard opens under the form.</li>
                <li>Enter NVR web URL → <b>Open login page</b> → type <b>username & password on that page</b>.</li>
                <li><b>Share that tab</b> back into PPE → <b>drag a crop</b> over only the live video.</li>
                <li><b>Start PPE</b> — that crop is your live camera (detect / alerts / record).</li>
              </ol>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                PPE never stores the NVR password. Login stays on the vendor page (Hikvision, Dahua, etc.).
              </div>
            </div>
          ) : null}

          {kind === "rtsp" || kind === "mjpeg" || kind === "snapshot" || kind === "hls" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {field("URL", <input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder={kind === "rtsp" ? "rtsp://user:pass@ip:554/…" : "https://…"}
                style={{ ...inp, width: "100%", ...mono }} />)}
              {kind === "rtsp" ? field("Transport", (
                <select value={transport} onChange={(e) => setTransport(e.target.value)} style={{ ...inp, width: "100%" }}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="">Auto</option>
                </select>
              )) : null}
              {(kind === "mjpeg" || kind === "snapshot") ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {field("Username", <input value={user} onChange={(e) => setUser(e.target.value)} style={{ ...inp, width: "100%" }} />)}
                  {field("Password", <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ ...inp, width: "100%" }} />)}
                </div>
              ) : null}
              {kind === "snapshot" ? field("Poll interval (s)", (
                <input type="number" min={0.5} step={0.5} value={pollInterval}
                  onChange={(e) => setPollInterval(e.target.value)} style={{ ...inp, width: 120 }} />
              )) : null}
            </div>
          ) : null}

          {kind === "webcam" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {field("Device index", <input value={index} onChange={(e) => setIndex(e.target.value)} placeholder="0" style={{ ...inp, width: "100%" }} />)}
              {field("Requested FPS", <input value={webcamFps} onChange={(e) => setWebcamFps(e.target.value)} placeholder="15" style={{ ...inp, width: "100%" }} />)}
            </div>
          ) : null}

          {kind === "folder" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {field("Folder path (server)", <input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="D:\\stills\\gate" style={{ ...inp, width: "100%", ...mono }} />)}
              {field("Pattern", <input value={folderPattern} onChange={(e) => setFolderPattern(e.target.value)} placeholder="*.jpg" style={{ ...inp, width: "100%" }} />)}
              <label style={{ fontSize: 12.5, display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={folderLoop} onChange={(e) => setFolderLoop(e.target.checked)} /> Loop folder
              </label>
            </div>
          ) : null}

          {kind === "screen" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {field("Region left,top,width,height (server pixels)", (
                <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="0,0,1280,720" style={{ ...inp, width: "100%", ...mono }} />
              ))}
              <div style={{ fontSize: 12, color: C.sub }}>
                Captures the <b>server</b> display. For a browser NVR login on your PC, use <b>Browser crop</b> instead.
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
              Required PPE on this camera
            </div>
            <PpePicker
              catalog={catalog}
              value={ppe}
              onChange={setPpe}
              note="* = not in stock Snehil/VoxDroid weights — needs fine-tuned model. Live HUD shows Found / Not found chips like industrial demos."
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder={kind === "video" ? "camera id (default: demo)" : "camera id (optional)"}
              value={id}
              onChange={(e) => setId(e.target.value)}
              style={{ ...inp, width: 180 }}
            />
            {kind === "rtsp" ? (
              <>
                <input
                  placeholder="rtsp://user:pass@ip:554/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{ ...inp, flex: 1, minWidth: 240, ...mono }}
                />
                <select value={transport} onChange={(e) => setTransport(e.target.value)} title="RTSP transport" style={{ ...inp, cursor: "pointer" }}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="">Auto</option>
                </select>
              </>
            ) : null}
            {kind === "mjpeg" || kind === "snapshot" || kind === "hls" ? (
              <>
                <input
                  placeholder={
                    kind === "mjpeg" ? "http://ip/video.cgi"
                      : kind === "snapshot" ? "http://ip/snapshot.jpg"
                        : "https://host/stream.m3u8"
                  }
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{ ...inp, flex: 1, minWidth: 260, ...mono }}
                />
                {kind !== "hls" ? (
                  <>
                    <input placeholder="user (optional)" value={user}
                      onChange={(e) => setUser(e.target.value)}
                      style={{ ...inp, width: 130 }} />
                    <input placeholder="password" type="password" value={pass}
                      onChange={(e) => setPass(e.target.value)}
                      style={{ ...inp, width: 130 }} />
                  </>
                ) : null}
                {kind === "snapshot" ? (
                  <label title="How often to fetch a still. Frame rate is limited by this, not by the camera."
                    style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Poll every
                    <input value={pollInterval} onChange={(e) => setPollInterval(e.target.value)}
                      style={{ ...inp, width: 56 }} /> s
                  </label>
                ) : null}
              </>
            ) : null}
            {kind === "folder" ? (
              <>
                <input placeholder="/mnt/site-photos/gate" value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  style={{ ...inp, flex: 1, minWidth: 220, ...mono }} />
                <input placeholder="*.jpg" value={folderPattern}
                  onChange={(e) => setFolderPattern(e.target.value)}
                  style={{ ...inp, width: 90, ...mono }} />
                <label style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={folderLoop}
                    onChange={(e) => setFolderLoop(e.target.checked)} />
                  Loop
                </label>
              </>
            ) : null}
            {kind === "webcam" ? (
              <>
                <label style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Device index
                  <input value={index} onChange={(e) => setIndex(e.target.value)} style={{ ...inp, width: 56 }} />
                </label>
                <label
                  title="Requested camera capture rate for the local webcam. Actual hardware support varies."
                  style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  Camera FPS
                  <input value={webcamFps} onChange={(e) => setWebcamFps(e.target.value)} style={{ ...inp, width: 64 }} />
                </label>
              </>
            ) : null}
            <label
              title="Maximum frames per second sent through PPE inference for this camera. Applies to RTSP and the other source types too."
              style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              PPE FPS
              <input value={fpsLimit} onChange={(e) => setFpsLimit(e.target.value)} style={{ ...inp, width: 64 }} />
            </label>
            {kind === "screen" ? (
              <input
                placeholder="left,top,width,height"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                style={{ ...inp, width: 200, ...mono }}
              />
            ) : null}
            {kind === "video" ? (
              <>
                <select value={speed} onChange={(e) => setSpeed(e.target.value)} title="playback speed" style={{ ...inp, cursor: "pointer" }}>
                  <option value="slow">Slow (0.5×)</option>
                  <option value="normal">Real-time (1×)</option>
                  <option value="fast">Fast (2×)</option>
                </select>
                <label style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
                </label>
              </>
            ) : null}
            {canTest ? (
              <button
                type="button"
                onClick={runTest}
                disabled={testing}
                title="Open the source and grab one frame to confirm it works"
                style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.brand, borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 800, cursor: testing ? "wait" : "pointer" }}
              >
                {testing ? "Testing…" : "🔌 Test connection"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={missingReq || submitting}
              style={{
                border: "none",
                background: missingReq || submitting ? "#9bb6e8" : C.brand,
                color: "#fff",
                borderRadius: 9,
                padding: "9px 18px",
                fontSize: 12.5,
                fontWeight: 800,
                cursor: missingReq ? "not-allowed" : "pointer",
              }}
            >
              {submitting
                ? "Adding…"
                : kind === "video"
                  ? "Choose & run"
                  : kind === "browser"
                    ? "Add NVR browser camera"
                    : "Add & start"}
            </button>
          </div>

          {testResult ? (
            <div style={{
              fontSize: 12.5, borderRadius: 9, padding: "9px 12px",
              background: testResult.ok ? C.okSoft : C.dangerSoft,
              color: testResult.ok ? C.ok : C.danger,
              border: `1px solid ${testResult.ok ? "#b8e6d0" : "#f5c2c8"}`,
              lineHeight: 1.45,
            }}>
              {testResult.ok ? (
                <span>
                  ✓ {testResult.note
                    || (testResult.width
                      ? `Connected — ${testResult.width}×${testResult.height}, first frame in ${testResult.latency_ms} ms.`
                      : "OK")}
                  {testResult.display ? <span style={{ ...mono, color: C.sub }}> {testResult.display}</span> : null}
                </span>
              ) : (
                <span>✕ {testResult.error || "Could not connect"}</span>
              )}
            </div>
          ) : null}

          <input ref={videoRef} type="file" accept="video/*" onChange={onVideo} style={{ display: "none" }} />
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------- Fullscreen viewer */
function FullscreenViewer({ cam, onClose }) {
  const [playing, setPlaying] = useState(true);
  const [key, setKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const shell = useRef(null);

  const base = `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}`;
  const src = playing ? `${base}/stream.mjpg?fps=12&k=${key}` : `${base}/snapshot.jpg?t=${key}`;

  const clampPan = (p, z) => {
    const m = 50 * (z - 1);
    return { x: Math.max(-m, Math.min(m, p.x)), y: Math.max(-m, Math.min(m, p.y)) };
  };
  const setZ = (z) => {
    const nz = Math.max(1, Math.min(6, +z.toFixed(2)));
    setZoom(nz);
    setPan((p) => (nz === 1 ? { x: 0, y: 0 } : clampPan(p, nz)));
  };
  const toggle = () => { setKey((k) => k + 1); setPlaying((p) => !p); };
  const onDown = (e) => { if (zoom <= 1) return; drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; };
  const onMove = (e) => {
    if (!drag.current) return;
    setPan(clampPan({
      x: drag.current.px + (e.clientX - drag.current.sx) * 0.12,
      y: drag.current.py + (e.clientY - drag.current.sy) * 0.12,
    }, zoom));
  };
  const onUp = () => { drag.current = null; };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); toggle(); }
      if (e.key === "+" || e.key === "=") setZ(zoom + 0.5);
      if (e.key === "-") setZ(zoom - 0.5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const goNativeFs = () => {
    const el = shell.current;
    if (!el) return;
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
  };

  const ctl = {
    border: "none", background: "rgba(255,255,255,.14)", color: "#fff", borderRadius: 9,
    padding: "8px 12px", fontSize: 14, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div ref={shell} role="dialog" aria-modal="true" aria-label={`Fullscreen ${cam.camera_id}`}
      style={{ position: "fixed", inset: 0, background: "#05080c", zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div
        style={{ flex: 1, overflow: "hidden", position: "relative", display: "grid", placeItems: "center" }}
        onWheel={(e) => { e.preventDefault(); setZ(zoom + (e.deltaY < 0 ? 0.3 : -0.3)); }}
      >
        <img
          alt={cam.camera_id}
          draggable={false}
          src={src}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onError={() => { if (playing) setTimeout(() => setKey((k) => k + 1), 1500); }}
          style={{
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
            transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
            transition: drag.current ? "none" : "transform .12s ease",
            cursor: zoom > 1 ? (drag.current ? "grabbing" : "grab") : "default",
          }}
        />
        <span style={{
          position: "absolute", top: 14, left: 16, color: "#e7eef6", fontSize: 13, ...mono,
          background: "rgba(5,8,12,.6)", padding: "4px 10px", borderRadius: 7,
        }}>
          {cam.camera_id} · {cam.source} {playing ? "" : "· PAUSED"}
        </span>
        {cam.mode ? (
          <span style={{
            position: "absolute", top: 14, right: 16, color: "#e7eef6", fontSize: 12, fontWeight: 700,
            background: "rgba(18,86,209,.75)", padding: "4px 10px", borderRadius: 7, textTransform: "uppercase",
          }}>
            {cam.mode}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", background: "#0b0f14", borderTop: "1px solid #1e2c3a" }}>
        <button type="button" onClick={toggle} style={{ ...ctl, background: "#1256d1", minWidth: 96 }}>{playing ? "⏸ Pause" : "▶ Play"}</button>
        <span style={{ width: 12 }} />
        <button type="button" onClick={() => setZ(zoom - 0.5)} style={ctl}>−</button>
        <span style={{ color: "#e7eef6", fontSize: 13, ...mono, minWidth: 42, textAlign: "center" }}>{zoom.toFixed(1)}×</span>
        <button type="button" onClick={() => setZ(zoom + 0.5)} style={ctl}>+</button>
        {zoom > 1 ? <button type="button" onClick={() => setZ(1)} style={ctl}>reset</button> : null}
        <span style={{ flex: 1 }} />
        <span style={{ color: "#6d8296", fontSize: 12 }}>Space play/pause · Esc close · scroll zoom · ± keys</span>
        <button type="button" onClick={goNativeFs} style={ctl}>⛶ Full screen</button>
        <button type="button" onClick={onClose} style={{ ...ctl, background: "rgba(255,255,255,.14)" }}>✕ Close</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Camera card */
function CameraCard({
  cam, onMode, onFlag, onStartStop, onRemove, onPpe, catalog,
  large = false, layout = "card", onOpen, onBack,
}) {
  const isTile = layout === "tile";
  const isCanvas = layout === "canvas";
  const [fs, setFs] = useState(false);
  const [panelTab, setPanelTab] = useState("live"); // live | mode | ppe | teach | manage
  const [streamKey, setStreamKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imgOk, setImgOk] = useState(true);
  const [flagging, setFlagging] = useState(false);
  /* Live Teach: hover a box → see Flip option; click → confirm; then save.
     Labels bank into training data (Train & go live is still a separate step). */
  const [teachOn, setTeachOn] = useState(false);
  const [liveBoxes, setLiveBoxes] = useState(null);   // /live-labels payload
  const [teachMsg, setTeachMsg] = useState("");
  const [teachRect, setTeachRect] = useState(null);   // where the video sits (contain fit)
  const [hoverBoxI, setHoverBoxI] = useState(null);   // box under cursor
  const [teachAsk, setTeachAsk] = useState(null);     // { box, frame_id, boxes } frozen for confirm
  const [teachSaving, setTeachSaving] = useState(false);
  /* Freeze & label: the full editor. Quick-flip above handles the common case
     in one click; this handles the two corrections flipping cannot express —
     a box the model MISSED (nothing to click) and one it INVENTED (nothing an
     edit can remove). The frame is pinned server-side so it cannot move on
     while the operator is drawing. */
  const [frozen, setFrozen] = useState(null);         // teach-freeze payload
  const [frozenBoxes, setFrozenBoxes] = useState([]);
  const [frozenSaving, setFrozenSaving] = useState(false);
  const [clipping, setClipping] = useState(false);
  const videoWrapRef = useRef(null);
  const freezePollRef = useRef(false);                // don't refresh labels while ask is open
  const drag = useRef(null);
  const running = cam.state === "running";
  const stateColor = running ? C.ok : cam.state === "error" ? C.danger : C.sub;
  useEffect(() => { if (running) { setStreamKey((k) => k + 1); setImgOk(true); } }, [running]);
  const st = cam.stats || {};

  const clampPan = (p, z) => {
    const m = 50 * (z - 1);
    return { x: Math.max(-m, Math.min(m, p.x)), y: Math.max(-m, Math.min(m, p.y)) };
  };
  const setZ = (z) => {
    const nz = Math.max(1, Math.min(5, +z.toFixed(2)));
    setZoom(nz);
    setPan((p) => (nz === 1 ? { x: 0, y: 0 } : clampPan(p, nz)));
  };
  const onWheel = (e) => {
    if (!running) return;
    e.preventDefault();
    setZ(zoom + (e.deltaY < 0 ? 0.3 : -0.3));
  };
  const onDown = (e) => { if (zoom <= 1 || teachOn) return; drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; };
  const onMove = (e) => {
    if (!drag.current) return;
    setPan(clampPan({
      x: drag.current.px + (e.clientX - drag.current.sx) * 0.15,
      y: drag.current.py + (e.clientY - drag.current.sy) * 0.15,
    }, zoom));
  };
  const onUp = () => { drag.current = null; };

  const modeMeta = MODES.find((m) => m.id === cam.mode) || MODES[1];
  const zbtn = {
    border: "none", background: "rgba(5,8,12,.72)", color: "#e7eef6", width: 30, height: 30,
    borderRadius: 8, fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1,
  };

  const handleFlag = async () => {
    setFlagging(true);
    try { await onFlag(cam.camera_id); }
    finally { setFlagging(false); }
  };

  /* ---- Live Teach ------------------------------------------------------ */
  // Poll the model's boxes for the newest frame while teach mode is on.
  // Freeze polling while a confirm dialog is open so the box doesn't jump away.
  useEffect(() => {
    freezePollRef.current = Boolean(teachAsk);
  }, [teachAsk]);

  useEffect(() => {
    if (!teachOn || !running) return undefined;
    let alive = true;
    const tick = async () => {
      if (freezePollRef.current) return;
      try {
        const r = await fetch(
          `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/live-labels`);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (alive && !freezePollRef.current) setLiveBoxes(j);
      } catch {
        if (alive && !freezePollRef.current) setLiveBoxes(null);
      }
    };
    tick();
    const t = setInterval(tick, 800);
    return () => { alive = false; clearInterval(t); };
  }, [teachOn, running, cam.camera_id]);

  // Where does the video actually sit inside the wrapper? objectFit:contain
  // letterboxes, so box coordinates must be mapped into that inner rect.
  useEffect(() => {
    if (!teachOn) return undefined;
    const measure = () => {
      const el = videoWrapRef.current;
      const fw = liveBoxes?.width, fh = liveBoxes?.height;
      if (!el || !fw || !fh) { setTeachRect(null); return; }
      const { width: cw, height: ch } = el.getBoundingClientRect();
      const scale = Math.min(cw / fw, ch / fh);
      const w = fw * scale, h = fh * scale;
      setTeachRect({ x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [teachOn, liveBoxes]);

  const toggleTeach = () => {
    setTeachOn((v) => {
      const next = !v;
      if (next) { setZ(1); }             // overlay math assumes no zoom/pan
      else {
        setLiveBoxes(null);
        setTeachMsg("");
        setHoverBoxI(null);
        setTeachAsk(null);
      }
      return next;
    });
  };

  const flash = (msg) => {
    setTeachMsg(msg);
    setTimeout(() => setTeachMsg((m) => (m === msg ? "" : m)), 2800);
  };

  const flipTargetLabel = (box) => {
    if (!box) return "";
    if (box.kind === "violation") return `${box.label} worn (green)`;
    return `${box.label} missing (red)`;
  };

  // Click only opens the confirm card — does not save yet.
  const askFlip = (box) => {
    if (!box?.counterpart || !liveBoxes) return;
    setTeachAsk({
      box,
      frame_id: liveBoxes.frame_id,
      boxes: liveBoxes.boxes,
    });
    setHoverBoxI(box.i);
  };

  const cancelFlip = () => {
    setTeachAsk(null);
    setTeachSaving(false);
  };

  // Confirm: flip class and bank the frozen frame as labeled training data.
  const confirmFlip = async () => {
    if (!teachAsk || teachSaving) return;
    const { box, frame_id, boxes: snap } = teachAsk;
    if (!box.counterpart) return;
    const payloadBoxes = snap
      .filter((b) => b.known)
      .map((b) => ({ cls: b.i === box.i ? box.counterpart : b.cls, xyxy: b.xyxy }));
    setTeachSaving(true);
    // optimistic flip on the frozen overlay
    setLiveBoxes((p) => p && ({
      ...p,
      boxes: (p.boxes || snap).map((b) => (b.i === box.i
        ? {
          ...b,
          cls: box.counterpart,
          kind: b.kind === "violation" ? "gear" : "violation",
          label: b.label,
        }
        : b)),
    }));
    try {
      const r = await fetch(
        `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/teach-live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame_id, boxes: payloadBoxes }),
        });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `${r.status}`);
      flash(`✓ saved — mark more boxes, then Train & go live`);
      setTeachAsk(null);
    } catch (e) {
      flash(`✗ ${String(e.message || e)}`);
    } finally {
      setTeachSaving(false);
    }
  };

  /* ---- Freeze & label -------------------------------------------------- */
  const startFreeze = async () => {
    setFrozenSaving(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/teach-freeze`,
        { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setFrozen(j);
      setFrozenBoxes((j.boxes || []).filter((b) => b.known));
      setTeachOn(false);
      setTeachAsk(null);
    } catch (e) {
      flash(`✗ ${String(e.message || e)}`);
    } finally {
      setFrozenSaving(false);
    }
  };

  const closeFreeze = useCallback(async () => {
    const fid = frozen?.frame_id;
    setFrozen(null);
    setFrozenBoxes([]);
    setFrozenSaving(false);
    // Release the server-side pin. Best effort: it also expires on its own, so
    // a failed release costs a little memory, never a stuck frame.
    if (fid != null) {
      try {
        await fetch(
          `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}`
          + `/teach-release?frame_id=${fid}`, { method: "POST" });
      } catch { /* the pin's TTL will collect it */ }
    }
  }, [frozen, cam.camera_id]);

  const saveFreeze = async () => {
    if (!frozen || frozenSaving) return;
    setFrozenSaving(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/teach-live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frame_id: frozen.frame_id,
            boxes: frozenBoxes.map((b) => ({ cls: b.cls, xyxy: b.xyxy })),
            note: "freeze & label from control room",
          }),
        });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      flash(`✓ ${j.labels} label(s) saved — fold them in with Train & go live`);
      setFrozen(null);
      setFrozenBoxes([]);
    } catch (e) {
      flash(`✗ ${String(e.message || e)}`);
    } finally {
      setFrozenSaving(false);
    }
  };

  const [posing, setPosing] = useState(false);
  const togglePose = async () => {
    setPosing(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/pose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !cam.pose_enabled }),
        });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      flash(j.pose_enabled
        ? "✓ keypoints on — gear is matched to the body, not the box"
        : "keypoints off");
    } catch (e) {
      flash(`✗ ${String(e.message || e)}`);
    } finally {
      setPosing(false);
    }
  };

  const clipNow = async () => {
    setClipping(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/nvr/cameras/${encodeURIComponent(cam.camera_id)}/record-now`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds: 30 }),
        });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      flash("✓ recording 30s — find it in Recorder");
    } catch (e) {
      flash(`✗ ${String(e.message || e)}`);
    } finally {
      setClipping(false);
    }
  };

  const actionBtn = {
    border: `1px solid ${C.line}`,
    background: C.panel,
    borderRadius: 9,
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };

  /* ---- Compact grid tile: click → full-page canvas ---- */
  if (isTile) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(cam.camera_id)}
        title={`Open ${cam.camera_id} full canvas`}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          margin: 0,
          border: `1px solid ${cam.state === "error" ? "#f5c2c8" : C.line}`,
          borderRadius: 14,
          overflow: "hidden",
          background: C.panel,
          boxShadow: C.shadow,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          color: "inherit",
        }}
      >
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", background: "#0b0f14" }}>
          {running && imgOk ? (
            <img
              key={streamKey}
              alt=""
              draggable={false}
              src={`${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/stream.mjpg?fps=6&k=${streamKey}`}
              style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
              onError={() => {
                setImgOk(false);
                setTimeout(() => { setImgOk(true); setStreamKey((k) => k + 1); }, 2000);
              }}
            />
          ) : (
            <div style={{
              position: "absolute", inset: 0, display: "grid", placeItems: "center",
              color: cam.state === "error" ? "#f5a5ad" : "#6d8296", fontSize: 12.5, padding: 16, textAlign: "center",
            }}>
              {cam.state === "error" ? (st.last_error || "Error") : running ? "Connecting…" : "Stopped"}
            </div>
          )}
          <div style={{
            position: "absolute", top: 8, left: 8, right: 8,
            display: "flex", alignItems: "center", gap: 6, pointerEvents: "none",
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(5,8,12,.78)", color: "#e7eef6",
              fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 8, ...mono,
              maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: 4, background: stateColor, flexShrink: 0,
                boxShadow: running ? `0 0 0 3px ${stateColor}33` : "none",
              }} />
              {cam.camera_id}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{
              background: "rgba(5,8,12,.78)", color: modeMeta.color === C.sub ? "#c5d0db" : modeMeta.color,
              fontSize: 10, fontWeight: 800, padding: "4px 8px", borderRadius: 7, textTransform: "uppercase",
            }}>
              {modeMeta.label}
            </span>
          </div>
          {running && imgOk ? (
            <span style={{
              position: "absolute", bottom: 8, left: 8,
              background: "rgba(192,43,60,.9)", color: "#fff", fontSize: 10, fontWeight: 800,
              padding: "3px 8px", borderRadius: 5, letterSpacing: 0.5,
            }}>
              LIVE
            </span>
          ) : null}
          <span style={{
            position: "absolute", bottom: 8, right: 8,
            background: "rgba(37,99,235,.92)", color: "#fff", fontSize: 11, fontWeight: 800,
            padding: "5px 10px", borderRadius: 8,
          }}>
            Open canvas →
          </span>
        </div>
        <div style={{
          display: "flex", gap: 10, padding: "8px 12px", fontSize: 11, color: C.sub, ...mono,
          borderTop: `1px solid ${C.line}`, flexWrap: "wrap",
        }}>
          <span>viol {(st.violations_fired ?? 0)}</span>
          <span>inf {(st.frames_inferred ?? 0)}</span>
          <span style={{ marginLeft: "auto", color: C.brand, fontWeight: 700, fontFamily: "inherit" }}>Click to expand</span>
        </div>
      </button>
    );
  }

  const panelTabs = [
    { id: "live", label: "Live" },
    { id: "model", label: "Model" },
    { id: "mode", label: "Mode" },
    { id: "ppe", label: "PPE" },
    { id: "teach", label: "Teach" },
    { id: "manage", label: "Manage" },
  ];

  const videoShellStyle = isCanvas
    ? {
        position: "relative",
        width: "100%",
        flex: "1 1 auto",
        minHeight: 0,
        height: "100%",
        background: "#0b0f14",
        overflow: "hidden",
        borderRadius: 12,
      }
    : {
        position: "relative",
        width: "100%",
        minHeight: large ? "min(68vh, 720px)" : "min(42vh, 420px)",
        height: large ? "min(68vh, 720px)" : undefined,
        aspectRatio: large ? undefined : "16 / 10",
        background: "#0b0f14",
        overflow: "hidden",
        borderRadius: "14px 14px 0 0",
      };

  return (
    <article
      style={{
        background: isCanvas ? "transparent" : C.panel,
        border: isCanvas ? "none" : `1px solid ${cam.state === "error" ? "#f5c2c8" : C.line}`,
        borderRadius: isCanvas ? 0 : 14,
        overflow: "visible",
        boxShadow: isCanvas ? "none" : C.shadow,
        display: "flex",
        flexDirection: isCanvas ? "row" : "column",
        flexWrap: isCanvas ? "wrap" : undefined,
        minWidth: 0,
        height: isCanvas ? "100%" : undefined,
        minHeight: isCanvas ? "calc(100vh - 160px)" : undefined,
        gap: isCanvas ? 12 : 0,
        alignItems: isCanvas ? "stretch" : undefined,
      }}
    >
      <div style={{
        display: "flex",
        flexDirection: "column",
        flex: isCanvas ? "1 1 480px" : undefined,
        minWidth: isCanvas ? 280 : 0,
        minHeight: isCanvas ? 360 : undefined,
        gap: isCanvas ? 10 : 0,
        width: isCanvas ? undefined : "100%",
      }}>
      {isCanvas ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "2px 2px 0",
        }}>
          <button
            type="button"
            onClick={() => onBack?.()}
            style={{
              border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
              borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
            }}
          >
            ← Grid
          </button>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10,
            padding: "6px 12px", ...mono, fontSize: 13, fontWeight: 700,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: 4, background: stateColor,
              boxShadow: running ? `0 0 0 3px ${stateColor}33` : "none",
            }} />
            {cam.camera_id}
            <span style={{ color: C.sub, fontWeight: 600 }}>· {cam.source}</span>
          </div>
          <Pill tone={running ? "ok" : cam.state === "error" ? "danger" : "mute"}>
            {cam.state}
          </Pill>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => onStartStop(cam.camera_id, running)}
            style={{
              ...actionBtn,
              border: `1px solid ${running ? "#f5c2c8" : "#b8e6d0"}`,
              background: running ? C.dangerSoft : C.okSoft,
              color: running ? C.danger : C.ok,
            }}
          >
            {running ? "Stop" : "Start"}
          </button>
          {running ? (
            <button type="button" onClick={() => setFs(true)} style={actionBtn}>
              ⛶ Fullscreen
            </button>
          ) : null}
        </div>
      ) : null}
      {/* video canvas */}
      <div
        style={videoShellStyle}
        ref={videoWrapRef}
        onWheel={teachOn ? undefined : onWheel}
      >
        {running && imgOk ? (
          <img
            key={streamKey}
            alt={`Live feed ${cam.camera_id}`}
            draggable={false}
            src={`${API_BASE}/api/cameras/${encodeURIComponent(cam.camera_id)}/stream.mjpg?fps=10&k=${streamKey}`}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            style={{
              width: "100%", height: "100%", objectFit: "contain",
              transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
              transformOrigin: "center center",
              transition: drag.current ? "none" : "transform .12s ease",
              cursor: zoom > 1 ? (drag.current ? "grabbing" : "grab") : "default",
            }}
            onError={() => {
              setImgOk(false);
              setTimeout(() => { setImgOk(true); setStreamKey((k) => k + 1); }, 2000);
            }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#6d8296", fontSize: 13, padding: 16, textAlign: "center" }}>
            {cam.state === "error"
              ? <span style={{ color: "#f5a5ad" }}>Error: {st.last_error || "source failed"}</span>
              : running && !imgOk
                ? "Reconnecting stream…"
                : "Stopped — press Start to resume"}
          </div>
        )}

        {/* Live Teach overlay: hover → Flip chip; click → confirm; save on Yes. */}
        {teachOn && running && teachRect && liveBoxes ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
            {/* Hint bar while teaching */}
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              zIndex: 7, maxWidth: "92%",
              background: "rgba(5,8,12,.88)", color: "#e7eef6",
              fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 9,
              border: "1px solid rgba(61,214,140,.45)", textAlign: "center", lineHeight: 1.35,
              pointerEvents: "none",
            }}>
              {teachAsk
                ? "Confirm below — video labels are frozen while you decide"
                : "Hover a red/green box · click Flip · confirm to teach"}
            </div>

            {liveBoxes.boxes.filter((b) => b.kind !== "other").map((b) => {
              const [x1, y1, x2, y2] = b.xyxy;
              const s = teachRect.scale;
              const flippable = Boolean(b.counterpart);
              const col = b.kind === "violation" ? "#e5484d"
                : b.kind === "person" ? "#4c9ffe" : "#30a46c";
              const hovered = hoverBoxI === b.i;
              const asking = teachAsk?.box?.i === b.i;
              const left = teachRect.x + x1 * s;
              const top = teachRect.y + y1 * s;
              const bw = Math.max(8, (x2 - x1) * s);
              const bh = Math.max(8, (y2 - y1) * s);
              const flipToGreen = b.kind === "violation";
              const flipCol = flipToGreen ? "#30a46c" : "#e5484d";
              return (
                <div
                  key={b.i}
                  role={flippable ? "button" : undefined}
                  tabIndex={flippable ? 0 : undefined}
                  onMouseEnter={() => flippable && setHoverBoxI(b.i)}
                  onMouseLeave={() => setHoverBoxI((cur) => (cur === b.i && !teachAsk ? null : cur))}
                  onClick={flippable ? (e) => { e.stopPropagation(); askFlip(b); } : undefined}
                  onKeyDown={flippable ? (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); askFlip(b); }
                  } : undefined}
                  style={{
                    position: "absolute",
                    left, top, width: bw, height: bh,
                    border: `${asking || hovered ? 3 : 2}px solid ${asking ? flipCol : col}`,
                    borderRadius: 4,
                    cursor: flippable ? "pointer" : "default",
                    background: hovered || asking ? `${col}22` : "transparent",
                    boxShadow: flippable
                      ? (hovered || asking
                        ? `0 0 0 2px ${flipCol}, 0 4px 16px rgba(0,0,0,.35)`
                        : "0 0 0 1px rgba(255,255,255,.35)")
                      : "none",
                    transition: "box-shadow .12s ease, background .12s ease",
                  }}
                >
                  <span style={{
                    position: "absolute", top: -22, left: -2, whiteSpace: "nowrap",
                    background: col, color: "#fff", fontSize: 10.5, fontWeight: 800,
                    padding: "2px 6px", borderRadius: 4, ...mono,
                    pointerEvents: "none",
                  }}>
                    {b.kind === "violation" ? `${b.label} ✕` : b.kind === "person" ? "Person" : `${b.label} ✓`}
                  </span>

                  {/* Hover chip: clear Flip action without saving yet */}
                  {flippable && (hovered || asking) && !asking ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); askFlip(b); }}
                      style={{
                        position: "absolute",
                        left: "50%", bottom: -34, transform: "translateX(-50%)",
                        whiteSpace: "nowrap", zIndex: 8,
                        border: "none", borderRadius: 8, cursor: "pointer",
                        padding: "6px 10px", fontSize: 11.5, fontWeight: 800,
                        background: flipCol, color: "#fff",
                        boxShadow: "0 4px 14px rgba(0,0,0,.4)",
                      }}
                    >
                      {flipToGreen ? "↗ Mark worn (green)" : "↘ Mark missing (red)"}
                    </button>
                  ) : null}
                </div>
              );
            })}

            {/* Confirm card after click */}
            {teachAsk ? (
              <div
                role="dialog"
                aria-label="Confirm teach flip"
                style={{
                  position: "absolute", left: "50%", bottom: 52, transform: "translateX(-50%)",
                  zIndex: 9, width: "min(340px, 92%)",
                  background: "rgba(8,12,18,.96)", color: "#e7eef6",
                  borderRadius: 12, padding: "14px 14px 12px",
                  border: "1px solid rgba(255,255,255,.14)",
                  boxShadow: "0 12px 40px rgba(0,0,0,.5)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: "#9bb0c3", marginBottom: 6, textTransform: "uppercase" }}>
                  Teach this box?
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, lineHeight: 1.35 }}>
                  <span style={{
                    color: teachAsk.box.kind === "violation" ? "#ff8a95" : "#6ddea8",
                  }}>
                    {teachAsk.box.kind === "violation" ? `${teachAsk.box.label} ✕` : `${teachAsk.box.label} ✓`}
                  </span>
                  <span style={{ color: "#7a8fa3", margin: "0 8px" }}>→</span>
                  <span style={{
                    color: teachAsk.box.kind === "violation" ? "#6ddea8" : "#ff8a95",
                  }}>
                    {flipTargetLabel(teachAsk.box)}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9bb0c3", marginBottom: 12, lineHeight: 1.4 }}>
                  Saves this frame as training data. Model updates only after <b style={{ color: "#c5d0db" }}>Train &amp; go live</b>.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={confirmFlip}
                    disabled={teachSaving}
                    style={{
                      flex: 1, border: "none", borderRadius: 9, padding: "10px 12px",
                      fontSize: 13, fontWeight: 800, cursor: teachSaving ? "wait" : "pointer",
                      background: teachAsk.box.kind === "violation" ? "#30a46c" : "#e5484d",
                      color: "#fff", opacity: teachSaving ? 0.75 : 1,
                    }}
                  >
                    {teachSaving ? "Saving…" : "Yes, flip & save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelFlip}
                    disabled={teachSaving}
                    style={{
                      border: "1px solid rgba(255,255,255,.2)", borderRadius: 9,
                      padding: "10px 14px", fontSize: 13, fontWeight: 700,
                      background: "transparent", color: "#c5d0db", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

          </div>
        ) : null}
        {teachMsg ? (
          <div style={{
            position: "absolute", bottom: 44, left: "50%", transform: "translateX(-50%)", zIndex: 10,
            background: teachMsg.startsWith("✓") ? "rgba(24,110,68,.95)" : "rgba(140,30,36,.95)",
            color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 9,
            maxWidth: "90%", textAlign: "center",
          }}>
            {teachMsg}
          </div>
        ) : null}

        {/* top-left identity */}
        <div style={{
          position: "absolute", top: 10, left: 10, display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(5,8,12,.78)", padding: "5px 10px", borderRadius: 8, fontSize: 12, color: "#e7eef6", ...mono,
          maxWidth: "calc(100% - 180px)", overflow: "hidden",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 4, background: stateColor, flexShrink: 0,
            boxShadow: running ? `0 0 0 3px ${stateColor}33` : "none",
          }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cam.camera_id} · {cam.source}
          </span>
        </div>

        {/* top-right — minimal on canvas (options live in side tabs); full tools on card */}
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: isCanvas ? "40%" : "55%" }}>
          <span style={{
            background: "rgba(5,8,12,.78)", color: modeMeta.color === C.sub ? "#c5d0db" : modeMeta.color,
            fontSize: 11, fontWeight: 800, padding: "6px 10px", borderRadius: 8, textTransform: "uppercase",
            letterSpacing: 0.4, alignSelf: "center",
          }} title={modeMeta.hint}>
            {modeMeta.label}
          </span>
          {running && !isCanvas ? (
            <>
              <button
                type="button"
                onClick={() => setFs(true)}
                title="Fullscreen · play/pause · zoom"
                style={{
                  border: "none", background: "rgba(5,8,12,.78)", color: "#e7eef6", borderRadius: 8,
                  padding: "7px 12px", fontSize: 13, fontWeight: 800, cursor: "pointer",
                }}
              >
                ⛶ Expand
              </button>
              <button
                type="button"
                onClick={toggleTeach}
                title="Quick flip: hover a box → Flip → confirm."
                style={{
                  border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5,
                  fontWeight: 800, cursor: "pointer",
                  background: teachOn ? C.ok : "rgba(5,8,12,.78)",
                  color: teachOn ? "#fff" : "#8ee6b8",
                }}
              >
                {teachOn ? "◉ Teaching…" : "🎯 Quick flip"}
              </button>
              <button
                type="button"
                onClick={startFreeze}
                disabled={frozenSaving || Boolean(frozen)}
                title="Freeze this frame and label it"
                style={{
                  border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5,
                  fontWeight: 800, cursor: frozenSaving ? "wait" : "pointer",
                  background: "rgba(5,8,12,.78)", color: "#9ecbff",
                  opacity: frozenSaving ? 0.7 : 1,
                }}
              >
                {frozenSaving && !frozen ? "…" : "❄ Freeze"}
              </button>
              <button
                type="button"
                onClick={clipNow}
                disabled={clipping}
                title="Record a 30s clip"
                style={{
                  border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5,
                  fontWeight: 800, cursor: clipping ? "wait" : "pointer",
                  background: "rgba(5,8,12,.78)", color: "#ff9aa4",
                  opacity: clipping ? 0.7 : 1,
                }}
              >
                {clipping ? "…" : "● Clip"}
              </button>
              <button
                type="button"
                onClick={handleFlag}
                disabled={flagging}
                title="Send this frame to Review"
                style={{
                  border: "none", background: "rgba(255,255,255,.96)", color: C.warn, borderRadius: 8,
                  padding: "7px 12px", fontSize: 12.5, fontWeight: 800, cursor: flagging ? "wait" : "pointer",
                  opacity: flagging ? 0.7 : 1,
                }}
              >
                {flagging ? "…" : "⚑ Flag"}
              </button>
            </>
          ) : null}
          {running && isCanvas && teachOn ? (
            <span style={{
              background: C.ok, color: "#fff", fontSize: 11, fontWeight: 800,
              padding: "6px 10px", borderRadius: 8,
            }}>
              Teaching on — hover boxes
            </span>
          ) : null}
        </div>

        {running ? (
          <div style={{ position: "absolute", bottom: 10, right: 10, display: "flex", gap: 6, alignItems: "center" }}>
            {zoom > 1 ? (
              <span style={{
                background: "rgba(5,8,12,.78)", color: "#e7eef6", fontSize: 11, fontWeight: 700,
                padding: "4px 8px", borderRadius: 7, ...mono,
              }}>
                {zoom.toFixed(1)}×
              </span>
            ) : null}
            <button type="button" title="Zoom out" onClick={() => setZ(zoom - 0.5)} style={zbtn}>−</button>
            <button type="button" title="Zoom in" onClick={() => setZ(zoom + 0.5)} style={zbtn}>+</button>
            {zoom > 1 ? (
              <button type="button" title="Reset zoom" onClick={() => setZ(1)} style={{ ...zbtn, width: "auto", padding: "0 10px", fontSize: 12 }}>reset</button>
            ) : null}
          </div>
        ) : null}

        {running && imgOk ? (
          <span style={{
            position: "absolute", bottom: 10, left: 10, display: "inline-flex", alignItems: "center", gap: 5,
            background: "rgba(192,43,60,.9)", color: "#fff", fontSize: 11, fontWeight: 800,
            padding: "4px 9px", borderRadius: 6, letterSpacing: 0.6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C.panel }} /> LIVE
          </span>
        ) : null}
      </div>
      </div>{/* end video column */}

      {fs ? <FullscreenViewer cam={cam} onClose={() => setFs(false)} /> : null}

      {/* controls: side tab panel on canvas, stacked strip on card */}
      {isCanvas ? (
        <aside
          style={{
            width: "min(340px, 100%)",
            flex: "0 0 min(340px, 100%)",
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            boxShadow: C.shadow,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            maxHeight: "100%",
            overflow: "hidden",
          }}
        >
          <div
            role="tablist"
            aria-label="Camera options"
            style={{
              display: "flex", flexWrap: "wrap", gap: 4, padding: 8,
              borderBottom: `1px solid ${C.line}`, background: C.panel2,
            }}
          >
            {panelTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={panelTab === t.id}
                onClick={() => setPanelTab(t.id)}
                style={{
                  border: "none",
                  background: panelTab === t.id ? C.panel : "transparent",
                  color: panelTab === t.id ? C.brand : C.sub,
                  boxShadow: panelTab === t.id ? C.shadow : "none",
                  borderRadius: 8,
                  padding: "7px 11px",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ padding: 14, display: "grid", gap: 12, overflowY: "auto", flex: 1 }}>
            {panelTab === "live" ? (
              <>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.45 }}>
                  Full-page canvas. Use tabs for model, mode, PPE, and teach — the video stays clear.
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12, color: C.sub, ...mono, flexWrap: "wrap" }}>
                  <Stat label="frames" value={st.frames_read ?? 0} />
                  <Stat label="inferred" value={st.frames_inferred ?? 0} />
                  <Stat label="violations" value={st.violations_fired ?? 0} hot={(st.violations_fired ?? 0) > 0} />
                  <Stat label="harvested" value={st.captures_made ?? 0} good={(st.captures_made ?? 0) > 0} />
                  <Stat label="alerts" value={st.alerts_sent ?? 0} />
                </div>
                {teachMsg ? (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: teachMsg.startsWith("✓") ? C.ok : C.danger }}>
                    {teachMsg}
                  </div>
                ) : null}
              </>
            ) : null}

            {panelTab === "model" ? (
              <CompactModelSwitch
                onSay={(m, tone) => {
                  // surface on canvas side panel + keep brief
                  flash(tone === "danger" ? `✗ ${m}` : `✓ ${m}`);
                }}
              />
            ) : null}

            {panelTab === "mode" ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Detection mode
                </div>
                <ModePills value={cam.mode || "monitor"} onChange={(m) => onMode(cam.camera_id, m)} />
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.45 }}>
                  Monitor = detect + alert. Collect = also harvest frames for training. Strict = audit + eager alerts.
                </div>
              </>
            ) : null}

            {panelTab === "ppe" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Required PPE
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={togglePose}
                    disabled={posing}
                    title="Match gear to body keypoints instead of a fixed box slice"
                    style={{
                      border: `1px solid ${cam.pose_enabled ? C.ok : C.line}`,
                      background: cam.pose_enabled ? "#e6f6ef" : C.panel,
                      color: cam.pose_enabled ? C.ok : C.sub,
                      borderRadius: 8, padding: "4px 10px", fontSize: 11,
                      fontWeight: 800, cursor: posing ? "wait" : "pointer",
                    }}
                  >
                    {posing ? "…" : cam.pose_enabled ? "◉ Keypoints on" : "○ Keypoints off"}
                  </button>
                </div>
                <PpePicker
                  catalog={catalog}
                  value={cam.required_ppe || ["helmet", "vest"]}
                  onChange={(items) => onPpe?.(cam.camera_id, items)}
                />
              </>
            ) : null}

            {panelTab === "teach" ? (
              <>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.45 }}>
                  Correct the model on this canvas. Saved labels train later via <b>Train &amp; go live</b>.
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    type="button"
                    disabled={!running}
                    onClick={toggleTeach}
                    style={{
                      ...actionBtn,
                      background: teachOn ? C.okSoft : C.panel,
                      border: `1px solid ${teachOn ? C.ok : C.line}`,
                      color: teachOn ? C.ok : C.ink,
                      width: "100%",
                    }}
                  >
                    {teachOn ? "◉ Teaching on — click boxes on canvas" : "🎯 Quick flip on canvas"}
                  </button>
                  <button
                    type="button"
                    disabled={!running || frozenSaving || Boolean(frozen)}
                    onClick={startFreeze}
                    style={{ ...actionBtn, width: "100%", color: C.brand }}
                  >
                    {frozenSaving && !frozen ? "…" : "❄ Freeze & label"}
                  </button>
                  <button
                    type="button"
                    disabled={!running || flagging}
                    onClick={handleFlag}
                    style={{ ...actionBtn, width: "100%", color: C.warn }}
                  >
                    {flagging ? "…" : "⚑ Flag frame to Review"}
                  </button>
                  <button
                    type="button"
                    disabled={!running || clipping}
                    onClick={clipNow}
                    style={{ ...actionBtn, width: "100%", color: C.danger }}
                  >
                    {clipping ? "…" : "● Record 30s clip"}
                  </button>
                </div>
              </>
            ) : null}

            {panelTab === "manage" ? (
              <>
                <button
                  type="button"
                  onClick={() => onStartStop(cam.camera_id, running)}
                  style={{
                    ...actionBtn,
                    width: "100%",
                    border: `1px solid ${running ? "#f5c2c8" : "#b8e6d0"}`,
                    background: running ? C.dangerSoft : C.okSoft,
                    color: running ? C.danger : C.ok,
                  }}
                >
                  {running ? "Stop stream" : "Start stream"}
                </button>
                <button
                  type="button"
                  onClick={() => { onRemove(cam.camera_id); onBack?.(); }}
                  style={{ ...actionBtn, width: "100%", color: C.danger, border: `1px solid #f5c2c8` }}
                >
                  ✕ Remove camera
                </button>
                <div style={{ fontSize: 11.5, color: C.sub, ...mono, wordBreak: "break-all" }}>
                  id: {cam.camera_id}<br />
                  source: {cam.source}<br />
                  state: {cam.state}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      ) : (
        <div style={{ padding: "12px 14px 14px", display: "grid", gap: 10, background: C.panel, borderRadius: "0 0 14px 14px", borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap" }}>
            <ModePills value={cam.mode || "monitor"} onChange={(m) => onMode(cam.camera_id, m)} />
            <button
              type="button"
              onClick={() => onStartStop(cam.camera_id, running)}
              style={{
                ...actionBtn,
                border: `1px solid ${running ? "#f5c2c8" : "#b8e6d0"}`,
                background: running ? C.dangerSoft : C.okSoft,
                color: running ? C.danger : C.ok,
                minWidth: 88,
              }}
            >
              {running ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              onClick={() => onRemove(cam.camera_id)}
              title="Remove camera"
              style={{ ...actionBtn, color: C.sub, minWidth: 44 }}
            >
              ✕
            </button>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Required PPE · live Found / Not found
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={togglePose}
                disabled={posing}
                title="Keypoints matching for body parts"
                style={{
                  border: `1px solid ${cam.pose_enabled ? C.ok : C.line}`,
                  background: cam.pose_enabled ? "#e6f6ef" : C.panel,
                  color: cam.pose_enabled ? C.ok : C.sub,
                  borderRadius: 8, padding: "4px 10px", fontSize: 11,
                  fontWeight: 800, cursor: posing ? "wait" : "pointer",
                  opacity: posing ? 0.6 : 1, whiteSpace: "nowrap",
                }}
              >
                {posing ? "…" : cam.pose_enabled ? "◉ Keypoints on" : "○ Keypoints off"}
              </button>
            </div>
            <PpePicker
              catalog={catalog}
              value={cam.required_ppe || ["helmet", "vest"]}
              onChange={(items) => onPpe?.(cam.camera_id, items)}
            />
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.sub, ...mono, flexWrap: "wrap" }}>
            <Stat label="frames" value={st.frames_read ?? 0} />
            <Stat label="inferred" value={st.frames_inferred ?? 0} />
            <Stat label="violations" value={st.violations_fired ?? 0} hot={(st.violations_fired ?? 0) > 0} />
            <Stat label="harvested" value={st.captures_made ?? 0} good={(st.captures_made ?? 0) > 0} />
            <Stat label="alerts" value={st.alerts_sent ?? 0} />
          </div>
        </div>
      )}

      {frozen ? (
        <FreezeTeachModal
          cameraId={cam.camera_id}
          frozen={frozen}
          boxes={frozenBoxes}
          setBoxes={setFrozenBoxes}
          saving={frozenSaving}
          onSave={saveFreeze}
          onClose={closeFreeze}
        />
      ) : null}
    </article>
  );
}

/* --------------------------------------------------- freeze & label editor */
/**
 * The full teach editor over one held frame.
 *
 * Rendered as a fixed overlay rather than inside the camera card because
 * labelling needs room: drawing a glove box on a 300 px thumbnail is a
 * coordinate guess, and a guessed box is worse training data than no box.
 */
function FreezeTeachModal({ cameraId, frozen, boxes, setBoxes, saving, onSave, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const original = (frozen.boxes || []).filter((b) => b.known).length;
  const added = boxes.filter((b) => b.added).length;
  const changed = boxes.filter((b) => b.edited && !b.added).length;
  const deleted = Math.max(0, original - boxes.filter((b) => !b.added).length);

  return (
    <div
      role="dialog"
      aria-label={`Freeze and label ${cameraId}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,7,11,.86)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)", maxHeight: "94vh", overflowY: "auto",
          background: "#0e141b", border: "1px solid #24313f", borderRadius: 14,
          padding: 16, boxShadow: "0 24px 70px rgba(0,0,0,.6)", color: "#e7eef6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>
            ❄ Freeze &amp; label — <span style={mono}>{cameraId}</span>
          </span>
          <span style={{ fontSize: 11, color: "#7a8fa3", ...mono }}>
            frame #{frozen.frame_id} · {frozen.width}×{frozen.height}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={{
            border: "1px solid rgba(255,255,255,.18)", background: "transparent",
            color: "#c5d0db", borderRadius: 8, padding: "6px 12px",
            fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          }}>
            ✕ Close (Esc)
          </button>
        </div>

        <p style={{ margin: "0 0 11px", fontSize: 12.5, color: "#9bb0c3", lineHeight: 1.55 }}>
          This frame is held on the server, so the camera can keep running
          without the picture moving under you. Fix everything that is wrong,
          then save once — what you leave on the image <i>is</i> the label, so a
          box you delete teaches the model there is nothing there.
        </p>

        <TeachCanvas
          onVideoOverlay
          imgUrl={`${API_BASE}${frozen.image_url}`}
          width={frozen.width}
          height={frozen.height}
          boxes={boxes}
          setBoxes={setBoxes}
          palette={frozen.display_names || {}}
          classes={frozen.classes || []}
        />

        <div style={{ display: "flex", gap: 9, marginTop: 13, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button" onClick={onSave} disabled={saving || !boxes.length}
            style={{
              border: "none", borderRadius: 9, padding: "10px 16px", fontSize: 13,
              fontWeight: 800, background: "#1256d1", color: "#fff",
              cursor: saving || !boxes.length ? "not-allowed" : "pointer",
              opacity: saving || !boxes.length ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : `✓ Save ${boxes.length} label${boxes.length === 1 ? "" : "s"}`}
          </button>
          <span style={{ fontSize: 11.5, color: "#7a8fa3" }}>
            {added} added · {changed} changed · {deleted} deleted
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "#7a8fa3" }}>
            Saved labels train the model only when you run <b style={{ color: "#c5d0db" }}>Train &amp; go live</b> in Review.
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hot, good }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <b style={{
        color: hot ? C.danger : good ? C.ok : C.ink,
        fontWeight: hot || good ? 800 : 600,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </b>
    </span>
  );
}

/* ------------------------------------------------------------ Train now
   Closes the loop the CLI used to break: export -> fine-tune -> evaluate ->
   activate, in-process. On success the backend copies the checkpoint over
   ppe_active.pt and hot-reloads the shared detector, so running cameras use
   the new model on their next frame — no restart, no file copying. */
function TrainPanel({ onTrained }) {
  const [status, setStatus] = useState(null);
  const [epochs, setEpochs] = useState(40);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(
    () => api("/api/training/status").then(setStatus).catch(() => setStatus(null)),
    [],
  );
  useEffect(() => { load(); }, [load]);

  const job = status?.job;
  const running = Boolean(status?.busy);

  // Poll only while a job is live; training runs for minutes, and a idle
  // dashboard hammering the API buys nothing.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load]);

  // One refresh of the model list when a run finishes, so the new version and
  // its ACTIVE badge appear without the operator reloading the page.
  const doneRef = useRef(null);
  useEffect(() => {
    if (!job || running) return;
    if (job.state === "done" && doneRef.current !== job.job_id) {
      doneRef.current = job.job_id;
      onTrained?.();
    }
  }, [job, running, onTrained]);

  const data = status?.data;
  const start = async () => {
    setStarting(true);
    setErr("");
    try {
      await api("/api/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epochs: Number(epochs) || 40 }),
      });
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    try { await api("/api/training/cancel", { method: "POST" }); await load(); }
    catch (e) { setErr(String(e.message || e)); }
  };

  const pct = Math.round(((job?.progress || 0) * 100));
  const tone = job?.state === "failed" ? C.danger
    : job?.state === "done" ? C.ok : C.brand;

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: C.shadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.8, color: C.sub, fontWeight: 800, textTransform: "uppercase" }}>
          Train on your labels
        </span>
        {data ? <Pill tone={data.ready ? "ok" : "mute"}>{data.trainable_images} frames</Pill> : null}
        <span style={{ flex: 1 }} />
        {running ? <Pill tone="brand">{job?.state}</Pill> : null}
      </div>

      {!running ? (
        <>
          <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5, marginBottom: 10 }}>
            {data?.hint || "Checking labeled data…"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: C.sub }}>
              Epochs{" "}
              <input
                type="number"
                min={1}
                max={500}
                value={epochs}
                onChange={(e) => setEpochs(e.target.value)}
                style={{
                  width: 68, padding: "5px 7px", borderRadius: 7, fontSize: 12,
                  border: `1px solid ${C.line}`, background: C.panel2, color: C.ink,
                }}
              />
            </label>
            <button
              type="button"
              onClick={start}
              disabled={starting || !data?.ready}
              style={{
                border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5,
                fontWeight: 800, color: "#fff", background: C.brand,
                cursor: starting || !data?.ready ? "not-allowed" : "pointer",
                opacity: starting || !data?.ready ? 0.5 : 1,
              }}
            >
              {starting ? "Starting…" : "Train & go live"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.ink, marginBottom: 8 }}>
            {job?.step || "working…"}
          </div>
          <div style={{ height: 7, borderRadius: 999, background: C.panel2, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: tone, transition: "width .4s ease" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ ...mono, fontSize: 11, color: C.sub }}>
              {pct}% · {job?.elapsed_s ?? 0}s elapsed
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={cancel}
              style={{
                border: `1px solid ${C.line}`, background: C.panel, color: C.danger,
                borderRadius: 7, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {job && !running && job.state !== "queued" ? (
        <div style={{
          marginTop: 10, padding: "8px 10px", borderRadius: 9, fontSize: 12,
          background: job.state === "failed" ? C.dangerSoft : C.panel2,
          border: `1px solid ${C.line}`, color: job.state === "failed" ? C.danger : C.ink,
          lineHeight: 1.5,
        }}>
          {job.state === "failed" ? (
            job.error
          ) : (
            <>
              <b>{job.activated ? "Live now" : "Trained"}</b>
              {job.registered_version ? ` — model v${job.registered_version}` : ""}
              {job.metrics?.map50 != null ? ` · mAP50 ${job.metrics.map50}` : ""}
              {job.metrics?.recall != null ? ` · recall ${job.metrics.recall}` : ""}
              {job.promoted_reason ? (
                <div style={{ color: C.sub, marginTop: 3 }}>{job.promoted_reason}</div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 8, fontSize: 12, color: C.danger }}>{err}</div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- Versions */
function ModelsPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api("/api/models").then(setData).catch(() => setData({ versions: [], active: null })), []);
  useEffect(() => { load(); }, [load]);
  const act = async (path) => {
    setBusy(true);
    try { await api(path, { method: "POST" }); await load(); }
    catch (e) { alert(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const n = data?.versions?.length || 0;
  return (
    <div style={{ display: "grid", gap: 12 }}>
    <TrainPanel onTrained={load} />
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: C.shadow }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          border: "none", background: "transparent", padding: 0, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: 0.8, color: C.sub, fontWeight: 800, textTransform: "uppercase" }}>
          Model versions — self-training history
        </span>
        <Pill tone="mute">{n}</Pill>
        <span style={{ flex: 1 }} />
        <span style={{ color: C.sub, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {(data?.versions || []).map((v) => (
            <div
              key={v.version}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9,
                background: v.is_active ? C.brandSoft : C.panel2, border: `1px solid ${C.line}`, fontSize: 12,
              }}
            >
              <b style={{ ...mono, color: v.is_active ? C.brand : C.ink }}>v{v.version}</b>
              <span style={{ color: C.sub, ...mono }}>{v.created}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.note || v.weights.split(/[\\/]/).pop()}
              </span>
              {!v.on_disk ? <span style={{ color: C.danger, fontSize: 11 }}>missing on disk</span> : null}
              {v.is_active ? (
                <Pill tone="ok">ACTIVE</Pill>
              ) : (
                <button
                  type="button"
                  disabled={busy || !v.on_disk}
                  onClick={() => act(`/api/models/${v.version}/activate`)}
                  style={{
                    border: `1px solid ${C.line}`, background: C.panel, color: C.ok, borderRadius: 7,
                    padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Activate
                </button>
              )}
            </div>
          ))}
          {!n ? (
            <div style={{ color: C.sub, fontSize: 12, padding: "6px 2px", lineHeight: 1.5 }}>
              No trained versions yet. Put cameras in <b>Collect</b> mode, correct the frames in{" "}
              <b>Review &amp; Teach</b>, then press <b>Train &amp; go live</b> above.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
    </div>
  );
}

/* ---------------------------------------------------------------- KPI strip */
function KpiStrip({ cams, onNavigate }) {
  const running = cams.filter((c) => c.state === "running").length;
  const errors = cams.filter((c) => c.state === "error").length;
  const violations = cams.reduce((s, c) => s + (c.stats?.violations_fired || 0), 0);
  const harvested = cams.reduce((s, c) => s + (c.stats?.captures_made || 0), 0);
  const collect = cams.filter((c) => c.mode === "collect" || c.mode === "strict").length;
  const inferred = cams.reduce((s, c) => s + (c.stats?.frames_inferred || 0), 0);

  const cards = [
    { label: "Running", value: `${running}/${cams.length}`, tone: running ? "ok" : "mute" },
    { label: "Errors", value: String(errors), tone: errors ? "danger" : "mute" },
    { label: "Violations", value: String(violations), tone: violations ? "danger" : "mute", go: "alerts" },
    { label: "Inferred", value: String(inferred), tone: inferred ? "brand" : "mute" },
    { label: "Harvested", value: String(harvested), tone: harvested ? "ok" : "mute", go: "review" },
    { label: "Self-train", value: collect ? `${collect} cam` : "off", tone: collect ? "ok" : "mute" },
  ];

  const toneMap = {
    ok: { fg: C.ok, bg: C.okSoft },
    danger: { fg: C.danger, bg: C.dangerSoft },
    brand: { fg: C.brand, bg: C.brandSoft },
    mute: { fg: C.ink, bg: C.panel },
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 10 }}>
      {cards.map((c) => {
        const t = toneMap[c.tone] || toneMap.mute;
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => c.go && onNavigate?.(c.go)}
            disabled={!c.go}
            style={{
              background: t.bg,
              border: `1px solid ${C.line}`,
              borderRadius: 11,
              padding: "12px 14px",
              textAlign: "left",
              cursor: c.go ? "pointer" : "default",
              boxShadow: C.shadow,
              fontFamily: "inherit",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.55 }}>
              {c.label}{c.go ? " →" : ""}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800, color: t.fg, marginTop: 3,
              fontVariantNumeric: "tabular-nums", fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            }}>
              {c.value}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Empty state */
function EmptyState({ onQuickWebcam, onQuickVideo, onOpenAdd }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.line}`,
        borderRadius: 16,
        background: C.panel,
        padding: "40px 28px",
        textAlign: "center",
        boxShadow: C.shadow,
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px",
        background: C.brandSoft, color: C.brand, display: "grid", placeItems: "center", fontSize: 26, fontWeight: 800,
      }}>
        ◎
      </div>
      <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800 }}>No camera sources yet</h2>
      <p style={{ margin: "0 auto 18px", maxWidth: 420, color: C.sub, fontSize: 13.5, lineHeight: 1.5 }}>
        Pick an AI model above, then add a feed. Start with a webcam or upload a demo clip — no CCTV required.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onQuickWebcam}
          style={{
            border: "none", background: C.brand, color: "#fff", borderRadius: 10,
            padding: "10px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer",
          }}
        >
          📷 Start webcam
        </button>
        <button
          type="button"
          onClick={onQuickVideo}
          style={{
            border: `1px solid ${C.line}`, background: C.panel, color: C.ink, borderRadius: 10,
            padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          🎬 Upload video demo
        </button>
        <button
          type="button"
          onClick={onOpenAdd}
          style={{
            border: `1px solid ${C.line}`, background: C.panel2, color: C.sub, borderRadius: 10,
            padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          More sources…
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Root */
export default function PPEControlRoom({ embedded = false, onNavigate }) {
  const [cams, setCams] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false); // model / train / notes drawer
  const [focusId, setFocusId] = useState(null); // full-page canvas for one camera
  const [density, setDensity] = useState("comfortable"); // large | comfortable | compact
  const [catalog, setCatalog] = useState([]);
  const [defaultPpe, setDefaultPpe] = useState(["helmet", "vest"]);
  const [stockNote, setStockNote] = useState("");
  const [browserCropId, setBrowserCropId] = useState(null);
  const timer = useRef(null);
  const videoQuickRef = useRef(null);

  const say = (m, tone = "brand") => {
    setToast({ msg: m, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(() => {
    api("/api/cameras")
      .then((data) => { setCams(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api("/api/cameras/meta/ppe-catalog")
      .then((z) => {
        setCatalog(z.catalog || []);
        if (z.defaults?.length) setDefaultPpe(z.defaults);
        if (z.stock_model_note) setStockNote(z.stock_model_note);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loaded && cams.length === 0) setAddOpen(true);
  }, [loaded, cams.length]);

  const onAdd = async (payload) => {
    try {
      await api("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          required_ppe: payload.required_ppe?.length ? payload.required_ppe : defaultPpe,
        }),
      });
      await api(`/api/cameras/${encodeURIComponent(payload.camera_id)}/start`, { method: "POST" });
      say(
        payload.source_kind === "browser"
          ? `Camera ${payload.camera_id} ready — share tab & crop below`
          : `Camera ${payload.camera_id} started`,
        "ok",
      );
      setAddOpen(false);
      if (payload.source_kind !== "browser") {
        setFocusId(payload.camera_id);
      }
      refresh();
      return true;
    } catch (e) {
      say(`Add failed: ${e.message}`, "danger");
      throw e;
    }
  };

  const onAddVideo = async (file, camera_id, loop, speed, ppeList, fpsLimit = 10) => {
    say("Uploading clip & starting the pipeline…", "brand");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("camera_id", camera_id);
      fd.append("loop", String(loop));
      fd.append("speed", speed || "normal");
      fd.append("required_ppe", (ppeList || defaultPpe).join(","));
      fd.append("fps_limit", String(Math.max(1, Number(fpsLimit) || 10)));
      // Long timeout path: large clips; use raw fetch so we can show better errors
      const r = await fetch(buildPpeUrl("/api/cameras/upload-video"), { method: "POST", body: fd });
      const t = await r.text();
      let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
      if (!r.ok) throw new Error(body.detail || `Upload HTTP ${r.status}`);
      say(`Demo “${body.camera_id}” running (${speed || "normal"})`, "ok");
      refresh();
    } catch (e) {
      const msg = e?.message || String(e);
      say(
        msg.includes("Failed to fetch") || msg.includes("NetworkError")
          ? "Upload failed: network error. Wait until the AI model shows LIVE (HF download finished), then retry. PPE must be on :8004."
          : `Upload failed: ${msg}`,
        "danger",
      );
    }
  };

  const onPpe = async (id, items) => {
    // optimistic
    setCams((xs) => xs.map((c) => (c.camera_id === id ? { ...c, required_ppe: items } : c)));
    try {
      await api(`/api/cameras/${encodeURIComponent(id)}/required-ppe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ required_ppe: items }),
      });
      say(`${id} PPE → ${items.join(", ")}`, "ok");
    } catch (e) {
      say(`PPE config failed: ${e.message}`, "danger");
      refresh();
    }
  };

  const onMode = async (id, mode) => {
    try {
      await api(`/api/cameras/${encodeURIComponent(id)}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      say(`${id} → ${mode.toUpperCase()}${mode === "collect" ? " (self-training on)" : ""}`, "ok");
      refresh();
    } catch (e) {
      say(`Mode failed: ${e.message}`, "danger");
    }
  };

  const onFlag = async (id) => {
    try {
      const r = await api(`/api/cameras/${encodeURIComponent(id)}/flag`, { method: "POST" });
      say(`Frame sent to review queue (#${String(r.capture_id).slice(0, 8)})`, "ok");
    } catch (e) {
      say(`Flag failed: ${e.message}`, "danger");
    }
  };

  const onStartStop = async (id, running) => {
    try {
      await api(`/api/cameras/${encodeURIComponent(id)}/${running ? "stop" : "start"}`, { method: "POST" });
      say(running ? `${id} stopped` : `${id} started`, "ok");
      refresh();
    } catch (e) {
      say(String(e.message), "danger");
    }
  };

  const onRemove = async (id) => {
    if (!window.confirm(`Remove camera “${id}”? This stops the feed and deletes the source.`)) return;
    try {
      await api(`/api/cameras/${encodeURIComponent(id)}`, { method: "DELETE" });
      say(`Removed ${id}`, "ok");
      refresh();
    } catch (e) {
      say(String(e.message), "danger");
    }
  };

  const quickWebcam = () => onAdd({
    camera_id: `webcam-${Date.now() % 10000}`,
    source_kind: "webcam",
    source_kwargs: { index: 0, fps: 15 },
    required_ppe: defaultPpe,
    fps_limit: 10,
  });

  // Grid density for camera tiles (click → full canvas)
  const gridMin = density === "compact" ? 240 : density === "comfortable" ? 300 : 420;
  const toastTone = {
    brand: C.brand, ok: C.ok, warn: C.warn, danger: C.danger,
  };
  const focusCam = focusId ? cams.find((c) => c.camera_id === focusId) : null;

  // Drop focus if the camera was removed
  useEffect(() => {
    if (focusId && loaded && cams.length && !cams.some((c) => c.camera_id === focusId)) {
      setFocusId(null);
    }
  }, [focusId, cams, loaded]);

  // Esc from canvas → grid
  useEffect(() => {
    if (!focusId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) setFocusId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId]);

  return (
    <div
      style={{
        background: embedded ? "transparent" : C.bg,
        minHeight: embedded ? undefined : "100vh",
        color: C.ink,
        padding: focusCam ? (embedded ? "10px 14px 24px" : "12px 16px 28px") : (embedded ? "14px 20px 48px" : "20px 24px 60px"),
        fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, sans-serif",
        overflow: "visible",
      }}
    >
      {/* -------- Full-page canvas for one camera -------- */}
      {focusCam ? (
        <CameraCard
          key={`focus-${focusCam.camera_id}`}
          cam={focusCam}
          layout="canvas"
          catalog={catalog}
          onMode={onMode}
          onFlag={onFlag}
          onStartStop={onStartStop}
          onRemove={onRemove}
          onPpe={onPpe}
          onBack={() => setFocusId(null)}
        />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: embedded ? 15 : 18, fontWeight: 800, letterSpacing: -0.2 }}>
                {embedded ? "Live cameras" : "PPE Control Room"}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.sub }}>
                Click a camera for full-page canvas · options in tabs
              </p>
            </div>
            <span style={{ flex: 1 }} />
            {cams.length > 0 ? (
              <div
                role="group"
                aria-label="Grid density"
                style={{
                  display: "inline-flex",
                  background: C.panel,
                  border: `1px solid ${C.line}`,
                  borderRadius: 9,
                  padding: 3,
                  boxShadow: C.shadow,
                }}
              >
                {[
                  { id: "large", label: "Large" },
                  { id: "comfortable", label: "Grid" },
                  { id: "compact", label: "Wall" },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDensity(d.id)}
                    style={{
                      border: "none",
                      background: density === d.id ? C.brandSoft : "transparent",
                      color: density === d.id ? C.brand : C.sub,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: density === d.id ? `inset 0 0 0 1px ${C.brand}` : "none",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              style={{
                border: "none",
                background: C.brand,
                color: "#fff",
                borderRadius: 9,
                padding: "8px 14px",
                fontSize: 12.5,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {addOpen ? "Close add" : "+ Add camera"}
            </button>
            <button
              type="button"
              onClick={() => setSetupOpen((o) => !o)}
              style={{
                border: `1px solid ${C.line}`,
                background: setupOpen ? C.brandSoft : C.panel,
                color: setupOpen ? C.brand : C.sub,
                borderRadius: 9,
                padding: "8px 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {setupOpen ? "Hide setup" : "Model & train"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 12, overflow: "visible" }}>
            {addOpen || !cams.length ? (
              <AddSource
                open={addOpen || !cams.length}
                onOpenChange={setAddOpen}
                onAdd={onAdd}
                onAddVideo={onAddVideo}
                catalog={catalog}
                defaultPpe={defaultPpe}
                onBrowserReady={(camId) => {
                  setBrowserCropId(camId);
                  setFocusId(camId);
                }}
              />
            ) : null}

            {browserCropId ? (
              <BrowserCropSource
                cameraId={browserCropId}
                fps={6}
                onClose={() => setBrowserCropId(null)}
                onLive={() => refresh()}
              />
            ) : null}

            {setupOpen ? (
              <div style={{ display: "grid", gap: 12 }}>
                <ModelBar say={say} />
                {stockNote ? (
                  <div style={{
                    fontSize: 12, color: C.sub, background: C.warnSoft, border: "1px solid #f0d4a8",
                    borderRadius: 10, padding: "8px 12px", lineHeight: 1.45,
                  }}>
                    <b style={{ color: C.warn }}>PPE dataset:</b> {stockNote}
                  </div>
                ) : null}
                <ModelsPanel />
              </div>
            ) : null}

            {!loaded ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${gridMin}px), 1fr))`,
                gap: 14,
              }}>
                <div style={{
                  background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
                  minHeight: 200, animation: "ppe-shimmer 1.4s ease infinite",
                  backgroundImage: "linear-gradient(90deg, #f4f6f9 0%, #eef1f5 50%, #f4f6f9 100%)",
                  backgroundSize: "200% 100%",
                }} />
              </div>
            ) : cams.length ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${gridMin}px), 1fr))`,
                gap: 14,
              }}>
                {cams.map((cam) => (
                  <CameraCard
                    key={cam.camera_id}
                    cam={cam}
                    layout="tile"
                    catalog={catalog}
                    onMode={onMode}
                    onFlag={onFlag}
                    onStartStop={onStartStop}
                    onRemove={onRemove}
                    onPpe={onPpe}
                    onOpen={(id) => setFocusId(id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                onQuickWebcam={quickWebcam}
                onQuickVideo={() => videoQuickRef.current?.click()}
                onOpenAdd={() => setAddOpen(true)}
              />
            )}
          </div>
        </>
      )}

      <input
        ref={videoQuickRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onAddVideo(f, "demo", true, "normal");
          e.target.value = "";
        }}
      />

      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.ink,
            color: "#fff",
            padding: "11px 20px",
            borderRadius: 11,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 10px 40px rgba(0,0,0,.22)",
            borderLeft: `3px solid ${toastTone[toast.tone] || C.brand}`,
            zIndex: 50,
            maxWidth: "min(520px, 92vw)",
          }}
        >
          {toast.msg}
        </div>
      ) : null}

      <style>{`
        @keyframes ppe-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 900px) {
          /* stack canvas + tabs on narrow screens */
        }
      `}</style>
    </div>
  );
}
