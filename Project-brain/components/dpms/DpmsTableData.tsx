"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { dpmsApi, type DpmsTable } from "@/lib/dpms";

export default function DpmsTableData() {
  const [tables, setTables] = useState<DpmsTable[]>([]);
  const [cur, setCur] = useState<string>("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<(string | null)[][]>([]);
  const [total, setTotal] = useState(0);
  const size = 50;

  const loadTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await dpmsApi.tables();
      setTables(t);
      if (!cur && t.length) setCur(t[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, [cur]);

  const loadData = useCallback(async () => {
    if (!cur) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_DPMS_VIEWER_URL || "http://localhost:8010"}/api/table/${encodeURIComponent(cur)}?page=${page}&size=${size}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Load failed");
      setColumns(d.columns || []);
      setRows(d.rows || []);
      setTotal(d.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rows");
    } finally {
      setLoading(false);
    }
  }, [cur, page]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    if (cur) void loadData();
  }, [cur, page, loadData]);

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
        <b style={{ fontSize: 14 }}>Table data</b>
        <select
          value={cur}
          onChange={(e) => {
            setCur(e.target.value);
            setPage(0);
          }}
          style={{
            minWidth: 260,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            fontSize: 13,
          }}
        >
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.cols} cols)
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void loadData()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
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
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
          page {page + 1} · {total.toLocaleString()} rows
        </span>
      </div>

      {error ? (
        <div style={{ color: "#b91c1c", fontSize: 13, marginBottom: 10 }}>{error}</div>
      ) : null}

      <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 12, maxHeight: "calc(100vh - 220px)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#eff6ff",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid #cbd5e1",
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((_, j) => (
                  <td key={j} style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                    {r[j] == null || r[j] === "" ? (
                      <i style={{ color: "#94a3b8" }}>blank</i>
                    ) : (
                      String(r[j])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          style={pgBtn}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          disabled={(page + 1) * size >= total}
          onClick={() => setPage((p) => p + 1)}
          style={pgBtn}
        >
          Next ›
        </button>
      </div>
    </section>
  );
}

const pgBtn: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 750,
  fontSize: 12,
};
