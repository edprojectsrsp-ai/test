"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type RelationEdgeData = {
  childCol: string;
  parentCol: string;
  status?: string;
  confidence?: number | null;
  relId: string;
  onReverse?: (relId: string) => void;
  onDelete?: (relId: string) => void;
  onDrill?: (relId: string) => void;
};

export type RelationEdgeType = Edge<RelationEdgeData, "relation">;

/** Label text for the join key shown on the arrow. */
export function joinHeaderLabel(childCol?: string, parentCol?: string): string {
  const a = (childCol || "").trim();
  const b = (parentCol || "").trim();
  if (!a && !b) return "join";
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase() === b.toLowerCase()) return a;
  return `${a} → ${b}`;
}

export default function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: EdgeProps<RelationEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const childCol = data?.childCol || "";
  const parentCol = data?.parentCol || "";
  const sameName = childCol.toLowerCase() === parentCol.toLowerCase() && !!childCol;
  const headerLabel = joinHeaderLabel(childCol, parentCol);

  const approved = data?.status === "approved";
  const suggestion = data?.status === "suggestion";
  const conf = data?.confidence ?? 0;
  const stroke =
    (typeof style?.stroke === "string" && style.stroke) ||
    (approved ? "#047857" : suggestion ? "#ea580c" : conf >= 70 ? "#1d4ed8" : "#b91c1c");

  const badgeBg = approved ? "#ecfdf5" : suggestion ? "#fff7ed" : "#eff6ff";
  const badgeBorder = stroke;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke,
          strokeWidth: selected ? 3.4 : Number(style?.strokeWidth) || 2.5,
          opacity: 0.95,
        }}
      />
      <EdgeLabelRenderer>
        {/* Primary: common header / join key name on the arrow */}
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
          }}
          className="nodrag nopan"
        >
          <button
            type="button"
            title={
              sameName
                ? `Join on common header: ${headerLabel}`
                : `Join: ${childCol} → ${parentCol}`
            }
            onClick={() => data?.onDrill?.(data.relId)}
            style={{
              border: `1.5px solid ${badgeBorder}`,
              background: badgeBg,
              borderRadius: 999,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 900,
              color: "#0f172a",
              boxShadow: "0 4px 14px rgba(15,23,42,.12)",
              cursor: "pointer",
              maxWidth: 280,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
            }}
          >
            {sameName ? (
              <>
                <span style={{ color: "#64748b", fontWeight: 700, fontSize: 10, marginRight: 5 }}>
                  on
                </span>
                {headerLabel}
              </>
            ) : (
              headerLabel
            )}
          </button>

          {/* Actions under the name */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "2px 4px",
              boxShadow: "0 2px 8px rgba(15,23,42,.08)",
            }}
          >
            {!sameName && childCol && parentCol ? (
              <span
                style={{
                  fontSize: 9,
                  color: "#64748b",
                  fontWeight: 700,
                  padding: "0 4px",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={`${childCol} = ${parentCol}`}
              >
                {childCol} = {parentCol}
              </span>
            ) : null}
            <button
              type="button"
              title="Reverse arrow direction"
              onClick={() => data?.onReverse?.(data.relId)}
              style={miniBtn}
            >
              ⇄
            </button>
            <button
              type="button"
              title="Delete this arrow / relationship"
              onClick={() => data?.onDelete?.(data.relId)}
              style={{ ...miniBtn, color: "#b91c1c" }}
            >
              ×
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const miniBtn: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  borderRadius: 6,
  width: 20,
  height: 18,
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
  lineHeight: 1,
  padding: 0,
};
