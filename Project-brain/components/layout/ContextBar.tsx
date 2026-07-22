"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Calendar, LogOut, User } from "lucide-react";
import { clearSession, getStoredUser, getToken, type BrainUser } from "@/lib/auth";
import { ThemeToggle } from "@/theme/ThemeProvider";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

function currentFY(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}

function currentMonth(): string {
  return new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function ContextBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<BrainUser | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [schemeLabel, setSchemeLabel] = useState("Portfolio");
  const [brandTitle, setBrandTitle] = useState("");
  const [fyLabel, setFyLabel] = useState("FY");
  const [monthLabel, setMonthLabel] = useState("");

  useEffect(() => {
    setMounted(true);
    setUser(getStoredUser());
    setLoggedIn(Boolean(getToken()));
    setFyLabel(`FY ${currentFY()}`);
    setMonthLabel(currentMonth());

    try {
      const sid = localStorage.getItem("pb_context_scheme");
      const sname = localStorage.getItem("pb_context_scheme_name");
      if (sid && sname) setSchemeLabel(`#${sid} · ${sname}`);
      else if (sid) setSchemeLabel(`Scheme #${sid}`);
    } catch {
      /* ignore */
    }

    fetch(`${API}/admin/branding`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.header_title) setBrandTitle(d.header_title);
        if (d?.org_name && typeof document !== "undefined") {
          try {
            localStorage.setItem("pb_brand_org", d.org_name);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
  }, [pathname]);

  if (pathname === "/login") return null;

  const logout = () => {
    clearSession();
    router.push("/login");
  };

  return (
    <div
      className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-xs"
      style={{
        background: "#dbeafe",
        borderColor: "#93c5fd",
        color: "#0a0a0a",
        fontFamily: "var(--font-sans), DM Sans, system-ui, sans-serif",
        fontWeight: 600,
        boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 2px 8px -4px rgba(37,99,235,.2)",
      }}
      data-context-bar
    >
      {brandTitle && (
        <span
          className="hidden max-w-[240px] truncate md:inline"
          style={{
            color: "#0a0a0a",
            fontFamily: "var(--font-display), Fraunces, Georgia, serif",
            fontWeight: 700,
            fontSize: 13,
          }}
          title={brandTitle}
        >
          {brandTitle}
        </span>
      )}

      <span
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ color: "#0a0a0a", background: "#ffffff", border: "1px solid #93c5fd" }}
      >
        <Building2 size={13} />
        {schemeLabel}
      </span>

      <span
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ color: "#0a0a0a", background: "#ffffff", border: "1px solid #93c5fd" }}
      >
        <Calendar size={12} />
        {fyLabel}{monthLabel ? ` · ${monthLabel}` : ""}
      </span>

      <span className="hidden h-3 w-px sm:inline-block" style={{ background: "#93c5fd" }} />

      <span className="flex items-center gap-1.5" style={{ color: "#0a0a0a" }}>
        <User size={12} style={{ color: "#0a0a0a" }} />
        {user?.full_name || user?.username || (mounted && loggedIn ? "Signed in" : "Guest")}
        {user?.role && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              background: "#ffffff",
              color: "#0a0a0a",
              border: "1px solid #93c5fd",
            }}
          >
            {user.role}
          </span>
        )}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        {mounted && loggedIn ? (
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1 font-semibold hover:opacity-90"
            style={{ borderColor: "#93c5fd", color: "#0a0a0a", background: "#ffffff" }}
          >
            <LogOut size={12} /> Logout
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="rounded-lg border px-2.5 py-1 font-semibold"
            style={{ borderColor: "#2563eb", color: "#0a0a0a", background: "#ffffff" }}
          >
            Login
          </button>
        )}
      </div>
    </div>
  );
}
