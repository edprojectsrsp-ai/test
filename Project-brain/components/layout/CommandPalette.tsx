"use client";

/**
 * Command palette (⌘K / Ctrl+K).
 * Lightweight, no extra dependency — searches modules, live schemes, and
 * report shortcuts; arrow-key navigation, Enter to jump. Mounted globally in
 * the root layout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, LayoutDashboard, BarChart3, FlaskConical, Activity, Plus,
  FolderGit2, ClipboardList, FileText, DollarSign, TrendingUp, Receipt,
  Network, Calendar, CheckSquare, Package, Brain, Database, Gauge, Boxes,
  ShieldCheck, Settings, CornerDownLeft, ArrowUp, ArrowDown,
} from "lucide-react";
import { authHeaders } from "@/lib/auth";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1").replace(/\/$/, "");

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: "Module" | "Scheme" | "Report";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run: (router: ReturnType<typeof useRouter>) => void;
};

// Static module + report targets (mirror the sidebar).
const NAV: { label: string; path: string; icon: Item["icon"]; group: Item["group"] }[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, group: "Module" },
  { label: "Reports", path: "/reports", icon: BarChart3, group: "Module" },
  { label: "Report Studio", path: "/report-studio", icon: FlaskConical, group: "Module" },
  { label: "Risk", path: "/risk", icon: Activity, group: "Module" },
  { label: "Add Scheme", path: "/add", icon: Plus, group: "Module" },
  { label: "View Schemes", path: "/view", icon: FolderGit2, group: "Module" },
  { label: "Plan Engine", path: "/progress/plan-engine", icon: ClipboardList, group: "Module" },
  { label: "Appendix-2", path: "/appendix-2", icon: FileText, group: "Module" },
  { label: "CAPEX", path: "/capex", icon: DollarSign, group: "Module" },
  { label: "S-Curve Studio", path: "/s-curve", icon: TrendingUp, group: "Module" },
  { label: "Billing Schedule", path: "/billing", icon: Receipt, group: "Module" },
  { label: "CPM Studio", path: "/furnace/cpm", icon: Network, group: "Module" },
  { label: "DPR Entry", path: "/dpr", icon: Calendar, group: "Module" },
  { label: "Physical Progress", path: "/physical", icon: Activity, group: "Module" },
  { label: "Execution", path: "/execution", icon: CheckSquare, group: "Module" },
  { label: "Material Tracking", path: "/material", icon: Package, group: "Module" },
  { label: "Notesheet", path: "/notesheet", icon: FileText, group: "Module" },
  { label: "AI Assistant", path: "/ai", icon: Brain, group: "Module" },
  { label: "Document Vault", path: "/documents", icon: FileText, group: "Module" },
  { label: "Knowledge Graph", path: "/knowledge-graph", icon: Network, group: "Module" },
  { label: "DPMS Viewer", path: "/dpms-viewer", icon: Database, group: "Module" },
  { label: "Delay Analysis", path: "/delay-analysis", icon: Calendar, group: "Module" },
  { label: "EVM Studio", path: "/evm", icon: Gauge, group: "Module" },
  { label: "4D BIM", path: "/bim", icon: Boxes, group: "Module" },
  { label: "PPE Camera AI", path: "/ppe", icon: ShieldCheck, group: "Module" },
  { label: "Admin Console", path: "/admin", icon: Settings, group: "Module" },
  { label: "CMD Weekly Report", path: "/reports/cmd-weekly", icon: BarChart3, group: "Report" },
  { label: "Statics Report", path: "/reports/statics", icon: BarChart3, group: "Report" },
  { label: "MoS CAPEX Format", path: "/reports/mos-capex", icon: BarChart3, group: "Report" },
];

type SchemeCard = { id: number; name: string; status?: string };

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [schemes, setSchemes] = useState<SchemeCard[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K toggle (and Esc handled by the input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fetch schemes once, lazily on first open.
  useEffect(() => {
    if (!open || schemes.length) return;
    fetch(`${API}/dashboard/scheme-cards`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) && setSchemes(d.map((s: any) => ({ id: s.id, name: s.name, status: s.status }))))
      .catch(() => {});
  }, [open, schemes.length]);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [open]);

  const items: Item[] = useMemo(() => {
    const nav: Item[] = NAV.map((n) => ({
      id: `nav:${n.path}`, label: n.label, group: n.group, icon: n.icon,
      hint: n.path, run: (r) => r.push(n.path),
    }));
    const sch: Item[] = schemes.map((s) => ({
      id: `scheme:${s.id}`, label: s.name, group: "Scheme" as const, icon: FolderGit2,
      hint: `#${s.id}${s.status ? " · " + s.status : ""}`,
      run: (r) => r.push(`/view/${s.id}`),
    }));
    const all = [...nav, ...sch];
    const term = q.trim().toLowerCase();
    if (!term) return all.slice(0, 40);
    return all
      .filter((it) => it.label.toLowerCase().includes(term) || (it.hint || "").toLowerCase().includes(term))
      .slice(0, 40);
  }, [q, schemes]);

  useEffect(() => { setActive(0); }, [q]);

  const choose = useCallback((it?: Item) => {
    const pick = it || items[active];
    if (!pick) return;
    setOpen(false);
    pick.run(router);
  }, [items, active, router]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999, display: "flex",
            alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
            background: "color-mix(in srgb, #0a0a0a 45%, transparent)", backdropFilter: "blur(2px)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(620px, 92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column",
              background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 16,
              boxShadow: "var(--shadow-lg)", overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <Search size={18} style={{ color: "var(--ink-4)" }} />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onListKey}
                placeholder="Search modules, schemes, reports…"
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 15, color: "var(--ink)" }}
              />
              <kbd style={kbd}>Esc</kbd>
            </div>

            <div style={{ overflowY: "auto", padding: 6 }}>
              {items.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--ink-4)", fontSize: 13 }}>No matches.</div>
              )}
              {items.map((it, i) => {
                const Icon = it.icon;
                const isActive = i === active;
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(it)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                      padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                      background: isActive ? "var(--steel-soft)" : "transparent",
                      color: "var(--ink)", fontSize: 13.5,
                    }}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span style={{ flex: 1, fontWeight: 600 }}>{it.label}</span>
                    {it.hint && <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-mono)" }}>{it.hint}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
                      color: it.group === "Scheme" ? "var(--verdigris)" : it.group === "Report" ? "var(--accent-violet)" : "var(--steel)" }}>
                      {it.group}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 16px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--ink-4)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CornerDownLeft size={11} /> open</span>
              <span style={{ marginLeft: "auto" }}>{items.length} result{items.length === 1 ? "" : "s"}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const kbd: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5,
  border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--ink-4)",
};
