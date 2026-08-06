"use client";
import { useEffect, useMemo, useState } from "react";
import PPEControlRoom from "../../components/ppe/PPEControlRoom";
import PPEReviewDashboard from "../../components/ppe/PPEReviewDashboard";
import ViolationsGallery from "../../components/ppe/ViolationsGallery";
import PPEAnalytics from "../../components/ppe/PPEAnalytics";
import PPEReports from "../../components/ppe/PPEReports";
import PPEAlertSettings from "../../components/ppe/PPEAlertSettings";
import PPEFleetHealth from "../../components/ppe/PPEFleetHealth";
import PPEZoneEditor from "../../components/ppe/PPEZoneEditor";
import PPENVR from "../../components/ppe/PPENVR";
import PPEModelOps from "../../components/ppe/PPEModelOps";
import PpeShell from "../../components/ppe/PpeShell";
import CloudPushPanel from "../../components/ppe/CloudPushPanel";
import ActivationBanner from "../../components/ppe/ActivationBanner";
import { buildPpeUrl } from "../../lib/ppeApi";
import { ensureAgent, subscribeAgent } from "../../lib/ppeAgent";
import type { ModuleNavEntry } from "../../components/layout/ModuleNav";

type Tab =
  | "live"
  | "nvr"
  | "alerts"
  | "reports"
  | "analytics"
  | "review"
  | "modelops"
  | "health"
  | "zones"
  | "settings";

/** Flat catalog (hints + content routing). */
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "live", label: "Live", hint: "Camera grid · click for full-page canvas with option tabs" },
  { id: "nvr", label: "Recorder", hint: "24/7 + event recording · timeline · teach on footage" },
  { id: "alerts", label: "Alerts", hint: "Violation evidence · ack · resolve · SLA" },
  { id: "reports", label: "Reports", hint: "Audit log · trends · CSV export" },
  { id: "analytics", label: "Analytics", hint: "KPIs · shifts · heatmaps · model coverage" },
  { id: "review", label: "Review", hint: "Label frames to improve the model" },
  { id: "modelops", label: "Model Ops", hint: "Golden set · per-class scores · shadow runs · drift" },
  { id: "health", label: "Health", hint: "Stream uptime · freezes · detector capacity" },
  { id: "zones", label: "Zones", hint: "Mask public areas · per-zone gear rules" },
  { id: "settings", label: "Settings", hint: "Telegram · dedup · detection tuning" },
];

/** Grouped chrome: 5 top-level items instead of 10 cramped tabs. */
const NAV: ModuleNavEntry[] = [
  { id: "live", label: "Live", hint: "Camera grid · full-page canvas" },
  { id: "alerts", label: "Alerts", hint: "Violations · ack · SLA" },
  { id: "review", label: "Review", hint: "Label frames for training" },
  {
    kind: "group",
    id: "analyze",
    label: "Analyze",
    items: [
      { id: "reports", label: "Reports", hint: "Audit log · trends · CSV" },
      { id: "analytics", label: "Analytics", hint: "KPIs · shifts · heatmaps" },
      { id: "modelops", label: "Model Ops", hint: "Golden set · shadow · drift" },
    ],
  },
  {
    kind: "group",
    id: "system",
    label: "System",
    items: [
      { id: "nvr", label: "Recorder", hint: "NVR timeline · teach on footage" },
      { id: "health", label: "Health", hint: "Uptime · freezes · capacity" },
      { id: "zones", label: "Zones", hint: "Masks · per-zone gear rules" },
      { id: "settings", label: "Settings", hint: "Telegram · dedup · tuning" },
    ],
  },
];

/**
 * Tabs the cloud role can actually serve. It mounts only the violations and
 * analytics routers — cameras, streams, review, models, NVR and settings all
 * live on the plant PC. Showing those remotely gives a page of failed requests,
 * so they are hidden until an agent is found.
 */
const CLOUD_TABS = new Set<Tab>(["alerts", "reports", "analytics"]);

export default function PPEPage() {
  const [tab, setTab] = useState<Tab>("live");
  const [onAgent, setOnAgent] = useState(true);

  useEffect(() => {
    document.title = "PPE Industrial · Control Room";
    ensureAgent().then((s) => setOnAgent(s.status === "online"));
    return subscribeAgent((s) => setOnAgent(s.status === "online"));
  }, []);

  // Discovery finishes after first paint, so the default "live" tab can become
  // unavailable a moment later. Move rather than render a dead panel.
  useEffect(() => {
    if (!onAgent && !CLOUD_TABS.has(tab)) setTab("alerts");
  }, [onAgent, tab]);

  const visibleTabs = useMemo(
    () => (onAgent ? TABS : TABS.filter((t) => CLOUD_TABS.has(t.id))),
    [onAgent],
  );

  const visibleNav = useMemo(() => {
    if (onAgent) return NAV;
    return NAV.map((entry) =>
      "kind" in entry && entry.kind === "group"
        ? { ...entry, items: entry.items.filter((i) => CLOUD_TABS.has(i.id as Tab)) }
        : entry,
    ).filter((entry) =>
      "kind" in entry && entry.kind === "group"
        ? entry.items.length > 0
        : CLOUD_TABS.has(entry.id as Tab),
    );
  }, [onAgent]);

  return (
    <div style={{ margin: "-3rem", minHeight: "calc(100vh + 0px)" }}>
      <PpeShell
        tabs={visibleTabs}
        nav={visibleNav}
        tab={tab}
        onTab={(id) => setTab(id as Tab)}
        title="PPE Detection"
        subtitle="Ministry · industrial ops"
        showContext
      >
        {/* Above the tab content, so it is visible whichever tab the operator
            happens to be on rather than only on Settings. */}
        <ActivationBanner />
        {tab === "live" ? (
          <PPEControlRoom embedded onNavigate={(t) => setTab(t as Tab)} />
        ) : tab === "nvr" ? (
          <PPENVR />
        ) : tab === "alerts" ? (
          <ViolationsGallery embedded />
        ) : tab === "reports" ? (
          <PPEReports embedded />
        ) : tab === "analytics" ? (
          <PPEAnalytics embedded />
        ) : tab === "modelops" ? (
          <PPEModelOps />
        ) : tab === "health" ? (
          <PPEFleetHealth />
        ) : tab === "zones" ? (
          <ZonesTab />
        ) : tab === "settings" ? (
          <div style={{ display: "grid", gap: 14, padding: "14px 18px 32px" }}>
            <CloudPushPanel />
            <PPEAlertSettings />
          </div>
        ) : (
          <PPEReviewDashboard embedded />
        )}
      </PpeShell>
    </div>
  );
}

function ZonesTab() {
  const [cams, setCams] = useState<any[]>([]);
  const [sel, setSel] = useState<string>("");

  useEffect(() => {
    fetch(buildPpeUrl("/api/cameras"), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : d.cameras || [];
        setCams(list);
        if (list.length) setSel(list[0].camera_id || list[0].id);
      })
      .catch(() => setCams([]));
  }, []);

  if (!cams.length) {
    return (
      <div className="ppe-empty" style={{ margin: 18 }}>
        <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.7 }}>◎</div>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>No cameras configured</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Add a source in the Live tab, then return here to mask public areas and set per-zone gear rules.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 18px 32px" }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Camera
        </span>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            border: "1px solid var(--line-2)",
            background: "var(--panel-2)",
            color: "var(--ink)",
            minWidth: 220,
          }}
        >
          {cams.map((c) => {
            const id = c.camera_id || c.id;
            return (
              <option key={id} value={id}>
                {id}
                {c.location ? ` — ${c.location}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      {sel ? <PPEZoneEditor key={sel} cameraId={sel} onClose={() => setSel("")} /> : null}
    </div>
  );
}
