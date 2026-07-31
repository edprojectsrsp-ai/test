"use client";
/**
 * Industrial PPE shell — shared command bar + module nav + offline banner.
 * Wraps every PPE surface (embedded + desktop) in the dark control-room theme.
 */
import React, { useCallback, useEffect, useState } from "react";
import { getPpeApiBase, fetchPpeShellMeta } from "../../lib/ppeClient";

/**
 * @typedef {"connecting"|"online"|"offline"} HealthState
 */

/**
 * @param {object} props
 * @param {Array<{id:string,label:string,hint?:string,role?:string}>} props.tabs
 * @param {string} props.tab
 * @param {(id:string)=>void} props.onTab
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.fullscreen]
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {boolean} [props.showContext]
 * @param {boolean} [props.fill]
 * @param {React.ReactNode} [props.extraMeta]
 * @param {()=>void} [props.onMeta]
 */
export default function PpeShell({
  tabs,
  tab,
  onTab,
  children,
  fullscreen = false,
  title = "PPE Detection",
  subtitle = "Industrial control room",
  showContext = false,
  fill = false,
  extraMeta = null,
  onMeta,
}) {
  const API_BASE = getPpeApiBase();
  const [health, setHealth] = useState(/** @type {HealthState} */ ("connecting"));
  const [camRunning, setCamRunning] = useState(0);
  const [camTotal, setCamTotal] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [device, setDevice] = useState(null);
  const [clock, setClock] = useState("");

  const refreshMeta = useCallback(async () => {
    try {
      const m = await fetchPpeShellMeta();
      setHealth(/** @type {HealthState} */ (m.health === "online" ? "online" : "offline"));
      setCamRunning(m.camRunning);
      setCamTotal(m.camTotal);
      setOpenAlerts(m.openAlerts);
      setPendingReview(m.pendingReview);
      setDevice(m.device);
      onMeta?.(m);
    } catch {
      setHealth("offline");
    }
  }, [onMeta]);

  useEffect(() => {
    refreshMeta();
    const t = setInterval(refreshMeta, 5000);
    return () => clearInterval(t);
  }, [refreshMeta]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const tick = () =>
      setClock(
        new Date().toLocaleString(undefined, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [fullscreen]);

  // Keyboard: 1–9 jump tabs, R refresh
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "r" && (e.metaKey || e.ctrlKey)) return; // browser refresh
      if (e.key === "R" || e.key === "r") {
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          refreshMeta();
        }
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= tabs.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onTab(tabs[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, onTab, refreshMeta]);

  const active = tabs.find((t) => t.id === tab);
  const healthLabel =
    health === "online" ? "Service online" : health === "offline" ? "Service offline" : "Connecting…";

  const badge = (n, tone = "mute") => {
    if (!n) return null;
    return (
      <span className={`ppe-badge ppe-badge--${tone}`}>
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const chipTone = (kind) => {
    if (kind === "cams") return camRunning > 0 ? "ok" : "mute";
    if (kind === "alerts") return openAlerts > 0 ? "danger" : "mute";
    if (kind === "review") return pendingReview > 0 ? "warn" : "mute";
    return "mute";
  };

  return (
    <div className={`ppe-industrial ppe-shell${fullscreen ? " ppe-shell--fullscreen" : ""}`}>
      <header className="ppe-header">
        <div className="ppe-header__row">
          <div className="ppe-brand">
            <div className="ppe-brand__mark" aria-hidden>
              ◎
            </div>
            <div>
              <h1 className="ppe-brand__title">{title}</h1>
              <p className="ppe-brand__sub">{subtitle}</p>
            </div>
          </div>

          <div className="ppe-meta">
            <div className={`ppe-chip ppe-chip--${chipTone("cams")}`}>
              <span className="ppe-chip__label">Cams</span>
              <span className="ppe-chip__value">
                {health === "online" ? `${camRunning}/${camTotal}` : "—"}
              </span>
            </div>
            <div className={`ppe-chip ppe-chip--${chipTone("alerts")}`}>
              <span className="ppe-chip__label">Alerts</span>
              <span className="ppe-chip__value">
                {health === "online" ? String(openAlerts) : "—"}
              </span>
            </div>
            <div className={`ppe-chip ppe-chip--${chipTone("review")}`}>
              <span className="ppe-chip__label">Review</span>
              <span className="ppe-chip__value">
                {health === "online" ? String(pendingReview) : "—"}
              </span>
            </div>
            {device ? (
              <div className="ppe-chip ppe-chip--info">
                <span className="ppe-chip__label">Device</span>
                <span className="ppe-chip__value">{String(device).toUpperCase()}</span>
              </div>
            ) : null}
            {extraMeta}
            <div
              className={`ppe-health ppe-health--${health}`}
              title={health === "offline" ? `Cannot reach ${API_BASE}` : API_BASE}
            >
              <span className="ppe-health__dot" />
              {healthLabel}
            </div>
            {fullscreen && clock ? (
              <span className="ppe-mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {clock}
              </span>
            ) : null}
            {!fullscreen ? (
              <>
                <button
                  type="button"
                  className="ppe-btn"
                  title="Plant TV wall — live video + alert ticker"
                  onClick={() => window.open("/ppe/desktop?tab=wall", "_blank", "noopener,noreferrer")}
                >
                  🖥 Wall
                </button>
                <button
                  type="button"
                  className="ppe-btn ppe-btn--primary"
                  title="Full desktop control center (no sidebar)"
                  onClick={() => window.open("/ppe/desktop", "_blank", "noopener,noreferrer")}
                >
                  ⛶ Desktop
                </button>
              </>
            ) : (
              <a href="/ppe" className="ppe-btn" style={{ textDecoration: "none" }}>
                ← Embedded
              </a>
            )}
          </div>
        </div>

        <nav className="ppe-nav" role="tablist" aria-label="PPE modules">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="ppe-nav__tab"
              title={`${t.hint || t.label}${t.role ? ` · ${t.role}` : ""} · shortcut ${i + 1}`}
              onClick={() => onTab(t.id)}
            >
              {t.label}
              {(t.id === "alerts" || t.id === "wall") && badge(openAlerts, "danger")}
              {t.id === "review" && badge(pendingReview, "warn")}
            </button>
          ))}
        </nav>
      </header>

      {showContext && active && tab !== "wall" ? (
        <div className="ppe-context">
          <span>
            <b>{active.label}</b>
            {active.hint ? ` — ${active.hint}` : ""}
          </span>
          {active.role ? (
            <>
              <span style={{ opacity: 0.35 }}>·</span>
              <span>{active.role}</span>
            </>
          ) : null}
          <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 11 }}>
            Keys 1–{Math.min(9, tabs.length)} switch · R refresh
          </span>
        </div>
      ) : null}

      {health === "offline" ? (
        <div className="ppe-banner ppe-banner--danger" role="alert">
          <span style={{ fontSize: 16 }} aria-hidden>
            ⚠
          </span>
          <span style={{ flex: 1 }}>
            PPE backend unreachable at <code>{API_BASE}</code>. Start the service to enable live
            detection, recording, and alerts.
          </span>
          <button type="button" className="ppe-btn ppe-btn--danger" onClick={refreshMeta}>
            Retry
          </button>
        </div>
      ) : null}

      <div className={fill ? "ppe-main ppe-main--fill" : "ppe-main"}>{children}</div>
    </div>
  );
}

/** Small reusable KPI strip item (class-based) */
export function PpeKpi({ label, value, tone = "mute", onClick, hint }) {
  const clickable = typeof onClick === "function";
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={`ppe-kpi ppe-kpi--${tone}`}
      onClick={onClick}
      title={hint}
      style={clickable ? { cursor: "pointer", width: "100%", fontFamily: "inherit" } : undefined}
    >
      <div className="ppe-kpi__label">
        {label}
        {clickable ? " →" : ""}
      </div>
      <div className="ppe-kpi__value">{value}</div>
    </Tag>
  );
}

/** SLA age label for alerts */
export function slaTone(iso) {
  if (!iso) return { label: "—", tone: "ok" };
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 5) return { label: `${Math.max(0, Math.floor(mins))}m`, tone: "ok" };
  if (mins < 30) return { label: `${Math.floor(mins)}m`, tone: "warn" };
  if (mins < 1440) return { label: `${Math.floor(mins / 60)}h`, tone: "crit" };
  return { label: `${Math.floor(mins / 1440)}d`, tone: "crit" };
}
