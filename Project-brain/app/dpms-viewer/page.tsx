"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Database, ExternalLink, GitBranch, List, RefreshCw, Table2 } from "lucide-react";

const DPMS_URL = process.env.NEXT_PUBLIC_DPMS_VIEWER_URL || "http://localhost:8010";

const DpmsErdStudio = dynamic(() => import("@/components/dpms/DpmsErdStudio"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 28, fontSize: 13, color: "var(--ink-4)" }}>
      Loading join board…
    </div>
  ),
});

const DpmsSavedLinks = dynamic(() => import("@/components/dpms/DpmsSavedLinks"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 28, fontSize: 13, color: "var(--ink-4)" }}>
      Loading saved relationships…
    </div>
  ),
});

const DpmsTableData = dynamic(() => import("@/components/dpms/DpmsTableData"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 28, fontSize: 13, color: "var(--ink-4)" }}>
      Loading table data…
    </div>
  ),
});

type Tab = "board" | "data" | "saved" | "classic";

export default function DpmsViewerPage() {
  const [tab, setTab] = useState<Tab>("board");
  const [frameKey, setFrameKey] = useState(0);
  const [classicLoaded, setClassicLoaded] = useState(false);

  return (
    <main style={{ padding: 16, minHeight: "100%", color: "var(--ink)" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Database size={18} style={{ color: "var(--steel)" }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>DPMS Schema Studio</h1>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ink-4)" }}>
              Drag 2–3 tables → review suggested arrows → save → next batch
            </p>
          </div>
        </div>

        <nav
          style={{
            display: "flex",
            gap: 4,
            marginLeft: "auto",
            flexWrap: "wrap",
            background: "var(--panel-2, #f1f5f9)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 4,
          }}
        >
          <TabBtn active={tab === "board"} onClick={() => setTab("board")} icon={<GitBranch size={13} />}>
            Join board
          </TabBtn>
          <TabBtn active={tab === "data"} onClick={() => setTab("data")} icon={<Table2 size={13} />}>
            Table data
          </TabBtn>
          <TabBtn active={tab === "saved"} onClick={() => setTab("saved")} icon={<List size={13} />}>
            Saved links
          </TabBtn>
          <TabBtn active={tab === "classic"} onClick={() => setTab("classic")} icon={<ExternalLink size={13} />}>
            Classic viewer
          </TabBtn>
        </nav>
      </header>

      {tab === "board" ? <DpmsErdStudio /> : null}
      {tab === "data" ? <DpmsTableData /> : null}
      {tab === "saved" ? <DpmsSavedLinks /> : null}

      {tab === "classic" ? (
        <section
          style={{
            border: "1px solid var(--line)",
            borderRadius: 18,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
            minHeight: "calc(100vh - 120px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid var(--line)",
              background: "var(--panel-2)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 850 }}>Classic DPMS viewer</span>
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{DPMS_URL}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setClassicLoaded(false);
                  setFrameKey((k) => k + 1);
                }}
                style={toolbarBtn}
              >
                <RefreshCw size={13} /> Reload
              </button>
              <a href={DPMS_URL} target="_blank" rel="noreferrer" style={{ ...toolbarBtn, textDecoration: "none" }}>
                <ExternalLink size={13} /> New tab
              </a>
            </div>
          </div>
          {!classicLoaded ? (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--ink-4)", borderBottom: "1px solid var(--line)" }}>
              Loading classic viewer… if blank, start DPMS on port 8010.
            </div>
          ) : null}
          <iframe
            key={frameKey}
            src={DPMS_URL}
            title="DPMS Classic Viewer"
            onLoad={() => setClassicLoaded(true)}
            style={{
              width: "100%",
              height: "calc(100vh - 170px)",
              minHeight: 560,
              border: 0,
              display: "block",
              background: "#fff",
            }}
          />
        </section>
      ) : null}
    </main>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: active ? "1px solid #93c5fd" : "1px solid transparent",
        borderRadius: 10,
        background: active ? "#dbeafe" : "transparent",
        color: "var(--ink)",
        padding: "7px 12px",
        fontSize: 12,
        fontWeight: active ? 850 : 650,
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

const toolbarBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--panel)",
  color: "var(--ink)",
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 750,
  cursor: "pointer",
};
