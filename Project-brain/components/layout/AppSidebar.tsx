"use client";

import type { ComponentType, CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Boxes,
  Brain,
  Calendar,
  CheckSquare,
  ClipboardList,
  Database,
  DollarSign,
  FileText,
  FolderGit2,
  LayoutDashboard,
  Network,
  Package,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  FlaskConical,
  Gauge,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "../../theme/ThemeProvider";

type ModuleItem = {
  name: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  path: string;
};

type NavGroup = { label: string; items: ModuleItem[] };

/** Sprint 0 — IA regroup: Command / Plan / Execute / Intelligence / Admin */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Command",
    items: [
      { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
      { name: "Reports", icon: BarChart3, path: "/reports" },
      { name: "Report Studio", icon: FlaskConical, path: "/report-studio" },
      { name: "Risk", icon: Activity, path: "/risk" },
    ],
  },
  {
    label: "Plan",
    items: [
      { name: "Add Scheme", icon: Plus, path: "/add" },
      { name: "View Schemes", icon: FolderGit2, path: "/view" },
      { name: "Plan Engine", icon: ClipboardList, path: "/progress/plan-engine" },
      { name: "Appendix-2", icon: FileText, path: "/appendix-2" },
      { name: "CAPEX", icon: DollarSign, path: "/capex" },
      { name: "Billing Schedule", icon: Receipt, path: "/billing" },
      { name: "CPM Engine", icon: Network, path: "/cpm" },
      { name: "CPM Studio", icon: Network, path: "/furnace/cpm" },
    ],
  },
  {
    label: "Execute",
    items: [
      { name: "DPR Entry", icon: Calendar, path: "/dpr" },
      { name: "Physical Progress", icon: Activity, path: "/physical" },
      { name: "Execution", icon: CheckSquare, path: "/execution" },
      { name: "Material Tracking", icon: Package, path: "/material" },
      { name: "Notesheet", icon: FileText, path: "/notesheet" },
      { name: "Site Diary", icon: ClipboardList, path: "/mobile/diary" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { name: "AI Assistant", icon: Brain, path: "/ai" },
      { name: "Document Vault", icon: FileText, path: "/documents" },
      { name: "Knowledge Graph", icon: Network, path: "/knowledge-graph" },
      { name: "DPMS Viewer", icon: Database, path: "/dpms-viewer" },
      { name: "Delay Analysis", icon: Calendar, path: "/delay-analysis" },
      { name: "EVM Studio", icon: Gauge, path: "/evm" },
      { name: "4D BIM", icon: Boxes, path: "/bim" },
      { name: "PPE Camera AI", icon: ShieldCheck, path: "/ppe" },
    ],
  },
  {
    label: "Admin",
    items: [
      { name: "Admin Console", icon: Settings, path: "/admin" },
      { name: "Status Change", icon: Settings, path: "/status" },
      { name: "AI Settings", icon: Brain, path: "/ai/settings" },
    ],
  },
];

const baseLinkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  borderRadius: 14,
  marginBottom: 4,
  color: "#0a0a0a",
  background: "transparent",
  border: "1px solid transparent",
  transition: "transform .22s cubic-bezier(.22,1,.36,1), box-shadow .22s ease, background .18s ease",
  fontWeight: 700,
  fontSize: 14.5,
  letterSpacing: "-0.015em",
};

function activeLinkStyle(): CSSProperties {
  return {
    ...baseLinkStyle,
    color: "#0a0a0a",
    background: "#dbeafe",
    border: "1px solid #93c5fd",
    boxShadow: "0 4px 12px -8px rgba(37,99,235,.35)",
    transform: "translateX(4px)",
  };
}

function passiveSurfaceStyle(): CSSProperties {
  return {
    background: "var(--panel)",
    borderRight: "1px solid var(--line)",
    color: "var(--ink)",
    boxShadow: "var(--shadow)",
  };
}

function isActivePath(pathname: string, path: string): boolean {
  if (path === "/reports") return pathname === "/reports" || pathname.startsWith("/reports/");
  if (path === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/furnace/admin");
  if (path === "/furnace/cpm") return pathname.startsWith("/furnace/cpm");
  if (path === "/ai") return pathname === "/ai" || (pathname.startsWith("/ai/") && !pathname.startsWith("/ai/settings"));
  if (path === "/view") return pathname === "/view" || pathname.startsWith("/view/");
  return pathname === path || pathname.startsWith(path + "/");
}

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div
      className="z-10 flex h-screen w-80 flex-col"
      style={{ ...passiveSurfaceStyle(), position: "fixed", left: 0, top: 0, background: "#ffffff" }}
      data-sidebar
    >
      <div
        className="flex items-center gap-4 p-6"
        style={{
          borderBottom: "1px solid #93c5fd",
          /* Solid light-blue brand header — crisp black type */
          background: "#dbeafe",
        }}
      >
        <motion.div
          animate={{ rotate: [-12, 12, -12] }}
          transition={{ duration: 8, repeat: Infinity }}
          className="text-5xl"
        >
          🧠
        </motion.div>
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-display), Fraunces, Georgia, serif",
              color: "#0a0a0a",
              WebkitTextFillColor: "#0a0a0a",
              background: "none",
            }}
          >
            PROJECT BRAIN
          </h1>
          <p className="text-xs font-semibold" style={{ color: "#0a0a0a" }}>
            RSP · Ministry Command
          </p>
        </div>
      </div>

      <div className="px-6 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <ThemeToggle className="w-full justify-center" />
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          return (
          <div key={group.label} className="mb-3">
            <p
              className="mb-2 px-3 text-[11px] font-extrabold uppercase tracking-[0.12em]"
              style={{ color: "#0a0a0a" }}
            >
              {group.label}
            </p>
            {group.items.map((module) => {
              const Icon = module.icon;
              const active = isActivePath(pathname, module.path);
              return (
                <button
                  key={module.path}
                  type="button"
                  onClick={() => router.push(module.path)}
                  className="w-full"
                  style={active ? activeLinkStyle() : baseLinkStyle}
                >
                  <Icon className="h-4 w-4 shrink-0" style={{ color: "#0a0a0a" }} />
                  <span className="text-sm font-semibold" style={{ letterSpacing: "-0.01em", color: "#0a0a0a" }}>{module.name}</span>
                </button>
              );
            })}
          </div>
          );
        })}
      </div>

      <div className="px-4 py-3 text-[10px]" style={{ borderTop: "1px solid #e2e8f0", color: "#0a0a0a" }}>
        Sprint 0 shell · auth-hardened routes
      </div>
    </div>
  );
}
