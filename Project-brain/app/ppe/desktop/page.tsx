"use client";
/**
 * PPE Desktop Control Center — full-viewport industrial shell.
 * Wall · Live · Recorder · Alerts · Reports · Analytics · Review · Setup
 */
import { useEffect, useState, type CSSProperties } from "react";
import PPEControlRoom from "../../../components/ppe/PPEControlRoom";
import PPEReviewDashboard from "../../../components/ppe/PPEReviewDashboard";
import ViolationsGallery from "../../../components/ppe/ViolationsGallery";
import PPEAnalytics from "../../../components/ppe/PPEAnalytics";
import PPEWallRoom from "../../../components/ppe/PPEWallRoom";
import PPEReports from "../../../components/ppe/PPEReports";
import PPENVR from "../../../components/ppe/PPENVR";
import PPEModelOps from "../../../components/ppe/PPEModelOps";
import PpeShell from "../../../components/ppe/PpeShell";

type Tab = "wall" | "live" | "nvr" | "alerts" | "reports" | "analytics" | "review" | "modelops" | "setup";

const TABS: { id: Tab; label: string; hint: string; role: string }[] = [
  { id: "wall", label: "Wall", hint: "Plant TV — live video wall + alert ticker", role: "Operator" },
  { id: "live", label: "Live", hint: "Found/Not found · PPE config · sources · modes", role: "Operator" },
  { id: "nvr", label: "Recorder", hint: "Timeline · evidence clips · teach · NVR devices", role: "Safety" },
  { id: "alerts", label: "Alerts", hint: "Evidence gallery · ack · resolve · SLA", role: "Safety" },
  { id: "reports", label: "Reports", hint: "Audit log · trends · CSV export", role: "EHS lead" },
  { id: "analytics", label: "Analytics", hint: "KPIs · mix · model PPE coverage", role: "EHS lead" },
  { id: "review", label: "Review", hint: "Label frames · improve the model", role: "ML ops" },
  { id: "modelops", label: "Model Ops", hint: "Golden set · per-class scores · shadow · drift", role: "ML ops" },
  { id: "setup", label: "Setup", hint: "How to run · model limits · operator flow", role: "Admin" },
];

export default function PPEDesktopPage() {
  const [tab, setTab] = useState<Tab>("wall");

  useEffect(() => {
    document.title = "PPE Control Center · Industrial";
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab") as Tab | null;
      if (q && TABS.some((t) => t.id === q)) setTab(q);
    } catch {
      /* ignore */
    }
  }, []);

  const go = (t: string) => {
    if (TABS.some((x) => x.id === t)) setTab(t as Tab);
  };

  const fill = tab === "wall" || tab === "review";

  return (
    <PpeShell
      tabs={TABS}
      tab={tab}
      onTab={(id) => setTab(id as Tab)}
      fullscreen
      title="PPE Control Center"
      subtitle="Desktop · ministry ops"
      showContext
      fill={fill}
    >
      {tab === "wall" ? (
        <div style={{ flex: 1, minHeight: 0, height: "100%" }}>
          <PPEWallRoom onNavigate={go} />
        </div>
      ) : null}
      {tab === "live" ? <PPEControlRoom embedded onNavigate={go} /> : null}
      {tab === "nvr" ? <PPENVR /> : null}
      {tab === "alerts" ? <ViolationsGallery embedded /> : null}
      {tab === "reports" ? <PPEReports embedded /> : null}
      {tab === "analytics" ? <PPEAnalytics embedded /> : null}
      {tab === "review" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <PPEReviewDashboard embedded />
        </div>
      ) : null}
      {tab === "modelops" ? <PPEModelOps /> : null}
      {tab === "setup" ? (
        <>
          <SetupPanel onGo={go} />
          <PPEControlRoom embedded onNavigate={go} />
        </>
      ) : null}
    </PpeShell>
  );
}

function SetupPanel({ onGo }: { onGo: (t: string) => void }) {
  return (
    <div style={{ padding: "16px 20px 0" }}>
      <div
        className="ppe-panel"
        style={{ padding: "16px 18px", marginBottom: 8 }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>How to run this system</h2>
        <ol
          style={{
            margin: "0 0 14px",
            paddingLeft: 18,
            color: "var(--ink-3)",
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          <li>
            Below: pick <b style={{ color: "var(--ink)" }}>AI Model</b> — SH17 for plant accuracy, lighter
            models for demo FPS.
          </li>
          <li>Add a source — Webcam, RTSP CCTV, ONVIF, HLS, folder, or upload video.</li>
          <li>
            Set mode <b style={{ color: "var(--ink)" }}>Monitor</b> (detect+alert) or{" "}
            <b style={{ color: "var(--ink)" }}>Collect</b> (also harvest for training).
          </li>
          <li>
            Open{" "}
            <button type="button" onClick={() => onGo("wall")} style={linkBtn}>
              Wall
            </button>{" "}
            for plant TV ops.
          </li>
          <li>
            Use{" "}
            <button type="button" onClick={() => onGo("alerts")} style={linkBtn}>
              Alerts
            </button>{" "}
            for evidence;{" "}
            <button type="button" onClick={() => onGo("review")} style={linkBtn}>
              Review
            </button>{" "}
            to fix labels;{" "}
            <button type="button" onClick={() => onGo("nvr")} style={linkBtn}>
              Recorder
            </button>{" "}
            for timeline evidence.
          </li>
        </ol>
        <div className="ppe-banner ppe-banner--warn" style={{ margin: 0 }}>
          <span>
            <b>Model coverage:</b> SH17 covers industrial hardhats (all colours), vest, gloves, goggles,
            boots. Stock css-data models (Snehil/VoxDroid) miss some colours and most fine gear. Fine-tune
            via Review → train → promote. See{" "}
            <button type="button" onClick={() => onGo("analytics")} style={linkBtn}>
              Analytics → coverage
            </button>
            .
          </span>
        </div>
      </div>
    </div>
  );
}

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--steel)",
  fontWeight: 800,
  cursor: "pointer",
  padding: 0,
  fontSize: "inherit",
  textDecoration: "underline",
};
