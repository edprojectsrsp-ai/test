"use client";
/**
 * PPE Desktop Control Center — full-viewport, no Project Brain chrome.
 *
 * Industry tabs:
 *   Wall      — plant TV: live video + alert ticker (default for ops)
 *   Live      — manage model, sources, modes, large cards
 *   Alerts    — full evidence gallery
 *   Analytics — KPIs + model PPE coverage truth table
 *   Review    — active learning / teach
 *   Setup     — guided admin + model reality
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import PPEControlRoom from "../../../components/ppe/PPEControlRoom";
import PPEReviewDashboard from "../../../components/ppe/PPEReviewDashboard";
import ViolationsGallery from "../../../components/ppe/ViolationsGallery";
import PPEAnalytics from "../../../components/ppe/PPEAnalytics";
import PPEWallRoom from "../../../components/ppe/PPEWallRoom";
import PPEReports from "../../../components/ppe/PPEReports";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

type Tab = "wall" | "live" | "alerts" | "reports" | "analytics" | "review" | "setup";

const TABS: { id: Tab; label: string; hint: string; role: string }[] = [
  { id: "wall", label: "Wall", hint: "Plant TV — live video wall + alert ticker", role: "Operator" },
  { id: "live", label: "Live", hint: "Found/Not found overlays · PPE config · sources", role: "Operator" },
  { id: "alerts", label: "Alerts", hint: "Full violation gallery · ack · resolve", role: "Safety" },
  { id: "reports", label: "Reports", hint: "Audit log · trends · CSV export", role: "EHS lead" },
  { id: "analytics", label: "Analytics", hint: "KPIs · mix · Snehil/VoxDroid coverage", role: "EHS lead" },
  { id: "review", label: "Review", hint: "Label frames · improve the model", role: "ML ops" },
  { id: "setup", label: "Setup", hint: "How to run · model limits · flow", role: "Admin" },
];

export default function PPEDesktopPage() {
  const [tab, setTab] = useState<Tab>("wall");
  const [health, setHealth] = useState<"online" | "offline" | "connecting">("connecting");
  const [openAlerts, setOpenAlerts] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [camRunning, setCamRunning] = useState(0);
  const [camTotal, setCamTotal] = useState(0);
  const [clock, setClock] = useState("");

  const refresh = useCallback(async () => {
    try {
      const h = await fetch(`${API_BASE}/health`, { cache: "no-store" });
      if (!h.ok) throw new Error("health");
      setHealth("online");
      const [cams, types, pending] = await Promise.all([
        fetch(`${API_BASE}/api/cameras`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch(`${API_BASE}/api/violations/types`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${API_BASE}/api/review/pending`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      const list = Array.isArray(cams) ? cams : [];
      setCamTotal(list.length);
      setCamRunning(list.filter((c: { state?: string }) => c.state === "running").length);
      setOpenAlerts(Number(types?.total) || 0);
      setPendingReview(Array.isArray(pending) ? pending.length : 0);
    } catch {
      setHealth("offline");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.title = "PPE Control Center · Desktop";
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Deep-link ?tab=live
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab") as Tab | null;
      if (q && TABS.some((t) => t.id === q)) setTab(q);
    } catch { /* ignore */ }
  }, []);

  const badge = (n: number, tone: "danger" | "warn") => {
    if (!n) return null;
    return (
      <span style={{
        marginLeft: 6, minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999,
        fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: tone === "danger" ? "#fdecee" : "#fdf1e3",
        color: tone === "danger" ? "#c02b3c" : "#b25e00",
      }}>
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const go = (t: string) => {
    if (TABS.some((x) => x.id === t)) setTab(t as Tab);
  };

  const fillHeight = tab === "wall" || tab === "review";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        background: "#eef1f5",
        color: "#0f1e2e",
        fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <header style={{
        flexShrink: 0,
        background: "#0b1220",
        color: "#e7eef6",
        borderBottom: "1px solid #1e2c3a",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        minHeight: 50,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: "linear-gradient(135deg,#1256d1,#0a3d99)",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13,
          }}>
            ◎
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>PPE Control Center</div>
            <div style={{ fontSize: 10.5, color: "#7a8fa3" }}>Desktop · industry layout</div>
          </div>
        </div>

        <nav role="tablist" style={{ display: "flex", gap: 2, marginLeft: 8, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${t.hint} (${t.role})`}
                onClick={() => setTab(t.id)}
                style={{
                  border: "none",
                  background: active ? "rgba(18,86,209,.4)" : "transparent",
                  color: active ? "#fff" : "#9bb0c3",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {t.label}
                {t.id === "alerts" && badge(openAlerts, "danger")}
                {t.id === "wall" && badge(openAlerts, "danger")}
                {t.id === "review" && badge(pendingReview, "warn")}
              </button>
            );
          })}
        </nav>

        <span style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#9bb0c3", flexWrap: "wrap" }}>
          <span>
            Cams <b style={{ color: "#e7eef6" }}>{camRunning}/{camTotal}</b>
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            color: health === "online" ? "#3dd68c" : health === "offline" ? "#ff6b7a" : "#f0b429",
            fontWeight: 700,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: 4,
              background: health === "online" ? "#3dd68c" : health === "offline" ? "#ff6b7a" : "#f0b429",
            }} />
            {health === "online" ? "Online" : health === "offline" ? "Offline" : "…"}
          </span>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>{clock}</span>
          <a
            href="/ppe"
            style={{
              color: "#9bb0c3", textDecoration: "none", border: "1px solid #2a3a4c",
              borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600,
            }}
          >
            ← Embedded
          </a>
        </div>
      </header>

      {tab !== "wall" ? (
        <div style={{
          flexShrink: 0,
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          padding: "7px 16px",
          fontSize: 12.5,
          color: "var(--ink-3)",
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}>
          <span>
            <b style={{ color: "var(--ink)" }}>{TABS.find((t) => t.id === tab)?.label}</b>
            {" — "}
            {TABS.find((t) => t.id === tab)?.hint}
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{TABS.find((t) => t.id === tab)?.role}</span>
        </div>
      ) : null}

      {health === "offline" ? (
        <div style={{
          flexShrink: 0,
          background: "#3a1218",
          color: "#ffb4bc",
          padding: "8px 16px",
          fontSize: 12.5,
          fontWeight: 600,
        }}>
          PPE backend offline at {API_BASE} — start the service for live detection.
        </div>
      ) : null}

      <main style={{
        flex: 1,
        minHeight: 0,
        overflow: fillHeight ? "hidden" : "auto",
        background: tab === "wall" ? "#070b12" : "var(--bg)",
        display: fillHeight ? "flex" : "block",
        flexDirection: "column",
      }}>
        {tab === "wall" ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <PPEWallRoom onNavigate={go} />
          </div>
        ) : null}
        {tab === "live" ? (
          <PPEControlRoom embedded onNavigate={go} />
        ) : null}
        {tab === "alerts" ? <ViolationsGallery embedded /> : null}
        {tab === "reports" ? <PPEReports embedded /> : null}
        {tab === "analytics" ? <PPEAnalytics embedded /> : null}
        {tab === "review" ? (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <PPEReviewDashboard embedded />
          </div>
        ) : null}
        {tab === "setup" ? (
          <>
            <SetupPanel onGo={go} />
            <PPEControlRoom embedded onNavigate={go} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function SetupPanel({ onGo }: { onGo: (t: string) => void }) {
  return (
    <div style={{
      padding: "16px 20px 0",
      fontFamily: "Inter, system-ui, sans-serif",
      color: "var(--ink)",
    }}>
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "16px 18px",
        marginBottom: 4,
        boxShadow: "var(--shadow)",
      }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>How to run this system</h2>
        <ol style={{ margin: "0 0 12px", paddingLeft: 18, color: "var(--ink-3)", fontSize: 13.5, lineHeight: 1.55 }}>
          <li>Below: pick <b>AI Model</b> — VoxDroid (accuracy) or Snehil (demo).</li>
          <li>Add a source — Webcam, RTSP CCTV, or Upload video.</li>
          <li>Set mode <b>Monitor</b> (detect+alert) or <b>Collect</b> (also harvest for training).</li>
          <li>Open <button type="button" onClick={() => onGo("wall")} style={linkBtn}>Wall</button> for plant TV ops.</li>
          <li>Use <button type="button" onClick={() => onGo("alerts")} style={linkBtn}>Alerts</button> for evidence;{" "}
            <button type="button" onClick={() => onGo("review")} style={linkBtn}>Review</button> to fix labels.</li>
        </ol>
        <div style={{
          fontSize: 12.5, lineHeight: 1.5, color: "#5b6b7b",
          background: "#fdf1e3", border: "1px solid #f0d4a8", borderRadius: 10, padding: "10px 12px",
        }}>
          <b style={{ color: "#b25e00" }}>Model limit:</b> Snehil & VoxDroid both detect{" "}
          <b>helmet, vest, mask, person, cone, vehicle</b> only. Gloves / goggles / boots / harness need a custom-trained .pt
          (Review → export → train → Upload model). See{" "}
          <button type="button" onClick={() => onGo("analytics")} style={linkBtn}>Analytics → coverage table</button>.
        </div>
      </div>
    </div>
  );
}

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "#1256d1",
  fontWeight: 800,
  cursor: "pointer",
  padding: 0,
  fontSize: "inherit",
  textDecoration: "underline",
};
