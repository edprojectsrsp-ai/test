"use client";
/**
 * PPENVR — the recorder: what was recorded, play it back, teach the model on it.
 *
 * Three things live here because they are the same workflow, not three:
 *
 *   Recorder   arm each camera off / events / continuous, cut a clip on demand,
 *              watch storage and retention
 *   Playback   a day's timeline per camera, scrub, play, lock evidence, export
 *   Teach      freeze any recorded frame, run the detector on it, correct the
 *              boxes, and bank the correction as training data
 *
 * Why teaching lives on recorded footage rather than only on the live view:
 * Live Teach can only correct what a camera happens to be pointing at right
 * now, so improving the model on a rare case — a missing harness at height, a
 * night shift — means waiting for it to happen again with an operator watching.
 * It already happened, and it is already on disk. Scrub to it and teach there.
 *
 * Playback is MJPEG rather than a <video> tag on purpose: clips are encoded
 * with whatever codec OpenCV could open on the host, which is often one no
 * browser decodes. The server decodes and streams frames instead, so review
 * never depends on the codec lottery. "Download" still hands over the original.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPpeUrl, getPpeApiBase } from "../../lib/ppeApi";
import TeachCanvas from "./TeachCanvas";


const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)",
  sub: "var(--ink-3)", faint: "var(--ink-4)", line: "var(--line)",
  shadow: "var(--shadow)", steel: "var(--steel)",
  ok: "#0a8f5b", warn: "#b25e00", danger: "#c02b3c",
};
const mono = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontVariantNumeric: "tabular-nums",
};

const MODES = [
  { id: "off", label: "Off", hint: "Nothing is written for this camera." },
  {
    id: "events", label: "Events",
    hint: "A clip is cut around every violation, including the seconds before "
      + "it fired. The default: keeps the footage anyone actually asks for "
      + "without filling the disk.",
  },
  {
    id: "continuous", label: "24/7",
    hint: "Always-on recording, cut into segments. Complete, but a single "
      + "1080p camera is roughly 20 GB a day — check the storage bar first.",
  },
];

async function api(path, opts) {
  const r = await fetch(buildPpeUrl(path), { cache: "no-store", ...opts });
  const t = await r.text();
  let b;
  try { b = t ? JSON.parse(t) : {}; } catch { b = { detail: t }; }
  if (!r.ok) {
    const d = b.detail;
    throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : `HTTP ${r.status}`);
  }
  return b;
}

const post = (p, body) => api(p, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const put = (p, body) => api(p, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtClock = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const sec = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
};
const fmtDur = (s) => (s == null ? "—" : s < 60 ? `${s.toFixed(1)}s`
  : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
    : `${(s / 3600).toFixed(1)}h`);
const fmtSize = (b) => (!b ? "0 MB" : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB`
  : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const timeOfDay = (iso) => (iso ? new Date(iso).toLocaleTimeString([], {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
}) : "—");

/* ------------------------------------------------------------------ chrome */
function Btn({ children, onClick, tone = "plain", disabled, title, small, style }) {
  const tones = {
    plain: { bg: C.panel, fg: C.ink, bd: C.line },
    primary: { bg: C.steel, fg: "#fff", bd: C.steel },
    danger: { bg: "#fdecee", fg: C.danger, bd: "#f5c2c8" },
    ok: { bg: "#e6f6ef", fg: C.ok, bd: "#b8e6d0" },
  }[tone];
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        border: `1px solid ${tones.bd}`, background: tones.bg, color: tones.fg,
        borderRadius: 9, padding: small ? "5px 10px" : "7px 13px",
        fontSize: small ? 11.5 : 12.5, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap", ...style,
      }}
    >
      {children}
    </button>
  );
}

function Card({ title, right, children, pad = 14 }) {
  return (
    <section style={{
      background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13,
      boxShadow: C.shadow, overflow: "hidden",
    }}>
      {title ? (
        <header style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          borderBottom: `1px solid ${C.line}`, background: C.panel2,
        }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, letterSpacing: 0.2 }}>
            {title}
          </h3>
          <div style={{ flex: 1 }} />
          {right}
        </header>
      ) : null}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- storage bar */
function StorageBar({ storage, onPrune, pruning }) {
  if (!storage) return null;
  const pct = Math.min(100, storage.used_pct || 0);
  const tone = pct > 90 ? C.danger : pct > 70 ? C.warn : C.ok;
  return (
    <Card
      title="Storage"
      right={<Btn small onClick={onPrune} disabled={pruning} tone="plain"
        title="Delete recordings past the retention limits now. Locked clips are never touched.">
        {pruning ? "Pruning…" : "Run retention"}
      </Btn>}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
        <span style={{ ...mono, fontSize: 19, fontWeight: 800, color: tone }}>
          {storage.used_gb?.toFixed(2)} GB
        </span>
        <span style={{ fontSize: 12, color: C.sub }}>
          of {storage.max_gb} GB budget · {storage.segments} clips
          {storage.locked_segments ? ` · ${storage.locked_segments} locked` : ""}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: C.panel2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: tone,
          transition: "width .3s ease",
        }} />
      </div>
      <div style={{ marginTop: 7, fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>
        Oldest unlocked clips are deleted once footage passes{" "}
        <b style={{ color: C.ink }}>{storage.retention_days} days</b> or the budget
        is exceeded. Lock a clip to keep it regardless.
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ camera roster */
function CameraRow({ cam, rec, selected, onSelect, onMode, onRecordNow, busy }) {
  const mode = rec?.mode || "off";
  const live = rec?.recording;
  return (
    <div
      onClick={() => onSelect(cam.camera_id)}
      style={{
        padding: "9px 11px", borderRadius: 10, cursor: "pointer",
        border: `1px solid ${selected ? C.steel : C.line}`,
        background: selected ? "var(--steel-soft, #eef4fb)" : C.panel,
        marginBottom: 7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {live ? (
          <span title="Writing to disk right now" style={{
            width: 8, height: 8, borderRadius: 4, background: C.danger,
            animation: "ppe-rec-pulse 1.4s ease infinite", flexShrink: 0,
          }} />
        ) : (
          <span style={{
            width: 8, height: 8, borderRadius: 4, flexShrink: 0,
            background: mode === "off" ? C.line : "#b8c4d0",
          }} />
        )}
        <span style={{ ...mono, fontSize: 12.5, fontWeight: 800, flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis" }}>
          {cam.camera_id}
        </span>
        <span style={{ fontSize: 10.5, color: C.faint }}>{cam.state}</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 7 }}>
        {MODES.map((m) => (
          <button
            key={m.id} type="button" title={m.hint} disabled={busy}
            onClick={(e) => { e.stopPropagation(); onMode(cam.camera_id, m.id); }}
            style={{
              flex: 1, border: `1px solid ${mode === m.id ? C.steel : C.line}`,
              background: mode === m.id ? C.steel : C.panel,
              color: mode === m.id ? "#fff" : C.sub,
              borderRadius: 7, padding: "4px 0", fontSize: 10.5, fontWeight: 800,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <Btn
          small tone="danger" disabled={busy}
          title="Cut a 30s clip ending now. Includes the buffered seconds before you pressed, which is the part you actually saw."
          onClick={(e) => { e.stopPropagation(); onRecordNow(cam.camera_id); }}
        >
          ● Clip now
        </Btn>
        {rec?.stats?.frames_dropped ? (
          <span title="Frames the recorder could not keep up with. Sustained drops mean the disk is too slow for this many cameras."
            style={{ fontSize: 10.5, color: C.warn }}>
            {rec.stats.frames_dropped} dropped
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */
function Timeline({ data, onSeek, activeSegmentId }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  if (!data) return null;
  const { coverage = [], events = [], bucket_seconds: bucketS = 300 } = data;

  const pick = (clientX) => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * 86400;
  };

  const findAt = (atS) => {
    // The segment covering this second, if any. Clicking dead air should do
    // nothing rather than jump to some unrelated clip.
    for (const s of data.segments || []) {
      const start = (new Date(s.started_at) - new Date(`${data.date}T00:00:00Z`)) / 1000;
      if (atS >= start && atS <= start + (s.duration_s || 0)) {
        return { segment: s, t: atS - start };
      }
    }
    return null;
  };

  return (
    <div>
      <div
        ref={ref}
        onMouseMove={(e) => {
          const at = pick(e.clientX);
          setHover(at == null ? null : { at, hit: findAt(at) });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const at = pick(e.clientX);
          const hit = at == null ? null : findAt(at);
          if (hit) onSeek(hit.segment, hit.t);
        }}
        style={{
          position: "relative", height: 46, borderRadius: 8, cursor: "crosshair",
          background: C.panel2, border: `1px solid ${C.line}`, overflow: "hidden",
        }}
      >
        {/* coverage */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {coverage.map((c, i) => (
            <div key={i} style={{
              flex: 1,
              background: c > 0 ? `rgba(18,86,209,${0.25 + 0.6 * c})` : "transparent",
            }} />
          ))}
        </div>
        {/* hour gridlines */}
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{
            position: "absolute", left: `${(h / 24) * 100}%`, top: 0, bottom: 0,
            width: 1, background: h % 6 === 0 ? "rgba(0,0,0,.22)" : "rgba(0,0,0,.08)",
          }} />
        ))}
        {/* event markers */}
        {events.map((ev, i) => (
          <div
            key={i}
            title={`${ev.gear || ev.rule_type} at ${fmtClock(ev.at_s)}`}
            style={{
              position: "absolute", left: `${(ev.at_s / 86400) * 100}%`,
              top: 2, bottom: 2, width: 3, marginLeft: -1, borderRadius: 2,
              background: C.danger, boxShadow: "0 0 0 1px rgba(255,255,255,.6)",
            }}
          />
        ))}
        {/* active segment band */}
        {(data.segments || []).filter((s) => s.id === activeSegmentId).map((s) => {
          const start = (new Date(s.started_at) - new Date(`${data.date}T00:00:00Z`)) / 1000;
          return (
            <div key={s.id} style={{
              position: "absolute", left: `${(start / 86400) * 100}%`,
              width: `${Math.max(0.3, ((s.duration_s || 0) / 86400) * 100)}%`,
              top: 0, bottom: 0, border: `2px solid ${C.steel}`, borderRadius: 3,
            }} />
          );
        })}
        {hover ? (
          <div style={{
            position: "absolute", left: `${(hover.at / 86400) * 100}%`, top: 0,
            bottom: 0, width: 1, background: C.ink, pointerEvents: "none",
          }} />
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4,
        fontSize: 10, color: C.faint, ...mono }}>
        {["00", "06", "12", "18", "24"].map((h) => <span key={h}>{h}:00</span>)}
      </div>

      <div style={{ marginTop: 6, fontSize: 11.5, color: C.sub, minHeight: 17 }}>
        {hover
          ? (hover.hit
            ? <>At <b style={{ ...mono, color: C.ink }}>{fmtClock(hover.at)}</b> — click to play from here</>
            : <>No footage at <span style={{ ...mono }}>{fmtClock(hover.at)}</span></>)
          : <>{fmtDur(data.recorded_seconds)} recorded · {events.length} event
            {events.length === 1 ? "" : "s"} marked in red</>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ player */
function Player({ segment, onChanged, onClose, seekTo }) {
  const [t, setT] = useState(seekTo || 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [streamKey, setStreamKey] = useState(0);
  const [teaching, setTeaching] = useState(false);
  const [teachData, setTeachData] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dur = segment.duration_s || 0;

  useEffect(() => { setT(seekTo || 0); setPlaying(false); setTeaching(false); },
    [segment.id, seekTo]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? "" : x)), 3500); };

  const play = () => { setStreamKey((k) => k + 1); setPlaying(true); setTeaching(false); };
  const pause = () => setPlaying(false);

  const seek = (v) => { setT(v); if (playing) setStreamKey((k) => k + 1); };

  const src = playing
    ? `${getPpeApiBase()}/api/nvr/segments/${segment.id}/play.mjpg?t=${t}&speed=${speed}&fps=12&k=${streamKey}`
    : `${getPpeApiBase()}/api/nvr/segments/${segment.id}/frame.jpg?t=${t}`;

  /* ---- teach on this frame ------------------------------------------- */
  const startTeach = async () => {
    setPlaying(false);
    setBusy(true);
    try {
      const d = await api(`/api/nvr/segments/${segment.id}/detect?t=${t}`);
      setTeachData(d);
      setBoxes(d.boxes.filter((b) => b.known));
      setTeaching(true);
    } catch (e) {
      flash(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveTeach = async () => {
    if (!teachData) return;
    setBusy(true);
    try {
      const r = await post(`/api/nvr/segments/${segment.id}/teach`, {
        t, boxes: boxes.map((b) => ({ cls: b.cls, xyxy: b.xyxy })),
      });
      flash(`✓ ${r.labels} label(s) banked — fold them in with Train & go live`);
      setTeaching(false);
    } catch (e) {
      flash(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async () => {
    setBusy(true);
    try {
      await post(`/api/nvr/segments/${segment.id}/lock`, { locked: !segment.locked });
      flash(segment.locked ? "Unlocked — retention may delete this clip"
        : "Locked — retention will never delete this clip");
      onChanged();
    } catch (e) { flash(`✗ ${e.message}`); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete this ${fmtDur(dur)} clip permanently?`)) return;
    setBusy(true);
    try {
      await api(`/api/nvr/segments/${segment.id}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e) { flash(`✗ ${e.message}`); setBusy(false); }
  };

  return (
    <Card
      title={`${segment.camera_id} · ${timeOfDay(segment.started_at)} · ${segment.kind}`}
      right={<>
        {segment.locked ? (
          <span title="Protected from retention" style={{
            fontSize: 10.5, fontWeight: 800, color: C.ok, background: "#e6f6ef",
            border: "1px solid #b8e6d0", borderRadius: 6, padding: "2px 7px",
          }}>🔒 LOCKED</span>
        ) : null}
        <Btn small onClick={onClose}>✕ Close</Btn>
      </>}
    >
      {teaching && teachData ? (
        <>
          <div style={{
            fontSize: 12, color: C.sub, marginBottom: 9, lineHeight: 1.5,
            background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 9, padding: "9px 11px",
          }}>
            <b style={{ color: C.ink }}>Teaching frame at {fmtClock(t)}.</b>{" "}
            These are the model&apos;s own boxes on this exact frame. Fix what is wrong —
            flip a class, drag a box the model missed, delete one that is not
            really there — then save. Saving stores the corrected frame as
            training data; the model itself only changes when you run{" "}
            <b style={{ color: C.ink }}>Train &amp; go live</b> in Review.
          </div>
          <TeachCanvas
            imgUrl={`${getPpeApiBase()}/api/nvr/segments/${segment.id}/frame.jpg?t=${t}`}
            width={teachData.width} height={teachData.height}
            boxes={boxes} setBoxes={setBoxes}
            palette={teachData.display_names || {}}
            classes={teachData.classes || []}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 11, alignItems: "center", flexWrap: "wrap" }}>
            <Btn tone="primary" onClick={saveTeach} disabled={busy || !boxes.length}>
              {busy ? "Saving…" : `✓ Save ${boxes.length} label${boxes.length === 1 ? "" : "s"}`}
            </Btn>
            <Btn onClick={() => setTeaching(false)} disabled={busy}>Cancel</Btn>
            <span style={{ fontSize: 11.5, color: C.faint }}>
              {boxes.filter((b) => b.added).length} added ·{" "}
              {boxes.filter((b) => b.edited).length} changed ·{" "}
              {(teachData.boxes || []).filter((b) => b.known).length - boxes.filter((b) => !b.added).length} deleted
            </span>
            {msg ? <span style={{ fontSize: 12, fontWeight: 700,
              color: msg.startsWith("✓") ? C.ok : C.danger }}>{msg}</span> : null}
          </div>
        </>
      ) : (
        <>
          <div style={{
            position: "relative", width: "100%", aspectRatio: "16 / 9",
            background: "#0b0f14", borderRadius: 10, overflow: "hidden",
          }}>
            <img
              key={playing ? `p${streamKey}` : `f${t}`}
              src={src} alt={`Playback ${segment.camera_id}`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
            <span style={{
              position: "absolute", top: 10, left: 12, ...mono, fontSize: 12,
              color: "#e7eef6", background: "rgba(5,8,12,.65)",
              padding: "3px 9px", borderRadius: 6,
            }}>
              {fmtClock(t)} / {fmtClock(dur)}{playing ? ` · ${speed}×` : " · PAUSED"}
            </span>
          </div>

          {/* scrub bar with event markers */}
          <div style={{ position: "relative", marginTop: 10 }}>
            <input
              type="range" min={0} max={Math.max(0.1, dur)} step={0.1} value={t}
              onChange={(e) => seek(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.steel }}
            />
            {(segment.events || []).map((ev, i) => (
              <span
                key={i} title={`${ev.gear || ev.rule_type} at ${fmtClock(ev.t)}`}
                onClick={() => seek(ev.t)}
                style={{
                  position: "absolute", left: `${(ev.t / Math.max(0.1, dur)) * 100}%`,
                  top: -3, width: 3, height: 10, marginLeft: -1, borderRadius: 2,
                  background: C.danger, cursor: "pointer",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
            <Btn tone="primary" onClick={playing ? pause : play}>
              {playing ? "⏸ Pause" : "▶ Play"}
            </Btn>
            <Btn small onClick={() => seek(Math.max(0, t - 5))}>−5s</Btn>
            <Btn small onClick={() => seek(Math.min(dur, t + 5))}>+5s</Btn>
            <select
              value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); if (playing) setStreamKey((k) => k + 1); }}
              style={{
                padding: "5px 9px", borderRadius: 7, fontSize: 12, ...mono,
                border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
              }}
            >
              {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <Btn tone="ok" onClick={startTeach} disabled={busy}
              title="Run the detector on this exact frame and correct it. The highest-value training data you have, because you are picking the frames that matter.">
              {busy ? "…" : "🎓 Teach this frame"}
            </Btn>
            <Btn small onClick={toggleLock} disabled={busy}>
              {segment.locked ? "🔓 Unlock" : "🔒 Lock"}
            </Btn>
            <Btn small onClick={() => window.open(
              `${getPpeApiBase()}/api/nvr/segments/${segment.id}/download`, "_blank", "noopener")}>
              ⭳ Export
            </Btn>
            <Btn small tone="danger" onClick={remove} disabled={busy || segment.locked}
              title={segment.locked ? "Unlock the clip first" : "Delete permanently"}>
              🗑
            </Btn>
          </div>

          <div style={{ marginTop: 9, fontSize: 11.5, color: C.sub, ...mono }}>
            {fmtSize(segment.size_bytes)} · {segment.width}×{segment.height} ·{" "}
            {segment.fps?.toFixed(1)} fps · {segment.codec}
            {segment.trigger ? ` · triggered by ${segment.trigger}` : ""}
            {segment.event_count ? ` · ${segment.event_count} event(s)` : ""}
          </div>
          {msg ? (
            <div style={{ marginTop: 7, fontSize: 12, fontWeight: 700,
              color: msg.startsWith("✓") ? C.ok : msg.startsWith("✗") ? C.danger : C.sub }}>
              {msg}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- NVR devices */
function NvrDevices({ onImported }) {
  const [form, setForm] = useState({
    brand: "hikvision", host: "", username: "admin", password: "",
    port: "", channels: 8, stream: "sub", path: "",
  });
  const [scan, setScan] = useState(null);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [deviceId, setDeviceId] = useState("nvr1");
  const [recordMode, setRecordMode] = useState("events");
  const [brands, setBrands] = useState([]);

  useEffect(() => {
    api("/api/cameras/meta/brands")
      .then((d) => setBrands(d.brands || []))
      .catch(() => setBrands([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const doScan = async () => {
    if (!form.host.trim()) return setMsg("Enter the recorder's IP address first.");
    setBusy(true); setMsg(""); setScan(null);
    try {
      const d = await post("/api/nvr/devices/scan", {
        ...form,
        port: form.port ? Number(form.port) : null,
        channels: Number(form.channels) || 8,
      });
      setScan(d);
      const next = {};
      (d.channels || []).forEach((c) => { if (c.ok) next[c.channel] = true; });
      setPicked(next);
      setMsg(d.hint || "");
    } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  };

  const doImport = async () => {
    const chosen = (scan?.channels || []).filter((c) => picked[c.channel]);
    if (!chosen.length) return setMsg("Select at least one channel.");
    setBusy(true);
    try {
      const d = await post("/api/nvr/devices/import", {
        device_id: deviceId, brand: form.brand, host: form.host,
        username: form.username, password: form.password,
        port: form.port ? Number(form.port) : null,
        stream: form.stream, path: form.path,
        channels: chosen.map((c) => ({ channel: c.channel, url: c.url })),
        record_mode: recordMode, autostart: true,
      });
      setMsg(`✓ Added ${d.count} camera(s)${d.failed?.length ? `, ${d.failed.length} failed` : ""}`);
      onImported();
    } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  };

  const field = {
    padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
    border: `1px solid ${C.line}`, background: C.panel, color: C.ink, minWidth: 0,
  };
  const okCount = (scan?.channels || []).filter((c) => c.ok).length;

  return (
    <Card title="Add an NVR / DVR — import every channel at once">
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.sub, lineHeight: 1.55 }}>
        A site hands you one recorder with sixteen cameras behind it, not sixteen
        addresses. Enter the recorder once and this probes each channel, shows
        which ones actually carry video, and registers the ones you pick as
        cameras — correct RTSP path for the brand, credentials URL-encoded,
        recording armed.
      </p>

      <div style={{ display: "grid", gap: 9, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Brand</span>
          <select value={form.brand} onChange={set("brand")} style={field}>
            {(brands.length ? brands : [{ id: "hikvision", label: "Hikvision" }]).map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Host / IP</span>
          <input value={form.host} onChange={set("host")} placeholder="10.0.0.50" style={{ ...field, ...mono }} />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Username</span>
          <input value={form.username} onChange={set("username")} style={field} />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Password</span>
          <input type="password" value={form.password} onChange={set("password")} style={field} />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Port</span>
          <input value={form.port} onChange={set("port")} placeholder="554" style={{ ...field, ...mono }} />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Channels</span>
          <input type="number" min={1} max={64} value={form.channels} onChange={set("channels")} style={{ ...field, ...mono }} />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span title="Sub streams are lower resolution and far cheaper to decode — the right default when importing a whole recorder."
            style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Stream</span>
          <select value={form.stream} onChange={set("stream")} style={field}>
            <option value="sub">Sub (recommended)</option>
            <option value="main">Main (high-res)</option>
          </select>
        </label>
        {form.brand === "generic" ? (
          <label style={{ display: "grid", gap: 3 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>RTSP path</span>
            <input value={form.path} onChange={set("path")} placeholder="/live/ch00_0" style={{ ...field, ...mono }} />
          </label>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Btn tone="primary" onClick={doScan} disabled={busy}>
          {busy && !scan ? "Scanning…" : "🔍 Scan channels"}
        </Btn>
        {msg ? (
          <span style={{ fontSize: 12, color: msg.startsWith("✗") ? C.danger : msg.startsWith("✓") ? C.ok : C.sub }}>
            {msg}
          </span>
        ) : null}
      </div>

      {scan ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
            {okCount} of {scan.tested} channels responded
          </div>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
            {(scan.channels || []).map((c) => (
              <label key={c.channel} title={c.error || c.masked} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                borderRadius: 9, cursor: c.ok ? "pointer" : "not-allowed",
                border: `1px solid ${c.ok ? "#b8e6d0" : C.line}`,
                background: c.ok ? "#e6f6ef" : C.panel2, opacity: c.ok ? 1 : 0.6,
              }}>
                <input type="checkbox" disabled={!c.ok} checked={Boolean(picked[c.channel])}
                  onChange={(e) => setPicked((p) => ({ ...p, [c.channel]: e.target.checked }))} />
                <span style={{ ...mono, fontSize: 12, fontWeight: 800 }}>CH{String(c.channel).padStart(2, "0")}</span>
                <span style={{ fontSize: 11, color: C.sub, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.ok ? `${c.width}×${c.height} · ${c.latency_ms}ms` : (c.error || "no video")}
                </span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 9, marginTop: 13, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Camera id prefix</span>
              <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ ...field, ...mono, width: 130 }} />
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>Recording</span>
              <select value={recordMode} onChange={(e) => setRecordMode(e.target.value)} style={field}>
                {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <Btn tone="primary" onClick={doImport} disabled={busy}>
              {busy ? "Importing…" : `＋ Import ${Object.values(picked).filter(Boolean).length} channel(s)`}
            </Btn>
            <span style={{ fontSize: 11.5, color: C.faint }}>
              Cameras will be named <span style={{ ...mono }}>{deviceId}-ch01</span>, …
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ==================================================================== main */
export default function PPENVR() {
  const [sub, setSub] = useState("library");
  const [cams, setCams] = useState([]);
  const [recorders, setRecorders] = useState({});
  const [storage, setStorage] = useState(null);
  const [sel, setSel] = useState("");
  const [date, setDate] = useState(todayISO());
  const [tl, setTl] = useState(null);
  const [active, setActive] = useState(null);
  const [seekTo, setSeekTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [err, setErr] = useState("");

  /* industrial chrome applied via .ppe-industrial parent tokens */

  const refreshStatus = useCallback(async () => {
    try {
      const [camList, nvr] = await Promise.all([
        api("/api/cameras"),
        api("/api/nvr/status"),
      ]);
      const list = Array.isArray(camList) ? camList : camList.cameras || [];
      setCams(list);
      const map = {};
      (nvr.recorders || []).forEach((r) => { map[r.camera_id] = r; });
      setRecorders(map);
      setStorage(nvr.storage);
      setErr("");
      setSel((cur) => cur || (list[0]?.camera_id ?? ""));
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  const refreshTimeline = useCallback(async () => {
    if (!sel) return setTl(null);
    try {
      setTl(await api(`/api/nvr/timeline?camera_id=${encodeURIComponent(sel)}&date=${date}`));
    } catch (e) {
      setTl(null);
      setErr(e.message);
    }
  }, [sel, date]);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 6000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => { refreshTimeline(); }, [refreshTimeline]);

  const setMode = async (cameraId, mode) => {
    setBusy(true);
    try {
      await put(`/api/nvr/cameras/${encodeURIComponent(cameraId)}/recording`, { mode });
      await refreshStatus();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const recordNow = async (cameraId) => {
    setBusy(true);
    try {
      await post(`/api/nvr/cameras/${encodeURIComponent(cameraId)}/record-now`, { seconds: 30 });
      await refreshStatus();
      setTimeout(refreshTimeline, 33000);   // the clip lands once post-roll ends
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const runPrune = async () => {
    setPruning(true);
    try {
      const r = await post("/api/nvr/prune");
      setErr(r.deleted ? "" : "Nothing to prune — everything is inside the retention limits.");
      await refreshStatus();
      await refreshTimeline();
    } catch (e) { setErr(e.message); } finally { setPruning(false); }
  };

  const clips = useMemo(
    () => (tl?.segments || []).slice().sort(
      (a, b) => new Date(b.started_at) - new Date(a.started_at)),
    [tl],
  );

  const armedCount = Object.values(recorders).filter((r) => r.mode !== "off").length;

  return (
    <div style={{ padding: "16px 20px 40px", color: C.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>Recorder (NVR)</h2>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.sub }}>
            <b style={{ color: C.ink }}>{armedCount}</b> of {cams.length} cameras armed ·
            continuous + event evidence · teach on footage
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {[["library", "Library"], ["devices", "Add NVR"]].map(([id, label]) => (
          <Btn key={id} tone={sub === id ? "primary" : "plain"} onClick={() => setSub(id)}>
            {label}
          </Btn>
        ))}
      </div>

      {err ? (
        <div className="ppe-banner ppe-banner--warn" style={{ margin: "0 0 13px" }}>
          {err}
        </div>
      ) : null}

      {sub === "devices" ? (
        <NvrDevices onImported={refreshStatus} />
      ) : (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(230px, 280px) 1fr", alignItems: "start" }}>
          {/* left rail */}
          <div style={{ display: "grid", gap: 13 }}>
            <Card title="Cameras" pad={10}>
              {cams.length ? cams.map((c) => (
                <CameraRow
                  key={c.camera_id} cam={c} rec={recorders[c.camera_id]}
                  selected={sel === c.camera_id} onSelect={setSel}
                  onMode={setMode} onRecordNow={recordNow} busy={busy}
                />
              )) : (
                <div style={{ fontSize: 12.5, color: C.sub, padding: "6px 2px", lineHeight: 1.5 }}>
                  No cameras yet. Add one in the Live tab, or import a whole
                  recorder from <b>Add NVR</b>.
                </div>
              )}
            </Card>
            <StorageBar storage={storage} onPrune={runPrune} pruning={pruning} />
          </div>

          {/* main column */}
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <Card
              title={sel ? `Timeline — ${sel}` : "Timeline"}
              right={
                <input
                  type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  style={{
                    padding: "5px 9px", borderRadius: 7, fontSize: 12, ...mono,
                    border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
                  }}
                />
              }
            >
              {sel ? (
                <Timeline
                  data={tl}
                  activeSegmentId={active?.id}
                  onSeek={(segment, t) => { setActive(segment); setSeekTo(t); }}
                />
              ) : (
                <div style={{ fontSize: 12.5, color: C.sub }}>Pick a camera on the left.</div>
              )}
            </Card>

            {active ? (
              <Player
                segment={active} seekTo={seekTo}
                onChanged={() => { refreshTimeline(); refreshStatus(); }}
                onClose={() => setActive(null)}
              />
            ) : null}

            <Card title={`Clips${tl ? ` — ${clips.length} on ${tl.date}` : ""}`}>
              {clips.length ? (
                <div style={{ display: "grid", gap: 9, gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))" }}>
                  {clips.map((s) => (
                    <button
                      key={s.id} type="button"
                      onClick={() => { setActive(s); setSeekTo(0); }}
                      style={{
                        border: `1px solid ${active?.id === s.id ? C.steel : C.line}`,
                        borderRadius: 10, overflow: "hidden", cursor: "pointer",
                        background: C.panel, padding: 0, textAlign: "left",
                      }}
                    >
                      <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#0b0f14" }}>
                        <img
                          src={`${getPpeApiBase()}/api/nvr/segments/${s.id}/thumb.jpg`}
                          alt="" loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <span style={{
                          position: "absolute", bottom: 5, right: 6, ...mono,
                          fontSize: 10.5, color: "#e7eef6",
                          background: "rgba(5,8,12,.72)", padding: "1px 6px", borderRadius: 5,
                        }}>
                          {fmtDur(s.duration_s)}
                        </span>
                        {s.kind === "event" ? (
                          <span style={{
                            position: "absolute", top: 5, left: 6, fontSize: 9.5,
                            fontWeight: 800, color: "#fff", background: C.danger,
                            padding: "1px 6px", borderRadius: 5, letterSpacing: 0.3,
                          }}>
                            {s.trigger ? s.trigger.toUpperCase() : "EVENT"}
                          </span>
                        ) : null}
                        {s.locked ? (
                          <span style={{ position: "absolute", top: 5, right: 6, fontSize: 11 }}>🔒</span>
                        ) : null}
                      </div>
                      <div style={{ padding: "7px 9px" }}>
                        <div style={{ ...mono, fontSize: 12, fontWeight: 800 }}>
                          {timeOfDay(s.started_at)}
                        </div>
                        <div style={{ fontSize: 10.5, color: C.sub, marginTop: 2 }}>
                          {fmtSize(s.size_bytes)}
                          {s.event_count ? ` · ${s.event_count} event${s.event_count === 1 ? "" : "s"}` : ""}
                          {s.exists ? "" : " · file missing"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.55 }}>
                  Nothing recorded for this camera on {tl?.date || date}. Arm it with{" "}
                  <b>Events</b> or <b>24/7</b> on the left, or press <b>Clip now</b> to
                  cut one immediately.
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ppe-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
      `}</style>
    </div>
  );
}
