"use client";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; toggle: () => void; set: (t: Theme) => void };

const ThemeCtx = createContext<Ctx>({ theme: "light", toggle: () => {}, set: () => {} });
export const useTheme = () => useContext(ThemeCtx);

const KEY = "pb-theme";
const PRESET_KEY = "fz-preset";

/** Light executive worlds (never midnight on light mode). */
const LIGHT_PRESETS = new Set(["ministry", "aurora", "ocean"]);

function applyMinistryDefault() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", "light");
  root.setAttribute("data-fz-preset", "ministry");
  try {
    localStorage.setItem(KEY, "light");
    localStorage.setItem(PRESET_KEY, "ministry");
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children, defaultTheme = "light" }: { children: React.ReactNode; defaultTheme?: Theme }) {
  // Always start light so SSR + first paint match Ministry white
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(KEY) as Theme | null;
    // Default is always light/Ministry; only honor explicit dark choice
    if (saved === "dark") {
      setTheme("dark");
    } else {
      setTheme("light");
      try {
        localStorage.setItem(KEY, "light");
      } catch {
        /* ignore */
      }
    }
  }, [defaultTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);

    if (theme === "light") {
      let preset = "";
      try {
        preset = localStorage.getItem(PRESET_KEY) || "";
      } catch {
        preset = "";
      }
      // Force Ministry when missing, dark-only, or legacy presets
      if (!preset || !LIGHT_PRESETS.has(preset) || preset === "midnight") {
        preset = "ministry";
        try {
          localStorage.setItem(PRESET_KEY, "ministry");
        } catch {
          /* ignore */
        }
      }
      root.setAttribute("data-fz-preset", preset);
    } else {
      root.setAttribute("data-fz-preset", "midnight");
      try {
        localStorage.setItem(PRESET_KEY, "midnight");
      } catch {
        /* ignore */
      }
    }

    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const set = useCallback((t: Theme) => setTheme(t), []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      if (t === "light") return "dark";
      // Returning to light always restores Ministry as the home skin
      applyMinistryDefault();
      return "light";
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle, set }}>{children}</ThemeCtx.Provider>;
}

/** Drop-in toggle button. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to Ministry white theme" : "Switch to dark control room"}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        cursor: "pointer",
        background: "#ffffff",
        border: "1px solid #93c5fd",
        color: "#0a0a0a",
        borderRadius: 9,
        padding: "7px 11px",
        font: "600 12.5px Inter, system-ui, sans-serif",
        boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
      }}
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      {dark ? "Ministry" : "Dark"}
    </button>
  );
}
