"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

// PPE Review Dashboard — teach the AI from the frontend.
// White corporate theme (matches Control Room / Alerts).

const C = {
  bg: "var(--bg)", panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)", sub: "var(--ink-3)",
  line: "var(--line)", brand: "var(--steel)", brandSoft: "var(--steel-soft)",
  ok: "var(--verdigris)", okSoft: "var(--verdigris-soft)", warn: "var(--slag)", warnSoft: "var(--slag-soft)",
  danger: "var(--molten)", dangerSoft: "var(--molten-soft)", cyan: "var(--steel)",
  shadow: "var(--shadow)",
  void: "#0b0f14",
};

const CLASSES = [
  "person", "helmet", "no_helmet", "vest", "no_vest", "gloves", "no_gloves",
  "goggles", "no_goggles", "boots", "no_boots", "harness", "no_harness",
  "mask", "no_mask",
];
const VIOLATION = new Set(CLASSES.filter((c) => c.startsWith("no_")));

const clsColor = (c) =>
  VIOLATION.has(c) ? C.danger : c === "person" ? C.brand : C.ok;

const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

function drawPlaceholder(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1a2332");
  g.addColorStop(1, "#0b0f14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(56,189,248,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < w; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
  }
  for (let j = 0; j < h; j += 32) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke();
  }
  ctx.fillStyle = "rgba(230,237,243,0.45)";
  ctx.font = "12px 'IBM Plex Mono', monospace";
  ctx.fillText("Waiting for frame image…", 12, h - 12);
}

const HANDLE = 8;
const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.json();
}

export default function PPEReviewDashboard({ embedded = false }) {
  const [queue, setQueue] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [classes, setClasses] = useState(CLASSES);
  const [serviceStatus, setServiceStatus] = useState("connecting");
  const [loading, setLoading] = useState(true);
  const [boxes, setBoxes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [drag, setDrag] = useState(null);
  const [toast, setToast] = useState(null);
  const [reviewed, setReviewed] = useState({});
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const active = queue.find((q) => q.id === activeId);
  const CW = active?.width || 640;
  const CH = active?.height || 480;

  const flash = useCallback((msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const boxesFor = useCallback((capture) => (
    (capture?.predictions || []).map((prediction, index) => ({
      id: `${capture.id}-b${index}`,
      cls: prediction.cls,
      x1: prediction.xyxy[0],
      y1: prediction.xyxy[1],
      x2: prediction.xyxy[2],
      y2: prediction.xyxy[3],
      conf: prediction.conf,
    }))
  ), []);

  const selectCapture = useCallback((capture) => {
    setActiveId(capture?.id || "");
    setBoxes(boxesFor(capture));
    setSelected(null);
  }, [boxesFor]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api("/api/review/pending");
      setQueue(items);
      selectCapture(items[0]);
      setServiceStatus("online");
    } catch (error) {
      setServiceStatus("offline");
      flash(error.message || "PPE service is unavailable", C.danger);
    } finally {
      setLoading(false);
    }
  }, [flash, selectCapture]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api("/health"),
      api("/api/review/classes"),
    ]).then(([, payload]) => {
      if (mounted) setClasses(payload.classes || CLASSES);
    }).catch(() => {
      if (mounted) setServiceStatus("offline");
    });
    Promise.resolve().then(loadQueue);
    return () => { mounted = false; };
  }, [loadQueue]);

  // draw frame + boxes
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    let cancelled = false;

    const paintBoxes = () => {
      boxes.forEach((b) => {
        const col = clsColor(b.cls);
        const sel = b.id === selected;
        ctx.lineWidth = sel ? 3 : 2;
        ctx.strokeStyle = col;
        ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        const text = b.conf != null ? `${b.cls} ${b.conf.toFixed(2)}` : b.cls;
        ctx.font = "12px 'IBM Plex Mono', monospace";
        const tw = ctx.measureText(text).width + 10;
        ctx.fillStyle = col;
        ctx.fillRect(b.x1, Math.max(0, b.y1 - 18), tw, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, b.x1 + 5, Math.max(13, b.y1 - 5));
        if (sel) {
          ctx.fillStyle = C.warn;
          [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]].forEach(
            ([hx, hy]) => ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE),
          );
        }
      });
      if (drawing) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = C.warn;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          drawing.x1, drawing.y1, drawing.x2 - drawing.x1, drawing.y2 - drawing.y1,
        );
        ctx.setLineDash([]);
      }
    };

    drawPlaceholder(ctx, CW, CH);
    if (active?.image_url) {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        ctx.drawImage(image, 0, 0, CW, CH);
        paintBoxes();
      };
      image.onerror = paintBoxes;
      image.src = `${API_BASE}${active.image_url}`;
    } else {
      paintBoxes();
    }
    return () => { cancelled = true; };
  }, [active, boxes, selected, drawing, activeId, CW, CH]);

  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CW,
      y: ((e.clientY - r.top) / r.height) * CH,
    };
  };

  const handleAt = (b, x, y) => {
    const corners = {
      tl: [b.x1, b.y1], tr: [b.x2, b.y1], bl: [b.x1, b.y2], br: [b.x2, b.y2],
    };
    for (const [k, [hx, hy]] of Object.entries(corners)) {
      if (Math.abs(x - hx) < HANDLE && Math.abs(y - hy) < HANDLE) return k;
    }
    return null;
  };

  const inside = (b, x, y) =>
    x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

  const onDown = (e) => {
    const { x, y } = toCanvas(e);
    if (selected) {
      const b = boxes.find((bb) => bb.id === selected);
      const h = b && handleAt(b, x, y);
      if (h) { setDrag({ mode: "resize", handle: h, id: b.id }); return; }
    }
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (inside(boxes[i], x, y)) {
        setSelected(boxes[i].id);
        setDrag({ mode: "move", id: boxes[i].id, ox: x, oy: y });
        return;
      }
    }
    setSelected(null);
    setDrawing({ x1: x, y1: y, x2: x, y2: y });
  };

  const onMove = (e) => {
    const { x, y } = toCanvas(e);
    if (drawing) { setDrawing((d) => ({ ...d, x2: x, y2: y })); return; }
    if (!drag) return;
    setBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== drag.id) return b;
        if (drag.mode === "move") {
          const dx = x - drag.ox; const dy = y - drag.oy;
          return { ...b, x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy };
        }
        const nb = { ...b };
        if (drag.handle.includes("l")) nb.x1 = x;
        if (drag.handle.includes("r")) nb.x2 = x;
        if (drag.handle.includes("t")) nb.y1 = y;
        if (drag.handle.includes("b")) nb.y2 = y;
        return nb;
      }),
    );
    if (drag.mode === "move") setDrag((d) => ({ ...d, ox: x, oy: y }));
  };

  const onUp = () => {
    if (drawing) {
      const { x1, y1, x2, y2 } = drawing;
      if (Math.abs(x2 - x1) > 8 && Math.abs(y2 - y1) > 8) {
        const nb = {
          id: `new-${Date.now()}`, cls: "no_helmet",
          x1: Math.min(x1, x2), y1: Math.min(y1, y2),
          x2: Math.max(x1, x2), y2: Math.max(y1, y2), conf: null,
        };
        setBoxes((p) => [...p, nb]);
        setSelected(nb.id);
      }
      setDrawing(null);
    }
    setDrag(null);
  };

  const relabel = (cls) => {
    if (!selected) return;
    setBoxes((p) => p.map((b) => (b.id === selected ? { ...b, cls } : b)));
  };
  const delBox = useCallback(() => {
    if (!selected) return;
    setBoxes((p) => p.filter((b) => b.id !== selected));
    setSelected(null);
  }, [selected]);

  const removeActive = useCallback((id) => {
    setQueue((prev) => {
      const remaining = prev.filter((item) => item.id !== id);
      // defer select so we don't setState-during-setState issues
      queueMicrotask(() => selectCapture(remaining[0]));
      return remaining;
    });
  }, [selectCapture]);

  const submit = useCallback(async () => {
    if (!activeId || saving) return;
    setSaving(true);
    try {
      await api(`/api/review/captures/${activeId}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boxes: boxes.map((box) => ({
            cls: box.cls,
            xyxy: [box.x1, box.y1, box.x2, box.y2],
          })),
        }),
      });
      setReviewed((current) => ({ ...current, [activeId]: "labeled" }));
      flash(`Saved ${boxes.length} label${boxes.length === 1 ? "" : "s"} → training data`, C.ok);
      removeActive(activeId);
    } catch (error) {
      flash(error.message || "Could not save labels", C.danger);
    } finally {
      setSaving(false);
    }
  }, [activeId, boxes, flash, saving, removeActive]);

  const ignore = useCallback(async () => {
    if (!activeId || saving) return;
    setSaving(true);
    try {
      await api(`/api/review/captures/${activeId}/ignore`, { method: "POST" });
      setReviewed((current) => ({ ...current, [activeId]: "ignored" }));
      flash("Ignored — won't be used for training", C.sub);
      removeActive(activeId);
    } catch (error) {
      flash(error.message || "Could not ignore frame", C.danger);
    } finally {
      setSaving(false);
    }
  }, [activeId, flash, saving, removeActive]);

  const exportDataset = async () => {
    const version = `v${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    try {
      const result = await api("/api/review/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      flash(`Exported ${result.exported_items} frame(s) → ${result.version}`, C.warn);
    } catch (error) {
      flash(error.message || "Dataset export failed", C.danger);
    }
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "s" || e.key === "S") { e.preventDefault(); submit(); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); ignore(); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) { e.preventDefault(); delBox(); }
      }
      if (e.key === "Escape") setSelected(null);
      if ((e.key === "j" || e.key === "J" || e.key === "ArrowDown") && queue.length) {
        e.preventDefault();
        const idx = queue.findIndex((q) => q.id === activeId);
        const next = queue[Math.min(queue.length - 1, idx + 1)];
        if (next) selectCapture(next);
      }
      if ((e.key === "k" || e.key === "K" || e.key === "ArrowUp") && queue.length) {
        e.preventDefault();
        const idx = queue.findIndex((q) => q.id === activeId);
        const prev = queue[Math.max(0, idx - 1)];
        if (prev) selectCapture(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, ignore, delBox, selected, queue, activeId, selectCapture]);

  const pendingCount = queue.filter((q) => !reviewed[q.id]).length;
  const labeledCount = Object.values(reviewed).filter((s) => s === "labeled").length;

  const shell = {
    background: embedded ? "transparent" : C.bg,
    minHeight: embedded ? undefined : "calc(100vh - 6rem)",
    color: C.ink,
    fontFamily: "Inter, system-ui, sans-serif",
    padding: embedded ? "18px 28px 40px" : 0,
  };

  return (
    <div style={shell}>
      {!embedded ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Review & Teach</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.sub }}>
              Correct boxes · save labels · export training sets
            </p>
          </div>
          <span style={{ flex: 1 }} />
          <StatusPill status={serviceStatus} pending={pendingCount} />
          <button type="button" onClick={loadQueue} style={btnSecondary}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" onClick={exportDataset} style={btnPrimary}>
            Export dataset
          </button>
        </div>
      )}

      <div style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${C.line}`,
        background: C.panel,
        boxShadow: C.shadow,
        minHeight: embedded ? "calc(100vh - 220px)" : "calc(100vh - 6rem)",
      }}>
        {!embedded && (
          <header style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderBottom: `1px solid ${C.line}`, background: C.panel, flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 3, background: C.warn,
                boxShadow: `0 0 10px ${C.warn}66`,
              }} />
              <span style={{ ...mono, fontWeight: 700, letterSpacing: 0.5, fontSize: 14 }}>PPE REVIEW</span>
              <span style={{ color: C.sub, fontSize: 13 }}>active-learning queue</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StatusPill status={serviceStatus} pending={pendingCount} />
              <button type="button" onClick={loadQueue} style={btnSecondary}>
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button type="button" onClick={exportDataset} style={btnPrimary}>
                Export dataset
              </button>
            </div>
          </header>
        )}

        {/* progress bar when session has work */}
        {(pendingCount > 0 || labeledCount > 0) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
            background: C.panel2, borderBottom: `1px solid ${C.line}`, fontSize: 12, color: C.sub,
          }}>
            <span style={{ fontWeight: 700, color: C.ink }}>{pendingCount}</span> pending
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ fontWeight: 700, color: C.ok }}>{labeledCount}</span> labeled this session
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "#8595a5" }}>
              <kbd style={kbd}>S</kbd> save · <kbd style={kbd}>I</kbd> ignore · <kbd style={kbd}>Del</kbd> box · <kbd style={kbd}>J</kbd>/<kbd style={kbd}>K</kbd> queue
            </span>
          </div>
        )}

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* queue */}
          <aside style={{
            width: 230, borderRight: `1px solid ${C.line}`, background: C.panel2,
            overflowY: "auto", padding: 10, flexShrink: 0,
          }}>
            <div style={{
              ...mono, fontSize: 10.5, color: C.sub, textTransform: "uppercase", letterSpacing: 1,
              padding: "4px 6px 10px", fontWeight: 700,
            }}>
              Queue ({queue.length})
            </div>
            {loading && !queue.length ? (
              <div style={{ color: C.sub, fontSize: 12, padding: 10 }}>Loading…</div>
            ) : null}
            {queue.map((q, idx) => {
              const st = reviewed[q.id];
              const isActive = q.id === activeId;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => selectCapture(q)}
                  style={{
                    width: "100%", textAlign: "left", marginBottom: 8, padding: 10,
                    borderRadius: 10, cursor: "pointer",
                    background: isActive ? C.brandSoft : C.panel,
                    border: `1.5px solid ${isActive ? C.brand : C.line}`,
                    color: C.ink,
                    boxShadow: isActive ? "none" : "0 1px 2px rgba(16,30,46,.04)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ ...mono, fontSize: 12, color: C.brand, fontWeight: 700 }}>{q.camera_id}</span>
                    {st ? (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 700,
                        background: st === "labeled" ? C.okSoft : "#eef1f5",
                        color: st === "labeled" ? C.ok : C.sub,
                      }}>
                        {st}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: C.sub, ...mono }}>#{idx + 1}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.35 }}>
                    {q.note || q.reason || "capture"}
                  </div>
                  {q.reason ? (
                    <div style={{
                      marginTop: 6, display: "inline-block", fontSize: 10, fontWeight: 700,
                      padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
                      background: q.reason === "violation" ? C.dangerSoft : C.warnSoft,
                      color: q.reason === "violation" ? C.danger : C.warn,
                    }}>
                      {q.reason}
                    </div>
                  ) : null}
                </button>
              );
            })}
            {!loading && !queue.length ? (
              <div style={{
                padding: 14, borderRadius: 10, border: `1px dashed ${C.line}`,
                background: C.panel, color: C.sub, fontSize: 12.5, lineHeight: 1.45,
              }}>
                Queue empty. Put a camera in <b>Collect</b> mode or press <b>⚑ Teach</b> on a live feed.
              </div>
            ) : null}
          </aside>

          {/* canvas */}
          <main style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", padding: 20, minWidth: 0, background: "#eef1f5",
          }}>
            {active ? (
              <>
                <div style={{
                  marginBottom: 10, ...mono, fontSize: 12, color: C.sub, textAlign: "center",
                }}>
                  <span style={{ color: C.ink, fontWeight: 700 }}>{active.camera_id}</span>
                  {" · "}{active.reason || "capture"}
                  {active.note ? <> · <span style={{ color: C.ink }}>{active.note}</span></> : null}
                </div>
                <div
                  ref={wrapRef}
                  style={{
                    position: "relative", border: `1px solid ${C.line}`,
                    borderRadius: 10, overflow: "hidden", lineHeight: 0,
                    maxWidth: "100%", boxShadow: C.shadow, background: C.void,
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    width={CW}
                    height={CH}
                    onMouseDown={onDown}
                    onMouseMove={onMove}
                    onMouseUp={onUp}
                    onMouseLeave={onUp}
                    style={{
                      display: "block", width: "100%", height: "auto",
                      cursor: drawing ? "crosshair" : "default", touchAction: "none",
                    }}
                  />
                </div>
                <div style={{
                  marginTop: 12, fontSize: 12, color: C.sub, maxWidth: 520, textAlign: "center", lineHeight: 1.45,
                }}>
                  Drag empty space to draw · click a box to select · drag corners to resize · pick a class on the right
                </div>
              </>
            ) : (
              <div style={{
                textAlign: "center", padding: 40, maxWidth: 400,
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px",
                  background: C.brandSoft, color: C.brand, display: "grid", placeItems: "center",
                  fontSize: 22, fontWeight: 800,
                }}>
                  ✓
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 6 }}>
                  Nothing to review
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
                  New frames appear when cameras harvest uncertain detections or you flag a live frame with Teach.
                </div>
              </div>
            )}
          </main>

          {/* class palette */}
          <aside style={{
            width: 250, borderLeft: `1px solid ${C.line}`, background: C.panel,
            padding: 14, display: "flex", flexDirection: "column", flexShrink: 0,
          }}>
            <div style={{
              ...mono, fontSize: 10.5, color: C.sub, textTransform: "uppercase", letterSpacing: 1,
              marginBottom: 10, fontWeight: 700,
            }}>
              {selected ? "Class for selected box" : "Select a box to relabel"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {classes.map((c) => {
                const cur = selected && boxes.find((b) => b.id === selected)?.cls === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => relabel(c)}
                    disabled={!selected}
                    style={{
                      ...mono, fontSize: 11, padding: "5px 8px", borderRadius: 6,
                      cursor: selected ? "pointer" : "not-allowed",
                      background: cur ? clsColor(c) : C.panel2,
                      color: cur ? "#fff" : selected ? C.ink : C.sub,
                      border: `1px solid ${cur ? clsColor(c) : C.line}`,
                      opacity: selected ? 1 : 0.55,
                      fontWeight: cur ? 700 : 500,
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={delBox}
              disabled={!selected}
              style={{
                ...btnDangerOutline,
                marginBottom: 16,
                opacity: selected ? 1 : 0.4,
                cursor: selected ? "pointer" : "not-allowed",
              }}
            >
              Delete selected box
            </button>

            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ ...mono, fontSize: 11, color: C.sub }}>
                {boxes.length} box{boxes.length === 1 ? "" : "es"} on this frame
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!activeId || saving}
                style={{ ...btnSuccess, opacity: !activeId || saving ? 0.55 : 1 }}
              >
                {saving ? "Saving…" : "Save labels → train"}
              </button>
              <button
                type="button"
                onClick={ignore}
                disabled={!activeId || saving}
                style={{ ...btnSecondary, opacity: !activeId || saving ? 0.55 : 1 }}
              >
                Ignore frame
              </button>
            </div>
          </aside>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: "0 10px 40px rgba(0,0,0,.22)",
          borderLeft: `3px solid ${toast.color}`, zIndex: 50, maxWidth: "min(480px, 92vw)",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, pending }) {
  const online = status === "online";
  const offline = status === "offline";
  return (
    <span style={{
      ...mono, fontSize: 12, fontWeight: 700,
      color: online ? C.ok : offline ? C.danger : C.warn,
      background: online ? C.okSoft : offline ? C.dangerSoft : C.warnSoft,
      padding: "5px 10px", borderRadius: 8,
    }}>
      {status} · {pending} pending
    </span>
  );
}

const btnPrimary = {
  fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
  padding: "8px 14px", borderRadius: 9, cursor: "pointer",
  background: C.brand, color: "#fff", border: `1px solid ${C.brand}`,
};
const btnSecondary = {
  fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
  padding: "8px 14px", borderRadius: 9, cursor: "pointer",
  background: C.panel, color: C.sub, border: `1px solid ${C.line}`,
};
const btnSuccess = {
  fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
  padding: "10px 14px", borderRadius: 9, cursor: "pointer",
  background: C.ok, color: "#fff", border: `1px solid ${C.ok}`,
};
const btnDangerOutline = {
  fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
  padding: "8px 14px", borderRadius: 9, cursor: "pointer",
  background: C.dangerSoft, color: C.danger, border: `1px solid #f5c2c8`,
};
const kbd = {
  display: "inline-block", padding: "1px 5px", borderRadius: 4,
  background: C.panel, border: `1px solid ${C.line}`, fontSize: 10,
  fontFamily: "IBM Plex Mono, monospace", margin: "0 1px",
};
