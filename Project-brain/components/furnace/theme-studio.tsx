"use client";
/**
 * Visual Studio — 4 premium worlds + FX + motion + density + accent.
 * Each theme is polished; fewer options, stronger results.
 */
import React, { useEffect, useState } from "react";

const PRESETS = [
  {
    id: "ministry",
    name: "Ministry",
    desc: "White boardroom · navy & gold KPIs",
    chips: ["#0a3d9c", "#059669", "#ea580c"],
  },
  {
    id: "aurora",
    name: "Aurora",
    desc: "Violet glass · electric glow",
    chips: ["#6d28d9", "#06b6d4", "#f43f5e"],
  },
  {
    id: "ocean",
    name: "Ocean",
    desc: "Cyan calm · emerald accents",
    chips: ["#0e7490", "#10b981", "#6366f1"],
  },
  {
    id: "midnight",
    name: "Midnight",
    desc: "Dark control · neon cyan",
    chips: ["#38bdf8", "#a78bfa", "#0b1220"],
  },
];

const ACCENTS = ["", "#2563eb", "#06b6d4", "#7c3aed", "#059669", "#ea580c", "#db2777", "#e11d48"];
const FX_MODES = [
  { id: "3d", label: "3D Lift", tip: "Cards & rows float on hover" },
  { id: "glass", label: "Glass", tip: "Frosted translucent panels" },
  { id: "neon", label: "Neon", tip: "Halo glow edges" },
  { id: "flat", label: "Flat", tip: "Minimal (no lift)" },
];
const MOTION = [
  { id: "calm", label: "Calm" },
  { id: "", label: "Normal" },
  { id: "bold", label: "Bold" },
];
const DENSITIES = [
  { id: "compact", label: "Compact" },
  { id: "", label: "Normal" },
  { id: "comfortable", label: "Big type" },
];

function apply(preset: string, accent: string, density: string, fx: string, motion: string) {
  const root = document.documentElement;
  const safe = preset || "ministry";
  root.setAttribute("data-fz-preset", safe);

  if (accent) {
    root.setAttribute("data-fz-accent", "1");
    root.style.setProperty("--fz-accent", accent);
    root.style.setProperty("--steel", accent);
    root.style.setProperty("--steel-2", accent);
  } else {
    root.removeAttribute("data-fz-accent");
    root.style.removeProperty("--fz-accent");
    root.style.removeProperty("--steel");
    root.style.removeProperty("--steel-2");
  }

  if (density) root.setAttribute("data-fz-density", density);
  else root.removeAttribute("data-fz-density");

  // Default / preferred for Ministry: flat = sharp text (no soft 3D blur)
  if (fx && fx !== "3d") root.setAttribute("data-fz-fx", fx);
  else root.removeAttribute("data-fz-fx");

  if (motion) root.setAttribute("data-fz-motion", motion);
  else root.removeAttribute("data-fz-motion");

  // Sync light/dark with world
  if (safe === "midnight") {
    root.setAttribute("data-theme", "dark");
    try {
      localStorage.setItem("pb-theme", "dark");
    } catch {
      /* ignore */
    }
  } else {
    // Ministry / Aurora / Ocean are always light
    root.setAttribute("data-theme", "light");
    try {
      localStorage.setItem("pb-theme", "light");
    } catch {
      /* ignore */
    }
  }
}

export default function ThemeStudio() {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("ministry");
  const [accent, setAccent] = useState("");
  const [density, setDensity] = useState("");
  const [fx, setFx] = useState("flat");
  const [motion, setMotion] = useState("calm");

  useEffect(() => {
    try {
      const p = localStorage.getItem("fz-preset") ?? "ministry";
      const a = localStorage.getItem("fz-accent") ?? "";
      // Sharp defaults: Ministry + flat + calm (no foggy FX)
      const d = localStorage.getItem("fz-density") ?? "";
      const f = localStorage.getItem("fz-fx") ?? "flat";
      const m = localStorage.getItem("fz-motion") ?? "calm";
      // migrate old / invalid presets → Ministry
      const valid = PRESETS.some((x) => x.id === p) ? p : "ministry";
      setPreset(valid);
      setAccent(a);
      setDensity(d);
      setFx(f);
      setMotion(m);
      apply(valid, a, d, f, m);
      try {
        localStorage.setItem("fz-preset", valid);
      } catch {
        /* ignore */
      }
    } catch {
      apply("ministry", "", "", "flat", "calm");
    }
  }, []);

  const update = (p = preset, a = accent, d = density, f = fx, m = motion) => {
    setPreset(p);
    setAccent(a);
    setDensity(d);
    setFx(f);
    setMotion(m);
    apply(p, a, d, f, m);
    try {
      localStorage.setItem("fz-preset", p);
      localStorage.setItem("fz-accent", a);
      localStorage.setItem("fz-density", d);
      localStorage.setItem("fz-fx", f);
      localStorage.setItem("fz-motion", m);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <button
        id="theme-studio-fab"
        onClick={() => setOpen((o) => !o)}
        title="Visual Studio"
        type="button"
        aria-expanded={open}
        style={{
          position: "fixed",
          right: 20,
          bottom: 88,
          zIndex: 80,
          width: 56,
          height: 56,
          borderRadius: 28,
          border: "2px solid rgba(255,255,255,.4)",
          background: "linear-gradient(135deg, var(--steel), var(--accent-violet, #7c3aed), var(--ember))",
          color: "#fff",
          fontSize: 24,
          cursor: "pointer",
          boxShadow: "0 14px 32px -10px color-mix(in srgb, var(--steel) 65%, transparent)",
        }}
      >
        ◐
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Visual Studio"
          className="ui-card card-3d"
          style={{
            position: "fixed",
            right: 20,
            bottom: 158,
            zIndex: 80,
            width: 360,
            maxHeight: "min(82vh, 700px)",
            overflowY: "auto",
            padding: 18,
            background: "#ffffff",
            border: "1px solid #93c5fd",
            borderRadius: 20,
            boxShadow: "var(--shadow-lg)",
            color: "#0a0a0a",
            fontFamily: "var(--font-sans), DM Sans, system-ui, sans-serif",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  fontFamily: "var(--font-display), Fraunces, serif",
                  color: "#0a0a0a",
                }}
              >
                Visual Studio
              </div>
              <div style={{ fontSize: 11, color: "#0a0a0a", marginTop: 2, fontWeight: 600 }}>
                Default: Ministry · light blue headers · black text
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: 32, height: 32, borderRadius: 10, border: "1px solid var(--line)",
                background: "var(--panel-3)", color: "var(--ink-2)", cursor: "pointer", fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>

          <Label>World</Label>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => update(p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                  borderRadius: 14,
                  border: `2px solid ${preset === p.id ? "var(--steel)" : "var(--line)"}`,
                  background: preset === p.id
                    ? "linear-gradient(135deg, var(--steel-soft), color-mix(in srgb, var(--panel) 70%, var(--accent-violet, #7c3aed) 12%))"
                    : "var(--panel)",
                  color: "var(--ink)",
                  boxShadow: preset === p.id
                    ? "0 12px 24px -14px color-mix(in srgb, var(--steel) 55%, transparent)"
                    : "0 1px 0 rgba(255,255,255,.8) inset",
                  transition: "0.2s",
                }}
              >
                <span style={{ display: "inline-flex", gap: 4 }}>
                  {p.chips.map((c) => (
                    <span
                      key={c}
                      style={{
                        width: 16, height: 16, borderRadius: 6, background: c,
                        boxShadow: `0 4px 10px ${c}66`,
                      }}
                    />
                  ))}
                </span>
                <span>
                  <span style={{ fontSize: 14, fontWeight: 800, display: "block" }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 550 }}>{p.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <Label>Accent (whole app)</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {ACCENTS.map((a) => (
              <button
                type="button"
                key={a || "auto"}
                title={a || "Theme default"}
                onClick={() => update(preset, a)}
                style={{
                  width: 30, height: 30, borderRadius: 15, cursor: "pointer",
                  border: accent === a ? "3px solid var(--ink)" : "2px solid var(--line)",
                  background: a || "conic-gradient(var(--steel), var(--verdigris), var(--ember), var(--accent-violet, #7c3aed), var(--steel))",
                  boxShadow: a ? `0 8px 16px -6px ${a}aa` : "var(--shadow)",
                  transform: accent === a ? "scale(1.15)" : "scale(1)",
                  transition: "0.15s",
                }}
              />
            ))}
          </div>

          <Label>Visual FX</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {FX_MODES.map((mode) => (
              <button
                type="button"
                key={mode.id}
                onClick={() => update(preset, accent, density, mode.id, motion)}
                style={{
                  border: `2px solid ${fx === mode.id ? "var(--steel)" : "var(--line)"}`,
                  background: fx === mode.id ? "var(--steel-soft)" : "var(--panel)",
                  color: fx === mode.id ? "var(--steel)" : "var(--ink-2)",
                  borderRadius: 12, padding: "10px 11px", cursor: "pointer", textAlign: "left",
                  fontWeight: 800, fontSize: 13,
                  boxShadow: fx === mode.id ? "0 10px 20px -12px color-mix(in srgb, var(--steel) 50%, transparent)" : "none",
                }}
              >
                {mode.label}
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 550, color: "var(--ink-3)", marginTop: 3 }}>
                  {mode.tip}
                </span>
              </button>
            ))}
          </div>

          <Label>Motion</Label>
          <PillRow
            items={MOTION}
            value={motion}
            onChange={(v) => update(preset, accent, density, fx, v)}
          />

          <Label>Type size</Label>
          <PillRow
            items={DENSITIES}
            value={density}
            onChange={(v) => update(preset, accent, v, fx, motion)}
          />

          <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.55, fontWeight: 550 }}>
            Hover tables for zebra highlight · option grids & tabs pop out · cards lift in 3D.
            Try <b>Aurora + Neon + Bold + Big type</b> for maximum attraction.
          </p>
        </div>
      )}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--steel)",
        fontWeight: 800,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function PillRow({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--panel-3)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 4,
        marginBottom: 14,
      }}
    >
      {items.map((item) => {
        const on = value === item.id;
        return (
          <button
            type="button"
            key={item.id || "default"}
            onClick={() => onChange(item.id)}
            style={{
              border: "none",
              padding: "8px 14px",
              borderRadius: 9,
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 800,
              background: on
                ? "linear-gradient(135deg, var(--steel), var(--accent-violet, #7c3aed))"
                : "transparent",
              color: on ? "#fff" : "var(--ink-3)",
              boxShadow: on ? "0 8px 16px -10px color-mix(in srgb, var(--steel) 60%, transparent)" : "none",
              transition: "0.18s",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
