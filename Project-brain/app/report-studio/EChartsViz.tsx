"use client";

/**
 * EChartsViz — canvas chart widgets rendered with Apache ECharts
 * (bar / stackedbar / line / area / pie / donut). Mirrors the exact data
 * shaping the previous recharts renderer used (first dim = category axis,
 * numeric columns = series) so saved dashboards render identically, and
 * preserves the two interactions that matter:
 *   · click a point/slice/bar -> onPoint(row)  (cross-filter source)
 *   · when this visual IS the cross-filter source, non-selected categories dim
 * Resize is handled with a ResizeObserver, so Gridstack drags/resizes and
 * container reflows just work.
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type Col = { key: string; label: string; type: string };
type QueryResult = { ok: boolean; columns: Col[]; rows: Record<string, any>[] };
type XFilter = { sourceId: string; field: string; value: any } | null;
type VizVisual = {
  id: string; viz: string; dims: string[];
  options: { legend?: boolean };
};

const COLORS = ["#6ea8fe", "#f0883e", "#3fb950", "#e5534b", "#a371f7",
                "#f2cc60", "#39c5cf", "#db61a2", "#8ddb8c", "#c297ff"];
const NUMERIC = ["int", "number", "money"];
const fmtNum = (v: any) => {
  const n = Number(v);
  if (v == null || isNaN(n)) return "—";
  return Math.abs(n) >= 1000
    ? n.toLocaleString("en-IN", { maximumFractionDigits: 1 })
    : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const AXIS = {
  axisLabel: { color: "#8fa7b3", fontSize: 10 },
  axisLine: { lineStyle: { color: "#243139" } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: "#1b262d", type: "dashed" as const } },
};
const TOOLTIP = {
  backgroundColor: "#10181d", borderColor: "#243139",
  textStyle: { color: "#c9d6dd", fontSize: 11 },
  valueFormatter: (v: any) => fmtNum(v),
};
const LEGEND = { textStyle: { color: "#8fa7b3", fontSize: 10.5 }, bottom: 0,
                 itemWidth: 12, itemHeight: 8 };

export default function EChartsViz({ v, res, xf, onPoint }: {
  v: VizVisual; res: QueryResult; xf: XFilter;
  onPoint: (row: Record<string, any>) => void;
}) {
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
    const dimKey = v.dims[0];
    const numCols = res.columns.filter((x) => NUMERIC.includes(x.type) && x.key !== dimKey);
    const dimmed = (row: Record<string, any>) =>
      xf && xf.sourceId === v.id && row[dimKey] !== xf.value ? 0.3 : 1;

    let option: echarts.EChartsOption;
    let rowsUsed: Record<string, any>[];

    if (v.viz === "pie" || v.viz === "donut") {
      const valKey = numCols[0]?.key;
      rowsUsed = res.rows.slice(0, 12);
      option = {
        tooltip: { ...TOOLTIP, trigger: "item" },
        legend: v.options.legend !== false ? LEGEND : undefined,
        series: [{
          type: "pie",
          radius: v.viz === "donut" ? ["52%", "82%"] : [0, "82%"],
          top: 4, bottom: v.options.legend !== false ? 24 : 4,
          label: { color: "#8fa7b3", fontSize: 10 },
          labelLine: { lineStyle: { color: "#243139" } },
          data: rowsUsed.map((r, i) => ({
            name: String(r[dimKey] ?? "—"),
            value: Number(r[valKey]) || 0,
            itemStyle: { color: COLORS[i % COLORS.length], opacity: dimmed(r) },
          })),
        }],
      };
    } else {
      rowsUsed = res.rows.slice(0, 40);
      const cats = rowsUsed.map((r) => String(r[dimKey] ?? "—"));
      const isBar = v.viz === "bar" || v.viz === "stackedbar";
      option = {
        grid: { top: 14, right: 12, bottom: v.options.legend !== false && numCols.length > 1 ? 30 : 8,
                left: 8, containLabel: true },
        tooltip: { ...TOOLTIP, trigger: "axis" },
        legend: v.options.legend !== false && numCols.length > 1 ? LEGEND : undefined,
        xAxis: { type: "category", data: cats, ...AXIS, splitLine: { show: false } },
        yAxis: { type: "value", ...AXIS,
                 axisLabel: { ...AXIS.axisLabel, formatter: (val: number) => fmtNum(val) } },
        series: numCols.map((col, i) => ({
          name: col.label,
          type: isBar ? "bar" : "line",
          stack: v.viz === "stackedbar" || v.viz === "area" ? "s" : undefined,
          smooth: !isBar,
          symbolSize: 5,
          lineStyle: !isBar ? { width: 2 } : undefined,
          areaStyle: v.viz === "area" ? { opacity: 0.22 } : undefined,
          itemStyle: { color: COLORS[i % COLORS.length],
                       borderRadius: v.viz === "bar" ? [3, 3, 0, 0] : 0 },
          emphasis: { focus: "series" },
          data: rowsUsed.map((r) => ({
            value: Number(r[col.key]) || 0,
            itemStyle: { opacity: dimmed(r) },
          })),
        })),
      };
    }
    c.setOption(option, true);
    c.off("click");
    c.on("click", (params: any) => {
      const row = rowsUsed[params.dataIndex];
      if (row) onPoint(row);
    });
  }, [v, res, xf, onPoint]);

  return <div ref={holder} style={{ width: "100%", height: "100%", cursor: "pointer" }} />;
}
