"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type TableSchemaData = {
  label: string;
  columns: string[];
  rowCount?: number;
  linkedCols?: string[];
  expanded?: boolean;
};

export type TableSchemaNodeType = Node<TableSchemaData, "tableSchema">;

function TableSchemaNode({ data, selected }: NodeProps<TableSchemaNodeType>) {
  const linked = new Set(data.linkedCols || []);
  const cols = data.columns || [];

  return (
    <div
      style={{
        width: 268,
        background: "#fff",
        border: selected ? "2px solid #1d4ed8" : "1.5px solid #93c5fd",
        borderRadius: 14,
        boxShadow: selected
          ? "0 0 0 3px rgba(37,99,235,.18), 0 16px 36px rgba(30,64,175,.14)"
          : "0 14px 30px rgba(30,64,175,.10)",
        overflow: "visible",
        fontFamily: "system-ui,Segoe UI,Roboto,sans-serif",
      }}
    >
      {/* Drag anywhere on the header to move the table on the breadboard */}
      <div
        className="dpms-drag-handle"
        title="Drag to move this table on the board"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: "linear-gradient(180deg,#dbeafe,#bfdbfe)",
          borderBottom: "1px solid #93c5fd",
          cursor: "grab",
          fontWeight: 900,
          fontSize: 12.5,
          color: "#0a0a0a",
          borderRadius: "14px 14px 0 0",
          userSelect: "none",
        }}
      >
        <span
          aria-hidden
          style={{
            letterSpacing: -1,
            color: "#1e40af",
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ⠿
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 800,
            background: "#fff",
            border: "1px solid #93c5fd",
            borderRadius: 999,
            padding: "1px 7px",
            color: "#1e3a8a",
            flexShrink: 0,
          }}
        >
          {cols.length} fields
        </span>
      </div>

      <div
        className="nowheel nodrag"
        style={{
          maxHeight: 340,
          overflow: "auto",
          background: "#fff",
          borderRadius: "0 0 14px 14px",
        }}
      >
        {cols.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: "#64748b" }}>Loading columns…</div>
        ) : (
          cols.map((col) => {
            const isLinked = linked.has(col);
            return (
              <div
                key={col}
                className="nodrag"
                style={{
                  display: "grid",
                  gridTemplateColumns: "14px 1fr 14px",
                  alignItems: "center",
                  gap: 2,
                  minHeight: 30,
                  padding: "0 4px",
                  borderBottom: "1px solid #eef2f7",
                  background: isLinked ? "#eff6ff" : "transparent",
                  fontSize: 11.5,
                  fontWeight: isLinked ? 750 : 500,
                  color: "#0f172a",
                  position: "relative",
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={col}
                  className="nodrag"
                  title={`Drop arrow here · ${col}`}
                  style={{
                    width: 12,
                    height: 12,
                    left: -6,
                    background: isLinked ? "#86efac" : "#fff",
                    border: `2px solid ${isLinked ? "#047857" : "#64748b"}`,
                    zIndex: 5,
                    cursor: "crosshair",
                  }}
                />
                <span
                  title={`${col} — drag a side dot to another table to link`}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "4px 4px",
                    cursor: "default",
                  }}
                >
                  {col}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={col}
                  className="nodrag"
                  title={`Drag arrow from ${col}`}
                  style={{
                    width: 12,
                    height: 12,
                    right: -6,
                    background: isLinked ? "#86efac" : "#fff",
                    border: `2px solid ${isLinked ? "#047857" : "#64748b"}`,
                    zIndex: 5,
                    cursor: "crosshair",
                  }}
                />
              </div>
            );
          })
        )}
        {data.rowCount != null && data.rowCount > 0 ? (
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              fontSize: 10.5,
              color: "#475569",
            }}
          >
            {data.rowCount.toLocaleString()} rows · drag header ⠿ to move
          </div>
        ) : (
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              fontSize: 10.5,
              color: "#475569",
            }}
          >
            Drag header ⠿ to move · dots to link
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TableSchemaNode);
