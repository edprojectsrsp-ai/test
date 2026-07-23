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

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path, options) {
  let r;
  try {
    r = await fetch(`${API_BASE}${path}`, options);
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(
      `Network error talking to PPE service (${API_BASE}${path}): ${msg}. `
      + "If you just selected a new model (nduka / Hexmon), wait until it shows LIVE — "
      + "first download is 40–50 MB from Hugging Face. Keep the PPE service running on :8004.",
    );
  }
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) {
    const detail = typeof body.detail === "string" ? body.detail
      : body.detail ? JSON.stringify(body.detail) : `${r.status} ${r.statusText}`;
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
  ip: "IP/CCTV by brand — enter IP, login & channel; the RTSP URL is built for you (Hikvision, Dahua, CP Plus, Uniview, Axis…).",
  onvif: "Auto-resolve the stream over ONVIF, or Discover cameras on the LAN.",
  webcam: "Use the laptop/USB camera for a quick local test.",
  rtsp: "Paste a full RTSP/DVR stream URL (rtsp://user:pass@ip:554/…).",
  screen: "Capture a region of the desktop (e.g. DVR viewer window).",
  video: "Upload a clip — full pipeline runs without a physical camera.",
  fake: "Synthetic frames for wiring checks only.",
};

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
function ModelPicker({ models, activeKey, busy, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const active = models.find((m) => m.key === activeKey);

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
              No models returned. Is the PPE backend running?
            </div>
          ) : (
            models.map((m) => {
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
                    {isActive ? <Pill tone="ok">LIVE</Pill> : null}
                    {disabled ? <Pill tone="mute">unavailable</Pill> : null}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3, lineHeight: 1.35 }}>
                    {m.kind === "pretrained" && !m.downloaded && m.url
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
    const heavy = !m.downloaded && (key === "nduka1999" || key === "hexmon-vyra");
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
        <ModelPicker models={models} activeKey={activeKey} busy={busy} onPick={onPick} />
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
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.danger, background: C.dangerSoft, padding: "8px 10px", borderRadius: 8 }}>
          Model list error: {loadErr}
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
function AddSource({ onAdd, onAddVideo, open: openProp, onOpenChange, catalog, defaultPpe }) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp != null ? openProp : openLocal;
  const setOpen = (v) => {
    const next = typeof v === "function" ? v(open) : v;
    if (onOpenChange) onOpenChange(next);
    else setOpenLocal(next);
  };
  const [kind, setKind] = useState("ip");
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [index, setIndex] = useState("0");
  const [region, setRegion] = useState("0,0,1280,720");
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState("normal");
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
    if (kind === "webcam") return { source_kind: "webcam", source_kwargs: { index: Number(index) || 0 } };
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
    const camera_id = id.trim() || `${kind}-${Date.now() % 10000}`;
    try {
      const cfg = await buildConfig();
      onAdd({ camera_id, source_kind: cfg.source_kind, source_kwargs: cfg.source_kwargs, required_ppe: ppe });
      setId(""); setTestResult(null);
    } catch (e) {
      setTestResult({ ok: false, error: e.message || String(e) });
    }
  };
  const onVideo = (e) => {
    const f = e.target.files?.[0];
    if (f) onAddVideo(f, id.trim() || "demo", loop, speed, ppe);
    e.target.value = "";
    setId("");
  };

  const inp = { background: C.panel, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: "8px 10px", fontSize: 12.5 };
  const lbl = { fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" };
  const field = (label, node) => (<label style={{ display: "block" }}><span style={lbl}>{label}</span>{node}</label>);
  const missingReq =
    (kind === "ip" && !host.trim()) ||
    (kind === "onvif" && !host.trim()) ||
    (kind === "rtsp" && !url.trim());
  const canTest = kind !== "video" && kind !== "fake" && !missingReq;

  const kinds = [
    { id: "ip", label: "IP Camera", icon: "📡" },
    { id: "onvif", label: "ONVIF", icon: "🔎" },
    { id: "webcam", label: "Webcam", icon: "📷" },
    { id: "rtsp", label: "RTSP URL", icon: "🔗" },
    { id: "video", label: "Upload video", icon: "🎬" },
    { id: "screen", label: "Screen", icon: "🖥" },
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
        <span style={{ color: C.sub, fontSize: 12.5 }}>IP/CCTV by brand · ONVIF · webcam · RTSP · video · screen</span>
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
            {kind === "webcam" ? (
              <label style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                Device index
                <input value={index} onChange={(e) => setIndex(e.target.value)} style={{ ...inp, width: 56 }} />
              </label>
            ) : null}
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
              disabled={missingReq}
              style={{
                border: "none",
                background: missingReq ? "#9bb6e8" : C.brand,
                color: "#fff",
                borderRadius: 9,
                padding: "9px 18px",
                fontSize: 12.5,
                fontWeight: 800,
                cursor: missingReq ? "not-allowed" : "pointer",
              }}
            >
              {kind === "video" ? "Choose & run" : "Add & start"}
            </button>
          </div>

          {testResult ? (
            <div style={{
              fontSize: 12.5, borderRadius: 9, padding: "9px 12px",
              background: testResult.ok ? C.okSoft : C.dangerSoft,
              color: testResult.ok ? C.ok : C.danger,
              border: `1px solid ${testResult.ok ? "#b8e6d0" : "#f5c2c8"}`,
            }}>
              {testResult.ok ? (
                <span>✓ Connected — {testResult.width}×{testResult.height}, first frame in {testResult.latency_ms} ms.{testResult.display ? <span style={{ ...mono, color: C.sub }}> {testResult.display}</span> : null}</span>
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
function CameraCard({ cam, onMode, onFlag, onStartStop, onRemove, onPpe, catalog, large = false }) {
  const [fs, setFs] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imgOk, setImgOk] = useState(true);
  const [flagging, setFlagging] = useState(false);
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
  const onDown = (e) => { if (zoom <= 1) return; drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; };
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

  return (
    <article
      style={{
        background: C.panel,
        border: `1px solid ${cam.state === "error" ? "#f5c2c8" : C.line}`,
        borderRadius: 14,
        overflow: "visible",
        boxShadow: C.shadow,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      {/* video only clips; controls stay fully visible below */}
      <div
        style={{
          position: "relative",
          width: "100%",
          /* large single-monitor view */
          minHeight: large ? "min(68vh, 720px)" : "min(42vh, 420px)",
          height: large ? "min(68vh, 720px)" : undefined,
          aspectRatio: large ? undefined : "16 / 10",
          background: "#0b0f14",
          overflow: "hidden",
          borderRadius: "14px 14px 0 0",
        }}
        onWheel={onWheel}
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

        {/* top-right actions — always visible, not overlapping mode label */}
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}>
          <span style={{
            background: "rgba(5,8,12,.78)", color: modeMeta.color === C.sub ? "#c5d0db" : modeMeta.color,
            fontSize: 11, fontWeight: 800, padding: "6px 10px", borderRadius: 8, textTransform: "uppercase",
            letterSpacing: 0.4, alignSelf: "center",
          }} title={modeMeta.hint}>
            {modeMeta.label}
          </span>
          {running ? (
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
                onClick={handleFlag}
                disabled={flagging}
                title="Send this frame to the Review & Teach queue"
                style={{
                  border: "none", background: "rgba(255,255,255,.96)", color: C.warn, borderRadius: 8,
                  padding: "7px 12px", fontSize: 12.5, fontWeight: 800, cursor: flagging ? "wait" : "pointer",
                  opacity: flagging ? 0.7 : 1,
                }}
              >
                {flagging ? "…" : "⚑ Teach"}
              </button>
            </>
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

      {fs ? <FullscreenViewer cam={cam} onClose={() => setFs(false)} /> : null}

      {/* controls — full width, never clipped */}
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
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            Required PPE · live Found / Not found
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
    </article>
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
              No trained versions yet. Put cameras in <b>Collect</b> mode, label frames in Review & Teach, then run{" "}
              <span style={mono}>build-dataset → train → register</span>.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- KPI strip */
function KpiStrip({ cams, onNavigate }) {
  const running = cams.filter((c) => c.state === "running").length;
  const errors = cams.filter((c) => c.state === "error").length;
  const violations = cams.reduce((s, c) => s + (c.stats?.violations_fired || 0), 0);
  const harvested = cams.reduce((s, c) => s + (c.stats?.captures_made || 0), 0);
  const collect = cams.filter((c) => c.mode === "collect" || c.mode === "strict").length;

  const cards = [
    { label: "Running", value: `${running}/${cams.length}`, tone: running ? "ok" : "mute" },
    { label: "Errors", value: String(errors), tone: errors ? "danger" : "mute" },
    { label: "Violations", value: String(violations), tone: violations ? "danger" : "mute", go: "alerts" },
    { label: "Harvested", value: String(harvested), tone: harvested ? "ok" : "mute", go: "review" },
    { label: "Self-train", value: collect ? `${collect} cam` : "off", tone: collect ? "ok" : "mute" },
  ];

  const toneMap = {
    ok: { fg: C.ok, bg: C.okSoft },
    danger: { fg: C.danger, bg: C.dangerSoft },
    mute: { fg: C.ink, bg: C.panel },
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
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
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "left",
              cursor: c.go ? "pointer" : "default",
              boxShadow: C.shadow,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {c.label}{c.go ? " →" : ""}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.fg, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
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
  const [density, setDensity] = useState("large"); // large | comfortable | compact
  const [catalog, setCatalog] = useState([]);
  const [defaultPpe, setDefaultPpe] = useState(["helmet", "vest"]);
  const [stockNote, setStockNote] = useState("");
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
      say(`Camera ${payload.camera_id} started`, "ok");
      refresh();
    } catch (e) {
      say(`Add failed: ${e.message}`, "danger");
    }
  };

  const onAddVideo = async (file, camera_id, loop, speed, ppeList) => {
    say("Uploading clip & starting the pipeline…", "brand");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("camera_id", camera_id);
      fd.append("loop", String(loop));
      fd.append("speed", speed || "normal");
      fd.append("required_ppe", (ppeList || defaultPpe).join(","));
      // Long timeout path: large clips; use raw fetch so we can show better errors
      const r = await fetch(`${API_BASE}/api/cameras/upload-video`, { method: "POST", body: fd });
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
    source_kwargs: { index: 0 },
    required_ppe: defaultPpe,
  });

  // Prefer one large monitor; multi-cam still roomy
  const single = cams.length === 1;
  const gridMin = density === "compact" ? 320 : density === "comfortable" ? 480 : 640;
  const useLargeCard = density === "large" || single;
  const toastTone = {
    brand: C.brand, ok: C.ok, warn: C.warn, danger: C.danger,
  };

  return (
    <div
      style={{
        background: embedded ? "transparent" : C.bg,
        minHeight: embedded ? undefined : "100vh",
        color: C.ink,
        padding: embedded ? "14px 20px 48px" : "20px 24px 60px",
        fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, sans-serif",
        overflow: "visible",
      }}
    >
      {!embedded ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: -0.3, fontWeight: 800 }}>PPE Control Room</h1>
          <span style={{ color: C.sub, fontSize: 13 }}>select the AI model, add any source, watch it run live</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Live control</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.sub }}>
              Model · sources · detection modes · teach frames
            </p>
          </div>
          <span style={{ flex: 1 }} />
          {cams.length > 0 ? (
            <div style={{ display: "inline-flex", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, flexWrap: "wrap" }}>
              {[
                { id: "large", label: "Large" },
                { id: "comfortable", label: "Grid" },
                { id: "compact", label: "Compact" },
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
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div style={{ display: "grid", gap: 14, overflow: "visible" }}>
        {loaded && cams.length > 0 ? <KpiStrip cams={cams} onNavigate={onNavigate} /> : null}
        <ModelBar say={say} />
        <AddSource
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdd={onAdd}
          onAddVideo={onAddVideo}
          catalog={catalog}
          defaultPpe={defaultPpe}
        />
        {stockNote ? (
          <div style={{
            fontSize: 12, color: C.sub, background: C.warnSoft, border: `1px solid #f0d4a8`,
            borderRadius: 10, padding: "8px 12px", lineHeight: 1.45,
          }}>
            <b style={{ color: C.warn }}>PPE dataset:</b> {stockNote}
          </div>
        ) : null}

        {!loaded ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: single || density === "large" ? "1fr" : `repeat(auto-fill, minmax(${gridMin}px, 1fr))`,
            gap: 14,
          }}>
            <div style={{
              background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
              minHeight: 360, animation: "ppe-shimmer 1.4s ease infinite",
              backgroundImage: "linear-gradient(90deg, #f4f6f9 0%, #eef1f5 50%, #f4f6f9 100%)",
              backgroundSize: "200% 100%",
            }} />
          </div>
        ) : cams.length ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: useLargeCard && cams.length <= 2
              ? (cams.length === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))")
              : `repeat(auto-fill, minmax(min(100%, ${gridMin}px), 1fr))`,
            gap: 16,
            overflow: "visible",
          }}>
            {cams.map((cam) => (
              <CameraCard
                key={cam.camera_id}
                cam={cam}
                large={useLargeCard && cams.length <= 2}
                catalog={catalog}
                onMode={onMode}
                onFlag={onFlag}
                onStartStop={onStartStop}
                onRemove={onRemove}
                onPpe={onPpe}
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

        <ModelsPanel />
      </div>

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
      `}</style>
    </div>
  );
}
