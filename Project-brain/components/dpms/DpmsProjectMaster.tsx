"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { DPMS_URL } from "@/lib/dpms";

type PlanItem = {
  table: string;
  mode: string;
  child_col: string;
  parent_col: string;
  file_mb: number;
  reason: string;
  included: boolean;
  skipped?: boolean;
  skip_reason?: string;
  status?: string;
  approx?: boolean;
  added_cols?: number;
  error?: string;
};

type BuildResult = {
  ready: boolean;
  name?: string;
  built_at?: string;
  project_count?: number;
  column_count?: number;
  columns?: string[];
  plan?: PlanItem[];
  notes?: string[];
  sql_sketch?: string;
  error?: string;
};

type MasterPage = {
  ready: boolean;
  name?: string;
  built_at?: string;
  columns: string[];
  rows: Record<string, string | null>[];
  total: number;
  page: number;
  size: number;
  notes?: string[];
  plan?: PlanItem[];
  sql_sketch?: string;
};

type MasterInfo = {
  name: string;
  mode?: "summary" | "detail";
  base?: string | null;
  built_at?: string;
  project_count?: number;
  row_count?: number;
  column_count?: number;
  attached_count?: number;
};

type BuildMode = "summary" | "detail";

type Preset = "core" | "wide" | "all" | "custom";

const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "core", label: "Core (~21)", hint: "Lean: key satellites ≤400 MB" },
  { id: "wide", label: "Wide (all ≤400 MB)", hint: "Every project-linked table under 400 MB" },
  { id: "all", label: "All tables", hint: "Everything; huge fact tables sampled" },
  { id: "custom", label: "Custom (ticked)", hint: "Only the tables ticked on the left" },
];

export default function DpmsProjectMaster() {
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [coreCols, setCoreCols] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<BuildResult | null>(null);
  const [data, setData] = useState<MasterPage | null>(null);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  // multi-master state
  const [masters, setMasters] = useState<MasterInfo[]>([]);
  const [current, setCurrent] = useState<string>("default");
  const [newName, setNewName] = useState<string>("");
  const [preset, setPreset] = useState<Preset>("core");
  const [mode, setMode] = useState<BuildMode>("summary");
  const [baseTable, setBaseTable] = useState<string>("");
  const [rowLimit, setRowLimit] = useState<number>(100000);

  const size = 40;

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetch(`${DPMS_URL}/api/project-master/plan?max_tables=20&max_file_mb=400`, {
        cache: "no-store",
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Plan failed");
        return body;
      });
      const items: PlanItem[] = j.plan || [];
      setPlan(items);
      setCoreCols(j.core_columns || []);
      setSelected(new Set(items.filter((p) => p.included).map((p) => p.table)));
      setBaseTable((prev) => prev || items[0]?.table || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plan");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const j = await fetch(`${DPMS_URL}/api/project-master/list`, { cache: "no-store" }).then((r) =>
        r.json()
      );
      const items: MasterInfo[] = j.masters || [];
      setMasters(items);
      return items;
    } catch {
      return [];
    }
  }, []);

  const loadMaster = useCallback(
    async (name: string, p = 0, query = "") => {
      try {
        const params = new URLSearchParams({
          page: String(p),
          size: String(size),
          q: query,
          name,
        });
        const res = await fetch(`${DPMS_URL}/api/project-master?${params}`, { cache: "no-store" });
        const body = await res.json();
        if (res.status === 404) {
          setData(null);
          return;
        }
        if (!res.ok) throw new Error(body.error || "Load failed");
        setData(body);
        setNotes(body.notes || []);
        if (body.plan) setPlan(body.plan);
      } catch (e) {
        if (e instanceof Error && e.message.includes("not built")) setData(null);
        else setError(e instanceof Error ? e.message : "Load failed");
      }
    },
    []
  );

  useEffect(() => {
    void (async () => {
      await loadPlan();
      const items = await loadList();
      const first = items[0]?.name || "default";
      setCurrent(first);
      await loadMaster(first, 0, "");
    })();
  }, [loadPlan, loadList, loadMaster]);

  async function build() {
    setBuilding(true);
    setError(null);
    const fallback =
      mode === "detail"
        ? baseTable
          ? `${baseTable}_detail`
          : "detail"
        : masters.length
          ? `master_${masters.length + 1}`
          : "default";
    const name = (newName.trim() || fallback).slice(0, 60);
    try {
      const payload: Record<string, unknown> = { name };
      if (mode === "detail") {
        if (!baseTable) throw new Error("Pick a base (grain) table for a detail master");
        payload.mode = "detail";
        payload.base = baseTable;
        payload.row_limit = rowLimit;
      } else {
        payload.max_file_mb = 400;
        payload.sample_rows = preset === "all" ? 150000 : 200000;
        if (preset === "custom") {
          payload.tables = [...selected];
          payload.max_tables = 60;
        } else {
          payload.preset = preset;
        }
      }
      const body = await fetch(`${DPMS_URL}/api/project-master/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Build failed");
        return j as BuildResult;
      });
      setMeta(body);
      setNotes(body.notes || []);
      if (body.plan) setPlan(body.plan);
      await loadList();
      setCurrent(name);
      setNewName("");
      setPage(0);
      setQ("");
      await loadMaster(name, 0, "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  }

  async function switchTo(name: string) {
    setCurrent(name);
    setPage(0);
    setQ("");
    await loadMaster(name, 0, "");
  }

  async function removeMaster(name: string) {
    if (!confirm(`Delete master "${name}"?`)) return;
    await fetch(`${DPMS_URL}/api/project-master/${encodeURIComponent(name)}`, { method: "DELETE" });
    const items = await loadList();
    if (current === name) {
      const next = items[0]?.name || "default";
      setCurrent(next);
      await loadMaster(next, 0, "");
    }
  }

  function toggle(table: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(table)) n.delete(table);
      else n.add(table);
      return n;
    });
  }

  function exportCsv() {
    window.open(`${DPMS_URL}/api/project-master/export?name=${encodeURIComponent(current)}`, "_blank");
  }

  const columns = data?.columns || [];
  const rows = data?.rows || [];
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / size));

  const includedCount = useMemo(
    () => plan.filter((p) => selected.has(p.table)).length,
    [plan, selected]
  );

  return (
    <section
      style={{
        border: "1px solid var(--line, #cbd5e1)",
        borderRadius: 18,
        background: "var(--panel, #fff)",
        boxShadow: "var(--shadow, 0 12px 30px rgba(15,23,42,.08))",
        minHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--line, #e2e8f0)",
          background: "linear-gradient(180deg,#ecfdf5,#fff)",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Layers size={16} color="#047857" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Project master tables</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            One row per project · hub = <b>project</b> · build multiple named variants, switch below
            {meta?.project_count != null
              ? ` · last build: ${meta.name} = ${meta.project_count}×${meta.column_count}`
              : ""}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => void loadPlan()} disabled={loading || building}>
            <RefreshCw size={13} /> Refresh plan
          </button>
          <button type="button" style={btn} onClick={exportCsv} disabled={!data?.ready}>
            <Download size={13} /> Export "{current}"
          </button>
        </div>
      </header>

      {/* Master variants bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 850, color: "#334155" }}>Masters:</span>
        {masters.length === 0 ? (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>none built yet</span>
        ) : (
          masters.map((m) => {
            const on = m.name === current;
            return (
              <span
                key={m.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: on ? "1px solid #34d399" : "1px solid #cbd5e1",
                  background: on ? "#d1fae5" : "#fff",
                  borderRadius: 999,
                  padding: "3px 4px 3px 10px",
                  fontSize: 11.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => void switchTo(m.name)}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    fontWeight: on ? 850 : 650,
                    color: "#064e3b",
                  }}
                  title={
                    m.mode === "detail"
                      ? `detail @ ${m.base} · ${m.row_count} rows × ${m.column_count} cols`
                      : `${m.project_count} projects × ${m.column_count} cols · ${m.attached_count} tables`
                  }
                >
                  {m.name}{" "}
                  <span style={{ color: "#059669", fontWeight: 600 }}>
                    {m.mode === "detail"
                      ? `▸${m.base} ${m.column_count}c`
                      : `${m.column_count}c/${m.attached_count}t`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeMaster(m.name)}
                  title="Delete this master"
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 2,
                    cursor: "pointer",
                    color: "#94a3b8",
                    display: "inline-flex",
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            );
          })
        )}

        {/* New master builder */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as BuildMode)}
            style={{ padding: "6px 8px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 800 }}
            title={
              mode === "summary"
                ? "Summary: one row per project, satellites aggregated to counts"
                : "Detail: one row per child record, project attributes repeated (captures 1:N)"
            }
          >
            <option value="summary">Summary (1/project)</option>
            <option value="detail">Detail (1:N)</option>
          </select>

          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={mode === "detail" ? `${baseTable || "base"}_detail` : "new master name…"}
            style={{
              width: 140,
              padding: "6px 9px",
              borderRadius: 9,
              border: "1px solid #cbd5e1",
              fontSize: 12,
            }}
          />

          {mode === "summary" ? (
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Preset)}
              style={{ padding: "6px 8px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 12 }}
              title={PRESETS.find((p) => p.id === preset)?.hint}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.id === "custom" ? ` (${includedCount})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                value={baseTable}
                onChange={(e) => setBaseTable(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 12, maxWidth: 200 }}
                title="Base child table = the grain. Project attributes repeat down each of its rows."
              >
                {plan.length === 0 ? <option value="">(loading tables…)</option> : null}
                {plan.map((p) => (
                  <option key={p.table} value={p.table}>
                    {p.table} ({p.file_mb}MB)
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={rowLimit}
                min={1000}
                step={10000}
                onChange={(e) => setRowLimit(Math.max(1000, Number(e.target.value) || 100000))}
                title="Max rows to materialize (caps huge child tables)"
                style={{ width: 96, padding: "6px 8px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 12 }}
              />
            </>
          )}

          <button type="button" style={btnPrimary} onClick={() => void build()} disabled={building}>
            {building ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Build master
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px minmax(0, 1fr)",
          minHeight: 0,
          flex: 1,
        }}
      >
        {/* Plan / table picker */}
        <aside
          style={{
            borderRight: "1px solid #e2e8f0",
            overflow: "auto",
            background: "#f8fafc",
            padding: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 850, marginBottom: 6 }}>
            Custom pick ({selected.size} ticked)
          </div>
          <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px", lineHeight: 1.45 }}>
            For the <b>Custom</b> preset, tick the satellites to attach. Core project fields (
            {coreCols.length}) are always included. Presets ignore these ticks.
          </p>
          {loading ? (
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", gap: 6, alignItems: "center" }}>
              <Loader2 size={13} className="animate-spin" /> Loading plan…
            </div>
          ) : null}
          {error ? (
            <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{error}</div>
          ) : null}
          {plan.map((p) => {
            const on = selected.has(p.table);
            return (
              <label
                key={p.table}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "8px 8px",
                  marginBottom: 4,
                  borderRadius: 10,
                  border: on ? "1px solid #86efac" : "1px solid #e2e8f0",
                  background: on ? "#ecfdf5" : "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(p.table)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>
                    {p.table}{" "}
                    <span style={{ fontWeight: 600, color: "#64748b", fontSize: 10 }}>
                      {p.mode}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    {p.child_col} → project.{p.parent_col} · {p.file_mb} MB
                    {p.approx ? " · approx" : ""}
                    {p.status === "ok" ? " · ✓ joined" : ""}
                    {p.status === "error" ? ` · error` : ""}
                  </div>
                  {p.skip_reason && !on ? (
                    <div style={{ fontSize: 10, color: "#b45309" }}>{p.skip_reason}</div>
                  ) : null}
                </div>
              </label>
            );
          })}
          {notes.length ? (
            <div style={{ marginTop: 12, fontSize: 10, color: "#475569" }}>
              <b>Build log</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>

        {/* Grid */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid #e2e8f0",
              flexWrap: "wrap",
            }}
          >
            <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: 9, color: "#64748b" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(0);
                    void loadMaster(current, 0, q);
                  }
                }}
                placeholder={`Search "${current}" rows…`}
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 30px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                }}
              />
            </div>
            <button
              type="button"
              style={btn}
              onClick={() => {
                setPage(0);
                void loadMaster(current, 0, q);
              }}
            >
              Search
            </button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {data?.ready
                ? `${current} · page ${page + 1}/${totalPages} · ${data.total.toLocaleString()} rows · ${columns.length} cols`
                : "Build a master to view it"}
            </span>
          </div>

          {!data?.ready ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                fontSize: 13,
                textAlign: "center",
                padding: 40,
                lineHeight: 1.55,
              }}
            >
              <div>
                <b style={{ display: "block", fontSize: 15, color: "#0f172a", marginBottom: 6 }}>
                  No master selected
                </b>
                Name a master, pick a preset (Core / Wide / All / Custom) and click{" "}
                <b>Build master</b>. Each project becomes one wide row with counts and key fields.
                Build several — they show as chips above and you can switch between them.
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                  whiteSpace: "nowrap",
                  width: "max-content",
                  minWidth: "100%",
                }}
              >
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                          background: c.endsWith("_count") ? "#dcfce7" : "#ecfdf5",
                          textAlign: "left",
                          padding: "7px 10px",
                          borderBottom: "1px solid #86efac",
                          fontWeight: 800,
                          color: "#064e3b",
                        }}
                        title={c}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                      {columns.map((c) => (
                        <td
                          key={c}
                          style={{
                            padding: "5px 10px",
                            borderBottom: "1px solid #e2e8f0",
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontWeight: c === "project_name" || c === "project_code" ? 750 : 500,
                          }}
                          title={String(r[c] ?? "")}
                        >
                          {r[c] == null || r[c] === "" ? (
                            <i style={{ color: "#94a3b8" }}>—</i>
                          ) : (
                            String(r[c])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data?.ready ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "8px 12px",
                borderTop: "1px solid #e2e8f0",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                style={btn}
                disabled={page <= 0}
                onClick={() => {
                  const p = Math.max(0, page - 1);
                  setPage(p);
                  void loadMaster(current, p, q);
                }}
              >
                ‹ Prev
              </button>
              <button
                type="button"
                style={btn}
                disabled={page + 1 >= totalPages}
                onClick={() => {
                  const p = page + 1;
                  setPage(p);
                  void loadMaster(current, p, q);
                }}
              >
                Next ›
              </button>
              <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>
                Green columns = satellite counts (task_count, document_count, …)
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "#fff",
  color: "#0f172a",
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 750,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#dcfce7",
  borderColor: "#86efac",
  color: "#064e3b",
  fontWeight: 850,
};
