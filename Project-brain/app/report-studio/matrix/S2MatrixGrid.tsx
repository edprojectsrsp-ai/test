"use client";

/**
 * S2MatrixGrid — the run grid rendered with AntV S2 (custom-tree pivot).
 *
 * Mapping (derived from S2 v1's CustomTreePivotDataSet source):
 *   custom-tree mode uses rows=[$$extra$$], valueInCols:false — the TREE
 *   NODES are the value fields. So each report row becomes a value id, the
 *   measure NAME becomes the single column dimension, and the data holds one
 *   record per measure column: { measure: <col name>, <rowId>: <cell>, ... }.
 * Values are pre-formatted strings (Indian locale, per-column decimals) —
 * S2 does no arithmetic here; the engine already did it.
 * DATA_CELL_CLICK resolves ($$extra$$ -> rowId, measure -> column key) and
 * fires onCell for the existing drill-down modal.
 */

import { useEffect, useRef } from "react";
import {
  CustomTreeItem, PivotSheet, S2DataConfig, S2Event, S2Options,
} from "@antv/s2";

type Col = { key: string; name: string; unit?: string; decimals?: number;
             measure?: { agg?: string } };
type RunRow = { id: string; name: string; depth: number; cells: Record<string, number | null> };

function fmt(v: number | null | undefined, col: Col): string {
  if (v == null) return "—";
  const isCount = (col.measure?.agg || "").includes("count");
  const dec = isCount ? 0 : (col.decimals ?? 2);
  return Number(v).toLocaleString("en-IN",
    { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Rebuild the tree (defn order) restricted to rows present in the run. */
function buildTree(rows: RunRow[]): CustomTreeItem[] {
  const root: CustomTreeItem[] = [];
  const stack: { depth: number; node: CustomTreeItem }[] = [];
  for (const r of rows) {
    const node: CustomTreeItem = { key: r.id, title: r.name, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children!.push(node);
    else root.push(node);
    stack.push({ depth: r.depth, node });
  }
  return root;
}

export default function S2MatrixGrid({ rows, columns, height = 460, onCell }: {
  rows: RunRow[];
  columns: Col[];
  height?: number;
  onCell?: (rowId: string, colKey: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const sheet = useRef<PivotSheet | null>(null);

  useEffect(() => {
    if (!holder.current || rows.length === 0) return;
    const colKeyByName: Record<string, string> = {};
    const data = columns.map((c) => {
      colKeyByName[c.name] = c.key;
      const rec: Record<string, any> = { measure: c.name };
      for (const r of rows) rec[r.id] = fmt(r.cells[c.key], c);
      return rec;
    });
    const dataCfg: S2DataConfig = {
      data,
      fields: {
        rows: [],
        columns: ["measure"],
        values: rows.map((r) => r.id),
        customTreeItems: buildTree(rows),
        valueInCols: false,
      },
      meta: [{ field: "measure", name: "Measure" }],
    };
    const options: S2Options = {
      width: holder.current.clientWidth || 980,
      height,
      hierarchyType: "customTree",
      interaction: { selectedCellsSpotlight: false, hoverHighlight: true },
      tooltip: { showTooltip: false },
      style: {
        treeRowsWidth: 300,
        cellCfg: { height: 30 },
      },
    };
    const s2 = new PivotSheet(holder.current, dataCfg, options);
    s2.setThemeCfg({
      theme: {
        rowCell: {
          text: { fill: "#c9d6dd", fontSize: 12, textAlign: "left" },
          bolderText: { fill: "#e8f0f4", fontSize: 12 },
          cell: { backgroundColor: "#10181d",
                  horizontalBorderColor: "#243139", verticalBorderColor: "#243139" },
        },
        colCell: {
          text: { fill: "#8fa7b3", fontSize: 12, fontWeight: 700 },
          bolderText: { fill: "#8fa7b3", fontSize: 12, fontWeight: 700 },
          cell: { backgroundColor: "#0c1216",
                  horizontalBorderColor: "#243139", verticalBorderColor: "#243139" },
        },
        dataCell: {
          text: { fill: "#c9d6dd", fontSize: 12, textAlign: "right" },
          cell: { backgroundColor: "#10181d", crossBackgroundColor: "#0e161b",
                  horizontalBorderColor: "#1b262d", verticalBorderColor: "#1b262d",
                  interactionState: { hover: { backgroundColor: "#16232b" } } },
        },
        background: { color: "transparent" },
        splitLine: { horizontalBorderColor: "#243139", verticalBorderColor: "#243139" },
      },
    });
    if (onCell) {
      s2.on(S2Event.DATA_CELL_CLICK, (ev: any) => {
        const meta = ev?.target?.cfg?.parent?.getMeta?.() ??
                     s2.interaction.getActiveCells()?.[0]?.getMeta?.();
        const rowId = meta?.rowQuery?.["$$extra$$"];
        const colName = meta?.colQuery?.["measure"];
        if (rowId && colName && colKeyByName[colName]) onCell(rowId, colKeyByName[colName]);
      });
    }
    s2.render();
    sheet.current = s2;
    const onResize = () => {
      if (!holder.current || !sheet.current) return;
      sheet.current.changeSheetSize(holder.current.clientWidth, height);
      sheet.current.render(false);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      s2.destroy();
      sheet.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, height]);

  return <div ref={holder} style={{ width: "100%" }} />;
}
