"use client";
import React, { CSSProperties, ReactNode, useEffect, useState } from "react";

/* ---------- Card (3D-ready) ---------- */
export function Card({ children, style, pad = true }: { children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return (
    <div
      className="ui-card card-3d"
      style={{
        background: "linear-gradient(155deg, color-mix(in srgb, var(--panel) 96%, #fff), var(--panel) 50%, color-mix(in srgb, var(--panel) 92%, var(--steel)))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "0 1px 0 rgba(255,255,255,.85) inset, var(--shadow)",
        padding: pad ? 18 : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ---------- Button ---------- */
type BtnKind = "default" | "accent" | "ghost" | "steel";
export function Button({ children, onClick, kind = "default", disabled, style, type = "button", title }:
  { children: ReactNode; onClick?: () => void; kind?: BtnKind; disabled?: boolean; style?: CSSProperties; type?: "button" | "submit"; title?: string }) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 9, padding: "8px 13px",
    font: "600 12.5px var(--font-sans), DM Sans, system-ui, sans-serif", cursor: disabled ? "not-allowed" : "pointer", transition: ".15s",
    opacity: disabled ? .5 : 1, border: "1px solid var(--line-2)", color: "var(--ink)", background: "var(--panel-3)",
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    default: { boxShadow: "0 4px 12px -6px color-mix(in srgb, var(--steel) 25%, transparent)" },
    ghost: { background: "transparent", border: "1px solid transparent", color: "var(--ink-2)" },
    steel: {
      background: "linear-gradient(135deg, var(--steel-2), var(--steel), var(--accent-violet, #7c3aed))",
      borderColor: "var(--steel)", color: "#fff",
      boxShadow: "0 10px 22px -10px color-mix(in srgb, var(--steel) 65%, transparent)",
    },
    accent: {
      background: "linear-gradient(135deg, var(--ember), var(--molten))",
      borderColor: "var(--molten)", color: "#fff",
      boxShadow: "0 10px 22px -10px color-mix(in srgb, var(--molten) 60%, transparent)",
    },
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

/* ---------- Chip / status pill ---------- */
type Tone = "ok" | "minor" | "moderate" | "critical" | "steel" | "neutral";
const TONE: Record<Tone, { fg: string; bg: string; bd: string }> = {
  ok: { fg: "var(--verdigris)", bg: "var(--verdigris-soft)", bd: "var(--verdigris)" },
  minor: { fg: "var(--slag)", bg: "var(--slag-soft)", bd: "var(--slag)" },
  moderate: { fg: "var(--ember)", bg: "var(--ember-soft)", bd: "var(--ember)" },
  critical: { fg: "var(--molten)", bg: "var(--molten-soft)", bd: "var(--molten)" },
  steel: { fg: "var(--steel)", bg: "var(--steel-soft)", bd: "var(--steel-dim)" },
  neutral: { fg: "var(--ink-2)", bg: "var(--panel-3)", bd: "var(--line-2)" },
};
export function Chip({ children, tone = "neutral", dot = false, style }:
  { children: ReactNode; tone?: Tone; dot?: boolean; style?: CSSProperties }) {
  const t = TONE[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, color: t.fg, background: t.bg,
      border: `1px solid color-mix(in srgb, ${t.bd} 35%, transparent)`, whiteSpace: "nowrap", ...style,
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.fg }} />}
      {children}
    </span>
  );
}
export const delayTone = (cat?: string | null): Tone =>
  cat === "critical" ? "critical" : cat === "moderate" ? "moderate" : cat === "minor" ? "minor" : "ok";

/* ---------- Field (label + control wrapper) ---------- */
export function Field({ label, children, style }: { label?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, ...style }}>
      {label && <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-3)", fontWeight: 600 }}>{label}</span>}
      {children}
    </label>
  );
}
const controlStyle: CSSProperties = {
  background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)",
  borderRadius: 9, padding: "8px 11px", font: "inherit", fontSize: 13, outline: "none", width: "100%",
};
export function Select({ value, onChange, options, style }:
  { value: string | number; onChange: (v: string) => void; options: { value: string | number; label: string }[]; style?: CSSProperties }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...controlStyle, cursor: "pointer", ...style }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Input({ value, onChange, placeholder, type = "text", style, mono, align }:
  { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; style?: CSSProperties; mono?: boolean; align?: "left" | "right" }) {
  return (
    <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      style={{ ...controlStyle, textAlign: align ?? "left", fontFamily: mono ? '"IBM Plex Mono", monospace' : "inherit", ...style }} />
  );
}

/* ---------- Tabs ---------- */
export function Tabs({ tabs, active, onChange }:
  { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div style={{
      display: "flex", gap: 6, flexWrap: "wrap", background: "var(--panel-3)", border: "1px solid var(--line)",
      borderRadius: 14, padding: 6, boxShadow: "0 1px 0 rgba(255,255,255,.7) inset",
    }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              background: on
                ? "linear-gradient(135deg, var(--steel-soft), color-mix(in srgb, var(--panel) 65%, var(--accent-violet, #7c3aed) 14%))"
                : "var(--panel)",
              border: on
                ? "1.5px solid color-mix(in srgb, var(--steel) 45%, var(--line))"
                : "1.5px solid var(--line)",
              color: on ? "var(--steel-deep, var(--steel))" : "var(--ink-2)",
              font: "800 13.5px var(--font-sans), DM Sans, system-ui, sans-serif",
              padding: "10px 16px",
              borderRadius: 11,
              cursor: "pointer",
              transition: "transform .22s cubic-bezier(.22,1,.36,1), box-shadow .22s ease",
              boxShadow: on
                ? "0 12px 22px -12px color-mix(in srgb, var(--steel) 50%, transparent)"
                : "0 1px 0 rgba(255,255,255,.8) inset",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-5px) scale(1.04)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0) scale(1)";
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented({ options, value, onChange }:
  { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return <button key={o.value} onClick={() => onChange(o.value)} style={{
          background: on ? "var(--steel-soft)" : "transparent", color: on ? "var(--steel)" : "var(--ink-3)",
          border: "none", font: "600 12px Inter", padding: "6px 13px", borderRadius: 7, cursor: "pointer", transition: ".14s",
        }}>{o.label}</button>;
      })}
    </div>
  );
}

/* ---------- KPI tile ---------- */
export function Kpi({ label, value, unit, tone = "steel", sub, icon }:
  { label: string; value: ReactNode; unit?: string; tone?: Tone; sub?: ReactNode; icon?: ReactNode }) {
  const t = TONE[tone];
  return (
    <div
      className="ui-card card-3d"
      style={{
        background: `linear-gradient(145deg, var(--panel) 0%, ${t.bg} 140%)`,
        border: `1px solid color-mix(in srgb, ${t.bd} 28%, var(--line))`,
        borderRadius: "var(--r-lg)",
        padding: "16px 17px",
        flex: 1,
        minWidth: 150,
        boxShadow: "0 1px 0 rgba(255,255,255,.9) inset, var(--shadow)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontSize: 11, color: t.fg, textTransform: "uppercase",
          letterSpacing: ".08em", fontWeight: 750,
        }}>{label}</span>
        {icon && (
          <span style={{
            width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center",
            background: t.bg, color: t.fg,
            boxShadow: `0 6px 14px -6px ${t.fg}`,
          }}>{icon}</span>
        )}
      </div>
      <div className="fz-display" style={{ fontWeight: 800, fontSize: 28, marginTop: 10, lineHeight: 1, color: "var(--ink)" }}>
        {value}{unit && <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

/* ---------- Toast ---------- */
let toastFn: ((m: string) => void) | null = null;
export function toast(m: string) { toastFn?.(m); }
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastFn = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 2200); };
    return () => { toastFn = null; };
  }, []);
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 60,
      background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)",
      padding: "11px 18px", borderRadius: 10, boxShadow: "var(--shadow-lg)", fontSize: 13,
      display: "flex", gap: 9, alignItems: "center",
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
      {msg}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div
      className="fx-reveal"
      style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap", marginBottom: 10,
        padding: "14px 16px",
        borderRadius: 16,
        /* Solid light-blue page header + black type for max contrast */
        background: "#dbeafe",
        border: "1px solid #93c5fd",
        boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 2px 8px -4px rgba(37,99,235,.18)",
      }}
    >
      <div>
        <h1 className="fz-display" style={{ fontWeight: 800, fontSize: 26, margin: 0, color: "#0a0a0a", WebkitTextFillColor: "#0a0a0a", background: "none" }}>{title}</h1>
        {subtitle && (
          <p style={{ fontSize: 13, color: "#0a0a0a", margin: "6px 0 0", fontWeight: 600 }}>{subtitle}</p>
        )}
      </div>
      {right && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>}
    </div>
  );
}
