"use client";

/**
 * Report Studio shell — isolated from CAPEX / DPR / dashboard modules.
 * Heavy designer code only loads on builder/tools routes; hub + templates stay light.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileStack, FlaskConical, LayoutDashboard, LayoutTemplate, Scale, Table2, Wrench,
} from "lucide-react";

const NAV = [
  { href: "/report-studio", label: "Hub", icon: FlaskConical, exact: true },
  { href: "/report-studio/builder", label: "Matrix Builder", icon: Table2 },
  { href: "/report-studio/canvas", label: "Dashboard Canvas", icon: LayoutDashboard },
  { href: "/report-studio/matrix", label: "Matrix Engine", icon: Scale },
  { href: "/report-studio/templates", label: "Templates", icon: FileStack },
  { href: "/report-studio/tools", label: "Tools", icon: Wrench },
];

export default function ReportStudioLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="rs-shell" style={{ minHeight: "100%", margin: "-8px -8px 0", background: "var(--bg)", color: "var(--ink)" }}>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 20,
          borderBottom: "1px solid var(--line)",
          background: "color-mix(in srgb, var(--panel) 92%, transparent)",
          backdropFilter: "blur(8px)",
          padding: "10px 20px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LayoutTemplate size={18} style={{ color: "var(--steel)" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" }}>Report Studio</div>
              <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
                Isolated designer · save templates · regenerate anytime with live CAPEX figures
              </div>
            </div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 0 }}>
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: "10px 10px 0 0",
                  fontSize: 12.5, fontWeight: 750, textDecoration: "none",
                  color: active ? "var(--steel)" : "var(--ink-3)",
                  background: active ? "var(--steel-soft)" : "transparent",
                  border: active ? "1px solid var(--line)" : "1px solid transparent",
                  borderBottom: active ? "1px solid var(--bg)" : "1px solid transparent",
                  marginBottom: active ? -1 : 0,
                }}
              >
                <Icon size={13} /> {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div style={{ padding: "4px 0 32px" }}>{children}</div>
    </div>
  );
}
