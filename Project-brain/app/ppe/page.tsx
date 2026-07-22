"use client";
import { useCallback, useEffect, useState } from "react";
import PPEControlRoom from "../../components/ppe/PPEControlRoom";
import PPEReviewDashboard from "../../components/ppe/PPEReviewDashboard";
import ViolationsGallery from "../../components/ppe/ViolationsGallery";
import PPEAnalytics from "../../components/ppe/PPEAnalytics";
import PPEReports from "../../components/ppe/PPEReports";
import PPEAlertSettings from "../../components/ppe/PPEAlertSettings";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

type Tab = "live" | "alerts" | "reports" | "analytics" | "review" | "settings";

type Health = "connecting" | "online" | "offline";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "live", label: "Live", hint: "Real-time multi-camera grid with Found / Not found overlays" },
  { id: "alerts", label: "Alerts", hint: "Violation evidence · ack · resolve" },
  { id: "reports", label: "Reports", hint: "Audit log · trends · CSV export" },
  { id: "analytics", label: "Analytics", hint: "KPIs · model PPE coverage" },
  { id: "review", label: "Review", hint: "Label frames to improve the model" },
  { id: "settings", label: "Settings", hint: "Telegram alerts \u00b7 cooldown \u00b7 channels" },
];

export default function PPEPage() {
  const [tab, setTab] = useState<Tab>("live");
  const [health, setHealth] = useState<Health>("connecting");
  const [openAlerts, setOpenAlerts] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [camRunning, setCamRunning] = useState(0);
  const [camTotal, setCamTotal] = useState(0);

  const refreshMeta = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/health`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("health");
      });
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
    refreshMeta();
    const t = setInterval(refreshMeta, 5000);
    return () => clearInterval(t);
  }, [refreshMeta]);

  const badge = (n: number, tone: "danger" | "warn" | "mute" = "mute") => {
    if (!n) return null;
    const colors =
      tone === "danger"
        ? { bg: "#fdecee", fg: "#c02b3c" }
        : tone === "warn"
          ? { bg: "#fdf1e3", fg: "#b25e00" }
          : { bg: "#eef1f5", fg: "#5b6b7b" };
    return (
      <span
        style={{
          marginLeft: 6,
          minWidth: 18,
          height: 18,
          padding: "0 6px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: colors.bg,
          color: colors.fg,
        }}
      >
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const healthDot =
    health === "online" ? "#0a8f5b" : health === "offline" ? "#c02b3c" : "#b25e00";
  const healthLabel =
    health === "online" ? "Service online" : health === "offline" ? "Service offline" : "Connecting…";

  return (
    <div
      style={{
        margin: "-3rem",
        minHeight: "calc(100vh - 0px)",
        background: "var(--bg)",
        fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, sans-serif",
        color: "var(--ink)",
      }}
    >
      {/* Sticky app chrome — compact so monitor + controls stay visible */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "#dbeafe",
          borderBottom: "1px solid #93c5fd",
          color: "#0a0a0a",
          /* allow model dropdown to paint above header when open near top */
          overflow: "visible",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 20px 0",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "linear-gradient(135deg, var(--steel-2), var(--steel-deep))",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                flexShrink: 0,
              }}
              aria-hidden
            >
              ◎
            </div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.2 }}>
              PPE Camera Detection
            </h1>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <MetaChip
              label="Cams"
              value={health === "online" ? `${camRunning}/${camTotal}` : "—"}
              tone={camRunning > 0 ? "ok" : "mute"}
            />
            <MetaChip label="Alerts" value={health === "online" ? String(openAlerts) : "—"} tone={openAlerts > 0 ? "danger" : "mute"} />
            <MetaChip
              label="Review"
              value={health === "online" ? String(pendingReview) : "—"}
              tone={pendingReview > 0 ? "warn" : "mute"}
            />
            <div
              title={health === "offline" ? `Cannot reach ${API_BASE}` : API_BASE}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                background: health === "online" ? "#e6f6ef" : health === "offline" ? "#fdecee" : "#fdf1e3",
                border: `1px solid ${health === "online" ? "#b8e6d0" : health === "offline" ? "#f5c2c8" : "#f0d4a8"}`,
                fontSize: 11.5,
                fontWeight: 700,
                color: health === "online" ? "#0a8f5b" : health === "offline" ? "#c02b3c" : "#b25e00",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: healthDot,
                  boxShadow: health === "online" ? `0 0 0 3px rgba(10,143,91,.2)` : "none",
                  animation: health === "connecting" ? "ppe-pulse 1.2s ease infinite" : undefined,
                }}
              />
              {healthLabel}
            </div>
            <button
              type="button"
              title="Plant TV wall — live video + alert ticker (new tab)"
              onClick={() => window.open("/ppe/desktop?tab=wall", "_blank", "noopener,noreferrer")}
              style={{
                border: "1px solid var(--steel)",
                background: "var(--steel-soft)",
                color: "var(--steel)",
                borderRadius: 9,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🖥 Wall
            </button>
            <button
              type="button"
              title="Open full desktop control center in a new tab (no sidebar)"
              onClick={() => window.open("/ppe/desktop", "_blank", "noopener,noreferrer")}
              style={{
                border: "none",
                background: "var(--steel)",
                color: "#fff",
                borderRadius: 9,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ⛶ Desktop view
            </button>
          </div>
        </div>

        <nav
          role="tablist"
          aria-label="PPE sections"
          style={{
            display: "flex",
            gap: 2,
            padding: "4px 20px 0",
            overflowX: "auto",
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                title={t.hint}
                style={{
                  position: "relative",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: "10px 14px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: active ? "var(--steel)" : "var(--ink-3)",
                  display: "inline-flex",
                  alignItems: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
                {t.id === "alerts" && badge(openAlerts, "danger")}
                {t.id === "review" && badge(pendingReview, "warn")}
                <span
                  style={{
                    position: "absolute",
                    left: 10,
                    right: 10,
                    bottom: 0,
                    height: 3,
                    borderRadius: "3px 3px 0 0",
                    background: active ? "var(--steel)" : "transparent",
                  }}
                />
              </button>
            );
          })}
        </nav>
      </header>

      {/* Offline banner */}
      {health === "offline" && (
        <div
          style={{
            margin: "0 28px",
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 12,
            background: "#fdecee",
            border: "1px solid #f5c2c8",
            color: "#8a1020",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ flex: 1 }}>
            PPE backend unreachable at <code style={{ fontSize: 12 }}>{API_BASE}</code>. Start the service to enable
            live detection.
          </span>
          <button
            onClick={refreshMeta}
            style={{
              border: "1px solid #c02b3c",
              background: "var(--panel)",
              color: "var(--molten)",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ paddingBottom: 40 }}>
        {tab === "live" ? (
          <PPEControlRoom embedded onNavigate={(t) => setTab(t as Tab)} />
        ) : tab === "alerts" ? (
          <ViolationsGallery embedded />
        ) : tab === "reports" ? (
          <PPEReports embedded />
        ) : tab === "analytics" ? (
          <PPEAnalytics embedded />
        ) : tab === "settings" ? (
          <PPEAlertSettings />
        ) : (
          <PPEReviewDashboard embedded />
        )}
      </div>

      <style>{`
        @keyframes ppe-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .35; }
        }
      `}</style>
    </div>
  );
}

function MetaChip({
  label,
  value,
  tone = "mute",
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger" | "warn" | "mute";
}) {
  const map = {
    ok: { fg: "#0a8f5b", bg: "#e6f6ef", bd: "#b8e6d0" },
    danger: { fg: "#c02b3c", bg: "#fdecee", bd: "#f5c2c8" },
    warn: { fg: "#b25e00", bg: "#fdf1e3", bd: "#f0d4a8" },
    mute: { fg: "var(--ink-3)", bg: "var(--panel-2)", bd: "var(--line)" },
  }[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        padding: "5px 11px",
        borderRadius: 9,
        background: map.bg,
        border: `1px solid ${map.bd}`,
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--ink-4)", fontWeight: 600 }}>{label}</span>
      <span style={{ color: map.fg, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
