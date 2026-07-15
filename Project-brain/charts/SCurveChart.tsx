"use client";
import React, { useId, useMemo } from "react";
import { PkgData } from "@/lib/furnace/api";

/**
 * Premium S-curve — soft pastel fills, crisp dark labels, plan / actual / forecast
 * bands, TODAY marker, and an in-chart legend. Reads theme CSS vars.
 */
export function SCurveChart({ data, height = 320 }: { data: PkgData; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const W = 720;
  const H = height;
  const pad = { l: 44, r: 20, t: 28, b: 44 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const model = useMemo(() => {
    const pts = data.points;
    const n = pts.length;
    const x = (i: number) => pad.l + (iw * i) / Math.max(1, n - 1);
    const y = (v: number) => pad.t + ih - (Math.min(100, Math.max(0, v)) / 100) * ih;
    const planned = pts.map((p) => p.cumulative_planned_pct);
    const actualIdx = pts.findIndex((p) => p.is_forecast);
    const todayIdx = actualIdx === -1 ? pts.length - 1 : Math.max(0, actualIdx - 1);
    const actual = pts
      .filter((p, i) => !p.is_forecast && p.cumulative_actual_pct != null && i <= todayIdx)
      .map((p, i) => ({ i: pts.indexOf(p) >= 0 ? pts.findIndex((q, qi) => qi <= todayIdx && q === p) : i, v: p.cumulative_actual_pct as number }));
    // rebuild actual with correct indices
    const actualPts: { i: number; v: number }[] = [];
    pts.forEach((p, i) => {
      if (!p.is_forecast && p.cumulative_actual_pct != null && i <= todayIdx) {
        actualPts.push({ i, v: p.cumulative_actual_pct });
      }
    });
    const forecast = pts
      .map((p, i) => ({ i, v: p.cumulative_actual_pct, f: p.is_forecast }))
      .filter((p) => p.f || p.i === todayIdx)
      .map((p) => ({ i: p.i, v: (p.v as number) ?? 0 }));
    return { n, x, y, planned, actual: actualPts, forecast, todayIdx };
  }, [data, iw, ih]);

  const { n, x, y, planned, actual, forecast, todayIdx } = model;
  const todayActual = actual.find((a) => a.i === todayIdx)?.v ?? actual[actual.length - 1]?.v ?? 0;
  const planToday = planned[todayIdx] ?? 0;
  const variance = todayActual - planToday;

  const grid = [0, 25, 50, 75, 100].map((g) => (
    <g key={g}>
      <line
        x1={pad.l}
        y1={y(g)}
        x2={W - pad.r}
        y2={y(g)}
        stroke="#e2e8f0"
        strokeWidth={g === 0 || g === 100 ? 1.2 : 1}
        strokeDasharray={g === 0 || g === 100 ? undefined : "3 4"}
      />
      <text
        x={pad.l - 8}
        y={y(g) + 4}
        fill="#171717"
        fontSize={11}
        fontWeight={600}
        fontFamily="var(--font-mono), JetBrains Mono, monospace"
        textAnchor="end"
      >
        {g}%
      </text>
    </g>
  ));

  const xlabels = data.points.map((p, i) =>
    i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1 ? (
      <text
        key={i}
        x={x(i)}
        y={H - 14}
        fill="#171717"
        fontSize={10.5}
        fontWeight={600}
        fontFamily="var(--font-mono), JetBrains Mono, monospace"
        textAnchor="middle"
      >
        {p.month_date.length >= 7 ? p.month_date.slice(2, 7) : p.month_date}
      </text>
    ) : null,
  );

  const plannedArea =
    `M ${x(0)} ${y(0)} ` +
    planned.map((v, i) => `L ${x(i)} ${y(v)}`).join(" ") +
    ` L ${x(n - 1)} ${y(0)} Z`;
  const plannedLine = planned.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const actualLine = actual.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  const forecastLine = forecast.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");

  let band = `M ${x(0)} ${y(planned[0] ?? 0)} `;
  for (let i = 0; i <= todayIdx; i++) band += `L ${x(i)} ${y(planned[i] ?? 0)} `;
  for (let i = todayIdx; i >= 0; i--) {
    const av = actual.find((a) => a.i === i)?.v ?? planned[i] ?? 0;
    band += `L ${x(i)} ${y(av)} `;
  }
  band += "Z";

  const tx = x(todayIdx);
  const gPlan = `sc-plan-${uid}`;
  const gAct = `sc-act-${uid}`;
  const gGlow = `sc-glow-${uid}`;

  return (
    <div
      className="ui-card card-3d"
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: "14px 16px 10px",
        boxShadow: "0 1px 0 rgba(255,255,255,.95) inset, 0 14px 36px -20px rgba(37,99,235,.18)",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: "1px solid #eef2f7",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display), Fraunces, Georgia, serif",
            fontWeight: 750,
            fontSize: 16,
            color: "#0a0a0a",
            letterSpacing: "-0.02em",
          }}
        >
          S-Curve · Plan vs Actual
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <StatPill label="Plan @ today" value={`${planToday.toFixed(1)}%`} tone="#2563eb" bg="#eff6ff" />
          <StatPill label="Actual @ today" value={`${todayActual.toFixed(1)}%`} tone="#059669" bg="#ecfdf5" />
          <StatPill
            label="Variance"
            value={`${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`}
            tone={variance >= 0 ? "#047857" : "#b91c1c"}
            bg={variance >= 0 ? "#ecfdf5" : "#fef2f2"}
          />
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gPlan} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id={gAct} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d1fae5" stopOpacity="0.02" />
          </linearGradient>
          <filter id={gGlow} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#059669" floodOpacity="0.25" />
          </filter>
          <linearGradient id={`${uid}-slip`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fdba74" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ffedd5" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* soft chart well */}
        <rect
          x={pad.l}
          y={pad.t}
          width={iw}
          height={ih}
          rx={12}
          fill="#fafcff"
          stroke="#e8eef6"
        />

        {grid}
        {xlabels}

        {/* Plan area */}
        <path d={plannedArea} fill={`url(#${gPlan})`} />
        {/* Slippage band */}
        <path d={band} fill={`url(#${uid}-slip)`} />

        {/* Plan line */}
        <polyline
          points={plannedLine}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Forecast dashed */}
        {forecastLine && (
          <polyline
            points={forecastLine}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={2.2}
            strokeDasharray="6 5"
            strokeLinecap="round"
          />
        )}
        {/* Actual line */}
        {actualLine && (
          <polyline
            points={actualLine}
            fill="none"
            stroke="#059669"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            filter={`url(#${gGlow})`}
          />
        )}

        {/* TODAY marker */}
        <line
          x1={tx}
          y1={pad.t}
          x2={tx}
          y2={pad.t + ih}
          stroke="#94a3b8"
          strokeWidth={1.2}
          strokeDasharray="3 4"
        />
        <rect
          x={tx - 22}
          y={pad.t + 4}
          width={44}
          height={16}
          rx={8}
          fill="#0f172a"
        />
        <text
          x={tx}
          y={pad.t + 15}
          fill="#ffffff"
          fontSize={9}
          fontWeight={700}
          fontFamily="var(--font-sans), DM Sans, system-ui, sans-serif"
          textAnchor="middle"
        >
          TODAY
        </text>

        <circle cx={tx} cy={y(planToday)} r={5} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
        <circle cx={tx} cy={y(todayActual)} r={5.5} fill="#059669" stroke="#fff" strokeWidth={2} />
      </svg>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "center",
          paddingTop: 6,
          fontSize: 12,
          fontWeight: 650,
          color: "#0a0a0a",
        }}
      >
        <LegendDot color="#3b82f6" label="Planned (baseline)" />
        <LegendDot color="#059669" label="Actual" />
        <LegendDot color="#f59e0b" label="Forecast" dashed />
        <LegendDot color="#fdba74" label="Slip band" soft />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
  bg,
}: {
  label: string;
  value: string;
  tone: string;
  bg: string;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${tone}33`,
        color: "#0a0a0a",
        fontSize: 12,
        fontWeight: 650,
      }}
    >
      <span style={{ color: "#52525b", fontWeight: 600 }}>{label}</span>
      <span style={{ color: tone, fontFamily: "var(--font-mono), monospace", fontWeight: 750 }}>{value}</span>
    </div>
  );
}

function LegendDot({
  color,
  label,
  dashed,
  soft,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  soft?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: dashed ? 18 : 12,
          height: soft ? 10 : 3,
          borderRadius: soft ? 3 : 2,
          background: soft ? color : dashed ? "transparent" : color,
          borderTop: dashed ? `2.5px dashed ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}
