"use client";

/**
 * InlineChart — a small, self-contained ECharts renderer for chart specs
 * emitted by the AI service (BrainChat) or any feature that wants a themed
 * chart from a simple JSON shape, without pulling recharts into that view.
 *
 * Spec shape (matches the AI tool's chart payload):
 *   { type: 'bar'|'line'|'area'|'pie'|'scatter',
 *     title?, x?: string[], series: [{ name, data: number[] }] | number[],
 *     xLabel?, yLabel? }
 *
 * Deliberately dependency-light and Furnace-themed so it can be dropped inline
 * in a chat bubble. Auto-resizes with a ResizeObserver.
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export type ChartSpec = {
  type?: "bar" | "line" | "area" | "pie" | "scatter";
  title?: string;
  x?: (string | number)[];
  series?: { name?: string; data: number[] }[] | number[];
  xLabel?: string;
  yLabel?: string;
};

const COLORS = ["#6ea8fe", "#f0883e", "#3fb950", "#e5534b", "#a371f7",
                "#f2cc60", "#39c5cf", "#db61a2"];
const AXIS = {
  axisLabel: { color: "#8fa7b3", fontSize: 10 },
  axisLine: { lineStyle: { color: "#243139" } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: "#1b262d", type: "dashed" as const } },
};

function normSeries(spec: ChartSpec): { name?: string; data: number[] }[] {
  if (!spec.series) return [];
  if (Array.isArray(spec.series) && typeof spec.series[0] === "number") {
    return [{ data: spec.series as number[] }];
  }
  return spec.series as { name?: string; data: number[] }[];
}

export default function InlineChart({ spec, height = 240 }: { spec: ChartSpec; height?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!holder.current) return;
    const c = echarts.init(holder.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(holder.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const type = spec.type || "bar";
    const series = normSeries(spec);
    const multi = series.length > 1;
    const legend = multi
      ? { textStyle: { color: "#8fa7b3", fontSize: 10.5 }, bottom: 0 } : undefined;
    const tooltip = {
      backgroundColor: "#10181d", borderColor: "#243139",
      textStyle: { color: "#c9d6dd", fontSize: 11 },
    };
    const titleOpt = spec.title
      ? { text: spec.title, left: "center", top: 2,
          textStyle: { color: "#c9d6dd", fontSize: 12, fontWeight: 700 as const } }
      : undefined;

    let option: echarts.EChartsOption;
    if (type === "pie") {
      option = {
        title: titleOpt, tooltip: { ...tooltip, trigger: "item" }, legend,
        series: [{
          type: "pie", radius: [0, "70%"], top: spec.title ? 22 : 6,
          bottom: legend ? 22 : 6,
          label: { color: "#8fa7b3", fontSize: 10 },
          labelLine: { lineStyle: { color: "#243139" } },
          data: (spec.x || []).map((name, i) => ({
            name: String(name), value: series[0]?.data[i] ?? 0,
            itemStyle: { color: COLORS[i % COLORS.length] },
          })),
        }],
      };
    } else if (type === "scatter") {
      option = {
        title: titleOpt, tooltip, legend,
        grid: { top: spec.title ? 30 : 14, right: 12, bottom: legend ? 30 : 22, left: 8, containLabel: true },
        xAxis: { type: "value", name: spec.xLabel, ...AXIS },
        yAxis: { type: "value", name: spec.yLabel, ...AXIS },
        series: series.map((s, i) => ({
          name: s.name, type: "scatter", symbolSize: 8,
          itemStyle: { color: COLORS[i % COLORS.length] },
          data: s.data.map((y, xi) => [spec.x ? Number(spec.x[xi]) : xi, y]),
        })),
      };
    } else {
      const isBar = type === "bar";
      option = {
        title: titleOpt, tooltip: { ...tooltip, trigger: "axis" }, legend,
        grid: { top: spec.title ? 30 : 14, right: 12, bottom: legend ? 30 : 8, left: 8, containLabel: true },
        xAxis: { type: "category", data: (spec.x || []).map(String),
                 name: spec.xLabel, ...AXIS, splitLine: { show: false } },
        yAxis: { type: "value", name: spec.yLabel, ...AXIS },
        series: series.map((s, i) => ({
          name: s.name, type: isBar ? "bar" : "line",
          smooth: !isBar, symbolSize: 5,
          lineStyle: !isBar ? { width: 2 } : undefined,
          areaStyle: type === "area" ? { opacity: 0.22 } : undefined,
          itemStyle: { color: COLORS[i % COLORS.length],
                       borderRadius: isBar ? [3, 3, 0, 0] : 0 },
          data: s.data,
        })),
      };
    }
    c.setOption(option, true);
  }, [spec]);

  return <div ref={holder} style={{ width: "100%", height }} />;
}
