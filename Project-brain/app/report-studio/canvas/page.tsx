"use client";

/**
 * Dashboard Canvas route — dynamic import keeps recharts + canvas code out of
 * hub / templates / other modules (same pattern as Matrix Builder).
 */

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const DashboardCanvas = dynamic(() => import("../DashboardCanvas"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 48, color: "var(--ink-3)", fontSize: 13 }}>
      <Loader2 size={16} className="spin" /> Loading Dashboard Canvas…
    </div>
  ),
});

export default function CanvasPage() {
  return <DashboardCanvas />;
}
