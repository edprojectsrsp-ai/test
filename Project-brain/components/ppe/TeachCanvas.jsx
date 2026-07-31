"use client";
/**
 * TeachCanvas — correct a frozen frame's boxes, wherever the frame came from.
 *
 * The same editor serves live teaching and teaching over recorded footage,
 * because the correction is identical in both: the model drew boxes on a still
 * image and a human is fixing them. Only the image URL and the save endpoint
 * differ, so those are props and everything else is shared.
 *
 * Three edits, and all three matter for different reasons:
 *
 *   flip    fastest fix for the common case — a worker plainly wearing a
 *           helmet marked "Cap Not found"
 *   draw    the only way to correct a MISS. A missed worker produces no box,
 *           so there is nothing to click; without drawing, the highest-value
 *           training signal is unreachable
 *   delete  the only way to say "the model saw gear that is not there". A
 *           false positive cannot be expressed by editing a box, only by
 *           removing it
 *
 * The parent sends the surviving boxes as the COMPLETE intended label set, so
 * deletion is expressed by absence — which is exactly what the backend expects.
 *
 * `onVideoOverlay` lightens the tool text for the freeze modal, which floats
 * over video on a dark scrim. It is NOT a dark-mode switch — this UI is
 * light-only by decision — it is contrast against a dark backdrop.
 */
import React, { useEffect, useRef, useState } from "react";

const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)",
  sub: "var(--ink-3)", faint: "var(--ink-4)", line: "var(--line)",
  ok: "#0a8f5b", danger: "#c02b3c",
};
const mono = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontVariantNumeric: "tabular-nums",
};

export const boxColor = (kind) => (kind === "violation" ? "#e5484d"
  : kind === "person" ? "#4c9ffe" : "#30a46c");

const kindOf = (cls) => (cls.startsWith("no_") ? "violation"
  : cls === "person" ? "person" : "gear");

function MiniBtn({ children, onClick, tone = "plain", title }) {
  const t = {
    plain: { bg: C.panel, fg: C.ink, bd: C.line },
    ok: { bg: "#e6f6ef", fg: C.ok, bd: "#b8e6d0" },
    danger: { bg: "#fdecee", fg: C.danger, bd: "#f5c2c8" },
  }[tone];
  return (
    <button type="button" onClick={onClick} title={title} style={{
      border: `1px solid ${t.bd}`, background: t.bg, color: t.fg,
      borderRadius: 7, padding: "4px 9px", fontSize: 11.5, fontWeight: 800,
      cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {children}
    </button>
  );
}

export default function TeachCanvas({
  imgUrl, width, height, boxes, setBoxes,
  palette = {}, classes = [], defaultClass = "no_helmet", onVideoOverlay = false,
}) {
  const wrapRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [sel, setSel] = useState(null);
  const [newCls, setNewCls] = useState(defaultClass);

  // objectFit:contain letterboxes the image, so frame coordinates only map
  // correctly through the inner rect — not the wrapper's own box.
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el || !width || !height) return setRect(null);
      const r = el.getBoundingClientRect();
      const scale = Math.min(r.width / width, r.height / height);
      setRect({
        x: (r.width - width * scale) / 2, y: (r.height - height * scale) / 2,
        scale,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [width, height, imgUrl]);

  const toFrame = (clientX, clientY) => {
    const el = wrapRef.current;
    if (!el || !rect) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, (clientX - r.left - rect.x) / rect.scale)),
      y: Math.max(0, Math.min(height, (clientY - r.top - rect.y) / rect.scale)),
    };
  };

  const onDown = (e) => {
    if (e.target.dataset?.box) return;      // let box clicks select instead
    const p = toFrame(e.clientX, e.clientY);
    if (p) setDrawing({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };
  const onMove = (e) => {
    if (!drawing) return;
    const p = toFrame(e.clientX, e.clientY);
    if (p) setDrawing((d) => ({ ...d, x2: p.x, y2: p.y }));
  };
  const onUp = () => {
    if (!drawing) return;
    const { x1, y1, x2, y2 } = drawing;
    const box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    setDrawing(null);
    // A click with no drag means "deselect", not "add a zero-area box" — which
    // the backend would reject anyway, after the operator lost their selection.
    if (box[2] - box[0] < 6 || box[3] - box[1] < 6) { setSel(null); return; }
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBoxes((prev) => [...prev, {
      i: id, cls: newCls, xyxy: box, conf: 1, kind: kindOf(newCls),
      label: palette[newCls] || newCls, added: true, known: true, counterpart: null,
    }]);
    setSel(id);
  };

  const patch = (id, next) => setBoxes(
    (prev) => prev.map((b) => (b.i === id ? { ...b, ...next, edited: true } : b)));

  const flip = (b) => b.counterpart && patch(b.i, {
    cls: b.counterpart, counterpart: b.cls, kind: kindOf(b.counterpart),
    label: palette[b.counterpart] || b.counterpart,
  });
  const retype = (b, cls) => patch(b.i, {
    cls, kind: kindOf(cls), label: palette[cls] || cls, counterpart: null,
  });
  const drop = (b) => { setBoxes((prev) => prev.filter((x) => x.i !== b.i)); setSel(null); };

  const selected = boxes.find((b) => b.i === sel);
  const field = {
    padding: "4px 8px", borderRadius: 7, fontSize: 11.5, ...mono,
    border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
  };

  return (
    <div>
      <div
        ref={wrapRef}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        style={{
          position: "relative", width: "100%", aspectRatio: `${width || 16} / ${height || 9}`,
          maxHeight: "62vh", margin: "0 auto",
          background: "#0b0f14", borderRadius: 10, overflow: "hidden",
          cursor: "crosshair", userSelect: "none",
        }}
      >
        {imgUrl ? (
          <img src={imgUrl} alt="Frozen frame for labelling" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : null}

        {rect ? boxes.map((b) => {
          const [x1, y1, x2, y2] = b.xyxy;
          const col = boxColor(b.kind);
          const active = sel === b.i;
          return (
            <div
              key={b.i} data-box="1"
              onMouseDown={(e) => { e.stopPropagation(); setSel(b.i); }}
              style={{
                position: "absolute",
                left: rect.x + x1 * rect.scale, top: rect.y + y1 * rect.scale,
                width: Math.max(6, (x2 - x1) * rect.scale),
                height: Math.max(6, (y2 - y1) * rect.scale),
                border: `${active ? 3 : 2}px ${b.added ? "dashed" : "solid"} ${col}`,
                borderRadius: 3, cursor: "pointer",
                background: active ? `${col}22` : "transparent",
                boxShadow: active ? `0 0 0 2px ${col}66` : "none",
              }}
            >
              <span style={{
                position: "absolute", top: -19, left: -2, whiteSpace: "nowrap",
                background: col, color: "#fff", fontSize: 10, fontWeight: 800,
                padding: "1px 5px", borderRadius: 3, ...mono, pointerEvents: "none",
              }}>
                {b.label}{b.added ? " +" : b.edited ? " ✎" : ""}
              </span>
            </div>
          );
        }) : null}

        {drawing && rect ? (
          <div style={{
            position: "absolute",
            left: rect.x + Math.min(drawing.x1, drawing.x2) * rect.scale,
            top: rect.y + Math.min(drawing.y1, drawing.y2) * rect.scale,
            width: Math.abs(drawing.x2 - drawing.x1) * rect.scale,
            height: Math.abs(drawing.y2 - drawing.y1) * rect.scale,
            border: "2px dashed #fff", background: "rgba(255,255,255,.14)",
            pointerEvents: "none",
          }} />
        ) : null}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 9,
        flexWrap: "wrap", color: onVideoOverlay ? "#c5d0db" : C.ink,
      }}>
        <span style={{ fontSize: 11.5, color: onVideoOverlay ? "#9bb0c3" : C.sub, fontWeight: 700 }}>
          Draw as
        </span>
        <select
          value={newCls} onChange={(e) => setNewCls(e.target.value)}
          title="Class given to the next box you drag on the image"
          style={field}
        >
          {classes.map((c) => <option key={c} value={c}>{palette[c] || c} ({c})</option>)}
        </select>

        {selected ? (
          <>
            <span style={{ width: 1, height: 18, background: C.line }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: boxColor(selected.kind) }}>
              {selected.label}
            </span>
            {selected.counterpart ? (
              <MiniBtn tone="ok" onClick={() => flip(selected)}
                title="Swap to the opposite: worn ⇄ missing">⇄ Flip</MiniBtn>
            ) : null}
            <select value={selected.cls} onChange={(e) => retype(selected, e.target.value)}
              title="Change this box's class outright" style={field}>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <MiniBtn tone="danger" onClick={() => drop(selected)}
              title="Remove this box. Saving without it teaches the model nothing is here — the only way to correct a false positive.">
              ✕ Delete
            </MiniBtn>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: onVideoOverlay ? "#7a8fa3" : C.faint }}>
            Drag on the image to add a box the model missed · click a box to edit it
          </span>
        )}
      </div>
    </div>
  );
}
