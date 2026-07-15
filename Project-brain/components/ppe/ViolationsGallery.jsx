"use client";
/*
 * ViolationsGallery — the "Alerts" tab. White corporate theme.
 *
 * Photo wall of fired violations, tagged by type, camera, time, confidence.
 * Filter chips by type + status; per-card acknowledge / resolve.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path, options) {
  const r = await fetch(`${API_BASE}${path}`, options);
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const C = {
  bg: "var(--bg)", panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)", sub: "var(--ink-3)",
  line: "var(--line)", brand: "var(--steel)", brandSoft: "var(--steel-soft)",
  high: "var(--molten)", highSoft: "var(--molten-soft)", crit: "var(--molten)", critSoft: "var(--molten-soft)",
  ok: "var(--verdigris)", okSoft: "var(--verdigris-soft)", warn: "var(--slag)", warnSoft: "var(--slag-soft)",
  shadow: "var(--shadow)",
};
const sevColor = (s) => (s === "critical" ? [C.crit, C.critSoft] : s === "high" ? [C.high, C.highSoft] : [C.warn, C.warnSoft]);

function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function Chip({ active, label, count, onClick, tone }) {
  const [fg, bg] = tone || [C.brand, C.brandSoft];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1.5px solid ${active ? fg : C.line}`,
        background: active ? bg : C.panel,
        color: active ? fg : C.sub,
        borderRadius: 999,
        padding: "6px 13px",
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        gap: 7,
        alignItems: "center",
        transition: "border-color .12s ease, background .12s ease",
      }}
    >
      {label}
      {count != null && <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 800 }}>{count}</span>}
    </button>
  );
}

function ViolationCard({ v, onStatus, onOpen }) {
  const [fg, bg] = sevColor(v.severity);
  const done = v.status === "resolved" || v.status === "false_alarm";
  return (
    <article style={{
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: C.shadow,
      opacity: done ? 0.62 : 1,
      transition: "opacity .15s ease, transform .15s ease",
    }}>
      <div
        style={{ position: "relative", aspectRatio: "4/3", background: "#0b0f14", cursor: "pointer" }}
        onClick={() => onOpen(v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(v); }}
        aria-label={`Open ${v.label} evidence`}
      >
        {v.has_image ? (
          <img
            alt={v.label}
            src={`${API_BASE}${v.image_url}`}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#6d8296", fontSize: 12 }}>
            no image
          </div>
        )}
        <span style={{
          position: "absolute", top: 8, left: 8, background: bg, color: fg, fontSize: 12,
          fontWeight: 800, padding: "4px 10px", borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,.2)",
        }}>
          {v.label}
        </span>
        <span style={{
          position: "absolute", top: 8, right: 8, background: "rgba(5,8,12,.72)", color: "#e7eef6",
          fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7,
        }}>
          {Math.round((v.confidence || 0) * 100)}%
        </span>
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.sub }}>
          <span style={{ fontWeight: 700, color: C.ink }}>{v.camera_id}</span>
          <span title={v.occurred_at || ""}>{timeAgo(v.occurred_at)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 11, color: C.sub, marginTop: 4, flexWrap: "wrap" }}>
          {v.department ? <span>dept {v.department}</span> : null}
          {v.track_id != null ? <span>track {v.track_id}</span> : null}
          <span style={{
            marginLeft: "auto",
            textTransform: "capitalize",
            color: v.status === "open" ? C.high : v.status === "acknowledged" ? C.warn : C.ok,
            fontWeight: 700,
          }}>
            {v.status?.replace("_", " ")}
          </span>
        </div>
        {!done && (
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => onStatus(v, "acknowledged")}
              style={{
                flex: 1, border: `1px solid ${C.line}`, background: C.panel, color: C.warn,
                borderRadius: 8, padding: "7px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              Ack
            </button>
            <button
              type="button"
              onClick={() => onStatus(v, "resolved")}
              style={{
                flex: 1, border: "none", background: C.ok, color: "#fff",
                borderRadius: 8, padding: "7px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              Resolve
            </button>
            <button
              type="button"
              onClick={() => onStatus(v, "false_alarm")}
              title="Mark as false alarm"
              style={{
                border: `1px solid ${C.line}`, background: C.panel, color: C.sub,
                borderRadius: 8, padding: "7px 9px", fontSize: 11.5, cursor: "pointer",
              }}
            >
              False
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

const STATUS_FILTERS = [
  { id: null, label: "All statuses" },
  { id: "open", label: "Open" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
  { id: "false_alarm", label: "False alarm" },
];

export default function ViolationsGallery({ embedded = false }) {
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTypes = useCallback(async () => {
    try {
      const t = await api("/api/violations/types");
      setTypes(t.types || []);
      setTotal(t.total || 0);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const p = new URLSearchParams({ limit: "120" });
      if (filter) p.set("category", filter);
      if (from) p.set("date_from", from);
      if (to) p.set("date_to", to);
      if (statusFilter) p.set("status", statusFilter);
      const v = await api(`/api/violations?${p.toString()}`);
      setItems(v.violations || []);
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter, from, to, statusFilter]);

  useEffect(() => { loadTypes(); }, [loadTypes]);
  useEffect(() => {
    loadItems();
    const t = setInterval(() => { loadItems(); loadTypes(); }, 5000);
    return () => clearInterval(t);
  }, [loadItems, loadTypes]);

  // Escape closes lightbox
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const onStatus = async (v, status) => {
    setItems((xs) => xs.map((x) => (x.id === v.id ? { ...x, status } : x)));
    if (lightbox?.id === v.id) setLightbox((lb) => (lb ? { ...lb, status } : lb));
    try {
      await api(`/api/violations/${v.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      setErr(e.message);
      loadItems();
    }
  };

  const clearAll = async () => {
    const scope = filter ? `all "${types.find((t) => t.category === filter)?.label || filter}" alerts` : "ALL alerts";
    if (!window.confirm(`Clear ${scope}? This removes them from the log (training captures are kept).`)) return;
    try {
      const p = new URLSearchParams();
      if (filter) p.set("category", filter);
      if (from) p.set("date_from", from);
      if (to) p.set("date_to", to);
      const r = await api(`/api/violations?${p.toString()}`, { method: "DELETE" });
      setErr("");
      await loadItems();
      await loadTypes();
      window.alert(`Cleared ${r.deleted} alert(s).`);
    } catch (e) {
      setErr(e.message);
    }
  };

  const clearPhotos = async () => {
    if (!window.confirm(
      "Delete ALL stored photos from disk and the database?\n\nThis wipes the alert log AND the training-queue captures + image files to free space. Model weights and datasets are kept. This cannot be undone.",
    )) return;
    try {
      const r = await api("/api/review/captures", { method: "DELETE" });
      setErr("");
      await loadItems();
      await loadTypes();
      window.alert(`Freed ${r.mb_freed} MB — removed ${r.files_removed} files, ${r.captures_deleted} captures, ${r.violations_deleted} alerts.`);
    } catch (e) {
      setErr(e.message);
    }
  };

  const openCount = useMemo(
    () => items.filter((v) => v.status === "open").length,
    [items],
  );

  return (
    <div style={{
      background: embedded ? "transparent" : C.bg,
      minHeight: embedded ? undefined : "100vh",
      color: C.ink,
      padding: embedded ? "18px 28px 60px" : "20px 24px 60px",
      fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: embedded ? 15 : 21, fontWeight: 800, letterSpacing: -0.3 }}>
            {embedded ? "Alerts" : "Alerts"}
          </h1>
          {embedded ? (
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.sub }}>
              Violation evidence · classified by type · live
            </p>
          ) : (
            <span style={{ color: C.sub, fontSize: 13, marginLeft: 0 }}>violation evidence, classified by type · live</span>
          )}
        </div>
        <span style={{ flex: 1 }} />

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: C.panel,
          border: `1px solid ${C.line}`, borderRadius: 10, padding: "5px 10px", boxShadow: C.shadow,
        }}>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            style={{ border: "none", background: "transparent", color: C.ink, fontSize: 12.5, outline: "none" }}
          />
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            style={{ border: "none", background: "transparent", color: C.ink, fontSize: 12.5, outline: "none" }}
          />
          {(from || to) ? (
            <button
              type="button"
              onClick={() => { setFrom(""); setTo(""); }}
              title="Clear dates"
              style={{ border: "none", background: "transparent", color: C.sub, cursor: "pointer", fontSize: 14 }}
            >
              ✕
            </button>
          ) : null}
        </div>

        <span style={{ fontSize: 13, color: C.sub }}>
          <b style={{ color: C.ink }}>{total}</b> total
          {openCount > 0 ? (
            <> · <b style={{ color: C.high }}>{openCount}</b> open on page</>
          ) : null}
        </span>

        <button
          type="button"
          onClick={clearAll}
          disabled={!total}
          style={{
            border: `1px solid ${C.high}`,
            background: total ? C.panel : C.panel2,
            color: total ? C.high : "#b7c0ca",
            borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 800,
            cursor: total ? "pointer" : "default",
          }}
        >
          🗑 Clear {filter || from || to ? "filtered" : "all"}
        </button>
        <button
          type="button"
          onClick={clearPhotos}
          title="Delete all stored photos from disk + database (frees space)"
          style={{
            border: `1px solid ${C.crit}`, background: C.crit, color: "#fff",
            borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
          }}
        >
          🧹 Clear photos
        </button>
      </div>

      {/* summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px,1fr))", gap: 10, margin: "12px 0" }}>
        {types.map((t) => {
          const [fg, bg] = sevColor(t.severity);
          const active = filter === t.category;
          return (
            <button
              key={t.category}
              type="button"
              onClick={() => setFilter(active ? null : t.category)}
              style={{
                cursor: "pointer",
                background: active ? bg : C.panel,
                border: `1.5px solid ${active ? fg : C.line}`,
                borderRadius: 12,
                padding: "12px 14px",
                boxShadow: C.shadow,
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: fg, fontVariantNumeric: "tabular-nums" }}>{t.count}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub }}>{t.label}</div>
            </button>
          );
        })}
        {!types.length && !loading && (
          <div style={{
            color: C.sub, fontSize: 13, padding: "16px 18px", gridColumn: "1 / -1",
            border: `1px dashed ${C.line}`, borderRadius: 12, background: C.panel,
          }}>
            No violations captured yet. Run a camera in <b>Monitor</b> or <b>Collect</b> mode.
          </div>
        )}
      </div>

      {/* type chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Chip active={!filter} label="All types" count={total} onClick={() => setFilter(null)} />
        {types.map((t) => (
          <Chip
            key={t.category}
            active={filter === t.category}
            label={t.label}
            count={t.count}
            tone={sevColor(t.severity)}
            onClick={() => setFilter(filter === t.category ? null : t.category)}
          />
        ))}
      </div>

      {/* status chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {STATUS_FILTERS.map((s) => (
          <Chip
            key={s.id ?? "all"}
            active={statusFilter === s.id}
            label={s.label}
            onClick={() => setStatusFilter(s.id)}
            tone={s.id === "open" ? [C.high, C.highSoft] : s.id === "acknowledged" ? [C.warn, C.warnSoft] : s.id === "resolved" ? [C.ok, C.okSoft] : undefined}
          />
        ))}
      </div>

      {err ? (
        <div style={{
          color: C.high, fontSize: 13, marginBottom: 12, padding: "10px 14px",
          background: C.highSoft, borderRadius: 10, border: `1px solid #f5c2c8`,
        }}>
          Could not load: {err} — is the backend running on {API_BASE}?
        </div>
      ) : null}

      {/* gallery */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px,1fr))", gap: 14 }}>
        {items.map((v) => (
          <ViolationCard key={v.id} v={v} onStatus={onStatus} onOpen={setLightbox} />
        ))}
        {!items.length && !err && !loading ? (
          <div style={{
            color: C.sub, fontSize: 13.5, padding: 32, border: `1px dashed ${C.line}`,
            borderRadius: 14, background: C.panel, gridColumn: "1 / -1", textAlign: "center", lineHeight: 1.5,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px",
              background: C.okSoft, color: C.ok, display: "grid", placeItems: "center", fontSize: 20, fontWeight: 800,
            }}>
              ✓
            </div>
            <div style={{ fontWeight: 800, color: C.ink, marginBottom: 4, fontSize: 15 }}>
              No violations to show{filter || statusFilter ? " for this filter" : ""}
            </div>
            Run a camera in <b>Monitor</b> or <b>Collect</b> mode — fired violations appear here with evidence photos.
          </div>
        ) : null}
        {loading && !items.length ? (
          [1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
                aspectRatio: "4/5",
                backgroundImage: "linear-gradient(90deg, #f4f6f9 0%, #eef1f5 50%, #f4f6f9 100%)",
                backgroundSize: "200% 100%",
                animation: "ppe-shimmer 1.4s ease infinite",
              }}
            />
          ))
        ) : null}
      </div>

      {/* lightbox */}
      {lightbox ? (
        <div
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Violation evidence"
          style={{
            position: "fixed", inset: 0, background: "rgba(9,14,20,.82)",
            display: "grid", placeItems: "center", zIndex: 50, padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.panel, borderRadius: 16, overflow: "hidden", maxWidth: 900,
              width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,.5)",
            }}
          >
            <img
              alt={lightbox.label}
              src={`${API_BASE}${lightbox.image_url}`}
              style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", background: "#0b0f14" }}
            />
            <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {(() => {
                const [fg, bg] = sevColor(lightbox.severity);
                return (
                  <span style={{ background: bg, color: fg, fontWeight: 800, fontSize: 14, padding: "5px 12px", borderRadius: 9 }}>
                    {lightbox.label}
                  </span>
                );
              })()}
              <span style={{ color: C.sub, fontSize: 13 }}>
                {lightbox.camera_id} · {Math.round((lightbox.confidence || 0) * 100)}% · {timeAgo(lightbox.occurred_at)}
              </span>
              <span style={{
                textTransform: "capitalize", fontSize: 12, fontWeight: 700,
                color: lightbox.status === "open" ? C.high : lightbox.status === "acknowledged" ? C.warn : C.ok,
              }}>
                {lightbox.status?.replace("_", " ")}
              </span>
              <span style={{ flex: 1 }} />
              {lightbox.status === "open" || lightbox.status === "acknowledged" ? (
                <>
                  <button
                    type="button"
                    onClick={() => onStatus(lightbox, "acknowledged")}
                    style={{
                      border: `1px solid ${C.line}`, background: C.panel, color: C.warn,
                      borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    Ack
                  </button>
                  <button
                    type="button"
                    onClick={() => onStatus(lightbox, "resolved")}
                    style={{
                      border: "none", background: C.ok, color: "#fff",
                      borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    Resolve
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setLightbox(null)}
                style={{
                  border: `1px solid ${C.line}`, background: C.panel, color: C.sub,
                  borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
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
