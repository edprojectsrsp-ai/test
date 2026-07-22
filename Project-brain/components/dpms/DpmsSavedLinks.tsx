"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { dpmsApi, type DpmsRelationship } from "@/lib/dpms";

export default function DpmsSavedLinks() {
  const [rels, setRels] = useState<DpmsRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "approved" | "candidate">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await dpmsApi.relationships().catch(() => dpmsApi.links());
      setRels(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = rels.filter((r) => {
    if (filter === "all") return true;
    if (filter === "approved") return r.status === "approved";
    return r.status !== "approved";
  });

  async function del(r: DpmsRelationship) {
    const id = r.id || dpmsApi.relId(r);
    await dpmsApi.deleteRelationship(id);
    await load();
  }

  async function approve(r: DpmsRelationship) {
    await dpmsApi.saveRelationship({ ...r, status: "approved", confidence: r.confidence || 100 });
    await load();
  }

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: 18,
        background: "var(--panel)",
        boxShadow: "var(--shadow)",
        padding: 14,
        minHeight: "calc(100vh - 120px)",
      }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <b style={{ fontSize: 14 }}>Saved relationships</b>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
          {rels.filter((r) => r.status === "approved").length} approved · {rels.length} total
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(["all", "approved", "candidate"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: filter === f ? "1px solid #93c5fd" : "1px solid var(--line)",
                background: filter === f ? "#dbeafe" : "#fff",
                fontWeight: 750,
                fontSize: 11,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 750,
              fontSize: 12,
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Reload
          </button>
        </div>
      </div>

      {error ? <div style={{ color: "#b91c1c", fontSize: 13 }}>{error}</div> : null}

      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>
              {["Child table", "Child col", "Parent table", "Parent col", "Confidence", "Status", "Source", ""].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      background: "#eff6ff",
                      borderBottom: "1px solid #cbd5e1",
                      position: "sticky",
                      top: 0,
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const id = r.id || dpmsApi.relId(r);
              return (
                <tr key={id}>
                  <td style={td}>{r.child_table}</td>
                  <td style={td}>{r.child_col}</td>
                  <td style={td}>{r.parent_table}</td>
                  <td style={td}>{r.parent_col}</td>
                  <td style={td}>{r.confidence ?? "—"}%</td>
                  <td style={td}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: r.status === "approved" ? "#dcfce7" : "#e0f2fe",
                        color: r.status === "approved" ? "#064e3b" : "#0c4a6e",
                      }}
                    >
                      {r.status || "candidate"}
                    </span>
                  </td>
                  <td style={td}>{r.source || "—"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {r.status !== "approved" ? (
                        <button type="button" onClick={() => void approve(r)} style={miniOk}>
                          Save
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void del(r)} style={miniDanger} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visible.length && !loading ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, color: "#64748b", textAlign: "center" }}>
                  No relationships yet. Use Join board: place 2–3 tables, review suggestions, Save.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const td: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "middle",
};

const miniOk: React.CSSProperties = {
  border: "1px solid #86efac",
  background: "#dcfce7",
  color: "#064e3b",
  borderRadius: 8,
  padding: "3px 8px",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

const miniDanger: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fee2e2",
  color: "#7f1d1d",
  borderRadius: 8,
  padding: "3px 6px",
  cursor: "pointer",
  display: "inline-flex",
};
