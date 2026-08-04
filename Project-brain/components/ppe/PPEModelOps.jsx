"use client";
/**
 * PPEModelOps — can you prove the model got better?
 *
 * Four questions, in the order you have to answer them:
 *
 *   Golden    which frames is the model judged on, and what do they not cover?
 *   Evaluate  how does a model score on them, per class — not just overall?
 *   Shadow    where does a candidate disagree with the model now serving?
 *   Drift     what has changed under a model that has not changed?
 *
 * The framing throughout is that an aggregate number is not an answer. A
 * challenger can lift overall mAP while collapsing on the one class a site
 * actually enforces, and the average will happily hide it — so every view here
 * leads with the per-class breakdown and reports the support behind each number,
 * because a class with two labelled instances cannot support a decision.
 *
 * Colour choices worth stating, since they are load-bearing rather than taste:
 *
 *  - Deltas use a blue↔red diverging pair, never red↔green. Improvement/
 *    regression is the textbook case where a red-green scale collapses into a
 *    single colour for the ~8% of men with protanopia or deuteranopia — the
 *    exact readers who must not misread a regression. Validated: worst-pair
 *    CVD ΔE 21.6, normal-vision 32.3, both far clear of the floors.
 *  - The confusion matrix is one hue, light→dark, because its job is magnitude.
 *  - Sign is never carried by colour alone: every delta shows a signed number
 *    and sits on a labelled side of the zero axis.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { buildPpeUrl, getPpeApiBase } from "../../lib/ppeApi";


const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)",
  sub: "var(--ink-3)", faint: "var(--ink-4)", line: "var(--line)",
  shadow: "var(--shadow)", steel: "var(--steel)",
};

/* Viz tokens. Diverging poles + a neutral midpoint, and a one-hue sequential
   ramp for the matrix, all validated against the light panel surface this UI
   renders on. The PPE section is light-only by decision — no dark theme — so
   these are single-mode steps and there is no second set to keep in step. */
const VIZ = {
  pos: "#2a78d6",          // improvement — cool pole
  neg: "#e34948",          // regression  — warm pole
  mid: "#f0efec",          // neutral zero
  seq: ["#eef4fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"],
  grid: "#e6ebf1",
  good: "#0ca30c", warn: "#fab219", critical: "#d03b3b",
};
const mono = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontVariantNumeric: "tabular-nums",
};

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
  method: "POST", headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const signed = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;

/* ------------------------------------------------------------------ chrome */
function Btn({ children, onClick, tone = "plain", disabled, title, small }) {
  const t = {
    plain: { bg: C.panel, fg: C.ink, bd: C.line },
    primary: { bg: C.steel, fg: "#fff", bd: C.steel },
    danger: { bg: "#fdecee", fg: "#c02b3c", bd: "#f5c2c8" },
    ok: { bg: "#e6f6ef", fg: "#0a8f5b", bd: "#b8e6d0" },
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        border: `1px solid ${t.bd}`, background: t.bg, color: t.fg,
        borderRadius: 9, padding: small ? "5px 10px" : "7px 13px",
        fontSize: small ? 11.5 : 12.5, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}>
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
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800 }}>{title}</h3>
          <div style={{ flex: 1 }} />
          {right}
        </header>
      ) : null}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

/* A stat tile, not a one-bar chart: a single current value reads faster as a
   number than as a mark that has to be measured against an axis. */
function Stat({ label, value, hint, tone }) {
  return (
    <div title={hint} style={{
      flex: "1 1 150px", padding: "11px 14px", borderRadius: 11,
      background: C.panel, border: `1px solid ${C.line}`, boxShadow: C.shadow,
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
        color: C.sub, fontWeight: 700 }}>{label}</div>
      <div style={{ ...mono, fontSize: 22, fontWeight: 800, marginTop: 3,
        color: tone || C.ink }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: C.faint, marginTop: 3,
        lineHeight: 1.35 }}>{hint}</div> : null}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.6,
    padding: "6px 2px" }}>{children}</div>;
}

/* --------------------------------------------------------- per-class deltas */
/**
 * Diverging bars: per-class change from incumbent to challenger.
 *
 * Job is polarity (better/worse against a baseline), so: two hues, neutral
 * midpoint, bars growing from a centred zero axis. The signed number is printed
 * on every bar — colour states the direction, text states it again, so the
 * chart never depends on hue alone.
 */
function DeltaChart({ rows }) {
  const [hover, setHover] = useState(null);

  // Scale from the classes that can actually gate, not from every row.
  // A class with two golden instances can swing +/-40 points on one frame, and
  // letting it set the axis compresses every trustworthy bar into the middle —
  // the class that genuinely blocks promotion ends up drawn SHORTER than the
  // noise. Low-support bars are clamped to the axis and marked, so they stay
  // visible without dominating the chart they cannot support.
  const gated = rows.filter((r) => r.support >= (r.min_support ?? 5));
  const max = Math.max(0.05,
    ...(gated.length ? gated : rows).map((r) => Math.abs(r.delta)));

  if (!rows.length) return <Empty>No overlapping classes to compare.</Empty>;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 9, fontSize: 11,
        fontWeight: 700, color: C.sub, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: VIZ.neg }} />
          Regressed
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: VIZ.pos }} />
          Improved
        </span>
        <span style={{ color: C.faint, fontWeight: 600 }}>
          mAP50 change, percentage points
        </span>
      </div>

      <div style={{ display: "grid", gap: 5 }}>
        {rows.map((r) => {
          const raw = Math.abs(r.delta) / max;
          const frac = Math.min(1, raw);
          const clipped = raw > 1;
          const positive = r.delta >= 0;
          const col = positive ? VIZ.pos : VIZ.neg;
          const thin = r.support < (r.min_support ?? 5);
          return (
            <div key={r.cls_name}
              onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}
              style={{ display: "grid", gridTemplateColumns: "120px 1fr 62px",
                alignItems: "center", gap: 8, cursor: "default" }}>
              <span style={{ ...mono, fontSize: 11.5, textAlign: "right",
                color: r.blocking ? VIZ.critical : C.ink,
                fontWeight: r.blocking ? 800 : 600, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.blocking ? "⚠ " : ""}{r.cls_name}
              </span>

              {/* centred zero axis; bars grow outward from it */}
              <div style={{ position: "relative", height: 18 }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0,
                  width: 1, background: VIZ.grid }} />
                <div style={{
                  position: "absolute", top: 3, bottom: 3,
                  ...(positive
                    ? { left: "50%", marginLeft: 1,
                      borderRadius: clipped ? "0 1px 1px 0" : "0 4px 4px 0" }
                    : { right: "50%", marginRight: 1,
                      borderRadius: clipped ? "1px 0 0 1px" : "4px 0 0 4px" }),
                  width: `calc(${(frac * 50).toFixed(2)}% - 1px)`,
                  background: col, opacity: thin ? 0.42 : 1,
                }} />
                {/* A squared-off end plus a chevron says "runs past the axis",
                    so a clamped bar is never misread as exactly full scale. */}
                {clipped ? (
                  <span style={{
                    position: "absolute", top: 1,
                    ...(positive ? { right: 2 } : { left: 2 }),
                    fontSize: 11, fontWeight: 800, color: col, opacity: 0.8,
                    lineHeight: "16px",
                  }}>{positive ? "›" : "‹"}</span>
                ) : null}
              </div>

              <span style={{ ...mono, fontSize: 11.5, fontWeight: 800,
                color: positive ? VIZ.pos : VIZ.neg, textAlign: "right" }}>
                {signed(r.delta)}
              </span>
            </div>
          );
        })}
      </div>

      {hover ? (
        <div role="status" style={{
          marginTop: 10, padding: "8px 11px", borderRadius: 9,
          background: C.panel2, border: `1px solid ${C.line}`, fontSize: 11.5,
          color: C.sub, lineHeight: 1.5,
        }}>
          <b style={{ ...mono, color: C.ink }}>{hover.cls_name}</b> ·{" "}
          incumbent {pct(hover.incumbent_map50)} → challenger{" "}
          {pct(hover.challenger_map50)} · {hover.support} golden instance
          {hover.support === 1 ? "" : "s"}
          {hover.blocking ? (
            <b style={{ color: VIZ.critical }}> — blocks promotion</b>
          ) : hover.support < (hover.min_support ?? 5) ? (
            <span style={{ color: C.faint }}>
              {" "}— too few instances to gate on; shown for information
            </span>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.faint }}>
          Hover a class for its before/after and how many golden instances
          back it. Faded bars have too little support to block a promotion.
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- confusion matrix */
/**
 * What gets mistaken for what. Magnitude in a grid, so: heatmap, one hue,
 * light→dark. Rows are truth, columns are prediction; the diagonal is correct.
 * Only classes the golden set actually contains are drawn — a 21×21 grid of
 * mostly zeros hides the four cells that matter.
 */
function ConfusionMatrix({ confusion }) {
  const [hover, setHover] = useState(null);
  const data = useMemo(() => {
    const labels = confusion?.labels || [];
    const rows = confusion?.rows || [];
    if (!labels.length || !rows.length) return null;
    // keep only indices with any signal, in either direction
    const keep = labels.map((_, i) => i).filter((i) =>
      rows.some((r, ri) => (r[i] || 0) > 0 || (ri === i && (rows[i]?.[i] || 0) > 0))
      || (rows[i] || []).some((v) => v > 0));
    if (!keep.length) return null;
    const max = Math.max(1, ...keep.flatMap((r) => keep.map((c) => rows[r]?.[c] || 0)));
    return { labels, keep, rows, max };
  }, [confusion]);

  if (!data) {
    return <Empty>
      No confusion matrix for this run — it is produced during evaluation, so
      re-evaluate if this run predates that.
    </Empty>;
  }
  const { labels, keep, rows, max } = data;
  const step = (v) => {
    if (!v) return "transparent";
    const i = Math.min(VIZ.seq.length - 1,
      Math.max(1, Math.round((v / max) * (VIZ.seq.length - 1))));
    return VIZ.seq[i];
  };

  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 9, lineHeight: 1.5 }}>
        Rows are ground truth, columns are what the model predicted. The
        diagonal is correct; everything off it is a specific, fixable mistake —
        an off-diagonal cell in the <code>background</code> column is a miss,
        and one in a <code>background</code> row is a false positive.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 2, ...mono,
          fontSize: 10.5 }}>
          <thead>
            <tr>
              <th />
              {keep.map((c) => (
                <th key={c} style={{ padding: "2px 4px", color: C.sub,
                  fontWeight: 700, writingMode: "vertical-rl",
                  transform: "rotate(180deg)", whiteSpace: "nowrap",
                  maxHeight: 88 }}>
                  {labels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keep.map((r) => (
              <tr key={r}>
                <th style={{ padding: "2px 7px 2px 0", textAlign: "right",
                  color: C.sub, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {labels[r]}
                </th>
                {keep.map((c) => {
                  const v = rows[r]?.[c] || 0;
                  const diag = r === c;
                  return (
                    <td key={c}
                      onMouseEnter={() => setHover({ r, c, v })}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        width: 30, height: 24, textAlign: "center",
                        borderRadius: 3, background: step(v),
                        outline: diag ? `1px solid ${VIZ.grid}` : "none",
                        color: v / max > 0.55 ? "#fff" : v ? C.ink : C.faint,
                        fontWeight: diag ? 800 : 600,
                      }}>
                      {v || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 9, fontSize: 11.5, color: hover ? C.ink : C.faint,
        minHeight: 17 }}>
        {hover
          ? (hover.r === hover.c
            ? <><b>{hover.v}</b> × <b>{labels[hover.r]}</b> correctly identified</>
            : <><b>{hover.v}</b> × true <b>{labels[hover.r]}</b> predicted as{" "}
              <b>{labels[hover.c]}</b></>)
          : "Hover a cell to read it."}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ golden set tab */
function GoldenTab({ golden, onRefresh }) {
  const [cands, setCands] = useState([]);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setCands((await api("/api/modelops/golden/candidates?limit=40")).candidates || []); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const support = golden?.class_support || {};
  const classes = Object.entries(support).sort((a, b) => b[1] - a[1]);
  const gate = golden?.min_support_to_gate ?? 5;
  const maxSupport = Math.max(1, ...classes.map(([, n]) => n));

  const mark = async (ids, on = true) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await post("/api/modelops/golden/mark", { capture_ids: ids, golden: on });
      setMsg(r.warning || `${r.marked.length} frame(s) ${on ? "held out" : "returned to training"}`);
      setPicked({});
      await Promise.all([load(), onRefresh()]);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const chosen = Object.keys(picked).filter((k) => picked[k]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="What the golden set covers"
        right={<Btn small onClick={onRefresh}>Rebuild</Btn>}>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12, lineHeight: 1.6 }}>
          These frames are held out of training <b>permanently</b>, so every
          model can be scored on identical data it has never fitted. A class
          needs at least <b>{gate}</b> instances before a drop in it is allowed
          to block a promotion — below that the number swings on which single
          frame happened to be labelled.
        </div>

        {classes.length ? (
          <div style={{ display: "grid", gap: 4 }}>
            {classes.map(([name, n]) => {
              const thin = n < gate;
              return (
                <div key={name} title={thin
                  ? `${n} instance(s) — below the ${gate} needed to gate on this class`
                  : `${n} instance(s) — enough to gate on`}
                  style={{ display: "grid",
                    gridTemplateColumns: "128px 1fr 92px", gap: 8,
                    alignItems: "center" }}>
                  <span style={{ ...mono, fontSize: 11.5, textAlign: "right",
                    color: C.ink, overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap" }}>{name}</span>
                  <div style={{ position: "relative", height: 16 }}>
                    <div style={{ position: "absolute", top: 3, bottom: 3, left: 0,
                      width: `${(n / maxSupport) * 100}%`, borderRadius: "0 4px 4px 0",
                      background: thin ? VIZ.seq[2] : VIZ.seq[4] }} />
                    {/* gate threshold — a reference line, not a series */}
                    <div style={{ position: "absolute", top: 0, bottom: 0,
                      left: `${(gate / maxSupport) * 100}%`, width: 1,
                      background: VIZ.grid }} />
                  </div>
                  <span style={{ ...mono, fontSize: 11, fontWeight: 700,
                    color: thin ? "#8a5200" : C.sub }}>
                    {n}{thin ? " ⚠ thin" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>
            The golden set is empty, so there is no regression check at all —
            training will promote whatever it produces. Hold out a few labelled
            frames below to turn the gate on.
          </Empty>
        )}

        {golden?.absent_classes?.length ? (
          <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 9,
            background: "#fdf1e3", border: "1px solid #f0d4a8", color: "#8a5200",
            fontSize: 11.5, lineHeight: 1.5 }}>
            <b>Not covered at all:</b>{" "}
            <span style={mono}>{golden.absent_classes.join(", ")}</span>
            <div style={{ marginTop: 4 }}>
              A regression in any of these is invisible to the gate. If you
              enforce one of them on a camera, hold out some frames containing it.
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Frames worth holding out"
        right={chosen.length ? (
          <Btn small tone="primary" disabled={busy}
            onClick={() => mark(chosen, true)}>
            Hold out {chosen.length}
          </Btn>
        ) : null}>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 11, lineHeight: 1.55 }}>
          Ordered by what the set is missing, not by date — another hundred
          helmet frames add nothing once helmet is covered, while one harness
          frame can be the difference between a gate that works and one that
          cannot see the class.
        </div>
        {cands.length ? (
          <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {cands.map((c) => (
              <label key={c.capture_id} style={{
                display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
                borderRadius: 9, border: `1px solid ${C.line}`,
                background: picked[c.capture_id] ? "var(--steel-soft, #eff6ff)" : C.panel,
                cursor: "pointer",
              }}>
                <input type="checkbox" checked={Boolean(picked[c.capture_id])}
                  onChange={(e) => setPicked((p) => ({ ...p, [c.capture_id]: e.target.checked }))} />
                <span style={{ ...mono, fontSize: 11.5, minWidth: 92 }}>{c.camera_id}</span>
                <span style={{ fontSize: 11.5, color: C.sub, flex: 1 }}>
                  {c.classes.join(", ")}
                </span>
                {c.already_exported ? (
                  <span title="Already baked into a training dataset — models trained before now have seen it, so it will score optimistically until you retrain."
                    style={{ fontSize: 10, fontWeight: 800, color: "#8a5200",
                      background: "#fdf1e3", border: "1px solid #f0d4a8",
                      borderRadius: 5, padding: "1px 6px" }}>
                    already trained on
                  </span>
                ) : null}
                <span style={{ fontSize: 10.5, color: C.faint }}>{c.why}</span>
              </label>
            ))}
          </div>
        ) : <Empty>No labelled frames available. Label some in Review & Teach first.</Empty>}
        {msg ? <div style={{ marginTop: 10, fontSize: 11.5, color: C.sub,
          lineHeight: 1.5 }}>{msg}</div> : null}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- evaluate tab */
function EvaluateTab({ golden, onRefresh }) {
  const [runs, setRuns] = useState([]);
  const [models, setModels] = useState([]);
  const [pick, setPick] = useState("live");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState(null);
  const [cmp, setCmp] = useState({ a: "", b: "", result: null, error: "" });

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        api("/api/modelops/runs?limit=40"),
        api("/api/models").catch(() => ({ versions: [] })),
      ]);
      setRuns(r.runs || []);
      setModels(m.versions || []);
    } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const evaluate = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await post("/api/modelops/evaluate", { model: pick });
      setMsg(r.cached
        ? "Already scored on this exact golden set — showing the stored run."
        : `Scored in ${r.duration_s ?? "?"}s`);
      setDetail(await api(`/api/modelops/runs/${r.run_id}`));
      await Promise.all([load(), onRefresh()]);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const doCompare = async () => {
    if (!cmp.a || !cmp.b) return;
    setCmp((c) => ({ ...c, result: null, error: "" }));
    try {
      const r = await api(`/api/modelops/compare?a=${cmp.a}&b=${cmp.b}`);
      setCmp((c) => ({ ...c, result: r }));
    } catch (e) { setCmp((c) => ({ ...c, error: e.message })); }
  };

  const deltaRows = useMemo(() => {
    const v = cmp.result?.verdict;
    if (!v) return [];
    const all = [...(v.regressions || []), ...(v.improvements || [])];
    return all
      .map((r) => ({ ...r, min_support: golden?.min_support_to_gate ?? 5 }))
      .sort((a, b) => a.delta - b.delta);
  }, [cmp.result, golden]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Score a model on the golden set">
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12.5, ...mono,
              border: `1px solid ${C.line}`, background: C.panel, color: C.ink }}>
            <option value="live">live model (serving now)</option>
            {models.map((m) => (
              <option key={m.version} value={String(m.version)}>
                v{m.version}{m.is_active ? " (active)" : ""} — {m.note?.slice(0, 40)}
              </option>
            ))}
          </select>
          <Btn tone="primary" onClick={evaluate}
            disabled={busy || !golden?.ready}>
            {busy ? "Scoring…" : "Evaluate"}
          </Btn>
          {!golden?.ready ? (
            <span style={{ fontSize: 11.5, color: "#8a5200" }}>
              Needs at least 5 golden frames.
            </span>
          ) : null}
          {msg ? <span style={{ fontSize: 11.5, color: C.sub }}>{msg}</span> : null}
        </div>
      </Card>

      {detail ? (
        <Card title={`${detail.label} — on ${detail.golden_images} held-out frames`}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
            <Stat label="mAP50" value={pct(detail.map50)} />
            <Stat label="mAP50-95" value={pct(detail.map50_95)} />
            <Stat label="Precision" value={pct(detail.precision)} />
            <Stat label="Recall" value={pct(detail.recall)}
              hint="Missed violations live here — on a safety system this is the number that matters most" />
          </div>

          <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800 }}>
            Per class
          </h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ color: C.sub, textAlign: "left" }}>
                  {["Class", "Support", "mAP50", "Precision", "Recall"].map((h) => (
                    <th key={h} style={{ padding: "5px 8px", fontWeight: 700,
                      borderBottom: `1px solid ${C.line}`,
                      textAlign: h === "Class" ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(detail.per_class || []).sort((a, b) => a.map50 - b.map50).map((r) => (
                  <tr key={r.cls_name}>
                    <td style={{ padding: "5px 8px", ...mono }}>{r.cls_name}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", ...mono,
                      color: r.support < (golden?.min_support_to_gate ?? 5)
                        ? "#8a5200" : C.sub }}>
                      {r.support}
                    </td>
                    {["map50", "precision", "recall"].map((k) => (
                      <td key={k} style={{ padding: "5px 8px", textAlign: "right", ...mono }}>
                        {pct(r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ margin: "16px 0 8px", fontSize: 12, fontWeight: 800 }}>
            Confusion matrix
          </h4>
          <ConfusionMatrix confusion={detail.confusion} />
        </Card>
      ) : null}

      <Card title="Compare two runs">
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 11, lineHeight: 1.55 }}>
          Only runs scored on the same golden set can be compared. A delta
          between a score on 40 frames and one on 200 is not a smaller or larger
          number — it is a different question, so the comparison refuses rather
          than returning something meaningless.
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {[["a", "Incumbent"], ["b", "Challenger"]].map(([k, label]) => (
            <label key={k} style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: C.sub,
                textTransform: "uppercase" }}>{label}</span>
              <select value={cmp[k]} onChange={(e) => setCmp((c) => ({ ...c, [k]: e.target.value }))}
                style={{ padding: "6px 9px", borderRadius: 8, fontSize: 12, ...mono,
                  border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
                  maxWidth: 300 }}>
                <option value="">choose a run…</option>
                {runs.filter((r) => r.status === "done").map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {pct(r.map50)} · {r.golden_version}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Btn onClick={doCompare} disabled={!cmp.a || !cmp.b}>Compare</Btn>
        </div>

        {cmp.error ? (
          <div style={{ marginTop: 12, padding: "10px 13px", borderRadius: 9,
            background: "#fdf1e3", border: "1px solid #f0d4a8", color: "#8a5200",
            fontSize: 12, lineHeight: 1.5 }}>{cmp.error}</div>
        ) : null}

        {cmp.result ? (
          <div style={{ marginTop: 14 }}>
            <div style={{
              padding: "12px 14px", borderRadius: 11, marginBottom: 14,
              background: cmp.result.verdict.promote ? "#e6f6ef" : "#fdecee",
              border: `1px solid ${cmp.result.verdict.promote ? "#b8e6d0" : "#f5c2c8"}`,
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 800,
                color: cmp.result.verdict.promote ? "#0a8f5b" : "#c02b3c" }}>
                {cmp.result.verdict.promote
                  ? "✓ Would be promoted"
                  : "✕ Would be blocked"}
              </div>
              <ul style={{ margin: "7px 0 0", paddingLeft: 18, fontSize: 12,
                color: C.sub, lineHeight: 1.6 }}>
                {[...cmp.result.verdict.blocking, ...cmp.result.verdict.reasons]
                  .map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <DeltaChart rows={deltaRows} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- shadow tab */
function ShadowTab() {
  const [status, setStatus] = useState(null);
  const [verdicts, setVerdicts] = useState([]);
  const [models, setModels] = useState([]);
  const [pick, setPick] = useState("");
  const [rate, setRate] = useState(0.15);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, v, m] = await Promise.all([
        api("/api/modelops/shadow/status"),
        api("/api/modelops/shadow/verdicts?adjudicated=pending&limit=24"),
        api("/api/models").catch(() => ({ versions: [] })),
      ]);
      setStatus(s); setVerdicts(v.verdicts || []); setModels(m.versions || []);
      if (!pick && m.versions?.length) setPick(String(m.versions[0].version));
    } catch (e) { setMsg(e.message); }
  }, [pick]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      await post("/api/modelops/shadow/start", { model: pick, sample_rate: Number(rate) });
      await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try { await post("/api/modelops/shadow/stop"); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const judge = async (id, winner) => {
    try {
      await post(`/api/modelops/shadow/verdicts/${id}/adjudicate`,
        { winner, teach: winner !== "neither" });
      setVerdicts((v) => v.filter((x) => x.id !== id));
    } catch (e) { setMsg(e.message); }
  };

  const st = status?.stats || {};
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Run a candidate against live traffic"
        right={status?.running
          ? <Btn small tone="danger" onClick={stop} disabled={busy}>Stop</Btn>
          : null}>
        <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12, lineHeight: 1.6 }}>
          A golden set is, by construction, the cases someone thought to keep —
          the night shift in the rain is not in it. Shadow mode scores a
          candidate on the frames you are <b>actually</b> seeing and records only
          where the two models disagree. Every disagreement is a frame where they
          cannot both be right, which makes it both the evidence for promotion
          and the most valuable frame you could label.
        </div>

        {status?.running ? (
          <>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
              <Stat label="Agreement" value={pct(status.agreement_rate)}
                hint={`${st.frames_scored} frames scored`} />
              <Stat label="Candidate saw more" value={st.candidate_found ?? 0}
                hint="Boxes live missed — the interesting direction on a safety system" />
              <Stat label="Live saw more" value={st.live_found ?? 0}
                hint="Boxes the candidate missed — promotion risk" />
              <Stat label="Class conflicts" value={st.class_conflicts ?? 0}
                hint="Both saw it, disagreed what it was" />
            </div>
            <div style={{ fontSize: 11.5, color: C.faint }}>
              {status.label} · sampling {pct(status.sample_rate)} of inferred
              frames · {st.frames_dropped ?? 0} dropped to protect live detection
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: C.sub,
                textTransform: "uppercase" }}>Candidate</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12.5, ...mono,
                  border: `1px solid ${C.line}`, background: C.panel, color: C.ink }}>
                {models.map((m) => (
                  <option key={m.version} value={String(m.version)}>
                    v{m.version}{m.is_active ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span title="Two models on every frame halves fleet capacity. A shadow run that degrades the detection it is measuring is a bad trade at any accuracy."
                style={{ fontSize: 10, fontWeight: 800, color: C.sub,
                  textTransform: "uppercase" }}>Sample rate</span>
              <select value={rate} onChange={(e) => setRate(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, fontSize: 12.5, ...mono,
                  border: `1px solid ${C.line}`, background: C.panel, color: C.ink }}>
                {[0.05, 0.1, 0.15, 0.25, 0.5].map((v) => (
                  <option key={v} value={v}>{v * 100}%</option>
                ))}
              </select>
            </label>
            <Btn tone="primary" onClick={start} disabled={busy || !pick}>
              {busy ? "Starting…" : "Start shadow run"}
            </Btn>
          </div>
        )}
        {msg ? <div style={{ marginTop: 9, fontSize: 11.5, color: "#c02b3c" }}>{msg}</div> : null}
      </Card>

      <Card title={`Disagreements awaiting a verdict${verdicts.length ? ` (${verdicts.length})` : ""}`}>
        {verdicts.length ? (
          <div style={{ display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {verdicts.map((v) => (
              <div key={v.id} style={{ border: `1px solid ${C.line}`,
                borderRadius: 11, overflow: "hidden" }}>
                <div style={{ position: "relative", aspectRatio: "16 / 9",
                  background: "#0b0f14" }}>
                  {v.has_image ? (
                    <img src={buildPpeUrl(`/api/modelops/shadow/verdicts/${v.id}/image.jpg`)}
                      alt="" loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : null}
                  <span style={{ position: "absolute", top: 6, left: 7, fontSize: 9.5,
                    fontWeight: 800, color: "#fff", padding: "2px 7px", borderRadius: 5,
                    background: v.kind === "candidate_found" ? VIZ.pos
                      : v.kind === "live_found" ? VIZ.neg : "#6b4fbb" }}>
                    {v.kind.replace("_", " ")}
                  </span>
                </div>
                <div style={{ padding: "9px 11px" }}>
                  <div style={{ ...mono, fontSize: 11.5, fontWeight: 800 }}>
                    {v.cls_name} · {v.camera_id}
                  </div>
                  <div style={{ fontSize: 11, color: C.sub, margin: "3px 0 9px" }}>
                    {v.kind === "candidate_found"
                      ? "Candidate saw this; the live model did not."
                      : v.kind === "live_found"
                        ? "Live model saw this; the candidate did not."
                        : "Both saw it and disagreed on the class."}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Btn small tone="ok" onClick={() => judge(v.id, "candidate")}
                      title="Candidate was right — its boxes become training data">
                      Candidate
                    </Btn>
                    <Btn small onClick={() => judge(v.id, "live")}
                      title="Live model was right — its boxes become training data">
                      Live
                    </Btn>
                    <Btn small tone="danger" onClick={() => judge(v.id, "neither")}
                      title="Both wrong — recorded, nothing taught">
                      Neither
                    </Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            Nothing to adjudicate. Start a shadow run and disagreements will
            collect here — each verdict is banked as training data, so this is
            the highest-yield labelling queue in the system.
          </Empty>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- drift tab */
function DriftTab() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setData(await api("/api/modelops/drift?hours=72")); }
    catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const reset = async (cam) => {
    try {
      await post(`/api/modelops/drift/${encodeURIComponent(cam)}/reset-baseline`);
      await load();
    } catch (e) { setMsg(e.message); }
  };

  const cams = data?.cameras || [];
  return (
    <Card title="Drift — what changed under a model that did not change">
      <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 13, lineHeight: 1.6 }}>
        A camera gets nudged, a floodlight fails, winter arrives and every worker
        puts on a jacket that reads as a vest. Every offline metric stays exactly
        where it was while live performance collapses. Each camera is compared
        against <b>its own</b> baseline — a gate and a storage yard have nothing
        in common, and a fleet average would hide both.
      </div>

      {cams.length ? (
        <div style={{ display: "grid", gap: 9 }}>
          {cams.map((c) => {
            const s = c.latest_drift || 0;
            const tone = s >= 0.5 ? VIZ.critical : s >= 0.3 ? "#8a5200" : C.sub;
            const series = (c.samples || []).slice(0, 24).reverse();
            const maxD = Math.max(0.1, ...series.map((x) => x.drift_score || 0));
            return (
              <div key={c.camera_id} style={{
                padding: "11px 13px", borderRadius: 11,
                border: `1px solid ${c.alarming ? "#f5c2c8" : C.line}`,
                background: c.alarming ? "#fff8f8" : C.panel,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9,
                  flexWrap: "wrap" }}>
                  <span style={{ ...mono, fontSize: 12.5, fontWeight: 800 }}>
                    {c.camera_id}
                  </span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 800, color: tone }}>
                    {c.alarming ? "⚠ " : ""}drift {(s * 100).toFixed(0)}%
                  </span>
                  <div style={{ flex: 1 }} />
                  <Btn small onClick={() => reset(c.camera_id)}
                    title="Use after a deliberate change — moved camera, new lens. The next completed window becomes the new baseline.">
                    Reset baseline
                  </Btn>
                </div>

                {/* sparkline: one series, so no legend — the label names it */}
                {series.length > 1 ? (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2,
                    height: 30, marginTop: 9 }}>
                    {series.map((x, i) => (
                      <div key={i}
                        title={`${((x.drift_score || 0) * 100).toFixed(0)}% — ${x.drift_reason || "within baseline"}`}
                        style={{
                          flex: 1, minWidth: 3,
                          height: `${Math.max(6, ((x.drift_score || 0) / maxD) * 100)}%`,
                          borderRadius: "2px 2px 0 0",
                          background: x.is_baseline ? VIZ.grid
                            : (x.drift_score || 0) >= 0.3 ? VIZ.neg : VIZ.seq[3],
                        }} />
                    ))}
                  </div>
                ) : null}

                <div style={{ fontSize: 11.5, color: C.sub, marginTop: 7,
                  lineHeight: 1.5 }}>
                  {c.latest_reason || "no baseline yet — the first stable window sets it"}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>
          No drift samples yet. Each camera needs one full window of running
          inference before its baseline exists; leave cameras running and this
          fills in on its own.
        </Empty>
      )}
      {msg ? <div style={{ marginTop: 10, fontSize: 11.5, color: "#c02b3c" }}>{msg}</div> : null}
    </Card>
  );
}

/* ====================================================================== main */
export default function PPEModelOps() {
  const [tab, setTab] = useState("golden");
  const [summary, setSummary] = useState(null);
  const [golden, setGolden] = useState(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([
        api("/api/modelops/summary"),
        api("/api/modelops/golden"),
      ]);
      setSummary(s); setGolden(g); setErr("");
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const TABS = [
    ["golden", "Golden set"], ["evaluate", "Evaluate"],
    ["shadow", "Shadow"], ["drift", "Drift"],
  ];

  return (
    <div style={{ padding: "16px 28px 40px", color: C.ink }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Model Operations</h2>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.sub }}>
          Proving the model got better — on frames it has never trained on
        </p>
      </div>

      {err ? (
        <div style={{ marginBottom: 13, padding: "10px 13px", borderRadius: 10,
          background: "#fdf1e3", border: "1px solid #f0d4a8", color: "#8a5200",
          fontSize: 12.5, fontWeight: 600 }}>{err}</div>
      ) : null}

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Golden frames" value={summary?.golden?.images ?? "—"}
          tone={summary?.golden_ready ? undefined : "#8a5200"}
          hint={summary?.golden_ready
            ? `${summary?.golden?.instances ?? 0} labelled instances held out`
            : "Under 5 — there is no regression gate yet"} />
        <Stat label="Live model mAP50"
          value={summary?.live_map50 != null ? pct(summary.live_map50) : "not scored"}
          hint={summary?.live_scored
            ? "Measured on the current golden set"
            : "Evaluate the live model to set a baseline"} />
        <Stat label="Evaluations" value={summary?.eval_runs ?? "—"}
          hint="Every score ever taken, with the frame set it used" />
        <Stat label="Awaiting verdict" value={summary?.pending_adjudications ?? 0}
          hint="Shadow disagreements a human has not resolved" />
      </div>

      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14,
        flexWrap: "wrap" }}>
        {TABS.map(([id, label]) => (
          <Btn key={id} tone={tab === id ? "primary" : "plain"}
            onClick={() => setTab(id)}>{label}</Btn>
        ))}
      </div>

      {tab === "golden" ? <GoldenTab golden={golden} onRefresh={refresh} />
        : tab === "evaluate" ? <EvaluateTab golden={golden} onRefresh={refresh} />
          : tab === "shadow" ? <ShadowTab />
            : <DriftTab />}
    </div>
  );
}
