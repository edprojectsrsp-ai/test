"use client";
/**
 * Industrial PPE shell — command bar + grouped module nav + offline banner.
 * Wraps every PPE surface (embedded + desktop).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentStatus,
  fetchPpeShellMeta,
  getPpeApiBase,
  refreshAgent,
  subscribeAgent,
} from "../../lib/ppeClient";
import CloudPushPanel from "./CloudPushPanel";
import ModuleNav, { flattenModuleNav } from "../layout/ModuleNav";

/**
 * @typedef {"connecting"|"online"|"offline"} HealthState
 * @typedef {{id:string,label:string,hint?:string,role?:string}} FlatTab
 */

/**
 * @param {object} props
 * @param {FlatTab[]} [props.tabs] — flat list for label/hint lookup (optional if nav provided)
 * @param {import("../layout/ModuleNav").ModuleNavEntry[]} [props.nav] — grouped primary nav
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
  nav,
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
  const [agent, setAgent] = useState(/** @type {string} */ (agentStatus()));
  // getPpeApiBase() flips from the cloud proxy to the local agent once
  // discovery resolves, so it must be read during render, not captured once.
  const API_BASE = getPpeApiBase();
  const [health, setHealth] = useState(/** @type {HealthState} */ ("connecting"));
  const [camRunning, setCamRunning] = useState(0);
  const [camTotal, setCamTotal] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [device, setDevice] = useState(null);
  const [clock, setClock] = useState("");
  const [openMenu, setOpenMenu] = useState(false);
  const openMenuRef = useRef(/** @type {HTMLDivElement|null} */ (null));

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

  // Discovery resolves asynchronously and flips every URL the page builds, so
  // re-render when it lands rather than leaving the UI on the cloud fallback.
  useEffect(() => subscribeAgent((s) => setAgent(s.status)), []);

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

  // R = refresh only (tab keys handled by ModuleNav)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "r" && (e.metaKey || e.ctrlKey)) return;
      if ((e.key === "R" || e.key === "r") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        refreshMeta();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshMeta]);

  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e) => {
      if (!openMenuRef.current?.contains(e.target)) setOpenMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenu]);

  const navEntries = useMemo(() => {
    if (nav && nav.length) {
      // Inject live badges into known destinations
      return nav.map((entry) => {
        if (entry.kind === "group") {
          return {
            ...entry,
            items: entry.items.map((item) => annotateItem(item, openAlerts, pendingReview)),
          };
        }
        return annotateItem(entry, openAlerts, pendingReview);
      });
    }
    // Fallback: flat tabs as primary tabs
    return (tabs || []).map((t) =>
      annotateItem(
        { id: t.id, label: t.label, hint: t.hint ? `${t.hint}${t.role ? ` · ${t.role}` : ""}` : t.role },
        openAlerts,
        pendingReview,
      ),
    );
  }, [nav, tabs, openAlerts, pendingReview]);

  const flat = useMemo(() => {
    const fromNav = flattenModuleNav(navEntries);
    if (fromNav.length) return fromNav;
    return (tabs || []).map((t) => ({ id: t.id, label: t.label, hint: t.hint }));
  }, [navEntries, tabs]);

  const active = flat.find((t) => t.id === tab) || (tabs || []).find((t) => t.id === tab);
  const activeRole = (tabs || []).find((t) => t.id === tab)?.role;
  const onAgent = agent === "online";
  const healthLabel =
    health === "online"
      ? onAgent
        ? "Agent online"
        : "Cloud only"
      : health === "offline"
        ? "Service offline"
        : "Connecting…";

  const chipTone = (kind) => {
    if (kind === "cams") return camRunning > 0 ? "ok" : "mute";
    if (kind === "alerts") return openAlerts > 0 ? "danger" : "mute";
    if (kind === "review") return pendingReview > 0 ? "warn" : "mute";
    return "mute";
  };

  const topLevelCount = navEntries.length;

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
            <CloudPushPanel compact />
            {extraMeta}
            <div
              className={`ppe-health ppe-health--${health}`}
              title={
                health === "offline"
                  ? `Cannot reach ${API_BASE}`
                  : onAgent
                    ? `Local agent: ${API_BASE}`
                    : `Cloud dashboard via ${API_BASE} — no local agent on this machine`
              }
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
              <div className="mshell-open-menu" ref={openMenuRef}>
                <button
                  type="button"
                  className="ppe-btn ppe-btn--primary"
                  aria-haspopup="menu"
                  aria-expanded={openMenu}
                  onClick={() => setOpenMenu((v) => !v)}
                  title="Open wall or full desktop layout"
                >
                  Open ▾
                </button>
                {openMenu ? (
                  <div className="mshell-open-menu__panel" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenu(false);
                        window.open("/ppe/desktop?tab=wall", "_blank", "noopener,noreferrer");
                      }}
                    >
                      🖥 Plant TV wall
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenu(false);
                        window.open("/ppe/desktop", "_blank", "noopener,noreferrer");
                      }}
                    >
                      ⛶ Desktop control center
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <a href="/ppe" className="ppe-btn" style={{ textDecoration: "none" }}>
                ← Embedded
              </a>
            )}
          </div>
        </div>

        <ModuleNav
          entries={navEntries}
          activeId={tab}
          onSelect={onTab}
          label="PPE modules"
        />
      </header>

      {showContext && active && tab !== "wall" ? (
        <div className="ppe-context mshell-context">
          <span>
            <b>{active.label}</b>
            {active.hint ? ` — ${active.hint}` : ""}
          </span>
          {activeRole ? (
            <>
              <span style={{ opacity: 0.35 }}>·</span>
              <span>{activeRole}</span>
            </>
          ) : null}
          <span className="mshell-context__meta">
            Keys 1–{Math.min(9, topLevelCount)} switch · R refresh
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
          <button
            type="button"
            className="ppe-btn ppe-btn--danger"
            onClick={() => refreshAgent().then(refreshMeta)}
          >
            Retry
          </button>
        </div>
      ) : !onAgent && agent !== "probing" && agent !== "unknown" ? (
        // Not an error. Cameras, live video and model management run on the
        // plant PC; this browser simply is not that PC. Say so plainly rather
        // than showing a failure for the normal remote case.
        <div className="ppe-banner ppe-banner--info">
          <span style={{ fontSize: 16 }} aria-hidden>
            ☁
          </span>
          <span style={{ flex: 1 }}>
            Viewing the cloud dashboard — violations and analytics only. Live cameras, recording
            and model tools run on the plant PC and are hidden here.
          </span>
          <button
            type="button"
            className="ppe-btn"
            onClick={() => refreshAgent().then(refreshMeta)}
            title="Re-check for a PPE agent on this machine"
          >
            Detect agent
          </button>
        </div>
      ) : null}

      <div className={fill ? "ppe-main ppe-main--fill" : "ppe-main"}>{children}</div>
    </div>
  );
}

/** @param {import("../layout/ModuleNav").ModuleNavItem} item */
function annotateItem(item, openAlerts, pendingReview) {
  const next = { ...item };
  if (item.id === "alerts" || item.id === "wall") {
    next.badge = openAlerts || null;
    next.badgeTone = "danger";
  } else if (item.id === "review") {
    next.badge = pendingReview || null;
    next.badgeTone = "warn";
  }
  return next;
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
